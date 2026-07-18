// lib/stripe.ts
//
// Server-only Stripe helpers. We use the REST API directly via fetch so we
// don't need the `stripe` npm package — keeps the dependency tree lean and
// avoids a bundler-incompatible CJS require in Next.js edge-ish contexts.
//
// Env vars:
//   STRIPE_SECRET_KEY        sk_test_... (or sk_live_... in prod)
//   STRIPE_WEBHOOK_SECRET    whsec_...   (from the dashboard endpoint)
//
// Test cards:    4242 4242 4242 4242  any future expiry  any CVC
// Dashboard →   https://dashboard.stripe.com/test/apikeys

import { createHmac, timingSafeEqual } from 'crypto'

// ── Tier catalog ──────────────────────────────────────────────────────────
//
// The user picks a fixed tier; we don't accept arbitrary amounts client-side
// so there's no surface for "buy me $0.01 worth of credits" spam. Each tier
// is a USD-cent amount — the credits granted equal the dollars paid (1¢ = 1¢
// of credit, no bonus logic yet).

export interface CreditTier {
  id:          string
  priceCents:  number
  label:       string
  description: string
}

export const CREDIT_TIERS: CreditTier[] = [
  { id: 'tier_10',  priceCents:  1000, label: '$10',  description: 'Starter' },
  { id: 'tier_20',  priceCents:  2000, label: '$20',  description: 'Most popular' },
  { id: 'tier_100', priceCents: 10000, label: '$100', description: 'Power' },
]

// Custom amounts (the 4th card in the payment screen) are validated
// server-side in the checkout route: whole dollars, $1 minimum, $1000 cap.
export const CUSTOM_MIN_CENTS = 100
export const CUSTOM_MAX_CENTS = 100000

export function getTier(id: string): CreditTier | null {
  return CREDIT_TIERS.find(t => t.id === id) ?? null
}

// ── Low-level Stripe fetch ────────────────────────────────────────────────

function secretKey(): string {
  const k = process.env.STRIPE_SECRET_KEY
  if (!k) throw new Error('lib/stripe: STRIPE_SECRET_KEY is not set')
  return k
}

/**
 * application/x-www-form-urlencoded body builder. Stripe's REST API is
 * form-encoded (not JSON). Nested objects use bracket notation, e.g.
 * `metadata[user_id]=abc`. This helper flattens one level of nesting which
 * is all we need for checkout sessions.
 */
function formEncode(obj: Record<string, unknown>): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue
    if (typeof v === 'object' && !Array.isArray(v)) {
      for (const [kk, vv] of Object.entries(v as Record<string, unknown>)) {
        if (vv === undefined || vv === null) continue
        params.append(`${k}[${kk}]`, String(vv))
      }
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (typeof item === 'object' && item !== null) {
          for (const [kk, vv] of Object.entries(item as Record<string, unknown>)) {
            params.append(`${k}[${i}][${kk}]`, String(vv))
          }
        } else {
          params.append(`${k}[${i}]`, String(item))
        }
      })
    } else {
      params.append(k, String(v))
    }
  }
  return params.toString()
}

async function stripeRequest<T = any>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://api.stripe.com${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formEncode(body),
  })
  const json = await res.json()
  if (!res.ok) {
    const msg = json?.error?.message ?? `Stripe ${res.status}`
    throw new Error(`stripe: ${msg}`)
  }
  return json as T
}

// ── Checkout session ──────────────────────────────────────────────────────

export interface CheckoutSession {
  id:  string
  url: string
}

export interface CreateCheckoutOpts {
  tier:        CreditTier
  /** Account that RECEIVES the credits (the purchaser unless gifting). */
  userId:      string
  userEmail?:  string | null
  /** Set when the purchaser is buying credits for another account —
   *  purchaser's email, recorded in metadata + the ledger description. */
  giftFromEmail?: string | null
  /** Recipient's email, shown on the Stripe line item for gifts. */
  giftToEmail?:   string | null
  successUrl:  string
  cancelUrl:   string
}

/**
 * Create a Stripe-hosted Checkout Session for a credit top-up. The
 * user-facing flow: redirect browser to the returned `url`, Stripe renders
 * its own payment form, on success Stripe sends the user back to
 * `successUrl` AND fires `checkout.session.completed` to our webhook, which
 * is where we actually grant credits (the success redirect is cosmetic —
 * never grant on redirect, always on the webhook).
 */
export async function createCheckoutSession(opts: CreateCheckoutOpts): Promise<CheckoutSession> {
  const body: Record<string, unknown> = {
    mode:                 'payment',
    'payment_method_types[0]': 'card',
    'line_items[0][quantity]': 1,
    'line_items[0][price_data][currency]':     'usd',
    'line_items[0][price_data][unit_amount]':  opts.tier.priceCents,
    'line_items[0][price_data][product_data][name]': opts.giftToEmail
      ? `ModelXD Credits Gift — ${opts.tier.label} for ${opts.giftToEmail}`
      : `ModelXD Credits — ${opts.tier.label}`,
    'line_items[0][price_data][product_data][description]': opts.tier.description,
    success_url:          opts.successUrl,
    cancel_url:           opts.cancelUrl,
    // metadata is what we read in the webhook to know who to credit
    'metadata[user_id]':     opts.userId,
    'metadata[tier_id]':     opts.tier.id,
    'metadata[credit_cents]': opts.tier.priceCents,
  }
  if (opts.giftFromEmail) {
    body['metadata[gift_from]'] = opts.giftFromEmail
  }
  if (opts.userEmail) {
    body.customer_email = opts.userEmail
  }

  const session = await stripeRequest<CheckoutSession>('/v1/checkout/sessions', body)
  return { id: session.id, url: session.url }
}

// ── Webhook signature verification ────────────────────────────────────────
//
// Stripe signs every webhook with the endpoint's signing secret. The header
// looks like:  t=1700000000,v1=abcdef...,v1=...
// Construct the signed payload as `${t}.${rawBody}` and HMAC-SHA256 it with
// the secret, then compare against each v1 signature in constant time.
//
// We implement this by hand to avoid pulling in the `stripe` package just
// for `stripe.webhooks.constructEvent`.

export class StripeWebhookError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StripeWebhookError'
  }
}

/**
 * Verify a Stripe webhook payload and return the parsed event. Throws
 * StripeWebhookError if the signature is missing, malformed, stale, or
 * doesn't match. Caller must pass the RAW request body (NOT the parsed
 * JSON) because the signature is computed over the exact bytes Stripe
 * sent.
 *
 * @param rawBody   request body as a string (await req.text())
 * @param sigHeader value of the `stripe-signature` header
 * @param tolerance max age in seconds (default 5 min; Stripe's default)
 */
export function verifyWebhookSignature(
  rawBody:   string,
  sigHeader: string | null,
  tolerance = 300,
): any {
  if (!sigHeader) throw new StripeWebhookError('missing stripe-signature header')

  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) throw new StripeWebhookError('STRIPE_WEBHOOK_SECRET not set')

  // Parse "t=...,v1=...,v1=..."
  let timestamp = ''
  const signatures: string[] = []
  for (const part of sigHeader.split(',')) {
    const [k, v] = part.split('=')
    if (k === 't') timestamp = v
    if (k === 'v1') signatures.push(v)
  }
  if (!timestamp || signatures.length === 0) {
    throw new StripeWebhookError('malformed stripe-signature header')
  }

  // Reject replays older than `tolerance` seconds.
  const age = Math.floor(Date.now() / 1000) - Number(timestamp)
  if (!Number.isFinite(age) || age > tolerance) {
    throw new StripeWebhookError(`timestamp outside tolerance (age=${age}s)`)
  }

  const signedPayload = `${timestamp}.${rawBody}`
  const expected = createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex')
  const expectedBuf = Buffer.from(expected, 'hex')

  const matches = signatures.some(sig => {
    let sigBuf: Buffer
    try { sigBuf = Buffer.from(sig, 'hex') } catch { return false }
    if (sigBuf.length !== expectedBuf.length) return false
    return timingSafeEqual(sigBuf, expectedBuf)
  })
  if (!matches) throw new StripeWebhookError('signature mismatch')

  try {
    return JSON.parse(rawBody)
  } catch {
    throw new StripeWebhookError('invalid JSON body')
  }
}
