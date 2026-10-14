// lib/kalshi.ts — Kalshi's market price for an MLB game (owner, Oct 12:
// "where is the polymarket data or gambling data? robinhood or taiwan
// 運動彩"; Kalshi chosen: Robinhood's prediction markets run on it, it is
// US-regulated, and its per-game markets are the deepest, ~$10M on ALCS
// Game 1). Shown as information only, beside MLB's own win probability;
// XSports never links to a place to bet.
//
// Public market data, no key: one call lists every open MLB game market
// (series KXMLBGAME), cached 15 s for all games and viewers. An event's
// ticker carries the date and both teams, KXMLBGAME-26OCT122000CLETB, and
// each market's ticker ends with its team's code, ...-CLE / ...-TB.

const API = 'https://api.elections.kalshi.com/trade-api/v2'
const CACHE_MS = 15_000

export interface MarketOdds {
  source: 'Kalshi'
  /** Implied chance, 0-100, from the last traded price of each team's
   *  contract (a contract pays $1 if that team wins). */
  away: number | null
  home: number | null
  /** Dollars traded on the game so far. */
  volume: number | null
}

// Kalshi's codes where they differ from MLB's abbreviations.
const ALIASES: string[][] = [['ARI', 'AZ'], ['CWS', 'CHW', 'CHA'], ['WSH', 'WAS'], ['ATH', 'OAK', 'A'], ['KC', 'KCR'], ['SD', 'SDP'], ['SF', 'SFG'], ['TB', 'TBR', 'TBA'],
  ['GS', 'GSW'], ['NY', 'NYK'], ['NO', 'NOP'], ['SA', 'SAS'], ['UTA', 'UTAH'], ['BKN', 'BRK']]
const norm = (code: string) => {
  const c = code.toUpperCase()
  return ALIASES.find(group => group.includes(c))?.[0] ?? c
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
/** "2026-10-12" → "26OCT12", the date part of an event ticker. */
const tickerDate = (d: string) => `${d.slice(2, 4)}${MONTHS[Number(d.slice(5, 7)) - 1]}${d.slice(8, 10)}`

/** Kalshi's game series per league. */
export const KALSHI_SERIES: Record<string, string> = { mlb: 'KXMLBGAME', nba: 'KXNBAGAME' }

const caches = new Map<string, { at: number; events: any[]; pending?: Promise<any[]> }>()

async function openEvents(series: string): Promise<any[]> {
  const hit = caches.get(series)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.events
  if (hit?.pending) return hit.pending
  const pending = (async () => {
    const res = await fetch(`${API}/events?series_ticker=${series}&status=open&with_nested_markets=true&limit=200`, { cache: 'no-store' })
    if (!res.ok) throw new Error(`Kalshi ${res.status}`)
    const j = await res.json()
    return Array.isArray(j?.events) ? j.events : []
  })()
  caches.set(series, { at: hit?.at ?? 0, events: hit?.events ?? [], pending })
  try {
    const events = await pending
    caches.set(series, { at: Date.now(), events })
    return events
  } catch (e) {
    // Keep the last good list; try again after the window.
    caches.set(series, { at: Date.now(), events: hit?.events ?? [] })
    throw e
  }
}

const pct = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 10 : null
}

/** The game's market, matched by its US date (YYYY-MM-DD, Eastern) and the
 *  two teams; null when Kalshi has no open market for it. */
export async function getMarketOdds(date: string, away: string, home: string, league = 'mlb'): Promise<MarketOdds | null> {
  const series = KALSHI_SERIES[league]
  if (!series) return null
  const events = await openEvents(series)
  const want = new Set([norm(away), norm(home)])
  const day = tickerDate(date)
  for (const e of events) {
    const ticker = String(e?.event_ticker ?? '')
    if (!ticker.startsWith(`${series}-${day}`)) continue
    const markets: any[] = Array.isArray(e?.markets) ? e.markets : []
    const byTeam = new Map(markets.map(m => [norm(String(m?.ticker ?? '').split('-').pop() ?? ''), m]))
    if (byTeam.size !== 2 || ![...want].every(t => byTeam.has(t))) continue
    const a = byTeam.get(norm(away)), h = byTeam.get(norm(home))
    const volume = markets.reduce((n, m) => n + (Number(m?.volume_fp) || 0), 0)
    return {
      source: 'Kalshi',
      away: pct(a?.last_price_dollars ?? a?.yes_bid_dollars),
      home: pct(h?.last_price_dollars ?? h?.yes_bid_dollars),
      volume: volume > 0 ? Math.round(volume) : null,
    }
  }
  return null
}
