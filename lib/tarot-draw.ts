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

/** The spreads: one card answers the question; three read past, present, future. */
export const SPREADS = { one: ['answer'], three: ['past', 'present', 'future'] } as const
export type TarotSpread = keyof typeof SPREADS
export const asSpread = (v: unknown): TarotSpread => v === 'three' ? 'three' : 'one'

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
