// app/api/xtell/daily/followup/route.ts — open a paid follow-up about one of
// today's readings: the visit row the reading route appends to, created (or
// reused while nothing has been asked in it) by xtell_daily_followup. The row
// names the day's reading by id; the reading route loads that reading's
// stored basis itself, bound to the same user, so the teacher sees exactly
// what the visitor saw (Codex review) and nothing a client sent.

export const runtime = 'nodejs'

import { createSupabaseServer } from '@/lib/supabase-server'
import { xtellAdmin, dailyMissing } from '@/lib/xtell-admin'

export async function POST(req: Request) {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const id = typeof body?.dailyId === 'string' && /^[0-9a-f-]{36}$/i.test(body.dailyId) ? body.dailyId : null
  if (!id) return Response.json({ error: 'bad daily id', code: 'daily_missing' }, { status: 400 })
  // One transaction under the profile lock (supabase/109): a delete racing
  // this cannot leave a fresh follow-up behind (Codex review).
  const { data, error } = await xtellAdmin().rpc('xtell_daily_followup', { p_user: user.id, p_daily: id })
  if (error) return dailyMissing(error) ? Response.json({ error: 'daily_unavailable' }, { status: 503 }) : Response.json({ error: 'followup_failed' }, { status: 500 })
  if (typeof data !== 'string') return Response.json({ error: 'no such reading', code: 'daily_missing' }, { status: 404 })
  return Response.json({ readingId: data })
}
