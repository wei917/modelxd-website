'use client'
// Attachment button — uploads original files to private Supabase bucket
// Supports multiple file selection for multi-image reference

import { useRef, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'

export type Attachment = {
  storagePath: string   // e.g. 'originals/uuid.jpg' — path inside bucket
  bucket:      string   // e.g. 'xduel-user-images'
  mediaType:   string
  fileName:    string
  fileSize:    number
  previewUrl?: string   // local object URL for image preview only
}

const ACCEPT  = 'image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,video/mp4,video/quicktime,video/webm'
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

// ── Multi-file version (for XCreate) ────────────────────────────────────────

export default function AttachmentButton({
  attachments,
  onChange,
  disabled,
  context = 'xduel',
  multiple = false,
  accept,
}: {
  attachments: Attachment[]
  onChange:    (a: Attachment[]) => void
  disabled?:   boolean
  context?:    'xduel' | 'xcreate'
  multiple?:   boolean
  /** Override the file picker filter. Falls back to the full ACCEPT string. */
  accept?:     string
}) {
  const inputRef    = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const handleFiles = async (files: FileList) => {
    const ALLOWED = ['image/jpeg','image/png','image/gif','image/webp','application/pdf','text/plain','video/mp4','video/quicktime','video/webm']
    const toUpload = Array.from(files).filter(f => {
      if (!ALLOWED.includes(f.type)) { alert(`Unsupported file type: ${f.type || 'unknown'}`); return false }
      if (f.size > MAX_MB * 1024 * 1024) { alert(`${f.name} too large — max ${MAX_MB}MB`); return false }
      return true
    })
    if (toUpload.length === 0) return

    // Enforce max total files
    const remaining = MAX_FILES - attachments.length
    if (remaining <= 0) { alert(`Maximum ${MAX_FILES} files allowed`); return }
    const batch = toUpload.slice(0, remaining)

    setUploading(true)
    try {
      const sb = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)
      const newAttachments: Attachment[] = []

      for (const file of batch) {
        const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
        const bucket = getBucket(file.type, context)
        const ext    = file.name.split('.').pop() ?? 'bin'
        const path   = `originals/${crypto.randomUUID()}.${ext}`

        const { error } = await sb.storage.from(bucket).upload(path, file, {
          contentType: file.type,
          upsert:      false,
        })
        if (error) { console.warn(`Upload failed for ${file.name}: ${error.message}`); continue }

        newAttachments.push({
          storagePath: path,
          bucket,
          mediaType:   file.type,
          fileName:    file.name,
          fileSize:    file.size,
          previewUrl,
        })
      }

      if (newAttachments.length > 0) {
        onChange([...attachments, ...newAttachments])
      }
    } catch (err) {
      alert(`Upload failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const removeAt = (idx: number) => {
    const next = attachments.filter((_, i) => i !== idx)
    onChange(next)
    if (inputRef.current) inputRef.current.value = ''
  }

  if (uploading) return (
    <div style={{ padding: '6px 10px', fontSize: 12, color: '#555', fontFamily: 'var(--mono)', display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', border: '2px solid #333', borderTopColor: '#666', animation: 'spin 0.6s linear infinite' }} />
      uploading…
    </div>
  )

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
      {attachments.length < MAX_FILES && (
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
