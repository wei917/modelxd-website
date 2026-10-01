// app/api/visit/route.ts
//
// The server half of the visit log (owner, Sep 27). VisitTracker reports here
// at the start of a visit, once a minute while the tab is in front, and when
// it is hidden or closed; each report upserts the visit's row in site_visits
// through log_site_visit() (supabase/109_site_visits.sql). Reports:
// docs/SITE-VISITS.md.
//
// The server decides everything the tab cannot know or should not be
// trusted with: the visitor cookie, the signed-in user (from the session
// cookie), country and city (Vercel's geo headers), the device class, the
// host and the deployment. No IP address is stored; the one read here only
// feeds the per-instance rate limit, a floor like the site agent's.
//
// Always answers 204. A tab can do nothing with an error, and a missing
// function (before 109 is run) or a Supabase blip must never reach a page.
//
// A report can also be a tap on a sign-in button (lib/signin-tap.ts, Oct 1):
// { tap: provider, path }. It becomes one row in site_signin_taps
// (supabase/120) under the same rules: no crawlers, nothing that needs
// consent, the same rate limit and the same visitor cookie.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServer } from '@/lib/supabase-server'
import { needsConsent } from '@/lib/consent'
import { TAP_PROVIDERS } from '@/lib/signin-tap'

const LOG = '[api/visit]'
const VISITOR_COOKIE = 'modelxd_vid'
const YEAR = 365 * 86400
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const AD_PARAMS = ['gclid', 'gbraid', 'wbraid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const
// Crawlers that run JavaScript (Googlebot, AdsBot checking ad landing pages,
// Lighthouse, headless QA) would otherwise count as visitors.
const BOT = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|inspectiontool|googleother|preview/i

const RATE_LIMIT = 120              // reports per minute per IP, per instance
const hits = new Map<string, { n: number; reset: number }>()
function limited(ip: string): boolean {
  const now = Date.now()
  if (hits.size > 5000) for (const [k, h] of hits) if (h.reset < now) hits.delete(k)
  const h = hits.get(ip)
  if (!h || h.reset < now) { hits.set(ip, { n: 1, reset: now + 60_000 }); return false }
  return ++h.n > RATE_LIMIT
}

let warned = false

const text = (x: unknown, max: number): string | null =>
  typeof x === 'string' && x.trim() ? x.trim().slice(0, max) : null
const count = (x: unknown, max: number): number =>
  typeof x === 'number' && Number.isFinite(x) ? Math.max(0, Math.min(max, Math.round(x))) : 0

const service = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const hostOf = (req: NextRequest) => (req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '').split(',')[0].trim().toLowerCase()

function deviceOf(ua: string): 'desktop' | 'mobile' | 'tablet' {
  if (/iPad|Tablet|PlayBook|Silk|Android(?!.*Mobile)/i.test(ua)) return 'tablet'
  if (/Mobi|iPhone|iPod|Android/i.test(ua)) return 'mobile'
  return 'desktop'
}

export async function POST(req: NextRequest) {
  const done = new NextResponse(null, { status: 204 })
  try {
    const ua = req.headers.get('user-agent') ?? ''
    const country = req.headers.get('x-vercel-ip-country')
    if (!ua || BOT.test(ua) || needsConsent(country)) return done
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
    if (limited(ip)) return done

    const raw = await req.text()
    if (raw.length > 4000) return done
    let b: Record<string, unknown>
    try { b = JSON.parse(raw) } catch { return done }
    if (!b || typeof b !== 'object') return done

    if (typeof b.tap === 'string') {
      if (!TAP_PROVIDERS.has(b.tap)) return done
      const path = text(b.path, 300)
      const vid = req.cookies.get(VISITOR_COOKIE)?.value ?? ''
      const { error } = await service().from('site_signin_taps').insert({
        env:        process.env.VERCEL_ENV ?? 'development',
        provider:   b.tap,
        visitor_id: UUID.test(vid) ? vid : null,
        host:       hostOf(req).slice(0, 100) || null,
        path:       path?.startsWith('/') ? path : null,
        country:    country?.slice(0, 2) ?? null,
      })
      if (error && !warned) { warned = true; console.warn(`${LOG} sign-in tap failed: ${error.message}`) }
      return done
    }

    if (typeof b.id !== 'string' || !UUID.test(b.id)) return done

    const landing = text(b.landing, 300)
    const referrer = text(b.referrer, 200)
    const ad = (b.ad && typeof b.ad === 'object' ? b.ad : {}) as Record<string, unknown>

    // The visitor cookie: first party, a year, shared by the three front
    // doors on modelxd.com (host-only elsewhere), renewed on every report.
    const host = hostOf(req)
    const bare = host.replace(/:\d+$/, '')
    let visitorId = req.cookies.get(VISITOR_COOKIE)?.value ?? ''
    if (!UUID.test(visitorId)) visitorId = crypto.randomUUID()
    done.cookies.set(VISITOR_COOKIE, visitorId, {
      path: '/', maxAge: YEAR, httpOnly: true, sameSite: 'lax',
      secure: req.nextUrl.protocol === 'https:' || process.env.NODE_ENV === 'production',
      ...(bare === 'modelxd.com' || bare.endsWith('.modelxd.com') ? { domain: '.modelxd.com' } : {}),
    })

    // Only a request carrying a Supabase session cookie pays for the lookup.
    let userId: string | null = null
    if (req.cookies.getAll().some(c => c.name.startsWith('sb-') && c.name.includes('-auth-token'))) {
      try {
        const sb = await createSupabaseServer()
        const { data } = await sb.auth.getClaims()
        const sub = data?.claims?.sub
        userId = typeof sub === 'string' && UUID.test(sub) ? sub : null
      } catch { /* a broken session still logs the visit, without a user */ }
    }

    const city = req.headers.get('x-vercel-ip-city')
    let cityName: string | null = null
    try { cityName = city ? decodeURIComponent(city).slice(0, 100) : null } catch { cityName = city?.slice(0, 100) ?? null }

    const { error } = await service().rpc('log_site_visit', {
      p_id:             b.id,
      p_visitor_id:     visitorId,
      p_env:            process.env.VERCEL_ENV ?? 'development',
      p_user_id:        userId,
      p_host:           host.slice(0, 100) || null,
      p_landing:        landing?.startsWith('/') ? landing : null,
      p_referrer:       referrer && /^[a-z0-9.-]+(:\d+)?$/i.test(referrer) ? referrer.toLowerCase() : null,
      ...Object.fromEntries(AD_PARAMS.map(k => [`p_${k}`, text(ad[k], 200)])),
      p_country:        country?.slice(0, 2) ?? null,
      p_city:           cityName,
      p_device:         deviceOf(ua),
      p_pages:          Math.max(1, count(b.pages, 5000)),
      p_active_seconds: count(b.active, 86400),
    })
    if (error && !warned) { warned = true; console.warn(`${LOG} log_site_visit failed: ${error.message}`) }
  } catch (err) {
    if (!warned) { warned = true; console.warn(`${LOG} failed:`, err instanceof Error ? err.message : err) }
  }
  return done
}
