// lib/xcut-media.ts — server-side helpers XCut's routes share: storage URLs
// ↔ {bucket, path}, the media inside an xcreates/duels `slots` array, and
// batch signing (24 h, one createSignedUrls call per bucket — the profile
// history route's pattern).

import type { Timeline, MediaSrc } from './xcut-timeline'

/** A Supabase storage object URL — signed or public — to its bucket + path. */
export const STORAGE_URL_RE = /\/storage\/v1\/object\/(?:sign|public)\/([^/]+)\/([^?]+)/
export function parseStorageUrl(url: string | null | undefined): { bucket: string; path: string } | null {
  if (!url || typeof url !== 'string') return null
  const m = url.match(STORAGE_URL_RE)
  return m ? { bucket: m[1], path: decodeURIComponent(m[2]) } : null
}

const mimeOf = (path: string, kind: 'video' | 'image'): string => {
  const ext = (path.split('.').pop() ?? '').toLowerCase()
  if (kind === 'video') return ext === 'webm' ? 'video/webm' : ext === 'mov' ? 'video/quicktime' : 'video/mp4'
  return ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png'
}

export type SlotMedia = { kind: 'video' | 'image'; bucket: string; path: string; mediaType: string; model?: string; cost?: number }

/** Every output picture/clip inside a slots array (a slot's `text` holds one
 *  storage URL per line for media results). */
export function mediaFromSlots(slots: unknown): SlotMedia[] {
  const out: SlotMedia[] = []
  for (const s of (Array.isArray(slots) ? slots : []) as any[]) {
    if (!s || typeof s.text !== 'string' || s.error) continue
    const kind: 'video' | 'image' | null = s.isVideo ? 'video' : s.isImage ? 'image' : null
    if (!kind) continue
    for (const line of s.text.split('\n')) {
      const p = parseStorageUrl(line.trim())
      if (!p) continue
      out.push({ kind, bucket: p.bucket, path: p.path, mediaType: mimeOf(p.path, kind), model: typeof s.name === 'string' ? s.name : (typeof s.model_name === 'string' ? s.model_name : undefined), cost: Number.isFinite(Number(s.cost)) ? Number(s.cost) : undefined })
    }
  }
  return out
}

export const SIGN_TTL_S = 60 * 60 * 24

/** Sign many {bucket, path} at once. Returns a map keyed `${bucket}\n${path}`. */
export async function signMany(client: any, items: Array<{ bucket: string; path: string }>, ttl = SIGN_TTL_S): Promise<Map<string, string>> {
  const byBucket = new Map<string, Set<string>>()
  for (const it of items) { if (!it?.bucket || !it?.path) continue; (byBucket.get(it.bucket) ?? byBucket.set(it.bucket, new Set()).get(it.bucket)!).add(it.path) }
  const out = new Map<string, string>()
  await Promise.all([...byBucket.entries()].map(async ([bucket, set]) => {
    const list = [...set]
    const { data } = await client.storage.from(bucket).createSignedUrls(list, ttl)
    for (const d of data ?? []) if (d?.signedUrl && d.path) out.set(`${bucket}\n${d.path}`, d.signedUrl)
  }))
  return out
}

/** Fresh signed URLs on every clip of a timeline (video + audio tracks). */
export async function signTimeline(client: any, tl: Timeline): Promise<Timeline> {
  const all: MediaSrc[] = [...tl.video.map(c => c.src), ...tl.audio.map(c => c.src)]
  const map = await signMany(client, all)
  const fresh = (s: MediaSrc): MediaSrc => ({ ...s, url: map.get(`${s.bucket}\n${s.path}`) ?? s.url })
  return { ...tl, video: tl.video.map(c => ({ ...c, src: fresh(c.src) })), audio: tl.audio.map(c => ({ ...c, src: fresh(c.src) })) }
}
