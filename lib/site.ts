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
//     layout's SiteProvider (server value, no first-paint flash).
//   - LOCAL DEV: the PORT picks the shell — :3000 is www, :3001 is XTell
//     (XTELL_LOCAL_PORT). Run both and keep a tab on each. This replaced
//     the `modelxd_site=xtell` cookie as the everyday switch (owner, Sep 26:
//     "why not localhost 3001?"): a cookie nothing clears turned every later
//     visit to localhost into the temple street, and /xcreate 302'd to `/`
//     with no clue why. The cookie still works, for Vercel preview URLs
//     where you cannot choose a port; clear it with
//     document.cookie = 'modelxd_site=; Max-Age=0; path=/'.
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

/** The dev port that serves the XTell shell. www is whatever else you run. */
export const XTELL_LOCAL_PORT = '3001'

/** `hostname` may carry a port ('localhost:3001'); a bare host is fine too. */
export function siteOfHost(hostname: string, cookie?: string | null): Site {
  const [host, port] = hostname.split(':')
  if (XTELL_HOSTS.includes(host)) return 'xtell'
  const local = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.vercel.app') || host.startsWith('dev.')
  if (!local) return 'modelxd'
  if (port === XTELL_LOCAL_PORT) return 'xtell'
  return cookie === 'xtell' ? 'xtell' : 'modelxd'
}

export function isXTellRoute(pathname: string): boolean {
  if (pathname === '/') return true
  return XTELL_ROUTES.some(r => pathname === r || pathname.startsWith(r + '/'))
}

/** Server components / route handlers: pass `await headers()`. */
export function siteFromHeaders(h: { get(name: string): string | null }): Site {
  return h.get(SITE_HEADER) === 'xtell' ? 'xtell' : 'modelxd'
}
