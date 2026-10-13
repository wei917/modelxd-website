// lib/site.ts — which front door is this request coming through?
//
// One deployment, two front doors. www.modelxd.com is the model platform;
// xtell.modelxd.com is the temple street on its own, for the Taiwan/Japan
// fortune-telling audience (owner, Sep 23). Same backend, same auth, same
// wallet — only the shell differs. The host is detected at request time,
// never baked into a build, so one Vercel project serves both. X創作 had a
// door of its own (xcreate.modelxd.com, Sep 26) that was never released; it
// was removed on Oct 13 (owner: "I never release xcreate.modelxd.com, so you
// can remove anything related to it"), and the studio lives at /xcreate.
//
// Contract (frontend reads these, backend sets them):
//   - proxy.ts stamps every request with the header `x-modelxd-site`
//     ('modelxd' | 'xtell'); app/page.tsx renders the door's own app at `/`
//     — the street (no rewrite — see app/page.tsx).
//   - Server components: `siteFromHeaders(await headers())`.
//   - Client components: `useSite()` from lib/useSite.tsx, fed by the root
//     layout's SiteProvider (server value, no first-paint flash). CSS can
//     key on `<html data-site="…">`.
//   - LOCAL DEV: `?site=xtell` or `?site=www` on any page switches the shell
//     and remembers it in the `modelxd_site` cookie (proxy.ts). A second
//     server run from a worktree can use its PORT instead: :3001 is XTell.
//     Both exist because a cookie set by hand in devtools had no off-switch:
//     it turned every later visit to localhost into the temple street (Sep
//     26). The cookie is also the only switch on Vercel preview URLs, where
//     you cannot choose a port.
//   - Routes ALLOWED on the door are listed in XTELL_ROUTES; anything else is
//     redirected to `/` by proxy.ts, so a shell never has to hide a link
//     defensively — the backend refuses the page.
//
// Pure: no Node imports, no React — the proxy (Edge) imports this file, so
// the client hook lives next door in lib/useSite.ts.

export type Site = 'modelxd' | 'xtell'

export const XTELL_HOSTS = ['xtell.modelxd.com']
export const SITE_HEADER = 'x-modelxd-site'
export const SITE_COOKIE = 'modelxd_site'

/** Pages the XTell host serves. Everything else 302s to `/` (which is the street). */
export const XTELL_ROUTES = ['/xtell', '/profile', '/terms', '/privacy', '/tokushoho', '/login', '/auth', '/coming-soon']

const ROUTES: Record<Exclude<Site, 'modelxd'>, string[]> = { xtell: XTELL_ROUTES }

/** The dev port that serves the door's shell. www is whatever else you run. */
export const XTELL_LOCAL_PORT = '3001'

export const WWW_ORIGIN = 'https://www.modelxd.com'

/** The XTell door's content is also www's page at /xtell, inside www's own
 *  shell (owner, Oct 4: no subdomains; dev.modelxd.com/xtell first, www stays
 *  behind its password). The subdomain keeps serving the door until it is
 *  retired. Links to the street and temples use a base: '' on the subdomain,
 *  '/xtell' on www (app/components/xtell/XTellBase.tsx). */
export const XTELL_PATH = '/xtell'
export type XTellBase = '' | '/xtell'

/** www's XTell page and anything under it. Files under /xtell (pictures,
 *  cards) are not pages. */
export function isXTellPath(pathname: string): boolean {
  if (/\.[a-z0-9]+$/i.test(pathname)) return false
  return pathname === XTELL_PATH || pathname.startsWith(XTELL_PATH + '/')
}

/** The street and a temple on it, for this base. */
export const doorHome = (base: string): string => base || '/'
export const templeHref = (base: string, key: string): string => `${base || '/'}#${key}`

function isDoor(v: string | null | undefined): v is 'xtell' {
  return v === 'xtell'
}

/** `hostname` may carry a port ('localhost:3001'); a bare host is fine too. */
export function siteOfHost(hostname: string, cookie?: string | null): Site {
  const [host, port] = hostname.split(':')
  if (XTELL_HOSTS.includes(host)) return 'xtell'
  const local = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.vercel.app') || host.startsWith('dev.')
  if (!local) return 'modelxd'
  if (port === XTELL_LOCAL_PORT) return 'xtell'
  return isDoor(cookie) ? cookie : 'modelxd'
}

/** Does this door serve the page? www serves everything; `/` is every door's own app. */
export function isSiteRoute(site: Site, pathname: string): boolean {
  if (site === 'modelxd' || pathname === '/') return true
  return ROUTES[site].some(r => pathname === r || pathname.startsWith(r + '/'))
}

/** Server components / route handlers: pass `await headers()`. */
export function siteFromHeaders(h: { get(name: string): string | null }): Site {
  const v = h.get(SITE_HEADER)
  return isDoor(v) ? v : 'modelxd'
}

