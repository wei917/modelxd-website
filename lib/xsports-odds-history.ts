// lib/xsports-odds-history.ts — the 賠率 tab's timeline (owner, Oct 14:
// "賠率。應該要有時間軸才對 不是現在的一個數字"): each source's chance for the
// away team over time. MLB's own win model (ESPN's for the NBA) after every
// plate appearance or play; Kalshi's and Polymarket's prices each minute
// around the game and each hour before it since their markets opened.
// Information only; XSports never links to a place to bet.

import { getGame, getWinHistory } from './mlb'
import { getNbaGame, nbaWinHistory } from './nba'
import { getMarketHistory, type PricePoint } from './kalshi'
import { getPolyHistory } from './polymarket'

export interface OddsHistory {
  away: string
  home: string
  status: string
  /** First pitch or tip-off: the first play's time once there is one, else
   *  the schedule's (ms). */
  start: number | null
  model: PricePoint[]
  kalshi: PricePoint[]
  poly: PricePoint[]
  /** Scoring plays on the model's line (MLB): the score after each. */
  marks: { t: number; away: number; awayScore: number; homeScore: number }[]
  /** Where each inning (MLB) or period (NBA) began. */
  ticks: { t: number; n: number }[]
  asOf: number
}

const cache = new Map<string, { at: number; ttl: number; value: OddsHistory | null; pending?: Promise<OddsHistory> }>()

/** One game's timeline, cached 20 s while it can still move and 10 minutes
 *  once it is over, for every viewer on this instance. Each source fails
 *  soft: a market that cannot be read is simply missing from the chart. */
export async function oddsHistory(league: 'mlb' | 'nba', pk: number): Promise<OddsHistory> {
  const key = `${league}:${pk}`
  const hit = cache.get(key)
  if (hit?.value && Date.now() - hit.at < hit.ttl) return hit.value
  if (hit?.pending) return hit.pending
  const pending = (async (): Promise<OddsHistory> => {
    const g = league === 'nba' ? await getNbaGame(pk) : await getGame(pk)
    const soft = <T>(p: Promise<T>, empty: T, what: string) => p.catch(e => { console.warn('[xsports/odds]', what, league, pk, e?.message ?? e); return empty })
    const date = g.usDate ?? null
    const [model, kalshi, poly] = await Promise.all([
      league === 'nba'
        ? Promise.resolve((() => { const w = nbaWinHistory(pk); return { points: w.points, scoring: [], innings: w.periods } })())
        : soft(getWinHistory(pk), { points: [], scoring: [], innings: [] }, 'model'),
      date ? soft(getMarketHistory(date, g.away.abbr, g.home.abbr, league, g.start), [], 'kalshi') : Promise.resolve([]),
      date ? soft(getPolyHistory(league, date, g.away.abbr, g.home.abbr, g.start), [], 'polymarket') : Promise.resolve([]),
    ])
    const scheduled = Date.parse(g.start)
    return {
      away: g.away.abbr,
      home: g.home.abbr,
      status: g.status,
      start: model.innings[0]?.t ?? (Number.isFinite(scheduled) ? scheduled : null),
      model: model.points,
      kalshi,
      poly,
      marks: model.scoring,
      ticks: model.innings,
      asOf: Date.now(),
    }
  })()
  cache.set(key, { at: hit?.at ?? 0, ttl: hit?.ttl ?? 0, value: hit?.value ?? null, pending })
  try {
    const value = await pending
    cache.set(key, { at: Date.now(), ttl: value.status === 'final' ? 600_000 : 20_000, value })
    if (cache.size > 300) cache.delete(cache.keys().next().value!)
    return value
  } catch (e) {
    cache.delete(key)
    throw e
  }
}
