// lib/xcut-upload.ts — put a big rendered film into Supabase storage
// RESUMABLY: TUS, 6 MB chunks, retries per chunk. A single-request upload of
// tens of MB died repeatedly from the owner's Mac with "fetch failed" / TLS
// bad record mac (Aug 23); chunked + retried, a bad hop costs one chunk, not
// the film. Supabase recommends resumable uploads above 6 MB regardless.
// Small files keep the plain upload.

import { createClient } from '@supabase/supabase-js'

const CHUNK = 6 * 1024 * 1024

export async function uploadFilm(opts: { bucket: string; path: string; buffer: Buffer; contentType: string }): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!, key = process.env.SUPABASE_SECRET_KEY!
  if (opts.buffer.length <= CHUNK) {
    const sb = createClient(url, key, { auth: { persistSession: false } })
    const { error } = await sb.storage.from(opts.bucket).upload(opts.path, opts.buffer, { contentType: opts.contentType, upsert: true })
    if (error) throw new Error(error.message)
    return
  }
  const tus = await import('tus-js-client')
  await new Promise<void>((resolve, reject) => {
    // A Buffer is a first-class source for tus-js-client in Node (a Readable
    // wrapped it into a single 6 MB chunk and declared the source done).
    const upload = new tus.Upload(opts.buffer as any, {
      endpoint: `${url}/storage/v1/upload/resumable`,
      retryDelays: [0, 1000, 3000, 6000, 10000, 15000],
      // The resumable endpoint checks `apikey` as well as the Bearer (403 without it).
      headers: { authorization: `Bearer ${key}`, apikey: key, 'x-upsert': 'true' },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: CHUNK,
      uploadSize: opts.buffer.length,
      metadata: { bucketName: opts.bucket, objectName: opts.path, contentType: opts.contentType, cacheControl: '3600' },
      onError: (err: any) => reject(new Error(`resumable upload: ${err?.message ?? err}`)),
      onSuccess: () => resolve(),
    })
    upload.findPreviousUploads().then(prev => { if (prev.length > 0) upload.resumeFromPreviousUpload(prev[0]); upload.start() }).catch(() => upload.start())
  })
}
