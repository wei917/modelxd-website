// lib/nba.ts — the NBA for XSports, from ESPN's public site API (owner,
// Oct 12: "no NBA pregame"). NBA's own feed (cdn.nba.com) answers Access
// Denied to servers. ESPN's is unofficial too, so like MLB's it is the
// PROTOTYPE feed; a licensed one replaces it before launch.
//
// The shapes are lib/mlb.ts's (GameCard, GameState), so the page, the
// chats and the commentator handle one kind of game: `inning` is the
// period, `clock` the game clock, plays carry their clock, and the box score
// is `nbaBox` as ESPN labels it (MIN PTS FG 3PT FT REB AST ...).

import { oddsFor, type GameCard, type GameState, type PlayEvent, type TeamLine, type GameStatus, type NbaPlayerRow } from './mlb'

const API = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba'
const CACHE_MS = 8_000

type Entry<T> = { at: number; value?: T; pending?: Promise<T> }
const games = new Map<string, Entry<GameState>>()
const days = new Map<string, Entry<GameCard[]>>()

async function cached<T>(map: Map<string, Entry<T>>, key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = map.get(key)
  if (hit?.value !== undefined && Date.now() - hit.at < ttl) return hit.value
  if (hit?.pending) return hit.pending
  const pending = load()
    .then(value => { map.set(key, { at: Date.now(), value }); return value })
    .catch(err => {
      if (hit?.value !== undefined) { map.set(key, { at: hit.at, value: hit.value }); return hit.value }
      map.delete(key)
      throw err
    })
  map.set(key, { at: hit?.at ?? 0, value: hit?.value, pending })
  if (map.size > 300) { const first = map.keys().next().value; if (first !== undefined) map.delete(first) }
  return pending
}

async function getJson(url: string): Promise<any> {
  // No custom User-Agent: ESPN answers 403 to one that names a site.
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`ESPN ${res.status}`)
  return res.json()
}

export const isNbaId = (v: unknown): boolean => /^\d{6,12}$/.test(String(v ?? ''))

const statusOf = (state: unknown): GameStatus => (state === 'in' ? 'live' : state === 'post' ? 'final' : state === 'pre' ? 'preview' : 'other')

function teamOf(c: any): TeamLine {
  const t = c?.team ?? {}
  const rec = (c?.records ?? c?.record ?? []).find?.((r: any) => r?.type === 'total' || r?.name === 'overall')
  return {
    id: Number(t.id) || 0,
    abbr: String(t.abbreviation ?? '').toUpperCase(),
    club: String(t.shortDisplayName ?? t.name ?? ''),
    name: String(t.displayName ?? ''),
    color: t.color ? `#${String(t.color).replace('#', '')}` : null,
    runs: c?.score !== undefined && c?.score !== '' ? Number(c.score) : null,
    hits: null,
    errors: null,
    record: rec?.summary ?? null,
  }
}

function cardOfEvent(e: any): GameCard {
  const comp = e?.competitions?.[0] ?? {}
  const cs: any[] = comp.competitors ?? []
  const away = cs.find(c => c.homeAway === 'away'), home = cs.find(c => c.homeAway === 'home')
  const st = e?.status ?? comp.status ?? {}
  const pre = e?.season?.slug === 'preseason'
  return {
    league: 'nba',
    pk: Number(e.id),
    start: String(e.date ?? ''),
    status: statusOf(st.type?.state),
    detailed: String(st.type?.shortDetail ?? st.type?.description ?? ''),
    away: teamOf(away),
    home: teamOf(home),
    inning: Number(st.period) || null,
    half: null,
    outs: null,
    clock: st.displayClock ?? null,
    series: pre ? 'Preseason' : (comp.notes?.[0]?.headline ?? null),
    seriesNote: comp.series?.summary ?? null,
    venue: comp.venue?.fullName ?? null,
    usDate: null,
    line: lineOf(comp.odds?.[0]),
  }
}

/** DraftKings' line as ESPN's scoreboard carries it (spread or money line,
 *  and the total); taken here so the scores need no second ESPN call. */
function lineOf(o: any): GameCard['line'] {
  if (!o || (!o.details && typeof o.overUnder !== 'number')) return null
  return { provider: String(o.provider?.name ?? 'Sportsbook').replace(/^Draft Kings$/, 'DraftKings'), spread: o.details ? String(o.details) : null, total: typeof o.overUnder === 'number' ? o.overUnder : null }
}

/** One US day's NBA games (YYYY-MM-DD). */
export async function getNbaSchedule(date: string): Promise<GameCard[]> {
  return cached(days, date, 20_000, async () => {
    const d = await getJson(`${API}/scoreboard?dates=${date.replace(/-/g, '')}`)
    return ((d.events ?? []) as any[]).map(e => ({ ...cardOfEvent(e), usDate: date })).sort((a, b) => a.start.localeCompare(b.start))
  })
}

// Plays worth a line in the chat: every score, turnovers, timeouts, the
// ends of periods, the opening tip, technicals and flagrants. Missed shots,
// rebounds and substitutions are the noise of 450 plays a game.
const KEEP = /turnover|timeout|end (of )?(period|game|quarter|half)|jump ?ball|technical|flagrant|ejection|challenge|coach/i

function playsOf(plays: any[], away: TeamLine, home: TeamLine, homeId: string): PlayEvent[] {
  const out: PlayEvent[] = []
  let lead = 'tie' as 'away' | 'home' | 'tie'
  for (const p of plays) {
    const text = String(p?.text ?? '').trim()
    const type = String(p?.type?.text ?? '').toLowerCase()
    const scoring = !!p?.scoringPlay
    if (!text || (!scoring && !KEEP.test(`${type} ${text}`))) continue
    const a = Number(p.awayScore) || 0, h = Number(p.homeScore) || 0
    const now: typeof lead = a > h ? 'away' : h > a ? 'home' : 'tie'
    const leadChange = scoring && now !== lead && now !== 'tie'
    if (scoring) lead = now
    // The end of a period closes it; "End of Game" follows the last one.
    const endPeriod = /end (of )?(period|quarter|half)/i.test(`${type} ${text}`) && !/end game|end of game/i.test(`${type} ${text}`)
    const forHome = String(p?.team?.id ?? '') === homeId
    out.push({
      id: String(p.id ?? p.sequenceNumber),
      inning: Number(p?.period?.number) || 0,
      half: forHome ? 'bottom' : 'top',
      kind: scoring ? 'pa' : 'action',
      type: type || 'play',
      text,
      scoring,
      away: a,
      home: h,
      outs: null,
      endsHalf: endPeriod,
      big: leadChange || endPeriod || /technical|flagrant|ejection/i.test(type),
      clock: p?.clock?.displayValue ?? undefined,
      at: p?.wallclock ?? undefined,
    })
  }
  return out
}

function boxOf(players: any[], homeId: string): GameState['nbaBox'] {
  if (!players?.length) return null
  let cols: string[] = []
  const side = (team: any): NbaPlayerRow[] => {
    const s = team?.statistics?.[0]
    if (!s) return []
    if (!cols.length) cols = (s.labels ?? []).map(String)
    return ((s.athletes ?? []) as any[])
      .filter(a => Array.isArray(a.stats) && a.stats.length && !a.didNotPlay)
      .map(a => ({ name: String(a.athlete?.shortName ?? a.athlete?.displayName ?? ''), pos: String(a.athlete?.position?.abbreviation ?? ''), starter: !!a.starter, stats: a.stats.map(String) }))
  }
  const awayT = players.find(t => String(t?.team?.id) !== homeId), homeT = players.find(t => String(t?.team?.id) === homeId)
  // The rows first: reading them fills in the column labels.
  const awayRows = side(awayT), homeRows = side(homeT)
  return { cols, away: awayRows, home: homeRows }
}

// ESPN's clips of the game (its summary's `videos`): kept beside the game's
// state, not in it, for /api/xsports/highlights (lib/xsports-highlights.ts).
const videoLists = new Map<number, any[]>()

/** ESPN's video list for a game, from this instance's copy of its summary. */
export async function nbaVideos(id: number): Promise<any[]> {
  await getNbaGame(id)
  return videoLists.get(id) ?? []
}

/** ESPN's win chance for the away team at each play and where each period
 *  began, from this instance's copy of the game's summary (getNbaGame). */
const winLists = new Map<number, { points: { t: number; away: number }[]; periods: { t: number; n: number }[] }>()
export const nbaWinHistory = (id: number) => winLists.get(id) ?? { points: [], periods: [] }

export async function getNbaGame(id: number, opts: { fresh?: boolean } = {}): Promise<GameState> {
  if (!isNbaId(id)) throw new Error('bad game id')
  return cached(games, String(id), opts.fresh ? 0 : CACHE_MS, async () => {
    const d = await getJson(`${API}/summary?event=${id}`)
    videoLists.set(id, Array.isArray(d.videos) ? d.videos : [])
    if (videoLists.size > 200) videoLists.delete(videoLists.keys().next().value!)
    const comp = d.header?.competitions?.[0] ?? {}
    const cs: any[] = comp.competitors ?? []
    const awayC = cs.find(c => c.homeAway === 'away'), homeC = cs.find(c => c.homeAway === 'home')
    const away = teamOf(awayC), home = teamOf(homeC)
    const homeId = String(homeC?.team?.id ?? '')
    const st = comp.status ?? {}
    const status = statusOf(st.type?.state)
    const periods = (c: any) => ((c?.linescores ?? []) as any[]).map(l => Number(l.displayValue ?? l.value))
    const ap = periods(awayC), hp = periods(homeC)
    const n = Math.max(ap.length, hp.length)
    const events = playsOf(d.plays ?? [], away, home, homeId)
    const wp: any[] = d.winprobability ?? []
    const lastWp = wp[wp.length - 1]
    // Over time, for the 賠率 tab: ESPN's chance for the away team at each
    // play (by the play's wall clock), and where each period began.
    const plays: any[] = Array.isArray(d.plays) ? d.plays : []
    const clockOf = new Map(plays.map(p => [String(p?.id), Date.parse(String(p?.wallclock ?? ''))]))
    const periodsAt: { t: number; n: number }[] = []
    for (const p of plays) {
      const pn = Number(p?.period?.number), t = Date.parse(String(p?.wallclock ?? ''))
      if (pn && Number.isFinite(t) && !periodsAt.some(x => x.n === pn)) periodsAt.push({ t, n: pn })
    }
    winLists.set(id, {
      points: wp.map(w => ({ t: clockOf.get(String(w?.playId)) ?? NaN, away: (1 - Number(w?.homeWinPercentage)) * 100 }))
        .filter(x => Number.isFinite(x.t) && Number.isFinite(x.away)),
      periods: periodsAt,
    })
    if (winLists.size > 200) winLists.delete(winLists.keys().next().value!)
    const pick = (d.pickcenter ?? [])[0]
    const line = pick && (pick.details || typeof pick.overUnder === 'number')
      ? { provider: String(pick.provider?.name ?? 'Sportsbook').replace(/^Draft Kings$/, 'DraftKings'), spread: pick.details ? String(pick.details) : null, total: typeof pick.overUnder === 'number' ? pick.overUnder : null }
      : null
    const usDate = (() => {
      try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(comp.date)) } catch { return null }
    })()
    const state: GameState = {
      league: 'nba',
      pk: id,
      start: String(comp.date ?? ''),
      status,
      detailed: String(st.type?.shortDetail ?? st.type?.description ?? ''),
      away, home,
      inning: Number(st.period) || null,
      half: null,
      outs: null,
      clock: st.displayClock ?? null,
      series: d.header?.season?.type === 1 ? 'Preseason' : null,
      seriesNote: null,
      venue: d.gameInfo?.venue?.fullName ?? null,
      usDate,
      inningState: null,
      weather: null,
      innings: Array.from({ length: n }, (_, i) => ({ n: i + 1, away: ap[i] ?? null, home: hp[i] ?? null })),
      now: null,
      probable: { away: null, home: null },
      events,
      box: { away: [], home: [] },
      pitchers: { away: [], home: [] },
      teamBox: { away: { batters: [], pitchers: [], notes: [], bullpen: [] }, home: { batters: [], pitchers: [], notes: [], bullpen: [] } },
      gameNotes: [],
      winProb: lastWp && status !== 'preview' ? { home: Math.round(Number(lastWp.homeWinPercentage) * 1000) / 10, away: Math.round((1 - Number(lastWp.homeWinPercentage)) * 1000) / 10, leverage: null } : null,
      nbaBox: boxOf(d.boxscore?.players ?? [], homeId),
      line,
      market: null,
      poly: null,
      decisions: null,
      roster: { away: [], home: [] },
      season: String(d.header?.season?.year ?? ''),
      postLines: {},
      fetchedAt: new Date().toISOString(),
    }
    if (status !== 'final' && usDate) {
      const o = await oddsFor('nba', usDate, away.abbr, home.abbr)
      state.market = o.kalshi
      state.poly = o.poly
    }
    return state
  })
}
