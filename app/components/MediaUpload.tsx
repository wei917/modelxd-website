'use client'
// components/MediaUpload.tsx
// Reusable upload component for user-images and user-videos
// Client uploads directly to Supabase Storage via signed URL — file never hits your server

import { useState, useRef, useCallback } from 'react'

// xduel-user-* buckets are public  → onSuccess returns publicUrl directly
// create-user-* buckets are private → onSuccess returns path, call /api/upload/signed-read to view
// Note: ai-* buckets are server-written (duel API), not used here
type Bucket = 'xduel-user-images' | 'xduel-user-videos' | 'create-user-images' | 'create-user-videos'

interface UploadResult {
  path: string
  publicUrl: string | null  // non-null for xduel-* (public), null for create-* (private)
}

interface Props {
  bucket: Bucket
  accept?: string
  label?: string
  maxSizeMB?: number
  onSuccess?: (result: UploadResult) => void
  onError?: (msg: string) => void
  className?: string
}

const DEFAULTS: Record<Bucket, { accept: string; label: string; maxSizeMB: number }> = {
  'xduel-user-images':  { accept: 'image/jpeg,image/png,image/gif,image/webp',      label: 'Upload Image', maxSizeMB: 10  },
  'xduel-user-videos':  { accept: 'video/mp4,video/webm,video/quicktime,video/mov', label: 'Upload Video', maxSizeMB: 500 },
  'create-user-images': { accept: 'image/jpeg,image/png,image/gif,image/webp',      label: 'Upload Image', maxSizeMB: 10  },
  'create-user-videos': { accept: 'video/mp4,video/webm,video/quicktime,video/mov', label: 'Upload Video', maxSizeMB: 500 },
}

export default function MediaUpload({
  bucket,
  accept,
  label,
  maxSizeMB,
  onSuccess,
  onError,
  className = '',
}: Props) {
  const defaults = DEFAULTS[bucket]
  const [status, setStatus]   = useState<'idle' | 'uploading' | 'done' | 'error'>('idle')
  const [progress, setProgress] = useState(0)
  const [preview, setPreview] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const upload = useCallback(async (file: File) => {
    setStatus('uploading')
    setProgress(0)

    // Local preview
    const objectUrl = URL.createObjectURL(file)
    setPreview(objectUrl)

    try {
      // 1. Get signed upload URL from our API
      const res = await fetch('/api/upload/signed-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bucket,
          filename: file.name,
          contentType: file.type,
          size: file.size,
        }),
      })

      if (!res.ok) {
        const { error } = await res.json()
        throw new Error(error || 'Failed to get upload URL')
      }

      const { signedUrl, path, publicUrl } = await res.json()

      // 2. Upload directly to Supabase Storage (XHR for progress)
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('PUT', signedUrl)
        xhr.setRequestHeader('Content-Type', file.type)
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100))
        }
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve()
          else reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`))
        }
        xhr.onerror = () => reject(new Error('Network error during upload'))
        xhr.send(file)
      })

      setStatus('done')
      setProgress(100)
      onSuccess?.({ path, publicUrl: publicUrl ?? null })

    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed'
      setStatus('error')
      setPreview(null)
      onError?.(msg)
    }
  }, [bucket, onSuccess, onError])

  const handleFile = (file: File | undefined) => {
    if (!file) return
    const limitMB = maxSizeMB ?? defaults.maxSizeMB
    if (file.size > limitMB * 1024 * 1024) {
      onError?.(`File too large. Max ${limitMB}MB.`)
      return
    }
    upload(file)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    handleFile(e.dataTransfer.files[0])
  }

  const isImage = bucket.includes('images')

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {/* Drop zone */}
      <div
        onClick={() => status === 'idle' && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        style={{
          border: `2px dashed ${dragging ? '#e8453c' : status === 'done' ? '#34d399' : '#333'}`,
          borderRadius: 12,
          padding: 24,
          textAlign: 'center',
          cursor: status === 'idle' ? 'pointer' : 'default',
          background: dragging ? 'rgba(232,69,60,0.05)' : '#0d0d0d',
          transition: 'border-color 0.2s, background 0.2s',
          position: 'relative',
          overflow: 'hidden',
          minHeight: 140,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        }}
      >
        {/* Preview */}
        {preview && status !== 'error' && (
          <div style={{ position: 'absolute', inset: 0, opacity: 0.25, pointerEvents: 'none' }}>
            {isImage
              ? <img src={preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <video src={preview} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted />
            }
          </div>
        )}

        {/* Icon */}
        <div style={{ fontSize: 32, position: 'relative' }}>
          {status === 'done' ? '✅' : status === 'error' ? '❌' : isImage ? '🖼️' : '🎬'}
        </div>

        {/* Text */}
        <div style={{ position: 'relative', color: '#888', fontSize: 13 }}>
          {status === 'idle' && (
            <>
              <span style={{ color: '#e8453c', fontWeight: 600 }}>
                {label ?? defaults.label}
              </span>
              {' '}or drag & drop
              <div style={{ color: '#555', fontSize: 11, marginTop: 4 }}>
                Max {maxSizeMB ?? defaults.maxSizeMB}MB
              </div>
            </>
          )}
          {status === 'uploading' && (
            <span style={{ color: '#e8453c' }}>Uploading… {progress}%</span>
          )}
          {status === 'done' && (
            <span style={{ color: '#34d399' }}>Upload complete</span>
          )}
          {status === 'error' && (
            <span style={{ color: '#e8453c' }}>Upload failed — try again</span>
          )}
        </div>

        {/* Progress bar */}
        {status === 'uploading' && (
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            height: 3, background: '#1a1a1a',
          }}>
            <div style={{
              width: `${progress}%`, height: '100%',
              background: '#e8453c', transition: 'width 0.2s',
            }} />
          </div>
        )}
      </div>

      {/* Re-upload button after done/error */}
      {(status === 'done' || status === 'error') && (
        <button
          onClick={() => { setStatus('idle'); setPreview(null); setProgress(0); inputRef.current?.click() }}
          style={{
            background: 'transparent', border: '1px solid #333',
            color: '#888', borderRadius: 8, padding: '6px 12px',
            fontSize: 12, cursor: 'pointer', alignSelf: 'flex-end',
          }}
        >
          Upload another
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={accept ?? defaults.accept}
        style={{ display: 'none' }}
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
    </div>
  )
}
