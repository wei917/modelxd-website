// app/api/referral/route.ts — the signed-in user's referral status.
//
//   GET  -> { code, link, pending, paid, earnedCents, verified }
//   POST -> { url } : a Stripe setup-mode Checkout session to verify a card.
//
// Credits are never granted here. The webhook is the only place that pays,
// exactly as it is for purchases — a route the client can call must never be
// able to pay the caller.

export const runtime = 'nodejs'

import { createSupabaseServer } from '@/lib/supabase-server'
import { createClient } from '@supabase/supabase-js'
import { referralSummary } from '@/lib/referral'
import { createSetupSession } from '@/lib/stripe'

const service = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false } })

async function me() {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  return user
}

export async function GET(req: Request) {
  const user = await me()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const summary = await referralSummary(user.id)
    // Has this account bound a card yet? Only relevant to a REFEREE, who needs
    // one to unlock their bonus.
    const { data: fp } = await service().from('payment_fingerprints')
      .select('fingerprint').eq('user_id', user.id).limit(1)
    const { data: asReferee } = await service().from('referrals')
      .select('status').eq('referee_id', user.id).maybeSingle()
    return Response.json({
      ...summary,
      link: `${new URL(req.url).origin}/?ref=${summary.code}`,
      verified: (fp ?? []).length > 0,
      refereeStatus: asReferee?.status ?? null,
    })
  } catch (e: any) {
    // Before migration 87 runs, the tables do not exist — the profile page
    // must still render.
    const msg = String(e?.message ?? e)
    if (/referral_codes|referrals|payment_fingerprints/.test(msg)) {
      return Response.json({ error: 'Referrals are not set up yet (run supabase/87_referrals.sql).' }, { status: 503 })
    }
    return Response.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const user = await me()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const origin = new URL(req.url).origin
  try {
    const session = await createSetupSession({
      userId: user.id,
      email: user.email,
      successUrl: `${origin}/profile?verify=success`,
      cancelUrl: `${origin}/profile?verify=cancel`,
    })
    if (!session.url) return Response.json({ error: 'Stripe returned no URL' }, { status: 502 })
    return Response.json({ url: session.url })
  } catch (e: any) {
    console.error('[referral] setup session failed:', e?.message ?? e)
    return Response.json({ error: 'Could not start card verification — try again.' }, { status: 500 })
  }
}
