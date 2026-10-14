// app/api/xsports/highlights/[pk]/route.ts — a game's short video highlights
// (lib/xsports-highlights.ts): GET ?league=mlb|nba → { clips, hiddenByRegion,
// down }. Public, like the game itself. Which clips may play depends on the
// viewer's country (Vercel's geo header), so the answer is not shared by the
// CDN; the sources behind it are cached per instance.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { getGame, isGamePk } from '@/lib/mlb'
import { getNbaGame, isNbaId } from '@/lib/nba'
import { highlightsFor } from '@/lib/xsports-highlights'

export async function GET(req: Request, { params }: { params: Promise<{ pk: string }> }) {
  const { pk } = await params
  const league = new URL(req.url).searchParams.get('league') === 'nba' ? 'nba' : 'mlb'
  if (!(league === 'nba' ? isNbaId(pk) : isGamePk(pk))) return Response.json({ error: 'bad_game' }, { status: 400 })
  const country = req.headers.get('x-vercel-ip-country')?.toUpperCase() || null
  try {
    const g = league === 'nba' ? await getNbaGame(Number(pk)) : await getGame(Number(pk))
    const h = await highlightsFor(g, country)
    return Response.json(h, { headers: { 'Cache-Control': 'private, max-age=20' } })
  } catch (e: any) {
    console.warn('[xsports/highlights]', league, pk, e?.message ?? e)
    return Response.json({ clips: [], hiddenByRegion: 0, down: true }, { status: 200, headers: { 'Cache-Control': 'no-store' } })
  }
}
