// lib/plans.ts — the monthly plan, in the one place both the page and the
// server read it.
//
// Client-safe on purpose: no secrets, no Stripe calls. The page shows the
// price from here and the checkout route charges from here, so the two cannot
// drift the way a hand-kept client mirror can (DISPLAY_TIERS in
// app/profile/page.tsx exists only because lib/stripe.ts is server-only).
//
// WHAT A MONTH BUYS (owner, Sep 11: "the market please! only extra credits
// bought are permanent"): the price back as credit plus a bonus, ALL of it
// usable only in the month it was paid for. It is spent before any other
// credit and whatever is left expires when the month ends; nothing rolls
// over. That is how Runway, Midjourney and Suno do it. Credit bought as a
// top-up (and welcome or referral credit) never expires, so a light user
// always has a way to pay that loses nothing. (supabase/99)
//
// LOCKED AT SIGNUP. Checkout writes credit_cents and bonus_cents onto the
// Stripe subscription, and every renewal credits those, not the numbers
// below. Changing this file reaches NEW subscribers only, so a launch bonus
// cut back later never quietly shrinks a plan someone is already paying for.
//
// PRICES ARE SET PER CURRENCY, not converted. NT$157.43 reads as a mistake;
// NT$149 reads as a price (owner, Sep 11: NT$149 and ¥749, to match $4.99).
// Every currency buys the same USD credit, so the wallet stays in one unit.
// Amounts are Stripe minor units: TWD is charged as a two-decimal currency
// (149 TWD = 14900), JPY is zero-decimal (¥749 = 749).

export const PLAN = {
  id: 'monthly_499',
  /** The price back as credit each month. Expires with the month. */
  creditCents: 499,
  /** Bonus credit per month. Expires at the end of the month it was paid for.
   *  $2 at launch (owner, Sep 11: "I just started, so I should give more"). */
  bonusCents: 200,
  prices: { usd: 499, twd: 14900, jpy: 749 },
} as const

export type PlanCurrency = keyof typeof PLAN.prices

export const isPlanCurrency = (c: unknown): c is PlanCurrency =>
  typeof c === 'string' && Object.prototype.hasOwnProperty.call(PLAN.prices, c)

/** Taiwan and Japan are the target markets; everyone else pays in USD. */
export function currencyForCountry(country: string | null | undefined): PlanCurrency {
  const cc = String(country ?? '').toUpperCase()
  if (cc === 'TW') return 'twd'
  if (cc === 'JP') return 'jpy'
  return 'usd'
}

export function planPriceLabel(cur: PlanCurrency): string {
  if (cur === 'twd') return `NT$${PLAN.prices.twd / 100}`
  if (cur === 'jpy') return `¥${PLAN.prices.jpy}`
  return `$${(PLAN.prices.usd / 100).toFixed(2)}`
}
