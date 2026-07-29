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
  return isVideo ? 'xcreate-user-videos' : 'xcreate-user-images'
}

function fileIcon(mediaType: string) {
  if (mediaType.startsWith('image/')) return '🖼'
  if (mediaType.startsWith('video/')) return '🎬'
  if (mediaType === 'application/pdf') return '📄'
  return '📎'
}

/** Wrap a picked file as a pending attachment. No network. */
export function pendingAttachment(
  file: File, context: 'xduel' | 'xcreate', slotIndex?: number,
): Attachment {
  return {
    storagePath: '',
    bucket:      getBucket(file.type, context),
    mediaType:   file.type,
    fileName:    file.name,
    fileSize:    file.size,
    previewUrl:  file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
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
  const out: Attachment[] = []
  for (const att of atts) {
    if (!att.file) { out.push(att); continue }
    const ext  = att.fileName.split('.').pop() ?? 'bin'
    const path = `originals/${crypto.randomUUID()}.${ext}`
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
}: {
  attachments: Attachment[]
  onChange:    (a: Attachment[]) => void
  disabled?:   boolean
  context?:    'xduel' | 'xcreate'
  multiple?:   boolean
  /** Override the file picker filter. Falls back to the full ACCEPT string. */
  accept?:     string
  /** Max total files. Defaults to MAX_FILES (5); batch flows pass 10. */
  maxFiles?:   number
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFiles = async (files: FileList) => {
    const ALLOWED = ['image/jpeg','image/png','image/gif','image/webp','text/plain','application/pdf','video/mp4','video/quicktime','video/webm']
    const toUpload = Array.from(files).filter(f => {
      if (!ALLOWED.includes(f.type)) { alert(`Unsupported file type: ${f.type || 'unknown'}`); return false }
      // Docs (PDF / txt) cap at 10MB — we only ever fold ≤200k chars of
      // text anyway, so bigger uploads are pure waste. Media keeps MAX_MB.
      const isDoc = f.type === 'application/pdf' || f.type.startsWith('text/')
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
      {attachments.length < (maxFiles ?? MAX_FILES) && (
        <>
          <input ref={inputRef} type="file" accept={accept ?? ACCEPT} multiple={multiple} style={{ display: 'none' }}
            onChange={e => { if (e.target.files?.length) handleFiles(e.target.files) }} />
          <button
            onClick={() => !disabled && inputRef.current?.click()}
            disabled={disabled}
            title={`Attach file${multiple ? 's' : ''} — image, video, PDF or txt (max ${MAX_MB}MB${multiple ? `, up to ${MAX_FILES}` : ''})`}
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
