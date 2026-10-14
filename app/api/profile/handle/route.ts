// app/api/profile/handle/route.ts — the signed-in account's @ID (supabase/132).
//   GET            → { handle, nextChangeAt } (assigned first if it had none),
//                    or { handle: null } before migration 132
//   GET ?check=id  → { ok: true, handle } when this account may take it, or
//                    { ok: false, error } (handle_short / _long / _chars /
//                    _reserved / _taken); for the as-you-type check
// Changing it goes through POST /api/profile/face with the name and picture.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { createSupabaseServer } from '@/lib/supabase-server'
import { checkHandle } from '@/lib/handle'
import { ensureHandle, handleAvailable } from '@/lib/profile-handle'
import { isAdminEmail } from '@/lib/admin'

// Checks per person per minute, per server instance: a floor, not a wall.
const RECENT = new Map<string, number[]>()
function tooMany(id: string): boolean {
  const now = Date.now()
  const times = (RECENT.get(id) ?? []).filter(t => now - t < 60_000)
  times.push(now)
  RECENT.set(id, times)
  if (RECENT.size > 5000) RECENT.clear()
  return times.length > 60
}

export async function GET(req: Request) {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const check = new URL(req.url).searchParams.get('check')
  if (check === null) {
    const state = await ensureHandle(user.id)
    return Response.json(state ?? { handle: null, nextChangeAt: null })
  }
  if (tooMany(user.id)) return Response.json({ error: 'too_many' }, { status: 429 })
  const checked = checkHandle(check, { admin: isAdminEmail(user.email) })
  if (!checked.ok) return Response.json({ ok: false, error: checked.error })
  const free = await handleAvailable(user.id, checked.handle)
  if (free === null) return Response.json({ error: 'unavailable' }, { status: 503 })
  return Response.json(free ? { ok: true, handle: checked.handle } : { ok: false, error: 'handle_taken' })
}
