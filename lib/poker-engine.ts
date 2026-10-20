// lib/poker-engine.ts — no-limit Texas hold'em for the XGame arena (Oct 19).
//
// SERVER-ONLY (poker-ts uses node's assert). Pure rules: no database, no
// models, no network. The table model is poker-ts (MIT, pinned at 1.5.0):
// betting rounds, side pots, split pots, the heads-up blind rule and the
// showdown ranking all come from it; this file adds what a server-held game
// needs around it.
//
// HOW A HAND SURVIVES BETWEEN REQUESTS. A serverless request cannot keep a
// poker-ts Table alive, and the Table has no serialiser. So a hand is stored
// as the facts that DETERMINE it: the seats' chips at the start, the button,
// the deck in draw order and the list of actions taken. Every request builds
// a fresh Table, puts that exact deck in, and replays the actions: the same
// inputs always give the same table, and nothing else has to be trusted.
// The deck goes in through poker-ts internals (`_table._deck.shuffle`),
// which is why the version is pinned exactly; scripts/poker-check.ts fails
// loudly if an upgrade moves them.
//
// HIDDEN INFORMATION. The deck (and so every hole card) lives only in the
// sealed state (lib/poker-seal.ts). `tableView()` is the ONE place cards
// leave it, filtered for whoever is looking; the model prompt is built from
// `seatFacts()`, which only ever carries the asking seat's own cards.
//
// Rules as poker-ts plays them (same for every seat, published with the
// game): no ante; blinds 5/10 and a 1,000 stack (100 big blinds); a bet or
// raise names the TOTAL the seat will have in front of it this street; the
// button moves one live seat per hand and, heads-up, posts the small blind
// and acts first before the flop. Two poker-ts simplifications: an all-in
// for less than a full raise still re-opens the betting, and it lowers the
// next minimum raise to its own size.

import { randomInt } from 'node:crypto'
import Poker from 'poker-ts/dist/facade/poker'
import Card from 'poker-ts/dist/lib/card'
import Hand from 'poker-ts/dist/lib/hand'

// ── Settings (published with the table; identical for every model) ──────

export const POKER = {
  smallBlind: 5,
  bigBlind:   10,
  startStack: 1000,
  minSeats:   2,
  maxSeats:   9,
  /** Choices offered at setup; the game also ends when one seat has every chip. */
  handChoices: [5, 10, 20, 50] as const,
  defaultHands: 10,
} as const

// ── Cards ────────────────────────────────────────────────────────────────

/** A card as two characters: rank (23456789TJQKA) then suit (c d h s). */
export type CardCode = string
const RANKS = '23456789TJQKA'
const SUITS = 'cdhs'   // poker-ts: CLUBS=0 DIAMONDS=1 HEARTS=2 SPADES=3

export const fullDeck = (): CardCode[] => {
  const out: CardCode[] = []
  for (const s of SUITS) for (const r of RANKS) out.push(r + s)
  return out
}

/** A fresh deck in draw order, shuffled with the OS's CSPRNG. */
export function shuffledDeck(): CardCode[] {
  const d = fullDeck()
  for (let i = d.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[d[i], d[j]] = [d[j], d[i]]
  }
  return d
}

const toLib = (c: CardCode) => new Card(RANKS.indexOf(c[0]), SUITS.indexOf(c[1]))
const fromFacade = (c: { rank: string; suit: string }): CardCode => c.rank + c.suit[0]

/** Hand ranking names, poker-ts's HandRanking order (0 = high card). */
export const HAND_NAMES = [
  'High card', 'One pair', 'Two pair', 'Three of a kind', 'Straight',
  'Flush', 'Full house', 'Four of a kind', 'Straight flush', 'Royal flush',
] as const

// ── State ────────────────────────────────────────────────────────────────

export type Street = 'preflop' | 'flop' | 'turn' | 'river'
export type Act = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin'

/** What poker-ts is told, replayed in order on every request. */
type Move = { seat: number; act: 'fold' | 'check' | 'call' | 'bet' | 'raise'; size?: number }

/** One line of the hand's story. `why` is private until the hand is over
 *  (tableView strips it); `say` is public table talk. */
export type LogLine =
  | { t: 'post'; seat: number; blind: 'sb' | 'bb'; amount: number }
  | { t: 'board'; street: Street; board: CardCode[] }
  | { t: 'act'; seat: number; act: Act; put: number; to: number; street: Street
      say?: string; why?: string
      /** The seat's reply could not be used twice; the engine checked or folded for it. */
      auto?: boolean
      /** The first reply was refused and the second one was used. */
      retried?: boolean
      ms?: number; cost?: number }

export type HandResult = {
  /** Two or more seats reached the end: their cards were shown. */
  showdown: boolean
  shown: Record<number, CardCode[]>
  /** HAND_NAMES index per shown seat. */
  rank: Record<number, number>
  pots: { size: number; winners: number[] }[]
  /** Chips each seat took from the pot(s). */
  won: Record<number, number>
  /** Chips after the hand minus chips before it. */
  net: Record<number, number>
}

export type PokerHand = {
  n: number
  button: number
  sbSeat: number
  bbSeat: number
  /** Chips per seat when the hand began (0 = out of the game). */
  start: number[]
  /** SECRET: all 52 cards in the order they are drawn. */
  deck: CardCode[]
  moves: Move[]
  log: LogLine[]
  result: HandResult | null
}

export type PokerGame = {
  v: 1
  seats: number
  maxHands: number
  /** Chips per seat after the last finished hand. */
  chips: number[]
  hands: PokerHand[]
  over: boolean
  /** Per seat: decisions asked, replies refused once, replies that fell back. */
  stats: { asked: number; retried: number; auto: number; costUsd: number; ms: number }[]
}

// ── Building a table from the stored facts ───────────────────────────────

type Built = {
  table: Poker
  /** Seats that folded this hand. */
  folded: Set<number>
  done: boolean
  result: HandResult | null
}

/** Seats still holding chips, in seat order. */
const liveSeats = (chips: number[]) => chips.map((c, i) => (c > 0 ? i : -1)).filter(i => i >= 0)

/** Next live seat after `from`, wrapping. */
function nextLive(chips: number[], from: number): number {
  const n = chips.length
  for (let k = 1; k <= n; k++) {
    const s = (from + k) % n
    if (chips[s] > 0) return s
  }
  return from
}

/** Blind seats exactly as poker-ts posts them (heads-up: the button is the small blind). */
function blindSeats(start: number[], button: number) {
  const live = liveSeats(start)
  const sb = live.length === 2 ? button : nextLive(start, button)
  return { sb, bb: nextLive(start, sb) }
}

function newTable(h: PokerHand, seats: number): Poker {
  const t = new Poker({ smallBlind: POKER.smallBlind, bigBlind: POKER.bigBlind }, seats)
  h.start.forEach((c, s) => { if (c > 0) t.sitDown(s, c) })
  // The stored deck goes in where poker-ts would shuffle. Deck draws from
  // the END of the array, so the first card drawn is the last element.
  const deck = (t as any)._table?._deck
  if (!deck || typeof deck.shuffle !== 'function') throw new Error('poker-ts internals moved: no _table._deck.shuffle')
  deck.shuffle = () => { for (let i = 0; i < 52; i++) deck[51 - i] = toLib(h.deck[i]) }
  t.startHand(h.button)
  return t
}

/** Ends finished betting rounds and, at the end, the hand. */
function settle(t: Poker, b: Built, h: PokerHand): void {
  while (t.isHandInProgress()) {
    if (t.isBettingRoundInProgress()) {
      // A blind that took a seat's last chip leaves it in the round with
      // nothing behind; poker-ts still asks it to act. There is no choice to
      // make, so the table makes it (the same on every replay).
      const seat = t.playerToAct()
      if ((t.seats()[seat]?.stack ?? 0) > 0) return
      t.actionTaken(t.legalActions().actions.includes('check') ? 'check' : 'call')
      continue
    }
    if (t.areBettingRoundsCompleted()) { b.result = finish(t, b, h); b.done = true; return }
    t.endBettingRound()
  }
}

/**
 * The end of a hand: pots, the showdown and the payout, worked out HERE from
 * what each seat put in, not by poker-ts. Its pot manager (1.5.0) rebuilds
 * the last pot's eligible players from whoever bet on the latest street, so
 * a seat that went all-in for exactly the call on the flop dropped out of a
 * pot it had paid into once two others kept betting on the turn, and its
 * aces lost to kings (found by scripts/poker-check.ts, along with 2,048
 * chips that vanished in a random game). Its betting order and legal
 * actions are sound and stay; the money is counted here.
 *
 * Side pots the usual way: one pot per distinct amount the seats still in
 * put in, each pot open to the seats that put in at least that much, every
 * seat (folded ones included) paying into each pot up to that level. The
 * board is the deck's next five cards when two or more seats are left,
 * whatever poker-ts dealt (it skips the run-out on the same wrong pot).
 */
function finish(t: Poker, b: Built, h: PokerHand): HandResult {
  const seated = t.seats()
  const live = h.start.map((c, s) => (c > 0 ? s : -1)).filter(s => s >= 0)
  const left = h.start.map((c, s) => (c > 0 ? (seated[s]?.stack ?? 0) : 0))
  const put = h.start.map((c, s) => (c > 0 ? c - left[s] : 0))
  const inHand = live.filter(s => !b.folded.has(s))
  const showdown = inHand.length >= 2
  const holes = holesFromDeck(h)
  const board = showdown ? h.deck.slice(live.length * 2, live.length * 2 + 5) : []

  const levels = [...new Set(inHand.map(s => put[s]))].filter(x => x > 0).sort((a, b) => a - b)
  const pots: { size: number; eligible: number[] }[] = []
  let prev = 0
  for (const level of levels) {
    let size = 0
    for (const s of live) size += Math.max(0, Math.min(put[s], level) - prev)
    pots.push({ size, eligible: inHand.filter(s => put[s] >= level) })
    prev = level
  }
  // Anything a folded seat put in above the top level still belongs in the pot.
  const rest = put.reduce((a, x) => a + x, 0) - pots.reduce((a, p) => a + p.size, 0)
  if (rest > 0) {
    if (pots.length) pots[pots.length - 1].size += rest
    else pots.push({ size: rest, eligible: inHand })
  }

  const shown: Record<number, CardCode[]> = {}
  const rank: Record<number, number> = {}
  const best: Record<number, Hand> = {}
  if (showdown) {
    for (const s of inHand) {
      shown[s] = holes[s]!
      best[s] = Hand.of([...shown[s], ...board].map(toLib))
      rank[s] = best[s].ranking()
    }
  }
  // Odd chips go to the winners in seat order from the button's left.
  const fromButton = (s: number) => (s - h.button - 1 + h.start.length * 2) % h.start.length
  const won: Record<number, number> = {}
  const paid = pots.map(p => {
    let winners = p.eligible
    if (p.eligible.length > 1) {
      const top = p.eligible.reduce((a, s) => (Hand.compare(best[s], best[a]) < 0 ? s : a))
      winners = p.eligible.filter(s => Hand.compare(best[s], best[top]) === 0)
    }
    winners = [...winners].sort((a, c) => fromButton(a) - fromButton(c))
    const share = Math.floor(p.size / winners.length)
    let odd = p.size - share * winners.length
    for (const s of winners) {
      won[s] = (won[s] ?? 0) + share + (odd > 0 ? 1 : 0)
      if (odd > 0) odd--
    }
    return { size: p.size, winners }
  })
  const net: Record<number, number> = {}
  for (const s of live) net[s] = left[s] + (won[s] ?? 0) - h.start[s]
  return { showdown, shown, rank, won, net, pots: paid }
}

/** Replays a hand's moves onto a fresh table. Throws if the stored facts
 *  cannot be replayed (a corrupt state must never become a silent misdeal). */
function build(g: PokerGame, h: PokerHand): Built {
  const table = newTable(h, g.seats)
  const b: Built = { table, folded: new Set(), done: false, result: null }
  settle(table, b, h)
  for (const m of h.moves) {
    if (b.done) throw new Error(`replay: move after the hand ended (hand ${h.n})`)
    if (table.playerToAct() !== m.seat) throw new Error(`replay: seat ${m.seat} acted out of turn (hand ${h.n})`)
    table.actionTaken(m.act, m.size)
    if (m.act === 'fold') b.folded.add(m.seat)
    settle(table, b, h)
  }
  return b
}

// ── Reading the table ────────────────────────────────────────────────────

export type SeatLive = {
  seat: number
  /** Chips behind (not yet bet). */
  stack: number
  /** Chips in front of the seat this street. */
  bet: number
  /** Chips this seat has put in this hand. */
  committed: number
  inGame: boolean
  folded: boolean
  allIn: boolean
}

export type Legal = {
  seat: number
  canCheck: boolean
  toCall: number
  /** Present when a bet/raise is possible: the allowed TOTAL for this street. */
  raise: { kind: 'bet' | 'raise'; min: number; max: number } | null
}

export type Snapshot = {
  hand: PokerHand
  street: Street
  board: CardCode[]
  pot: number
  seats: SeatLive[]
  toAct: number | null
  legal: Legal | null
  /** SECRET: every seat's hole cards this hand. Never send this whole. */
  holes: (CardCode[] | null)[]
  done: boolean
  result: HandResult | null
}

const streetOf = (n: number): Street => (n >= 5 ? 'river' : n === 4 ? 'turn' : n === 3 ? 'flop' : 'preflop')

export function currentHand(g: PokerGame): PokerHand | null {
  return g.hands.length ? g.hands[g.hands.length - 1] : null
}

export function snapshot(g: PokerGame): Snapshot | null {
  const h = currentHand(g)
  if (!h) return null
  const b = build(g, h)
  return snapshotOf(g, h, b)
}

function snapshotOf(g: PokerGame, h: PokerHand, b: Built): Snapshot {
  const t = b.table
  if (b.done) {
    const final = h.start.map((c, s) => (c > 0 ? c + (b.result!.net[s] ?? 0) : 0))
    return {
      hand: h, street: 'river', board: boardFromLog(h), pot: 0,
      seats: h.start.map((c, s) => ({
        seat: s, stack: final[s], bet: 0, committed: 0, inGame: c > 0,
        folded: b.folded.has(s), allIn: false,
      })),
      toAct: null, legal: null, holes: holesFromDeck(h), done: true, result: b.result,
    }
  }
  const table = t.seats()
  const total = h.start.reduce((a, c) => a + c, 0)
  const seats: SeatLive[] = h.start.map((c, s) => {
    const p = table[s]
    const stack = p ? p.stack : 0
    const folded = b.folded.has(s)
    return {
      seat: s, stack, bet: folded || !p ? 0 : p.betSize, committed: c > 0 ? c - stack : 0,
      inGame: c > 0, folded, allIn: c > 0 && !folded && stack === 0,
    }
  })
  const pot = total - seats.reduce((a, x) => a + (x.inGame ? x.stack : 0), 0)
  const board = t.communityCards().map(fromFacade)
  let toAct: number | null = null
  let legal: Legal | null = null
  if (t.isBettingRoundInProgress()) {
    toAct = t.playerToAct()
    const la = t.legalActions()
    const biggest: number = (t as any)._table._dealer.biggestBet()
    const mine = seats[toAct].bet
    const agg = la.actions.includes('bet') ? 'bet' : la.actions.includes('raise') ? 'raise' : null
    legal = {
      seat: toAct,
      canCheck: la.actions.includes('check'),
      toCall: la.actions.includes('call') ? Math.min(biggest - mine, seats[toAct].stack) : 0,
      raise: agg && la.chipRange ? { kind: agg, min: la.chipRange.min, max: la.chipRange.max } : null,
    }
  }
  return {
    hand: h, street: streetOf(board.length), board, pot, seats, toAct, legal,
    holes: holesFromDeck(h), done: false, result: null,
  }
}

/** Hole cards straight from the stored deck: poker-ts deals each seat its
 *  two cards in seat order, top of the deck first. */
function holesFromDeck(h: PokerHand): (CardCode[] | null)[] {
  const out: (CardCode[] | null)[] = h.start.map(() => null)
  let k = 0
  h.start.forEach((c, s) => { if (c > 0) { out[s] = [h.deck[k], h.deck[k + 1]]; k += 2 } })
  return out
}

function boardFromLog(h: PokerHand): CardCode[] {
  for (let i = h.log.length - 1; i >= 0; i--) {
    const l = h.log[i]
    if (l.t === 'board') return l.board
  }
  return []
}

// ── Game lifecycle ───────────────────────────────────────────────────────

export function newGame(seats: number, maxHands: number): PokerGame {
  if (seats < POKER.minSeats || seats > POKER.maxSeats) throw new Error(`seats must be ${POKER.minSeats}-${POKER.maxSeats}`)
  return {
    v: 1, seats,
    maxHands: Math.max(1, Math.min(200, Math.round(maxHands))),
    chips: Array(seats).fill(POKER.startStack),
    hands: [], over: false,
    stats: Array.from({ length: seats }, () => ({ asked: 0, retried: 0, auto: 0, costUsd: 0, ms: 0 })),
  }
}

/** Deals the next hand, or ends the game. `deck` and `button` are for tests. */
export function dealNext(g: PokerGame, opts: { deck?: CardCode[]; button?: number } = {}): void {
  if (g.over) return
  const last = currentHand(g)
  if (last && !last.result) throw new Error('the current hand is not finished')
  const live = liveSeats(g.chips)
  if (live.length < 2 || g.hands.length >= g.maxHands) { g.over = true; return }
  const button = opts.button ?? (last ? nextLive(g.chips, last.button) : live[randomInt(live.length)])
  if (g.chips[button] <= 0) throw new Error('the button must be a live seat')
  const { sb, bb } = blindSeats(g.chips, button)
  const deck = opts.deck ?? shuffledDeck()
  if (deck.length !== 52 || new Set(deck).size !== 52) throw new Error('a deck is 52 distinct cards')
  const h: PokerHand = {
    n: g.hands.length + 1, button, sbSeat: sb, bbSeat: bb,
    start: [...g.chips], deck, moves: [], log: [], result: null,
  }
  g.hands.push(h)
  const b = build(g, h)
  const s = snapshotOf(g, h, b)
  // Blinds as the table actually took them (a short stack posts what it has).
  h.log.push({ t: 'post', seat: sb, blind: 'sb', amount: Math.min(POKER.smallBlind, h.start[sb]) })
  h.log.push({ t: 'post', seat: bb, blind: 'bb', amount: Math.min(POKER.bigBlind, h.start[bb]) })
  logBoard(h, [], b.done ? boardFor(b, h) : s.board)
  if (b.done) close(g, h, b)
}

function boardFor(b: Built, h: PokerHand): CardCode[] {
  // After a finished hand poker-ts no longer reports the board; the deck
  // does: the cards after the hole cards, as many as were dealt.
  const holes = h.start.filter(c => c > 0).length * 2
  const dealt = b.result?.showdown ? 5 : 0
  return h.deck.slice(holes, holes + dealt)
}

function logBoard(h: PokerHand, before: CardCode[], after: CardCode[]) {
  if (after.length > before.length) h.log.push({ t: 'board', street: streetOf(after.length), board: after })
}

function close(g: PokerGame, h: PokerHand, b: Built) {
  h.result = b.result
  g.chips = h.start.map((c, s) => (c > 0 ? c + (b.result!.net[s] ?? 0) : 0))
  const live = liveSeats(g.chips)
  if (live.length < 2 || g.hands.length >= g.maxHands) g.over = true
}

export type Decision = { act: Act; amount?: number | null }
export type Applied = { ok: true; act: Act; put: number; to: number } | { ok: false; reason: string }

/**
 * Checks a decision against the table and, when legal, applies it. A refusal
 * names what was wrong in words a model can act on: it is the retry message.
 * Two leniencies, the same for every seat: "bet" and "raise" mean the same
 * aggressive action, and "call" with nothing to call is a check.
 */
export function apply(g: PokerGame, seat: number, d: Decision, extra: Partial<Extract<LogLine, { t: 'act' }>> = {}): Applied {
  const h = currentHand(g)
  if (!h || h.result) return { ok: false, reason: 'no hand is being played' }
  const b = build(g, h)
  const s = snapshotOf(g, h, b)
  if (s.toAct !== seat || !s.legal) return { ok: false, reason: 'it is not your turn' }
  const L = s.legal
  const me = s.seats[seat]
  let move: Move | null = null
  let shown: Act = d.act

  switch (d.act) {
    case 'fold':
      move = { seat, act: 'fold' }
      break
    case 'check':
      if (!L.canCheck) return { ok: false, reason: `you cannot check: there are ${L.toCall} chips to call. Fold, call${L.raise ? ' or raise' : ''}.` }
      move = { seat, act: 'check' }
      break
    case 'call':
      if (L.canCheck) { move = { seat, act: 'check' }; shown = 'check'; break }
      move = { seat, act: 'call' }
      break
    case 'bet':
    case 'raise': {
      if (!L.raise) {
        return { ok: false, reason: L.canCheck
          ? 'you cannot bet now. Check or fold.'
          : `you cannot raise now: you may only fold or call ${L.toCall}.` }
      }
      const amt = Number(d.amount)
      if (d.amount == null || !Number.isFinite(amt)) {
        return { ok: false, reason: `"${d.act}" needs "amount": the TOTAL you will have bet this street, from ${L.raise.min} to ${L.raise.max}.` }
      }
      const to = Math.round(amt)
      if (to < L.raise.min || to > L.raise.max) {
        return { ok: false, reason: `amount ${to} is outside the allowed range ${L.raise.min} to ${L.raise.max}. "amount" is the TOTAL you will have bet this street (you have ${me.bet} in front of you now); ${L.raise.max} is all-in.` }
      }
      move = { seat, act: L.raise.kind, size: to }
      shown = L.raise.kind
      break
    }
    case 'allin':
      if (L.raise) { move = { seat, act: L.raise.kind, size: L.raise.max } }
      else if (!L.canCheck) move = { seat, act: 'call' }
      else move = { seat, act: 'check' }
      shown = move.act
      break
    default:
      return { ok: false, reason: `unknown action "${String(d.act)}". Use fold, check, call, bet, raise or allin.` }
  }

  const beforeBoard = s.board
  const stackBefore = me.stack
  const betBefore = me.bet
  b.table.actionTaken(move.act, move.size)
  if (move.act === 'fold') b.folded.add(seat)
  h.moves.push(move)
  settle(b.table, b, h)

  // What actually went in, read back from the table (a call for more than
  // the stack is an all-in for less, and the table knows it).
  // While the hand goes on, the seat's stack says it even after the street
  // closed and the bets were collected; once the hand is over the pot has
  // been paid out, so it is worked out from the action instead.
  let put = 0
  if (move.act !== 'fold' && move.act !== 'check') {
    const after = b.done ? null : b.table.seats()[seat]
    put = after ? stackBefore - after.stack
      : move.act === 'call' ? Math.min(L.toCall, stackBefore) : (move.size! - betBefore)
  }
  const to = betBefore + put
  if (move.act !== 'fold' && move.act !== 'check' && put >= stackBefore && stackBefore > 0) shown = 'allin'
  h.log.push({ t: 'act', seat, act: shown, put, to, street: s.street, ...extra })
  logBoard(h, beforeBoard, b.done ? boardFor(b, h) : b.table.communityCards().map(fromFacade))
  if (b.done) close(g, h, b)
  return { ok: true, act: shown, put, to }
}

/** The fallback after two unusable replies: check when free, otherwise fold. */
export function fallbackDecision(g: PokerGame): Decision {
  const s = snapshot(g)
  return { act: s?.legal?.canCheck ? 'check' : 'fold' }
}

// ── Positions ────────────────────────────────────────────────────────────

/** Position names for this hand's live seats, counted from the button. */
export function positions(h: PokerHand): Record<number, string> {
  const live = liveSeats(h.start)
  const out: Record<number, string> = {}
  if (live.length === 2) {
    out[h.button] = 'BTN/SB'
    out[nextLive(h.start, h.button)] = 'BB'
    return out
  }
  const order: number[] = []
  let s = h.button
  for (let i = 0; i < live.length; i++) { order.push(s); s = nextLive(h.start, s) }
  const rest = order.slice(3)
  const names: Record<number, string[]> = {
    0: [], 1: ['UTG'], 2: ['UTG', 'CO'], 3: ['UTG', 'HJ', 'CO'], 4: ['UTG', 'MP', 'HJ', 'CO'],
    5: ['UTG', 'UTG+1', 'MP', 'HJ', 'CO'], 6: ['UTG', 'UTG+1', 'MP', 'LJ', 'HJ', 'CO'],
  }
  out[order[0]] = 'BTN'; out[order[1]] = 'SB'; out[order[2]] = 'BB'
  rest.forEach((seat, i) => { out[seat] = names[rest.length]?.[i] ?? `+${i}` })
  return out
}

// ── What a viewer may see ────────────────────────────────────────────────

export type Viewer =
  /** Watching an AI-only table, or a seated person who is out of chips: everything. */
  | { all: true }
  /** A seated person: their own cards; others' only at showdown; AI reasons only once the hand is over. */
  | { all: false; seat: number }

export type ViewHand = {
  n: number
  button: number
  sbSeat: number
  bbSeat: number
  positions: Record<number, string>
  street: Street
  board: CardCode[]
  pot: number
  seats: (SeatLive & { cards: CardCode[] | null })[]
  toAct: number | null
  legal: Legal | null
  log: LogLine[]
  result: HandResult | null
}

/** A finished hand as the viewer may see it, for the history list. */
export function viewHand(g: PokerGame, h: PokerHand, v: Viewer, snap?: Snapshot | null): ViewHand {
  const s = snap ?? snapshotOf(g, h, build(g, h))
  const over = !!h.result
  const sees = (seat: number) => v.all || v.seat === seat || (over && !!h.result!.shown[seat])
  return {
    n: h.n, button: h.button, sbSeat: h.sbSeat, bbSeat: h.bbSeat,
    positions: positions(h),
    street: s.street, board: s.board, pot: s.pot,
    seats: s.seats.map(x => ({ ...x, cards: x.inGame && sees(x.seat) ? s.holes[x.seat] : null })),
    toAct: s.toAct,
    // A seated person sees the legal range only on their own turn.
    legal: s.legal && (v.all || s.legal.seat === (v as any).seat) ? s.legal : null,
    // Reasons are a seat's private thoughts: hidden from a seated person
    // until the hand is over. Cards never ride in the log.
    log: v.all || over ? h.log : h.log.map(l => (l.t === 'act' && l.why ? { ...l, why: undefined } : l)),
    result: h.result,
  }
}

// ── What a model is told ─────────────────────────────────────────────────

/** Public one-line story of a finished hand, for later prompts. Never
 *  carries a card that was not shown at showdown. */
export function handSummary(h: PokerHand, name: (seat: number) => string): string {
  const r = h.result
  if (!r) return ''
  const acts = h.log
    .filter((l): l is Extract<LogLine, { t: 'act' }> => l.t === 'act')
    .map(l => `${name(l.seat)} ${l.act}${l.act === 'bet' || l.act === 'raise' || (l.act === 'allin' && l.to) ? ` ${l.to}` : l.act === 'call' ? ` ${l.put}` : ''} (${l.street})`)
  const board = boardFromLog(h)
  const shown = Object.entries(r.shown).map(([s, c]) => `${name(+s)} showed ${c.join(' ')}${r.rank[+s] != null ? ` (${HAND_NAMES[r.rank[+s]]})` : ''}`)
  const won = Object.entries(r.won).map(([s, w]) => `${name(+s)} won ${w}`)
  return [
    `Hand ${h.n} (button: ${name(h.button)})`,
    acts.join(', ') || 'no action',
    board.length ? `board ${board.join(' ')}` : 'no flop',
    shown.length ? shown.join('; ') : 'no showdown',
    won.join(', '),
  ].join(' | ')
}

/** Everything one seat may know at its turn. The only hole cards here are its own. */
export function seatFacts(g: PokerGame, seat: number) {
  const s = snapshot(g)
  if (!s || s.toAct !== seat || !s.legal) return null
  return {
    hand: s.hand,
    street: s.street,
    board: s.board,
    pot: s.pot,
    seats: s.seats,
    positions: positions(s.hand),
    mine: s.holes[seat]!,
    legal: s.legal,
  }
}
