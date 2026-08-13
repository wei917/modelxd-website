// lib/youtube.ts — resolve a song query to a YouTube video id (owner, Aug 13:
// "not worth keeping Spotify if we cannot play the full song through the
// agent"). YouTube is the one music surface that plays FULL songs for every
// visitor with no per-user OAuth, no listener subscription, and no user cap —
// and it is the dominant music player in this product's markets (TW/JP).
//
// Spotify's replacement history, for the record: their 2025-2026 policy walls
// (app-owner Premium, listener Premium for full tracks, dev apps capped at a
// handful of users, extended quota requiring a registered business with 250K
// MAU) made the agent-plays-music feature impossible to ship there. The
// [[play:]] / PLAY_SONG protocol survives unchanged; only the resolver and
// the embed swapped.
//
//   YOUTUBE_API_KEY set    → Data API v3 search, top embeddable hit
//   no key (the default)   → null; callers render a link-out card instead
//
// The key is a Google Cloud console freebie (enable "YouTube Data API v3",
// create an API key). Search costs 100 quota units of the free 10K/day — the
// cache below stretches that a long way.

// Per-instance cache: same song asked twice shouldn't cost quota twice.
// (Serverless instances each keep their own — a floor, not a wall, and
// that's fine for a quota saver.)
const cache = new Map<string, { videoId: string | null; at: number }>()
const CACHE_MS = 60 * 60 * 1000
const CACHE_MAX = 500

export const youtubeConfigured = () => !!process.env.YOUTUBE_API_KEY

/** Top embeddable YouTube hit for a song query, or null (no key / no hit). */
export async function resolveVideoId(q: string): Promise<string | null> {
  const key = process.env.YOUTUBE_API_KEY
  if (!key || !q) return null
  const hit = cache.get(q)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.videoId
  try {
    const url = 'https://www.googleapis.com/youtube/v3/search'
      + `?part=snippet&type=video&videoEmbeddable=true&maxResults=1&q=${encodeURIComponent(q)}&key=${key}`
    const res = await fetch(url)
    const d = await res.json().catch(() => null)
    const videoId: string | null = d?.items?.[0]?.id?.videoId ?? null
    if (cache.size >= CACHE_MAX) cache.clear()
    cache.set(q, { videoId, at: Date.now() })
    return videoId
  } catch {
    return null
  }
}
