// lib/site.ts — which front door is this request coming through?
//
// One deployment, three front doors. www.modelxd.com is the model platform;
// xtell.modelxd.com is the temple street on its own, for the Taiwan/Japan
// fortune-telling audience (owner, Sep 23); xcreate.modelxd.com is the
// studio on its own (owner, Sep 26). Same backend, same auth, same wallet —
// only the shell differs. The host is detected at request time, never baked
// into a build, so one Vercel project serves all three.
//
// Contract (frontend reads these, backend sets them):
//   - proxy.ts stamps every request with the header `x-modelxd-site`
//     ('modelxd' | 'xtell' | 'xcreate'); app/page.tsx renders the door's own
//     app at `/` — the street, the studio (no rewrite — see app/page.tsx).
//   - Server components: `siteFromHeaders(await headers())`.
//   - Client components: `useSite()` from lib/useSite.tsx, fed by the root
//     layout's SiteProvider (server value, no first-paint flash). CSS can
//     key on `<html data-site="…">`.
//   - LOCAL DEV: `?site=xtell`, `?site=xcreate` or `?site=www` on any page
//     switches the shell and remembers it in the `modelxd_site` cookie
//     (proxy.ts). A second server run from a worktree can use its PORT
//     instead — :3001 is XTell, :3030 is XCreate. Both exist because a cookie
//     set by hand in devtools had no off-switch: it turned every later visit
//     to localhost into the temple street, and /xcreate 302'd to `/` with no
//     clue why (Sep 26). The cookie is also the only switch on Vercel preview
//     URLs, where you cannot choose a port.
//   - Routes ALLOWED on each door are listed in XTELL_ROUTES / XCREATE_ROUTES;
//     anything else is redirected to `/` by proxy.ts, so a shell never has to
//     hide a link defensively — the backend refuses the page. A shared app
//     that links a www-only page (XCreate's "View XBoard") uses wwwHref().
//
// Pure: no Node imports, no React — the proxy (Edge) imports this file, so
// the client hook lives next door in lib/useSite.ts.

export type Site = 'modelxd' | 'xtell' | 'xcreate'

export const XTELL_HOSTS = ['xtell.modelxd.com']
export const XCREATE_HOSTS = ['xcreate.modelxd.com']
export const SITE_HEADER = 'x-modelxd-site'
export const SITE_COOKIE = 'modelxd_site'

/** Pages the XTell host serves. Everything else 302s to `/` (which is the street). */
export const XTELL_ROUTES = ['/xtell', '/profile', '/terms', '/privacy', '/login', '/auth', '/coming-soon']

/** Pages the XCreate host serves. Everything else 302s to `/` (which is the studio). */
export const XCREATE_ROUTES = ['/xcreate', '/profile', '/terms', '/privacy', '/login', '/auth', '/coming-soon']

const ROUTES: Record<Exclude<Site, 'modelxd'>, string[]> = { xtell: XTELL_ROUTES, xcreate: XCREATE_ROUTES }

/** The dev ports that serve a door's shell. www is whatever else you run. */
export const XTELL_LOCAL_PORT = '3001'
export const XCREATE_LOCAL_PORT = '3030'

export const WWW_ORIGIN = 'https://www.modelxd.com'

function isDoor(v: string | null | undefined): v is 'xtell' | 'xcreate' {
  return v === 'xtell' || v === 'xcreate'
}

/** `hostname` may carry a port ('localhost:3001'); a bare host is fine too. */
export function siteOfHost(hostname: string, cookie?: string | null): Site {
  const [host, port] = hostname.split(':')
  if (XTELL_HOSTS.includes(host)) return 'xtell'
  if (XCREATE_HOSTS.includes(host)) return 'xcreate'
  const local = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.vercel.app') || host.startsWith('dev.')
  if (!local) return 'modelxd'
  if (port === XTELL_LOCAL_PORT) return 'xtell'
  if (port === XCREATE_LOCAL_PORT) return 'xcreate'
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

/** A page only www serves, linked from an app another door shares. On www the
 *  path stays relative; on the other doors it names www, because the door
 *  would refuse the page and send the visitor to its home. Locally that is
 *  production www — the door's shell is what is under test there. */
export function wwwHref(site: Site, path: string): string {
  return site === 'modelxd' ? path : WWW_ORIGIN + path
}
