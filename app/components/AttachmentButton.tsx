'use client'
// Attachment button — uploads original files to private Supabase bucket
// Supports multiple file selection for multi-image reference

import { useRef } from 'react'
import { createBrowserClient } from '@supabase/ssr'

export type Attachment = {
  // Empty string while the attachment is still pending — set by
  // commitAttachments() at submit time. See `file` below.
  storagePath: string   // e.g. 'originals/uuid.jpg' — path inside bucket
  bucket:      string   // e.g. 'xduel-user-images'
  mediaType:   string
  fileName:    string
  fileSize:    number
  previewUrl?: string   // local object URL for image preview only
  // Optional slot tag, set ONLY by LabeledSlotsPicker so it can match
  // each attachment back to its named slot (ROSE / JACK / FIRST FRAME /
  // ...). Without this, a single upload to "JACK" while "ROSE" is empty
  // would appear in the ROSE slot because attachments[0] is always
  // first regardless of which slot it came from. Server-side code can
  // ignore this field; the provider router just sees the array order.
  slotIndex?:  number
  /** 1-based position in the composer — the number shown on the chip
   *  and sent to the director, so "use file 2" binds to these bytes. */
  fileNo?:     number
  /** What this file IS, set by a click on its chip (owner, Aug 11:
   *  numbering was "too complicated"). The role travels with the bytes,
   *  so it survives the director rewriting the brief — prose can be
   *  reworded, a tag cannot. Images only; audio/lyrics detect themselves. */
  role?:       'subject' | 'style'
  /** WHICH subject, when there is more than one (owner, Aug 11: "what if I
   *  have multiple subjects?"). A short name the user types on the chip —
   *  "Mei", "the bag". Files sharing a name are the same subject, so a
   *  scene can be fed exactly that person's photos and no one else's. */
  label?:      string
  /** The bytes, held in the browser until the user actually submits.
   *  Present on a pending attachment, absent once uploaded.
   *
   *  Nothing reaches storage on pick (CC, July 25). Uploading eagerly
   *  meant every file the user picked and then removed — or picked and
   *  never ran — left an object in the bucket with no `attachments` row
   *  pointing at it, unattributable because paths carry no user id. Now
   *  a discarded pick costs nothing; it was never sent. */
  file?:       File
}

// PDF support: PDFs are now wired up properly. The router
// (lib/providers/index.ts) passes a PDF natively to models that declare
// `pdf_to_text` (OpenAI input_file / Gemini inlineData) and falls back to
// server-side text extraction (lib/pdf-extract.ts) for everything else, so
// every text model can read a PDF. Text mode restricts the picker to
// PDF/txt via the `accept` prop; image/video modes use the full list.
const ACCEPT  = 'image/jpeg,image/png,image/gif,image/webp,text/plain,application/pdf,video/mp4,video/quicktime,video/webm'
// Per-file upload cap. 100 MB comfortably fits a few seconds of 1080p
// video (the heaviest input we typically take for image_to_video /
// video_to_video flows), plus any image or PDF. NOTE: Supabase Storage
// also enforces a per-bucket file-size limit in the dashboard — bump
// that to match (default is 50 MB on new projects).
const MAX_MB  = 100
const MAX_FILES = 5

function getBucket(mediaType: string, context: 'xduel' | 'xcreate'): string {
  const isVideo = mediaType.startsWith('video/')
  if (context === 'xduel') return isVideo ? 'xduel-user-videos'  : 'xduel-user-images'
  if (isVideo) return 'xcreate-user-videos'
  if (mediaType.startsWith('image/')) return 'xcreate-user-images'
  // Everything else — PDF, audio, text, future document types — is an
  // opaque model input, not servable media: one bucket, no per-type
  // sprawl (owner, Aug 10). Requires migration 79.
  return 'xcreate-user-files'
}

function fileIcon(mediaType: string) {
  if (mediaType.startsWith('image/')) return '🖼'
  if (mediaType.startsWith('video/')) return '🎬'
  if (mediaType.startsWith('audio/')) return '🎵'
  if (mediaType === 'application/pdf') return '📄'
  return '📎'
}

/** Some files arrive with an EMPTY type (macOS hands over whatever the
 *  UTI database says, which for downloads is often nothing) — infer the
 *  common ones from the extension so bucket routing and upload
 *  content-type never see ''. */
function inferMediaType(fileName: string, given: string): string {
  // 'application/octet-stream' is the OS saying "no idea", not a real type —
  // macOS reports it for .m4a and .flac routinely. Treating it as an answer
  // meant a perfectly good audio file was rejected as an unsupported type
  // while its extension said exactly what it was.
  if (given && given !== 'application/octet-stream') return given
  const ext = (fileName.split('.').pop() ?? '').toLowerCase()
  const map: Record<string, string> = {
    mp3: 'audio/mpeg', m4a: 'audio/x-m4a', aac: 'audio/aac', wav: 'audio/wav',
    flac: 'audio/flac', ogg: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm',
    mov: 'video/quicktime', pdf: 'application/pdf', txt: 'text/plain',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  }
  return map[ext] ?? 'application/octet-stream'
}

/** Wrap a picked file as a pending attachment. No network. */
export function pendingAttachment(
  file: File, context: 'xduel' | 'xcreate', slotIndex?: number,
): Attachment {
  const mediaType = inferMediaType(file.name, file.type)
  return {
    storagePath: '',
    bucket:      getBucket(mediaType, context),
    mediaType,
    fileName:    file.name,
    fileSize:    file.size,
    previewUrl:  mediaType.startsWith('image/') ? URL.createObjectURL(file) : undefined,
    file,
    ...(slotIndex === undefined ? {} : { slotIndex }),
  }
}

/**
 * Upload every still-pending attachment and return descriptors with real
 * storage paths. Call this once, immediately before submitting a run.
 *
 * Throws on the first failure rather than silently dropping a file — a
 * run missing its input is worse than a run that didn't start, because
 * the models answer anyway and the output just looks wrong.
 *
 * Already-uploaded attachments pass through untouched, so re-running an
 * existing set costs nothing.
 */
export async function commitAttachments(atts: Attachment[]): Promise<Attachment[]> {
  if (!atts.some(a => a.file)) return atts
  const sb = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)
  // Uploads are filed UNDER THE UPLOADER'S ID (owner, Aug 11). They used to
  // land at a bare `originals/<uuid>`, which carries no owner — so the
  // buckets' owner-read policy (which matches on a leading user-id folder)
  // could never match, nothing but the service key could read an upload
  // back, and there was no way to prove who an object belonged to. Prefixing
  // the id makes ownership checkable from the path alone.
  const { data: { user } } = await sb.auth.getUser()
  const prefix = user?.id ? `${user.id}/` : ''
  const out: Attachment[] = []
  for (const att of atts) {
    if (!att.file) { out.push(att); continue }
    const ext  = att.fileName.split('.').pop() ?? 'bin'
    const path = `${prefix}originals/${crypto.randomUUID()}.${ext}`
    const { error } = await sb.storage.from(att.bucket).upload(path, att.file, {
      contentType: att.mediaType, upsert: false,
    })
    if (error) throw new Error(`${att.fileName}: ${error.message}`)
    const { file: _dropped, ...rest } = att
    out.push({ ...rest, storagePath: path })
  }
  return out
}

/**
 * Fetch a bundled sample from the `samples` bucket and hand it back as a
 * pending attachment. Returns null (never throws) if anything is off.
 *
 * The validation is not paranoia. When a sample isn't reachable the
 * password-gate middleware can answer 200 with the gate's HTML rather
 * than a 404, and a naive `new File([blob], 'novel.txt')` then feeds that
 * HTML to every model as "the document". That shipped once, and it fails
 * silently: the run completes and the answers just look inexplicably
 * wrong. Trust the served content type, not the URL's extension.
 */
export async function attachSampleFile(
  url:       string,
  fileName:  string,
  mediaType: string,
  context:   'xduel' | 'xcreate',
): Promise<Attachment | null> {
  let blob: Blob
  try {
    const res = await fetch(url)
    if (!res.ok) { console.warn(`sample fetch ${url}: HTTP ${res.status}`); return null }
    blob = await res.blob()
  } catch (err) {
    console.warn(`sample fetch ${url} failed:`, err)
    return null
  }

  // Only the html-when-we-wanted-something-else case is rejected, so an
  // origin that serves application/octet-stream still works.
  const served = (blob.type || '').split(';')[0].trim().toLowerCase()
  if (served === 'text/html' && mediaType !== 'text/html') {
    console.warn(`sample ${url} served text/html, expected ${mediaType} — not deployed?`)
    return null
  }
  if (blob.size === 0) { console.warn(`sample ${url} is empty`); return null }

  return pendingAttachment(new File([blob], fileName, { type: mediaType }), context)
}

// ── Multi-file version (for XCreate) ────────────────────────────────────────

export default function AttachmentButton({
  attachments,
  onChange,
  disabled,
  context = 'xduel',
  multiple = false,
  accept,
  maxFiles,
  roles = false,
}: {
  attachments: Attachment[]
  onChange:    (a: Attachment[]) => void
  disabled?:   boolean
  /** Show a SUBJECT/STYLE tag on each image chip, clickable to switch.
   *  On where the distinction changes the pipeline (XDirect); off in
   *  XCreate, where the recipe already says what each slot is for. */
  roles?:      boolean
  context?:    'xduel' | 'xcreate'
  multiple?:   boolean
  /** Override the file picker filter. Falls back to the full ACCEPT string. */
  accept?:     string
  /** Max total files. Defaults to MAX_FILES (5); batch flows pass 10. */
  maxFiles?:   number
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFiles = async (files: FileList) => {
    const ALLOWED = ['image/jpeg','image/png','image/gif','image/webp','text/plain','application/pdf','video/mp4','video/quicktime','video/webm',
      'audio/mpeg','audio/mp3','audio/mp4','audio/x-m4a','audio/aac','audio/wav','audio/x-wav','audio/webm','audio/flac','audio/ogg']
    const toUpload = Array.from(files).filter(f => {
      // Validate the INFERRED type, not the browser's guess. A file the OS
      // hands over as application/octet-stream (or as nothing at all) still
      // has an extension that says what it is, and inferMediaType already
      // knows how to read it — this check just never asked. Same complaint
      // LabeledSlotsPicker fixed on Aug 10, one component over.
      const type = inferMediaType(f.name, f.type)
      if (!ALLOWED.includes(type)) { alert(`Unsupported file type: ${f.type || 'unknown'}`); return false }
      // Docs (PDF / txt) cap at 10MB — we only ever fold ≤200k chars of
      // text anyway, so bigger uploads are pure waste. Media keeps MAX_MB.
      const isDoc = type === 'application/pdf' || type.startsWith('text/')
      const capMb = isDoc ? 10 : MAX_MB
      if (f.size > capMb * 1024 * 1024) { alert(`${f.name} too large — max ${capMb}MB${isDoc ? ' for documents' : ''}`); return false }
      return true
    })
    if (toUpload.length === 0) return

    // Enforce max total files
    const cap = maxFiles ?? MAX_FILES
    const remaining = cap - attachments.length
    if (remaining <= 0) { alert(`Maximum ${cap} files allowed`); return }
    const batch = toUpload.slice(0, remaining)

    // Held in memory; commitAttachments() uploads at submit.
    onChange([...attachments, ...batch.map(f => pendingAttachment(f, context))])
    if (inputRef.current) inputRef.current.value = ''
  }

  const removeAt = (idx: number) => {
    const next = attachments.filter((_, i) => i !== idx)
    onChange(next)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {/* Existing attachments */}
      {attachments.map((att, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 6px', background: 'var(--surface, #f5f5f5)', border: '1px solid var(--border, #e0e0e0)', borderRadius: 8 }}>
          {/* What this file IS — click to switch (owner, Aug 11: numbering
              was "too complicated"). Tagging beats counting: the user never
              says which file is which, and the tag rides with the bytes so
              a rewritten brief can't lose it. Audio/lyrics tag themselves. */}
          {roles && (() => {
            const isImg = att.mediaType.startsWith('image/')
            const isAud = att.mediaType.startsWith('audio/')
            const isLyr = /\.(txt|lrc)$/i.test(att.fileName) || att.mediaType === 'text/plain'
            const tag = (text: string, bg: string, onClick?: () => void) => (
              <button
                type="button"
                onClick={onClick}
                disabled={!onClick || disabled}
                title={onClick ? 'Click to switch between SUBJECT and STYLE' : undefined}
                style={{
                  fontSize: 8, fontFamily: 'var(--mono)', fontWeight: 700, letterSpacing: '0.06em',
                  padding: '2px 5px', borderRadius: 4, border: 'none', flexShrink: 0,
                  background: bg, color: '#fff', cursor: onClick && !disabled ? 'pointer' : 'default',
                }}
              >{text}</button>
            )
            if (isAud) return tag('SONG', '#3c9ee8')
            if (isLyr) return tag('LYRICS', '#5a6472')
            if (!isImg) return null
            const role = att.role ?? 'subject'
            const badge = tag(
              role === 'style' ? 'STYLE' : 'SUBJECT',
              role === 'style' ? '#a35ce8' : 'var(--red)',
              () => onChange(attachments.map((x, xi) =>
                xi === i ? { ...x, role: role === 'style' ? 'subject' : 'style' } : x)),
            )
            // Only subjects need naming — style frames are one pool.
            if (role === 'style') return badge
            return (
              <>
                {badge}
                <input
                  value={att.label ?? ''}
                  onChange={e => onChange(attachments.map((x, xi) =>
                    xi === i ? { ...x, label: e.target.value.slice(0, 24) } : x))}
                  disabled={disabled}
                  placeholder="name"
                  title="Name this subject — photos sharing a name are the same person or object"
                  style={{
                    width: 52, flexShrink: 0, background: 'transparent',
                    border: 'none', borderBottom: '1px dashed var(--border2)',
                    fontSize: 9.5, fontFamily: 'var(--mono)', color: 'var(--white)',
                    padding: '1px 2px', outline: 'none',
                  }}
                />
              </>
            )
          })()}
          {att.mediaType.startsWith('image/') && att.previewUrl
            ? <img src={att.previewUrl} alt="" style={{ width: 24, height: 24, borderRadius: 4, objectFit: 'cover' }} />
            : <span style={{ fontSize: 14 }}>{fileIcon(att.mediaType)}</span>
          }
          <span style={{ fontSize: 10, color: 'var(--muted, #888)', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--mono)' }}>
            {att.fileName}
          </span>
          <button
            onClick={() => removeAt(i)}
            style={{ background: 'none', border: 'none', color: 'var(--muted, #888)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '0 2px', flexShrink: 0 }}
          >×</button>
        </div>
      ))}

      {/* Add button (show if under max) */}
      {attachments.length >= (maxFiles ?? MAX_FILES) && (
        <span style={{ fontSize: 9.5, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>
          {`max ${maxFiles ?? MAX_FILES} files`}
        </span>
      )}
      {attachments.length < (maxFiles ?? MAX_FILES) && (
        <>
          <input ref={inputRef} type="file" accept={accept ?? ACCEPT} multiple={multiple} style={{ display: 'none' }}
            onChange={e => { if (e.target.files?.length) handleFiles(e.target.files) }} />
          <button
            onClick={() => !disabled && inputRef.current?.click()}
            disabled={disabled}
            title={`Attach file${multiple ? 's' : ''} — image, video, audio, PDF or txt (max ${MAX_MB}MB${multiple ? `, up to ${maxFiles ?? MAX_FILES} files` : ''})`}
            style={{
              background: 'none', border: '1px solid var(--border, #e0e0e0)', borderRadius: 8,
              color: 'var(--muted, #888)', cursor: disabled ? 'default' : 'pointer',
              padding: '6px 10px', fontSize: 16, lineHeight: 1,
              transition: 'color 0.15s, border-color 0.15s',
              opacity: disabled ? 0.4 : 1,
            }}
            onMouseEnter={e => { if (!disabled) { const el = e.currentTarget as HTMLElement; el.style.color = 'var(--muted2, #666)'; el.style.borderColor = 'var(--border2, #ccc)' } }}
            onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.color = 'var(--muted, #888)'; el.style.borderColor = 'var(--border, #e0e0e0)' }}
          >📎{attachments.length > 0 ? '+' : ''}</button>
        </>
      )}
    </div>
  )
}
