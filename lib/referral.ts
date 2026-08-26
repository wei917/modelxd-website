// lib/referral.ts — referral credits (server-only; uses the service role).
//
//   any new user      $10  at signup                  (68_welcome_credit)
//   referred user (B) +$5  when B binds a card        -> $15
//   referrer     (A)  $5   when B binds a card
//
// See supabase/87_referrals.sql for why the card, and not the Google account,
// is what proves one real person.

import { createClient } from '@supabase/supabase-js'
import { grantCredits } from './credits'

export const REFEREE_BONUS_CENTS = 500
export const REFERRER_BONUS_CENTS = 500
/** Alert threshold, not a cap: a real influencer must never be throttled. */
export const WEEKLY_ALERT_CENTS = 50_000

const LOG = '[referral]'

function service() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } })
}

/** Ambiguous characters are omitted: these get typed by hand off a phone screen. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join('')
}

/** The user's code, minted on first ask. */
export async function getOrCreateCode(userId: string): Promise<string> {
  const sb = service()
  const { data } = await sb.from('referral_codes').select('code').eq('user_id', userId).maybeSingle()
  if (data?.code) return data.code
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode()
    const { error } = await sb.from('referral_codes').insert({ user_id: userId, code })
    if (!error) return code
    // 23505 = someone else just took this code; try another.
    if ((error as any).code !== '23505') throw new Error(`${LOG} mint failed: ${error.message}`)
    const { data: mine } = await sb.from('referral_codes').select('code').eq('user_id', userId).maybeSingle()
    if (mine?.code) return mine.code
  }
  throw new Error(`${LOG} could not mint a unique code`)
}

/**
 * Attach a new signup to the code they arrived with. Records the pending
 * referral only — no credit moves until a card is bound.
 *
 * Refuses silently (returns a reason) rather than throwing: a bad or expired
 * code must never break someone's signup.
 */
export async function claimReferral(refereeId: string, code: string, signals: {
  emailDomain?: string | null
  ip?: string | null
} = {}): Promise<{ ok: boolean; reason?: string }> {
  const sb = service()
  const clean = code.trim().toUpperCase()
  if (!/^[A-Z0-9]{6,16}$/.test(clean)) return { ok: false, reason: 'bad_code' }

  const { data: owner } = await sb.from('referral_codes').select('user_id').eq('code', clean).maybeSingle()
  if (!owner) return { ok: false, reason: 'unknown_code' }
  if (owner.user_id === refereeId) return { ok: false, reason: 'self' }

  // An account is referred once, by one person, forever (UNIQUE on referee_id).
  const { error } = await sb.from('referrals').insert({
    referrer_id: owner.user_id,
    referee_id: refereeId,
    code: clean,
    referee_email_domain: signals.emailDomain ?? null,
    referee_signup_ip: signals.ip ?? null,
  })
  if (error) {
    if ((error as any).code === '23505') return { ok: false, reason: 'already_referred' }
    console.warn(`${LOG} claim failed: ${error.message}`)
    return { ok: false, reason: 'error' }
  }
  return { ok: true }
}

/**
 * A card was bound. Pays BOTH sides if this fingerprint has never funded a
 * referral and has never been seen on another account.
 *
 * Called from the Stripe webhook (setup_intent.succeeded) — never from the
 * client, which could otherwise pay itself by claiming a binding happened.
 */
export async function onCardBound(userId: string, fingerprint: string): Promise<{ paid: boolean; reason?: string }> {
  const sb = service()

  // Remember the card first, so an ordinary account funding with a card also
  // burns that fingerprint for referral purposes.
  await sb.from('payment_fingerprints').upsert({ fingerprint, user_id: userId }, { onConflict: 'fingerprint,user_id' })

  const { data: ref } = await sb.from('referrals')
    .select('id, referrer_id, referee_id, status')
    .eq('referee_id', userId).maybeSingle()
  if (!ref) return { paid: false, reason: 'no_referral' }
  if (ref.status !== 'pending') return { paid: false, reason: `already_${ref.status}` }

  // Has this card ever been seen on a DIFFERENT account?
  const { data: seen } = await sb.from('payment_fingerprints')
    .select('user_id').eq('fingerprint', fingerprint).neq('user_id', userId).limit(1)
  const reused = (seen ?? []).length > 0

  if (reused) {
    await sb.from('referrals').update({
      status: 'rejected', rejected_reason: 'card_already_used', card_fingerprint: fingerprint,
    }).eq('id', ref.id)
    console.log(`${LOG} rejected ${ref.id}: fingerprint already on another account`)
    return { paid: false, reason: 'card_already_used' }
  }

  // Mark paid FIRST: the partial unique index on (card_fingerprint) where
  // status='paid' is what makes "one card, one bonus" true even if two
  // bindings land at the same instant. Credits are granted only if this wins.
  const { error: claimErr } = await sb.from('referrals').update({
    status: 'paid', card_fingerprint: fingerprint, paid_at: new Date().toISOString(),
  }).eq('id', ref.id).eq('status', 'pending')
  if (claimErr) {
    console.log(`${LOG} rejected ${ref.id}: ${claimErr.message}`)
    await sb.from('referrals').update({ status: 'rejected', rejected_reason: 'card_race' }).eq('id', ref.id)
    return { paid: false, reason: 'card_already_used' }
  }

  await grantCredits({
    userId: ref.referee_id, amountCents: REFEREE_BONUS_CENTS, kind: 'grant',
    referenceType: 'referral', referenceId: ref.id, description: 'Referral bonus (card verified)',
  })
  await grantCredits({
    userId: ref.referrer_id, amountCents: REFERRER_BONUS_CENTS, kind: 'grant',
    referenceType: 'referral', referenceId: ref.id, description: 'Referral reward',
  })
  console.log(`${LOG} paid ${ref.id}: ${REFEREE_BONUS_CENTS + REFERRER_BONUS_CENTS}c across both sides`)

  void weeklyAlert()
  return { paid: true }
}

/** Logs when the week's referral spend passes the threshold. Alert, never a cap. */
async function weeklyAlert(): Promise<void> {
  try {
    const sb = service()
    const since = new Date(Date.now() - 7 * 864e5).toISOString()
    const { count } = await sb.from('referrals')
      .select('id', { count: 'exact', head: true }).eq('status', 'paid').gte('paid_at', since)
    const cents = (count ?? 0) * (REFEREE_BONUS_CENTS + REFERRER_BONUS_CENTS)
    if (cents >= WEEKLY_ALERT_CENTS) {
      console.warn(`${LOG} ALERT: $${(cents / 100).toFixed(2)} of referral credits in the last 7 days (${count} referrals)`)
    }
  } catch { /* an alert must never fail a payout */ }
}

export async function referralSummary(userId: string) {
  const sb = service()
  const [{ data: rows }, code] = await Promise.all([
    sb.from('referrals').select('status, created_at, paid_at').eq('referrer_id', userId),
    getOrCreateCode(userId),
  ])
  const list = rows ?? []
  return {
    code,
    pending: list.filter(r => r.status === 'pending').length,
    paid: list.filter(r => r.status === 'paid').length,
    earnedCents: list.filter(r => r.status === 'paid').length * REFERRER_BONUS_CENTS,
  }
}
