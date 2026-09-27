// app/api/trending/route.ts
// Public read of the "Trending on social media" feed (XCreate Studio and
// Templates). Every week's LIVE posts made with models XCreate offers,
// paginated with a keyset cursor:
//
//   GET /api/trending?kind=video|image|all&limit=10&cursor=<opaque>
//   -> { posts, nextCursor }   (nextCursor null at the end)
//
// Until Sep 27 it served only the newest week of one kind, so a short week was
// all anyone saw (5 posts) and older weeks never topped it up. The order and
// the "after this cursor" predicate both live in the database
// (lib/trending-cursor.ts), and every read is a bounded batch, so a page never
// repeats or skips a post and no read scans the table. Pending and hidden rows
// never leave the database. `trending_posts` is service-key only
// (supabase/108), so this route is the only way the list gets out.
//
// Only models XCreate offers (owner, Sep 27: "remove midjourney"): a post is
// shown while every model it credits is one XCreate can run, decided on each
// read from the catalog (lib/trending-models.ts), so a model's posts leave and
// come back with it and nothing is deleted. Skipped rows still move the
// cursor. A stored preset whose model or recipe is gone loses its button. An
// unreadable catalog fails closed (503, never cached): the feed doesn't guess
// what XCreate offers. If the posts can't be read on the FIRST page it serves
// the compiled seed, filtered the same way, so the section never blanks; a
// failed continuation is an error, never the seed appended.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { FALLBACK_TRENDING, TRENDING_MAX, TRENDING_PAGE, type TrendingPost } from '@/app/xcreate/trending'
import { afterBranches, decodeCursor, encodeCursor, pageFiltered, toPostgrestOr, type CursorKey, type FeedKind } from '@/lib/trending-cursor'
import { eligibility, loadSupport, presetRunsOn, type Support } from '@/lib/trending-models'

const HEADERS = { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600' }
const NO_STORE = { 'Cache-Control': 'no-store' }
/** Rows read per round trip, and round trips per page: a page examines at
 *  most SCAN × MAX_SCANS rows before it answers with what it found. */
const SCAN = 50
const MAX_SCANS = 8

type Row = {
  platform: string; post_id: string; handle: string; url: string; kind: TrendingPost['kind']
  models: string[] | null; likes: number | null; summary: TrendingPost['summary'] | null
  prompt: string | null; preset: TrendingPost['preset']; week: string; rank: number | null
}

/** The post as served: a preset carries the model it runs on and that model's
 *  catalog name (settings saved without a model get one from the post's
 *  credited names); one no model runs loses its button. */
const served = (p: TrendingPost, support: Support): TrendingPost => {
  const runs = presetRunsOn(p.kind, p.models, p.preset, support)
  return p.preset && runs ? { ...p, preset: { ...p.preset, model: runs.model, modelName: runs.name } } : { ...p, preset: null }
}

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
  let support: Support
  try {
    support = await loadSupport(sb)
  } catch (err) {
    console.warn(`[trending] catalog unreadable, serving nothing: ${(err as Error).message}`)
    return NextResponse.json({ error: 'trending unavailable' }, { status: 503, headers: NO_STORE })
  }
  const eligible = (p: { kind: TrendingPost['kind']; models: string[] | null }) => eligibility(p.kind, p.models ?? [], support).ok

  let page: { rows: Row[]; next: CursorKey | null }
  try {
    page = await pageFiltered<Row>({
      after, limit, scan: SCAN, maxScans: MAX_SCANS, ok: eligible,
      read: async (key, n) => {
        let query = sb.from('trending_posts')
          .select('platform, post_id, handle, url, kind, models, likes, summary, prompt, preset, week, rank')
          .eq('status', 'live')
        if (kind !== 'all') query = query.eq('kind', kind)
        if (key) query = query.or(toPostgrestOr(afterBranches(key)))
        const { data, error } = await query
          .order('week', { ascending: false })
          .order('rank', { ascending: true, nullsFirst: false })
          .order('likes', { ascending: false, nullsFirst: false })
          .order('platform', { ascending: true })
          .order('post_id', { ascending: true })
          .limit(n)
        if (error) throw new Error(error.message)
        return (data ?? []) as Row[]
      },
    })
  } catch (err) {
    console.warn(`[trending] read failed${after ? ' on a continuation' : ', serving the seed'}: ${(err as Error).message}`)
    if (after) return NextResponse.json({ error: 'trending unavailable' }, { status: 503, headers: NO_STORE })
    const seed = FALLBACK_TRENDING.filter(p => (kind === 'all' || p.kind === kind) && eligible(p)).slice(0, limit)
    return NextResponse.json({ posts: seed.map(p => served(p, support)), nextCursor: null }, { headers: HEADERS })
  }

  const posts: TrendingPost[] = page.rows.map(r => served({
    platform: r.platform, postId: r.post_id, handle: r.handle, url: r.url, kind: r.kind,
    models: r.models ?? [], likes: r.likes, summary: r.summary ?? {},
    prompt: r.prompt ?? null, preset: r.preset ?? null,
  }, support))
  return NextResponse.json({ posts, nextCursor: page.next ? encodeCursor(page.next, kind) : null }, { headers: HEADERS })
}
