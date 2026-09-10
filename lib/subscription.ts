// lib/subscription.ts — the monthly plan's server half: Stripe events in,
// subscription rows and wallet grants out. Server-only (service role).
//
// Every grant goes through ONE function, grantForInvoice(), keyed on the
// Stripe invoice id, and the database refuses a second grant for the same
// invoice (unique index in supabase/98_subscriptions.sql). That is what lets
// two events deliver the same month safely. The first month is granted from
// checkout.session.completed AND from invoice.paid, because the checkout
// event is already enabled on the webhook endpoint while invoice.paid has to
// be switched on by hand. Whichever lands first grants; the other finds the
// ledger row and does nothing.
//
// Stripe moved subscription fields between API versions (2025-03-31 "basil"
// put the subscription under invoice.parent and the period under the
// subscription ITEM). This codebase never pins Stripe-Version, so it gets the
// account default, whichever that is. Both shapes are read below instead of
// guessing which one is in force.

import { createClient } from '@supabase/supabase-js'
import { PLAN, isPlanCurrency } from './plans'
import { fetchSubscription, fetchInvoice } from './stripe'
import { grantSubscriptionPeriod } from './credits'

const LOG = '[subscription]'

/** Stripe statuses in which the plan is still the customer's. */
const LIVE = ['active', 'trialing', 'past_due']
export const isLive = (status: unknown) => LIVE.includes(String(status))

function svc() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } })
}

const idOf = (x: any): string | null => (typeof x === 'string' ? x : x?.id ?? null)
const iso = (sec: unknown) => (typeof sec === 'number' && sec > 0 ? new Date(sec * 1000).toISOString() : null)

export const subscriptionIdOfInvoice = (inv: any): string | null =>
  idOf(inv?.subscription) ?? idOf(inv?.parent?.subscription_details?.subscription)
const invoiceMeta = (inv: any): Record<string, string> =>
  inv?.subscription_details?.metadata ?? inv?.parent?.subscription_details?.metadata ?? {}
/** A whole-cent amount from Stripe metadata (always a string there), or
 *  null when absent or out of range. Metadata can be edited by hand in the
 *  Stripe dashboard, so it is bounded rather than trusted. */
const metaCents = (v: unknown, min: number, max: number): number | null => {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return Number.isInteger(n) && n >= min && n <= max ? n : null
}
const subPeriodEnd = (s: any): number | null =>
  s?.current_period_end ?? s?.items?.data?.[0]?.current_period_end ?? null

/** Mirror a Stripe subscription onto our row (one row per user). */
export async function recordSubscription(s: any, userIdHint?: string | null): Promise<void> {
  const userId = s?.metadata?.user_id ?? userIdHint
  if (!s?.id || !userId) { console.warn(`${LOG} subscription ${s?.id} has no user_id`); return }
  const db = svc()
  const { data: existing } = await db.from('subscriptions')
    .select('stripe_subscription_id, status').eq('user_id', userId).maybeSingle()
  // A late event about an OLD subscription must not overwrite a newer live
  // one: someone cancels, resubscribes, and then the old one's `deleted`
  // arrives. Without this their new plan would read as canceled.
  if (existing && existing.stripe_subscription_id !== s.id && isLive(existing.status) && !isLive(s.status)) {
    console.log(`${LOG} ignoring ${s.status} for old subscription ${s.id}; ${existing.stripe_subscription_id} is live`)
    return
  }
  const { error } = await db.from('subscriptions').upsert({
    user_id: userId,
    stripe_customer_id: idOf(s.customer),
    stripe_subscription_id: s.id,
    plan: s?.metadata?.plan ?? PLAN.id,
    status: String(s.status),
    currency: String(s.currency ?? ''),
    cancel_at_period_end: !!s.cancel_at_period_end,
    current_period_end: iso(subPeriodEnd(s)),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })
  if (error) throw new Error(`recordSubscription: ${error.message}`)
}

/** Credit one paid month. Idempotent per invoice (see the file header). */
export async function grantForInvoice(inv: any): Promise<{ granted: boolean; reason?: string }> {
  const subId = subscriptionIdOfInvoice(inv)
  if (!inv?.id || !subId) return { granted: false, reason: 'not a subscription invoice' }
  if (inv.status !== 'paid') return { granted: false, reason: `invoice ${inv.status}` }
  // A $0 invoice (a trial, a 100% coupon) buys no month of credit.
  if (!(Number(inv.amount_paid) > 0)) return { granted: false, reason: 'nothing paid' }
  const cur = String(inv.currency ?? '').toLowerCase()
  if (!isPlanCurrency(cur)) {
    console.error(`${LOG} invoice ${inv.id} is in ${cur}, which the plan does not price`)
    return { granted: false, reason: 'currency' }
  }
  if (inv.amount_paid !== PLAN.prices[cur]) {
    // Not refused: tax or a later price change moves the total, and a paying
    // subscriber receiving nothing is the worse failure. Logged to be seen.
    console.warn(`${LOG} invoice ${inv.id} paid ${inv.amount_paid} ${cur}; plan price is ${PLAN.prices[cur]}`)
  }

  const meta = invoiceMeta(inv)
  let userId: string | null = meta.user_id ?? null
  let plan: string | null = meta.plan ?? null
  let locked: Record<string, string> = meta
  let periodEnd: number | null = inv?.lines?.data?.[0]?.period?.end ?? null
  if (!userId || !plan || !periodEnd || meta.bonus_cents === undefined) {
    const s = await fetchSubscription(subId)
    userId = userId ?? s?.metadata?.user_id ?? null
    plan = plan ?? s?.metadata?.plan ?? null
    periodEnd = periodEnd ?? subPeriodEnd(s)
    locked = { ...(s?.metadata ?? {}), ...meta }
  }
  // What THIS subscriber signed up for, written at checkout (lib/stripe.ts).
  // PLAN is only the fallback, for a subscription that carries no amounts.
  const creditCents = metaCents(locked.credit_cents, 1, 100_000) ?? PLAN.creditCents
  const bonusCents = metaCents(locked.bonus_cents, 0, 100_000) ?? PLAN.bonusCents
  // Only OUR plan's invoices buy this credit. Anything else billed through the
  // same Stripe account is none of this function's business.
  if (plan !== PLAN.id) return { granted: false, reason: `not this plan (${plan})` }
  if (!userId) {
    console.error(`${LOG} invoice ${inv.id}: no user on subscription ${subId}`)
    return { granted: false, reason: 'no user' }
  }

  const res = await grantSubscriptionPeriod({
    userId,
    invoiceId: inv.id,
    paidCents: creditCents,
    bonusCents,
    // The bonus lives exactly as long as the month it was paid for.
    bonusExpiresAt: new Date((periodEnd ?? Math.floor(Date.now() / 1000) + 31 * 86400) * 1000),
    metadata: { stripe_subscription: subId, currency: cur, amount_paid: inv.amount_paid, billing_reason: inv.billing_reason ?? null },
  })
  console.log(`${LOG} invoice ${inv.id}: ${res.granted ? `granted ${creditCents}+${bonusCents}¢ to ${userId}` : 'already granted'}`)
  return res
}

/**
 * The webhook's plan branch. Returns null for events that are not about the
 * plan, so the top-up and card-verification code runs exactly as before.
 */
export async function handleSubscriptionEvent(event: any): Promise<Response | null> {
  const obj = event?.data?.object
  try {
    if (event?.type === 'checkout.session.completed' && obj?.mode === 'subscription') {
      const subId = idOf(obj.subscription)
      const sub = subId ? await fetchSubscription(subId) : null
      if (sub) await recordSubscription(sub, obj.metadata?.user_id)
      // The session names its first invoice; the subscription's latest_invoice
      // is the same invoice by another road. Both are read because this path
      // is the ONLY one that credits month one while invoice.paid is not
      // enabled on the endpoint (it was not, checked Sep 10), and a paying
      // subscriber whose first month silently never arrives is the failure
      // this whole file exists to prevent.
      const invId = idOf(obj.invoice) ?? idOf(sub?.latest_invoice)
      const r = invId ? await grantForInvoice(await fetchInvoice(invId)) : { granted: false, reason: 'no invoice yet' }
      return Response.json({ received: true, handled: true, ...r })
    }
    if (event?.type === 'invoice.paid') {
      const r = await grantForInvoice(obj)
      // A paid renewal moved the period on; refresh the row's renewal date.
      const subId = subscriptionIdOfInvoice(obj)
      if (subId && r.reason !== 'not a subscription invoice' && !String(r.reason ?? '').startsWith('not this plan')) {
        await recordSubscription(await fetchSubscription(subId))
      }
      return Response.json({ received: true, handled: true, ...r })
    }
    if (typeof event?.type === 'string' && event.type.startsWith('customer.subscription.')) {
      if (obj?.metadata?.plan && obj.metadata.plan !== PLAN.id) return Response.json({ received: true, handled: false })
      await recordSubscription(obj)
      return Response.json({ received: true, handled: true })
    }
  } catch (err: any) {
    // Non-2xx makes Stripe retry. The grant is idempotent, so a retry after a
    // half-finished attempt cannot pay a month twice.
    console.error(`${LOG} ${event?.type} failed:`, err?.message ?? err)
    return new Response(`subscription handling failed: ${err?.message ?? err}`, { status: 500 })
  }
  return null
}
