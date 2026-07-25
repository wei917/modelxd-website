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
//   - /_next/*                  — Next.js static assets
//   - /favicon, /robots, /logo  — public static files

import { NextResponse, type NextRequest } from 'next/server'
import { verifySiteToken } from '@/lib/site-token'

const COOKIE_NAME = 'modelxd_site_unlocked'

function isBypassed(pathname: string): boolean {
  if (pathname === '/coming-soon')          return true
  if (pathname === '/api/site-auth')        return true
  if (pathname === '/api/stripe/webhook')   return true
  if (pathname.startsWith('/_next/'))       return true
  if (pathname === '/favicon.ico')          return true
  if (pathname === '/robots.txt')           return true
  if (pathname === '/sitemap.xml')          return true
  if (pathname === '/logo.png')             return true
  if (pathname === '/xcreate-preview.png')  return true
  return false
}

export async function proxy(req: NextRequest) {
  const sitePw = process.env.SITE_PASSWORD
  if (!sitePw) return NextResponse.next()           // gate disabled

  // Only the real production hosts are gated. localhost, dev.modelxd.com
  // and *.vercel.app previews pass through even when SITE_PASSWORD is set
  // (CC, July 19) — so the same env file works everywhere.
  const host = req.nextUrl.hostname
  if (host !== 'modelxd.com' && host !== 'www.modelxd.com') {
    return NextResponse.next()
  }

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
