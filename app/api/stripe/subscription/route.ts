// app/api/stripe/subscription/route.ts — the monthly plan, from the page's side.
//
//   GET   → the plan as priced for THIS visitor, plus their subscription
//   POST  { action: 'subscribe' | 'cancel' | 'resume' | 'portal' }
//
// Nothing here grants credit. Money moves in Stripe and credit lands in the
// webhook (lib/subscription.ts), the same rule the top-up path follows.
//
// The currency comes from where the request is made (Vercel's geo header),
// and GET and POST read it the same way, so the price the page shows is the
// price Stripe charges.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { createClient } from '@supabase/supabase-js'
import { createSupabaseServer } from '@/lib/supabase-server'
import { PLAN, currencyForCountry, planPriceLabel } from '@/lib/plans'
import { createSubscriptionSession, setCancelAtPeriodEnd, createPortalSession } from '@/lib/stripe'
import { recordSubscription, isLive } from '@/lib/subscription'

function svc() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } })
}

async function load(userId: string) {
  const { data, error } = await svc().from('subscriptions').select('*').eq('user_id', userId).maybeSingle()
  // Before supabase/98_subscriptions.sql is applied the table does not exist.
  // Report the plan as unavailable rather than offer a button that would take
  // money the webhook cannot yet turn into credit.
  if (error) return { available: false as const, sub: null as any }
  return { available: true as const, sub: data as any }
}

export async function GET(req: Request) {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const cur = currencyForCountry(req.headers.get('x-vercel-ip-country'))
  const { available, sub } = await load(user.id)
  return Response.json({
    available,
    plan: { id: PLAN.id, currency: cur, price: planPriceLabel(cur), creditCents: PLAN.creditCents, bonusCents: PLAN.bonusCents },
    subscription: sub ? {
      status: sub.status,
      cancelAtPeriodEnd: !!sub.cancel_at_period_end,
      currentPeriodEnd: sub.current_period_end,
      currency: sub.currency,
    } : null,
  })
}

export async function POST(req: Request) {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const action = body?.action
  const { available, sub } = await load(user.id)
  if (!available) return Response.json({ error: 'The monthly plan is not open yet.' }, { status: 503 })
  const origin = new URL(req.url).origin

  try {
    if (action === 'subscribe') {
      // One plan per person. A plan that is set to end is still theirs until
      // then: the answer is "resume", not a second subscription.
      if (sub && isLive(sub.status)) return Response.json({ error: 'You already have the monthly plan.' }, { status: 400 })
      const session = await createSubscriptionSession({
        userId: user.id,
        email: user.email,
        customerId: sub?.stripe_customer_id ?? null,
        currency: currencyForCountry(req.headers.get('x-vercel-ip-country')),
        successUrl: `${origin}/profile?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${origin}/profile?checkout=cancel`,
      })
      return Response.json({ url: session.url })
    }
    if (action === 'cancel' || action === 'resume') {
      if (!sub || !isLive(sub.status)) return Response.json({ error: 'No active plan.' }, { status: 400 })
      const updated = await setCancelAtPeriodEnd(sub.stripe_subscription_id, action === 'cancel')
      await recordSubscription(updated, user.id)
      return Response.json({ ok: true })
    }
    if (action === 'portal') {
      if (!sub?.stripe_customer_id) return Response.json({ error: 'No billing account yet.' }, { status: 400 })
      const portal = await createPortalSession(sub.stripe_customer_id, `${origin}/profile`)
      return Response.json({ url: portal.url })
    }
  } catch (err: any) {
    console.error('[stripe/subscription]', action, err?.message ?? err)
    return Response.json({ error: String(err?.message ?? err).replace(/^stripe:\s*/, '') }, { status: 502 })
  }
  return Response.json({ error: 'unknown action' }, { status: 400 })
}
