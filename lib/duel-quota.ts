// lib/duel-quota.ts
//
// Free XDuel daily quotas per user/mode. XDuel is on the house —
// ModelXD pays the provider bills — so we cap usage to prevent abuse,
// especially on video duels which run $1–2 a pop.

import { createClient } from '@supabase/supabase-js'

export type DuelMode = 'text' | 'image' | 'video'

// Defaults live here, not in SQL, so tuning them is a one-line change.
// Per-mode because video is 100× more expensive than text.
export const DUEL_LIMITS: Record<DuelMode, number> = {
  text:  10,
  image:  3,
  video:  1,
}

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  )
}

/**
 * Atomically consume one daily duel quota slot for the given mode.
 * Returns the new count after increment, or -1 if the user is at/over
 * the cap (no row was modified). Throws on RPC failure.
 */
export async function consumeDuelQuota(userId: string, mode: DuelMode): Promise<number> {
  const sb = serviceClient()
  const { data, error } = await sb.rpc('consume_duel_quota', {
    p_user_id: userId,
    p_mode:    mode,
    p_limit:   DUEL_LIMITS[mode],
  })
  if (error) throw new Error(`consumeDuelQuota failed: ${error.message}`)
  return data as number
}

/**
 * Undo a quota consumption, e.g. when the duel itself failed mid-flight.
 * Decrements the counter floored at 0 so users aren't billed for a duel
 * we never actually ran.
 */
export async function refundDuelQuota(userId: string, mode: DuelMode): Promise<void> {
  const sb = serviceClient()
  const { error } = await sb.rpc('refund_duel_quota', {
    p_user_id: userId,
    p_mode:    mode,
  })
  if (error) console.warn(`refundDuelQuota failed: ${error.message}`)
}
