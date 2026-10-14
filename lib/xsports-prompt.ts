// lib/xsports-prompt.ts — what the XSports commentator is told.
//
// Split on purpose: the SYSTEM text is the same for the whole game (so a
// provider's prompt cache can reuse it with the conversation after it), and
// the live game state rides only in the LAST user turn, rebuilt from the feed
// on every call. Earlier turns keep only a short cue (what was new then), so
// a three-hour game does not resend old box scores 270 times.

import { isPostseason, type GameState, type GameCard, type PlayEvent, type PlayerCard } from './mlb'

export type Trigger = 'open' | 'event' | 'lull' | 'user'
export const TRIGGERS: readonly Trigger[] = ['open', 'event', 'lull', 'user']

const PERSONA = `You are the viewer's own baseball buddy on ModelXD, watching this MLB game live with them, like a sharp, warm color commentator on the couch next to a friend.

You TALK ON YOUR OWN. When the live feed brings new plays, you react. When the game goes quiet, you bring something up: a number from the box score, a storyline, the next matchup, the pitcher's count, a player's background, or a question for the viewer ("Who do you want closing this?"). The viewer can also talk to you about anything: this game, other games, baseball history, or things that have nothing to do with sports. Answer them naturally and keep the conversation going.

Rules:
- Facts about THIS game come only from the LIVE FEED block. Never invent a score, play, pitch count or stat. A guess about what comes next is said as a guess ("he might not come back out"), never as fact: on Oct 12 you said the bullpen would take over in the 7th and the starter came back out. Your general knowledge of players and history may be out of date; for anything recent that is not in the feed, say you are not sure.
- Live-TV length: 1 to 3 sentences, about 50 words at most (about 100 characters in Chinese or Japanese). An answer to a real question from the viewer may be longer when it needs to be, but stays conversational.
- The viewer sees the play-by-play text, so never just repeat it. Add the why, the context, what it means, how it feels.
- Vary how you start. Plain conversational sentences: no headings, no bullet lists, no bold, at most one emoji and rarely. If you looked something up on the web, name the source in a few words; a link is fine.
- Talk to the viewer directly. Remember what they said and bring it back when the game proves them right or wrong.
- If the viewer roots for a team, share the joy and the pain, but stay fair to the other side.
- You can search the web. Search for what the live feed and the player cards do not cover: news, injuries, trades, schedules, other leagues and sports, anything recent. Never search for this game's score or plays; the feed is newer than any web page.
- You may talk about MLB's win probability and the swings in it (MLB's own model), and about the prediction markets' prices when the feed gives them (Kalshi, Polymarket; what the markets think, e.g. where they differ from MLB's model or from each other). Treat both as information: never encourage betting, never give betting tips or picks, never say where or how to bet.`

const LANG_LINE: Record<string, string> = {
  'zh-Hant': '說話語言：繁體中文（台灣的說法與棒球用語），全文不得夾雜簡體字。球員名：日本球員寫漢字（大谷翔平、山本由伸），台灣球員寫中文名；其他球員寫資料上的英文原名，只有台灣媒體人人皆知的球星才用中文譯名（例如 Aaron Judge 賈吉）。球隊可用台灣通用的中文隊名（道奇、釀酒人、光芒、守護者）。',
  'zh-Hans': '说话语言：简体中文。球员名：日本球员写汉字（大谷翔平、山本由伸）；其他球员写资料上的英文原名，只有家喻户晓的球星才用中文译名。球队可用常见的中文队名。',
  'ja': '話す言語：日本語。選手名：日本人選手は漢字（大谷翔平、山本由伸）。外国人選手はデータの綴りをそのまま音訳したカタカナ（DeLuca ならデルーカ）にし、似た別の選手名と取り違えないこと。自信がなければ英語のまま。',
  'ko': '말하는 언어: 한국어. 선수 이름은 한국 언론 표기(오타니 쇼헤이, 야마모토 요시노부), 확실하지 않으면 영어 그대로.',
  'en': 'Speak English.',
}
const SWITCH_LINE = 'If the viewer writes in another language, answer in theirs.'

export const asLang = (v: unknown): string => (typeof v === 'string' && LANG_LINE[v] ? v : 'en')

// The NBA buddy: the same rules, a basketball eye (owner, Oct 12: NBA next).
const NBA_PERSONA = PERSONA
  .replace("own baseball buddy on ModelXD, watching this MLB game live", "own basketball buddy on ModelXD, watching this NBA game live")
  .replace("a number from the box score, a storyline, the next matchup, the pitcher's count, a player's background, or a question for the viewer (\"Who do you want closing this?\")",
    "a player's line from the box score, a run, shooting from three, the bench, foul trouble, a storyline, a player's background, or a question for the viewer (\"Who takes the last shot?\")")
  .replace("he might not come back out\"), never as fact: on Oct 12 you said the bullpen would take over in the 7th and the starter came back out.", "he might sit the rest of the quarter\"), never as fact.")
  .replace("other games, baseball history,", "other games, basketball history,")
  .replace("You may talk about MLB's win probability and the swings in it (MLB's own model)", "You may talk about ESPN's win probability and the swings in it (ESPN's model), the sportsbook line the feed gives (spread and total, as information)")
  .replace("where they differ from MLB's model or from each other", "where they differ from ESPN's model, the line or each other")

const NBA_LANG: Record<string, string> = {
  'zh-Hant': '說話語言：繁體中文（台灣的說法與籃球用語），全文不得夾雜簡體字。球員名：日本、台灣球員寫中文名；其他球員寫資料上的英文原名，只有台灣媒體人人皆知的球星才用中文譯名（例如 LeBron James 詹姆斯、Stephen Curry 柯瑞）。球隊可用台灣通用的中文隊名（勇士、湖人、騎士、魔術）。',
  'zh-Hans': '说话语言：简体中文。球员名写资料上的英文原名，只有家喻户晓的球星才用中文译名（例如 LeBron James 詹姆斯）。球队可用常见的中文队名。',
  'ja': '話す言語：日本語。日本人選手は漢字（八村塁、河村勇輝）。外国人選手はデータの綴りをそのまま音訳したカタカナにし、自信がなければ英語のまま。',
  'ko': '말하는 언어: 한국어. 선수 이름은 한국 언론 표기, 확실하지 않으면 영어 그대로.',
  'en': 'Speak English.',
}

export function systemText(lang: string, league: string = 'mlb'): string {
  if (league === 'nba') return `${NBA_PERSONA}\n\n${NBA_LANG[asLang(lang)]} ${SWITCH_LINE}`
  return `${PERSONA}\n\n${LANG_LINE[asLang(lang)]} ${SWITCH_LINE}`
}

// ── The live state ──────────────────────────────────────────────────────────

const timeIn = (iso: string, tz: string) => {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(iso))
  } catch { return iso }
}

const halfWord = (h: 'top' | 'bottom' | null) => (h === 'bottom' ? 'Bottom' : 'Top')

function scoreLine(g: GameCard): string {
  return `${g.away.abbr} ${g.away.runs ?? 0}, ${g.home.abbr} ${g.home.runs ?? 0}`
}

/** One play as the commentator reads it. Who bats and who pitches is
 *  spelled out: a test on Oct 12 had the model credit TB's pitcher with the
 *  outs of TB's own half-inning when only the description was given. */
export function playLine(e: PlayEvent, g: Pick<GameCard, 'away' | 'home'> & { league?: string }): string {
  if (g.league === 'nba') {
    const q = e.inning > 4 ? `OT${e.inning > 5 ? e.inning - 4 : ''}` : `Q${e.inning}`
    return `${q} ${e.clock ?? ''}: ${e.text} → ${g.away.abbr} ${e.away}, ${g.home.abbr} ${e.home}${e.endsHalf ? ` [${q} over]` : ''}`
  }
  const bat = e.half === 'top' ? g.away.abbr : g.home.abbr
  const field = e.half === 'top' ? g.home.abbr : g.away.abbr
  const where = `${e.half === 'top' ? 'Top' : 'Bottom'} ${e.inning}, ${bat} batting${e.pitcher ? ` vs ${field} pitcher ${e.pitcher}` : ''}`
  const extra = [e.pitch, e.hit].filter(Boolean).join('; ')
  const outs = e.outs !== null && e.kind === 'pa' ? ` (${e.outs} out${e.outs === 1 ? '' : 's'} after it)` : ''
  const score = e.scoring ? ` → ${g.away.abbr} ${e.away}, ${g.home.abbr} ${e.home}` : ''
  const end = e.endsHalf ? ` [${e.half === 'top' ? 'top' : 'bottom'} ${e.inning} over]` : ''
  // A play that moved MLB's win probability a lot, from the team it helped.
  const swing = typeof e.swing === 'number' && Math.abs(e.swing) >= 8
    ? ` [win probability swing: ${e.swing > 0 ? g.home.abbr : g.away.abbr} +${Math.abs(e.swing)} pts]` : ''
  return `${where}: ${e.text}${extra ? ` [${extra}]` : ''}${outs}${score}${swing}${end}`
}

function linescore(g: GameState): string {
  if (!g.innings.length) return ''
  const cell = (v: number | null) => (v === null ? '-' : String(v))
  const row = (side: 'away' | 'home') =>
    `${g[side].abbr.padEnd(4)} ${g.innings.map(i => cell(i[side])).join(' ')}  | R ${g[side].runs ?? 0} H ${g[side].hits ?? 0} E ${g[side].errors ?? 0}`
  return `Line score (innings ${g.innings.map(i => i.n).join(' ')}):\n${row('away')}\n${row('home')}`
}

/** The day's other games in a few lines each: the score and who did what.
 *  Sent only when the viewer speaks (they may ask about any game). */
export function otherGamesBlock(games: GameState[]): string {
  if (!games.length) return ''
  return `Other games today, box scores:\n${games.map(o => {
    const head = `${o.away.name} ${o.away.runs ?? ''} @ ${o.home.name} ${o.home.runs ?? ''} (${o.status === 'live' && o.inning ? `${o.inningState ?? halfWord(o.half)} ${o.inning}` : o.detailed}${o.series ? `, ${o.series}${o.seriesNote ? `, ${o.seriesNote}` : ''}` : ''})`.replace(/\s+/g, ' ')
    const parts = [head]
    for (const side of ['away', 'home'] as const) {
      const h = o.box[side]
      if (h.length) parts.push(`  ${o[side].abbr} batters: ${h.join('; ')}`)
      if (o.pitchers[side].length) parts.push(`  ${o[side].abbr} pitchers: ${o.pitchers[side].join('; ')}`)
    }
    if (o.decisions) parts.push(`  ${o.decisions}`)
    if (o.status === 'preview' && (o.probable.away || o.probable.home)) parts.push(`  Probable: ${o.probable.away ?? 'TBD'} vs ${o.probable.home ?? 'TBD'}`)
    return parts.join('\n')
  }).join('\n')}`
}

function nbaStateBlock(g: GameState, opts: { tz: string; others?: GameCard[] }): string {
  const lines: string[] = []
  const q = (n: number) => (n > 4 ? `OT${n > 5 ? n - 4 : ''}` : `Q${n}`)
  const rec = (side: 'away' | 'home') => (g[side].record ? ` (${g[side].record})` : '')
  lines.push(`LIVE FEED (NBA via ESPN, fetched ${timeIn(g.fetchedAt, opts.tz)})`)
  lines.push(`${g.away.name}${rec('away')} at ${g.home.name}${rec('home')}${g.venue ? `, ${g.venue}` : ''}.${g.series ? ` ${g.series}.` : ''}`)
  if (g.status === 'preview' || g.status === 'other') lines.push(`Status: ${g.detailed}. Tip-off: ${timeIn(g.start, opts.tz)}.`)
  else lines.push(`Status: ${g.detailed}. Score: ${g.away.abbr} ${g.away.runs ?? 0}, ${g.home.abbr} ${g.home.runs ?? 0}.${g.status === 'live' && g.inning ? ` ${q(g.inning)}, ${g.clock ?? ''} left.` : ''}`)
  if (g.innings.length) lines.push(`Score by period (${g.innings.map(i => q(i.n)).join(' ')}): ${g.away.abbr} ${g.innings.map(i => i.away ?? '-').join(' ')}; ${g.home.abbr} ${g.innings.map(i => i.home ?? '-').join(' ')}`)
  if (g.winProb && g.status === 'live') lines.push(`Win probability (ESPN's model): ${g.home.abbr} ${g.winProb.home}%, ${g.away.abbr} ${g.winProb.away}%.`)
  if (g.line) lines.push(`Sportsbook line (${g.line.provider}, before the game): ${[g.line.spread, g.line.total !== null ? `total ${g.line.total}` : null].filter(Boolean).join(', ')}.`)
  if (g.market && g.market.away !== null && g.market.home !== null) lines.push(`Prediction market (Kalshi): ${g.away.abbr} ${g.market.away}%, ${g.home.abbr} ${g.market.home}%.`)
  if (g.poly && g.poly.away !== null && g.poly.home !== null) lines.push(`Prediction market (Polymarket): ${g.away.abbr} ${g.poly.away}%, ${g.home.abbr} ${g.poly.home}%.`)
  if (g.nbaBox?.cols.length) {
    for (const side of ['away', 'home'] as const) {
      const rows = g.nbaBox[side]
      if (rows.length) lines.push(`${g[side].abbr} players (${g.nbaBox.cols.join(' ')}; * = starter): ${rows.map(r => `${r.starter ? '*' : ''}${r.name} ${r.pos}: ${r.stats.join(' ')}`).join('; ')}`)
    }
  }
  const big = g.events.filter(e => e.big && !e.endsHalf).slice(-8)
  if (big.length) lines.push(`Lead changes and big moments:\n${big.map(e => `- ${playLine(e, g)}`).join('\n')}`)
  // The latest plays as they happened (a test on Oct 12: without them the
  // buddy could not say how a game that ended without a lead change was won).
  const recentPlays = g.events.slice(-10)
  if (recentPlays.length) lines.push(`Latest plays:\n${recentPlays.map(e => `- ${playLine(e, g)}`).join('\n')}`)
  const others = (opts.others ?? []).filter(c => c.pk !== g.pk)
  if (others.length) lines.push(`Other NBA games today: ${others.map(c => `${c.away.abbr} ${c.away.runs ?? ''} @ ${c.home.abbr} ${c.home.runs ?? ''} (${c.detailed})`.replace(/\s+/g, ' ')).join('; ')}`)
  lines.push(`Viewer's local time: ${timeIn(new Date().toISOString(), opts.tz)}.`)
  return lines.join('\n')
}

export function stateBlock(g: GameState, opts: { tz: string; others?: GameCard[]; otherBox?: GameState[] }): string {
  if (g.league === 'nba') return nbaStateBlock(g, opts)
  const post = isPostseason(g)
  const lines: string[] = []
  const rec = (side: 'away' | 'home') => (g[side].record ? ` (${post ? 'series' : 'season'} ${g[side].record})` : '')
  lines.push(`LIVE FEED (MLB, fetched ${timeIn(g.fetchedAt, opts.tz)})`)
  lines.push(`${g.away.name}${rec('away')} at ${g.home.name}${rec('home')}${g.venue ? `, ${g.venue}` : ''}.${g.series ? ` ${g.series}${g.seriesNote ? `, ${g.seriesNote}` : ''}.` : ''}`)
  if (g.status === 'preview' || g.status === 'other') {
    lines.push(`Status: ${g.detailed}. First pitch: ${timeIn(g.start, opts.tz)}.`)
    if (g.probable.away || g.probable.home) lines.push(`Probable pitchers: ${g.away.abbr} ${g.probable.away ?? 'TBD'}, ${g.home.abbr} ${g.probable.home ?? 'TBD'}.`)
  } else {
    lines.push(`Status: ${g.detailed}. Score: ${scoreLine(g)}.${g.status === 'live' && g.inning ? ` ${g.inningState ?? halfWord(g.half)} of inning ${g.inning}.` : ''}`)
  }
  if (g.weather) lines.push(`Weather: ${g.weather}.`)
  if (g.winProb && g.status === 'live') {
    const lev = g.winProb.leverage
    lines.push(`Win probability (MLB's model): ${g.home.abbr} ${g.winProb.home}%, ${g.away.abbr} ${g.winProb.away}%.${typeof lev === 'number' ? ` Leverage of this moment ${lev} (1 = average, 2+ = high pressure).` : ''}`)
  }
  if (g.market && g.market.away !== null && g.market.home !== null) {
    lines.push(`Prediction market (Kalshi, US-regulated; last price of a contract paying $1 if the team wins): ${g.away.abbr} ${g.market.away}%, ${g.home.abbr} ${g.market.home}%${g.market.volume ? `, about $${Math.round(g.market.volume / 1000)}K traded` : ''}.`)
  }
  if (g.poly && g.poly.away !== null && g.poly.home !== null) {
    lines.push(`Prediction market (Polymarket): ${g.away.abbr} ${g.poly.away}%, ${g.home.abbr} ${g.poly.home}%${g.poly.volume ? `, about $${Math.round(g.poly.volume / 1000)}K traded` : ''}.`)
  }
  const swings = g.events.filter(e => typeof e.swing === 'number' && Math.abs(e.swing!) >= 8).sort((x, y) => Math.abs(y.swing!) - Math.abs(x.swing!)).slice(0, 3)
  if (swings.length) lines.push(`Biggest win-probability swings so far:\n${swings.map(e => `- ${playLine(e, g)}`).join('\n')}`)
  if (g.now) {
    const n = g.now
    const bases = [n.bases.first && `1st ${n.bases.first}`, n.bases.second && `2nd ${n.bases.second}`, n.bases.third && `3rd ${n.bases.third}`].filter(Boolean)
    // Between halves MLB already lists the next half's batter and pitcher.
    const between = g.inningState === 'Middle' || g.inningState === 'End'
    const batSide = n.batting ?? ((g.half === 'top') !== between ? 'away' : 'home')
    const batTeam = g[batSide].abbr
    const fieldTeam = batTeam === g.away.abbr ? g.home.abbr : g.away.abbr
    if (!between) lines.push(`Now: ${n.outs} out, count ${n.balls}-${n.strikes}, bases ${bases.length ? bases.join(', ') : 'empty'}.`)
    if (n.batter) lines.push(`${between ? 'Due up' : 'At bat'} (${batTeam}): ${n.batter}${n.batterToday ? ` (today ${n.batterToday})` : ''}${n.batterLine ? `; ${post ? 'this postseason' : 'season'} ${n.batterLine}` : ''}.${n.onDeck ? ` On deck: ${n.onDeck}.` : ''}`)
    if (n.pitcher) lines.push(`Pitching (${fieldTeam}): ${n.pitcher}${n.pitcherToday ? ` (today ${n.pitcherToday}${n.pitcherPitches ? `, ${n.pitcherPitches} pitches` : ''})` : ''}.`)
  }
  const ls = linescore(g)
  if (ls) lines.push(ls)
  // The box score, as the Box score tab shows it (owner, Oct 12: "each
  // player's data is this game's current states").
  for (const side of ['away', 'home'] as const) {
    const tb = g.teamBox?.[side]
    if (!tb) continue
    const abbr = g[side].abbr
    if (tb.batters.length) lines.push(`${abbr} batting today (AB-R-H-RBI-BB-K; ${post ? 'postseason' : 'season'} AVG/OPS): ${tb.batters.map(b => `${b.sub ? '(sub) ' : ''}${b.name} ${b.pos} ${b.ab}-${b.r}-${b.h}-${b.rbi}-${b.bb}-${b.k} ${b.avg}/${b.ops}`).join('; ')}`)
    if (tb.pitchers.length) lines.push(`${abbr} pitching today: ${tb.pitchers.map(x => `${x.name} ${x.ip} IP ${x.h} H ${x.r} R ${x.er} ER ${x.bb} BB ${x.k} K ${x.hr} HR, ${x.pitches} pitches (${x.strikes} strikes), ${post ? 'postseason' : 'season'} ERA ${x.era}`).join('; ')}`)
    if (tb.notes.length) lines.push(`${abbr} notes: ${tb.notes.join(' ')}`)
    if (tb.bullpen.length) lines.push(`${abbr} bullpen not used yet (ERA): ${tb.bullpen.join('; ')}`)
  }
  if (g.gameNotes?.length) lines.push(`Game notes: ${g.gameNotes.join(' ')}`)
  const scoring = g.events.filter(e => e.scoring)
  if (scoring.length) lines.push(`Scoring plays:\n${scoring.slice(-12).map(e => `- ${playLine(e, g)}`).join('\n')}`)
  if (g.decisions) lines.push(`Decisions: ${g.decisions}.`)
  const others = (opts.others ?? []).filter(c => c.pk !== g.pk)
  const box = otherGamesBlock((opts.otherBox ?? []).filter(o => o.pk !== g.pk))
  if (box) lines.push(box)
  else if (others.length) {
    lines.push(`Other MLB games today: ${others.map(c => `${c.away.abbr} ${c.away.runs ?? ''} @ ${c.home.abbr} ${c.home.runs ?? ''} (${c.status === 'live' && c.inning ? `${halfWord(c.half)} ${c.inning}` : c.detailed}${c.series ? `, ${c.series}${c.seriesNote ? `, ${c.seriesNote}` : ''}` : ''})`.replace(/\s+/g, ' ')).join('; ')}`)
  }
  lines.push(`Viewer's local time: ${timeIn(new Date().toISOString(), opts.tz)}.`)
  return lines.join('\n')
}

// ── Players ─────────────────────────────────────────────────────────────────

/** How much of each player card to send. 'full' adds careers (the viewer
 *  asked something); 'season' is the regular season and this postseason; a
 *  set of names limits the cards to the players in the new plays. */
export type CardDepth = 'full' | 'season'

export function playersBlock(g: GameState, cards: PlayerCard[], depth: CardDepth, only?: Set<string>): string {
  if (!cards.length) return ''
  const byId = new Map(cards.map(c => [c.id, c]))
  const post = isPostseason(g)
  const line = (c: PlayerCard) => {
    const who = [c.pos, c.country && c.country !== 'USA' ? c.country : null, c.age ? `age ${c.age}` : null,
      c.bats || c.throws ? `bats ${c.bats ?? '?'}/throws ${c.throws ?? '?'}` : null].filter(Boolean).join(', ')
    const parts = [
      c.hitting && `${g.season} hitting ${c.hitting}`,
      c.pitching && `${g.season} pitching ${c.pitching}`,
      post && g.postLines[String(c.id)] && `this postseason ${g.postLines[String(c.id)]}`,
      depth === 'full' && c.careerHitting && `career hitting ${c.careerHitting}`,
      depth === 'full' && c.careerPitching && `career pitching ${c.careerPitching}`,
    ].filter(Boolean)
    return `- ${c.name} (${who})${parts.length ? `: ${parts.join('; ')}` : ''}`
  }
  const sections: string[] = []
  for (const side of ['away', 'home'] as const) {
    const rows = g.roster[side].map(id => byId.get(id)).filter((c): c is PlayerCard => !!c && (!only || only.has(c.name)))
    if (rows.length) sections.push(`${g[side].abbr}:\n${rows.map(line).join('\n')}`)
  }
  if (!sections.length) return ''
  return `Player cards (${g.season} regular season${post ? ', this postseason' : ''}${depth === 'full' ? ', career' : ''}; MLB stats):\n${sections.join('\n')}`
}

/** The players a remark about these plays may need: the ones in them, and
 *  whoever is up and pitching now. */
export function involved(g: GameState, fresh: PlayEvent[]): Set<string> {
  const names = new Set<string>()
  for (const e of fresh) { if (e.batter) names.add(e.batter); if (e.pitcher) names.add(e.pitcher) }
  if (g.now?.batter) names.add(g.now.batter)
  if (g.now?.pitcher) names.add(g.now.pitcher)
  if (g.now?.onDeck) names.add(g.now.onDeck)
  return names
}

// ── The cue: why the commentator is speaking now ────────────────────────────

const MAX_NEW = 10

/** The events after `since` (an id the commentator was last told about). An
 *  unknown `since` means everything is new; capped to the latest few. */
export function newSince(g: GameState, since: string | null): PlayEvent[] {
  if (!since) return []
  const i = g.events.findIndex(e => e.id === since)
  const fresh = i < 0 ? g.events : g.events.slice(i + 1)
  return fresh.slice(-MAX_NEW)
}

export const lastEventId = (g: GameState): string | null => g.events[g.events.length - 1]?.id ?? null

/** The short cue kept in the conversation (the client stores it as the user
 *  turn before the remark). The full state is NOT in here. */
export function cueText(trigger: Trigger, g: GameState, fresh: PlayEvent[], message: string): string {
  const plays = fresh.length ? `New on the field:\n${fresh.map(e => playLine(e, g)).join('\n')}` : ''
  const justEnded = g.status === 'final' && fresh.length > 0
  switch (trigger) {
    case 'open':
      return g.status === 'final'
        ? '[The viewer just opened this game, which is over. Greet them in one line and give the short story of the game.]'
        : g.status === 'live'
          ? '[The viewer just joined. Greet them in one line, say where the game stands and one thing to watch.]'
          : '[The viewer just joined before first pitch. Greet them in one line and set up the matchup.]'
    case 'event':
      if (justEnded) return `${plays}\n[The game is over. Give the wrap-up: who won, the turning point, the star.]`
      return `${plays}\n[React like a broadcaster.${fresh.some(e => e.big) ? ' This is a big moment, let it land.' : ' Keep it to a line or two.'}]`
    case 'lull':
      if (g.league === 'nba' && g.status === 'live') return '[A quiet stretch (a timeout, free throws, a break). Bring up ONE new thing worth talking about (not something you already said): a player\'s line, a run, the three-point shooting, foul trouble, the bench, or a question for the viewer.]'
      return g.status === 'live'
        ? '[A quiet stretch. Bring up ONE new thing worth talking about (not something you already said): a number from the box score, a storyline, the next matchup, the pitcher\'s count, or a question for the viewer.]'
        : g.status === 'final'
          ? '[The game is over and the viewer is still here. Bring up one more angle on it, or ask what they thought.]'
          : '[Before first pitch. Bring up ONE new thing about the matchup, the series or the players, or ask the viewer something.]'
    case 'user':
      return `${plays ? `${plays}\n` : ''}Viewer: ${message}`
  }
}

/** The last user turn as the model reads it: the live state, the viewer's
 *  older words that fell out of the window, then the cue. */
export function lastTurn(state: string, cue: string, viewerNotes: string[], players = ''): string {
  const notes = viewerNotes.length ? `\n\nThings the viewer said earlier (keep them in mind):\n${viewerNotes.map(n => `- ${n}`).join('\n')}` : ''
  return `${state}${players ? `\n\n${players}` : ''}${notes}\n\n${cue}`
}
