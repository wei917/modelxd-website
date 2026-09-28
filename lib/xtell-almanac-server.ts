// lib/xtell-almanac-server.ts — today's almanac, computed on the server
// (owner, Sep 28). The 黃曆 card used to compute it in the browser, which
// meant every visitor downloaded the calendar library (lunar-typescript)
// and saw 「載入中…」 until all the page's scripts had run. The server now
// computes it and the page arrives with the card filled in; the browser
// never loads the library.
//
// Cached for three dates: yesterday, today and tomorrow in UTC, the only
// dates anyone on Earth can be living at this moment (UTC−12 to UTC+14),
// in each of the five languages. Any other date (a visitor whose clock is
// wrong, a direct API call) is computed on demand and not kept. One entry
// takes well under a millisecond; the cache is about not recomputing on
// every page view, not about cost.
//
// Server-only: it imports the calendar library.

import { almanacFor, type Almanac } from './xtell-almanac'
import { localDateIn, validZone } from './xtell-time'
import type { Lang } from './lang'
const DAY = 86_400_000

/** The three UTC dates people can be living right now. */
export function almanacWindow(now = Date.now()): string[] {
  return [-1, 0, 1].map(k => new Date(now + k * DAY).toISOString().slice(0, 10))
}

const cache = new Map<string, Almanac>()
let cachedWindow = ''

/** The almanac for a date and language; the three live dates are cached. */
export function cachedAlmanac(date: string, lang: Lang, now = Date.now()): Almanac {
  const window = almanacWindow(now)
  const key = window.join()
  if (key !== cachedWindow) {
    // A new UTC day: drop the date that fell out of the window.
    for (const k of [...cache.keys()]) if (!window.includes(k.slice(0, 10))) cache.delete(k)
    cachedWindow = key
  }
  if (!window.includes(date)) return almanacFor(date, lang)
  const k = `${date}|${lang}`
  let a = cache.get(k)
  if (!a) { a = almanacFor(date, lang); cache.set(k, a) }
  return a
}

/** The almanac for a visitor's own day, from the time zone their
 *  connection reports (Vercel's x-vercel-ip-timezone), or null when there
 *  is none (local development): the card then asks /api/xtell/almanac. */
export function almanacForZone(tz: string | null | undefined, lang: Lang, now = Date.now()): Almanac | null {
  if (!tz || !validZone(tz)) return null
  return cachedAlmanac(localDateIn(tz, now), lang, now)
}

/** A YYYY-MM-DD the calendar library covers. */
export function validAlmanacDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const [y, m, d] = v.split('-').map(Number)
  if (y < 1901 || y > 2099) return false
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}
