// app/api/xoracle/wall/route.ts — what hangs outside 觀音廟 (Oct 22;
// docs/GUANYIN-HANGING-PLAN.md, supabase/151, lib/xoracle-wall.ts).
//
//   GET                the wall, for anyone, signed in or not: the newest tied
//                      sticks, a page of wish plaques, and how many of each
//                      are up. Never a user id or a visit; a sealed plaque
//                      comes without its words. Cached briefly at the edge,
//                      so the page adds the viewer's own rows from ?mine=1.
//   GET ?before=<iso>  the next page of plaques, older than that.
//   GET ?mine=1        the caller's own sticks and plaques, with their state
//                      (taken down, hidden, when they come down). Not cached.
//
// The table is server-only; the service key reads it and the query names the
// columns, so nothing else leaves.

export const runtime = 'nodejs'

import { createSupabaseServer } from '@/lib/supabase-server'
import { xoracleAdmin, dailyMissing } from '@/lib/xoracle-admin'
import { isAdminEmail } from '@/lib/admin'
import { WALL_TEMPLE, WALL_COLUMNS, MINE_COLUMNS, PAGE, wallItem, myItem } from '@/lib/xoracle-wall'

const unavailable = () => Response.json({ error: 'the wall is not ready', code: 'wall_unavailable' }, { status: 503 })
const failed = () => Response.json({ error: 'wall read failed', code: 'wall_failed' }, { status: 500 })

export async function GET(req: Request) {
  const url = new URL(req.url)
  const admin = xoracleAdmin()

  if (url.searchParams.get('mine') === '1') {
    const sb = await createSupabaseServer()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return Response.json({ items: [] }, { headers: { 'Cache-Control': 'no-store' } })
    const { data, error } = await admin.from('xoracle_hangings').select(MINE_COLUMNS)
      .eq('user_id', user.id).eq('temple', WALL_TEMPLE).order('created_at', { ascending: false }).limit(100)
    if (error) return dailyMissing(error) ? unavailable() : failed()
    // `admin`: the page then offers 隱藏 on every plaque (the route checks again).
    return Response.json({ items: (data ?? []).map(myItem), admin: isAdminEmail(user.email) }, { headers: { 'Cache-Control': 'no-store' } })
  }

  const now = new Date().toISOString()
  const up = (q: any) => q.eq('temple', WALL_TEMPLE).is('taken_down_at', null).is('hidden_at', null).gt('down_at', now)
  const before = url.searchParams.get('before')
  if (before) {
    if (Number.isNaN(Date.parse(before))) return Response.json({ error: 'bad cursor', code: 'wall_bad_input' }, { status: 400 })
    const { data, error } = await up(admin.from('xoracle_hangings').select(WALL_COLUMNS)).eq('kind', 'wish')
      .lt('created_at', before).order('created_at', { ascending: false }).limit(PAGE)
    if (error) return dailyMissing(error) ? unavailable() : failed()
    const wishes = (data ?? []).map(wallItem)
    return Response.json({ wishes, more: wishes.length === PAGE }, { headers: { 'Cache-Control': 'public, s-maxage=20, stale-while-revalidate=60' } })
  }

  const [sticks, wishes, nSticks, nWishes] = await Promise.all([
    up(admin.from('xoracle_hangings').select(WALL_COLUMNS)).eq('kind', 'stick').order('created_at', { ascending: false }).limit(40),
    up(admin.from('xoracle_hangings').select(WALL_COLUMNS)).eq('kind', 'wish').order('created_at', { ascending: false }).limit(PAGE),
    up(admin.from('xoracle_hangings').select('id', { count: 'exact', head: true })).eq('kind', 'stick'),
    up(admin.from('xoracle_hangings').select('id', { count: 'exact', head: true })).eq('kind', 'wish'),
  ])
  const error = sticks.error ?? wishes.error ?? nSticks.error ?? nWishes.error
  if (error) return dailyMissing(error) ? unavailable() : failed()
  const page = (wishes.data ?? []).map(wallItem)
  return Response.json({
    sticks: (sticks.data ?? []).map(wallItem),
    wishes: page,
    counts: { sticks: nSticks.count ?? 0, wishes: nWishes.count ?? 0 },
    more: page.length === PAGE,
  }, { headers: { 'Cache-Control': 'public, s-maxage=20, stale-while-revalidate=60' } })
}
