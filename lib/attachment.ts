// lib/attachment.ts
// Server-side attachment processing:
// 1. Fetch original from private bucket using service role
// 2. Resize (images only) with Sharp
// 3. Upload resized + thumbnail back to bucket
// 4. Insert attachments row, return id + buffer for model

import { createClient } from '@supabase/supabase-js'

const SERVICE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

// Max dimensions
const RESIZED_MAX   = 1920
const THUMBNAIL_MAX = 300

export interface ProcessedAttachment {
  attachmentId: string
  buffer:       Buffer        // resized buffer to pass to model
  mediaType:    string
  originalUrl:  string
  resizedUrl:   string
  thumbnailUrl: string | null
}

function supabaseAdmin() {
  return createClient(SERVICE_URL, SERVICE_KEY, { auth: { persistSession: false } })
}

// Get a signed URL so we can fetch from private bucket
async function fetchPrivateFile(bucket: string, path: string): Promise<Buffer> {
  const sb = supabaseAdmin()
  const { data, error } = await sb.storage.from(bucket).download(path)
  if (error || !data) throw new Error(`Failed to fetch ${bucket}/${path}: ${error?.message}`)
  return Buffer.from(await data.arrayBuffer())
}

async function uploadBuffer(bucket: string, path: string, buf: Buffer, contentType: string): Promise<string> {
  const sb = supabaseAdmin()
  const { error } = await sb.storage.from(bucket).upload(path, buf, { contentType, upsert: true })
  if (error) throw new Error(`Upload failed ${bucket}/${path}: ${error.message}`)
  // Return the storage path — we'll build signed URLs on demand, store path in DB
  return path
}

export async function processAttachment(
  userId:    string,
  bucket:    string,     // e.g. 'xduel-user-images'
  storagePath: string,   // e.g. 'originals/uuid.jpg'
  mediaType: string,
  fileName:  string,
  fileSize:  number,
): Promise<ProcessedAttachment> {
  const sb = supabaseAdmin()
  const isImage = mediaType.startsWith('image/')
  const uid     = crypto.randomUUID()

  // 1. Fetch original buffer
  const originalBuf = await fetchPrivateFile(bucket, storagePath)

  // Build storage paths
  const ext           = fileName.split('.').pop() ?? 'bin'
  const resizedPath   = `resized/${uid}.${isImage ? 'jpg' : ext}`
  const thumbnailPath = isImage ? `thumbnails/${uid}.jpg` : null

  let resizedBuf:   Buffer
  let thumbnailBuf: Buffer | null = null

  if (isImage) {
    // Lazy import sharp (Node only)
    const sharp = (await import('sharp')).default

    // Resize to max 1920px
    resizedBuf = await sharp(originalBuf)
      .resize(RESIZED_MAX, RESIZED_MAX, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer()

    // Thumbnail 300px
    thumbnailBuf = await sharp(originalBuf)
      .resize(THUMBNAIL_MAX, THUMBNAIL_MAX, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toBuffer()
  } else {
    // PDF, txt, video — no resize, use original as-is
    resizedBuf = originalBuf
  }

  // 2. Upload resized + thumbnail
  const resizedStoragePath   = await uploadBuffer(bucket, resizedPath, resizedBuf, isImage ? 'image/jpeg' : mediaType)
  const thumbnailStoragePath = thumbnailBuf && thumbnailPath
    ? await uploadBuffer(bucket, thumbnailPath, thumbnailBuf, 'image/jpeg')
    : null

  // 3. Build signed URLs (1 hour) for storage in DB
  async function signedUrl(path: string): Promise<string> {
    const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, 3600)
    if (error || !data) throw new Error(`Signed URL failed: ${error?.message}`)
    return data.signedUrl
  }

  const originalUrl  = await signedUrl(storagePath)
  const resizedUrl   = await signedUrl(resizedStoragePath)
  const thumbnailUrl = thumbnailStoragePath ? await signedUrl(thumbnailStoragePath) : null

  // 4. Insert attachments row
  const { data: row, error: dbError } = await sb.from('attachments').insert({
    user_id:       userId,
    bucket,
    original_path:   storagePath,
    resized_path:    resizedStoragePath,
    thumbnail_path:  thumbnailStoragePath,
    original_url:    originalUrl,
    resized_url:     resizedUrl,
    thumbnail_url:   thumbnailUrl,
    media_type:    mediaType,
    file_name:     fileName,
    file_size:     fileSize,
  }).select('id').single()

  if (dbError || !row) throw new Error(`DB insert failed: ${dbError?.message}`)

  return {
    attachmentId: row.id,
    buffer:       resizedBuf,
    mediaType:    isImage ? 'image/jpeg' : mediaType,
    originalUrl,
    resizedUrl,
    thumbnailUrl: thumbnailUrl ?? null,
  }
}
