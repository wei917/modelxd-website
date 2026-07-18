// app/api/stripe/checkout/route.ts
//
// Creates a Stripe Checkout Session for a credit top-up and returns the
// session URL for the client to redirect to.
//
// Flow:
//   1. Client POSTs { tierId } with the user's auth cookie attached.
//   2. We verify auth, look up the tier, build a Checkout Session with
//      metadata.user_id so the webhook knows who to credit.
//   3. Return { url } — client does `window.location.href = url`.
//
// We never grant credits here. Grants only happen in the webhook once
// Stripe confirms payment succeeded.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { getTier, createCheckoutSession, CUSTOM_MIN_CENTS, CUSTOM_MAX_CENTS, type CreditTier } from '@/lib/stripe'
import { createSupabaseServer }            from '@/lib/supabase-server'

interface CheckoutBody {
  tierId?: string
  /** Custom amount in cents — whole dollars, $1–$1000 (validated below). */
  customCents?: number
  /** Gift: email of the account that should RECEIVE the credits. */
  recipientEmail?: string
}

/**
 * Resolve a user id from an email via the GoTrue admin API. `?filter=`
 * does substring matching, so re-check for an exact (case-insensitive)
 * match on the results. Returns null when no account exists.
 */
async function findUserByEmail(email: string): Promise<{ id: string; email: string } | null> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent(email)}`,
    {
      headers: {
        apikey:        process.env.SUPABASE_SECRET_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
      },
      cache: 'no-store',
    },
  )
  if (!res.ok) throw new Error(`user lookup failed (${res.status})`)
  const data = await res.json()
  const users: any[] = data.users ?? (Array.isArray(data) ? data : [])
  const match = users.find(u => (u.email ?? '').toLowerCase() === email.toLowerCase())
  return match ? { id: match.id, email: match.email } : null
}

export async function POST(req: Request) {
  const sb = await createSupabaseServer()
  const { data: { user }, error: authErr } = await sb.auth.getUser()
  if (authErr || !user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: CheckoutBody
  try {
    body = (await req.json()) as CheckoutBody
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  // Resolve the tier: a fixed id, or a validated custom amount.
  let tier: CreditTier | null = null
  if (body.tierId) {
    tier = getTier(body.tierId)
  } else if (body.customCents !== undefined) {
    const cents = Number(body.customCents)
    if (!Number.isInteger(cents) || cents % 100 !== 0) {
      return Response.json({ error: 'custom amount must be whole dollars' }, { status: 400 })
    }
    if (cents < CUSTOM_MIN_CENTS || cents > CUSTOM_MAX_CENTS) {
      return Response.json({ error: `custom amount must be between $${CUSTOM_MIN_CENTS / 100} and $${CUSTOM_MAX_CENTS / 100}` }, { status: 400 })
    }
    tier = { id: 'custom', priceCents: cents, label: `$${cents / 100}`, description: 'Custom top-up' }
  }
  if (!tier) {
    return Response.json({ error: 'unknown tierId' }, { status: 400 })
  }

  // Gift flow: credits land on the RECIPIENT's account, which must
  // already exist — we refuse rather than strand money on an address
  // with no account. The webhook stays completely unchanged: it credits
  // whatever metadata.user_id says.
  let recipient: { id: string; email: string } | null = null
  const giftEmail = body.recipientEmail?.trim().toLowerCase() || null
  if (giftEmail) {
    if (giftEmail === (user.email ?? '').toLowerCase()) {
      return Response.json({ error: "that's your own email — leave the gift field empty to top up yourself" }, { status: 400 })
    }
    try {
      recipient = await findUserByEmail(giftEmail)
    } catch (err) {
      console.error('[stripe/checkout] recipient lookup error:', err)
      return Response.json({ error: 'could not verify the recipient email — try again' }, { status: 500 })
    }
    if (!recipient) {
      return Response.json({ error: `no ModelXD account found for ${giftEmail} — they need to sign up first` }, { status: 400 })
    }
  }

  // Build absolute URLs for the success/cancel redirects. Prefer the
  // request's own origin so it works on localhost, preview, and prod
  // without an env-var per environment. Stripe needs absolute URLs.
  const origin = new URL(req.url).origin

  try {
    const session = await createCheckoutSession({
      tier,
      // Credits go to the recipient for gifts, else the purchaser.
      userId:        recipient?.id ?? user.id,
      // The Stripe receipt still goes to the PURCHASER.
      userEmail:     user.email,
      giftFromEmail: recipient ? (user.email ?? null) : null,
      giftToEmail:   recipient?.email ?? null,
      // {CHECKOUT_SESSION_ID} is a Stripe literal — the hosted flow
      // substitutes the real session id on redirect so the profile page
      // can show "Processing $X top-up…" while the webhook settles.
      successUrl: `${origin}/profile?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl:  `${origin}/profile?checkout=cancel`,
    })
    return Response.json({ url: session.url, sessionId: session.id })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[stripe/checkout] failed:', message)
    return Response.json({ error: message }, { status: 500 })
  }
}
