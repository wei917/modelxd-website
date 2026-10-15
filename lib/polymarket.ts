// lib/polymarket.ts — Polymarket's price for a game (owner, Oct 12: "I don't
// see polymarket data"). Information only, beside MLB's model and Kalshi;
// XSports never links to a place to bet. Polymarket is offshore for Taiwan
// users, which is why nothing here invites anyone to trade.
//
// Public, no key. A game's event slug is
// `<league>-<away>-<home>-<US date>`, e.g. mlb-cle-tb-2026-10-13, and its
// first market's outcomes are the two teams with their prices.

const API = 'https://gamma-api.polymarket.com'
const CACHE_MS = 15_000

export interface PolyOdds {
  source: 'Polymarket'
  away: number | null
  home: number | null
  volume: number | null
}

// Polymarket's slug codes where they differ from the league's abbreviations.
const ALIASES: string[][] = [['ari', 'az'], ['cws', 'chw'], ['wsh', 'was'], ['ath', 'oak'], ['kc', 'kcr'], ['sd', 'sdp'], ['sf', 'sfg'], ['tb', 'tbr'],
  ['gs', 'gsw'], ['ny', 'nyk'], ['no', 'nop'], ['sa', 'sas'], ['uta', 'utah'], ['bkn', 'bk']]

// One small lookup per game by its slug (~30 KB, ~0.2 s), cached 15 s, misses
// too: the league-wide list was 2.2 MB of season-long markets for the NBA
// and made the first load of the scores slow (owner, Oct 13).
const bySlug = new Map<string, { at: number; event: any | null; pending?: Promise<any | null> }>()

async function eventBySlug(slug: string): Promise<any | null> {
  const hit = bySlug.get(slug)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.event
  if (hit?.pending) return hit.pending
  const pending = (async () => {
    const res = await fetch(`${API}/events?slug=${encodeURIComponent(slug)}`, { cache: 'no-store' })
    if (!res.ok) throw new Error(`Polymarket ${res.status}`)
    const j = await res.json()
    return Array.isArray(j) && j[0] ? j[0] : null
  })()
  bySlug.set(slug, { at: hit?.at ?? 0, event: hit?.event ?? null, pending })
  try {
    const event = await pending
    bySlug.set(slug, { at: Date.now(), event })
    if (bySlug.size > 2000) bySlug.clear()
    return event
  } catch (e) {
    bySlug.set(slug, { at: Date.now(), event: hit?.event ?? null })
    throw e
  }
}

/** The codes Polymarket may use for a team: ours first, then its aliases. */
const variants = (code: string) => {
  const c = code.toLowerCase()
  const group = ALIASES.find(g => g.includes(c))
  return group ? [c, ...group.filter(x => x !== c)] : [c]
}

const parse = (v: unknown): any[] => {
  if (Array.isArray(v)) return v
  try { const x = JSON.parse(String(v)); return Array.isArray(x) ? x : [] } catch { return [] }
}

/** The game's price, matched by league, US date (YYYY-MM-DD) and the two
 *  team codes; null when Polymarket has no open game market for it. */
export async function getPolyOdds(league: string, date: string, away: string, home: string): Promise<PolyOdds | null> {
  // Every spelling at once (at most four small calls), the first that exists.
  const slugs = variants(away).flatMap(a => variants(home).map(h => `${league}-${a}-${h}-${date}`))
  const found = await Promise.all(slugs.map(sl => eventBySlug(sl).catch(() => null)))
  const e: any = found.find(Boolean) ?? null
  const market = e?.markets?.[0]
  if (!market || market.closed) return null
  const outcomes = parse(market.outcomes).map(String)
  const prices = parse(market.outcomePrices).map(Number)
  if (outcomes.length !== 2 || prices.length !== 2) return null
  // The slug's order is away then home, and so are the outcomes.
  const pct = (n: number) => (Number.isFinite(n) ? Math.round(n * 1000) / 10 : null)
  // The event's prices can trail the order book by half an hour in a live
  // game (Oct 14: 45.5% beside a book at 53.5%, which the timeline showed);
  // the book's midpoint for the away team is current.
  const token = String(parse(market.clobTokenIds)[0] ?? '')
  const mid = token ? await midpoint(token).catch(() => null) : null
  if (mid !== null) return { source: 'Polymarket', away: pct(mid), home: pct(1 - mid), volume: Math.round(Number(e.volume) || 0) || null }
  return { source: 'Polymarket', away: pct(prices[0]), home: pct(prices[1]), volume: Math.round(Number(e.volume) || 0) || null }
}

const mids = new Map<string, { at: number; mid: number | null }>()
/** The order book's midpoint for one outcome (0-1), cached 15 s. */
async function midpoint(token: string): Promise<number | null> {
  const hit = mids.get(token)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.mid
  const res = await fetch(`https://clob.polymarket.com/midpoint?token_id=${token}`, { cache: 'no-store' })
  const n = res.ok ? Number((await res.json())?.mid) : NaN
  const mid = Number.isFinite(n) && n > 0 && n < 1 ? n : null
  mids.set(token, { at: Date.now(), mid })
  if (mids.size > 2000) mids.clear()
  return mid
}

// ── Over time (the 賠率 tab's timeline, Oct 14) ───────────────────────────

const CLOB = 'https://clob.polymarket.com'

/** Polymarket's price of the away team over time: each minute from an hour
 *  before the start to five hours after it (or the last three hours before a
 *  start is known), each hour before that since the market opened. Kept after
 *  the market closes. Empty when there is no market. Points as in
 *  lib/kalshi (PricePoint: ms, the away team's chance 0-100). */
export async function getPolyHistory(league: string, date: string, away: string, home: string, start?: string | null): Promise<{ t: number; away: number }[]> {
  const slugs = variants(away).flatMap(a => variants(home).map(h => `${league}-${a}-${h}-${date}`))
  const found = await Promise.all(slugs.map(sl => eventBySlug(sl).catch(() => null)))
  const e: any = found.find(Boolean) ?? null
  // The slug's order is away then home, and so are the outcomes and tokens.
  const token = String(parse(e?.markets?.[0]?.clobTokenIds)[0] ?? '')
  if (!token) return []
  const now = Math.floor(Date.now() / 1000)
  const s = start ? Math.floor(Date.parse(start) / 1000) : NaN
  const minFrom = Number.isFinite(s) ? s - 3600 : now - 3 * 3600
  const minTo = Math.min(now, Number.isFinite(s) ? s + 5 * 3600 : now)
  const history = async (q: string) => {
    const res = await fetch(`${CLOB}/prices-history?market=${token}&${q}`, { cache: 'no-store' })
    if (!res.ok) throw new Error(`Polymarket ${res.status}`)
    const j = await res.json()
    const list: any[] = Array.isArray(j?.history) ? j.history : []
    return list.map(p => ({ t: Number(p?.t) * 1000, away: Number(p?.p) * 100 })).filter(p => Number.isFinite(p.t) && Number.isFinite(p.away))
  }
  const [hours, minutes] = await Promise.all([
    history('interval=max&fidelity=60'),
    minTo > minFrom ? history(`startTs=${minFrom}&endTs=${minTo}&fidelity=1`) : Promise.resolve([]),
  ])
  return [...hours.filter(p => p.t < minFrom * 1000), ...minutes]
}
