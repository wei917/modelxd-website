// app/api/referral/claim/route.ts — attach a signup to the code it arrived with.
//
// Called once by the client after sign-in, with the code the landing page
// stashed. Records a PENDING referral; no credits move until a card is bound.
// A bad code never breaks a signup — it answers 200 with ok:false.

export const runtime = 'nodejs'

import { createSupabaseServer } from '@/lib/supabase-server'
import { claimReferral } from '@/lib/referral'

export async function POST(req: Request) {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const code = typeof body?.code === 'string' ? body.code : ''
  if (!code) return Response.json({ ok: false, reason: 'no_code' })

  // Signals: recorded, never enforced (owner, Aug 25).
  const emailDomain = (user.email ?? '').split('@')[1]?.toLowerCase() ?? null
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null

  try {
    const res = await claimReferral(user.id, code, { emailDomain, ip })
    return Response.json(res)
  } catch (e: any) {
    const msg = String(e?.message ?? e)
    if (/referral_codes|referrals/.test(msg)) {
      return Response.json({ ok: false, reason: 'not_set_up' })
    }
    console.error('[referral/claim]', msg)
    return Response.json({ ok: false, reason: 'error' })
  }
}
