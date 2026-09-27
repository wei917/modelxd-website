// app/api/trending/route.ts
// Public read of the "Trending on social media" feed (XCreate Studio and
// Templates). Every week's LIVE posts, paginated with a keyset cursor:
//
//   GET /api/trending?kind=video|image|all&limit=10&cursor=<opaque>
//   -> { posts, nextCursor }   (nextCursor null at the end)
//
// Until Sep 27 it served only the newest week of one kind, so a short week was
// all anyone saw (5 posts) and older weeks never topped it up. The order and
// the "after this cursor" predicate both live in the database
// (lib/trending-cursor.ts), and each read asks for limit + 1 rows, so a page
// never repeats or skips a post and no read scans the table. Pending and
// hidden rows never leave the database. `trending_posts` is service-key only
// (supabase/108), so this route is the only way the list gets out. If the
// read fails on the FIRST page it serves the compiled seed so the section
// never blanks; a failed continuation is an error, never the seed appended.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { FALLBACK_TRENDING, TRENDING_MAX, TRENDING_PAGE, type TrendingPost } from '@/app/xcreate/trending'
import { afterBranches, decodeCursor, encodeCursor, keyOf, toPostgrestOr, type FeedKind } from '@/lib/trending-cursor'

const HEADERS = { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600' }

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams
  const kindParam = q.get('kind')
  const kind: FeedKind = kindParam === 'image' ? 'image' : kindParam === 'all' ? 'all' : 'video'
  const asked = Math.floor(Number(q.get('limit')))
  const limit = Math.min(TRENDING_MAX, Number.isFinite(asked) && asked >= 1 ? asked : TRENDING_PAGE)
  const rawCursor = q.get('cursor')
  const after = rawCursor ? decodeCursor(rawCursor, kind) : null
  if (rawCursor && !after) return NextResponse.json({ error: 'invalid cursor' }, { status: 400 })

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false },
  })
  let query = sb.from('trending_posts')
    .select('platform, post_id, handle, url, kind, models, likes, summary, prompt, preset, week, rank')
    .eq('status', 'live')
  if (kind !== 'all') query = query.eq('kind', kind)
  if (after) query = query.or(toPostgrestOr(afterBranches(after)))
  const { data, error } = await query
    .order('week', { ascending: false })
    .order('rank', { ascending: true, nullsFirst: false })
    .order('likes', { ascending: false, nullsFirst: false })
    .order('platform', { ascending: true })
    .order('post_id', { ascending: true })
    .limit(limit + 1)

  if (error) {
    console.warn(`[trending] read failed${after ? ' on a continuation' : ', serving the seed'}: ${error.message}`)
    if (after) return NextResponse.json({ error: 'trending unavailable' }, { status: 503 })
    const seed = FALLBACK_TRENDING.filter(p => kind === 'all' || p.kind === kind).slice(0, limit)
    return NextResponse.json({ posts: seed, nextCursor: null }, { headers: HEADERS })
  }

  const rows = data ?? []
  const page = rows.slice(0, limit)
  const posts: TrendingPost[] = page.map(r => ({
    platform: r.platform, postId: r.post_id, handle: r.handle, url: r.url, kind: r.kind,
    models: r.models ?? [], likes: r.likes, summary: r.summary ?? {},
    prompt: r.prompt ?? null, preset: r.preset ?? null,
  }))
  const nextCursor = rows.length > limit ? encodeCursor(keyOf(page[page.length - 1]), kind) : null
  return NextResponse.json({ posts, nextCursor }, { headers: HEADERS })
}
