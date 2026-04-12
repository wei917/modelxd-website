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

import { getTier, createCheckoutSession } from '@/lib/stripe'
import { createSupabaseServer }            from '@/lib/supabase-server'

interface CheckoutBody {
  tierId?: string
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

  const tier = body.tierId ? getTier(body.tierId) : null
  if (!tier) {
    return Response.json({ error: 'unknown tierId' }, { status: 400 })
  }

  // Build absolute URLs for the success/cancel redirects. Prefer the
  // request's own origin so it works on localhost, preview, and prod
  // without an env-var per environment. Stripe needs absolute URLs.
  const origin = new URL(req.url).origin

  try {
    const session = await createCheckoutSession({
      tier,
      userId:     user.id,
      userEmail:  user.email,
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
