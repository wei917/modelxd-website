// app/api/credits/ensure-daily/route.ts
//
// Hit from the Nav on every authenticated page load. Formerly granted the
// daily $1 free credit; that was removed (CC, July 20) - free XDuels are
// the free tier. The endpoint remains for locale/last-seen logging.
//
// Two jobs (July 17):
//   1. VERIFIED USERS ONLY get the grant — unverified accounts were
//      collecting the daily credit before. The profile page shows a
//      "verify your email" note keyed off the same condition.
//   2. Market analytics: upsert the user's language + country onto
//      their profiles row. Language = the app language the Nav sends
//      (falls back to Accept-Language); country = Vercel's geo header
//      (absent on localhost — existing value is preserved).
//
// (atomic UPDATE on last_daily_grant_date), so concurrent calls from
// multiple tabs collapse to a single grant.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { createClient } from '@supabase/supabase-js'
import { createSupabaseServer } from '@/lib/supabase-server'

const LOG = '[api/credits/ensure-daily]'

export async function POST(req: Request) {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) {
    return Response.json({ ok: false, reason: 'not_authenticated' }, { status: 401 })
  }

  // ── Locale logging (fire-and-forget; never blocks the grant) ──
  try {
    let bodyLang: string | null = null
    try { bodyLang = ((await req.json()) as { lang?: string })?.lang ?? null } catch { /* no body */ }
    const country    = req.headers.get('x-vercel-ip-country')
    const acceptLang = req.headers.get('accept-language')?.split(',')[0]?.trim() ?? null

    const patch: Record<string, unknown> = { id: user.id, last_seen_at: new Date().toISOString() }
    const language = bodyLang ?? acceptLang
    if (language) patch.language = language
    if (country)  patch.country  = country

    const svc = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY!,
    )
    const { error } = await svc.from('profiles').upsert(patch, { onConflict: 'id' })
    if (error) console.warn(`${LOG} locale upsert failed: ${error.message}`)
  } catch (err) {
    console.warn(`${LOG} locale logging failed:`, err instanceof Error ? err.message : err)
  }

  // Daily free credit REMOVED (CC, July 20) - free XDuels are the free
  // tier; XCreate credits are purchase-only. This endpoint now only does
  // the locale logging above.
  return Response.json({ ok: true })
}
