// lib/duel-quota.ts
//
// Free XDuel daily quota. XDuel is on the house — ModelXD pays the
// provider bills — so usage is capped to prevent abuse, especially on
// video duels which run $1–2 a pop. The allowance itself (10 a day across
// every type, video included) is in lib/duel-allowance.ts; duel_quotas
// keeps a counter per type (supabase/40_duel_quotas.sql).

import { createClient } from '@supabase/supabase-js'
import { duelsLeft, type DuelMode, type DuelUsed } from './duel-allowance'

export type { DuelMode }

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  )
}

/**
 * Atomically consume `cost` daily duel quota slots for the given mode
 * (every duel is 1v1 and costs 1 since Oct 18 — lib/duel-allowance.ts).
 * Returns the new count after increment, or -1 if the user is at/over
 * the cap (no row was modified). Throws on RPC failure.
 */
export async function consumeDuelQuota(userId: string, mode: DuelMode, cost = 1): Promise<number> {
  const sb = serviceClient()
  // The SQL caps one type's counter; the allowance spans all three. So the
  // cap passed is this type's count plus what the whole day still allows.
  // Two requests for DIFFERENT types at the same instant can each read the
  // other's old count and both pass (one extra duel at most per race);
  // same-type requests stay atomic in the SQL.
  const used = await readDuelUsed(userId)
  const { data, error } = await sb.rpc('consume_duel_quota', {
    p_user_id: userId,
    p_mode:    mode,
    p_limit:   used[mode] + duelsLeft(mode, used),
    p_cost:    cost,
  })
  if (error) throw new Error(`consumeDuelQuota failed: ${error.message}`)
  return data as number
}

/** Today's (UTC) duels per type for one user; zeros when none or unreadable. */
export async function readDuelUsed(userId: string): Promise<DuelUsed> {
  const today = new Date().toISOString().slice(0, 10)
  const { data, error } = await serviceClient()
    .from('duel_quotas')
    .select('text_used, image_used, video_used')
    .eq('user_id', userId)
    .eq('quota_date', today)
    .maybeSingle()
  if (error) console.warn(`readDuelUsed failed: ${error.message}`)
  return { text: data?.text_used ?? 0, image: data?.image_used ?? 0, video: data?.video_used ?? 0 }
}

/**
 * Undo a quota consumption, e.g. when the duel itself failed mid-flight.
 * Decrements the counter floored at 0 so users aren't billed for a duel
 * we never actually ran.
 */
export async function refundDuelQuota(userId: string, mode: DuelMode, cost = 1): Promise<void> {
  const sb = serviceClient()
  const { error } = await sb.rpc('refund_duel_quota', {
    p_user_id: userId,
    p_mode:    mode,
    p_cost:    cost,
  })
  if (error) console.warn(`refundDuelQuota failed: ${error.message}`)
}
