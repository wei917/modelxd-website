// app/api/xoracle/wall/tie/route.ts — tie a stick outside 觀音廟 (Oct 22;
// docs/GUANYIN-HANGING-PLAN.md). Free, signed in, one tie per visit.
//
//   POST { readingId, lang }   the stick of that visit goes on the wall for
//        30 days. The visit is read with the caller's own session (RLS: own
//        rows only); its number and edition come from the visit and its grade
//        from the corpus on disk, never from the body. Only those three, the
//        page language and the time go up.
//
// A second tie of the same visit answers the first one (`already`).

export const runtime = 'nodejs'

import { createSupabaseServer } from '@/lib/supabase-server'
import { xoracleAdmin, dailyMissing } from '@/lib/xoracle-admin'
import { qianOf, validQian, asQianEdition } from '@/lib/xoracle'
import { WALL_TEMPLE, MINE_COLUMNS, STICK_DAYS, TIES_PER_DAY, asWallLang, myItem } from '@/lib/xoracle-wall'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const refuse = (code: string, error: string, status = 400) => Response.json({ error, code }, { status })
const DAY = 86_400_000

export async function POST(req: Request) {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return refuse('sign_in', 'Unauthorized', 401)
  const body = await req.json().catch(() => null)
  const readingId = body?.readingId
  if (typeof readingId !== 'string' || !UUID.test(readingId)) return refuse('tie_bad_input', 'bad visit')

  const { data: visit } = await sb.from('xtell_readings').select('temple, subject, chart')
    .eq('id', readingId).eq('user_id', user.id).is('deleted_at', null).maybeSingle()
  if (!visit || (visit as any).temple !== WALL_TEMPLE) return refuse('tie_no_visit', 'no such visit', 404)
  const subject = (visit as any).subject ?? {}
  const edition = asQianEdition(subject.edition ?? (visit as any).chart?.edition)
  const n = Number(subject.n)
  if (!validQian(n, WALL_TEMPLE, edition)) return refuse('tie_no_visit', 'the visit has no stick', 404)
  const q = qianOf(n, WALL_TEMPLE, edition)
  if (!q) return refuse('tie_no_visit', 'stick not in corpus', 500)

  const admin = xoracleAdmin()
  const mine = () => admin.from('xoracle_hangings').select(MINE_COLUMNS).eq('user_id', user.id).eq('reading_id', readingId).eq('kind', 'stick').maybeSingle()
  const { data: before, error: readErr } = await mine()
  if (readErr) return dailyMissing(readErr) ? refuse('wall_unavailable', 'the wall is not ready', 503) : refuse('tie_failed', 'tie failed', 500)
  if (before) return Response.json({ item: myItem(before), already: true })

  const since = new Date(Date.now() - DAY).toISOString()
  const { count } = await admin.from('xoracle_hangings').select('id', { count: 'exact', head: true })
    .eq('user_id', user.id).eq('kind', 'stick').gte('created_at', since)
  if ((count ?? 0) >= TIES_PER_DAY) return refuse('tie_daily_limit', 'too many ties today', 429)

  const now = Date.now()
  const { data, error } = await admin.from('xoracle_hangings').insert({
    kind: 'stick', temple: WALL_TEMPLE, user_id: user.id, reading_id: readingId,
    edition, stick_no: n, luck: typeof q.luck === 'string' ? q.luck : '',
    lang: asWallLang(body?.lang), created_at: new Date(now).toISOString(), down_at: new Date(now + STICK_DAYS * DAY).toISOString(),
  }).select(MINE_COLUMNS).single()
  if (error) {
    // Two taps at once: the unique index kept one; answer it.
    if ((error as any).code === '23505') { const { data: row } = await mine(); if (row) return Response.json({ item: myItem(row), already: true }) }
    console.error('[xoracle/wall/tie]', error.message)
    return dailyMissing(error) ? refuse('wall_unavailable', 'the wall is not ready', 503) : refuse('tie_failed', 'tie failed', 500)
  }
  return Response.json({ item: myItem(data) })
}
