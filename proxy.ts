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
import { siteOfHost, isXTellRoute, SITE_HEADER, SITE_COOKIE } from '@/lib/site'

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

// ── The XTell front door ────────────────────────────────────────────────────
// xtell.modelxd.com is the temple street as its own site (owner, Sep 23):
// same deployment, same auth and wallet, different shell. The proxy does
// two things for that host and nothing else: stamp the request with the
// site header so server components know which shell to render, and refuse
// every route that is not XTell's by sending it to `/` (app/page.tsx renders
// the street there for this host). Refusing here means the XTell shell never hides a link
// defensively — the page simply does not exist on that host. The contract
// (header name, cookie, route list) lives in lib/site.ts.
/** The host the visitor typed. Behind Vercel that is x-forwarded-host; the
 *  dev server's nextUrl reports its own bind address regardless of the Host
 *  header, so the headers are read first and nextUrl is the fallback. */
function requestHost(req: NextRequest): string {
  const h = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? req.nextUrl.hostname
  return h.split(',')[0].trim().replace(/:\d+$/, '').toLowerCase()
}

function xtellDoor(req: NextRequest): NextResponse | null {
  const host = requestHost(req)
  const site = siteOfHost(host, req.cookies.get(SITE_COOKIE)?.value ?? null)
  const headers = new Headers(req.headers)
  headers.set(SITE_HEADER, site)
  if (site !== 'xtell') return NextResponse.next({ request: { headers } })

  const pathname = req.nextUrl.pathname
  // APIs, assets and static files are shared; only pages are curated.
  if (pathname.startsWith('/api/') || pathname.startsWith('/_next/') || /\.[a-z0-9]+$/i.test(pathname)) {
    return NextResponse.next({ request: { headers } })
  }
  // `/` is served by app/page.tsx, which renders the street for this host
  // itself — a rewrite to /xtell here made usePathname() disagree between
  // server and browser and broke hydration.
  if (isXTellRoute(pathname)) return NextResponse.next({ request: { headers } })
  const home = req.nextUrl.clone(); home.pathname = '/'; home.search = ''
  return NextResponse.redirect(home)
}

export async function proxy(req: NextRequest) {
  // The XTell host is never behind the site password (like dev.), and every
  // request on every host gets the site header.
  const door = xtellDoor(req)
  const host = requestHost(req)
  if (host !== 'modelxd.com' && host !== 'www.modelxd.com') return door ?? NextResponse.next()

  const sitePw = process.env.SITE_PASSWORD
  if (!sitePw) return door ?? NextResponse.next()   // gate disabled

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
