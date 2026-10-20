// lib/hidden-apps.ts — apps kept out of sight (owner, Oct 16: "create a hide
// list which contains what app needs to be hidden. xsport is one"; "two type
// of hidden, one is just hidden and people still can access it by going to
// the url directly. another hidden is admin only, others go there will get
// page not found"). Either way the app is not in the menu (Nav), and the site
// agent neither links to it nor reads its part of content/site-guide.md
// (between <!-- app:key --> and <!-- /app:key -->).
//
//   'unlisted'    that is all: its address still works for anyone
//   'admin'       for anyone not on ADMIN_EMAILS its pages answer page not
//                 found and its APIs refuse (proxy.ts, on every host but
//                 this machine); admins keep using it
//
// Client-safe: plain data and a path test. To hide an app, add it here; to
// bring one back, take it out.

export type HiddenLevel = 'unlisted' | 'admin'
export interface HiddenApp { key: string; level: HiddenLevel; why: string; paths: readonly string[] }

export const HIDDEN_APPS: readonly HiddenApp[] = [
  {
    key: 'xsports',
    level: 'admin',
    // Oct 16: its scores, plays, odds and clips come from feeds whose terms
    // allow personal, non-commercial use only (MLB's Stats API says so
    // outright; NBA's live feed and ESPN's are not public APIs). Admins only
    // until licensed data replaces them.
    why: 'feeds not licensed for commercial use',
    paths: ['/xsports', '/api/xsports'],
  },
  // Oct 20 (owner: "can you hide XWORLD and XARCH"): out of sight, not shut.
  // Anyone with a world or a floor plan keeps reaching it from the Library
  // or a saved link.
  { key: 'xworld', level: 'unlisted', why: 'owner: hidden for now', paths: ['/xworld'] },
  { key: 'xarch', level: 'unlisted', why: 'owner: hidden for now', paths: ['/xarch'] },
]

/** The hidden app a path belongs to (the path itself or anything under it). */
export function hiddenApp(pathname: string): HiddenApp | null {
  const path = pathname.split(/[?#]/)[0]
  return HIDDEN_APPS.find(a => a.paths.some(p => path === p || path.startsWith(p + '/'))) ?? null
}

/** A link into a hidden app, of either level (kept out of menus and the
 *  site agent's answers). */
export const isHiddenHref = (href: string) => hiddenApp(href) !== null

/** The site guide without the hidden apps' parts. */
export function withoutHidden(markdown: string): string {
  let out = markdown
  for (const a of HIDDEN_APPS) {
    out = out.replace(new RegExp(`<!-- app:${a.key} -->[\\s\\S]*?<!-- /app:${a.key} -->\\n?`, 'g'), '')
  }
  return out
}
