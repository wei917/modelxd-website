// lib/mlb.ts — MLB's public Stats API, cut down to what XSports shows and
// what the commentator reads.
//
// statsapi.mlb.com needs no key. Its copyright note limits use to individual,
// non-commercial purposes, so this is the PROTOTYPE feed (owner, Oct 12:
// "free feeds to prototype"); a licensed feed replaces it before launch.
// Everything outside this file sees only the shapes below, so the swap is
// one file.
//
// One game's live feed is ~780 KB. It is fetched at most once per CACHE_MS
// per server instance (plus the CDN cache on the GET routes), however many
// people are watching, and cut to a few KB here.

import { getMarketOdds, type MarketOdds } from './kalshi'
import { getPolyOdds, type PolyOdds } from './polymarket'
import { lineFor } from './espn-lines'

/** Both prediction markets' prices for a game (information only). */
export interface Odds { kalshi: MarketOdds | null; poly: PolyOdds | null }

/** Kalshi's and Polymarket's prices for one game, each failing soft. */
export async function oddsFor(league: string, usDate: string, away: string, home: string): Promise<Odds> {
  const [kalshi, poly] = await Promise.all([
    getMarketOdds(usDate, away, home, league).catch(e => { console.warn('[odds] kalshi', e?.message ?? e); return null }),
    getPolyOdds(league, usDate, away, home).catch(e => { console.warn('[odds] polymarket', e?.message ?? e); return null }),
  ])
  return { kalshi, poly }
}

export type GameStatus = 'preview' | 'live' | 'final' | 'other'
export type Half = 'top' | 'bottom'

export interface TeamLine {
  /** MLB team id; for other leagues the feed's own id. */
  id: number
  /** The club's colour from the feed (NBA); MLB's come from lib/mlb-colors. */
  color?: string | null
  abbr: string
  /** "Dodgers" */
  club: string
  /** "Los Angeles Dodgers" */
  name: string
  runs: number | null
  hits: number | null
  errors: number | null
  /** Season W-L, or the series record in the postseason. */
  record: string | null
}

export type League = 'mlb' | 'nba'

export interface GameCard {
  /** Which league (MLB unless said). `pk` is the league feed's game id. */
  league?: League
  pk: number
  /** ISO start time (UTC). */
  start: string
  status: GameStatus
  /** MLB's own words: "In Progress", "Final", "Delayed: Rain", "Warmup". */
  detailed: string
  away: TeamLine
  home: TeamLine
  /** MLB: the inning. NBA: the period (5+ is overtime). */
  inning: number | null
  half: Half | null
  outs: number | null
  /** NBA: the game clock in the period, "5:32". */
  clock?: string | null
  /** "NLCS Game 2" in the postseason, null in the regular season. */
  series: string | null
  /** "MIL leads 2-0" */
  seriesNote: string | null
  venue: string | null
  /** The game's US date (YYYY-MM-DD), which markets name games by. */
  usDate?: string | null
  /** Prediction markets' prices before and during the game. */
  odds?: Odds | null
  /** A sportsbook's line from ESPN (DraftKings): the spread or money line
   *  ("CLE -1.5", "TB -137") and the total. Information only. */
  line?: { provider: string; spread: string | null; total: number | null } | null
}

export interface PlayEvent {
  /** Stable and append-only: `${atBatIndex}` for a plate appearance,
   *  `${atBatIndex}a${eventIndex}` for an action inside it. */
  id: string
  inning: number
  half: Half
  kind: 'pa' | 'action'
  /** MLB's eventType: home_run, strikeout, pitching_substitution, … */
  type: string
  text: string
  scoring: boolean
  /** Score after the event. */
  away: number
  home: number
  outs: number | null
  /** The third out: the half-inning is over. */
  endsHalf: boolean
  /** Worth a comment straight away (a run, a home run, MLB's own
   *  "captivating" score). */
  big: boolean
  /** Last pitch: "97.8 mph Four-Seam Fastball". */
  pitch?: string
  /** Ball in play: "EV 106.3 mph, 436 ft". */
  hit?: string
  /** NBA: the clock when it happened. */
  clock?: string
  /** When it happened (ISO), so plays and chat messages share one timeline. */
  at?: string
  batter?: string
  pitcher?: string
  /** The at-bat's pitches in order: B ball, S strike (fouls too), X in
   *  play, H hit by pitch. Drawn as the dots beside a play. */
  pitches?: string
  /** MLB's win probability for the HOME team after this plate appearance,
   *  and how much this play moved it (percentage points). */
  wp?: number
  swing?: number
}

export interface Bases { first?: string; second?: string; third?: string }

export interface NbaPlayerRow { name: string; pos: string; starter: boolean; stats: string[] }

export interface BoxBatter {
  id: number; name: string; pos: string; sub: boolean
  ab: number; r: number; h: number; rbi: number; bb: number; k: number
  /** This season's (in the postseason: this postseason's) AVG and OPS. */
  avg: string; ops: string
}
export interface BoxPitcher {
  id: number; name: string
  ip: string; h: number; r: number; er: number; bb: number; k: number; hr: number
  pitches: number; strikes: number; era: string
}
export interface TeamBox {
  batters: BoxBatter[]
  pitchers: BoxPitcher[]
  /** MLB's box notes: "2B: Tucker (1, Henderson).", "Team LOB: 5." */
  notes: string[]
  /** Relievers not used yet, with their ERA: "Smith, C 1.35". */
  bullpen: string[]
}

export interface GameState extends GameCard {
  /** MLB's inningState: Top / Middle / Bottom / End. */
  inningState: string | null
  weather: string | null
  innings: { n: number; away: number | null; home: number | null }[]
  /** The at-bat in progress; null before the first pitch and after the last. */
  now: {
    balls: number; strikes: number; outs: number
    batter: string | null; batterToday: string | null; batterLine: string | null
    pitcher: string | null; pitcherToday: string | null; pitcherPitches: number | null
    onDeck: string | null
    bases: Bases
    /** The team at bat now (between halves: the one due up). */
    batting: 'away' | 'home' | null
    /** This at-bat's pitches so far (same codes as PlayEvent.pitches). */
    pitches: string
  } | null
  probable: { away: string | null; home: string | null }
  events: PlayEvent[]
  /** Box score lines: "Shohei Ohtani DH: 2-4 | HR, 2 RBI". */
  box: { away: string[]; home: string[] }
  pitchers: { away: string[]; home: string[] }
  /** The box score as tables, for the page's Box score tab and the bot. */
  teamBox: { away: TeamBox; home: TeamBox }
  /** Game-wide box notes: pitches-strikes, batters faced, umpires. */
  gameNotes: string[]
  /** MLB's own win probability now (its model, not betting odds), and the
   *  leverage of the moment (1 = average, 2+ = high pressure). */
  winProb: { home: number; away: number; leverage: number | null } | null
  /** NBA: the box score as the feed labels it, one row per player. */
  nbaBox?: { cols: string[]; away: NbaPlayerRow[]; home: NbaPlayerRow[] } | null
  /** A prediction market's price for the game (Kalshi), information only. */
  market: MarketOdds | null
  /** Polymarket's price for the game, information only. */
  poly: PolyOdds | null
  /** "W: Yamamoto, L: Henderson, SV: …" once final. */
  decisions: string | null
  /** Everyone in tonight's lineups, plus the pitchers used and announced:
   *  the commentator's player cards are fetched for these (getPlayers). */
  roster: { away: number[]; home: number[] }
  /** "2026": the season the player cards are read for. */
  season: string
  /** This postseason's line per player id, from the box score (MLB's
   *  "season" stats in a postseason game are the postseason's own). */
  postLines: Record<string, string>
  fetchedAt: string
}

/** One player as the commentator knows him: who he is, his regular season,
 *  his career. */
export interface PlayerCard {
  id: number
  name: string
  pos: string
  country: string | null
  age: number | null
  bats: string | null
  throws: string | null
  hitting: string | null
  pitching: string | null
  careerHitting: string | null
  careerPitching: string | null
}

const API = 'https://statsapi.mlb.com/api'
const CACHE_MS = 8_000
const SCHEDULE_CACHE_MS = 20_000

// Actions worth showing between plate appearances. Mound visits, batter
// timeouts and defensive switches are noise for a viewer.
const ACTIONS = /pitching_substitution|stolen_base|caught_stealing|wild_pitch|passed_ball|pickoff|offensive_substitution|error|balk|game_advisory|injury|ejection|review/

const BIG_TYPES = new Set(['home_run', 'triple', 'grand_slam', 'triple_play', 'grounded_into_triple_play'])

function statusOf(abstract: string | undefined, coded: string | undefined): GameStatus {
  if (abstract === 'Live') return 'live'
  if (abstract === 'Final') return 'final'
  if (abstract === 'Preview') return coded === 'D' ? 'other' : 'preview'
  return 'other'
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const halfOf = (v: unknown): Half | null => {
  const s = String(v ?? '').toLowerCase()
  return s === 'top' ? 'top' : s === 'bottom' ? 'bottom' : null
}

function recordOf(t: any): string | null {
  const r = t?.leagueRecord
  return r && typeof r.wins === 'number' ? `${r.wins}-${r.losses}` : null
}

function teamLine(sched: any, line: any): TeamLine {
  const team = sched?.team ?? {}
  return {
    id: Number(team.id) || 0,
    abbr: String(team.abbreviation ?? team.teamCode ?? '').toUpperCase(),
    club: String(team.teamName ?? team.clubName ?? team.name ?? ''),
    name: String(team.name ?? ''),
    runs: num(line?.runs ?? sched?.score),
    hits: num(line?.hits),
    errors: num(line?.errors),
    record: recordOf(sched),
  }
}

// ── Small per-instance caches. A serverless instance lives for minutes, which
// is exactly the window that matters: every viewer's 10 s poll and every
// commentator call inside it share one upstream fetch.
type Entry<T> = { at: number; value?: T; pending?: Promise<T> }
const gameCache = new Map<number, Entry<GameState>>()
const schedCache = new Map<string, Entry<GameCard[]>>()

async function cached<K, T>(map: Map<K, Entry<T>>, key: K, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = map.get(key)
  if (hit?.value !== undefined && Date.now() - hit.at < ttl) return hit.value
  if (hit?.pending) return hit.pending
  const pending = load()
    .then(value => { map.set(key, { at: Date.now(), value }); return value })
    .catch(err => {
      // A failed refresh keeps serving the last good copy rather than blanking
      // the page; the next call tries again.
      if (hit?.value !== undefined) { map.set(key, { at: hit.at, value: hit.value }); return hit.value }
      map.delete(key)
      throw err
    })
  map.set(key, { at: hit?.at ?? 0, value: hit?.value, pending })
  if (map.size > 200) { const first = map.keys().next().value; if (first !== undefined) map.delete(first) }
  return pending
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { cache: 'no-store', headers: { 'User-Agent': 'ModelXD/1.0 (+https://www.modelxd.com)' } })
  if (!res.ok) throw new Error(`MLB ${res.status} for ${url.replace(API, '')}`)
  return res.json()
}

/** A YYYY-MM-DD date is all the schedule takes. */
export const isMlbDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

/** MLB's own calendar day: games are listed by their US date, so "today" is
 *  today in New York, not in Taipei (a 7 pm ET game is the next morning there). */
export function mlbToday(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
}

function cardOf(g: any): GameCard {
  const ls = g.linescore ?? {}
  const ss = g.seriesStatus
  const post = g.gameType && g.gameType !== 'R' && g.gameType !== 'S'
  return {
    pk: Number(g.gamePk),
    start: String(g.gameDate ?? ''),
    status: statusOf(g.status?.abstractGameState, g.status?.codedGameState),
    detailed: String(g.status?.detailedState ?? ''),
    away: teamLine(g.teams?.away, ls.teams?.away),
    home: teamLine(g.teams?.home, ls.teams?.home),
    inning: num(ls.currentInning),
    half: halfOf(ls.inningHalf),
    outs: num(ls.outs),
    series: post ? (ss?.shortDescription ?? g.description ?? g.seriesDescription ?? null) : null,
    seriesNote: post ? (ss?.result ?? null) : null,
    venue: g.venue?.name ?? null,
    usDate: typeof g.officialDate === 'string' ? g.officialDate : null,
  }
}

export async function getSchedule(date: string): Promise<GameCard[]> {
  if (!isMlbDate(date)) throw new Error('bad date')
  return cached(schedCache, date, SCHEDULE_CACHE_MS, async () => {
    const d = await getJson(`${API}/v1/schedule?sportId=1&date=${date}&hydrate=linescore,seriesStatus,team`)
    const games: any[] = (d.dates ?? []).flatMap((x: any) => x.games ?? [])
    return games.map(cardOf).sort((a, b) => a.start.localeCompare(b.start))
  })
}

// ── One game ────────────────────────────────────────────────────────────────

function playerLine(p: any, kind: 'batting' | 'pitching'): string | null {
  const s = p?.stats?.[kind]
  const summary = typeof s?.summary === 'string' ? s.summary : null
  return summary
}

function seasonBatting(p: any): string | null {
  const s = p?.seasonStats?.batting
  if (!s || typeof s.avg !== 'string') return null
  return `${s.avg} AVG, ${s.homeRuns ?? 0} HR, ${s.ops ?? '-'} OPS`
}

function pitchOf(play: any): string | undefined {
  const pitches = (play.playEvents ?? []).filter((e: any) => e?.isPitch || e?.type === 'pitch')
  const last = pitches[pitches.length - 1]
  if (!last) return undefined
  const speed = num(last.pitchData?.startSpeed)
  const type = last.details?.type?.description
  if (!speed && !type) return undefined
  return [speed ? `${speed.toFixed(1)} mph` : null, type ?? null].filter(Boolean).join(' ')
}

function hitOf(play: any): string | undefined {
  const pitches = (play.playEvents ?? []).filter((e: any) => e?.hitData)
  const h = pitches[pitches.length - 1]?.hitData
  if (!h) return undefined
  const ev = num(h.launchSpeed), dist = num(h.totalDistance)
  if (!ev && !dist) return undefined
  return [ev ? `EV ${ev.toFixed(1)} mph` : null, dist ? `${Math.round(dist)} ft` : null].filter(Boolean).join(', ')
}

function pitchCodes(play: any): string {
  return ((play?.playEvents ?? []) as any[])
    .filter(e => e?.isPitch || e?.type === 'pitch')
    .map(e => {
      const d = e.details ?? {}
      if (d.isInPlay) return 'X'
      if (d.code === 'H') return 'H'
      if (d.isBall) return 'B'
      return 'S'
    })
    .join('')
}

function eventsOf(allPlays: any[]): PlayEvent[] {
  const out: PlayEvent[] = []
  let away = 0, home = 0
  for (const p of allPlays) {
    const ab = Number(p.atBatIndex ?? p.about?.atBatIndex)
    const inning = Number(p.about?.inning) || 0
    const half = halfOf(p.about?.halfInning) ?? 'top'
    const evs: any[] = p.playEvents ?? []
    evs.forEach((e, i) => {
      if (e?.type !== 'action') return
      const type = String(e.details?.eventType ?? e.details?.event ?? '').toLowerCase()
      const text = String(e.details?.description ?? '').trim()
      if (!text || !ACTIONS.test(type)) return
      // Pre-game housekeeping is noise; a delay or a suspension stays.
      if (/^Status Change - (Pre-Game|Warmup|In Progress)/i.test(text)) return
      const sAway = num(e.details?.awayScore), sHome = num(e.details?.homeScore)
      if (sAway !== null) away = sAway
      if (sHome !== null) home = sHome
      out.push({
        id: `${ab}a${i}`, inning, half, kind: 'action', type, text,
        scoring: !!e.details?.isScoringPlay, away, home, outs: num(e.count?.outs),
        endsHalf: false, big: !!e.details?.isScoringPlay,
        at: e.startTime ?? e.endTime ?? undefined,
      })
    })
    if (!p.about?.isComplete) continue
    const r = p.result ?? {}
    const text = String(r.description ?? '').trim()
    if (!text) continue
    away = num(r.awayScore) ?? away
    home = num(r.homeScore) ?? home
    const type = String(r.eventType ?? r.event ?? '').toLowerCase()
    const outs = num(p.count?.outs)
    const scoring = !!p.about?.isScoringPlay
    out.push({
      id: String(ab), inning, half, kind: 'pa', type, text, scoring, away, home, outs,
      endsHalf: outs === 3,
      big: scoring || BIG_TYPES.has(type) || (num(p.about?.captivatingIndex) ?? 0) >= 60,
      pitch: pitchOf(p),
      hit: hitOf(p),
      batter: p.matchup?.batter?.fullName ?? undefined,
      pitcher: p.matchup?.pitcher?.fullName ?? undefined,
      pitches: pitchCodes(p) || undefined,
      at: p.about?.endTime ?? p.playEndTime ?? undefined,
    })
  }
  return out
}

function boxOf(team: any): { batters: string[]; pitchers: string[] } {
  const players = team?.players ?? {}
  const get = (id: number) => players[`ID${id}`]
  const batters = ((team?.batters ?? []) as number[])
    .map(get)
    .filter(p => p && Number(p.stats?.batting?.plateAppearances ?? 0) > 0)
    .map(p => `${p.person?.fullName} ${p.position?.abbreviation ?? ''}: ${playerLine(p, 'batting') ?? ''}`.trim())
  const pitchers = ((team?.pitchers ?? []) as number[])
    .map(get)
    .filter(Boolean)
    .map(p => {
      const s = p.stats?.pitching ?? {}
      const n = num(s.numberOfPitches ?? s.pitchesThrown)
      return `${p.person?.fullName}: ${playerLine(p, 'pitching') ?? ''}${n ? `, ${n} pitches` : ''}`
    })
  return { batters, pitchers }
}

const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0)
const noteLines = (list: any[]) => (list ?? []).flatMap((block: any) =>
  ((block?.fieldList ?? block ? (block.fieldList ?? [block]) : []) as any[])
    .filter(f => f?.label && f?.value)
    .map(f => `${f.label}: ${String(f.value).trim()}`))

function teamBoxOf(team: any, people: any): TeamBox {
  const players = team?.players ?? {}
  const short = (id: number, p: any) => String(people?.[`ID${id}`]?.boxscoreName ?? p?.person?.fullName ?? '')
  const batters: BoxBatter[] = ((team?.batters ?? []) as number[]).map(id => {
    const p = players[`ID${id}`]
    if (!p) return null
    const st = p.stats?.batting ?? {}
    const ss = p.seasonStats?.batting ?? {}
    if (!int(st.plateAppearances) && !p.battingOrder) return null
    return {
      id, name: short(id, p), pos: String(p.position?.abbreviation ?? ''),
      sub: typeof p.battingOrder === 'string' ? !p.battingOrder.endsWith('00') : false,
      ab: int(st.atBats), r: int(st.runs), h: int(st.hits), rbi: int(st.rbi), bb: int(st.baseOnBalls), k: int(st.strikeOuts),
      avg: String(ss.avg ?? '-'), ops: String(ss.ops ?? '-'),
    }
  }).filter((b): b is BoxBatter => !!b)
  const pitchers: BoxPitcher[] = ((team?.pitchers ?? []) as number[]).map(id => {
    const p = players[`ID${id}`]
    if (!p) return null
    const st = p.stats?.pitching ?? {}
    return {
      id, name: short(id, p),
      ip: String(st.inningsPitched ?? '0.0'), h: int(st.hits), r: int(st.runs), er: int(st.earnedRuns),
      bb: int(st.baseOnBalls), k: int(st.strikeOuts), hr: int(st.homeRuns),
      pitches: int(st.numberOfPitches ?? st.pitchesThrown), strikes: int(st.strikes),
      era: String(p.seasonStats?.pitching?.era ?? '-'),
    }
  }).filter((x): x is BoxPitcher => !!x)
  // A name with its ERA; MLB's "-.--" (no innings yet) is left off.
  const bullpen = ((team?.bullpen ?? []) as number[]).map(id => {
    const p = players[`ID${id}`]
    const era = String(p?.seasonStats?.pitching?.era ?? '')
    return p ? `${short(id, p)} ${/\d/.test(era) ? era : ''}`.trim() : null
  }).filter((x): x is string => !!x)
  return { batters, pitchers, notes: noteLines(team?.info ?? []), bullpen }
}

function rosterOf(team: any, probable: unknown): number[] {
  const ids = [...(team?.battingOrder ?? []), ...(team?.batters ?? []), ...(team?.pitchers ?? []), probable]
    .map(Number).filter(n => Number.isInteger(n) && n > 0)
  return [...new Set(ids)].slice(0, 40)
}

function postLinesOf(bx: any): Record<string, string> {
  const out: Record<string, string> = {}
  for (const side of ['away', 'home'] as const) {
    for (const p of Object.values<any>(bx?.[side]?.players ?? {})) {
      const id = p?.person?.id
      if (!id) continue
      const b = p.seasonStats?.batting, pi = p.seasonStats?.pitching
      const parts: string[] = []
      if (b && Number(b.plateAppearances ?? 0) > 0) parts.push(`${b.avg} AVG, ${b.homeRuns ?? 0} HR, ${b.rbi ?? 0} RBI, ${b.ops} OPS in ${b.atBats ?? 0} AB`)
      if (pi && Number(pi.battersFaced ?? 0) > 0) parts.push(`${pi.era} ERA, ${pi.inningsPitched} IP, ${pi.strikeOuts ?? 0} K`)
      if (parts.length) out[String(id)] = parts.join('; ')
    }
  }
  return out
}

function decisionsOf(d: any): string | null {
  if (!d) return null
  const parts = [
    d.winner?.fullName && `W: ${d.winner.fullName}`,
    d.loser?.fullName && `L: ${d.loser.fullName}`,
    d.save?.fullName && `SV: ${d.save.fullName}`,
  ].filter(Boolean)
  return parts.length ? parts.join(', ') : null
}

export function stateOf(feed: any): GameState {
  const gd = feed.gameData ?? {}
  const ld = feed.liveData ?? {}
  const ls = ld.linescore ?? {}
  const bx = ld.boxscore?.teams ?? {}
  const status = statusOf(gd.status?.abstractGameState, gd.status?.codedGameState)
  const schedLike = (side: 'away' | 'home') => ({ team: gd.teams?.[side], leagueRecord: gd.teams?.[side]?.record?.leagueRecord })
  const post = gd.game?.type && gd.game.type !== 'R' && gd.game.type !== 'S'
  const findPlayer = (id: unknown) => {
    for (const side of ['away', 'home'] as const) {
      const p = bx[side]?.players?.[`ID${id}`]
      if (p) return p
    }
    return null
  }
  const off = ls.offense ?? {}
  const def = ls.defense ?? {}
  const batter = findPlayer(off.batter?.id)
  const pitcher = findPlayer(def.pitcher?.id)
  const bases: Bases = {}
  if (off.first?.fullName) bases.first = off.first.fullName
  if (off.second?.fullName) bases.second = off.second.fullName
  if (off.third?.fullName) bases.third = off.third.fullName
  const away = boxOf(bx.away), home = boxOf(bx.home)
  const w = gd.weather
  return {
    pk: Number(gd.game?.pk),
    start: String(gd.datetime?.dateTime ?? ''),
    status,
    detailed: String(gd.status?.detailedState ?? ''),
    away: teamLine(schedLike('away'), ls.teams?.away),
    home: teamLine(schedLike('home'), ls.teams?.home),
    inning: num(ls.currentInning),
    half: halfOf(ls.inningHalf),
    outs: num(ls.outs),
    inningState: typeof ls.inningState === 'string' ? ls.inningState : null,
    series: post ? (gd.game?.description ?? null) : null,
    seriesNote: null,
    venue: gd.venue?.name ?? null,
    weather: w?.condition ? `${w.condition}, ${w.temp ?? '?'}°F, wind ${w.wind ?? '?'}` : null,
    innings: ((ls.innings ?? []) as any[]).map(i => ({ n: Number(i.num), away: num(i.away?.runs), home: num(i.home?.runs) })),
    now: status === 'live' && (off.batter || def.pitcher) ? {
      balls: num(ls.balls) ?? 0, strikes: num(ls.strikes) ?? 0, outs: num(ls.outs) ?? 0,
      batter: off.batter?.fullName ?? null,
      batterToday: batter ? playerLine(batter, 'batting') : null,
      batterLine: batter ? seasonBatting(batter) : null,
      pitcher: def.pitcher?.fullName ?? null,
      pitcherToday: pitcher ? playerLine(pitcher, 'pitching') : null,
      pitcherPitches: pitcher ? num(pitcher.stats?.pitching?.numberOfPitches) : null,
      onDeck: off.onDeck?.fullName ?? null,
      bases,
      batting: off.team?.id ? (Number(off.team.id) === Number(gd.teams?.away?.id) ? 'away' : 'home') : null,
      pitches: ld.plays?.currentPlay?.about?.isComplete ? '' : pitchCodes(ld.plays?.currentPlay),
    } : null,
    probable: { away: gd.probablePitchers?.away?.fullName ?? null, home: gd.probablePitchers?.home?.fullName ?? null },
    events: eventsOf(ld.plays?.allPlays ?? []),
    box: { away: away.batters, home: home.batters },
    pitchers: { away: away.pitchers, home: home.pitchers },
    teamBox: { away: teamBoxOf(bx.away, gd.players), home: teamBoxOf(bx.home, gd.players) },
    winProb: null,
    market: null,
    poly: null,
    gameNotes: noteLines(ld.boxscore?.info ?? []).filter(l => !/^(Weather|Wind|First pitch|Venue|Att|T):/.test(l) && !/^October|^\w+ \d+, \d{4}/.test(l)),
    decisions: decisionsOf(ld.decisions),
    roster: { away: rosterOf(bx.away, gd.probablePitchers?.away?.id), home: rosterOf(bx.home, gd.probablePitchers?.home?.id) },
    postLines: post ? postLinesOf(bx) : {},
    season: String(gd.game?.season ?? new Date().getUTCFullYear()),
    fetchedAt: new Date().toISOString(),
  }
}

export const isGamePk = (v: unknown): boolean => /^\d{5,8}$/.test(String(v ?? ''))

// MLB's highlight clips name the exact pitch or action they show: a clip's
// `guid` is that play's `playId` in the live feed (checked Oct 13: 19 of
// ALCS Game 2's 42 clips, the rest being recaps and interviews). Kept beside
// each game's state, not in it, so the page's polls stay small.
const playIndexes = new Map<number, Map<string, string>>()

/** playId → our event id: the action's own line when we list it
 *  (`${atBatIndex}a${i}`), else its plate appearance's (`${atBatIndex}`). */
export function playIndexOf(allPlays: any[], events: PlayEvent[]): Map<string, string> {
  const listed = new Set(events.map(e => e.id))
  const out = new Map<string, string>()
  for (const p of allPlays) {
    const ab = Number(p.atBatIndex ?? p.about?.atBatIndex)
    ;((p.playEvents ?? []) as any[]).forEach((e, i) => {
      if (typeof e?.playId === 'string' && e.playId) out.set(e.playId, listed.has(`${ab}a${i}`) ? `${ab}a${i}` : String(ab))
    })
  }
  return out
}

/** The play index of a game, from this instance's copy of its feed. */
export async function mlbPlayIndex(pk: number): Promise<Map<string, string>> {
  await getGame(pk)
  return playIndexes.get(pk) ?? new Map()
}

/** `fresh` skips this instance's cache: the page may have seen a play (from
 *  another instance or the CDN) that this copy has not. */
export async function getGame(pk: number, opts: { fresh?: boolean } = {}): Promise<GameState> {
  if (!isGamePk(pk)) throw new Error('bad game id')
  return cached(gameCache, pk, opts.fresh ? 0 : CACHE_MS, async () => {
    const feed = await getJson(`${API}/v1.1/game/${pk}/feed/live`)
    const state = stateOf(feed)
    playIndexes.set(pk, playIndexOf(feed.liveData?.plays?.allPlays ?? [], state.events))
    if (playIndexes.size > 200) playIndexes.delete(playIndexes.keys().next().value!)
    // Kalshi's price for the game, while its market is open (before and
    // during the game). Fails soft; never blocks the feed.
    const usDay = feed.gameData?.datetime?.officialDate
    if (state.status !== 'final' && isMlbDate(usDay)) {
      const [o, line] = await Promise.all([oddsFor('mlb', usDay, state.away.abbr, state.home.abbr), lineFor('mlb', usDay, state.away.abbr, state.home.abbr)])
      state.market = o.kalshi
      state.poly = o.poly
      state.line = line
    }
    // MLB's win probability, trimmed to the numbers (8 KB instead of the
    // 775 KB that repeats every pitch). Only once the game has started; a
    // failure leaves the game without it.
    if (state.status === 'live' || state.status === 'final') {
      try {
        const rows: any[] = await getJson(`${API}/v1/game/${pk}/winProbability?fields=atBatIndex,homeTeamWinProbability,awayTeamWinProbability,homeTeamWinProbabilityAdded,leverageIndex`)
        const byAb = new Map(rows.map(r => [String(r.atBatIndex), r]))
        for (const e of state.events) {
          if (e.kind !== 'pa') continue
          const r = byAb.get(e.id)
          if (r && typeof r.homeTeamWinProbability === 'number') {
            e.wp = Math.round(r.homeTeamWinProbability * 10) / 10
            e.swing = Math.round((r.homeTeamWinProbabilityAdded ?? 0) * 10) / 10
          }
        }
        const last = rows[rows.length - 1]
        if (last && typeof last.homeTeamWinProbability === 'number') {
          state.winProb = {
            home: Math.round(last.homeTeamWinProbability * 10) / 10,
            away: Math.round(last.awayTeamWinProbability * 10) / 10,
            leverage: typeof last.leverageIndex === 'number' ? last.leverageIndex : null,
          }
        }
      } catch (e: any) {
        console.warn('[mlb] win probability', pk, e?.message ?? e)
      }
    }
    // The series label ("ALCS Game 1"), the series score and the records
    // the schedule shows (in the postseason, the series W-L) are not in the
    // live feed; the day's schedule is cached anyway.
    const day = feed.gameData?.datetime?.officialDate
    if (isMlbDate(day)) {
      const card = (await getSchedule(day).catch(() => [] as GameCard[])).find(c => c.pk === state.pk)
      if (card) {
        state.series = card.series
        state.seriesNote = card.seriesNote
        state.away.record = card.away.record
        state.home.record = card.home.record
      }
    }
    return state
  })
}

/** Whether the game's stats lines are the postseason's own (MLB's season
 *  stats in a postseason game cover the postseason only). */
export const isPostseason = (g: Pick<GameCard, 'series'>): boolean => !!g.series

// ── Player cards ────────────────────────────────────────────────────────────
// One call per batch of players (season + career, hitting + pitching),
// cached per player for an hour: these numbers move once a game at most.

const PLAYER_MS = 60 * 60_000
const playerCache = new Map<number, { at: number; card: PlayerCard }>()

function hitLine(st: any): string | null {
  if (!st || !Number(st.plateAppearances ?? st.atBats ?? 0)) return null
  return `${st.avg} AVG, ${st.homeRuns ?? 0} HR, ${st.rbi ?? 0} RBI, ${st.stolenBases ?? 0} SB, ${st.ops} OPS (${st.gamesPlayed} G)`
}
function pitchLine(st: any): string | null {
  if (!st || !Number(st.battersFaced ?? st.gamesPlayed ?? 0)) return null
  return `${st.wins ?? 0}-${st.losses ?? 0}, ${st.era} ERA, ${st.inningsPitched} IP, ${st.strikeOuts ?? 0} K, ${st.whip} WHIP${Number(st.saves) ? `, ${st.saves} SV` : ''} (${st.gamesPlayed} G${Number(st.gamesStarted) ? `, ${st.gamesStarted} GS` : ''})`
}

function cardOfPerson(p: any): PlayerCard {
  const pick = (type: string, group: string) =>
    (p.stats ?? []).find((s: any) => s?.type?.displayName === type && s?.group?.displayName === group)?.splits?.[0]?.stat
  return {
    id: Number(p.id),
    name: String(p.fullName ?? ''),
    pos: String(p.primaryPosition?.abbreviation ?? ''),
    country: p.birthCountry ?? null,
    age: num(p.currentAge),
    bats: p.batSide?.code ?? null,
    throws: p.pitchHand?.code ?? null,
    hitting: hitLine(pick('season', 'hitting')),
    pitching: pitchLine(pick('season', 'pitching')),
    careerHitting: hitLine(pick('career', 'hitting')),
    careerPitching: pitchLine(pick('career', 'pitching')),
  }
}

/** Cards for these players, in the order asked; missing ones are skipped. A
 *  failed fetch returns what the cache has rather than nothing. */
export async function getPlayers(ids: number[], season: string): Promise<PlayerCard[]> {
  const now = Date.now()
  const want = [...new Set(ids.filter(n => Number.isInteger(n) && n > 0))]
  const stale = want.filter(id => { const c = playerCache.get(id); return !c || now - c.at > PLAYER_MS })
  for (let i = 0; i < stale.length; i += 50) {
    const batch = stale.slice(i, i + 50)
    try {
      const d = await getJson(`${API}/v1/people?personIds=${batch.join(',')}&hydrate=stats(group=[hitting,pitching],type=[season,career],season=${encodeURIComponent(season)})`)
      for (const p of d.people ?? []) playerCache.set(Number(p.id), { at: now, card: cardOfPerson(p) })
    } catch (e: any) {
      console.warn('[mlb] players', e?.message ?? e)
    }
  }
  if (playerCache.size > 3000) playerCache.clear()
  return want.map(id => playerCache.get(id)?.card).filter((c): c is PlayerCard => !!c)
}
