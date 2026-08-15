// lib/providers/history-storage.ts
//
// Google multi-turn image editing replays a conversation history whose parts
// embed every image as inline base64 (~1.5MB per image). That history used to
// be persisted verbatim into xcreates.slots — which is how single slots grew
// to 11-12MB, one four-row board weighed 46MB, and its board query ran 15.6s
// with intermittent 500s (measured Aug 15). Every one of those images already
// lives in Supabase Storage by the time the row is written: outputs are
// uploaded before the insert, uploads keep a resized copy, parent outputs ARE
// storage objects. So the stored history only needs pointers.
//
//   { inlineData:   { mimeType, data: <base64> } }   // what Gemini needs
//   { storageImage: { bucket, path, mimeType } }     // what we persist
//
// dehydrateHistory() swaps inline parts for markers by byte-matching against
// the images the route just handled; anything unmatched is uploaded to a
// fallback path first, so a dehydrated history never carries base64.
// rehydrateHistory() downloads markers back into inline parts right before
// the provider call (lib/providers/index.ts does this transparently for any
// caller), restoring the exact bytes Gemini saw — multi-turn fidelity is
// unchanged. Text parts and any other sibling keys pass through untouched.
//
// thoughtSignature gets the same treatment: Gemini 3 image models attach a
// ~700KB signature to every image part (measured Aug 15), and it must ride
// back on follow-up turns — dropping it degrades multi-turn fidelity. Big
// signatures are stored as their own objects and persisted as
// { thoughtSignatureRef: { bucket, path } }; small ones stay inline.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export type StorageImageRef = {
  bucket:   string
  path:     string
  mimeType: string
}

/** A storage object whose exact bytes may appear inline in a history. */
export type HistoryImageCandidate = {
  bucket:    string
  path:      string
  buffer:    Buffer
  mimeType?: string
}

export type DehydrateFallback = {
  /** Service-role client used for fallback uploads (bypasses RLS). */
  sb:         SupabaseClient
  bucket:     string
  /** Path prefix for fallback uploads, e.g. `${userId}/hist/`. */
  pathPrefix: string
}

const LOG = '[history-storage]'

// A thoughtSignature above this stays out of the database. Below it, the
// storage round-trip costs more than the bytes save.
const SIG_INLINE_MAX = 16 * 1024

// Signatures are text blobs, and the ai-images bucket's mime allowlist only
// admits image/*. xcreate-user-images allows text/plain (it takes .txt
// prompts and PDFs) and is equally private, so signature objects live
// there — under the same <user>/… path prefix the caller gave us.
const SIG_BUCKET = 'xcreate-user-images'

function serviceClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  )
}

export function historyHasMarkers(history: any[] | null | undefined): boolean {
  return !!history?.some(t => Array.isArray(t?.parts) && t.parts.some((p: any) => p?.storageImage?.path || p?.thoughtSignatureRef?.path))
}

export function historyHasInlineData(history: any[] | null | undefined): boolean {
  return !!history?.some(t => Array.isArray(t?.parts) && t.parts.some((p: any) => typeof p?.inlineData?.data === 'string' && p.inlineData.data.length > 0))
}

/**
 * Replace every inline image part with a { storageImage } marker.
 *
 * Matching is by byte equality against `candidates` — inline data always
 * round-trips base64 exactly, so an image the route uploaded or downloaded
 * matches its storage object byte-for-byte. An inline image matching no
 * candidate is uploaded under `fallback` and markered; without a fallback it
 * stays inline (with a warning) rather than losing the image.
 *
 * Returns a new structure; the input history is never mutated (its part
 * objects are shared with the provider result).
 */
export async function dehydrateHistory(
  history:    any[] | null | undefined,
  candidates: HistoryImageCandidate[],
  fallback?:  DehydrateFallback,
): Promise<any[] | null> {
  if (!history || history.length === 0) return history ?? null

  const out: any[] = []
  for (const turn of history) {
    if (!Array.isArray(turn?.parts)) { out.push(turn); continue }
    const parts: any[] = []
    for (const part of turn.parts) {
      let next = part

      // Inline image → storage marker.
      const data = next?.inlineData?.data
      if (typeof data === 'string' && data.length > 0) {
        const bytes = Buffer.from(data, 'base64')
        const mime: string = next.inlineData.mimeType ?? 'image/png'
        let hit = candidates.find(c => c.buffer.length === bytes.length && c.buffer.equals(bytes))

        if (!hit && fallback) {
          const ext  = (mime.split('/')[1] ?? 'png').replace('jpeg', 'jpg')
          const path = `${fallback.pathPrefix}${globalThis.crypto.randomUUID()}.${ext}`
          const { error } = await fallback.sb.storage.from(fallback.bucket)
            .upload(path, bytes, { contentType: mime, upsert: false })
          if (!error) {
            hit = { bucket: fallback.bucket, path, buffer: bytes, mimeType: mime }
            candidates.push(hit)  // an image repeated across turns uploads once
            console.log(`${LOG} uploaded unmatched inline image → ${fallback.bucket}/${path} (${bytes.length}b)`)
          } else {
            console.warn(`${LOG} fallback upload failed (${error.message}) — keeping part inline`)
          }
        }

        if (hit) {
          const { inlineData: _drop, ...rest } = next
          next = { ...rest, storageImage: { bucket: hit.bucket, path: hit.path, mimeType: mime } satisfies StorageImageRef }
        }
      }

      // Oversized thoughtSignature → its own storage object. Never matched —
      // signatures are unique per response — so this is always an upload.
      const sig = next?.thoughtSignature
      if (typeof sig === 'string' && sig.length > SIG_INLINE_MAX && fallback) {
        const path = `${fallback.pathPrefix}${globalThis.crypto.randomUUID()}.sig.txt`
        const { error } = await fallback.sb.storage.from(SIG_BUCKET)
          .upload(path, Buffer.from(sig, 'utf-8'), { contentType: 'text/plain', upsert: false })
        if (!error) {
          const { thoughtSignature: _drop, ...rest } = next
          next = { ...rest, thoughtSignatureRef: { bucket: SIG_BUCKET, path } }
        } else {
          console.warn(`${LOG} thoughtSignature upload failed (${error.message}) — keeping it inline`)
        }
      }

      parts.push(next)
    }
    out.push({ ...turn, parts })
  }
  return out
}

/**
 * Replace every { storageImage } / { thoughtSignatureRef } marker with the
 * real inline value, freshly downloaded from storage. A marker whose object
 * is gone degrades softly — a text note for a lost image (the request stays
 * valid; Gemini just loses sight of that image), silence for a lost
 * signature (Gemini treats a missing signature as reduced context).
 */
export async function rehydrateHistory(
  history: any[],
  sb: SupabaseClient = serviceClient(),
): Promise<any[]> {
  const cache = new Map<string, Buffer | null>()
  const fetchCached = async (bucket: string, path: string): Promise<Buffer | null> => {
    const key = `${bucket}/${path}`
    if (!cache.has(key)) {
      try {
        const { data, error } = await sb.storage.from(bucket).download(path)
        if (error || !data) {
          console.warn(`${LOG} download failed for ${key}: ${error?.message ?? 'no data'}`)
          cache.set(key, null)
        } else {
          cache.set(key, Buffer.from(await data.arrayBuffer()))
        }
      } catch (err) {
        console.warn(`${LOG} download threw for ${key}:`, err instanceof Error ? err.message : err)
        cache.set(key, null)
      }
    }
    return cache.get(key)!
  }

  const out: any[] = []
  for (const turn of history) {
    if (!Array.isArray(turn?.parts)) { out.push(turn); continue }
    const parts: any[] = []
    for (const part of turn.parts) {
      let next = part

      const sigRef = next?.thoughtSignatureRef
      if (sigRef?.bucket && sigRef?.path) {
        const bytes = await fetchCached(sigRef.bucket, sigRef.path)
        const { thoughtSignatureRef: _drop, ...rest } = next
        next = bytes ? { ...rest, thoughtSignature: bytes.toString('utf-8') } : rest
      }

      const ref = next?.storageImage
      if (ref?.bucket && ref?.path) {
        const bytes = await fetchCached(ref.bucket, ref.path)
        if (!bytes) { parts.push({ text: '[image no longer available]' }); continue }
        const { storageImage: _drop, ...rest } = next
        next = { ...rest, inlineData: { mimeType: ref.mimeType ?? 'image/png', data: bytes.toString('base64') } }
      }

      parts.push(next)
    }
    out.push({ ...turn, parts })
  }
  return out
}
