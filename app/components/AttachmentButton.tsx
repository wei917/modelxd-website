'use client'
// Attachment button — uploads original file to private Supabase bucket
// Returns storage path + metadata; server handles resize/thumbnail

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
const MAX_MB  = 20

function getBucket(mediaType: string, context: 'xduel' | 'create'): string {
  const isVideo = mediaType.startsWith('video/')
  if (context === 'xduel') return isVideo ? 'xduel-user-videos'  : 'xduel-user-images'
  return isVideo ? 'create-user-videos' : 'create-user-images'
}

function fileIcon(mediaType: string) {
  if (mediaType.startsWith('image/')) return '🖼'
  if (mediaType.startsWith('video/')) return '🎬'
  if (mediaType === 'application/pdf') return '📄'
  return '📎'
}

export default function AttachmentButton({
  attachment,
  onChange,
  disabled,
  context = 'xduel',
}: {
  attachment: Attachment | null
  onChange:   (a: Attachment | null) => void
  disabled?:  boolean
  context?:   'xduel' | 'create'
}) {
  const inputRef    = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const handleFile = async (file: File) => {
    if (file.size > MAX_MB * 1024 * 1024) { alert(`File too large — max ${MAX_MB}MB`); return }
    setUploading(true)
    const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
    try {
      const sb     = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)
      const bucket = getBucket(file.type, context)
      const ext    = file.name.split('.').pop() ?? 'bin'
      const path   = `originals/${crypto.randomUUID()}.${ext}`

      const { error } = await sb.storage.from(bucket).upload(path, file, {
        contentType: file.type,
        upsert:      false,
      })
      if (error) throw new Error(error.message)

      onChange({
        storagePath: path,
        bucket,
        mediaType:   file.type,
        fileName:    file.name,
        fileSize:    file.size,
        previewUrl,
      })
    } catch (err) {
      alert(`Upload failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setUploading(false)
    }
  }

  if (uploading) return (
    <div style={{ padding: '6px 10px', fontSize: 12, color: '#555', fontFamily: 'var(--mono)', display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', border: '2px solid #333', borderTopColor: '#666', animation: 'spin 0.6s linear infinite' }} />
      uploading…
    </div>
  )

  if (attachment) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', background: '#151515', border: '1px solid #222', borderRadius: 8 }}>
      {attachment.mediaType.startsWith('image/') && attachment.previewUrl
        ? <img src={attachment.previewUrl} alt="" style={{ width: 28, height: 28, borderRadius: 4, objectFit: 'cover' }} />
        : <span style={{ fontSize: 18 }}>{fileIcon(attachment.mediaType)}</span>
      }
      <span style={{ fontSize: 11, color: '#666', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--mono)' }}>
        {attachment.fileName}
      </span>
      <button
        onClick={() => { onChange(null); if (inputRef.current) inputRef.current.value = '' }}
        style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 2px', flexShrink: 0 }}
      >×</button>
    </div>
  )

  return (
    <>
      <input ref={inputRef} type="file" accept={ACCEPT} style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
      <button
        onClick={() => !disabled && inputRef.current?.click()}
        disabled={disabled}
        title="Attach file — image, video, PDF or txt (max 20MB)"
        style={{
          background: 'none', border: '1px solid #1e1e1e', borderRadius: 8,
          color: '#444', cursor: disabled ? 'default' : 'pointer',
          padding: '6px 10px', fontSize: 16, lineHeight: 1,
          transition: 'color 0.15s, border-color 0.15s',
          opacity: disabled ? 0.4 : 1,
        }}
        onMouseEnter={e => { if (!disabled) { const el = e.currentTarget as HTMLElement; el.style.color = '#888'; el.style.borderColor = '#333' } }}
        onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.color = '#444'; el.style.borderColor = '#1e1e1e' }}
      >📎</button>
    </>
  )
}
