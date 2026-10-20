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
// Temporary (307) while the names are new, so a change of mind costs nothing;
// flip `permanent` once a name has settled. API routes never move: a
// developer's code calls them (/api/xdev/* stays /api/xdev/*).
//
// Plain CommonJS so next.config.js can require it; the app imports it too.

/** @type {{ from: string, to: string, since: string, permanent: boolean }[]} */
const RENAMED_APPS = [
  // XDev → XKit (owner, Oct 17-20: one app per letter; D keeps XDuel).
  { from: '/xdev', to: '/xkit', since: '2026-10-20', permanent: false },
]

/** The new path for an old one, or null (the path itself or anything under it). */
function renamedPath(pathname) {
  for (const r of RENAMED_APPS) {
    if (pathname === r.from || pathname.startsWith(r.from + '/')) return r.to + pathname.slice(r.from.length)
  }
  return null
}

module.exports = { RENAMED_APPS, renamedPath }
