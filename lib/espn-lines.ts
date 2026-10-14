// lib/espn-lines.ts — the sportsbook line ESPN's scoreboards carry for each
// game (DraftKings: the spread or money line, and the total). Information
// only, shown on the scores list and in a game's odds tab; XSports never
// links to a place to bet. ESPN's public site API, prototype like the rest.

const API: Record<string, string> = {
  mlb: 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard',
  nba: 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard',
}
const CACHE_MS = 60_000

export interface Line { provider: string; spread: string | null; total: number | null }

// ESPN's codes where they differ from MLB's (the NBA cards are ESPN's own).
const ALIAS: Record<string, string> = { CHW: 'CWS', WAS: 'WSH', AZ: 'ARI', OAK: 'ATH', KCR: 'KC', SDP: 'SD', SFG: 'SF', TBR: 'TB' }
const norm = (c: string) => ALIAS[c.toUpperCase()] ?? c.toUpperCase()

const cache = new Map<string, { at: number; lines: Map<string, Line>; pending?: Promise<Map<string, Line>> }>()

/** Lines for one league and US day, keyed "AWAY@HOME". */
export async function getLines(league: string, date: string): Promise<Map<string, Line>> {
  const url = API[league]
  if (!url) return new Map()
  const key = `${league}:${date}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.lines
  if (hit?.pending) return hit.pending
  const pending = (async () => {
    // No custom User-Agent: ESPN answers 403 to one that names a site.
    const res = await fetch(`${url}?dates=${date.replace(/-/g, '')}`, { cache: 'no-store' })
    if (!res.ok) throw new Error(`ESPN ${res.status}`)
    const j = await res.json()
    const lines = new Map<string, Line>()
    for (const e of (j.events ?? []) as any[]) {
      const comp = e?.competitions?.[0]
      const o = comp?.odds?.[0]
      if (!o || (!o.details && typeof o.overUnder !== 'number')) continue
      const cs: any[] = comp.competitors ?? []
      const away = cs.find(c => c.homeAway === 'away')?.team?.abbreviation, home = cs.find(c => c.homeAway === 'home')?.team?.abbreviation
      if (!away || !home) continue
      lines.set(`${norm(away)}@${norm(home)}`, {
        provider: String(o.provider?.name ?? o.provider?.displayName ?? 'Sportsbook').replace(/^Draft Kings$/, 'DraftKings'),
        spread: o.details ? String(o.details) : null,
        total: typeof o.overUnder === 'number' ? o.overUnder : null,
      })
    }
    return lines
  })()
  cache.set(key, { at: hit?.at ?? 0, lines: hit?.lines ?? new Map(), pending })
  try {
    const lines = await pending
    cache.set(key, { at: Date.now(), lines })
    return lines
  } catch (e) {
    cache.set(key, { at: Date.now(), lines: hit?.lines ?? new Map() })
    throw e
  }
}

export async function lineFor(league: string, date: string, away: string, home: string): Promise<Line | null> {
  const lines = await getLines(league, date).catch(() => new Map<string, Line>())
  return lines.get(`${norm(away)}@${norm(home)}`) ?? null
}
