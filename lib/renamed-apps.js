// lib/renamed-apps.js — apps that moved to a new address (owner, Oct 20:
// "can we build a routing feature to route old url to the new one?").
//
// Every entry forwards the old path and everything under it to the new one,
// keeping the rest of the path and the query: /xdev/docs → /xkit/docs,
// /xtell?t=bazi → /xoracle?t=bazi. A #fragment stays too (the browser keeps
// it across a redirect). next.config.js turns this list into redirects, which
// Next runs before proxy.ts, so the site password and the hidden-app gate
// then see the new address.
//
// `subpaths: false` forwards the page itself only: X先知's pictures live under
// /xtell/... in public/ (temple art, tarot cards, share previews), and Next runs
// redirects before it serves public/, so forwarding /xtell/* would break them.
// `subpaths: 'one'` forwards the page and the pages ONE level under it, never
// deeper: /xdirect/music-video (a template page) moves, while
// /xdirect/skills/<file> and /xdirect/styles/<file> (public/xdirect, linked
// from every skill's SKILL.md) stay where they are.
//
// MOVED_TABS is the same idea for tabs that lived in a page's QUERY
// (/xcreate?type=film): Next matches the query with `has`, and the original
// query rides along to the new page (/xcreate?film=<id> → /xfilm/auto?film=<id>).
// The first match wins, so the more specific entries come first.
//
// Temporary (307) while the names are new, so a change of mind costs nothing;
// flip `permanent` once a name has settled. API routes never move: a
// developer's code calls them (/api/xdev/* stays /api/xdev/*).
//
// Plain CommonJS so next.config.js can require it; the app imports it too.

/** @type {{ from: string, to: string, since: string, permanent: boolean, subpaths: boolean | 'one' }[]} */
const RENAMED_APPS = [
  // XDev → XKit (owner, Oct 17-20: one app per letter; D keeps XDuel).
  { from: '/xdev', to: '/xkit', since: '2026-10-20', permanent: false, subpaths: true },
  // XTell → XOracle (owner, Oct 20; X先知 / X占い / X운세 unchanged). The page
  // has no sub-pages; /xtell/... is pictures (above). xtell.modelxd.com, the
  // door, keeps its name: share links and ads point there.
  { from: '/xtell', to: '/xoracle', since: '2026-10-20', permanent: false, subpaths: false },
  // XDirect + XCut → XFilm (owner, Oct 16-22: "advanced video/audio multimedia
  // should go XFilm"; 導演 and 剪輯 are two of its four tabs). The story bible
  // is XFilm's, under 導演. API routes stay (/api/xdirector/*, /api/xcut/*).
  { from: '/xdirect/bible', to: '/xfilm/bible', since: '2026-10-22', permanent: false, subpaths: true },
  { from: '/xdirect', to: '/xfilm/direct', since: '2026-10-22', permanent: false, subpaths: 'one' },
  { from: '/xdirector', to: '/xfilm/direct', since: '2026-10-22', permanent: false, subpaths: false },
  { from: '/xcut', to: '/xfilm/edit', since: '2026-10-22', permanent: false, subpaths: true },
]

/** @type {{ from: string, key: string, value?: string, to: string, since: string, permanent: boolean }[]} */
const MOVED_TABS = [
  // X創作's 成片 and 同款 → XFilm's 自動成片 and 同款 (owner, Oct 19: "文字,
  // 圖片, 影片, 音訊 in XCreate, others in XFilm"). A row's own ?id= link is
  // forwarded by the studio itself, which has to read the row to know.
  { from: '/xcreate', key: 'film', to: '/xfilm/auto', since: '2026-10-22', permanent: false },
  { from: '/xcreate', key: 'type', value: 'film', to: '/xfilm/auto', since: '2026-10-22', permanent: false },
  { from: '/xcreate', key: 'remake', to: '/xfilm/remake', since: '2026-10-22', permanent: false },
  { from: '/xcreate', key: 'fan', to: '/xfilm/remake', since: '2026-10-22', permanent: false },
  { from: '/xcreate', key: 'type', value: 'remake', to: '/xfilm/remake', since: '2026-10-22', permanent: false },
  // The director's oldest links (Agent Mode inside X創作, July 31 - Aug 5).
  { from: '/xcreate', key: 'agent', value: '1', to: '/xfilm/direct', since: '2026-10-22', permanent: false },
  { from: '/xcreate', key: 'c', to: '/xfilm/direct', since: '2026-10-22', permanent: false },
]

/** The new path for an old one, or null (the path itself, or what under it
 *  its `subpaths` forwards). */
function renamedPath(pathname) {
  for (const r of RENAMED_APPS) {
    if (pathname === r.from) return r.to
    if (!r.subpaths || !pathname.startsWith(r.from + '/')) continue
    const rest = pathname.slice(r.from.length)
    if (r.subpaths === true || !rest.slice(1).includes('/')) return r.to + rest
  }
  return null
}

/** Next's redirects for both lists (next.config.js). */
function renamedRedirects() {
  return [
    ...MOVED_TABS.map(m => ({ source: m.from, has: [{ type: 'query', key: m.key, ...(m.value ? { value: m.value } : {}) }], destination: m.to, permanent: m.permanent })),
    ...RENAMED_APPS.flatMap(r => [
      { source: r.from, destination: r.to, permanent: r.permanent },
      ...(r.subpaths === true ? [{ source: `${r.from}/:path*`, destination: `${r.to}/:path*`, permanent: r.permanent }]
        : r.subpaths === 'one' ? [{ source: `${r.from}/:page`, destination: `${r.to}/:page`, permanent: r.permanent }] : []),
    ]),
  ]
}

module.exports = { RENAMED_APPS, MOVED_TABS, renamedPath, renamedRedirects }
