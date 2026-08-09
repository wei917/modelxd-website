// app/api/xcharacter/yt/route.ts — resolve a character's [[play: …]]
// directive to a YouTube video id (Aug 8). Two modes:
//   YOUTUBE_API_KEY set    → Data API v3 search, top embeddable hit
//   no key (the default)   → { videoId: null }; the client renders a
//                            link-out card instead of an inline player
// The key is a Google Cloud console freebie (enable "YouTube Data API v3",
// create an API key). Search costs 100 quota units of the free 10K/day —
// the cache below stretches that a long way.

export const runtime = 'nodejs'

import { assertFeature } from '@/lib/features'

// Per-instance cache: same song asked twice shouldn't cost quota twice.
// (Serverless instances each keep their own — a floor, not a wall, and
// that's fine for a quota saver.)
const cache = new Map<string, { videoId: string | null; at: number }>()
const CACHE_MS = 60 * 60 * 1000
const CACHE_MAX = 500

export async function POST(req: Request) {
  const gate = await assertFeature('xtalk')
  if (gate) return gate
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return Response.json({ error: 'Bad JSON' }, { status: 400 }) }
  const q = String(body.q ?? '').trim().slice(0, 120)
  if (!q) return Response.json({ error: 'No query' }, { status: 400 })

  const key = process.env.YOUTUBE_API_KEY
  if (!key) return Response.json({ videoId: null })

  const hit = cache.get(q)
  if (hit && Date.now() - hit.at < CACHE_MS) return Response.json({ videoId: hit.videoId })

  try {
    const url = 'https://www.googleapis.com/youtube/v3/search'
      + `?part=snippet&type=video&videoEmbeddable=true&maxResults=1&q=${encodeURIComponent(q)}&key=${key}`
    const res = await fetch(url)
    const d = await res.json().catch(() => null)
    const videoId: string | null = d?.items?.[0]?.id?.videoId ?? null
    if (cache.size >= CACHE_MAX) cache.clear()
    cache.set(q, { videoId, at: Date.now() })
    return Response.json({ videoId })
  } catch {
    return Response.json({ videoId: null })
  }
}
