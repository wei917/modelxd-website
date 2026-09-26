// proxy.ts
//
// Thin "under construction" gate. Soft-protects the site behind a single
// shared password — used pre-launch so randos hitting production see a
// placeholder, while we keep building behind it.
//
// Renamed from middleware.ts in Next.js 16. Same behavior; the framework
// just wanted "proxy" to be the canonical name for the Edge-runtime
// network gate. See: https://nextjs.org/docs/messages/middleware-to-proxy
//
// Behavior:
//   - If env var SITE_PASSWORD is NOT set → gate is disabled (everything
//     passes through). This is the default for dev/local.
//   - If SITE_PASSWORD IS set → every request needs a cookie matching
//     that value. Without it, the request is redirected to /coming-soon.
//     The /coming-soon page has a form that POSTs to /api/site-auth,
//     which sets the cookie on a correct password.
//
// Host scoping: even with SITE_PASSWORD set, only modelxd.com and
//   www.modelxd.com are gated. localhost, dev.modelxd.com and Vercel
//   preview URLs always pass through.
//
// Bypass list: a few paths must work without the cookie, otherwise
// they'd break:
//   - /coming-soon              — the form itself
//   - /api/site-auth            — the form's POST target
//   - /api/stripe/webhook       — Stripe's webhook calls won't have the cookie
//   - /api/v1/*, /api/mcp       — machine endpoints with their OWN auth (an
//                                 xd_ bearer key). A game server's SDK call
//                                 cannot follow a redirect to a password
//                                 form, and gating a bearer-authed route
//                                 behind a browser cookie adds no security:
//                                 without a key the route answers 401 anyway.
//   - /_next/*                  — Next.js static assets
//   - /favicon, /robots, /logo  — public static files

import { NextResponse, type NextRequest } from 'next/server'
import { verifySiteToken } from '@/lib/site-token'
import { siteOfHost, isSiteRoute, SITE_HEADER, SITE_COOKIE } from '@/lib/site'

const COOKIE_NAME = 'modelxd_site_unlocked'

function isBypassed(pathname: string): boolean {
  if (pathname === '/coming-soon')          return true
  if (pathname === '/api/site-auth')        return true
  if (pathname === '/api/stripe/webhook')   return true
  if (pathname.startsWith('/api/v1/'))      return true
  if (pathname === '/api/mcp')              return true
  // /api/v1/* and /api/mcp call these internally. The gate redirects a
  // non-exempt POST to /coming-soon, and following that redirect turns into
  // 405 Method Not Allowed — which is exactly what a customer hit on
  // /v1/images/generations (Aug 30), and what silently broke MCP image
  // generation on www too. These carry their own auth (API key or session)
  // and bill credits; the site password was never what protected them.
  if (pathname === '/api/xcreate')          return true
  if (pathname.startsWith('/api/xcreate/')) return true
  if (pathname.startsWith('/_next/'))       return true
  if (pathname === '/favicon.ico')          return true
  if (pathname === '/robots.txt')           return true
  if (pathname === '/sitemap.xml')          return true
  if (pathname === '/logo.png')             return true
  if (pathname === '/xcreate-preview.png')  return true
  return false
}

// ── The other front doors (XTell, XCreate) ─────────────────────────────────
// xtell.modelxd.com is the temple street as its own site (owner, Sep 23) and
// xcreate.modelxd.com the studio (owner, Sep 26): same deployment, same auth
// and wallet, different shell. The proxy does two things for those hosts and
// nothing else: stamp the request with the site header so server components
// know which shell to render, and refuse every route that is not the door's
// own by sending it to `/` (app/page.tsx renders the door's app there).
// Refusing here means a door's shell never hides a link defensively — the
// page simply does not exist on that host. The contract (header name,
// cookie, route lists) lives in lib/site.ts.
/** The host the visitor typed. Behind Vercel that is x-forwarded-host; the
 *  dev server's nextUrl reports its own bind address regardless of the Host
 *  header, so the headers are read first and nextUrl is the fallback. */
function requestHost(req: NextRequest): string {
  const h = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? req.nextUrl.hostname
  return h.split(',')[0].trim().toLowerCase()
}

/** Host without the port — the password gate matches production names. */
const bareHost = (h: string) => h.replace(/:\d+$/, '')

function siteDoor(req: NextRequest): NextResponse {
  // WITH the port: locally the port picks the shell (:3001 XTell, :3030 XCreate).
  const host = requestHost(req)
  const site = siteOfHost(host, req.cookies.get(SITE_COOKIE)?.value ?? null)
  const headers = new Headers(req.headers)
  headers.set(SITE_HEADER, site)
  if (site === 'modelxd') return NextResponse.next({ request: { headers } })

  const pathname = req.nextUrl.pathname
  // APIs, assets and static files are shared; only pages are curated.
  if (pathname.startsWith('/api/') || pathname.startsWith('/_next/') || /\.[a-z0-9]+$/i.test(pathname)) {
    return NextResponse.next({ request: { headers } })
  }
  // `/` is served by app/page.tsx, which renders the door's app for this
  // host itself — a rewrite to /xtell here made usePathname() disagree
  // between server and browser and broke hydration.
  if (isSiteRoute(site, pathname)) return NextResponse.next({ request: { headers } })
  const home = req.nextUrl.clone(); home.pathname = '/'; home.search = ''
  return NextResponse.redirect(home)
}

/**
 * `?site=xtell` / `?site=xcreate` / `?site=www` switches the local shell and REMEMBERS it,
 * then redirects to the clean URL. The cookie had no off-switch: it was set
 * by hand in devtools per lib/site.ts, nothing ever cleared it, and a stale
 * one turned every later localhost visit into the temple street with
 * /xcreate 302'ing to `/` for no visible reason (hit Sep 26).
 *
 * Ports would be tidier (:3001 = XTell, and siteOfHost honours that) but
 * Next 16 refuses a second `next dev` in the same directory, so two ports
 * mean two worktrees. This works with the one server everyone actually runs.
 */
function siteSwitch(req: NextRequest): NextResponse | null {
  const want = req.nextUrl.searchParams.get('site')
  if (want !== 'xtell' && want !== 'xcreate' && want !== 'www' && want !== 'modelxd') return null
  const url = req.nextUrl.clone()
  url.searchParams.delete('site')
  const res = NextResponse.redirect(url)
  if (want === 'xtell' || want === 'xcreate') res.cookies.set(SITE_COOKIE, want, { path: '/', sameSite: 'lax' })
  else res.cookies.set(SITE_COOKIE, '', { path: '/', maxAge: 0 })
  return res
}

export async function proxy(req: NextRequest) {
  const switched = siteSwitch(req)
  if (switched) return switched

  // The XTell and XCreate hosts are never behind the site password (like
  // dev.), and every request on every host gets the site header.
  const door = siteDoor(req)
  const host = bareHost(requestHost(req))
  if (host !== 'modelxd.com' && host !== 'www.modelxd.com') return door

  const sitePw = process.env.SITE_PASSWORD
  if (!sitePw) return door   // gate disabled

  // Only the real production hosts are gated. localhost, dev.modelxd.com
  // and *.vercel.app previews pass through even when SITE_PASSWORD is set
  // (CC, July 19) — so the same env file works everywhere.

  const pathname = req.nextUrl.pathname
  if (isBypassed(pathname)) return NextResponse.next()

  // Verify the signed token. HMAC re-runs every request, so this IS
  // the per-request password check — if SITE_PASSWORD changes, every
  // existing token's signature stops matching.
  const cookie = req.cookies.get(COOKIE_NAME)?.value
  if (await verifySiteToken(sitePw, cookie)) {
    return NextResponse.next()
  }

  // Redirect to /coming-soon, preserving the original URL so we can
  // bounce the user back there after they enter the password.
  const target = req.nextUrl.clone()
  target.pathname = '/coming-soon'
  target.searchParams.set('from', pathname + req.nextUrl.search)
  return NextResponse.redirect(target)
}

// Run on every request except Next.js' built-in static endpoints.
export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
}
