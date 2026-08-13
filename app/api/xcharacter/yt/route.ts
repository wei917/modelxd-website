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
import { resolveVideoId } from '@/lib/youtube'

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

  return Response.json({ videoId: await resolveVideoId(q) })
}
