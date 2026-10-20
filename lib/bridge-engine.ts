// lib/bridge-engine.ts — contract bridge for XGame (Oct 20; owner: "build
// it", the last of the five games). Pure rules, no I/O, client-safe: the
// deal, the auction, the play and duplicate scoring. The table that hides
// what each seat may not see is lib/bridge-table.ts (server only).
//
// Seats are 0-3 = North, East, South, West; North-South play East-West.
// A game is a set of boards, each with the standard dealer and
// vulnerability for its number. Cards are two characters, suit then rank:
// 'SA', 'HT', 'D9', 'C2' (T is the ten).
//
// The model NEVER adjudicates: it proposes a call or a card, this file
// decides whether it is legal, who won the trick and what the board scores.

export type Seat = 0 | 1 | 2 | 3
export const SEAT_LETTERS = ['N', 'E', 'S', 'W'] as const
export type Suit = 'S' | 'H' | 'D' | 'C'
export const SUITS: Suit[] = ['S', 'H', 'D', 'C']
export const RANKS = 'AKQJT98765432'
export type Card = string
export type Strain = 'C' | 'D' | 'H' | 'S' | 'NT'
export const STRAINS: Strain[] = ['C', 'D', 'H', 'S', 'NT']
/** '1C' … '7NT', 'P' (pass), 'X' (double), 'XX' (redouble). */
export type Call = string
export type Vul = 'none' | 'NS' | 'EW' | 'both'

export const BRIDGE = {
  dealChoices: [1, 4, 8] as const,
  defaultDeals: 4,
} as const

export const partner = (s: Seat): Seat => ((s + 2) % 4) as Seat
export const leftOf = (s: Seat): Seat => ((s + 1) % 4) as Seat
export const sideOf = (s: Seat): 'NS' | 'EW' => (s % 2 === 0 ? 'NS' : 'EW')
export const suitOf = (c: Card) => c[0] as Suit
export const rankOf = (c: Card) => RANKS.indexOf(c[1])   // 0 = ace (highest)

// ── boards ─────────────────────────────────────────────────────────────────

const VUL_CYCLE: Vul[] = ['none', 'NS', 'EW', 'both', 'NS', 'EW', 'both', 'none', 'EW', 'both', 'none', 'NS', 'both', 'none', 'NS', 'EW']
export const dealerOf = (board: number): Seat => (((board - 1) % 4) as Seat)
export const vulOf = (board: number): Vul => VUL_CYCLE[(board - 1) % 16]
export const isVul = (vul: Vul, s: Seat) => vul === 'both' || vul === sideOf(s)

/** A shuffled deck dealt 13 each, every hand sorted for reading. */
export function dealHands(rand: () => number = Math.random): Card[][] {
  const deck: Card[] = []
  for (const s of SUITS) for (const r of RANKS) deck.push(s + r)
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]]
  }
  return [0, 1, 2, 3].map(k => sortHand(deck.slice(k * 13, k * 13 + 13)))
}

export function sortHand(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => SUITS.indexOf(suitOf(a)) - SUITS.indexOf(suitOf(b)) || rankOf(a) - rankOf(b))
}

// ── the auction ────────────────────────────────────────────────────────────

export type AuctionEntry = {
  seat: Seat; call: Call
  why?: string; auto?: boolean; retried?: boolean; ms?: number; cost?: number
}

const bidRank = (call: Call) => {
  const m = /^([1-7])(C|D|H|S|NT)$/.exec(call)
  return m ? (parseInt(m[1], 10) - 1) * 5 + STRAINS.indexOf(m[2] as Strain) : -1
}
export const isBid = (call: Call) => bidRank(call) >= 0
export const ALL_BIDS: Call[] = [1, 2, 3, 4, 5, 6, 7].flatMap(l => STRAINS.map(s => `${l}${s}`))

/** Over after four passes, or three passes after any bid, double or redouble. */
export function auctionOver(auction: AuctionEntry[]): boolean {
  return auction.length >= 4 && auction.slice(-3).every(a => a.call === 'P')
}

/** Whose call it is (the auction is not over). */
export function nextCaller(dealer: Seat, auction: AuctionEntry[]): Seat {
  return ((dealer + auction.length) % 4) as Seat
}

export function legalCalls(auction: AuctionEntry[], seat: Seat): Call[] {
  const lastBidAt = [...auction].map((a, i) => ({ a, i })).reverse().find(x => isBid(x.a.call))
  const top = lastBidAt ? bidRank(lastBidAt.a.call) : -1
  const calls: Call[] = ['P', ...ALL_BIDS.filter(b => bidRank(b) > top)]
  // The last call that was not a pass decides double / redouble.
  const lastReal = [...auction].reverse().find(a => a.call !== 'P')
  if (lastReal && sideOf(lastReal.seat) !== sideOf(seat)) {
    if (isBid(lastReal.call)) calls.push('X')
    else if (lastReal.call === 'X') calls.push('XX')
  }
  return calls
}

export type Contract = { level: number; strain: Strain; doubled: 0 | 1 | 2; declarer: Seat }

/** The contract once the auction is over; null when all four passed. */
export function contractOf(auction: AuctionEntry[]): Contract | null {
  const lastBid = [...auction].reverse().find(a => isBid(a.call))
  if (!lastBid) return null
  const m = /^([1-7])(C|D|H|S|NT)$/.exec(lastBid.call)!
  const strain = m[2] as Strain
  const after = auction.slice(auction.lastIndexOf(lastBid) + 1)
  const doubled: 0 | 1 | 2 = after.some(a => a.call === 'XX') ? 2 : after.some(a => a.call === 'X') ? 1 : 0
  // Declarer: the first of the winning side to name the strain.
  const side = sideOf(lastBid.seat)
  const first = auction.find(a => isBid(a.call) && sideOf(a.seat) === side && a.call.replace(/^[1-7]/, '') === strain)!
  return { level: parseInt(m[1], 10), strain, doubled, declarer: first.seat }
}

// ── the play ───────────────────────────────────────────────────────────────

export type PlayEntry = {
  seat: Seat; card: Card
  why?: string; auto?: boolean; forced?: boolean; retried?: boolean; ms?: number; cost?: number
}

export type Trick = { leader: Seat; cards: PlayEntry[]; winner: Seat | null }

export function tricksOf(contract: Contract, plays: PlayEntry[]): Trick[] {
  const trump = contract.strain === 'NT' ? null : contract.strain as Suit
  const out: Trick[] = []
  let leader = leftOf(contract.declarer)
  for (let i = 0; i < plays.length; i += 4) {
    const cards = plays.slice(i, i + 4)
    let winner: Seat | null = null
    if (cards.length === 4) {
      let best = cards[0]
      for (const c of cards.slice(1)) {
        const s = suitOf(c.card), bs = suitOf(best.card)
        if (s === bs) { if (rankOf(c.card) < rankOf(best.card)) best = c }   // higher in the same suit
        else if (trump && s === trump) best = c                               // the first trump over a non-trump
        // anything else is a discard and cannot win
      }
      winner = best.seat
    }
    out.push({ leader, cards, winner })
    if (winner != null) leader = winner
  }
  return out
}

/** The cards each seat still holds. */
export function remaining(hands: Card[][], plays: PlayEntry[]): Card[][] {
  const gone = new Set(plays.map(p => p.card))
  return hands.map(h => h.filter(c => !gone.has(c)))
}

/** Whose card it is (the play is not over). */
export function nextPlayer(contract: Contract, plays: PlayEntry[]): Seat {
  const tricks = tricksOf(contract, plays)
  const cur = tricks[tricks.length - 1]
  if (!cur || cur.cards.length === 4) return cur ? cur.winner! : leftOf(contract.declarer)
  return ((cur.leader + cur.cards.length) % 4) as Seat
}

export function legalCards(hand: Card[], contract: Contract, plays: PlayEntry[]): Card[] {
  const tricks = tricksOf(contract, plays)
  const cur = tricks[tricks.length - 1]
  if (!cur || cur.cards.length === 4) return hand
  const led = suitOf(cur.cards[0].card)
  const follow = hand.filter(c => suitOf(c) === led)
  return follow.length ? follow : hand
}

export function tricksWon(contract: Contract, plays: PlayEntry[]): { NS: number; EW: number } {
  const t = { NS: 0, EW: 0 }
  for (const tr of tricksOf(contract, plays)) if (tr.winner != null) t[sideOf(tr.winner)]++
  return t
}

// ── scoring (duplicate) ────────────────────────────────────────────────────

/** The declaring side's score for a contract and the tricks it took
 *  (negative when it went down: the defenders' score). */
export function scoreContract(c: Contract, tricks: number, vul: boolean): number {
  const need = c.level + 6
  const mult = c.doubled === 2 ? 4 : c.doubled === 1 ? 2 : 1
  if (tricks >= need) {
    const per = c.strain === 'C' || c.strain === 'D' ? 20 : 30
    const trickScore = (c.strain === 'NT' ? 40 + 30 * (c.level - 1) : per * c.level) * mult
    let score = trickScore
    score += trickScore >= 100 ? (vul ? 500 : 300) : 50
    if (c.level === 6) score += vul ? 750 : 500
    if (c.level === 7) score += vul ? 1500 : 1000
    if (c.doubled) score += c.doubled === 2 ? 100 : 50
    const over = tricks - need
    if (over > 0) score += c.doubled ? over * (vul ? 200 : 100) * (c.doubled === 2 ? 2 : 1) : over * per
    return score
  }
  const down = need - tricks
  if (!c.doubled) return -down * (vul ? 100 : 50)
  let pen = 0
  for (let k = 1; k <= down; k++) {
    if (vul) pen += k === 1 ? 200 : 300
    else pen += k === 1 ? 100 : k <= 3 ? 200 : 300
  }
  return -pen * (c.doubled === 2 ? 2 : 1)
}

// ── reading what a model wrote ─────────────────────────────────────────────

const SUIT_WORDS: Record<string, Suit> = { '♠': 'S', '♥': 'H', '♦': 'D', '♣': 'C', S: 'S', H: 'H', D: 'D', C: 'C' }

/** "SA", "♠A", "A♠", "AS", "S10", "10H", "h-t" → 'SA' / 'HT', or null. */
export function readCard(raw: string): Card | null {
  let s = String(raw ?? '').trim().toUpperCase().replace(/[\s\-_.]/g, '').replace(/10/g, 'T')
  s = s.replace(/[♤♡♢♧]/g, ch => ({ '♤': '♠', '♡': '♥', '♢': '♦', '♧': '♣' } as any)[ch])
  const m = /^([♠♥♦♣SHDC])([AKQJT2-9])$/.exec(s) ?? /^([AKQJT2-9])([♠♥♦♣SHDC])$/.exec(s)
  if (!m) return null
  const [a, b] = m.slice(1)
  const suit = SUIT_WORDS[a] ?? SUIT_WORDS[b]
  const rank = SUIT_WORDS[a] ? b : a
  return suit && RANKS.includes(rank) ? suit + rank : null
}

/** "1NT", "1 nt", "2♠", "pass", "Double", "XX" → a Call, or null. */
export function readCall(raw: string): Call | null {
  const s = String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '')
  if (/^(P|PASS|NOBID)$/.test(s)) return 'P'
  if (/^(XX|REDOUBLE|RDBL|REDBL)$/.test(s)) return 'XX'
  if (/^(X|DOUBLE|DBL)$/.test(s)) return 'X'
  const m = /^([1-7])(NT|N|NOTRUMPS?|♠|♥|♦|♣|S|H|D|C|SPADES?|HEARTS?|DIAMONDS?|CLUBS?)$/.exec(s)
  if (!m) return null
  const w = m[2]
  const strain = w.startsWith('N') ? 'NT' : (SUIT_WORDS[w[0]] ?? null)
  return strain ? `${m[1]}${strain}` : null
}

const SYMBOL: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣', NT: 'NT' }
/** '3NT' → '3NT', '4S' → '4♠', 'P' → 'Pass', 'X' → 'X'. For models and logs. */
export function callText(call: Call): string {
  if (call === 'P') return 'Pass'
  const m = /^([1-7])(C|D|H|S|NT)$/.exec(call)
  return m ? `${m[1]}${SYMBOL[m[2]]}` : call
}
export const cardText = (c: Card) => `${SYMBOL[suitOf(c)]}${c[1] === 'T' ? '10' : c[1]}`

/** "♠ A K 7 | ♥ Q 10 4 | ♦ — | ♣ J 9 8 3", the way a hand is printed. */
export function handText(cards: Card[]): string {
  return SUITS.map(s => {
    const rs = cards.filter(c => suitOf(c) === s).map(c => (c[1] === 'T' ? '10' : c[1]))
    return `${SYMBOL[s]} ${rs.length ? rs.join(' ') : '—'}`
  }).join(' | ')
}
