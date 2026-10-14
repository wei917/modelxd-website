// app/api/xsports/game/[pk]/route.ts — one game's live state (lib/mlb.ts,
// lib/nba.ts; ?league=nba for the NBA). Every open room polls this every
// 10 s; the CDN copy (8 s) and the instance cache mean the league's feed
// sees about one call per game per 8 s in total.

import { getGame, isGamePk } from '@/lib/mlb'
import { getNbaGame, isNbaId } from '@/lib/nba'

export const runtime = 'nodejs'

export async function GET(req: Request, { params }: { params: Promise<{ pk: string }> }) {
  const { pk } = await params
  const league = new URL(req.url).searchParams.get('league') ?? 'mlb'
  const ok = league === 'nba' ? isNbaId(pk) : league === 'mlb' && isGamePk(pk)
  if (!ok) return Response.json({ error: 'bad game id' }, { status: 400 })
  try {
    const game = league === 'nba' ? await getNbaGame(Number(pk)) : await getGame(Number(pk))
    // A finished game no longer changes; a live one changes every play.
    const maxAge = game.status === 'final' ? 300 : 8
    return Response.json(game, { headers: { 'Cache-Control': `public, s-maxage=${maxAge}, stale-while-revalidate=${maxAge}` } })
  } catch (e: any) {
    console.warn('[xsports/game]', league, pk, e?.message ?? e)
    return Response.json({ error: 'game unavailable' }, { status: 502 })
  }
}
