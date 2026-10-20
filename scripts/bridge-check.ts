// scripts/bridge-check.ts — XGame bridge's rules checks (Oct 20). No
// database, no spend. Run: npx tsx scripts/bridge-check.ts

import {
  dealHands, dealerOf, vulOf, legalCalls, auctionOver, contractOf, nextCaller,
  tricksOf, nextPlayer, legalCards, remaining, tricksWon, scoreContract,
  readCard, readCall, callText, cardText, handText,
  type AuctionEntry, type Contract, type PlayEntry, type Seat,
} from '../lib/bridge-engine'

let fails = 0
const ok = (cond: boolean, label: string) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`)
  if (!cond) fails++
}
const A = (dealer: Seat, calls: string[]): AuctionEntry[] => calls.map((call, i) => ({ seat: ((dealer + i) % 4) as Seat, call }))

// ── the deal ──────────────────────────────────────────────────────────────
const hands = dealHands()
const all = hands.flat()
ok(hands.every(h => h.length === 13) && new Set(all).size === 52, '52 different cards, 13 each')
ok(dealerOf(1) === 0 && dealerOf(2) === 1 && dealerOf(5) === 0, 'dealer rotates N, E, S, W')
ok(vulOf(1) === 'none' && vulOf(2) === 'NS' && vulOf(3) === 'EW' && vulOf(4) === 'both' && vulOf(17) === 'none', 'vulnerability follows the 16-board cycle')

// ── the auction ───────────────────────────────────────────────────────────
ok(legalCalls([], 0).length === 36 && !legalCalls([], 0).includes('X'), 'the opening call: pass or any of 35 bids, no double')
const a1 = A(0, ['1H'])
ok(legalCalls(a1, 1).includes('X') && !legalCalls(a1, 1).includes('1C') && legalCalls(a1, 1).includes('1S'), 'over 1♥: double, 1♠ yes, 1♣ no')
ok(!legalCalls(A(0, ['1H', 'P']), 2).includes('X'), 'no doubling your partner')
ok(legalCalls(A(0, ['1H', 'X']), 2).includes('XX'), 'redouble after an opponent doubles')
ok(legalCalls(A(0, ['1H', 'P', 'P']), 3).includes('X'), 'a double in the pass-out seat')
ok(!auctionOver(A(0, ['P', 'P', 'P'])) && auctionOver(A(0, ['P', 'P', 'P', 'P'])), 'four passes end it (three do not)')
ok(nextCaller(2, A(2, ['1C'])) === 3, 'the next caller follows the dealer')
const a2 = A(0, ['1H', 'P', '4H', 'P', 'P', 'P'])
ok(auctionOver(a2) && JSON.stringify(contractOf(a2)) === JSON.stringify({ level: 4, strain: 'H', doubled: 0, declarer: 0 }), '1♥ … 4♥: North declares (named hearts first)')
const a3 = A(1, ['1S', 'P', '2S', 'X', 'P', 'P', 'XX', 'P', 'P', 'P'])
const c3 = contractOf(a3)!
ok(c3.level === 2 && c3.strain === 'S' && c3.doubled === 2 && c3.declarer === 1, '2♠ doubled and redoubled, East declares')
ok(contractOf(A(0, ['P', 'P', 'P', 'P'])) === null, 'passed out: no contract')
const a4 = A(0, ['1C', '1D', '1NT', 'P', '3NT', 'P', 'P', 'P'])
ok(contractOf(a4)!.declarer === 2, 'South bid notrump first: South declares 3NT')

// ── the play ──────────────────────────────────────────────────────────────
const c: Contract = { level: 4, strain: 'S', doubled: 0, declarer: 0 }
ok(nextPlayer(c, []) === 1, 'the opening lead is declarer\'s left')
const p1: PlayEntry[] = [{ seat: 1, card: 'HA' }, { seat: 2, card: 'H2' }, { seat: 3, card: 'S2' }, { seat: 0, card: 'HK' }]
ok(tricksOf(c, p1)[0].winner === 3 && nextPlayer(c, p1) === 3, 'a small trump beats the ace; the ruffer leads next')
const p2: PlayEntry[] = [{ seat: 1, card: 'D3' }, { seat: 2, card: 'C9' }, { seat: 3, card: 'DQ' }, { seat: 0, card: 'D7' }]
ok(tricksOf(c, p2)[0].winner === 3, 'off-suit discards cannot win')
const nt: Contract = { level: 3, strain: 'NT', doubled: 0, declarer: 2 }
const p3: PlayEntry[] = [{ seat: 3, card: 'C5' }, { seat: 0, card: 'SA' }, { seat: 1, card: 'C6' }, { seat: 2, card: 'C2' }]
ok(tricksOf(nt, p3)[0].winner === 1, 'notrump: the highest of the suit led wins')
ok(JSON.stringify(legalCards(['SA', 'H2', 'H9'], c, [{ seat: 1, card: 'H5' }])) === JSON.stringify(['H2', 'H9']), 'must follow suit')
ok(legalCards(['SA', 'D2'], c, [{ seat: 1, card: 'H5' }]).length === 2, 'void: any card')
ok(remaining([['SA', 'HK'], [], [], []], [{ seat: 0, card: 'SA' }])[0].join() === 'HK', 'played cards leave the hand')
ok(tricksWon(c, [...p1, ...p2.map(x => x)]).EW === 2, 'tricks counted by side')

// ── scoring ───────────────────────────────────────────────────────────────
const S = (level: number, strain: any, doubled: 0 | 1 | 2, tricks: number, vul: boolean) => scoreContract({ level, strain, doubled, declarer: 0 }, tricks, vul)
ok(S(3, 'NT', 0, 9, false) === 400, '3NT made, not vulnerable: 400')
ok(S(4, 'S', 0, 10, true) === 620, '4♠ made, vulnerable: 620')
ok(S(1, 'NT', 0, 8, false) === 120, '1NT+1: 120')
ok(S(2, 'H', 1, 8, false) === 470, '2♥ doubled made: 470')
ok(S(3, 'NT', 0, 7, true) === -200, '3NT down 2 vulnerable: -200')
ok(S(4, 'S', 1, 7, false) === -500, '4♠ doubled down 3: -500')
ok(S(4, 'S', 1, 6, false) === -800, '4♠ doubled down 4: -800')
ok(S(6, 'NT', 0, 12, true) === 1440, '6NT vulnerable: 1440')
ok(S(7, 'C', 0, 13, false) === 1440, '7♣ not vulnerable: 1440')
ok(S(1, 'C', 2, 7, false) === 230, '1♣ redoubled made: 230')
ok(S(2, 'S', 1, 9, true) === 870, '2♠ doubled +1 vulnerable: 870')

// ── reading ───────────────────────────────────────────────────────────────
ok(['SA', '♠A', 'A♠', 'as', 's-a'].every(x => readCard(x) === 'SA') && readCard('10h') === 'HT' && readCard('♥10') === 'HT', 'cards in every form')
ok(readCard('ZZ') === null && readCard('S1') === null, 'nonsense is not a card')
ok(readCall('1NT') === '1NT' && readCall('1 nt') === '1NT' && readCall('2♠') === '2S' && readCall('4 spades') === '4S', 'bids in every form')
ok(readCall('pass') === 'P' && readCall('Double') === 'X' && readCall('XX') === 'XX' && readCall('8C') === null, 'pass, double, redouble; no 8-level')
ok(callText('4S') === '4♠' && callText('P') === 'Pass' && cardText('HT') === '♥10', 'names for logs')
ok(handText(['SA', 'SK', 'HT', 'C2']) === '♠ A K | ♥ 10 | ♦ — | ♣ 2', 'a hand printed by suit')

console.log(fails ? `\n${fails} FAILED` : '\nall passed')
process.exit(fails ? 1 : 0)
