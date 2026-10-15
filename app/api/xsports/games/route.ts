// app/api/xsports/games/route.ts — one day's games for a league, with both
// prediction markets' prices on every game not yet final. Public (the
// leagues' public schedules); the CDN keeps a copy for 15 s so a crowd of
// open pages costs one upstream call.
//   ?league=mlb|nba&date=YYYY-MM-DD[&tz=<IANA zone>]
// With tz (the page always sends the browser's), the day is the viewer's:
// the games that start on it there, from the one or two US dates it spans
// (lib/xsports-day.ts). Without, the league's own US date.

import { getSchedule, isMlbDate, mlbToday, oddsFor, type GameCard } from '@/lib/mlb'
import { getNbaSchedule } from '@/lib/nba'
import { lineFor } from '@/lib/espn-lines'
import { viewerDay, zoneOf } from '@/lib/xsports-day'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams
  const league = q.get('league') ?? 'mlb'
  if (league !== 'mlb' && league !== 'nba') return Response.json({ error: 'bad league' }, { status: 400 })
  const date = q.get('date') ?? mlbToday()
  if (!isMlbDate(date)) return Response.json({ error: 'bad date' }, { status: 400 })
  try {
    const day = (d: string) => (league === 'nba' ? getNbaSchedule(d) : getSchedule(d))
    const tz = zoneOf(q.get('tz'))
    let cards: GameCard[]
    if (tz) {
      const { from, to, usDates } = viewerDay(date, tz)
      const seen = new Set<number>()
      cards = (await Promise.all(usDates.map(day))).flat().filter(g => {
        const t = Date.parse(g.start)
        if (!(t >= from && t < to) || seen.has(g.pk)) return false
        seen.add(g.pk)
        return true
      })
    } else cards = await day(date)
    // Two cached list calls (Kalshi, Polymarket) cover the whole day.
    const games = await Promise.all(cards.map(async g => {
      const day = g.usDate ?? date
      if (g.status === 'final') return g
      // The NBA's line comes with ESPN's scoreboard; MLB's needs ESPN's.
      const [odds, line] = await Promise.all([oddsFor(league, day, g.away.abbr, g.home.abbr), g.line !== undefined ? g.line : lineFor(league, day, g.away.abbr, g.home.abbr)])
      return { ...g, odds, line }
    }))
    return Response.json({ league, date, games }, { headers: { 'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=15' } })
  } catch (e: any) {
    console.warn('[xsports/games]', league, e?.message ?? e)
    return Response.json({ error: 'schedule unavailable' }, { status: 502 })
  }
}
