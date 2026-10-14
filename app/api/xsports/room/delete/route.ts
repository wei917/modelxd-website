// app/api/xsports/room/delete/route.ts — a fan takes back their own message
// (owner, Oct 14: "I can't delete my message"). Hidden for everyone (the row
// stays, so reports on it can still be looked at); the room's open pages are
// told at once. Only the author's own messages; never the commentator's.

export const runtime = 'nodejs'

import { createSupabaseServer } from '@/lib/supabase-server'
import { announceGone, removeOwn, roomMissing } from '@/lib/xsports-room'

export async function POST(req: Request) {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const id = Number(body?.id)
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: 'bad id' }, { status: 400 })
  try {
    const k = await removeOwn(user.id, id)
    if (!k) return Response.json({ error: 'not_yours', code: 'not_yours' }, { status: 404 })
    await announceGone(k, id)
    return Response.json({ ok: true })
  } catch (e: any) {
    return Response.json({ error: roomMissing(e) ? 'room_unavailable' : 'error' }, { status: 503 })
  }
}
