// app/api/credits/ensure-daily/route.ts
//
// Idempotent endpoint that grants the user's daily $1 free credit if
// they haven't claimed it yet today (UTC). Hit from the Nav on every
// authenticated page load so the grant fires even when the user just
// opens the site without running a duel / xcreate / fresh OAuth.
//
// The underlying grant_daily_credits Postgres function is race-safe
// (atomic UPDATE on last_daily_grant_date), so concurrent calls from
// multiple tabs collapse to a single grant.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { createSupabaseServer } from '@/lib/supabase-server'
import { ensureDailyGrant } from '@/lib/credits'

const LOG = '[api/credits/ensure-daily]'

export async function POST() {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) {
    return Response.json({ ok: false, reason: 'not_authenticated' }, { status: 401 })
  }

  try {
    const balanceCents = await ensureDailyGrant(user.id, 100)
    return Response.json({ ok: true, balanceCents })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`${LOG} grant failed for ${user.id}: ${msg}`)
    // Still 200 — the user isn't blocked on this, and we don't want
    // Nav to surface an error toast for a fire-and-forget call.
    return Response.json({ ok: false, reason: msg })
  }
}
