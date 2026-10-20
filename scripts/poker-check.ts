// scripts/poker-check.ts — checks the hold'em engine (lib/poker-engine.ts)
// with no network: side pots with all-ins, split pots, the blinds moving,
// the heads-up blind rule, refusals a model can act on, chip conservation
// over thousands of random hands, a replay after a JSON round trip on every
// action, and the core rule: a seated person's view never carries a hole
// card they may not see.
//
//   npx tsx scripts/poker-check.ts       exit code 1 on any failure

import Hand from 'poker-ts/dist/lib/hand'
import Card from 'poker-ts/dist/lib/card'
import {
  POKER, newGame, dealNext, apply, snapshot, viewHand, currentHand, fullDeck,
  positions, handSummary, fallbackDecision, type PokerGame, type CardCode, type Decision,
} from '../lib/poker-engine'
import { view as tableView } from '../lib/poker-table'

let fails = 0
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails++ }

/** A deck in draw order: the live seats' hole cards in seat order, then the board. */
function deckOf(holes: CardCode[][], board: CardCode[]): CardCode[] {
  const head = [...holes.flat(), ...board]
  return [...head, ...fullDeck().filter(c => !head.includes(c))]
}
const clone = (g: PokerGame): PokerGame => JSON.parse(JSON.stringify(g))
const total = (g: PokerGame) => g.chips.reduce((a, c) => a + c, 0)
const act = (g: PokerGame, d: Decision) => {
  const s = snapshot(g)!
  const r = apply(g, s.toAct!, d)
  if (!r.ok) throw new Error(`refused ${JSON.stringify(d)}: ${r.reason}`)
  return r
}

// ── Heads-up: the button posts the small blind and acts first preflop ──
{
  const g = newGame(2, 10)
  dealNext(g, { button: 0, deck: deckOf([['As', 'Ks'], ['2c', '7d']], ['Qs', 'Js', 'Ts', '3h', '4h']) })
  const h = currentHand(g)!
  const s = snapshot(g)!
  ok(h.sbSeat === 0 && h.bbSeat === 1, 'heads-up: the button (seat 0) is the small blind, seat 1 the big blind')
  ok(s.toAct === 0, 'heads-up: the button acts first before the flop')
  ok(s.seats[0].bet === 5 && s.seats[1].bet === 10 && s.pot === 15, 'heads-up: blinds 5/10 posted, pot 15')
  ok(positions(h)[0] === 'BTN/SB' && positions(h)[1] === 'BB', 'heads-up: positions BTN/SB and BB')
  act(g, { act: 'call' })
  act(g, { act: 'check' })
  const f = snapshot(g)!
  ok(f.street === 'flop' && f.board.join(' ') === 'Qs Js Ts', 'heads-up: the flop comes from the stored deck')
  ok(f.toAct === 1, 'heads-up: the big blind acts first after the flop')
  act(g, { act: 'check' }); act(g, { act: 'check' })
  act(g, { act: 'check' }); act(g, { act: 'check' })
  act(g, { act: 'check' }); act(g, { act: 'check' })
  const r = currentHand(g)!.result!
  ok(r.showdown && r.won[0] === 20 && r.net[0] === 10 && r.net[1] === -10, 'heads-up: royal flush wins 20 at showdown (net +10/-10)')
  ok(r.rank[0] === 9, 'heads-up: the winner is named a royal flush')
  dealNext(g)
  const h2 = currentHand(g)!
  ok(h2.button === 1 && h2.sbSeat === 1 && h2.bbSeat === 0, 'heads-up: the button moves and still posts the small blind')
}

// ── Blinds move one live seat a hand, and skip a seat that is out ──────
{
  const g = newGame(4, 10)
  g.chips = [1000, 0, 1000, 1000]
  dealNext(g, { button: 0 })
  let h = currentHand(g)!
  ok(h.sbSeat === 2 && h.bbSeat === 3, '4 seats, seat 1 out: button 0, small blind 2, big blind 3')
  ok(snapshot(g)!.toAct === 0, '3 live seats: the button acts first preflop (after the big blind)')
  act(g, { act: 'fold' }); act(g, { act: 'fold' })
  ok(currentHand(g)!.result!.won[3] === 15, 'everyone folds: the big blind takes 15')
  dealNext(g)
  h = currentHand(g)!
  ok(h.button === 2 && h.sbSeat === 3 && h.bbSeat === 0, 'next hand: button 2, small blind 3, big blind 0 (seat 1 skipped)')
  ok(total(g) === 3000 && currentHand(g)!.start[1] === 0, 'chips stay 3,000 and the out seat gets no cards')
}

// ── Side pots: three all-ins of different sizes ────────────────────────
{
  const g = newGame(3, 10)
  g.chips = [100, 300, 1000]
  // Seat 0 best (aces), seat 1 second (kings), seat 2 worst; a dry board.
  dealNext(g, { button: 0, deck: deckOf([['Ah', 'Ad'], ['Kh', 'Kd'], ['7c', '2s']], ['9c', '5d', '3h', 'Jd', '8s']) })
  // Button (0) shoves 100, SB (1) shoves 300, BB (2) calls.
  act(g, { act: 'allin' })
  act(g, { act: 'allin' })
  act(g, { act: 'call' })
  const r = currentHand(g)!.result!
  ok(r.showdown && Object.keys(r.shown).length === 3, 'side pots: all three hands are shown')
  ok(r.pots.length === 2 && r.pots[0].size === 300 && r.pots[1].size === 400, 'side pots: main pot 300, side pot 400')
  ok(r.won[0] === 300 && r.won[1] === 400 && !r.won[2], 'side pots: aces take the main pot, kings the side pot')
  ok(g.chips[0] === 300 && g.chips[1] === 400 && g.chips[2] === 700, 'side pots: stacks 300 / 400 / 700 after the hand')
  ok(total(g) === 1400, 'side pots: no chip made or lost')
}

// ── An uncalled bet comes back ────────────────────────────────────────
{
  const g = newGame(3, 10)
  g.chips = [1000, 1000, 200]
  dealNext(g, { button: 0, deck: deckOf([['Ah', 'Ad'], ['Kh', 'Kd'], ['Qc', 'Qs']], ['9c', '5d', '3h', 'Jd', '8s']) })
  act(g, { act: 'raise', amount: 600 })   // button
  act(g, { act: 'fold' })                  // SB
  act(g, { act: 'allin' })                 // BB: all-in for 200, less than the raise
  const r = currentHand(g)!.result!
  ok(r.pots[0].size === 405 && r.pots[1].size === 400 && r.won[0] === 805 && g.chips[0] === 1205 && g.chips[2] === 0,
    'the uncalled 400 comes back to the raiser (its own pot); aces win the 405 against the 200 all-in')
  ok(!r.shown[1], 'the folded small blind shows nothing')
}

// ── An all-in from an earlier street is still paid at showdown ────────
// (poker-ts 1.5.0 paid only the last street's players; the engine patches it.)
{
  const g = newGame(4, 10)
  g.chips = [1000, 300, 1000, 1000]
  // Seat 1 (short) holds aces and goes all-in on the flop; seats 2 and 3 play on.
  dealNext(g, { button: 0, deck: deckOf([['7c', '2d'], ['Ah', 'Ad'], ['Kh', 'Kd'], ['Qh', 'Qd']], ['9c', '5d', '3h', 'Jd', '8s']) })
  // button 0, SB 1, BB 2, UTG 3. Preflop: 3 calls, 0 folds, 1 calls, 2 checks.
  act(g, { act: 'call' }); act(g, { act: 'fold' }); act(g, { act: 'call' }); act(g, { act: 'check' })
  // Flop: 1 shoves 290, 2 calls, 3 calls. Turn: 2 bets 200, 3 calls. River: check, check.
  act(g, { act: 'allin' }); act(g, { act: 'call' }); act(g, { act: 'call' })
  act(g, { act: 'bet', amount: 200 }); act(g, { act: 'call' })
  act(g, { act: 'check' }); act(g, { act: 'check' })
  const r = currentHand(g)!.result!
  ok(r.won[1] === 900 && r.won[2] === 400 && g.chips[1] === 900, `flop all-in wins the 900 main pot, kings the 400 side pot (won ${JSON.stringify(r.won)})`)
  ok(total(g) === 3300, 'flop all-in: chips conserved')
}

// ── A big blind that is all-in from the blind is not asked to act ─────
{
  const g = newGame(3, 10)
  g.chips = [1000, 1000, 10]
  dealNext(g, { button: 0, deck: deckOf([['7c', '2d'], ['Kh', 'Kd'], ['Ah', 'Ad']], ['9c', '5d', '3h', 'Jd', '8s']) })
  act(g, { act: 'call' }); act(g, { act: 'call' })
  const s = snapshot(g)!
  ok(s.street === 'flop' && s.toAct === 1, 'the all-in big blind is checked through; the flop comes with the small blind to act')
}

// ── Split pot, with an odd chip ────────────────────────────────────────
{
  const g = newGame(3, 10)
  // Seats 0 and 1 both play the board's straight; seat 2 folds its blind.
  dealNext(g, { button: 2, deck: deckOf([['2c', '3d'], ['2h', '3s'], ['Kc', 'Kd']], ['9h', 'Ts', 'Jd', 'Qc', '8h']) })
  // button 2, SB 0 (5), BB 1 (10). Button folds, SB calls, BB checks.
  act(g, { act: 'fold' })
  act(g, { act: 'call' })
  act(g, { act: 'check' })
  for (let i = 0; i < 6; i++) act(g, { act: 'check' })
  const r = currentHand(g)!.result!
  ok(r.pots[0].winners.length === 2 && r.won[0] === 10 && r.won[1] === 10, 'split pot: board straight, 20 split 10/10')
  ok(total(g) === 3000, 'split pot: chips conserved')
}
{
  // Odd chip: SB 5 folded into a heads-up split → 25 split 12/13.
  const g = newGame(3, 10)
  dealNext(g, { button: 0, deck: deckOf([['2c', '3d'], ['Kc', 'Kd'], ['2h', '3s']], ['9h', 'Ts', 'Jd', 'Qc', '8h']) })
  // button 0, SB 1 (5), BB 2 (10). Button calls, SB folds, BB checks.
  act(g, { act: 'call' })
  act(g, { act: 'fold' })
  act(g, { act: 'check' })
  for (let i = 0; i < 6; i++) act(g, { act: 'check' })
  const r = currentHand(g)!.result!
  const got = [r.won[0] ?? 0, r.won[2] ?? 0].sort((a, b) => a - b)
  ok(got[0] === 12 && got[1] === 13, `split pot with an odd chip: 25 → ${got.join('/')}`)
  ok(total(g) === 3000, 'odd chip: chips conserved')
}

// ── Refusals name the problem; the fallback checks or folds ───────────
{
  const g = newGame(2, 10)
  dealNext(g, { button: 0 })
  const r1 = apply(g, 0, { act: 'check' })
  ok(!r1.ok && /5 chips to call/.test(r1.reason), `check facing a bet is refused: "${!r1.ok ? r1.reason : ''}"`)
  const r2 = apply(g, 0, { act: 'raise', amount: 15 })
  ok(!r2.ok && /20 to 1000/.test(r2.reason), `raise below the minimum is refused with the range: "${!r2.ok ? r2.reason : ''}"`)
  const r3 = apply(g, 0, { act: 'raise' })
  ok(!r3.ok && /needs "amount"/.test(r3.reason), 'raise without an amount is refused')
  const r4 = apply(g, 1, { act: 'fold' })
  ok(!r4.ok && /not your turn/.test(r4.reason), 'acting out of turn is refused')
  ok(fallbackDecision(g).act === 'fold', 'fallback facing a bet: fold')
  act(g, { act: 'call' })
  ok(fallbackDecision(g).act === 'check', 'fallback when checking is free: check')
  const r5 = apply(g, 1, { act: 'bet', amount: 30 })
  ok(r5.ok && r5.act === 'raise' && r5.to === 30, '"bet" when the move is a raise is read as the raise (same intent)')
  const r6 = apply(g, 0, { act: 'raise', amount: 5000 })
  ok(!r6.ok && /1000 is all-in/.test(r6.reason), 'raise above the stack is refused and says what all-in is')
}

// ── Hidden information: a seated person sees only what they may ───────
{
  let leaks = 0, checks = 0, whyLeaks = 0
  for (let trial = 0; trial < 300; trial++) {
    let g = newGame(4 + (trial % 5), 3)
    const me = trial % g.seats
    dealNext(g)
    while (!g.over) {
      const s = snapshot(g)!
      if (s.done) { dealNext(g); continue }
      // A view at every decision point.
      const v = JSON.stringify(viewHand(g, currentHand(g)!, { all: false, seat: me }))
      checks++
      for (const x of s.seats) {
        if (x.seat === me || !x.inGame) continue
        for (const c of s.holes[x.seat] ?? []) if (v.includes(`"${c}"`) && !s.board.includes(c)) leaks++
      }
      if (v.includes('secret-why')) whyLeaks++
      const L = s.legal!
      const roll = Math.random()
      const d: Decision = roll < 0.25 ? { act: 'fold' } : roll < 0.6 ? { act: L.canCheck ? 'check' : 'call' }
        : L.raise ? { act: 'raise', amount: L.raise.min + Math.floor(Math.random() * (L.raise.max - L.raise.min + 1)) }
        : { act: 'call' }
      const r = apply(g, s.toAct!, d, { why: 'secret-why', say: 'public talk' })
      if (!r.ok) throw new Error(r.reason)
      g = clone(g)
      // After the hand: only shown cards, and the reasons are back.
      const h = currentHand(g)!
      if (h.result) {
        const done = JSON.stringify(viewHand(g, h, { all: false, seat: me }))
        const holes = snapshot(g)!.holes
        holes.forEach((cs, seat) => {
          if (!cs || seat === me || h.result!.shown[seat]) return
          for (const c of cs) if (done.includes(`"${c}"`) && !snapshot(g)!.board.includes(c)) leaks++
        })
        if (h.log.some(l => l.t === 'act' && l.seat !== me) && !done.includes('secret-why')) whyLeaks++
      }
    }
  }
  ok(leaks === 0, `seated view: no unseen hole card in ${checks} views (leaks: ${leaks})`)
  ok(whyLeaks === 0, 'seated view: reasons hidden during the hand, shown after it')
  // Spectator of an AI-only table sees every hand.
  const g = newGame(3, 1)
  dealNext(g)
  const v = viewHand(g, currentHand(g)!, { all: true })
  ok(v.seats.every(x => x.cards && x.cards.length === 2), 'AI-only table: the spectator sees every seat\'s cards')
  // A summary for later prompts carries no unshown card.
  const s = snapshot(g)!
  act(g, { act: 'fold' }); act(g, { act: 'fold' })
  const sum = handSummary(currentHand(g)!, n => `Seat ${n + 1}`)
  ok(s.holes.flat().every(c => !sum.includes(c!)), `hand summary after folds shows no cards: "${sum}"`)
}

// ── The whole reply a seated person gets (lib/poker-table view()) ──────
// Per section: this hand carries none of this hand's hidden cards, the
// previous hand none of its own, and the results list only showdown cards.
{
  const row: any = { id: 'x', user_id: 'u', status: 'active', human_seat: 0, day: 1, pending: {}, title: 't', winner: null, cost_usd: 0, updated_at: new Date().toISOString(),
    players: [0, 1, 2, 3].map(i => ({ seat: i, isHuman: i === 0, modelId: i ? 'm' : null, name: i ? `M${i}` : 'P', provider: null, thinking: null })) }
  const hidden = (h: any) => {
    let k = 0
    const out: string[] = []
    h.start.forEach((c: number, s: number) => { if (c > 0) { if (s !== 0 && !h.result?.shown[s]) out.push(h.deck[k], h.deck[k + 1]); k += 2 } })
    return out
  }
  let leaks = 0, views = 0, whys = 0
  for (let t = 0; t < 120; t++) {
    const g = newGame(4, 10)
    dealNext(g)
    while (!g.over) {
      const s = snapshot(g)!
      if (s.done) { dealNext(g); continue }
      const v: any = tableView(row, g)
      if (!v.spectator) {
        views++
        const hv = JSON.stringify(v.hand)
        for (const c of hidden(currentHand(g)!)) if (!v.hand.board.includes(c) && hv.includes(`"${c}"`)) leaks++
        const prev = g.hands.length >= 2 ? g.hands[g.hands.length - 2] : null
        if (prev && v.prev) { const pv = JSON.stringify(v.prev); for (const c of hidden(prev)) if (!v.prev.board.includes(c) && pv.includes(`"${c}"`)) leaks++ }
        for (const r of v.results) for (const seat of Object.keys(r.shown)) if (!g.hands[r.n - 1].result!.shown[+seat]) leaks++
        if (JSON.stringify(v.hand).includes('secret-why')) whys++
      }
      const L = s.legal!
      const d: Decision = s.toAct === 0 ? { act: L.canCheck ? 'check' : 'call' }
        : Math.random() < 0.3 ? { act: 'fold' } : L.raise && Math.random() < 0.2 ? { act: 'allin' } : { act: L.canCheck ? 'check' : 'call' }
      apply(g, s.toAct!, d, { why: 'secret-why' })
    }
  }
  ok(leaks === 0 && views > 1000, `view(): no hidden card in ${views} seated replies (this hand, last hand, results)`)
  ok(whys === 0, 'view(): no reason in the hand being played, for a seated person')
}

// ── Thousands of random hands: chips conserved, replay identical ──────
/** Independent of the engine's pot code: the one best hand at a showdown
 *  wins at least what every seat put in up to its own amount. */
const lib = (c: string) => new Card('23456789TJQKA'.indexOf(c[0]), 'cdhs'.indexOf(c[1]))
function bestHandPaid(g: PokerGame): boolean {
  const h = currentHand(g)!
  const r = h.result!
  if (!r.showdown) return true
  const board = snapshot(g)!.board
  const seats = Object.keys(r.shown).map(Number)
  const hands = seats.map(s => ({ s, hand: Hand.of([...r.shown[s], ...board].map(lib)) }))
  hands.sort((a, b) => Hand.compare(a.hand, b.hand))
  if (hands.length > 1 && Hand.compare(hands[0].hand, hands[1].hand) === 0) return true
  const put = (s: number) => (r.won[s] ?? 0) - (r.net[s] ?? 0)
  const top = hands[0].s
  const due = h.start.reduce((a, c, s) => a + (c > 0 ? Math.min(put(s), put(top)) : 0), 0)
  return (r.won[top] ?? 0) >= due
}
{
  let hands = 0, bad = 0, replayBad = 0, maxSeats = 0, unpaid = 0, showdowns = 0
  for (let game = 0; game < 400; game++) {
    const seats = 2 + (game % 8)
    maxSeats = Math.max(maxSeats, seats)
    let g = newGame(seats, 15)
    const start = total(g)
    dealNext(g)
    while (!g.over) {
      const s = snapshot(g)!
      if (s.done) { dealNext(g); continue }
      const live = s.seats.reduce((a, x) => a + (x.inGame ? x.stack : 0), 0)
      if (live + s.pot !== start) bad++
      const L = s.legal!
      const roll = Math.random()
      const d: Decision = roll < 0.15 ? { act: 'fold' } : roll < 0.55 ? { act: L.canCheck ? 'check' : 'call' }
        : roll < 0.65 ? { act: 'allin' }
        : L.raise ? { act: 'bet', amount: L.raise.min + Math.floor(Math.random() * (L.raise.max - L.raise.min + 1)) }
        : { act: 'call' }
      const r = apply(g, s.toAct!, d)
      if (!r.ok) throw new Error(`random play refused: ${r.reason}`)
      const before = JSON.stringify(snapshot(g))
      g = clone(g)
      if (JSON.stringify(snapshot(g)) !== before) replayBad++
      if (currentHand(g)!.result) {
        hands++
        if (total(g) !== start) bad++
        if (currentHand(g)!.result!.showdown) { showdowns++; if (!bestHandPaid(g)) unpaid++ }
      }
    }
    if (g.chips.some(c => c < 0)) bad++
  }
  ok(bad === 0, `random play: ${hands} hands at 2-${maxSeats} seats, chips conserved every step (${bad} misses)`)
  ok(replayBad === 0, 'random play: every state replays identically after a JSON round trip')
  ok(unpaid === 0, `random play: in ${showdowns} showdowns the best hand always won at least its main pot (${unpaid} misses)`)
}

// ── Game end: hands run out, or one seat has every chip ───────────────
{
  const g = newGame(2, 2)
  dealNext(g); act(g, { act: 'fold' }); dealNext(g); act(g, { act: 'fold' })
  ok(g.over && g.hands.length === 2, 'the game ends after the set number of hands')
  const h = newGame(2, 50)
  h.chips = [10, 1990]
  dealNext(h, { button: 1, deck: deckOf([['2c', '3d'], ['Ah', 'Ad']], ['9h', 'Ts', 'Jd', '5c', '8h']) })
  // seat 0 is the BB with 10: all in from the blind; the button calls.
  act(h, { act: 'call' })
  ok(h.over && h.chips[1] === 2000, 'the game ends when one seat has every chip')
  ok(POKER.startStack === 100 * POKER.bigBlind, 'stacks start at 100 big blinds')
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed')
process.exit(fails ? 1 : 0)
