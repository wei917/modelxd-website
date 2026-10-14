// app/api/xsports/room/report/route.ts — report a message in a live room,
// a fan's or the AI commentator's (owner, Oct 14: "we cannot delete AI
// message, can we report?"), with why (the page's dialog: a reason from a
// fixed list, optional words; supabase/133). One report per person per
// message; enough reports hide it (REPORTS_TO_HIDE), and the room's open
// pages are told.
//   POST { id, reason, details? }

export const runtime = 'nodejs'

import { createSupabaseServer } from '@/lib/supabase-server'
import { announceGone, report, roomMissing, roomOf, REPORT_DETAILS_MAX, REPORT_REASONS, type ReportReason } from '@/lib/xsports-room'

export async function POST(req: Request) {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const id = Number(body?.id)
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: 'bad id' }, { status: 400 })
  const reason = (REPORT_REASONS as readonly string[]).includes(body?.reason) ? (body.reason as ReportReason) : null
  if (!reason) return Response.json({ error: 'reason_required', code: 'reason_required' }, { status: 400 })
  const details = typeof body?.details === 'string' ? body.details.replace(/\s+/g, ' ').trim().slice(0, REPORT_DETAILS_MAX) || null : null
  try {
    const hidden = await report(user.id, id, { reason, details })
    if (hidden) { const k = await roomOf(id); if (k) await announceGone(k, id) }
    return Response.json({ hidden })
  } catch (e: any) {
    return Response.json({ error: roomMissing(e) ? 'room_unavailable' : 'error' }, { status: 503 })
  }
}
