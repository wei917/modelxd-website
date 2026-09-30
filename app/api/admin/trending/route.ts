// app/api/admin/trending/route.ts
// Admin-only actions behind /admin/trending:
//   { action: 'publish', week, ids, seen }
//        the chosen rows of that week go live, ranked by likes per kind (up
//        to TRENDING_LIVE_MAX per kind), and every other row of THAT week is
//        hidden, in ONE transaction (publish_trending_week, supabase/110; the
//        rule is lib/trending-publish.ts). `seen` is every row of the week the
//        page showed: the database refuses when the week holds others, which
//        would be hidden unseen. Other weeks are not touched, on purpose: the
//        feed shows every live week.
//   { action: 'run', kind }  a search now, same code and monthly budget as
//        the Monday cron (paid).

import { NextRequest, NextResponse } from 'next/server'
import { assertAdmin } from '@/lib/admin'
import { runTrending, serviceClient, type TrendKind } from '@/lib/trending-job'
import { TRENDING_LIVE_MAX, TRENDING_MIN_LIKES, meetsLikesBar } from '@/app/xcreate/trending'

export const maxDuration = 800

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** A list of row ids, bounded: the page never shows more than it loads. */
const uuids = (v: unknown, max: number): v is string[] =>
  Array.isArray(v) && v.length <= max && v.every(x => typeof x === 'string' && UUID.test(x))
const ADMIN_ROWS = 1000   // what /admin/trending loads (app/admin/trending/page.tsx)

export async function POST(req: NextRequest) {
  const guard = await assertAdmin()
  if (guard) return guard

  const body = await req.json().catch(() => ({}))
  const sb = serviceClient()

  if (body.action === 'run') {
    const kind: TrendKind = body.kind === 'image' ? 'image' : 'video'
    try {
      return NextResponse.json({ report: await runTrending(kind) })
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 })
    }
  }

  if (body.action === 'publish') {
    const week = String(body.week ?? '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) return NextResponse.json({ error: 'bad week' }, { status: 400 })
    // Bounded input: row uuids, the chosen at most a full week of both kinds.
    if (!uuids(body.ids, 2 * TRENDING_LIVE_MAX)) return NextResponse.json({ error: 'bad ids' }, { status: 400 })
    if (!uuids(body.seen, ADMIN_ROWS)) return NextResponse.json({ error: 'bad seen' }, { status: 400 })

    // The bar: nothing under it goes live, whatever was ticked.
    if (body.ids.length) {
      const { data: chosen, error: readErr } = await sb.from('trending_posts').select('id, likes').in('id', body.ids)
      if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
      const under = (chosen ?? []).filter((r: any) => !meetsLikesBar(r.likes)).length
      if (under) return NextResponse.json({ error: `${under} of the ticked posts ${under === 1 ? 'is' : 'are'} under ${TRENDING_MIN_LIKES} likes (or has no count). Untick ${under === 1 ? 'it' : 'them'}.` }, { status: 409 })
    }

    // Everything else (the week's rows, the per-kind limit, rows not shown)
    // is checked inside the transaction, where nothing can change under it.
    const { data, error } = await sb.rpc('publish_trending_week', {
      p_week: week, p_ids: body.ids, p_seen: body.seen, p_max_live: TRENDING_LIVE_MAX,
    })
    if (error) {
      const refused = /publish_trending_week:/.test(error.message)
      return NextResponse.json({ error: error.message.replace(/^.*publish_trending_week: /, '') }, { status: refused ? 409 : 500 })
    }
    const res = Array.isArray(data) ? data[0] : data
    return NextResponse.json({ live: res?.live ?? 0, hidden: res?.hidden ?? 0 })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
