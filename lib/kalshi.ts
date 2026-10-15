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
  const hit = matchEvent(await openEvents(series), series, tickerDate(date), away, home)
  if (!hit) return null
  return {
    source: 'Kalshi',
    away: pct(hit.away?.last_price_dollars ?? hit.away?.yes_bid_dollars),
    home: pct(hit.home?.last_price_dollars ?? hit.home?.yes_bid_dollars),
    volume: hit.volume > 0 ? Math.round(hit.volume) : null,
  }
}

/** The game's two markets among these events (dated by the ticker's day,
 *  matched by both teams' codes), with the dollars traded on them. */
function matchEvent(events: any[], series: string, day: string, away: string, home: string): { away: any; home: any; volume: number } | null {
  const want = new Set([norm(away), norm(home)])
  for (const e of events) {
    const ticker = String(e?.event_ticker ?? '')
    if (!ticker.startsWith(`${series}-${day}`)) continue
    const markets: any[] = Array.isArray(e?.markets) ? e.markets : []
    const byTeam = new Map(markets.map(m => [norm(String(m?.ticker ?? '').split('-').pop() ?? ''), m]))
    if (byTeam.size !== 2 || ![...want].every(t => byTeam.has(t))) continue
    return { away: byTeam.get(norm(away)), home: byTeam.get(norm(home)), volume: markets.reduce((n, m) => n + (Number(m?.volume_fp) || 0), 0) }
  }
  return null
}

// ── Over time (the 賠率 tab's timeline, Oct 14) ───────────────────────────

/** One price: when (ms) and the away team's chance, 0-100. */
export interface PricePoint { t: number; away: number }

/** Every spelling Kalshi may use for a team. */
const codes = (code: string) => {
  const c = code.toUpperCase()
  return ALIASES.find(group => group.includes(c)) ?? [c]
}

/** "2026-10-15T00:00:00Z" → "2000": an event ticker's start, Eastern. */
const etTime = (iso: string) => {
  try { return new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)).replace(':', '') } catch { return '' }
}

/** A game's markets: from the open list, or once it is over (the list
 *  holds open markets only) by its event ticker, <series>-<day><HHMM ET>
 *  <AWAY><HOME>, e.g. KXMLBGAME-26OCT132000CLETB. */
async function gameMarkets(date: string, away: string, home: string, league: string, start?: string | null) {
  const series = KALSHI_SERIES[league]
  if (!series) return null
  const day = tickerDate(date)
  const open = matchEvent(await openEvents(series).catch(() => []), series, day, away, home)
  if (open) return { series, ...open }
  const hhmm = start ? etTime(start) : ''
  if (!hhmm) return null
  for (const a of codes(away)) for (const h of codes(home)) {
    const res = await fetch(`${API}/events/${series}-${day}${hhmm}${a}${h}?with_nested_markets=true`, { cache: 'no-store' })
    if (!res.ok) continue
    const j = await res.json()
    const hit = matchEvent(j?.event ? [j.event] : [], series, day, away, home)
    if (hit) return { series, ...hit }
  }
  return null
}

/** A candle's closing price in percent: the last trade, else the middle of
 *  the closing bid and ask. */
const candlePct = (c: any): number | null => {
  const last = Number(c?.price?.close_dollars)
  if (Number.isFinite(last) && last > 0) return last * 100
  const bid = Number(c?.yes_bid?.close_dollars), ask = Number(c?.yes_ask?.close_dollars)
  return bid > 0 && ask > 0 ? ((bid + ask) / 2) * 100 : null
}

/** Kalshi's price of the away team's contract over time: each minute from
 *  an hour before the start to five hours after it (or the last three hours
 *  before a start is known), each hour before that back to when the market
 *  opened (at most a week). Empty when there is no market. */
export async function getMarketHistory(date: string, away: string, home: string, league: string, start?: string | null): Promise<PricePoint[]> {
  const m = await gameMarkets(date, away, home, league, start)
  const ticker = String(m?.away?.ticker ?? '')
  if (!m || !ticker) return []
  const now = Math.floor(Date.now() / 1000)
  const opened = Math.floor(Date.parse(String(m.away?.open_time ?? '')) / 1000) || now - 7 * 86400
  const from = Math.max(opened, now - 7 * 86400)
  const s = start ? Math.floor(Date.parse(start) / 1000) : NaN
  const minFrom = Math.max(from, Number.isFinite(s) ? s - 3600 : now - 3 * 3600)
  const minTo = Math.min(now, Number.isFinite(s) ? s + 5 * 3600 : now)
  const candles = async (a: number, b: number, period: number): Promise<PricePoint[]> => {
    if (b <= a) return []
    const res = await fetch(`${API}/series/${m.series}/markets/${ticker}/candlesticks?start_ts=${a}&end_ts=${b}&period_interval=${period}`, { cache: 'no-store' })
    if (!res.ok) throw new Error(`Kalshi ${res.status}`)
    const j = await res.json()
    const list: any[] = Array.isArray(j?.candlesticks) ? j.candlesticks : []
    return list.map(c => ({ t: Number(c?.end_period_ts) * 1000, away: candlePct(c) }))
      .filter((p): p is PricePoint => Number.isFinite(p.t) && p.away !== null)
  }
  const [hours, minutes] = await Promise.all([candles(from, minFrom, 60), candles(minFrom, minTo, 1)])
  return [...hours, ...minutes]
}
