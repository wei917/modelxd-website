// app/api/xsports/games/route.ts — one day's games for a league, with both
// prediction markets' prices on every game not yet final. Public (the
// leagues' public schedules); the CDN keeps a copy for 15 s so a crowd of
// open pages costs one upstream call.

import { getSchedule, isMlbDate, mlbToday, oddsFor, type GameCard } from '@/lib/mlb'
import { getNbaSchedule } from '@/lib/nba'
import { lineFor } from '@/lib/espn-lines'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams
  const league = q.get('league') ?? 'mlb'
  if (league !== 'mlb' && league !== 'nba') return Response.json({ error: 'bad league' }, { status: 400 })
  const date = q.get('date') ?? mlbToday()
  if (!isMlbDate(date)) return Response.json({ error: 'bad date' }, { status: 400 })
  try {
    const cards: GameCard[] = league === 'nba' ? await getNbaSchedule(date) : await getSchedule(date)
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
