// app/api/stripe/webhook/route.ts
//
// Stripe webhook handler. This is the ONLY place credits get granted for a
// Stripe purchase — the success_url redirect is cosmetic and must never
// mutate the wallet.
//
// Events we handle:
//   checkout.session.completed — grant credits based on session.metadata
//
// Idempotency:
//   Stripe retries webhooks (up to 3 days) on any non-2xx response, so the
//   same event can arrive twice. Before calling grantCredits we check
//   credit_transactions for an existing row with
//     reference_type='stripe_checkout_session'
//     reference_id=<session.id>
//   If one exists, we 200 with { duplicate: true } and do nothing. This is
//   safer than relying on Stripe's event.id because a single purchase can
//   emit multiple events (session.completed + payment_intent.succeeded) and
//   we want "one grant per session", not "one grant per event".
//
// Signature verification:
//   We read the raw body (NOT parsed JSON) so the signature HMAC matches
//   the bytes Stripe sent. `verifyWebhookSignature` in lib/stripe.ts does
//   the HMAC-SHA256 + timing-safe compare.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { verifyWebhookSignature, StripeWebhookError } from '@/lib/stripe'
import { grantCredits }                               from '@/lib/credits'
import { createClient }                               from '@supabase/supabase-js'

const LOG = '[stripe/webhook]'

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function POST(req: Request) {
  // Raw body is required for signature verification.
  const rawBody = await req.text()
  const sigHeader = req.headers.get('stripe-signature')

  let event: any
  try {
    event = verifyWebhookSignature(rawBody, sigHeader)
  } catch (err) {
    if (err instanceof StripeWebhookError) {
      console.warn(`${LOG} verification failed: ${err.message}`)
      return new Response(`Webhook Error: ${err.message}`, { status: 400 })
    }
    throw err
  }

  console.log(`${LOG} event=${event.type} id=${event.id}`)

  // We only act on checkout.session.completed. Everything else is
  // acknowledged with a 200 so Stripe stops retrying.
  if (event.type !== 'checkout.session.completed') {
    return Response.json({ received: true, handled: false })
  }

  // Card verification (mode:'setup') pays no money and buys no credits — it
  // exists to prove one real person via the card's fingerprint, which is what
  // releases a referral to BOTH sides. Handled here, and only here: a client
  // route that could pay a referral could pay itself. See lib/referral.ts.
  if ((event.data?.object as any)?.mode === 'setup') {
    const setup = event.data.object as any
    const userId = setup?.metadata?.user_id
    const setupIntentId = typeof setup?.setup_intent === 'string' ? setup.setup_intent : setup?.setup_intent?.id
    if (!userId || !setupIntentId) {
      console.warn(`${LOG} setup session without user_id/setup_intent`)
      return Response.json({ received: true, handled: false })
    }
    try {
      const { fetchSetupCard } = await import('@/lib/stripe')
      const { onCardBound } = await import('@/lib/referral')
      const card = await fetchSetupCard(setupIntentId)
      if (!card.fingerprint) {
        console.warn(`${LOG} setup ${setupIntentId} produced no card fingerprint`)
        return Response.json({ received: true, handled: false })
      }
      const res = await onCardBound(userId, card.fingerprint)
      console.log(`${LOG} card verified for ${userId}: ${res.paid ? 'referral paid' : res.reason}`)
      return Response.json({ received: true, handled: true, referral: res })
    } catch (err: any) {
      // Non-2xx makes Stripe retry, which is what we want for a transient fault.
      console.error(`${LOG} card verification failed:`, err?.message ?? err)
      return Response.json({ error: 'card verification failed' }, { status: 500 })
    }
  }

  const session = event.data?.object
  if (!session) {
    console.warn(`${LOG} event has no data.object`)
    return Response.json({ received: true, handled: false })
  }

  const sessionId: string | undefined      = session.id
  const paymentStatus: string | undefined  = session.payment_status
  const amountTotal:   number | undefined  = session.amount_total
  const metadata: Record<string, string>   = session.metadata ?? {}
  const userId:    string | undefined      = metadata.user_id
  const tierId:    string | undefined      = metadata.tier_id
  const creditCents: number | undefined    = metadata.credit_cents ? Number(metadata.credit_cents) : undefined

  if (paymentStatus !== 'paid') {
    // Unpaid session (async bank debit, etc.) — ignore until it transitions.
    console.log(`${LOG} session ${sessionId} not paid (status=${paymentStatus})`)
    return Response.json({ received: true, handled: false, reason: 'unpaid' })
  }

  if (!sessionId || !userId || !Number.isInteger(creditCents) || !creditCents || creditCents <= 0) {
    console.error(`${LOG} missing fields: sessionId=${sessionId} userId=${userId} creditCents=${creditCents}`)
    return new Response('bad session metadata', { status: 400 })
  }

  // Cross-check: amount_total (what Stripe actually charged) must match
  // the credit_cents we embedded in metadata. Guards against a tampered
  // metadata blob if anything ever constructs a session outside our API.
  if (typeof amountTotal === 'number' && amountTotal !== creditCents) {
    console.error(`${LOG} amount mismatch: amount_total=${amountTotal} credit_cents=${creditCents}`)
    return new Response('amount mismatch', { status: 400 })
  }

  const sb = serviceClient()

  // Idempotency guard: has this session already been credited?
  const { data: existing, error: lookupErr } = await sb
    .from('credit_transactions')
    .select('id, balance_after_cents')
    .eq('reference_type', 'stripe_checkout_session')
    .eq('reference_id',   sessionId)
    .maybeSingle()

  if (lookupErr) {
    console.error(`${LOG} dedup lookup failed:`, lookupErr.message)
    return new Response('dedup lookup failed', { status: 500 })
  }

  if (existing) {
    console.log(`${LOG} session ${sessionId} already credited (txn ${existing.id}) — skipping`)
    return Response.json({ received: true, handled: true, duplicate: true })
  }

  // Grant credits. kind='purchase' so the profile ledger shows it as a
  // top-up (not a freebie).
  try {
    const newBalance = await grantCredits({
      userId,
      amountCents:   creditCents,
      kind:          'purchase',
      referenceType: 'stripe_checkout_session',
      referenceId:   sessionId,
      description:   metadata.gift_from
        ? `Gift from ${metadata.gift_from} (${tierId ?? 'custom'})`
        : `Stripe purchase (${tierId ?? 'custom'})`,
      metadata: {
        stripe_event_id:     event.id,
        stripe_payment_intent: session.payment_intent ?? null,
        tier_id:             tierId ?? null,
        gift_from:           metadata.gift_from ?? null,
      },
    })
    console.log(`${LOG} granted ${creditCents}¢ to ${userId} (new balance ${newBalance}¢)`)
    return Response.json({ received: true, handled: true, newBalanceCents: newBalance })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`${LOG} grant failed:`, msg)
    // Return 500 so Stripe retries. Next retry will hit the dedup guard
    // if the grant actually landed but we crashed mid-response.
    return new Response(`grant failed: ${msg}`, { status: 500 })
  }
}
