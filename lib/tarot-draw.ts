// lib/tarot-draw.ts — 塔羅's ritual, pure and client-safe (Sep 28).
//
// Like the 籤 tube (lib/xtell-ritual.ts): the browser's crypto source
// shuffles, so nobody, including us, chooses the cards, and only the card
// ids and their orientation travel. The deck's text and pictures live in
// content/tarot/cards.json (lib/tarot.ts), read on the server.

export const SUITS = ['wands', 'cups', 'swords', 'pentacles'] as const
/** The 78 ids in deck order: 'major-00'…'major-21', then '<suit>-01'…'-14'. */
export const TAROT_IDS: string[] = [
  ...Array.from({ length: 22 }, (_, i) => `major-${String(i).padStart(2, '0')}`),
  ...SUITS.flatMap(s => Array.from({ length: 14 }, (_, i) => `${s}-${String(i + 1).padStart(2, '0')}`)),
]

/** The spreads: one card answers the question; three read past, present,
 *  future. Oct 1 (the layouts most asked for in Taiwan and Japan): 二擇一,
 *  the situation and, for each of two options, where it goes and where it
 *  ends; 關係, each person's heart, the bond, what to face and what comes
 *  next. The order is the order the visitor fills the places in. */
export const SPREADS = {
  one: ['answer'],
  three: ['past', 'present', 'future'],
  choice: ['now', 'pathA', 'pathB', 'endA', 'endB'],
  love: ['you', 'them', 'bond', 'block', 'next'],
} as const
export type TarotSpread = keyof typeof SPREADS
export const SPREAD_KEYS = Object.keys(SPREADS) as TarotSpread[]
export const asSpread = (v: unknown): TarotSpread =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(SPREADS, v) ? v as TarotSpread : 'one'

/** 二擇一's two options, as the visitor named them (optional). */
export const OPTION_MAX = 40
export type TarotOptions = { a: string; b: string }
export const asOptions = (body: any): TarotOptions => {
  const s = (v: unknown) => typeof v === 'string' ? v.trim().slice(0, OPTION_MAX) : ''
  return { a: s(body?.optA), b: s(body?.optB) }
}

export type TarotPick = { id: string; reversed: boolean }

/** Fisher–Yates over the whole deck, then the top `count` cards; each lands
 *  upright or reversed with even odds, as a shuffled deck does. */
export function drawTarot(rand: () => number, count: number): TarotPick[] {
  const deck = [...TAROT_IDS]
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.min(0.999999, Math.max(0, rand())) * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]]
  }
  return deck.slice(0, count).map(id => ({ id, reversed: rand() < 0.5 }))
}

// The ritual (owner, Oct 1: "show the cards face down to let people choose.
// more 儀式感"): the whole deck is shuffled, each card already lying upright
// or reversed as in a real deck, then cut, then fanned face down for the
// visitor to choose from. Which card lies where is the shuffle's; the visitor
// only chooses places, so nobody chooses the cards.

/** The whole deck, shuffled: Fisher–Yates, then each card's orientation. */
export function shuffleDeck(rand: () => number): TarotPick[] {
  return drawTarot(rand, TAROT_IDS.length)
}

/** 切牌: the deck in three piles, top to bottom; the chosen pile goes on top
 *  and the other two follow in their order. */
export function cutDeck(deck: TarotPick[], pile: 0 | 1 | 2): TarotPick[] {
  const a = Math.round(deck.length / 3), b = Math.round(deck.length * 2 / 3)
  const piles = [deck.slice(0, a), deck.slice(a, b), deck.slice(b)]
  return [...piles[pile], ...piles.filter((_, i) => i !== pile).flat()]
}

/** A card's picture, for the reveal before the spread is laid. */
export const tarotImage = (id: string) => `/xtell/tarot/${id}.webp`

/** What a client may send: the right number of distinct real cards. */
export function validPicks(spread: TarotSpread, picks: unknown): picks is TarotPick[] {
  if (!Array.isArray(picks) || picks.length !== SPREADS[spread].length) return false
  const seen = new Set<string>()
  for (const p of picks) {
    if (!p || typeof p !== 'object' || typeof p.id !== 'string' || typeof p.reversed !== 'boolean') return false
    if (!TAROT_IDS.includes(p.id) || seen.has(p.id)) return false
    seen.add(p.id)
  }
  return true
}
