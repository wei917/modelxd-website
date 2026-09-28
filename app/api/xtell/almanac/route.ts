// app/api/xtell/almanac/route.ts — one day's almanac, for a 黃曆 card whose
// visitor's own day differs from the one the page was rendered with (a VPN,
// a phone set to another zone, a tab left open past midnight) or whose
// language was switched. Public: a date and a language in, the day's page
// of the almanac out; no birthday, no account. The three live dates come
// from the server's cache (lib/xtell-almanac-server.ts); a day's almanac
// never changes, so the CDN may keep it for a day.

export const runtime = 'nodejs'

import { cachedAlmanac, validAlmanacDate } from '@/lib/xtell-almanac-server'
import { LANG_CODES, type Lang } from '@/lib/lang'

export async function GET(req: Request) {
  const u = new URL(req.url)
  const date = u.searchParams.get('date')
  const lang = u.searchParams.get('lang') as Lang | null
  if (!validAlmanacDate(date)) return Response.json({ error: 'date must be YYYY-MM-DD between 1901 and 2099' }, { status: 400 })
  if (!lang || !LANG_CODES.includes(lang)) return Response.json({ error: 'unknown lang' }, { status: 400 })
  try {
    return Response.json({ almanac: cachedAlmanac(date, lang) }, {
      headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400' },
    })
  } catch (e: any) {
    // Not cached: the card retries, and a later request may succeed.
    console.warn('[xtell/almanac] failed:', date, lang, e?.message ?? e)
    return Response.json({ error: 'almanac unavailable' }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  }
}
