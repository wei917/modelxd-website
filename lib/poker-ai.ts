// lib/poker-ai.ts — how a model takes its turn at the hold'em table (Oct 19).
//
// SERVER-ONLY. Every seat gets the SAME harness, and the harness is part of
// the result, so it is fixed here and published with the game:
//   • one user message carrying the whole situation (model calls are
//     stateless; re-describing beats trusting a model's memory of hand 7);
//   • the same rules text, in English, for every model; only the language
//     asked for "why" and "say" follows the table's language;
//   • reasoning BEFORE the action in the reply JSON (docs/research-gomoku-
//     llm.md: action-first makes a model commit, then rationalise);
//   • the seat's thinking level as chosen at setup, nothing else tuned;
//   • an unusable reply gets ONE retry carrying the engine's reason; a
//     second failure or a timeout is a marked check-or-fold;
//   • a timeout is never retried (re-asking a slow model doubles the wait).
//
// SECURITY BOUNDARY (Werewolf's rule, CLAUDE.md "askModel"): the raw reply
// is never shown to anyone. Only fields pulled out cleanly leave this file:
// `say` is public, `why` is private until the hand is over, and a reply that
// looks structured but yields no clean `say` loses its table talk rather
// than leaking the reasoning baked into the raw text.

import * as providers from '@/lib/providers'
import type { ModelInfo } from '@/lib/providers'
import {
  POKER, HAND_NAMES, handSummary, seatFacts, type PokerGame, type Decision, type Act,
} from '@/lib/poker-engine'

const LOG = '[xgame:poker]'

/** Per reply (Werewolf's ceiling: Qwen 3.8 Flash thinking took 55 s+ on a
 *  preflop decision on Oct 19). The retry gets what is left of TURN_BUDGET_MS,
 *  so one turn always ends inside the route's maxDuration. */
export const MODEL_TIMEOUT_MS = 90_000
export const TURN_BUDGET_MS = 170_000
export const SAY_MAX = 80
const WHY_MAX = 400
/** Earlier hands a prompt carries, newest last. */
const HISTORY_HANDS = 6

export type SeatInfo = { seat: number; name: string; isHuman: boolean }

const LANG_NAMES: Record<string, string> = {
  en: 'English',
  'zh-Hant': 'Traditional Chinese as used in Taiwan (繁體中文)',
  'zh-Hans': 'Simplified Chinese (简体中文)',
  ja: 'Japanese (日本語)',
  ko: 'Korean (한국어)',
}

const suitName: Record<string, string> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' }
const cardText = (c: string) => `${c} (${c[0] === 'T' ? '10' : c[0]} of ${suitName[c[1]]})`

/** The prompt for one decision. Built only from seatFacts(): the only hole
 *  cards it can contain are the asking seat's own. */
export function buildPrompt(g: PokerGame, seat: number, seats: SeatInfo[], lang: string, objection: string | null): string | null {
  const f = seatFacts(g, seat)
  if (!f) return null
  const name = (s: number) => seats[s]?.name ?? `Seat ${s + 1}`
  const label = (s: number) => `Seat ${s + 1} (${name(s)})`
  const L = f.legal

  const table = f.seats.map(x => {
    if (!x.inGame) return `- ${label(x.seat)}: out of chips`
    const tags = [f.positions[x.seat], x.seat === seat ? 'YOU' : seats[x.seat]?.isHuman ? 'human player' : null].filter(Boolean).join(', ')
    const state = x.folded ? 'folded' : x.allIn ? 'ALL-IN' : 'in the hand'
    return `- ${label(x.seat)} [${tags}]: ${x.stack} chips behind, ${x.bet} bet this street, ${x.committed} put in this hand, ${state}`
  }).join('\n')

  const story: string[] = []
  for (const l of f.hand.log) {
    if (l.t === 'post') story.push(`${label(l.seat)} posts the ${l.blind === 'sb' ? 'small' : 'big'} blind ${l.amount}`)
    else if (l.t === 'board') story.push(`-- ${l.street.toUpperCase()}: ${l.board.join(' ')} --`)
    else if (l.t === 'act') {
      const what = l.act === 'fold' || l.act === 'check' ? l.act
        : l.act === 'call' ? `calls ${l.put}`
        : l.act === 'allin' ? `goes ALL-IN (total ${l.to} this street)`
        : `${l.act}s to ${l.to}`
      story.push(`${label(l.seat)} ${what}${l.say ? ` and says: "${l.say}"` : ''}${l.auto ? ' (no usable reply: the table acted for them)' : ''}`)
    }
  }

  const options: string[] = ['- "fold"']
  if (L.canCheck) options.push('- "check" (nothing to call)')
  else options.push(`- "call": put in ${L.toCall} more${L.toCall >= f.seats[seat].stack ? ' (that is all your chips)' : ''}`)
  if (L.raise) {
    options.push(L.raise.min === L.raise.max
      ? `- "${L.raise.kind}" with "amount": ${L.raise.max} (all your chips)`
      : `- "${L.raise.kind}" with "amount" from ${L.raise.min} to ${L.raise.max}. "amount" is the TOTAL you will have bet this street, not the extra: you have ${f.seats[seat].bet} in front of you now, so ${L.raise.kind} ${L.raise.min} puts in ${L.raise.min - f.seats[seat].bet} more`)
    options.push(`- "allin": put in all ${f.seats[seat].stack} chips you have behind`)
  }

  const earlier = g.hands.slice(0, -1).slice(-HISTORY_HANDS).map(h => handSummary(h, label))
  const langName = LANG_NAMES[lang] ?? LANG_NAMES.en

  return [
    `You are ${label(seat)} at a no-limit Texas Hold'em table with ${f.seats.filter(x => x.inGame).length} players still in the game. Chips are points in a game, not money. Play to finish with as many chips as you can.`,
    `Rules: blinds ${POKER.smallBlind}/${POKER.bigBlind}, no ante, everyone started with ${POKER.startStack} chips. The game is ${g.maxHands} hands, or until one player has every chip. Best five-card hand from your two cards and the five on the board wins; ties split the pot.`,
    '',
    `Hand ${f.hand.n} of ${g.maxHands}. Street: ${f.street}.`,
    `Your cards: ${f.mine.map(cardText).join(', ')}`,
    `Board: ${f.board.length ? f.board.map(cardText).join(', ') : '(none yet)'}`,
    `Pot: ${f.pot} (including bets on this street)`,
    '',
    'Players (seat order; the button moves one seat each hand):',
    table,
    '',
    'This hand so far:',
    story.join('\n') || '(nothing yet)',
    '',
    'Earlier hands (only cards shown at showdown are known):',
    earlier.length ? earlier.join('\n') : '(this is the first hand)',
    '',
    'You may:',
    options.join('\n'),
    ...(objection ? ['', `Your previous reply was not accepted: ${objection}`] : []),
    '',
    'Reply with ONLY one JSON object, fields in this order:',
    '{"why": "...", "action": "fold|check|call|bet|raise|allin", "amount": 0, "say": "..."}',
    // Not "your private reasoning": Anthropic declines that wording on Claude
    // Opus 5 / 5.5 and Fable 5 as reasoning extraction (Oct 21, every poker
    // turn), so those seats only ever got the automatic move.
    `- "why": one to three sentences on why you chose this move, written in ${langName}. The other players do not see it during the hand.`,
    '- "action": one of the moves listed above.',
    '- "amount": a whole number, only for bet or raise (the total for this street); otherwise 0.',
    `- "say": optional table talk the other players and the audience will see, at most ${SAY_MAX} characters, in ${langName}. It may bluff. Use "" to stay quiet.`,
  ].join('\n')
}

// ── Reading a reply ──────────────────────────────────────────────────────

const ACTS: Record<string, Act> = {
  fold: 'fold', folds: 'fold',
  check: 'check', checks: 'check',
  call: 'call', calls: 'call',
  bet: 'bet', bets: 'bet',
  raise: 'raise', raises: 'raise', reraise: 'raise', 're-raise': 'raise',
  allin: 'allin', 'all-in': 'allin', 'all in': 'allin', 'all_in': 'allin', shove: 'allin', jam: 'allin',
}

export type Parsed = {
  decision: Decision | null
  /** Public table talk, only when it came out of a clean field. */
  say?: string
  /** Private reasoning. */
  why?: string
  /** Why the reply could not be used, phrased for the retry. */
  problem?: string
}

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t
}

/** Pulls the four fields out of a reply. Never returns raw reply text. */
export function parseReply(full: string): Parsed {
  if (!full.trim()) return { decision: null, problem: 'the reply was empty. Reply with ONLY the JSON object.' }
  let o: any = null
  const m = /\{[\s\S]*\}/.exec(full)
  if (m) { try { o = JSON.parse(m[0]) } catch { o = null } }
  // Broken JSON (raw newlines inside strings are the usual cause): salvage
  // the fields one by one, so the reasoning still lands in its own slot.
  const grab = (f: string): string | undefined => {
    if (o && typeof o[f] === 'string') return o[f]
    if (o && typeof o[f] === 'number') return String(o[f])
    const r = new RegExp(`["']${f}["']\\s*:\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|'([^']*)'|(-?\\d+(?:\\.\\d+)?))`).exec(full)
    if (!r) return undefined
    const v = r[1] ?? r[2] ?? r[3]
    return v == null ? undefined : v.replace(/\\"/g, '"').replace(/\\n/g, ' ')
  }
  const rawAct = grab('action')
  const why = grab('why')
  const say = grab('say')
  const amountRaw = o && o.amount != null ? o.amount : grab('amount')
  const out: Parsed = { decision: null }
  if (why) out.why = clip(why, WHY_MAX)
  if (say) out.say = clip(say, SAY_MAX)
  const act = rawAct ? ACTS[rawAct.toLowerCase().trim()] : undefined
  if (!act) {
    out.problem = rawAct
      ? `"${clip(rawAct, 30)}" is not an action. Use fold, check, call, bet, raise or allin.`
      : 'no "action" could be read from your reply. Reply with ONLY the JSON object.'
    return out
  }
  const amount = typeof amountRaw === 'number' ? amountRaw
    : typeof amountRaw === 'string' && amountRaw.trim() !== '' ? Number(amountRaw.replace(/[, ]/g, ''))
    : null
  out.decision = { act, amount: amount != null && Number.isFinite(amount) ? amount : null }
  return out
}

// ── Asking ───────────────────────────────────────────────────────────────

export type Asked = { text: string; cost: number; ms: number; timedOut: boolean; error?: string; inTokens: number; outTokens: number }

/** One call with a hard ceiling. Never throws. */
export async function askOnce(model: ModelInfo, prompt: string, thinking: string | null, userId: string, timeoutMs = MODEL_TIMEOUT_MS): Promise<Asked> {
  const t0 = Date.now()
  let text = '', cost = 0, timedOut = false, error: string | undefined, inTokens = 0, outTokens = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  await Promise.race([
    new Promise<void>(resolve => {
      providers.streamText(model, [{ role: 'user', content: prompt }], {
        onDelta: t => { text += t },
        onDone: r => { cost += r.cost ?? 0; inTokens += r.inputTokens ?? 0; outTokens += r.outputTokens ?? 0; resolve() },
        onError: msg => { error = String(msg); console.warn(`${LOG} ${model.display_name}:`, String(msg).slice(0, 300)); resolve() },
      }, [], { userId: userId || null, surface: 'xgame-poker' } as any, { thinking, search: false }).catch(e => { error = String(e?.message ?? e); resolve() })
    }),
    new Promise<void>(resolve => {
      timer = setTimeout(() => { timedOut = true; console.warn(`${LOG} ${model.display_name}: timed out`); resolve() }, timeoutMs)
    }),
  ])
  if (timer) clearTimeout(timer)
  return { text, cost, ms: Date.now() - t0, timedOut, error, inTokens, outTokens }
}

export { HAND_NAMES }
