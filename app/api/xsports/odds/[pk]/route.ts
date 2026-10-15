// app/api/xsports/odds/[pk]/route.ts — one game's odds over time for the
// 賠率 tab's timeline (lib/xsports-odds-history.ts; ?league=nba for the NBA).
// An open 賠率 tab asks every 30 s; the CDN copy (20 s) and the instance
// cache keep the markets' and leagues' feeds to about one call per game per
// 20 s in total.

import { isGamePk } from '@/lib/mlb'
import { isNbaId } from '@/lib/nba'
import { oddsHistory } from '@/lib/xsports-odds-history'

export const runtime = 'nodejs'

export async function GET(req: Request, { params }: { params: Promise<{ pk: string }> }) {
  const { pk } = await params
  const league = new URL(req.url).searchParams.get('league') ?? 'mlb'
  const ok = league === 'nba' ? isNbaId(pk) : league === 'mlb' && isGamePk(pk)
  if (!ok) return Response.json({ error: 'bad game id' }, { status: 400 })
  try {
    const h = await oddsHistory(league === 'nba' ? 'nba' : 'mlb', Number(pk))
    // A finished game's history no longer changes.
    const maxAge = h.status === 'final' ? 300 : 20
    return Response.json(h, { headers: { 'Cache-Control': `public, s-maxage=${maxAge}, stale-while-revalidate=${maxAge}` } })
  } catch (e: any) {
    console.warn('[xsports/odds]', league, pk, e?.message ?? e)
    return Response.json({ error: 'odds unavailable' }, { status: 502 })
  }
}
