// lib/page-key.ts — which page a visit is on, for the visit log's page views
// (supabase/139; owner, Oct 15: "record which page so we can tell which
// temple they enter").
//
// A page is a short key, never a full URL: an app can name the part of a
// page the visitor is in (X先知's rooms: 'xtell/ziwei'), and anything else is
// its path with ids masked ('/xtalk/:id'). No query string, nothing typed.
// VisitTracker reads the key; an app sets it with setPageKey().

export const PAGE_EVENT = 'modelxd:page'

type Named = { key: string; path: string }
declare global { interface Window { __modelxdPage?: Named | null } }

/** An app names where on its page the visitor is (null: just the page).
 *  Kept for the current path only, so a later page never inherits it. */
export function setPageKey(key: string | null): void {
  try {
    window.__modelxdPage = key ? { key, path: window.location.pathname } : null
    window.dispatchEvent(new Event(PAGE_EVENT))
  } catch { /* the log never stands in the way of the page */ }
}

const ID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{3,}|[A-Za-z0-9_-]{20,})$/i

/** A path as a page key: lower case, ids masked, at most four parts. */
export function pathKey(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean).slice(0, 4).map(p => ID.test(p) ? ':id' : p.toLowerCase().slice(0, 40))
  return '/' + parts.join('/')
}

/** The key for where the visitor is now. */
export function currentPageKey(): string {
  const named = typeof window !== 'undefined' ? window.__modelxdPage : null
  return named && named.path === window.location.pathname ? named.key : pathKey(window.location.pathname)
}
