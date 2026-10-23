// app/api/xoracle/wall/report/route.ts — report a wish plaque outside 觀音廟
// (Oct 22; docs/GUANYIN-HANGING-PLAN.md). Signed in, one report per person
// per plaque, never one's own; at 3 the plaque is hidden from everyone but
// its writer (xoracle_report_hanging, supabase/151, under the row lock).
//
//   POST { id, reason, details? }   reason from REPORT_REASONS.

export const runtime = 'nodejs'

import { createSupabaseServer } from '@/lib/supabase-server'
import { xoracleAdmin, dailyMissing } from '@/lib/xoracle-admin'
import { asReason } from '@/lib/xoracle-wall'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const refuse = (code: string, error: string, status = 400) => Response.json({ error, code }, { status })

export async function POST(req: Request) {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return refuse('sign_in', 'Unauthorized', 401)
  const body = await req.json().catch(() => null)
  const id = body?.id, reason = asReason(body?.reason)
  const details = typeof body?.details === 'string' ? body.details.trim().slice(0, 300) : ''
  if (typeof id !== 'string' || !UUID.test(id) || !reason) return refuse('report_bad_input', 'bad report')

  const { data, error } = await xoracleAdmin().rpc('xoracle_report_hanging', { p_id: id, p_user: user.id, p_reason: reason, p_details: details || null })
  if (error) {
    const code = (error as any).code
    if (code === 'P0002') return refuse('report_not_found', 'no such plaque', 404)
    if (code === '22023') return refuse('report_own', 'that is your own plaque')
    if (code === '23514') return refuse('report_bad_input', 'bad report')
    console.error('[xoracle/wall/report]', error.message)
    return dailyMissing(error) ? refuse('wall_unavailable', 'the wall is not ready', 503) : refuse('report_failed', 'report failed', 500)
  }
  const row = Array.isArray(data) ? data[0] : data
  return Response.json({ reported: true, hidden: !!row?.is_hidden })
}
