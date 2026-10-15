'use client'

// app/xsports/client.tsx — X體育: live games (MLB, NBA) with their scores,
// play-by-play, box scores and odds, and one live chat per game where fans
// and two AI commentators talk (supabase/131; ModelXD pays for the
// commentators, lib/xsports-ais). Designed after ESPN / theScore (owner, Oct 12), and the chat
// as a live thread rather than a chatbot (owner, Oct 13: "the UI is so AI
// flavor"). Beside it, AI 私聊: a private chat with up to four AI models the
// viewer picks and pays for (/api/xsports/talk), one per game.

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { useLang, useT } from '../../lib/i18n'
import { useAuthModal } from '../../lib/AuthModalContext'
import { isSubmitEnter } from '../../lib/ime'
import { FEATURE } from '../../lib/model-features'
import ModelPickerDialog, { type PickerModel } from '../components/ModelPickerDialog'
import ProviderLogo from '../components/ProviderLogo'
import { mlbToday, type GameCard, type GameState, type PlayEvent, type League, type TeamLine } from '../../lib/mlb'
import type { Clip } from '../../lib/xsports-highlights'
import { nextSpeaker } from '../../lib/xsports-turn'
import { HOUSE_AIS } from '../../lib/xsports-ais'
import ReactMarkdown from 'react-markdown'
import { REMARK_PLUGINS } from '../../lib/markdown'
import { teamChip } from '../../lib/mlb-colors'
import { copyFor, type Copy } from './copy'
import './xsports.css'

const POLL_MS = 10_000

const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)
const sb = () => createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)

const localTime = (iso: string) => {
  try { return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(iso)) } catch { return '' }
}

function shiftDate(d: string, days: number): string {
  const t = new Date(`${d}T12:00:00Z`)
  t.setUTCDate(t.getUTCDate() + days)
  return t.toISOString().slice(0, 10)
}

// ── Small pieces ────────────────────────────────────────────────────────────

/** A team's chip colours: the feed's own colour (NBA), else our MLB table. */
function chip(t: { id: number; color?: string | null }): React.CSSProperties {
  if (!t.color) return teamChip(t.id) as React.CSSProperties
  const hex = t.color.replace('#', '')
  const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return { '--team': t.color, '--team-ink': lum > 0.6 ? '#141714' : '#ffffff' } as React.CSSProperties
}
const teamColor = (t: { id: number; color?: string | null }) => ((chip(t) as Record<string, string>)['--team'] ?? '#9aa0a6')

/** "$10.6M", "$177K". */
function money(v: number | null | undefined): string {
  if (!v) return ''
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `$${Math.round(v / 1e3)}K`
  return `$${Math.round(v)}`
}

/** The series line in the reader's language: "美聯冠軍賽 第 2 戰，CLE 系列賽 1-0 領先". */
const seriesLine = (g: GameCard, c: Copy) => [g.series && c.series(g.series), g.seriesNote && c.series(g.seriesNote)].filter(Boolean).join('，')

/** What a game's status says: the inning or period while live, final, or
 *  the local start time. The half inning in words, never arrows (owner,
 *  Oct 13: "use top of 9 or bottom of 8 ... dont use arrows"). */
function statusOf(g: GameCard, c: Copy): { main: string; sub: string; live: boolean } {
  if (g.status === 'live') {
    if (g.league === 'nba') return { main: g.inning ? c.period(g.inning) : c.live, sub: g.clock ?? '', live: true }
    const between = /middle|end/i.test(String((g as GameState).inningState ?? ''))
    return { main: g.inning ? c.half(g.inning, g.half !== 'bottom') : c.live, sub: !between && g.outs !== null ? c.outsN(g.outs) : c.live, live: true }
  }
  if (g.status === 'final') return { main: c.final, sub: '', live: false }
  if (g.status === 'preview') return { main: localTime(g.start), sub: '', live: false }
  return { main: g.detailed, sub: '', live: false }
}

/** The side a market or a model favours, as "TB 57%". */
function favourite(g: GameCard, o: { away: number | null; home: number | null } | null | undefined): string | null {
  if (!o || o.away === null || o.home === null) return null
  return o.away >= o.home ? `${g.away.abbr} ${Math.round(o.away)}%` : `${g.home.abbr} ${Math.round(o.home)}%`
}

// ── The scores list ─────────────────────────────────────────────────────────
// Design 02, "Club Cards" (owner, Oct 13: "please go ahead with 02"): white
// match cards on a pale cool-grey page, the clubs' own logos facing each
// other, the time, score or state between them, and the three markets in
// one aligned footer. Two columns on wide screens (a lone game spans both),
// one on phones.

// Official marks from the leagues' own image servers: MLB's by its team id,
// the NBA's by its team id (the feed is ESPN's, so its codes are mapped
// here; checked one by one on Oct 13). Prototype only, like the free feeds:
// league and club marks need permission before launch. A logo that does
// not load gives way to the club's colour chip.
const NBA_TEAM_IDS: Record<string, number> = {
  ATL: 1610612737, BOS: 1610612738, BKN: 1610612751, CHA: 1610612766, CHI: 1610612741, CLE: 1610612739,
  DAL: 1610612742, DEN: 1610612743, DET: 1610612765, GS: 1610612744, HOU: 1610612745, IND: 1610612754,
  LAC: 1610612746, LAL: 1610612747, MEM: 1610612763, MIA: 1610612748, MIL: 1610612749, MIN: 1610612750,
  NO: 1610612740, NY: 1610612752, OKC: 1610612760, ORL: 1610612753, PHI: 1610612755, PHX: 1610612756,
  POR: 1610612757, SAC: 1610612758, SA: 1610612759, TOR: 1610612761, UTAH: 1610612762, WSH: 1610612764,
}
// Other spellings of the same clubs.
const NBA_ALIASES: Record<string, string> = { GSW: 'GS', NYK: 'NY', SAS: 'SA', NOP: 'NO', UTA: 'UTAH', WAS: 'WSH', BRK: 'BKN', PHO: 'PHX', CHO: 'CHA' }

function logoOf(league: League, t: TeamLine): string | null {
  if (league === 'nba') {
    const code = t.abbr.toUpperCase()
    const id = NBA_TEAM_IDS[NBA_ALIASES[code] ?? code]
    return id ? `https://cdn.nba.com/logos/nba/${id}/global/L/logo.svg` : null
  }
  return t.id > 0 ? `https://www.mlbstatic.com/team-logos/${t.id}.svg` : null
}

// The NBA's own file of its mark carries a white wordmark meant for dark
// backgrounds; ESPN's is the standard one. The leagues bar draws the NBA
// with NbaLockup instead.
const LEAGUE_MARK: Record<League, string> = {
  mlb: 'https://www.mlbstatic.com/team-logos/league-on-light/1.svg',
  nba: 'https://a.espncdn.com/combiner/i?img=/i/teamlogos/leagues/500/nba.png&w=64&h=64',
}

// The NBA's landscape mark, the logoman beside the NBA wordmark, for the
// leagues bar (owner, Oct 14: the logoman alone was too small there; the
// wordmark replaces the name beside it). Drawn from the NBA's own file
// (cdn.nba.com/logos/leagues/logo-nba.svg), split so the wordmark, white
// there for dark backgrounds, takes the bar's ink here, and drawn 1.45x as
// wide (owner, Oct 14: "stretch the image wider ... it looks too narrow");
// the logoman keeps its shape.
const NBA_FRAME = 'M10.105 0h-7.007a3.1 3.1 0 0 0 -3.098 3.098v23.728a3.103 3.103 0 0 0 3.098 3.102h7.002a3.109 3.109 0 0 0 3.105-3.102v-23.728a3.103 3.103 0 0 0 -3.1-3.098'
const NBA_RED = 'm8.367 5.486.007.102c.214.124.322.226.538.364.571.36 1.275 1 1.186 3.203.16.48.231 1.424.38 1.727.297.59.496.974.583 1.531 0 0 .085.867.197.93.591.134.42.192.507.293.092.119.433.113.433.431.118.158.206.323.272.494v-11.463a2.37 2.37 0 0 0 -2.365-2.368h-2.264c.364.13.57.282.689.524.292.025.64.68.098 1.649.24.16.053.398-.119.675-.05.089-.105.247-.266.236-.205.433-.454.852-.641.878-.057.07-.098.256-.013.344.276.123.612.293.778.45m4.103 10.628a2.11 2.11 0 0 1 -1.965 1.33 2.11 2.11 0 0 1 -2.111-2.11c0-.995.684-1.83 1.613-2.053-.243-.61-.757-1.597-.91-1.92-.144-.322-.492-2.33-.567-2.727-.017-.087-.911.519-.913.556-.052.05-.67 1.666-.696 1.753-.013.055-.014.27-.014.27s.304.038.479.569c.173.53.7 2.463.7 2.463s-.142.148-.148.14c.667 2.232.434 3.193.733 3.848.376.922.478.801.8 1.577.232.565.49 2.788.576 2.886.36.457.554.813.554 1.07 0 .26-.305 1.025-.194 1.471.068.263.103.85.225.962 0 0 .112.221.057.32-.016.033-.048.084-.033.125.198.7.84 1.896-.199 2.522h.022a2.353 2.353 0 0 0 1.991-2.34z'
const NBA_BLUE = 'm9.804 26.371c-.38-.34-.126-.483-.142-.617-.25-1.037-1.074-1.664-.648-2.006-.105-.342-.319-.772-.311-.771-1.283-.737-2.376-1.934-2.561-2.11-.225-.244-.609-.49-.68-.688-.309-.283-1.821-2.428-2.173-3.218l-.614-.087c-.28-1.14-1.212-2.097-1.235-3.24-.008-.433.196-1.359.272-1.543.075-.188.432-.495.432-.495v-.306c-1.339.038-.954-.099-1.184-.62-.162-.36-.046-.44.012-.69.18-.737.777-1.875 1.023-2.392.076-.261.334-.89.334-.89.998-2.032 1.371-1.883 2.556-1.998l.058-.084c1.188-.052.993-.141 1.16-1.285-.172.074-.224-.359-.224-.359-.094-.65.18-.527.31-.54.029-1.07.138-1.408.91-1.703h-4a2.369 2.369 0 0 0 -2.369 2.371v23.727c0 1.309 1.06 2.37 2.37 2.37h7.005c-.802-.434-.328-1.259-.301-2.825'
const NBA_WORD = 'm20.09 29.196h-3.35v-28.466h5.184l3.468 23.482c-.518-5.581-1.196-14.592-1.196-19.336v-4.146h3.349v28.466h-4.745l-3.19-22.806c.28 5.103.479 11.203.479 14.632v8.173m9.37.001v-28.466h4.744c3.15 0 5.103 1.714 5.103 5.701v4.186c0 2.592-.798 3.907-1.914 4.585 1.116.718 1.914 1.993 1.914 4.186v4.146c0 3.907-2.073 5.662-5.103 5.662zm3.827-24.878v9.409h.478c1.356 0 1.715-.518 1.715-2.073v-5.422c0-1.316-.399-1.914-1.555-1.914zm0 12.519v8.77h.638c1.196 0 1.555-.677 1.555-2.033v-4.824c0-1.395-.44-1.913-1.715-1.913zm13.192 7.016h-2.392l-.32 5.343h-3.866l2.79-28.466h5.422l2.712 28.466h-4.027l-.32-5.343zm-2.233-3.229h2.034l-.32-5.223c-.119-2.073-.438-8.651-.677-12.2h-.16l-.558 12.2z'
function NbaLockup() {
  return (
    <svg className="lockup" viewBox="0 0 66.36 30" fillRule="evenodd" aria-hidden>
      <path fill="#fff" d={NBA_FRAME} />
      <path fill="#b52532" d={NBA_RED} />
      <path fill="#253b73" d={NBA_BLUE} />
      <path fill="currentColor" d={NBA_WORD} transform="matrix(1.45 0 0 1 -7.533 0)" />
    </svg>
  )
}

/** A club's logo, beside its name (so the image itself says nothing more). */
function TeamLogo({ league, t }: { league: League; t: TeamLine }) {
  const src = logoOf(league, t)
  const [broken, setBroken] = useState(false)
  if (!src || broken) return <span className="xs-chip big" style={chip(t)} aria-hidden>{t.abbr}</span>
  return <img className="xs-logo" src={src} alt="" width={52} height={52} loading="lazy" decoding="async" onError={() => setBroken(true)} />
}

function Side({ league, t, lose }: { league: League; t: TeamLine; lose: boolean }) {
  const name = t.club || t.name
  // One long word ("Timberwolves") gets a smaller size so it stays in its
  // column on a phone.
  const long = name.split(' ').some(w => w.length > 9)
  return (
    <span className={`xs-side${lose ? ' lose' : ''}`}>
      <TeamLogo league={league} t={t} />
      <span className="who"><b className={long ? 'long' : undefined}>{name}</b>{t.record ? <small>{t.record}</small> : null}</span>
    </span>
  )
}

/** The three markets, always in this order so the columns line up from card
 *  to card: the side each favours, or nothing yet. */
const marketsOf = (g: GameCard, c: Copy): { name: string; value: string | null }[] => [
  { name: 'Kalshi', value: favourite(g, g.odds?.kalshi) },
  { name: c.poly, value: favourite(g, g.odds?.poly) },
  { name: g.line?.provider ?? 'DraftKings', value: g.line?.spread ?? null },
]

const shortDate = (iso: string, lang: string) => {
  try { return new Intl.DateTimeFormat(lang, { month: 'numeric', day: 'numeric', weekday: 'short' }).format(new Date(iso)) } catch { return '' }
}

/** One game's card. Upcoming: the local date and start time. Live: the score
 *  and the inning or period. Final: the score, the loser greyed. Postponed and
 *  the like: the start time, with MLB's or ESPN's word for it on the card. */
function GameCardView({ g, league, c, lang, wide, href, seasonAbove, onOpen }: {
  g: GameCard; league: League; c: Copy; lang: string; wide: boolean; href: string; seasonAbove: boolean; onOpen: () => void
}) {
  const started = g.status === 'live' || g.status === 'final'
  const a = g.away.runs ?? 0, h = g.home.runs ?? 0
  const loser = g.status === 'final' ? (a < h ? 'away' : h < a ? 'home' : null) : null
  const st = statusOf(g, c)
  // The preseason is said once, in the league's header, where there is one.
  const series = g.series === 'Preseason' && seasonAbove ? '' : seriesLine(g, c)
  const state = g.status === 'live' ? c.live : g.status === 'preview' ? c.notStarted : g.status === 'other' ? g.detailed : ''
  const under = g.status === 'live' ? [st.main, st.sub].filter(Boolean).join(' ') : g.status === 'final' ? c.final : g.status === 'preview' ? 'VS' : ''
  const markets = g.status === 'final' ? [] : marketsOf(g, c)
  const priced = markets.filter(m => m.value)
  const label = [
    `${g.away.name} @ ${g.home.name}`, series,
    started ? `${g.away.abbr} ${a}, ${g.home.abbr} ${h}` : `${shortDate(g.start, lang)} ${localTime(g.start)}`,
    g.status === 'preview' ? '' : g.status === 'live' ? `${c.live} ${under}` : g.status === 'final' ? c.final : state,
    ...priced.map(m => `${m.name} ${m.value}`),
  ].filter(Boolean).join('. ')
  return (
    <a className={`xs-card${wide ? ' wide' : ''}`} href={href} aria-label={label}
      onClick={e => { if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) { e.preventDefault(); onOpen() } }}>
      {series || state ? (
        <span className="xs-card-top">
          <span className="ser">{series}</span>
          {state ? <span className={`xs-state ${g.status}`}>{g.status === 'live' ? <span className="xs-pulse" /> : null}{state}</span> : null}
        </span>
      ) : null}
      <span className="xs-card-body">
        <Side league={league} t={g.away} lose={loser === 'away'} />
        <span className="xs-mid">
          {started ? (
            <span className="score"><span className={loser === 'away' ? 'lose' : undefined}>{a}</span><i>–</i><span className={loser === 'home' ? 'lose' : undefined}>{h}</span></span>
          ) : (
            <>
              {g.status === 'preview' ? <span className="date">{shortDate(g.start, lang)}</span> : null}
              <span className="time">{localTime(g.start)}</span>
            </>
          )}
          {g.status === 'live' ? (
            <>
              <span className="sub live">{st.main}</span>
              {st.sub && st.sub !== c.live ? <span className="sub">{st.sub}</span> : null}
            </>
          ) : under ? <span className="sub">{under}</span> : null}
        </span>
        <Side league={league} t={g.home} lose={loser === 'home'} />
        <span className="chev" aria-hidden>›</span>
      </span>
      {priced.length
        ? <span className="xs-mkts">{markets.map(m => <span key={m.name}><small>{m.name}</small><b className={m.value ? undefined : 'none'}>{m.value ?? '–'}</b></span>)}</span>
        : g.status === 'preview' || g.status === 'live' ? <span className="xs-mkts empty">{c.noOdds}</span> : null}
    </a>
  )
}

const LEAGUES: { key: League; name: string }[] = [{ key: 'mlb', name: 'MLB' }, { key: 'nba', name: 'NBA' }]

/** The leagues bar (Oct 13 redesign, through Codex: the XTell-style row of
 *  two small marks in a wide white strip "looks poor"). One compact sticky
 *  toolbar on the content's own edges: in a game, the way back to the games
 *  first; then the leagues as a capsule control, MLB's mark beside its name
 *  and the NBA's landscape mark, which carries its own, the current one
 *  white with the site's red. No 全部 (owner:
 *  "remove 'all' tab"): /xsports alone lists every league with none
 *  marked; a league shows only its games. */
function SportsBar({ c, current, onPick, onBack }: { c: Copy; current: League | null; onPick: (k: League) => void; onBack?: () => void }) {
  return (
    <div className={`xs-topbar${onBack ? ' room' : ''}`}>
      <div className="xs-topin">
        {onBack ? (
          <button type="button" className="xs-topback" onClick={onBack}>
            <svg viewBox="0 0 24 24" aria-hidden><path d="M15 5l-7 7 7 7" /></svg>
            <span>{c.back}</span>
          </button>
        ) : null}
        <nav className="xs-leagues" aria-label={c.leaguesNav}>
          {LEAGUES.map(({ key: k, name }) => (
            <a key={k} href={`/xsports?league=${k}`} className={k} aria-label={k === 'nba' ? name : undefined}
              aria-current={current === k ? 'page' : undefined}
              onClick={e => { if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) { e.preventDefault(); onPick(k) } }}>
              {k === 'nba' ? <NbaLockup /> : (<>
                <span className={`mk ${k}`} aria-hidden><img src={LEAGUE_MARK[k]} alt="" /></span>
                <span>{name}</span>
              </>)}
            </a>
          ))}
        </nav>
      </div>
    </div>
  )
}

function useGames(league: League, date: string) {
  const [games, setGames] = useState<GameCard[] | null>(null)
  const [down, setDown] = useState(false)
  useEffect(() => {
    let stop = false
    let first = true
    const load = async () => {
      // Refreshes wait for the tab to be in front; the first load never does.
      if (document.hidden && !first) return
      first = false
      try {
        const res = await fetch(`/api/xsports/games?league=${league}&date=${date}`)
        if (!res.ok) throw new Error(String(res.status))
        const j = await res.json()
        if (!stop) { setGames(j.games ?? []); setDown(false) }
      } catch { if (!stop) setDown(true) }
    }
    setGames(null)
    setDown(false)
    load()
    const t = setInterval(load, 30_000)
    const onVis = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', onVis)
    return () => { stop = true; clearInterval(t); document.removeEventListener('visibilitychange', onVis) }
  }, [date, league])
  return { games, down }
}

/** One league's games. Its heading only when several leagues share the
 *  page: under the league's own tab the bar already says it (owner, Oct 13:
 *  "you don't need 'MLB' row when I am already in MLB tab page"). */
function LeagueBlock({ league, name, date, c, lang, heading, hrefOf, onOpen }: {
  league: League; name: string; date: string; c: Copy; lang: string; heading: boolean; hrefOf: (pk: number) => string; onOpen: (pk: number) => void
}) {
  const { games, down } = useGames(league, date)
  const order = (g: GameCard) => (g.status === 'live' ? 0 : g.status === 'preview' || g.status === 'other' ? 1 : 2)
  const list = games ? [...games].sort((a, b) => order(a) - order(b) || a.start.localeCompare(b.start)) : null
  const season = games?.some(g => g.series === 'Preseason') ? c.series('Preseason') : ''
  return (
    <section className="xs-league" aria-label={name}>
      {heading ? (
        <h2 className="xs-lghd">
          <img className={`mark ${league}`} src={LEAGUE_MARK[league]} alt="" onError={e => { e.currentTarget.style.display = 'none' }} />
          {name}{season ? <small>{season}</small> : null}
        </h2>
      ) : null}
      {list === null ? (
        down
          ? <p className="xs-empty">{c.feedDown}</p>
          : <div className="xs-cards" aria-busy="true"><span className="xs-sr">{c.loading}</span><span className="xs-card skel" /><span className="xs-card skel" /></div>
      ) : list.length === 0 ? (
        <p className="xs-empty">{down ? c.feedDown : c.noGamesFor(name)}</p>
      ) : (
        <>
          {down ? <p className="xs-note">{c.feedDown}</p> : null}
          <div className="xs-cards">
            {list.map(g => (
              <GameCardView key={g.pk} g={g} league={league} c={c} lang={lang} wide={list.length === 1} href={hrefOf(g.pk)} seasonAbove={heading} onOpen={() => onOpen(g.pk)} />
            ))}
          </div>
        </>
      )}
    </section>
  )
}

function Scores({ c, lang, only, hrefOf, onOpen }: { c: Copy; lang: string; only: League | 'all'; hrefOf: (league: League, pk: number) => string; onOpen: (league: League, pk: number) => void }) {
  const today = mlbToday()
  const [date, setDate] = useState(today)
  const days = Array.from({ length: 7 }, (_, i) => shiftDate(today, i - 2))
  const fmt = (d: string, o: Intl.DateTimeFormatOptions) => { try { return new Intl.DateTimeFormat(lang, { ...o, timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`)) } catch { return d } }
  return (
    <>
      {/* No masthead (owner, Oct 13: "remove this entire row"); the page's
          name stays for screen readers. */}
      <h1 className="xs-sr">{c.brand}</h1>
      <div className="xs-strip">
        <span className="month">{fmt(date, { year: 'numeric', month: 'long' })}</span>
        <div className="days" role="group">
          {days.map(d => (
            <button key={d} aria-pressed={d === date} aria-current={d === today ? 'date' : undefined} onClick={() => setDate(d)} aria-label={fmt(d, { month: 'long', day: 'numeric', weekday: 'long' })}>
              <small>{d === today ? c.today : fmt(d, { weekday: 'short' })}</small><b>{Number(d.slice(8, 10))}</b>
            </button>
          ))}
        </div>
      </div>
      {LEAGUES.filter(l => only === 'all' || only === l.key).map(l => (
        <LeagueBlock key={l.key} league={l.key} name={l.name} date={date} c={c} lang={lang} heading={only === 'all'} hrefOf={pk => hrefOf(l.key, pk)} onOpen={pk => onOpen(l.key, pk)} />
      ))}
      <p className="xs-foot">{c.dataNote}</p>
    </>
  )
}

// ── A game: the overview (left, top) ────────────────────────────────────────
// The approved split room (owner, Oct 13): one compact row of three (the
// league and series | both clubs' logos around the score, the inning or
// period under it | the state over who is watching), then the line score
// and, while MLB is live, one strip of the bases, count, batter and pitcher.
// No win-probability bar here; the odds keep their own tab.

/** "今天 21:14", or the date and time for another day. */
function clockOf(iso: string | undefined, lang: string, c: Copy): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  try {
    const t = new Intl.DateTimeFormat(lang, { hour: 'numeric', minute: '2-digit' }).format(d)
    if (d.toDateString() === new Date().toDateString()) return `${c.today} ${t}`
    return `${new Intl.DateTimeFormat(lang, { month: 'numeric', day: 'numeric' }).format(d)} ${t}`
  } catch { return '' }
}

/** Under the score: the inning (MLB; its outs are in the strip) or the
 *  period and clock (NBA), the day before a game, final after. */
function underOf(g: GameState, c: Copy, lang: string): string {
  const st = statusOf(g, c)
  return g.status === 'live' ? ((g.league ?? 'mlb') === 'nba' ? [st.main, st.sub].filter(Boolean).join(' ') : st.main)
    : g.status === 'preview' ? shortDate(g.start, lang) : g.status === 'final' ? c.final : g.detailed
}

function Overview({ g, c, lang, viewers, onJump }: { g: GameState; c: Copy; lang: string; viewers: number; onJump: (n: number) => void }) {
  const league = g.league ?? 'mlb'
  const started = g.status === 'live' || g.status === 'final'
  const a = g.away.runs ?? 0, h = g.home.runs ?? 0
  const loser = g.status === 'final' ? (a < h ? 'away' : h < a ? 'home' : null) : null
  const n = g.now
  const between = g.inningState === 'Middle' || g.inningState === 'End'
  const state = g.status === 'live' ? c.live : g.status === 'preview' ? c.notStarted : g.status === 'other' ? g.detailed : c.final
  const under = underOf(g, c, lang)
  const series = seriesLine(g, c)
  const dots = (k: string, on: number, of: number) => Array.from({ length: of }, (_, i) => <i key={i} className={i < on ? k : ''} />)
  return (
    <section className="xs-ov" aria-label={`${g.away.name} @ ${g.home.name}`}>
      {/* One inner block, so phones can fold the header away smoothly. */}
      <div className="xs-ov-in">
      <div className="xs-ov-top">
        <div className="lg">
          <img className={`mark ${league}`} src={LEAGUE_MARK[league]} alt="" onError={e => { e.currentTarget.style.display = 'none' }} />
          <div><b>{league.toUpperCase()}</b>{series ? <small>{series}</small> : null}</div>
        </div>
        <div className="mx" role="group" aria-label={started ? `${g.away.name} ${a}, ${g.home.name} ${h}` : `${g.away.name} @ ${g.home.name}`}>
          <TeamLogo league={league} t={g.away} />
          <div className="sc">
            {started
              ? <span className="score"><span className={loser === 'away' ? 'lose' : undefined}>{a}</span><i>–</i><span className={loser === 'home' ? 'lose' : undefined}>{h}</span></span>
              : <span className="time">{localTime(g.start)}</span>}
            {under ? <small className={g.status === 'live' ? 'live' : undefined}>{under}</small> : null}
          </div>
          <TeamLogo league={league} t={g.home} />
        </div>
        <div className="st">
          <span className={`xs-state ${g.status}`}>{g.status === 'live' ? <span className="xs-pulse" /> : null}{state}</span>
          {viewers > 0 ? <span className="xs-watch"><i />{c.watching(viewers)}</span> : null}
        </div>
      </div>
      {g.innings.length > 0 ? <LineScore g={g} c={c} onJump={onJump} /> : null}
      {league === 'mlb' && g.status === 'live' && n && !between ? (
        <div className="xs-ov-strip">
          <svg className="field" viewBox="0 0 64 46" aria-hidden>
            <path d="M32 44 L5 17 A38 38 0 0 1 59 17 Z" fill="#e4f1e2" stroke="#c8dfc4" strokeWidth="1" />
            <path d="M32 40 L46 26 L32 12 L18 26 Z" fill="#f3e7d6" stroke="#dcc9ad" strokeWidth="1" />
            {([[46, 26, n.bases.first], [32, 12, n.bases.second], [18, 26, n.bases.third]] as [number, number, unknown][]).map(([x, y, on], i) => (
              <rect key={i} x={x - 3.5} y={y - 3.5} width="7" height="7" transform={`rotate(45 ${x} ${y})`} fill={on ? 'var(--xs-red)' : '#fff'} stroke={on ? 'var(--xs-red)' : '#9aa3ad'} strokeWidth="1.2" />
            ))}
            <rect x="29.5" y="37.5" width="5" height="5" fill="#fff" stroke="#9aa3ad" strokeWidth="1" />
          </svg>
          <div className="cnt" aria-label={`${n.balls}-${n.strikes}, ${c.outsN(n.outs)}`}>
            <span>B{dots('b', n.balls, 3)}</span>
            <span>S{dots('s', n.strikes, 2)}</span>
            <span>O{dots('o', n.outs, 2)}</span>
          </div>
          {n.batter ? <div className="who"><small>{c.batterLbl}</small><b>{n.batter}</b>{n.batterToday ? <small>{c.todayLine(n.batterToday)}</small> : null}</div> : null}
          {n.pitcher ? <div className="who"><small>{c.pitcherLbl}</small><b>{n.pitcher}</b>{n.pitcherPitches ? <small>{c.pitchesN(n.pitcherPitches)}</small> : null}</div> : null}
        </div>
      ) : null}
      </div>
    </section>
  )
}

/** Phones, while a pane has the screen: the game on one line; a tap brings
 *  back the score header and the bars above it. */
function MiniScore({ g, c, lang, onOpen }: { g: GameState; c: Copy; lang: string; onOpen: () => void }) {
  const league = g.league ?? 'mlb'
  const started = g.status === 'live' || g.status === 'final'
  const under = underOf(g, c, lang)
  // The box opens and closes the line smoothly; the cut clips it while it does.
  return (
    <div className="xs-mini-box">
    <div className="xs-mini-cut">
    <button type="button" className="xs-mini" onClick={onOpen}>
      <span className="tm"><TeamLogo league={league} t={g.away} /><b>{g.away.abbr}</b></span>
      <span className="sc">{started ? `${g.away.runs ?? 0} – ${g.home.runs ?? 0}` : localTime(g.start)}</span>
      <span className="tm"><b>{g.home.abbr}</b><TeamLogo league={league} t={g.home} /></span>
      {under ? <small className={g.status === 'live' ? 'live' : undefined}>{under}</small> : null}
      <span className="xs-sr">{c.showHeader}</span>
      <svg className="chev" viewBox="0 0 24 24" aria-hidden><path d="M6 9l6 6 6-6" /></svg>
    </button>
    </div>
    </div>
  )
}

// ── A game: its tabs ────────────────────────────────────────────────────────

const ctxOf = (g: GameState | null, e: PlayEvent, c: Copy) => (g?.league === 'nba' ? c.period(e.inning) : c.half(e.inning, e.half === 'top'))

// ── A game: 戰況, the plays and their clips (left) ──────────────────────────

type Clips = { clips: Clip[]; hiddenByRegion: number; down: boolean }

/** The game's clips (lib/xsports-highlights.ts): every 45 s while it is
 *  live, every 3 minutes otherwise (recaps come after), tab in front. */
function useHighlights(league: League, pk: number, live: boolean): Clips | null {
  const [h, setH] = useState<Clips | null>(null)
  useEffect(() => {
    let stop = false
    let first = true
    const load = async () => {
      if (document.hidden && !first) return
      first = false
      try {
        const res = await fetch(`/api/xsports/highlights/${pk}?league=${league}`)
        const j = await res.json()
        if (!stop && Array.isArray(j?.clips)) setH({ clips: j.clips, hiddenByRegion: Number(j.hiddenByRegion) || 0, down: !!j.down })
      } catch {
        if (!stop) setH(prev => prev ?? { clips: [], hiddenByRegion: 0, down: true })
      }
    }
    load()
    const t = setInterval(load, live ? 45_000 : 180_000)
    const onVis = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', onVis)
    return () => { stop = true; clearInterval(t); document.removeEventListener('visibilitychange', onVis) }
  }, [league, pk, live])
  return h
}

/** "2 分鐘前", "3 hr. ago". */
function ago(iso: string | null, lang: string): string {
  const t = iso ? Date.parse(iso) : NaN
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, (Date.now() - t) / 1000)
  try {
    const f = new Intl.RelativeTimeFormat(lang, { numeric: 'auto', style: 'short' })
    if (s < 3600) return f.format(-Math.max(1, Math.round(s / 60)), 'minute')
    if (s < 86400) return f.format(-Math.round(s / 3600), 'hour')
    return f.format(-Math.round(s / 86400), 'day')
  } catch { return '' }
}
const mmss = (n: number | null) => (n ? `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}` : '')

function Thumb({ clip, c, onOpen, big }: { clip: Clip; c: Copy; onOpen: (clip: Clip) => void; big?: boolean }) {
  return (
    <button className={`xs-thumb${big ? ' big' : ''}`} onClick={() => onOpen(clip)} aria-label={`${c.playClip}: ${clip.title}`}>
      {clip.thumb ? <img src={clip.thumb} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : null}
      <span className="pl" aria-hidden><svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" /></svg></span>
      {clip.duration ? <span className="du">{mmss(clip.duration)}</span> : null}
    </button>
  )
}

/** A clip in a list: its picture, title, and where and when it came from. */
function ClipRow({ clip, where, c, lang, onOpen }: { clip: Clip; where: string; c: Copy; lang: string; onOpen: (clip: Clip) => void }) {
  return (
    <div className="xs-cliprow" data-at={`c:${clip.id}`}>
      <Thumb clip={clip} c={c} onOpen={onOpen} />
      <div className="tx">
        <button className="ti" onClick={() => onOpen(clip)}>{clip.title}</button>
        <small>{[where, clip.source, ago(clip.publishedAt, lang)].filter(Boolean).join(' · ')}</small>
      </div>
    </div>
  )
}

/** 戰況: every play, newest first, under a line per half-inning or period;
 *  a play with a clip of its own carries it. 精彩影片 lists every clip. */
function Feed({ g, c, lang, pk, h, filter, setFilter, fresh, onSeen, onOpen, bodyRef }: {
  g: GameState; c: Copy; lang: string; pk: number; h: Clips | null
  filter: 'all' | 'clips'; setFilter: (f: 'all' | 'clips') => void
  fresh: number; onSeen: () => void; onOpen: (clip: Clip) => void
  bodyRef: React.MutableRefObject<HTMLDivElement | null>
}) {
  const nba = g.league === 'nba'
  const clips = h?.clips ?? []
  const shown = new Set(g.events.map(e => e.id))
  const onPlay = new Map<string, Clip>()
  for (const cl of clips) if (cl.event && shown.has(cl.event) && !onPlay.has(cl.event)) onPlay.set(cl.event, cl)
  // On top of 戰況: the game-level clips (recap, full-game highlights), then
  // in-game ones with no play of their own; three at most. Interviews and the
  // rest are under 精彩影片.
  const rank = { game: 0, play: 1, other: 2 }
  const loose = clips.filter(cl => (!cl.event || !shown.has(cl.event)) && cl.kind !== 'other')
    .sort((a, b) => rank[a.kind] - rank[b.kind])
  const labelOf = (e: PlayEvent) => (nba ? c.period(e.inning) : c.half(e.inning, e.half === 'top'))
  const whereOf = (cl: Clip) => { const e = cl.event ? g.events.find(x => x.id === cl.event) : undefined; return e ? labelOf(e) : '' }

  const groups: { key: string; label: string; side: string; inning: number; rows: PlayEvent[] }[] = []
  for (const e of g.events) {
    const key = nba ? `${e.inning}` : `${e.inning}-${e.half}`
    let grp = groups[groups.length - 1]
    if (!grp || grp.key !== key) {
      grp = { key, inning: e.inning, label: labelOf(e), side: nba ? '' : c.batting(e.half === 'top' ? g.away.abbr : g.home.abbr), rows: [] }
      groups.push(grp)
    }
    grp.rows.push(e)
  }
  const anchored = new Set<number>()

  const status = h === null ? c.clipsLoading : h.down ? c.clipsDown : null
  return (
    <div className="xs-feed">
      <div className="xs-feed-hd">
        <h2>{c.tabFeed}</h2>
        <div className="xs-filter" role="group">
          <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>{c.all}</button>
          <button aria-pressed={filter === 'clips'} onClick={() => { setFilter('clips'); onSeen() }}>{c.clipsFilter}{clips.length ? <b>{clips.length}</b> : null}</button>
        </div>
      </div>
      {fresh > 0 ? (
        <button className="xs-fresh" onClick={() => { setFilter('clips'); onSeen(); bodyRef.current?.scrollTo({ top: 0 }) }}>
          <span className="xs-pulse" />{c.newClips(fresh)}<span className="chev" aria-hidden>›</span>
        </button>
      ) : null}
      <div className="xs-feed-body" ref={bodyRef}>
        {filter === 'clips' ? (
          <div className="xs-cliplist">
            {status ? <p className="xs-feed-note">{status}</p>
              : clips.length === 0 ? <p className="xs-feed-note">{h && h.hiddenByRegion > 0 ? c.clipsRegionAll(h.hiddenByRegion) : c.noClips}</p>
              : clips.map(cl => <ClipRow key={cl.id} clip={cl} where={whereOf(cl)} c={c} lang={lang} onOpen={onOpen} />)}
            {h && !status && clips.length > 0 && h.hiddenByRegion > 0 ? <p className="xs-feed-note small">{c.clipsRegion(h.hiddenByRegion)}</p> : null}
          </div>
        ) : (
          <>
            {loose.length > 0 ? (
              // One compact row that scrolls sideways, so the plays stay in
              // view (Codex review, Oct 13); the rest under 精彩影片.
              <section className="xs-loose" aria-label={c.gameClips}>
                <div className="hd"><b>{c.gameClips}</b><button onClick={() => { setFilter('clips'); onSeen() }}>{c.moreClips} <span aria-hidden>›</span></button></div>
                <div className="strip">
                  {loose.slice(0, 8).map(cl => (
                    <div key={cl.id} className="card" data-at={`c:${cl.id}`}>
                      <Thumb clip={cl} c={c} onOpen={onOpen} />
                      <button className="ti" onClick={() => onOpen(cl)}>{cl.title}</button>
                      <small>{[cl.source, ago(cl.publishedAt, lang)].filter(Boolean).join(' · ')}</small>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
            {!g.events.length ? <p className="xs-feed-note">{c.noPlays}</p> : null}
            {[...groups].reverse().map(grp => {
              // The jump target for an inning or period is its first group shown.
              const anchor = !anchored.has(grp.inning) ? (anchored.add(grp.inning), `xs-inn-${pk}-${grp.inning}`) : undefined
              return (
                <section key={grp.key} id={anchor} className="xs-grp">
                  <div className="xs-feed-ph">{grp.label}{grp.side ? <small>{grp.side}</small> : null}</div>
                  {[...grp.rows].reverse().map(e => {
                    const cl = onPlay.get(e.id)
                    return (
                      <div key={e.id} data-at={`e:${e.id}`} className={`xs-ev${e.scoring ? ' run' : ''}${cl ? ' has-clip' : ''}`}>
                        <span className="dot" aria-hidden />
                        <div className="tx">
                          <p>{e.text}</p>
                          {!nba && (e.pitch || e.hit) ? <small className="x">{[e.pitch, e.hit].filter(Boolean).join('，')}</small> : null}
                          {e.scoring ? <b className="sc">{g.away.abbr} {e.away} – {e.home} {g.home.abbr}</b> : null}
                          <small className="tm">{[nba ? e.clock : '', clockOf(e.at, lang, c), !nba && e.kind === 'pa' && e.outs !== null ? c.outsN(e.outs) : ''].filter(Boolean).join('　')}</small>
                          {cl ? (
                            <span className="cm">
                              <span>{[cl.source, ago(cl.publishedAt, lang)].filter(Boolean).join(' · ')}</span>
                              <button onClick={() => onOpen(cl)}><svg viewBox="0 0 24 24" aria-hidden><path d="M8 5.5v13l11-6.5z" /></svg>{c.playClip}</button>
                            </span>
                          ) : null}
                        </div>
                        {cl ? <Thumb clip={cl} c={c} onOpen={onOpen} /> : null}
                      </div>
                    )
                  })}
                </section>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}

/** A clip open on the left, in its source's own player (no autoplay); the
 *  chat stays on the right. Where the source has no player we may frame, or
 *  says no, its own page opens instead. */
function ClipPlayer({ clip, clips, g, c, lang, newPlays, onBack, onOpen }: {
  clip: Clip; clips: Clip[]; g: GameState; c: Copy; lang: string; newPlays: number
  onBack: () => void; onOpen: (clip: Clip) => void
}) {
  const nba = g.league === 'nba'
  const e = clip.event ? g.events.find(x => x.id === clip.event) : undefined
  const where = e ? (nba ? c.period(e.inning) : c.half(e.inning, e.half === 'top')) : ''
  const others = clips.filter(x => x.id !== clip.id).slice(0, 6)
  return (
    <div className="xs-player">
      <div className="bar">
        <button className="back" onClick={onBack}><span aria-hidden>←</span> {c.backToFeed}</button>
        {newPlays > 0 ? <button className="xs-fresh small" onClick={onBack}><span className="xs-pulse" />{c.newPlays(newPlays)}</button> : null}
      </div>
      <div className="frame">
        {clip.playable && clip.embed ? (
          <iframe key={clip.id} src={clip.embed} title={clip.title} allow="encrypted-media; fullscreen; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
        ) : (
          <a className="off" href={clip.url} target="_blank" rel="noopener noreferrer">
            {clip.thumb ? <img src={clip.thumb} alt="" referrerPolicy="no-referrer" /> : null}
            <span>{c.clipNoEmbed}</span>
          </a>
        )}
      </div>
      <div className="meta">
        <div>
          <span className="badge">{c.clipBadge}</span>
          <h3>{clip.title}</h3>
          <small>{[where, clip.source, ago(clip.publishedAt, lang), mmss(clip.duration)].filter(Boolean).join(' · ')}</small>
        </div>
        <a className="orig" href={clip.url} target="_blank" rel="noopener noreferrer">{c.watchOriginal} <span aria-hidden>↗</span></a>
      </div>
      {others.length ? (
        <section className="more">
          <h4>{c.moreClips}</h4>
          <div className="row">{others.map(x => <ClipRow key={x.id} clip={x} where={x.event ? (() => { const ev = g.events.find(y => y.id === x.event); return ev ? (nba ? c.period(ev.inning) : c.half(ev.inning, ev.half === 'top')) : '' })() : ''} c={c} lang={lang} onOpen={onOpen} />)}</div>
        </section>
      ) : null}
    </div>
  )
}

/** The line score; an inning or period number jumps to its plays. */
function LineScore({ g, c, onJump }: { g: GameState; c: Copy; onJump: (n: number) => void }) {
  const nba = g.league === 'nba'
  const cols = Math.max(nba ? 4 : 9, g.innings.length)
  const head = (i: number) => (nba && i + 1 > 4 ? `OT${i + 1 > 5 ? i - 3 : ''}` : `${i + 1}`)
  return (
    <div className="xs-line">
      <table>
        <thead>
          <tr>
            <th />
            {Array.from({ length: cols }, (_, i) => <th key={i}>{g.innings[i] ? <button onClick={() => onJump(i + 1)}>{head(i)}</button> : head(i)}</th>)}
            {nba ? <th>T</th> : <><th>R</th><th>H</th><th>E</th></>}
          </tr>
        </thead>
        <tbody>
          {(['away', 'home'] as const).map(side => (
            <tr key={side}>
              <td className="tm"><TeamLogo league={g.league ?? 'mlb'} t={g[side]} /><span>{g[side].abbr}</span></td>
              {Array.from({ length: cols }, (_, i) => <td key={i}>{g.innings[i]?.[side] ?? ''}</td>)}
              <td className="tot">{g[side].runs ?? 0}</td>
              {!nba && <td>{g[side].hits ?? 0}</td>}
              {!nba && <td>{g[side].errors ?? 0}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BoxTab({ g, c }: { g: GameState; c: Copy }) {
  const [side, setSide] = useState<'away' | 'home'>(g.half === 'bottom' ? 'home' : 'away')
  // Before the first pitch or tip-off there are no numbers, only the
  // bullpen's "Ashby -.--" (owner, Oct 14: "say not started ... not leaving
  // some weird strings there"): one plain line instead.
  if (g.status === 'preview') return <p className="xs-none" style={{ padding: '12px 0' }}>{c.boxNotStarted}</p>
  const seg = (
    <div className="xs-seg" role="group">
      {(['away', 'home'] as const).map(s2 => <button key={s2} aria-pressed={side === s2} onClick={() => setSide(s2)}>{g[s2].club || g[s2].abbr}</button>)}
    </div>
  )
  if (g.league === 'nba') {
    const nb = g.nbaBox
    return (
      <div className="xs-box">
        {seg}
        {nb && nb[side].length ? (
          <div className="xs-tablewrap">
            <table className="xs-table">
              <thead><tr><th />{nb.cols.map(col => <th key={col}>{col}</th>)}</tr></thead>
              <tbody>
                {nb[side].map((r, i) => (
                  <tr key={i} className={r.starter ? '' : 'sub'}>
                    <td>{r.name}<span className="pos">{r.pos}</span></td>
                    {r.stats.map((v, j) => <td key={j}>{v}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="xs-none" style={{ padding: '12px 0' }}>{c.noPlays}</p>}
      </div>
    )
  }
  const tb = g.teamBox?.[side]
  const tot = (k: 'ab' | 'r' | 'h' | 'rbi' | 'bb' | 'k') => (tb?.batters ?? []).reduce((n, b) => n + b[k], 0)
  return (
    <div className="xs-box">
      {seg}
      {tb && tb.batters.length > 0 && (
        <div className="xs-tablewrap">
          <table className="xs-table">
            <caption>{c.batters}</caption>
            <thead><tr><th /><th>AB</th><th>R</th><th>H</th><th>RBI</th><th>BB</th><th>K</th><th>AVG</th></tr></thead>
            <tbody>
              {tb.batters.map(b => (
                <tr key={b.id} className={b.sub ? 'sub' : ''}>
                  <td>{b.name}<span className="pos">{b.pos}</span></td>
                  <td>{b.ab}</td><td>{b.r}</td><td>{b.h}</td><td>{b.rbi}</td><td>{b.bb}</td><td>{b.k}</td><td>{b.avg}</td>
                </tr>
              ))}
              <tr className="tot"><td /><td>{tot('ab')}</td><td>{tot('r')}</td><td>{tot('h')}</td><td>{tot('rbi')}</td><td>{tot('bb')}</td><td>{tot('k')}</td><td /></tr>
            </tbody>
          </table>
        </div>
      )}
      {tb && tb.pitchers.length > 0 && (
        <div className="xs-tablewrap">
          <table className="xs-table">
            <caption>{c.pitchersLbl}</caption>
            <thead><tr><th /><th>IP</th><th>H</th><th>R</th><th>ER</th><th>BB</th><th>K</th><th>P</th><th>ERA</th></tr></thead>
            <tbody>
              {tb.pitchers.map(x => (
                <tr key={x.id}><td>{x.name}</td><td>{x.ip}</td><td>{x.h}</td><td>{x.r}</td><td>{x.er}</td><td>{x.bb}</td><td>{x.k}</td><td>{x.pitches}</td><td>{x.era}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {tb && (tb.notes.length > 0 || tb.bullpen.length > 0) && (
        <ul className="xs-notes" aria-label={c.notes}>
          {tb.notes.map((l, i) => <li key={i}>{l}</li>)}
          {/* Semicolons, as MLB's own notes: a name may carry a comma ("Festa, M"). */}
          {tb.bullpen.length > 0 && <li>{c.bullpen}: {tb.bullpen.join('; ')}</li>}
        </ul>
      )}
    </div>
  )
}

/** One source's chances as a bar in the two teams' colours. */
function OddsRow({ g, title, note, away, home }: { g: GameState; title: string; note: string; away: number; home: number }) {
  const sum = away + home
  const aw = sum > 0 ? Math.round((away / sum) * 100) : 50
  return (
    <div className="xs-or">
      <div className="h">{title}{note ? <small>{note}</small> : null}</div>
      <div className="xs-pbar"><i style={{ width: `${aw}%`, background: teamColor(g.away) }} /><i style={{ flex: 1, background: teamColor(g.home) }} /></div>
      <div className="v"><span>{g.away.abbr} {Math.round(away)}%</span><span>{Math.round(home)}% {g.home.abbr}</span></div>
    </div>
  )
}

/** Everything about who is favoured, in one place, as information. */
function OddsTab({ g, c }: { g: GameState; c: Copy }) {
  const rows: React.ReactNode[] = []
  if (g.winProb && g.status === 'live') rows.push(<OddsRow key="m" g={g} title={c.modelOf(g.league ?? 'mlb')} note={c.liveUpdate} away={g.winProb.away} home={g.winProb.home} />)
  if (g.market && g.market.away !== null && g.market.home !== null) rows.push(<OddsRow key="k" g={g} title="Kalshi" note={g.market.volume ? c.traded(money(g.market.volume)) : ''} away={g.market.away} home={g.market.home} />)
  if (g.poly && g.poly.away !== null && g.poly.home !== null) rows.push(<OddsRow key="p" g={g} title={c.poly} note={g.poly.volume ? c.traded(money(g.poly.volume)) : ''} away={g.poly.away} home={g.poly.home} />)
  if (g.line && (g.line.spread || g.line.total !== null)) {
    rows.push(
      <div key="l" className="xs-or">
        <div className="h">{c.pregameLine(g.line.provider)}</div>
        <div className="line">{g.line.spread ? <span>{g.line.spread}</span> : null}{g.line.total !== null ? <span>{c.total(g.line.total)}</span> : null}</div>
      </div>,
    )
  }
  return (
    <div className="xs-oddsTab">
      {rows.length ? rows : <p className="xs-none" style={{ padding: '16px 0' }}>{c.noOdds}</p>}
      <p className="xs-oddsNote">{c.oddsNote}</p>
    </div>
  )
}

// ── The game's chat: one live thread ────────────────────────────────────────

interface RoomMsg { id: number; kind: 'human' | 'ai'; author_name: string; author_handle?: string | null; author_avatar: string | null; content: string; model_name: string | null; reply_to: number | null; created_at: string }

// ── XSports' own dialog ──────────────────────────────────────────────────────
// Owner, Oct 14: "deletion should use our dialog too, not system alert".
// The room's sheet (.xs-sheet): from the bottom on phones, centred from
// 720px. Esc or a tap outside closes; focus starts inside (on `autoFocus`,
// else the first field, else Cancel) and stays there; it goes back to what
// opened it.

function Dialog({ title, onClose, actions, children }: {
  title: string; onClose: () => void; actions: React.ReactNode; children?: React.ReactNode
}) {
  const card = useRef<HTMLDivElement | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const id = useMemo(() => `xs-dlg-${uid()}`, [])
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null
    const el = card.current
    const focusables = () => el ? [...el.querySelectorAll<HTMLElement>('button, input, textarea, select, [tabindex]:not([tabindex="-1"])')].filter(x => !x.hasAttribute('disabled')) : []
    ;(el?.querySelector<HTMLElement>('[data-autofocus]') ?? el?.querySelector<HTMLElement>('input, textarea') ?? focusables()[0])?.focus()
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); return }
      if (e.key !== 'Tab') return
      const f = focusables()
      if (!f.length) return
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus() }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus() }
    }
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('keydown', onKey, true); back?.focus?.() }
  }, [])
  return (
    <div className="xs-sheet" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={card} className="card xs-dlg" role="dialog" aria-modal="true" aria-labelledby={id}>
        <h2 id={id}>{title}</h2>
        {children}
        <div className="acts">{actions}</div>
      </div>
    </div>
  )
}

/** The words a dialog is about, quoted: who, then the start of it. */
const Quote = ({ who, text }: { who: string; text: string }) => (
  <blockquote className="xs-dlg-quote"><b>{who}</b><span>{text.length > 140 ? `${text.slice(0, 140)}…` : text}</span></blockquote>
)

/** Why a message is reported (the server's list; supabase/133). */
const FAN_REASONS = ['spam', 'harassment', 'hate', 'sexual', 'misinfo', 'other'] as const
const AI_REASONS = ['wrong', 'inappropriate', 'spam', 'other'] as const
type Reason = (typeof FAN_REASONS)[number] | (typeof AI_REASONS)[number]

// ── @ in a box: a list of who can be named ─────────────────────────────────
// Owner, Oct 14: "I can't @ AI with autosuggestion. It's not convenient".
// Typing @ (or ＠) opens a list above the box: in the public chat the AI
// commentators and the fans who have spoken; in AI 私聊 the picked models.
// ↑↓ move, Enter or Tab picks, Esc closes; a tap picks. Picking writes
// "@name " where the @ was.

interface AtOption { key: string; label: string; insert: string; hint?: string; logo?: { provider: string; model: string }; avatar?: string | null }
const norm = (v: string) => v.toLowerCase().replace(/\s+/g, '')

function useAt(draft: string, setDraft: (v: string) => void, inputRef: React.RefObject<HTMLInputElement | null>, options: AtOption[]) {
  const [at, setAt] = useState<{ start: number; query: string } | null>(null)
  const [pick, setPick] = useState(0)
  const shown = at ? options.filter(o => norm(o.label).includes(norm(at.query)) || norm(o.insert).includes(norm(at.query))).slice(0, 8) : []
  /** After a change or a caret move: is an @ being typed just before the caret? */
  const read = (value: string, caret: number | null) => {
    const before = value.slice(0, caret ?? value.length)
    const m = /[@＠]([^\s@＠]*)$/.exec(before)
    setAt(m ? { start: before.length - m[0].length, query: m[1] } : null)
    setPick(0)
  }
  const choose = (o: AtOption) => {
    if (!at) return
    const input = inputRef.current
    const caret = input?.selectionStart ?? draft.length
    const next = `${draft.slice(0, at.start)}@${o.insert} ${draft.slice(caret)}`
    const pos = at.start + o.insert.length + 2
    setDraft(next)
    setAt(null)
    requestAnimationFrame(() => { input?.focus(); input?.setSelectionRange(pos, pos) })
  }
  /** The box's keys while the list is open; true when the key was the list's. */
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): boolean => {
    if (!shown.length || (e.nativeEvent as any).isComposing) return false
    if (e.key === 'ArrowDown') { e.preventDefault(); setPick(i => (i + 1) % shown.length); return true }
    if (e.key === 'ArrowUp') { e.preventDefault(); setPick(i => (i - 1 + shown.length) % shown.length); return true }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(shown[Math.min(pick, shown.length - 1)]); return true }
    if (e.key === 'Escape') { e.preventDefault(); setAt(null); return true }
    return false
  }
  /** What the box needs: the @ reading on change, caret moves and blur. */
  const inputProps = {
    role: 'combobox' as const, 'aria-expanded': shown.length > 0, 'aria-autocomplete': 'list' as const,
    onKeyUp: (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') read(e.currentTarget.value, e.currentTarget.selectionStart) },
    onClick: (e: React.MouseEvent<HTMLInputElement>) => read(e.currentTarget.value, e.currentTarget.selectionStart),
    onBlur: () => setAt(null),
  }
  const list = shown.length ? (
    <ul className="xs-at" role="listbox">
      {shown.map((o, i) => (
        <li key={o.key} role="option" aria-selected={i === pick} onMouseDown={e => { e.preventDefault(); choose(o) }}>
          {o.logo ? <ProviderLogo provider={o.logo.provider} model={o.logo.model} size={16} />
            : o.avatar ? <img className="face" src={o.avatar} alt="" referrerPolicy="no-referrer" />
            : <span className="face" aria-hidden>{(o.label.trim()[0] ?? '?').toUpperCase()}</span>}
          <span className="nm">{o.label}</span>
          {o.hint ? <small>{o.hint}</small> : null}
        </li>
      ))}
    </ul>
  ) : null
  return { read, onKeyDown, inputProps, list, close: () => setAt(null) }
}

/** A commentator's @handle, from the model name its messages carry. */
const aiHandle = (m: { model_name: string | null }): string | null => HOUSE_AIS.find(a => a.name === m.model_name)?.handle ?? null

/** A chat keeps to its newest line while the reader is at the bottom, and
 *  lets go the moment they scroll up: Oct 14, on a phone, pulling back a
 *  little unfolded the header, the box shrank under the reader, and the old
 *  rule (anywhere within 80px of the bottom holds) snapped them back to the
 *  last message ("why the dialog keeps jump back to my previous message?").
 *  Scrolling up now holds only at the very bottom; coming back down near
 *  it holds again. Plays that arrive after the messages, a late font, a
 *  hidden tab coming back or the fold all change the height without a
 *  scroll, so the box's size is watched rather than its line count. */
function useStickToBottom(ref: React.RefObject<HTMLDivElement | null>) {
  const pinned = useRef(true)
  useEffect(() => {
    const el = ref.current
    const inner = el?.firstElementChild
    if (!el || !inner) return
    let last = el.scrollTop
    const onScroll = () => {
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight
      pinned.current = el.scrollTop < last - 1 ? gap < 2 : gap < 80
      last = el.scrollTop
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    const ro = new ResizeObserver(() => { if (pinned.current) { el.scrollTop = el.scrollHeight; last = el.scrollTop } })
    ro.observe(inner)
    ro.observe(el)
    return () => { el.removeEventListener('scroll', onScroll); ro.disconnect() }
  }, [ref])
  return pinned
}

/** A fan's message with its mentions marked: @AI and @someone's_id. */
function withMentions(text: string): React.ReactNode {
  const out: React.ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(/[@＠](?:\s*ai(?![a-z0-9_.])|[a-z0-9_.]{3,20})/gi)) {
    if (m.index! > last) out.push(text.slice(last, m.index))
    out.push(<span key={m.index} className="xs-men">{m[0]}</span>)
    last = m.index! + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** The game's chat (owner, Oct 13: "the UI is so AI flavor"): one live
 *  thread like PTT's live posts or a stream's chat. Fans and the
 *  commentators (two models ModelXD pays for, each shown by its model
 *  name and @handle) in
 *  compact lines, the game's key plays as thin lines between them, a quiet
 *  line where an inning or period begins. New messages arrive over Supabase
 *  Realtime (supabase/131); the watching count is Realtime presence; a
 *  signed-in viewer's open page asks every 10 s whether a commentator
 *  should speak. */
function Thread({ league, pk, lang, c, g, signedIn, onSignIn, onViewers }: {
  league: League; pk: number; lang: string; c: Copy; g: GameState | null
  signedIn: boolean | null; onSignIn: () => void; onViewers: (n: number) => void
}) {
  const [msgs, setMsgs] = useState<RoomMsg[]>([])
  // The room's first read is back: only then can it say nobody has spoken.
  const [loaded, setLoaded] = useState(false)
  const [down, setDown] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [flash, setFlash] = useState('')
  const [panel, setPanel] = useState<{ name: string; avatar: string | null; text: string; handle: string | null } | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [panelErr, setPanelErr] = useState('')
  const t = useT()
  const [mine, setMine] = useState<Set<number>>(new Set())
  const [reported, setReported] = useState<Set<number>>(new Set())
  // The dialogs: reporting a message (why), taking back your own.
  const [reporting, setReporting] = useState<RoomMsg | null>(null)
  const [why, setWhy] = useState<Reason | null>(null)
  const [whyMore, setWhyMore] = useState('')
  const [dlgBusy, setDlgBusy] = useState(false)
  const [dlgErr, setDlgErr] = useState('')
  const [removing, setRemoving] = useState<RoomMsg | null>(null)
  const [flashOk, setFlashOk] = useState(false)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const add = useCallback((m: RoomMsg) => setMsgs(prev => (prev.some(x => x.id === m.id) ? prev : [...prev, m].sort((x, y) => x.id - y.id).slice(-300))), [])

  useEffect(() => {
    let stop = false
    // Read the room; merged with what Realtime already delivered.
    const load = () => fetch(`/api/xsports/room?league=${league}&game=${pk}&lang=${lang}`).then(async res => {
      if (stop) return
      if (!res.ok) { setDown(true); return }
      setDown(false)
      const j = await res.json()
      const rows = (j.messages ?? []) as RoomMsg[]
      // Your own messages (the server knows; ids only): 刪除 instead of 檢舉.
      const own: number[] = Array.isArray(j.mine) ? j.mine : []
      if (own.length) setMine(prev => new Set([...prev, ...own]))
      setLoaded(true)
      setMsgs(prev => {
        const seen = new Set(prev.map(m => m.id))
        return [...prev, ...rows.filter(m => !seen.has(m.id))].sort((x, y) => x.id - y.id).slice(-300)
      })
    }).catch(() => { if (!stop) setDown(true) })
    load()
    const onVis = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', onVis)
    const client = sb()
    const channel = client.channel(`xsports-room:${league}:${pk}:${lang}`, { config: { presence: { key: uid() } } })
    channel
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'xsports_room_messages', filter: `game_id=eq.${pk}` }, (payload: any) => {
        const r = payload?.new
        if (r && r.league === league && r.lang === lang && !r.hidden) add(r as RoomMsg)
      })
      // A message taken back by its author, or hidden by reports: gone here
      // too, at once (the server's broadcast).
      .on('broadcast', { event: 'gone' }, ({ payload }: any) => { const id = Number(payload?.id); setMsgs(prev => prev.filter(m => m.id !== id)) })
      .on('presence', { event: 'sync' }, () => onViewers(Object.keys(channel.presenceState()).length))
      .subscribe(async status => {
        if (status !== 'SUBSCRIBED') return
        // Anything written between the first read and the subscription
        // (Oct 13: the commentator's greeting, ~3 s after opening) is read now.
        load()
        await channel.track({ at: Date.now() })
      })
    return () => { stop = true; document.removeEventListener('visibilitychange', onVis); client.removeChannel(channel) }
  }, [league, pk, lang, add, onViewers])

  // A commentator speaks when an open page's tick finds a reason.
  useEffect(() => {
    if (!signedIn) return
    const tick = () => { if (!document.hidden) fetch('/api/xsports/room/tick', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ league, game: pk, lang }) }).catch(() => {}) }
    tick()
    const t = setInterval(tick, 10_000)
    return () => clearInterval(t)
  }, [signedIn, league, pk, lang])

  // The thread: messages and the game's key plays in time order.
  type Line = { t: number; key: string; play?: PlayEvent; msg?: RoomMsg }
  const lines: Line[] = []
  for (const m of msgs) lines.push({ t: Date.parse(m.created_at), key: `m${m.id}`, msg: m })
  for (const e of g?.events ?? []) if (e.at) lines.push({ t: Date.parse(e.at), key: `p${e.id}`, play: e })
  lines.sort((x, y) => x.t - y.t)

  // Keep to the newest line while the reader is at the bottom; leave them be
  // once they scroll up to read (useStickToBottom).
  const pinned = useStickToBottom(boxRef)

  const post = async (text: string, confirmName = false) => {
    setSending(true)
    setFlash('')
    try {
      const res = await fetch('/api/xsports/room', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ league, game: pk, lang, content: text, confirmName }) })
      const j = await res.json().catch(() => ({}))
      if (res.status === 401) { onSignIn(); return false }
      if (res.status === 409 && j.code === 'name_unconfirmed') {
        // A name still copied from the sign-in starts empty: the person sets one.
        setPanel({ name: j.chosen ? (j.name ?? '') : '', avatar: j.avatar ?? null, text, handle: j.handle ?? null })
        setNameDraft(j.chosen ? (j.name ?? '') : '')
        setPanelErr('')
        return false
      }
      if (!res.ok) {
        setFlashOk(false)
        setFlash(j.code === 'too_fast' ? c.slowDown : j.code === 'refused' ? c.refusedMsg : j.code === 'muted' ? c.mutedMsg : j.code === 'check_unavailable' ? c.checkDown : c.roomDown)
        return false
      }
      const m = j.message as RoomMsg
      setMine(prev => new Set(prev).add(m.id))
      // Your own message always brings you to the newest line.
      pinned.current = true
      add(m)
      return true
    } finally {
      setSending(false)
    }
  }

  const send = async () => {
    const text = draft.trim()
    if (!text || sending) return
    if (signedIn === false) { onSignIn(); return }
    if (await post(text)) setDraft('')
  }

  // The first message: the person sets the name everyone will see. The @ID
  // is shown, not changed, here: it changes on the account page only (owner,
  // Oct 13: "why you allow users to change id while entering the chat room?").
  const useName = async () => {
    if (!panel) return
    setPanelErr('')
    const name = nameDraft.trim()
    if (name && name !== panel.name) {
      const res = await fetch('/api/profile/face', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
      if (!res.ok) {
        const code = String((await res.json().catch(() => ({}))).error ?? '')
        setPanelErr(code === 'too_many' ? t('face.err.too_many') : code === 'check_unavailable' ? c.checkDown : c.nameError)
        return
      }
    }
    const text = panel.text
    setPanel(null)
    if (await post(text, true)) setDraft('')
  }

  // Taking back your own message (owner, Oct 14): gone for everyone, after
  // the dialog says so.
  const removeMine = async () => {
    const m = removing
    if (!m) return
    setDlgBusy(true)
    setDlgErr('')
    try {
      const res = await fetch('/api/xsports/room/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: m.id }) })
      if (!res.ok) { setDlgErr(c.roomDown); return }
      setMsgs(prev => prev.filter(x => x.id !== m.id))
      setRemoving(null)
    } catch { setDlgErr(c.roomDown) } finally { setDlgBusy(false) }
  }
  // Reporting: the dialog asks why (owner, Oct 14: "fill more data? why 檢舉").
  const openReport = (m: RoomMsg) => { setReporting(m); setWhy(null); setWhyMore(''); setDlgErr('') }
  const sendReport = async () => {
    const m = reporting
    if (!m || !why) return
    setDlgBusy(true)
    setDlgErr('')
    try {
      const res = await fetch('/api/xsports/room/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: m.id, reason: why, details: whyMore.trim() || undefined }) })
      if (!res.ok) { setDlgErr(c.roomDown); return }
      setReported(prev => new Set(prev).add(m.id))
      if ((await res.json()).hidden) setMsgs(prev => prev.filter(x => x.id !== m.id))
      setReporting(null)
      setFlash(c.reportThanks)
      setFlashOk(true)
    } catch { setDlgErr(c.roomDown) } finally { setDlgBusy(false) }
  }

  // Who an @ can name here: whichever commentator is up (@AI), each
  // commentator by its @handle (owner, Oct 14: "can user choose which AI to
  // mention?"), then the fans who have spoken, newest first (never yourself).
  const atOptions: AtOption[] = [
    { key: 'ai', label: c.aiAny, insert: 'AI', hint: '@AI' },
    ...HOUSE_AIS.map(a => ({ key: `ai:${a.handle}`, label: a.name, insert: a.handle, hint: `@${a.handle}`, logo: { provider: a.provider, model: a.model_name } })),
  ]
  const yours = new Set(msgs.filter(m => mine.has(m.id)).map(m => m.author_handle))
  for (const m of [...msgs].reverse()) {
    if (m.kind !== 'human' || !m.author_handle || yours.has(m.author_handle) || atOptions.some(o => o.insert === m.author_handle)) continue
    atOptions.push({ key: `h:${m.author_handle}`, label: m.author_name, insert: m.author_handle, hint: `@${m.author_handle}`, avatar: m.author_avatar && /^https:\/\//.test(m.author_avatar) ? m.author_avatar : null })
  }
  const atList = useAt(draft, setDraft, inputRef, atOptions)
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (atList.onKeyDown(e)) return
    if (isSubmitEnter(e as any)) { e.preventDefault(); send() }
  }
  const time = (ms: number) => { try { return new Intl.DateTimeFormat(lang, { hour: 'numeric', minute: '2-digit', hour12: false }).format(new Date(ms)) } catch { return '' } }

  const out: React.ReactNode[] = []
  let ctx = '', shown = ''
  for (const ln of lines) {
    // Plays are in 戰況 now (owner, Oct 13: not twice); they only say which
    // inning or period a message belongs to.
    if (ln.play) { ctx = ctxOf(g, ln.play, c); continue }
    if (ctx && ctx !== shown) { out.push(<div key={`s-${ln.key}`} className="xs-sep"><span>{ctx}</span></div>); shown = ctx }
    const m = ln.msg!
    const ai = m.kind === 'ai'
    const face = !ai && m.author_avatar && /^https:\/\//.test(m.author_avatar) ? m.author_avatar : null
    out.push(
      <div key={ln.key} className={`xs-msg${ai ? ' ai' : ''}${mine.has(m.id) ? ' mine' : ''}`}>
        {ai ? null : face
          ? <img className="av" src={face} alt="" loading="lazy" referrerPolicy="no-referrer" />
          : <span className="av" aria-hidden>{(m.author_name.trim()[0] ?? '?').toUpperCase()}</span>}
        <div className="col">
          {/* Who (the name, then a small @ID: owner, Oct 13, "A seems
              better"; the commentator by its model), when, then the words. */}
          <div className="who">
            {ai
              ? <><b className="n">{c.aiCommentator}</b><span className="model">{m.model_name ?? m.author_name}</span>{aiHandle(m) ? <span className="id">@{aiHandle(m)}</span> : null}</>
              : <><b className="n">{m.author_name}</b>{m.author_handle ? <span className="id">@{m.author_handle}</span> : null}</>}
            <time className="t" dateTime={m.created_at}>{time(ln.t)}</time>
            {/* Yours: 刪除. Anyone else's, the commentator's too (owner, Oct
                14): 檢舉. */}
            {!signedIn ? null : !ai && mine.has(m.id)
              ? <button className="rep" onClick={() => { setRemoving(m); setDlgErr('') }} aria-label={c.deleteMsg}>{c.deleteMsg}</button>
              : <button className="rep" onClick={() => openReport(m)} disabled={reported.has(m.id)} aria-label={c.report}>{reported.has(m.id) ? c.reported : c.report}</button>}
          </div>
          <div className="body">
            {ai
              ? <ReactMarkdown skipHtml remarkPlugins={REMARK_PLUGINS} components={{ p: ({ children }) => <>{children} </>, a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>{m.content}</ReactMarkdown>
              : withMentions(m.content)}
          </div>
        </div>
      </div>,
    )
  }

  return (
    <>
      {/* As tall as what is in it, up to a screen: a quiet room is short
          (Oct 13: no more empty space above three messages). */}
      <div ref={boxRef} className="xs-thread" role="log" aria-live="polite">
        <div className="xs-thread-in">
          {down ? <p className="xs-chat-empty">{c.roomDown}</p>
            : out.length ? out
            : loaded ? <div className="xs-chat-empty"><p>{c.roomEmpty}</p><small>{c.roomHint(HOUSE_AIS.map(a => a.handle))}</small></div>
            : <p className="xs-chat-empty">{c.loading}</p>}
        </div>
      </div>
      {flash && <p className={`xs-flash${flashOk ? ' ok' : ''}`} role="status">{flash}</p>}
      <div className="xs-at-box">
        {signedIn === false ? null : atList.list}
        <div className="xs-compose">
          {signedIn === false ? (
            <button className="signin" onClick={onSignIn}>{c.signInChat}</button>
          ) : (
            <>
              <input ref={inputRef} value={draft} placeholder={c.roomPlaceholder} maxLength={500} aria-label={c.roomPlaceholder} enterKeyHint="send"
                {...atList.inputProps}
                onChange={e => { setDraft(e.target.value); atList.read(e.target.value, e.target.selectionStart) }}
                onKeyDown={onKey} />
              <button className="send" onClick={send} disabled={!draft.trim() || sending}>{c.send}</button>
            </>
          )}
        </div>
      </div>
      {reporting ? (() => {
        const ai = reporting.kind === 'ai'
        const list: readonly Reason[] = ai ? AI_REASONS : FAN_REASONS
        return (
          <Dialog title={ai ? c.reportAiTitle : c.reportTitle} onClose={() => { if (!dlgBusy) setReporting(null) }}
            actions={<>
              <button className="xs-link" onClick={() => setReporting(null)} disabled={dlgBusy}>{c.cancel}</button>
              <button className="xs-send" onClick={sendReport} disabled={!why || dlgBusy}>{c.reportSend}</button>
            </>}>
            <Quote who={ai ? `${c.aiCommentator}${reporting.model_name ? ` · ${reporting.model_name}` : ''}` : reporting.author_name} text={reporting.content} />
            <fieldset className="xs-dlg-why">
              <legend>{c.reportWhy}</legend>
              {list.map((r, i) => (
                <label key={r} className={why === r ? 'on' : undefined}>
                  <input type="radio" name="xs-why" value={r} checked={why === r} onChange={() => setWhy(r)} {...(i === 0 ? { 'data-autofocus': true } : {})} />
                  <span>{c.reasons[r]}</span>
                </label>
              ))}
            </fieldset>
            <label className="lbl" htmlFor="xs-why-more">{c.reportDetails}</label>
            <textarea id="xs-why-more" className="xs-dlg-more" rows={2} maxLength={300} placeholder={c.reportDetailsPh} value={whyMore} onChange={e => setWhyMore(e.target.value)} />
            <p className="note">{c.reportNote}</p>
            {dlgErr ? <p className="err" role="alert">{dlgErr}</p> : null}
          </Dialog>
        )
      })() : null}
      {removing ? (
        <Dialog title={c.deleteTitle} onClose={() => { if (!dlgBusy) setRemoving(null) }}
          actions={<>
            <button className="xs-link" onClick={() => setRemoving(null)} disabled={dlgBusy} data-autofocus>{c.cancel}</button>
            <button className="xs-send danger" onClick={removeMine} disabled={dlgBusy}>{c.deleteAction}</button>
          </>}>
          <Quote who={removing.author_name} text={removing.content} />
          <p>{c.deleteBody}</p>
          {dlgErr ? <p className="err" role="alert">{dlgErr}</p> : null}
        </Dialog>
      ) : null}
      {panel && (
        <div className="xs-sheet" role="dialog" aria-modal="true" aria-labelledby="xs-name-title">
          <div className="card">
            <h2 id="xs-name-title">{c.nameTitle}</h2>
            <label className="lbl" htmlFor="xs-name">{c.nameLabel}</label>
            <div className="row">
              {panel.avatar ? <img className="xs-av" src={panel.avatar} alt="" referrerPolicy="no-referrer" /> : <span className="xs-av" aria-hidden>{(nameDraft.trim()[0] ?? '?').toUpperCase()}</span>}
              <input id="xs-name" value={nameDraft} onChange={e => setNameDraft(e.target.value)} maxLength={30} placeholder={c.namePlaceholder} autoFocus />
            </div>
            {panel.handle ? <p className="idline"><span>{t('face.handle')}</span>@{panel.handle}</p> : null}
            <p>{c.nameHelp}</p>
            {panelErr && <p className="err" role="alert">{panelErr}</p>}
            <div className="acts">
              <button className="xs-link" onClick={() => setPanel(null)}>{c.cancel}</button>
              <button className="xs-send" onClick={useName} disabled={!nameDraft.trim()}>{c.nameUse}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── A game: the private AI chat (right, AI 私聊) ────────────────────────────
// Owner, Oct 13: "we need a private chat room with AI" (the viewer picks and
// pays), then, through Codex: the models at the top, and several at once.
// One private conversation: a question goes to every picked model, one
// after another, each answer card named by its model. 開始陪看 is opt-in
// automatic watching, where the models take turns, one remark at a time,
// each billed at its own list price. Picking models or opening the tab
// generates nothing. Server: /api/xsports/talk (lib/xsports-turn) and the
// saved chats (supabase/130), whose remarks keep their model.

const TICK_MS = 1_500
const IDLE_MS = 20 * 60_000
/** How much a model says unasked, set per model (owner, Oct 13: "how do I
 *  control how actively they talk?", then "each model should have config").
 *  Gaps in ms since that model last spoke: `big` after a run, a home run,
 *  the end of an inning or period, the final; `play` after ordinary plays
 *  (batched); `lullLive` when nothing happens in a live game; `lullOff`
 *  before or after one, at most `offLulls` times. Null: never. 一般 is the
 *  Oct 12 pacing ("actively talking, not passively answering"); 關 answers
 *  only when asked. `perHour` is a rough count of remarks an hour, for the
 *  cost line only. */
type Pace = 'low' | 'mid' | 'high'
type Talk = 'off' | Pace
const PACES: Record<Pace, { big: number; play: number | null; lullLive: number | null; lullOff: number | null; offLulls: number; perHour: number }> = {
  low: { big: 10_000, play: null, lullLive: null, lullOff: null, offLulls: 0, perHour: 15 },
  mid: { big: 10_000, play: 25_000, lullLive: 45_000, lullOff: 90_000, offLulls: 3, perHour: 80 },
  high: { big: 8_000, play: 15_000, lullLive: 25_000, lullOff: 60_000, offLulls: 5, perHour: 140 },
}
const TALKS: Talk[] = ['off', 'low', 'mid', 'high']
/** Two remarks nobody asked for, from any models, are never closer. */
const MIN_BETWEEN_MS = 6_000
/** Each model's settings: how much it talks unasked, and how hard it
 *  thinks (one of its own thinking levels; null = its quickest). */
interface ModelConf { talk: Talk; thinking: string | null }
const CONF_KEY = 'xsports.conf'       // { [model id]: ModelConf }, this browser
const DEFAULT_CONF: ModelConf = { talk: 'mid', thinking: null }
/** As many as the server takes (and XCreate puts side by side). */
const MAX_MODELS = 4
const DEFAULT_MODEL = { provider: 'openai', model_name: 'gpt-6-luna' }
const MODELS_KEY = 'xsports.models'   // the picked ids, in order
const MODEL_KEY = 'xsports.model'     // the one id remembered before Oct 13
const MODEL_COLS = 'id, provider, model_name, display_name, model_pricing, output_config, blocked_features, enabled'

type ModelRow = PickerModel & { enabled?: boolean | null }
type Trigger = 'open' | 'event' | 'lull' | 'user'

/** What was said: the viewer's words, each model's reply, notes. `after` is
 *  the last play when it was said. A reply waits for its turn, streams,
 *  then is done or failed; `turn` ties the replies to one question. */
type Said =
  | { k: 'bot'; id: string; turn: string; model: string; name: string; text: string; state: 'wait' | 'live' | 'done' | 'failed' | 'cut'; error?: string; cost: number | null; after: string | null }
  | { k: 'me'; id: string; text: string; after: string | null }
  | { k: 'note'; id: string; text: string; link?: { href: string; label: string }; after: string | null }
interface StoredMessage { seq: number; kind: 'viewer' | 'remark' | 'note'; content: string; after_event: string | null; model_id: string | null; model_name: string | null; cost: number | null }
interface StoredChat { id: string; game_id: string; title: string | null; since: string | null; spent_usd: number; model_id: string | null; created_at: string; updated_at: string }

const usd = (v: number) => (v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`)

/** Replies still waiting or streaming, settled (all of them, or one turn's):
 *  a model never started leaves no card; one cut off mid-answer keeps what
 *  it said, and one cut off before a word counts as failed. */
function settle(list: Said[], turn?: string): Said[] {
  const mine = (x: Said) => x.k === 'bot' && (turn === undefined || x.turn === turn)
  return list
    .filter(x => !(mine(x) && x.k === 'bot' && x.state === 'wait'))
    .map(x => (mine(x) && x.k === 'bot' && x.state === 'live' ? { ...x, state: x.text ? 'cut' : 'failed' } : x))
}

/** A rough list cost of one remark on this model: ~8K tokens in (the box
 *  score and player cards ride along) and ~90 out, measured on GPT-6 Luna
 *  in a live game on Oct 12. An estimate (cached input makes most bills
 *  lower); null when the row has no text prices. */
function perRemark(m: PickerModel | null): number | null {
  const t = (m as any)?.model_pricing?.tokens
  if (!t) return null
  const inp = Number(t.text_input), out = Number(typeof t.text_output === 'object' ? t.text_output?.default : t.text_output)
  if (!Number.isFinite(inp) || !Number.isFinite(out)) return null
  return (8000 * inp + 90 * out) / 1e6
}

/** The picked models a message names with @ (or ＠): a full name
 *  ("@Claude Opus 5.5"), else one word of a name or its start ("@claude",
 *  "@opus", "@gpt"). Case and spaces aside. */
function mentioned(text: string, models: PickerModel[]): PickerModel[] {
  const low = text.toLowerCase().replace(/＠/g, '@')
  const hit = new Set<string>()
  for (let at = low.indexOf('@'); at >= 0; at = low.indexOf('@', at + 1)) {
    const rest = low.slice(at + 1)
    const full = models.filter(m => rest.startsWith(m.display_name.toLowerCase()))
    if (full.length) {
      const longest = Math.max(...full.map(m => m.display_name.length))
      full.filter(m => m.display_name.length === longest).forEach(m => hit.add(m.id))
      continue
    }
    const word = /^[^\s@,，。、.!?！？:：;；]+/.exec(rest)?.[0]
    if (!word) continue
    for (const m of models) {
      const name = m.display_name.toLowerCase()
      if (name.split(/\s+/).includes(word) || name.replace(/\s+/g, '').startsWith(word)) hit.add(m.id)
    }
  }
  return models.filter(m => hit.has(m.id))
}
/** A model's own thinking levels, and the quickest of them (what the server
 *  uses when none is chosen: lib's quickest()). */
const levelsOf = (m: PickerModel): string[] => (m.output_config?.text?.thinking_levels ?? []).filter((l: unknown): l is string => typeof l === 'string')
const quickestOf = (levels: string[]): string | null => ['none', 'thinking_false', 'minimal', 'low'].find(l => levels.includes(l)) ?? null

/** Chat bubble with a small sparkle: the AI 私聊 tab, drawn like its
 *  neighbours (24px box, 2px round strokes). */
const PrivateIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden>
    <path d="M12 4H6.5A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8v4l4.5-4h5a2.5 2.5 0 0 0 2.5-2.5V11" />
    <path d="M18 1.5l1 2.6 2.5 1-2.5 1-1 2.6-1-2.6-2.5-1 2.5-1z" fill="currentColor" stroke="none" />
  </svg>
)

function PrivateChat({ league, pk, lang, c, g, signedIn, onSignIn }: {
  league: League; pk: number; lang: string; c: Copy; g: GameState | null
  signedIn: boolean | null; onSignIn: () => void
}) {
  const [said, setSaid] = useState<Said[]>([])
  const [models, setModelsState] = useState<ModelRow[]>([])
  const [modelsReady, setModelsReady] = useState(false)
  // Rows by id, for the replies' marks (a reopened chat may name a model
  // that is no longer picked).
  const [known, setKnown] = useState<Record<string, Pick<ModelRow, 'id' | 'provider' | 'model_name' | 'display_name'>>>({})
  const [pickerOpen, setPickerOpen] = useState(false)
  const [running, setRunning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [spent, setSpent] = useState(0)
  const [draft, setDraft] = useState('')
  // One private chat per game (owner, Oct 14: "remove multiple chats"): the
  // newest saved one opens with the room; 清除對話 deletes it.
  const [chatId, setChatId] = useState<string | null>(null)
  const [loadingChat, setLoadingChat] = useState(false)
  // 清除對話's dialog, and its state.
  const [clearing, setClearing] = useState(false)
  const [clearBusy, setClearBusy] = useState(false)
  const [clearErr, setClearErr] = useState('')
  // Each model's settings (remembered in this browser), and whose are open.
  const [conf, setConfState] = useState<Record<string, ModelConf>>({})
  const [confOpen, setConfOpen] = useState<string | null>(null)
  // The one model the next questions go to (a chip or 回覆), until ✕.
  const [target, setTarget] = useState<string | null>(null)

  const gameRef = useRef<GameState | null>(null)
  const runningRef = useRef(false)
  const busyRef = useRef(false)
  const sinceRef = useRef<string | null>(null)
  const lastRemarkRef = useRef(0)
  const lastActiveRef = useRef(Date.now())
  const offLullsRef = useRef(0)
  const failsRef = useRef(0)
  const spentRef = useRef(0)
  const modelsRef = useRef<ModelRow[]>([])
  const listRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  // The saved chat this conversation lives in; none until the first word.
  const chatRef = useRef<string | null>(null)
  // Which conversation the page shows: a reply to an older one (another
  // chat was opened meanwhile) is not drawn here. The server still saves it
  // in its own chat.
  const genRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  // Whose turn it is when nobody asked (the picked models take turns).
  const rotateRef = useRef(0)
  const confRef = useRef<Record<string, ModelConf>>({})
  // When each model last spoke, and its unasked remarks before or after a
  // game; when watching (re)started.
  const lastByRef = useRef<Record<string, number>>({})
  const offByRef = useRef<Record<string, number>>({})
  const watchFromRef = useRef(0)

  modelsRef.current = models
  confRef.current = conf
  useEffect(() => {
    gameRef.current = g
    if (g && sinceRef.current === null && !chatRef.current) sinceRef.current = g.events[g.events.length - 1]?.id ?? null
  }, [g])
  const tz = useMemo(() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return 'Asia/Taipei' } }, [])
  const setRun = useCallback((on: boolean) => { runningRef.current = on; setRunning(on) }, [])
  const lastPlay = () => { const ev = gameRef.current?.events; return ev?.length ? ev[ev.length - 1].id : null }
  const add = useCallback((m: Said) => setSaid(prev => [...prev, m]), [])
  const note = useCallback((text: string, link?: { href: string; label: string }) => add({ k: 'note', id: uid(), text, link, after: lastPlay() }), [add])
  // Talks on its own only while its tab is in view: hidden behind another
  // tab, it waits (no remarks, and no charge, nobody is reading).
  const inView = () => !!listRef.current && listRef.current.offsetParent !== null && !document.hidden
  const learn = useCallback((rows: Pick<ModelRow, 'id' | 'provider' | 'model_name' | 'display_name'>[]) => {
    if (rows.length) setKnown(prev => ({ ...prev, ...Object.fromEntries(rows.map(r => [String(r.id), r])) }))
  }, [])

  /** The picked models, remembered in this browser, in order. */
  const setModels = useCallback((next: ModelRow[]) => {
    modelsRef.current = next
    setModelsState(next)
    learn(next)
    try { localStorage.setItem(MODELS_KEY, JSON.stringify(next.map(m => m.id))) } catch { /* blocked */ }
  }, [learn])
  // Add or take off one (the picker's tick); at least one stays, at most four.
  const toggleModel = (m: PickerModel) => {
    const cur = modelsRef.current
    if (cur.some(x => x.id === m.id)) {
      if (cur.length <= 1) return
      const next = cur.filter(x => x.id !== m.id)
      setModels(next)
      if (confOpen === m.id) setConfOpen(null)
      // The last watcher went: the first one left watches.
      const quiet = (x: PickerModel) => (confRef.current[x.id]?.talk ?? 'mid') === 'off'
      if (next.every(quiet)) saveConf({ ...confRef.current, [next[0].id]: { ...(confRef.current[next[0].id] ?? DEFAULT_CONF), talk: 'mid' } })
    } else if (cur.length < MAX_MODELS) setModels([...cur, m])
  }

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(CONF_KEY) ?? '{}')
      if (saved && typeof saved === 'object') {
        const ok: Record<string, ModelConf> = {}
        for (const [id, v] of Object.entries(saved as Record<string, any>)) {
          if (v && TALKS.includes(v.talk)) ok[id] = { talk: v.talk, thinking: typeof v.thinking === 'string' ? v.thinking : null }
        }
        confRef.current = ok
        setConfState(ok)
      }
    } catch { /* blocked */ }
  }, [])
  /** A model's settings; a thinking level it no longer declares counts as
   *  its quickest. */
  const confOf = (m: PickerModel): ModelConf => {
    const c0 = confRef.current[m.id] ?? DEFAULT_CONF
    return c0.thinking && !levelsOf(m).includes(c0.thinking) ? { ...c0, thinking: null } : c0
  }
  /** The models that speak unasked: every picked one not set to 關, and
   *  the first one if all are (a watcher was taken off, say). */
  const watchersOf = (picked: ModelRow[]) => {
    const on = picked.filter(m => confOf(m).talk !== 'off')
    return on.length ? on : picked.slice(0, 1)
  }
  const saveConf = (next: Record<string, ModelConf>) => {
    confRef.current = next
    setConfState(next)
    try { localStorage.setItem(CONF_KEY, JSON.stringify(next)) } catch { /* blocked */ }
  }
  const setConf = (m: PickerModel, patch: Partial<ModelConf>) => {
    const next = { ...confOf(m), ...patch }
    // At least one picked model keeps watching.
    if (next.talk === 'off' && !modelsRef.current.some(x => x.id !== m.id && confOf(x).talk !== 'off')) return
    saveConf({ ...confRef.current, [m.id]: next })
  }

  // Any touch, key or scroll counts as being here.
  useEffect(() => {
    const touch = () => { lastActiveRef.current = Date.now() }
    const evs = ['pointerdown', 'keydown', 'wheel', 'touchmove'] as const
    evs.forEach(e => window.addEventListener(e, touch, { passive: true }))
    return () => evs.forEach(e => window.removeEventListener(e, touch))
  }, [])

  // Leaving the room, or the panel set aside (Next keeps a hidden copy of a
  // page; Fast Refresh): stop listening; the server finishes the model it is
  // on and starts no more. The panel may come back, so nothing stays busy or
  // half-drawn.
  useEffect(() => () => {
    genRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    busyRef.current = false
    setBusy(false)
    setSaid(prev => settle(prev))
  }, [])


  // Open a saved chat, or a fresh one. A chat this tab just created is not
  // reloaded.
  useEffect(() => {
    if (chatId && chatId === chatRef.current) return
    // Another conversation on screen: whatever is still answering in the
    // old one stays there (the server saves it); this page stops listening.
    genRef.current += 1
    const gen = genRef.current
    abortRef.current?.abort()
    abortRef.current = null
    busyRef.current = false
    setBusy(false)
    setRun(false)
    offLullsRef.current = 0
    failsRef.current = 0
    chatRef.current = chatId
    setSaid([])
    spentRef.current = 0
    setSpent(0)
    sinceRef.current = lastPlay()
    // A load still running for the chat before is no longer this one's.
    setLoadingChat(false)
    if (!chatId) return
    setLoadingChat(true)
    fetch(`/api/xsports/chats/${chatId}`).then(async res => {
      if (gen !== genRef.current) return
      if (!res.ok) { chatRef.current = null; setChatId(null); return }
      const j = await res.json() as { chat: StoredChat; messages: StoredMessage[] }
      if (gen !== genRef.current) return
      sinceRef.current = j.chat.since ?? lastPlay()
      spentRef.current = Number(j.chat.spent_usd) || 0
      setSpent(spentRef.current)
      setSaid(j.messages.map((m): Said => m.kind === 'viewer'
        ? { k: 'me', id: `m${m.seq}`, text: m.content, after: m.after_event }
        : m.kind === 'remark'
          ? { k: 'bot', id: `m${m.seq}`, turn: '', model: m.model_id ?? '', name: m.model_name ?? 'AI', text: m.content, state: 'done', cost: m.cost == null ? null : Number(m.cost), after: m.after_event }
          : { k: 'note', id: `m${m.seq}`, text: m.content, after: m.after_event }))
      // The marks of models no longer picked.
      const missing = [...new Set(j.messages.map(m => m.model_id).filter((id): id is string => !!id))]
      if (missing.length) {
        const { data } = await sb().from('ai_models').select('id, provider, model_name, display_name').in('id', missing)
        learn(((data ?? []) as any[]).map(r => ({ ...r, id: String(r.id) })))
      }
    }).catch(() => {}).finally(() => { if (gen === genRef.current) setLoadingChat(false) })
  }, [chatId]) // eslint-disable-line react-hooks/exhaustive-deps

  // This game's chat, if there is one: the newest saved (older ones from
  // when a game could have several stay unopened). Nothing is generated here.
  useEffect(() => {
    if (!signedIn) return
    let stop = false
    fetch(`/api/xsports/chats?league=${league}&game=${pk}`).then(res => (res.ok ? res.json() : null)).then(j => {
      const latest = (j?.chats ?? [])[0] as StoredChat | undefined
      // Not if a conversation started here meanwhile.
      if (!stop && latest && !chatRef.current && !busyRef.current) setChatId(latest.id)
    }).catch(() => {})
    return () => { stop = true }
  }, [signedIn, league, pk])
  useEffect(() => {
    let stop = false
    let ids: string[] = []
    try {
      const many = JSON.parse(localStorage.getItem(MODELS_KEY) ?? 'null')
      if (Array.isArray(many)) ids = many.filter((x: unknown): x is string => typeof x === 'string').slice(0, MAX_MODELS)
      else { const one = localStorage.getItem(MODEL_KEY); if (one) ids = [one] }
    } catch { /* blocked */ }
    const client = sb()
    // A remembered model that is off, blocked here or cannot search is not
    // offered any more.
    const usable = (r: any) => !!r && r.enabled !== false && (r.output_config?.text?.capabilities ?? []).includes('web_search') && !(r.blocked_features ?? []).includes(FEATURE.xsports)
    ;(async () => {
      let rows: ModelRow[] = []
      if (ids.length) {
        const { data } = await client.from('ai_models').select(MODEL_COLS).in('id', ids)
        const byId = new Map(((data ?? []) as any[]).map(r => [String(r.id), { ...r, id: String(r.id) }]))
        rows = ids.map(id => byId.get(id)).filter(usable) as ModelRow[]
      }
      if (!rows.length) {
        const { data } = await client.from('ai_models').select(MODEL_COLS).eq('provider', DEFAULT_MODEL.provider).eq('model_name', DEFAULT_MODEL.model_name).maybeSingle()
        if (usable(data)) rows = [{ ...(data as any), id: String((data as any).id) }]
      }
      if (stop) return
      modelsRef.current = rows
      setModelsState(rows)
      learn(rows)
      setModelsReady(true)
    })()
    return () => { stop = true }
  }, [learn])

  // Keep to the newest line while the reader is at the bottom (as the room).
  const pinned = useStickToBottom(listRef)

  /** The chat this conversation is saved in; created on the first word.
   *  Null when it could not be, or when the conversation was cleared while
   *  it was being created (Codex review, Oct 13): the page stays cleared. */
  const ensureChat = useCallback(async (): Promise<string | null> => {
    if (chatRef.current) return chatRef.current
    const gen = genRef.current
    const res = await fetch('/api/xsports/chats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ league, game: pk }) })
    if (res.status === 401) { if (gen === genRef.current) onSignIn(); return null }
    if (!res.ok) return null
    const id = (await res.json()).chat?.id as string | undefined
    if (!id) return null
    if (gen !== genRef.current) return null
    chatRef.current = id
    setChatId(id)
    return id
  }, [league, pk, onSignIn])

  /** One turn: these models answer, one after another (the server's order),
   *  each in its own card. Only one turn at a time. */
  const runTurn = useCallback(async (trigger: Trigger, message: string, picked: ModelRow[]) => {
    if (!picked.length || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    const gen = genRef.current
    const live = () => gen === genRef.current
    const ctl = new AbortController()
    abortRef.current = ctl
    const turn = uid()
    let cards: string[] = []
    let through: string | null = null
    let spoke = false, failed = 0, broke = false
    const texts: string[] = []
    const patch = (i: number, f: (x: Extract<Said, { k: 'bot' }>) => Said) =>
      setSaid(prev => prev.map(x => (x.k === 'bot' && x.id === cards[i] ? f(x) : x)))
    try {
      const chat = await ensureChat()
      if (!live()) return
      if (!chat) { setRun(false); return }
      // A remark nobody asked for goes out only if watching is still on and
      // the tab still in view now that the chat exists (paused or hidden
      // meanwhile: nothing is sent; Codex review). A question always goes.
      if (trigger !== 'user' && (!runningRef.current || !inView())) return
      const res = await fetch('/api/xsports/talk', {
        method: 'POST',
        signal: ctl.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          league, pk, chatId: chat, modelIds: picked.map(m => m.id), lang, tz, trigger, message, seen: lastPlay(),
          // Each model's own thinking level, when one was chosen.
          thinking: Object.fromEntries(picked.flatMap(m => { const t = confOf(m).thinking; return t ? [[m.id, t]] : [] })),
        }),
      })
      if (!live()) return
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        if (res.status === 401) { setRun(false); onSignIn(); return }
        if (res.status === 402) { setRun(false); note(c.noCredits, { href: '/profile', label: c.topUp }); return }
        if (res.status === 429) return
        throw new Error(j?.error ?? `HTTP ${res.status}`)
      }
      const reader = res.body!.getReader()
      const dec = new TextDecoder()
      let buf = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        if (!live()) { reader.cancel().catch(() => {}); return }
        buf += dec.decode(value, { stream: true })
        let cut: number
        while ((cut = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, cut)
          buf = buf.slice(cut + 2)
          const ev = /^event: (.+)$/m.exec(block)?.[1]
          const data = /^data: (.+)$/m.exec(block)?.[1]
          if (!ev || !data) continue
          let d: any
          try { d = JSON.parse(data) } catch { continue }
          const i = typeof d.i === 'number' ? d.i : -1
          if (ev === 'meta') {
            through = d.through ?? null
            const ms: { i: number; id: string; name: string; provider: string; model_name: string }[] = Array.isArray(d.models) ? d.models : []
            learn(ms.map(m => ({ id: m.id, provider: m.provider, model_name: m.model_name, display_name: m.name })))
            cards = ms.map(() => uid())
            setSaid(prev => [...prev, ...ms.map((m, k): Said => ({ k: 'bot', id: cards[k], turn, model: m.id, name: m.name, text: '', state: 'wait', cost: null, after: through }))])
          } else if (ev === 'start' && i >= 0) {
            patch(i, x => ({ ...x, state: 'live' }))
          } else if (ev === 'delta' && i >= 0) {
            texts[i] = (texts[i] ?? '') + String(d.text ?? '')
            const t = texts[i]
            patch(i, x => ({ ...x, text: t }))
          } else if (ev === 'done' && i >= 0) {
            const cost = Number(d.cost) || 0
            if ((texts[i] ?? '').trim()) spoke = true
            spentRef.current += cost
            setSpent(spentRef.current)
            patch(i, x => ({ ...x, state: 'done', cost }))
          } else if (ev === 'error' && i >= 0) {
            failed += 1
            patch(i, x => ({ ...x, state: 'failed', error: String(d.message ?? '').slice(0, 200) }))
          } else if (ev === 'error') {
            throw new Error(String(d.message ?? ''))
          } else if (ev === 'end') {
            // The wallet ran out before a model could start: as a refused
            // turn (watching pauses, top-up offered); what was said stays.
            if (d.stopped === 'no_credits') broke = true
            // The chat's total as the server counted it.
            if (typeof d.spent === 'number') {
              spentRef.current = d.spent
              setSpent(d.spent)
            }
          }
        }
      }
      if (!live()) return
      if (broke) { setRun(false); note(c.noCredits, { href: '/profile', label: c.topUp }) }
      if (spoke) { sinceRef.current = through; failsRef.current = 0 }
      else if (failed) failsRef.current += 1
    } catch (e: any) {
      if (ctl.signal.aborted || !live()) return
      if (spoke) sinceRef.current = through
      failsRef.current += 1
      note(`${c.failed}: ${String(e?.message ?? e).slice(0, 200)}`)
    } finally {
      if (abortRef.current === ctl) abortRef.current = null
      lastRemarkRef.current = Date.now()
      for (const m of picked) lastByRef.current[m.id] = lastRemarkRef.current
      if (live()) {
        // However the turn ended (done, cut short, a broken stream), its
        // cards are settled (Codex review).
        setSaid(prev => settle(prev, turn))
        // A model that keeps failing should not keep trying in the background.
        if (failsRef.current >= 3) setRun(false)
        busyRef.current = false
        setBusy(false)
      }
    }
  }, [league, pk, lang, tz, onSignIn, c, note, learn, setRun, ensureChat]) // eslint-disable-line react-hooks/exhaustive-deps

  /** The model that opens watching: the next watching one in turn. */
  const opener = () => {
    const m = nextSpeaker(watchersOf(modelsRef.current), rotateRef.current)
    rotateRef.current += 1
    return m ? [m] : []
  }

  // The pacing loop: only while watching, in view, and not already answering.
  useEffect(() => {
    const t = setInterval(() => {
      if (!runningRef.current || busyRef.current || !inView() || !modelsRef.current.length) return
      const now = Date.now()
      if (now - lastActiveRef.current > IDLE_MS) { setRun(false); note(c.idle); return }
      const game = gameRef.current
      if (!game) return
      const i = sinceRef.current ? game.events.findIndex(e => e.id === sinceRef.current) : game.events.length - 1
      const fresh = i < 0 ? game.events.slice(-1) : game.events.slice(i + 1)
      if (now - lastRemarkRef.current < MIN_BETWEEN_MS) return
      const urgent = fresh.some(e => e.big || e.endsHalf) || game.status === 'final'
      const live = game.status === 'live'
      // Each watching model on its own clock (its level); of those due, the
      // one that has waited longest speaks.
      let due: { m: ModelRow; at: number; trigger: Trigger } | null = null
      for (const m of watchersOf(modelsRef.current)) {
        const talk = confOf(m).talk
        const p = PACES[talk === 'off' ? 'mid' : talk]
        const at = lastByRef.current[m.id] ?? watchFromRef.current
        const wait = fresh.length ? (urgent ? p.big : p.play)
          : live ? p.lullLive
          : (offByRef.current[m.id] ?? 0) < p.offLulls ? p.lullOff : null
        if (wait === null || now - at < wait) continue
        if (!due || at < due.at) due = { m, at, trigger: fresh.length ? 'event' : 'lull' }
      }
      if (!due) return
      if (!fresh.length && !live) offByRef.current[due.m.id] = (offByRef.current[due.m.id] ?? 0) + 1
      runTurn(due.trigger, '', [due.m])
    }, TICK_MS)
    return () => clearInterval(t)
  }, [runTurn, note, c, setRun]) // eslint-disable-line react-hooks/exhaustive-deps

  const hasRemarks = said.some(m => m.k === 'bot')
  // Automatic watching, on or off. Starting greets once (the first model in
  // turn), the first time.
  const toggleWatch = () => {
    lastActiveRef.current = Date.now()
    if (runningRef.current) { setRun(false); return }
    if (signedIn === false) { onSignIn(); return }
    if (!modelsRef.current.length) return
    offLullsRef.current = 0
    offByRef.current = {}
    lastByRef.current = {}
    watchFromRef.current = Date.now()
    failsRef.current = 0
    pinned.current = true
    setRun(true)
    if (!hasRemarks && !busyRef.current) runTurn('open', '', opener())
  }
  /** Who answers this text: the models it names with @, else the one the
   *  questions are aimed at, else every picked model. */
  const recipients = (text: string): ModelRow[] => {
    const picked = modelsRef.current
    const named = mentioned(text, picked) as ModelRow[]
    if (named.length) return named
    const aimed = picked.find(m => m.id === target)
    return aimed ? [aimed] : picked.slice()
  }
  // @ lists the picked models (when there is a choice).
  const atList = useAt(draft, setDraft, inputRef, models.length > 1
    ? models.map(m => ({ key: m.id, label: m.display_name, insert: m.display_name, logo: { provider: m.provider, model: m.model_name } }))
    : [])
  const send = () => {
    const text = draft.trim()
    // Not while a saved chat loads: its messages would replace these.
    if (!text || busyRef.current || loadingChat || !modelsRef.current.length) return
    lastActiveRef.current = Date.now()
    if (signedIn === false) { onSignIn(); return }
    const to = recipients(text)
    setDraft('')
    atList.close()
    pinned.current = true
    add({ k: 'me', id: uid(), text, after: lastPlay() })
    offLullsRef.current = 0
    runTurn('user', text, to)
  }
  /** Aim the next questions at one model (null: all of them). */
  const aim = (id: string | null) => { setTarget(id); inputRef.current?.focus() }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (atList.onKeyDown(e)) return
    if (isSubmitEnter(e as any)) { e.preventDefault(); send() }
  }
  /** 清除對話: this game's private chat is deleted (every one the viewer
   *  has for it, messages too) and the panel starts empty; what was spent
   *  stays in the credit history. */
  const clearChat = async () => {
    if (signedIn) {
      setClearBusy(true)
      setClearErr('')
      try {
        const res = await fetch(`/api/xsports/chats?league=${league}&game=${pk}`, { method: 'DELETE' })
        if (!res.ok) { setClearErr(c.failed); return }
      } catch { setClearErr(c.failed); return } finally { setClearBusy(false) }
    }
    setClearing(false)
    if (chatRef.current) { setChatId(null); return }
    // Nothing saved yet: just start over here.
    genRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    busyRef.current = false
    setBusy(false)
    setRun(false)
    setSaid([])
  }

  // What a question and an hour of watching cost, roughly: a question goes
  // to whoever answers it now; watching takes turns among the watching
  // models, so an hour is their average at this pace.
  const aimed = models.find(m => m.id === target) ?? null
  const named = mentioned(draft, models) as ModelRow[]
  const answering = named.length ? named : aimed ? [aimed] : models
  const watching = watchersOf(models)
  // A deeper thinking level adds reasoning the estimate does not count: '+'.
  const deep = (m: ModelRow) => { const t = confOf(m).thinking; return !!t && t !== quickestOf(levelsOf(m)) }
  /** An hour of watching for one model: its share of the remarks at its
   *  level (the watchers split the game's moments), at its price. */
  const hourOf = (m: ModelRow): number | null => {
    const one = perRemark(m), talk = confOf(m).talk
    if (one === null) return null
    if (talk === 'off' || !watching.some(w => w.id === m.id)) return 0
    return (PACES[talk].perHour / watching.length) * one
  }
  const askOne = answering.map(perRemark)
  const askKnown = askOne.filter((x): x is number => x !== null)
  const hours = watching.map(hourOf)
  const hourKnown = hours.filter((x): x is number => x !== null)
  const costs = [
    askKnown.length ? c.askCost(usd(askKnown.reduce((a, b) => a + b, 0)) + (askKnown.length < answering.length || answering.some(deep) ? '+' : '')) : null,
    hourKnown.length ? c.watchCost(usd(hourKnown.reduce((a, b) => a + b, 0)) + (hourKnown.length < watching.length || watching.some(deep) ? '+' : '')) : null,
  ].filter(Boolean).join(' · ')

  // What was said, with a quiet divider where an inning or period begins.
  const out: React.ReactNode[] = []
  let shown = ''
  for (const it of said) {
    const e = it.after ? g?.events.find(x => x.id === it.after) : undefined
    const ctx = e ? ctxOf(g, e, c) : ''
    if (ctx && ctx !== shown) { out.push(<div key={`s-${it.id}`} className="xs-sep"><span>{ctx}</span></div>); shown = ctx }
    if (it.k === 'note') { out.push(<p key={it.id} className="xs-pnote">{it.text}{it.link ? <> <a href={it.link.href}>{it.link.label}</a></> : null}</p>); continue }
    if (it.k === 'me') { out.push(<div key={it.id} className="xs-pme"><div className="body">{it.text}</div></div>); continue }
    const row = known[it.model]
    out.push(
      <article key={it.id} className={`xs-pv-reply ${it.state}`} aria-busy={it.state === 'wait' || it.state === 'live'}>
        <header>
          {row ? <ProviderLogo provider={row.provider} model={row.model_name} size={16} /> : null}
          <b>{it.name}</b>
          {it.state === 'wait' ? <small>{c.waitingTurn}</small> : null}
          {it.state === 'done' && it.cost ? <small className="cost">{usd(it.cost)}</small> : null}
          {models.length > 1 && models.some(m => m.id === it.model) && it.state !== 'wait' && it.state !== 'live' ? (
            <button type="button" className="re" onClick={() => aim(it.model)}>{c.reply}</button>
          ) : null}
        </header>
        {it.text ? (
          <div className="body">
            <ReactMarkdown skipHtml remarkPlugins={REMARK_PLUGINS} components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>
              {it.text + (it.state === 'live' ? ' ▍' : it.state === 'cut' ? ' …' : '')}
            </ReactMarkdown>
          </div>
        ) : it.state === 'live' ? <div className="dots" aria-hidden><i /><i /><i /></div> : null}
        {it.state === 'failed' ? <p className="err">{c.failed}{it.error ? `: ${it.error}` : ''}</p> : null}
      </article>,
    )
  }

  const full = models.length >= MAX_MODELS
  return (
    <>
      <div className="xs-pv-head">
        <div className="xs-pv-models" role="group" aria-label={c.modelsLabel}>
          <div className="xs-pv-chips">
          {models.map(m => {
            const isAimed = aimed?.id === m.id
            const isQuiet = !watching.some(w => w.id === m.id)
            return (
              <span key={m.id} className={`xs-pv-chip${isAimed ? ' aim' : ''}${isQuiet ? ' quiet' : ''}${confOpen === m.id ? ' open' : ''}`}>
                {/* Tap: only this model answers the next questions. */}
                <button type="button" className="who" aria-pressed={models.length > 1 ? isAimed : undefined}
                  title={isQuiet ? c.quietModel(m.display_name) : models.length > 1 ? c.askOnly(m.display_name) : m.display_name}
                  onClick={() => { if (models.length > 1) aim(isAimed ? null : m.id) }}>
                  <ProviderLogo provider={m.provider} model={m.model_name} size={14} />
                  <b>{m.display_name}</b>
                </button>
                <button type="button" className="cog" aria-expanded={confOpen === m.id} aria-controls="xs-pv-conf"
                  aria-label={c.settingsOf(m.display_name)} title={c.settingsOf(m.display_name)}
                  onClick={() => setConfOpen(confOpen === m.id ? null : m.id)}>
                  <svg viewBox="0 0 24 24" aria-hidden><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></svg>
                </button>
                {models.length > 1 ? (
                  <button type="button" className="x" aria-label={c.removeModel(m.display_name)} title={c.removeModel(m.display_name)} onClick={() => toggleModel(m)}>
                    <svg viewBox="0 0 24 24" aria-hidden><path d="M7 7l10 10M17 7L7 17" /></svg>
                  </button>
                ) : null}
              </span>
            )
          })}
          {!modelsReady ? <span className="xs-pv-chip skel" aria-hidden /> : null}
          </div>
          <button type="button" className="xs-pv-add" onClick={() => setPickerOpen(true)} disabled={!modelsReady} title={full ? c.maxModels(MAX_MODELS) : c.addModel}>
            <svg viewBox="0 0 24 24" aria-hidden>{full ? <path d="M4 7h11M4 7l3-3M4 7l3 3M20 17H9M20 17l-3-3M20 17l-3 3" /> : <path d="M12 5v14M5 12h14" />}</svg>
            <span className="lbl">{full ? c.change : c.addModel}</span>
          </button>
          <span className="xs-pv-count" aria-label={c.pickerCount(models.length, MAX_MODELS)}>{models.length}/{MAX_MODELS}</span>
        </div>
        {(() => {
          const m = models.find(x => x.id === confOpen)
          if (!m) return null
          const mc = confOf(m)
          const levels = levelsOf(m)
          const fast = quickestOf(levels)
          const lastOn = mc.talk !== 'off' && watching.length <= 1
          const one = perRemark(m), hr = hourOf(m)
          return (
            <div id="xs-pv-conf" className="xs-pv-conf" role="group" aria-label={c.settingsOf(m.display_name)}
              onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setConfOpen(null) } }}>
              <div className="hd">
                <ProviderLogo provider={m.provider} model={m.model_name} size={16} />
                <b>{m.display_name}</b>
                <button type="button" className="close" aria-label={c.closeLabel} onClick={() => setConfOpen(null)}>
                  <svg viewBox="0 0 24 24" aria-hidden><path d="M7 7l10 10M17 7L7 17" /></svg>
                </button>
              </div>
              <div className="row">
                <span className="lbl">{c.talkLabel}</span>
                <span className="opts" role="radiogroup" aria-label={c.talkLabel}>
                  {TALKS.map(t => (
                    <button type="button" key={t} role="radio" aria-checked={mc.talk === t} disabled={t === 'off' && lastOn}
                      title={t === 'off' && lastOn ? c.lastWatcher : c.talkHint[t]} onClick={() => setConf(m, { talk: t })}>{c.talk[t]}</button>
                  ))}
                </span>
              </div>
              <p className="hint">{c.talkHint[mc.talk]}</p>
              {levels.length > 1 ? (
                <>
                  <div className="row">
                    <span className="lbl">{c.thinkLabel}</span>
                    <span className="opts" role="radiogroup" aria-label={c.thinkLabel}>
                      {levels.map(l => {
                        const on = (mc.thinking ?? fast) === l
                        return <button type="button" key={l} role="radio" aria-checked={on} title={l} onClick={() => setConf(m, { thinking: l === fast ? null : l })}>{l === fast ? c.thinkFast : l}</button>
                      })}
                    </span>
                  </div>
                  <p className="hint">{c.thinkHint}</p>
                </>
              ) : null}
              {one !== null ? (
                <p className="cost">{[c.askCost(usd(one) + (deep(m) ? '+' : '')), hr ? c.watchCost(usd(hr) + (deep(m) ? '+' : '')) : null].filter(Boolean).join(' · ')}</p>
              ) : null}
            </div>
          )
        })()}
        <div className="xs-pv-bar">
          <button type="button" className={`xs-pv-watch${running ? ' on' : ''}`} aria-pressed={running} onClick={toggleWatch} disabled={!models.length || loadingChat}>
            <svg viewBox="0 0 24 24" aria-hidden>{running ? <path d="M8 5v14M16 5v14" /> : <path d="M7 4.5v15l12-7.5z" fill="currentColor" />}</svg>
            {signedIn === false ? c.signIn : running ? c.watchPause : c.watchStart}
          </button>
          <span className={`xs-pv-state${busy ? ' busy' : running ? ' on' : ''}`}><i />{busy ? c.answering : running ? c.watchOn : c.watchOff}</span>
          {costs ? <span className="xs-pv-cost" title={c.rotateNote}>{costs}</span> : null}
          {spent > 0 ? <span className="xs-pv-spent">{c.spent} <b>{usd(spent)}</b></span> : null}
        </div>
      </div>
      <div className="xs-pv-hist">
        <span className="xs-pv-only">{c.privateOnly}</span>
        {chatId || said.length ? <button type="button" className="xs-link" onClick={() => { setClearing(true); setClearErr('') }}>{c.clearChat}</button> : null}
      </div>
      <div ref={listRef} className="xs-thread" role="log" aria-live="polite" aria-busy={loadingChat}>
        <div className="xs-thread-in">
          {out.length ? out : (
            <div className="xs-pv-empty">
              <span className="ic"><PrivateIcon /></span>
              <p>{c.privateTitle}</p>
              <small>{c.privateEmpty}</small>
              {/* They only fill the box: sending stays the viewer's move. */}
              <div className="prompts">
                {c.prompts.map(q => <button type="button" key={q} onClick={() => { setDraft(q); inputRef.current?.focus() }}>{q}</button>)}
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="xs-pv-composer">
        {/* Who answers when not every picked model does. */}
        {models.length > 1 && answering.length < models.length ? (
          <div className="xs-pv-to">
            <span>{c.askOnly(answering.map(m => m.display_name).join(lang.startsWith('zh') || lang === 'ja' ? '、' : ', '))}</span>
            {!named.length ? <button type="button" aria-label={c.askAll} title={c.askAll} onClick={() => aim(null)}><svg viewBox="0 0 24 24" aria-hidden><path d="M7 7l10 10M17 7L7 17" /></svg></button> : null}
          </div>
        ) : null}
        {atList.list}
        <div className="xs-compose">
          <input ref={inputRef} value={draft} maxLength={1000} placeholder={c.placeholder} aria-label={c.placeholder} enterKeyHint="send"
            {...atList.inputProps}
            onChange={e => { setDraft(e.target.value); atList.read(e.target.value, e.target.selectionStart) }}
            onKeyDown={onKey} />
          <button type="button" className="send" onClick={send} disabled={!draft.trim() || busy || loadingChat || !models.length}>{c.send}</button>
        </div>
      </div>
      {clearing ? (
        <Dialog title={c.clearTitle} onClose={() => { if (!clearBusy) setClearing(false) }}
          actions={<>
            <button className="xs-link" onClick={() => setClearing(false)} disabled={clearBusy} data-autofocus>{c.cancel}</button>
            <button className="xs-send danger" onClick={clearChat} disabled={clearBusy}>{c.clearAction}</button>
          </>}>
          <p>{c.clearBody}</p>
          {clearErr ? <p className="err" role="alert">{clearErr}</p> : null}
        </Dialog>
      ) : null}
      {pickerOpen ? (
        <ModelPickerDialog
          mode="text" recipeMode="text_to_text" slotIds={[]} feature={FEATURE.xsports} needsSearch
          onClose={() => setPickerOpen(false)}
          onSelect={() => {}}
          multi={{ selected: models.map(m => m.id), max: MAX_MODELS, onToggle: toggleModel, doneLabel: c.pickerDone, countLabel: c.pickerCount(models.length, MAX_MODELS), maxLabel: c.maxModels(MAX_MODELS) }}
        />
      ) : null}
    </>
  )
}

// ── A game ──────────────────────────────────────────────────────────────────

type RTab = 'chat' | 'private' | 'box' | 'odds'

function Room({ league, pk, c, lang }: { league: League; pk: number; c: Copy; lang: string }) {
  const auth = useAuthModal()
  const [game, setGame] = useState<GameState | null>(null)
  const [feedDown, setFeedDown] = useState(false)
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  // Wide: 戰況 on the left, these four on the right. Phones: one of five.
  const [rtab, setRtab] = useState<RTab>('chat')
  const [view, setView] = useState<'feed' | RTab>('feed')
  const [viewers, setViewers] = useState(0)
  const [filter, setFilter] = useState<'all' | 'clips'>('all')
  // The clip playing, as it was when picked: a refresh that drops it from the
  // list (a source failing, a rolling list, a region change) must not stop
  // it (Codex review, Oct 13). It changes only when the reader picks.
  const [clip, setClip] = useState<Clip | null>(null)
  const openedAt = useRef(0)
  // Where the reader was in 戰況: the first row in view and how far down it
  // sat, so plays or clips that arrive above it while a clip plays do not
  // move them (a pixel offset would).
  const place = useRef<{ at: string; dy: number; top: number } | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => { sb().auth.getUser().then(({ data }) => setSignedIn(!!data.user)) }, [])

  // Phones (the site's fixed 60px bar, up to 760px): reading or typing
  // gives the screen to the pane (owner, Oct 14: "hide site bar and league
  // bar" so the chat has more room), like a phone browser's address bar.
  // Scrolling down (a finger moving up, the wheel down), the page scrolled
  // past 40px, or the composer in use folds both bars away and the score
  // header into one line (MiniScore); scrolling back up unfolds them (owner:
  // "I can't scroll back"), and so does a tap on that line. Unfolding takes
  // a longer pull than folding, so a small nudge while reading moves no
  // bars; sideways swipes (chips, clips, the line score) count for neither.
  // Only what a person does counts: a chat keeping to its newest line
  // scrolls by itself and must not fold anything. Nothing folds before the
  // game has loaded, so the line to unfold with is always there.
  const splitRef = useRef<HTMLDivElement | null>(null)
  const loaded = useRef(false)
  useEffect(() => { loaded.current = !!game }, [game])
  const [folded, setFolded] = useState(false)
  useEffect(() => {
    const el = splitRef.current
    if (!el) return
    const phone = window.matchMedia('(max-width: 760px)')
    const fold = () => { if (phone.matches && loaded.current) setFolded(true) }
    const open = () => setFolded(false)
    const FOLD_AT = 16, OPEN_AT = 48
    // run: how far the current stroke has gone one way (negative = down the
    // page); a turn starts it again.
    let x = 0, y = 0, run = 0
    const onStart = (e: TouchEvent) => { const t = e.touches[0]; if (t) { x = t.clientX; y = t.clientY; run = 0 } }
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0]
      if (!t) return
      const dx = t.clientX - x, dy = t.clientY - y
      x = t.clientX; y = t.clientY
      if (Math.abs(dx) > Math.abs(dy)) return
      run = Math.sign(dy) === Math.sign(run) ? run + dy : dy
      if (run <= -FOLD_AT) fold()
      else if (run >= OPEN_AT) open()
    }
    let wheel = 0, wheelAt = 0
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
      if (e.timeStamp - wheelAt > 300) wheel = 0
      wheelAt = e.timeStamp
      wheel = Math.sign(e.deltaY) === Math.sign(wheel) ? wheel + e.deltaY : e.deltaY
      if (wheel >= FOLD_AT) fold()
      else if (wheel <= -OPEN_AT) open()
    }
    const onType = (e: FocusEvent) => { if ((e.target as Element | null)?.closest?.('.xs-compose')) fold() }
    const onScroll = () => { if (window.scrollY > 40) fold() }
    const onWidth = () => { if (!phone.matches) setFolded(false) }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: true })
    el.addEventListener('wheel', onWheel, { passive: true })
    el.addEventListener('focusin', onType)
    window.addEventListener('scroll', onScroll, { passive: true })
    phone.addEventListener('change', onWidth)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('focusin', onType)
      window.removeEventListener('scroll', onScroll)
      phone.removeEventListener('change', onWidth)
    }
  }, [])
  // The site's bar is outside the page, so the room and its fold are said
  // on <html>.
  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-xs-room', '')
    return () => root.removeAttribute('data-xs-room')
  }, [])
  useEffect(() => {
    const root = document.documentElement
    if (folded) root.setAttribute('data-xs-folded', '')
    else root.removeAttribute('data-xs-folded')
    return () => root.removeAttribute('data-xs-folded')
  }, [folded])
  const unfold = () => { setFolded(false); window.scrollTo({ top: 0, behavior: 'instant' }) }
  // Opening a chat on a phone is asking for the screen: under a live
  // header the private chat's messages had no room left at all.
  const foldForChat = (k: 'feed' | RTab) => {
    if ((k === 'chat' || k === 'private') && loaded.current && window.matchMedia('(max-width: 760px)').matches) setFolded(true)
  }

  // The game, every 10 s while the tab is in front.
  useEffect(() => {
    let stop = false
    let first = true
    const load = async () => {
      if (document.hidden && !first) return
      first = false
      try {
        const res = await fetch(`/api/xsports/game/${pk}?league=${league}`)
        if (!res.ok) throw new Error(String(res.status))
        const g: GameState = await res.json()
        if (!stop) { setFeedDown(false); setGame(g) }
      } catch {
        if (!stop) setFeedDown(true)
      }
    }
    load()
    const t = setInterval(load, POLL_MS)
    const onVis = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', onVis)
    return () => { stop = true; clearInterval(t); document.removeEventListener('visibilitychange', onVis) }
  }, [pk, league])

  // The leagues' clips, on their own clock: a slow source never holds up
  // the score (Codex review, Oct 13).
  const h = useHighlights(league, pk, game?.status === 'live')
  // Clips that came out since the reader last looked: a quiet notice, never
  // a jump or a new video in place of the one playing.
  const seen = useRef<Set<string> | null>(null)
  const [fresh, setFresh] = useState(0)
  useEffect(() => {
    if (!h) return
    if (!seen.current) { seen.current = new Set(h.clips.map(x => x.id)); return }
    setFresh(h.clips.filter(x => !seen.current!.has(x.id)).length)
  }, [h])
  const markSeen = () => { if (h) seen.current = new Set(h.clips.map(x => x.id)); setFresh(0) }

  const g = game
  const openClip = (next: Clip) => {
    const box = bodyRef.current
    if (!clip && box) {
      const top = box.getBoundingClientRect().top
      const first = [...box.querySelectorAll<HTMLElement>('[data-at]')].find(el => el.getBoundingClientRect().bottom > top + 1)
      place.current = first ? { at: first.dataset.at!, dy: first.getBoundingClientRect().top - top, top: box.scrollTop } : { at: '', dy: 0, top: box.scrollTop }
      openedAt.current = g?.events.length ?? 0
    }
    setClip(next)
    setView('feed')
  }
  // Back to 戰況 at the same row, wherever new arrivals put it.
  const closeClip = () => {
    setClip(null)
    requestAnimationFrame(() => {
      const box = bodyRef.current, p = place.current
      if (!box || !p) return
      const el = p.at ? box.querySelector<HTMLElement>(`[data-at="${CSS.escape(p.at)}"]`) : null
      if (el) box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - p.dy
      else box.scrollTop = p.top
    })
  }
  // An inning or period in the line score opens its plays.
  const jump = (n: number) => {
    setClip(null)
    setFilter('all')
    setView('feed')
    requestAnimationFrame(() => document.getElementById(`xs-inn-${pk}-${n}`)?.scrollIntoView({ block: 'start' }))
  }
  const right = (k: RTab) => { setRtab(k); setView(k) }
  const icons: Record<RTab, React.ReactNode> = {
    chat: <svg viewBox="0 0 24 24" aria-hidden><path d="M4 5h16v11H9l-5 4z" /></svg>,
    private: <PrivateIcon />,
    box: <svg viewBox="0 0 24 24" aria-hidden><path d="M5 20V11M12 20V5M19 20v-7" /></svg>,
    odds: <svg viewBox="0 0 24 24" aria-hidden><path d="M4 18l5-6 4 3 7-9M4 21h16" /></svg>,
  }
  const rtabs: [RTab, string][] = [['chat', c.tabChat], ['private', c.tabPrivate], ['box', c.tabBox], ['odds', c.tabOdds]]

  return (
    <>
      <div ref={splitRef} className="xs-split" data-view={view}>
        <section className="xs-left">
          {g ? <Overview g={g} c={c} lang={lang} viewers={viewers} onJump={jump} />
            : <div className="xs-ov skel" aria-busy="true"><span className="xs-sr">{c.loading}</span></div>}
          {g ? <MiniScore g={g} c={c} lang={lang} onOpen={unfold} /> : null}
          {feedDown && <p className="xs-note">{c.feedDown}</p>}
          {/* Phones: one row of the five. */}
          <div className="xs-mtabs" role="tablist">
            {([['feed', c.tabFeed], ...rtabs] as ['feed' | RTab, string][]).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={view === k} onClick={() => { if (k === 'feed') setView('feed'); else right(k); foldForChat(k) }}>{label}</button>
            ))}
          </div>
          <div className="xs-feedwrap">
            {g && clip ? <ClipPlayer clip={clip} clips={h?.clips ?? []} g={g} c={c} lang={lang} newPlays={Math.max(0, g.events.length - openedAt.current)} onBack={closeClip} onOpen={openClip} /> : null}
            {g ? (
              <div className="xs-feedbox" hidden={!!clip}>
                <Feed g={g} c={c} lang={lang} pk={pk} h={h} filter={filter} setFilter={setFilter} fresh={fresh} onSeen={markSeen} onOpen={openClip} bodyRef={bodyRef} />
              </div>
            ) : <p className="xs-none">{c.loading}</p>}
          </div>
        </section>
        <section className="xs-right">
          <div className="xs-tabs" role="tablist">
            {rtabs.map(([k, label]) => <button key={k} role="tab" aria-selected={rtab === k} onClick={() => right(k)}>{icons[k]}{label}</button>)}
          </div>
          {/* The chat stays mounted on the other tabs: its Realtime channel,
              the watching count and the commentator's ticks keep going. */}
          <div className="xs-chat" hidden={rtab !== 'chat'}>
            <Thread league={league} pk={pk} lang={lang} c={c} g={g} signedIn={signedIn} onSignIn={() => auth.show()} onViewers={setViewers} />
          </div>
          {/* So does the private one, its words and its running total; it
              speaks only while its tab is in view. */}
          <div className="xs-chat xs-private" hidden={rtab !== 'private'}>
            <PrivateChat league={league} pk={pk} lang={lang} c={c} g={g} signedIn={signedIn} onSignIn={() => auth.show()} />
          </div>
          {(rtab === 'box' || rtab === 'odds') && !g ? <p className="xs-none">{c.loading}</p> : null}
          {rtab === 'box' && g && <div className="xs-rpane"><BoxTab g={g} c={c} /></div>}
          {rtab === 'odds' && g && <div className="xs-rpane"><OddsTab g={g} c={c} /></div>}
        </section>
      </div>
    </>
  )
}

// ── The page ────────────────────────────────────────────────────────────────

function XSportsInner() {
  const { lang } = useLang()
  const c = copyFor(lang)
  const router = useRouter()
  const params = useSearchParams()
  // Addresses name their league (owner, Oct 14: "why MLB's url doesn't have
  // league=?"): a game is ?league=mlb&game=849813, a league's scores
  // ?league=nba. The first addresses (?l=nba&g=…, MLB without l) still open.
  const l = params.get('league') ?? params.get('l')
  const league: League = l === 'nba' ? 'nba' : 'mlb'
  const pkParam = params.get('game') ?? params.get('g')
  const pk = pkParam && /^\d{5,12}$/.test(pkParam) ? Number(pkParam) : null
  const roomUrl = (lg: League, g: number) => `/xsports?league=${lg}&game=${g}`
  const only: League | 'all' = l === 'nba' || l === 'mlb' ? l : 'all'
  // An old address becomes the new one, in place.
  const legacy = params.has('l') || params.has('g')
  useEffect(() => {
    if (!legacy) return
    router.replace(pk ? roomUrl(league, pk) : only === 'all' ? '/xsports' : `/xsports?league=${only}`, { scroll: false })
  }, [legacy, pk, league, only]) // eslint-disable-line react-hooks/exhaustive-deps
  // Every move starts at the top of the page, at once (the site's CSS makes
  // scrolling smooth). Next's own scroll puts the page's first element at the
  // window's top, which on phones is under the fixed 60px bar (and half the
  // masthead under the league bar).
  const go = (url: string) => { router.push(url, { scroll: false }); window.scrollTo({ top: 0, behavior: 'instant' }) }
  const pick = (k: League) => go(`/xsports?league=${k}`)

  // The scores on design 02's grey canvas; a game on white (the approved
  // split room, Oct 13). The league bar over both.
  return pk ? (
    <div className="xs-canvas room">
      <SportsBar c={c} current={league} onPick={pick} onBack={() => go('/xsports')} />
      <div className="xs xs-room">
        <Room key={`${league}-${pk}`} league={league} pk={pk} c={c} lang={lang} />
      </div>
    </div>
  ) : (
    <div className="xs-canvas">
      <SportsBar c={c} current={only === 'all' ? null : only} onPick={pick} />
      <div className="xs xs-list">
        <Scores c={c} lang={lang} only={only} hrefOf={roomUrl} onOpen={(lg, g) => go(roomUrl(lg, g))} />
      </div>
    </div>
  )
}

export default function XSportsClient() {
  return (
    <Suspense fallback={null}>
      <XSportsInner />
    </Suspense>
  )
}
