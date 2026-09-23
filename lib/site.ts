// lib/site.ts — which front door is this request coming through?
//
// One deployment, two brands. www.modelxd.com is the model platform;
// xtell.modelxd.com is the temple street on its own, for the Taiwan/Japan
// fortune-telling audience (owner, Sep 23). Same backend, same auth, same
// wallet — only the shell differs. The host is detected at request time,
// never baked into a build, so one Vercel project serves both.
//
// Contract (frontend reads these, backend sets them):
//   - proxy.ts stamps every request with the header `x-modelxd-site`
//     ('xtell' | 'modelxd'); app/page.tsx renders the street at `/` on the
//     XTell host (no rewrite — see app/page.tsx for why).
//   - Server components: `siteFromHeaders(await headers())`.
//   - Client components: `useSite()` from lib/useSite.tsx, fed by the root
//     layout's SiteProvider (server value, no first-paint flash). The cookie
//     `modelxd_site=xtell` on localhost makes the proxy treat the request as
//     the XTell host so the shell can be developed without DNS (set it from
//     devtools: document.cookie = 'modelxd_site=xtell; path=/').
//   - Routes ALLOWED on the XTell host are listed in XTELL_ROUTES; anything
//     else is redirected to `/` by proxy.ts, so the XTell shell never has to
//     hide a link defensively — the backend refuses the page.
//
// Pure: no Node imports, no React — the proxy (Edge) imports this file, so
// the client hook lives next door in lib/useSite.ts.

export type Site = 'modelxd' | 'xtell'

export const XTELL_HOSTS = ['xtell.modelxd.com']
export const SITE_HEADER = 'x-modelxd-site'
export const SITE_COOKIE = 'modelxd_site'

/** Pages the XTell host serves. Everything else 302s to `/` (which is the street). */
export const XTELL_ROUTES = ['/xtell', '/profile', '/terms', '/privacy', '/login', '/auth', '/coming-soon']

export function siteOfHost(hostname: string, cookie?: string | null): Site {
  if (XTELL_HOSTS.includes(hostname)) return 'xtell'
  const local = hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.vercel.app') || hostname.startsWith('dev.')
  if (local && cookie === 'xtell') return 'xtell'
  return 'modelxd'
}

export function isXTellRoute(pathname: string): boolean {
  if (pathname === '/') return true
  return XTELL_ROUTES.some(r => pathname === r || pathname.startsWith(r + '/'))
}

/** Server components / route handlers: pass `await headers()`. */
export function siteFromHeaders(h: { get(name: string): string | null }): Site {
  return h.get(SITE_HEADER) === 'xtell' ? 'xtell' : 'modelxd'
}
