// lib/bridge-ai.ts — what a model sees and answers at XGame's bridge table
// (Oct 20). SERVER-ONLY (it calls the providers).
//
// FAIRNESS: every model gets this exact harness, published on the table
// (BRIDGE_HARNESS): the same text, its own hand with its point count and
// suit lengths, the auction, the tricks, the dummy once it is down, every
// legal call or card, one retry, the same fallback (pass / the lowest legal
// card). The system is Standard American (SAYC) for everyone, and partners
// cannot talk: only calls and cards carry information. A card that is the
// only legal play is played by the table with no call. Only the thinking
// level differs, shown next to each name.
//
// From 五子棋 and 象棋 (Oct 20): no worked example to copy (placeholders in
// the reply shape), a JSON schema with the tolerant reader as a backstop,
// and a reply copied with its brackets still reads.

import * as providers from './providers'
import type { ModelInfo } from './providers'
import { adaptSchema, strictIsSafe } from './schema-adapt'
import {
  SEAT_LETTERS, SUITS, partner, sideOf, suitOf, rankOf, isVul, tricksOf, tricksWon,
  callText, cardText, handText, readCall, readCard,
  type Seat, type Card, type Call, type Contract, type AuctionEntry, type PlayEntry, type Vul,
} from './bridge-engine'

export const BRIDGE_HARNESS = {
  version: 1,
  system: 'Standard American (SAYC), the same for every seat',
  hand: 'own hand with high-card points and suit lengths',
  legalList: true,
  retries: 1,
  timeoutSec: 90,
  fallback: 'pass in the auction, the lowest legal card in the play, marked ⚠',
  forced: 'a card that is the only legal play is played with no call',
  search: false,
} as const

const LOG = '[xgame:bridge]'
export const MODEL_TIMEOUT_MS = BRIDGE_HARNESS.timeoutSec * 1000

const NAMES = ['North', 'East', 'South', 'West']
const VUL_TEXT: Record<Vul, string> = { none: 'neither side', NS: 'North-South', EW: 'East-West', both: 'both sides' }

export function hcp(cards: Card[]): number {
  return cards.reduce((n, c) => n + Math.max(0, 4 - rankOf(c)), 0)
}
const lengths = (cards: Card[]) => SUITS.map(s => `${({ S: '♠', H: '♥', D: '♦', C: '♣' } as const)[s]}${cards.filter(c => suitOf(c) === s).length}`).join(' ')
const handLine = (cards: Card[]) => `${handText(cards)}   (${hcp(cards)} high-card points; lengths ${lengths(cards)})`

function auctionText(dealer: Seat, auction: AuctionEntry[]): string {
  if (!auction.length) return `(none yet: ${NAMES[dealer]} deals and calls first)`
  return auction.map(a => `${NAMES[a.seat]} ${callText(a.call)}`).join(', ')
}

const header = (seat: Seat, board: number, dealer: Seat, vul: Vul) => [
  `You are playing contract bridge (duplicate scoring) as ${NAMES[seat]}. Your partner is ${NAMES[partner(seat)]}: you play ${sideOf(seat) === 'NS' ? 'North-South against East-West' : 'East-West against North-South'}.`,
  'System: Standard American Yellow Card (SAYC), natural; your partner is another AI using the same system. You cannot talk to your partner; only calls and cards carry information.',
  `Board ${board}. Dealer: ${NAMES[dealer]}. Vulnerable: ${VUL_TEXT[vul]}${isVul(vul, seat) ? ' (you are vulnerable)' : ' (you are not vulnerable)'}.`,
]

export function biddingPrompt(o: {
  seat: Seat; board: number; dealer: Seat; vul: Vul; hand: Card[]; auction: AuctionEntry[]; legal: Call[]; objection: string | null
}): string {
  return [
    ...header(o.seat, o.board, o.dealer, o.vul),
    '',
    `Your hand: ${handLine(o.hand)}`,
    `The auction so far: ${auctionText(o.dealer, o.auction)}`,
    `It is your call. Your legal calls: ${o.legal.map(callText).join(', ')} (X = double, XX = redouble).`,
    ...(o.objection ? ['', `Your previous answer was rejected: ${o.objection}.`] : []),
    '',
    'Bid what your hand and your partner\'s calls justify: open, respond and rebid by SAYC, compete when it pays, and stop at the best contract you can reach. Count your points again before you answer.',
    '',
    'Reply with ONLY this JSON, in this field order:',
    '{"why": "<one short sentence: what your call shows or why you pass>", "call": "<one call, copied from your legal calls>"}',
  ].join('\n')
}

export function playPrompt(o: {
  seat: Seat; board: number; dealer: Seat; vul: Vul; auction: AuctionEntry[]
  contract: Contract; plays: PlayEntry[]
  /** The seat whose card is played now (dummy when declarer plays from it). */
  from: Seat
  /** What the deciding seat may see: its own cards, and the dummy once it is down. */
  own: Card[]; dummy: Card[] | null
  legal: Card[]; objection: string | null
}): string {
  const c = o.contract
  const dummySeat = partner(c.declarer)
  const role = o.seat === c.declarer ? 'the declarer' : o.seat === dummySeat ? 'the dummy' : 'a defender'
  const need = c.level + 6
  const tricks = tricksOf(c, o.plays)
  const done = tricks.filter(t => t.winner != null)
  const cur = tricks[tricks.length - 1]
  const current = cur && cur.winner == null ? cur.cards : []
  const won = tricksWon(c, o.plays)
  const contractText = `${c.level}${callText(`${c.level}${c.strain}`).slice(1)}${c.doubled === 2 ? ' redoubled' : c.doubled ? ' doubled' : ''} by ${NAMES[c.declarer]}`
  return [
    ...header(o.seat, o.board, o.dealer, o.vul),
    '',
    `The auction: ${auctionText(o.dealer, o.auction)}`,
    `Contract: ${contractText}. ${sideOf(c.declarer) === 'NS' ? 'North-South' : 'East-West'} need ${need} tricks; the defenders need ${14 - need} to beat it. You are ${role}.`,
    `Trumps: ${c.strain === 'NT' ? 'none (notrump)' : callText(`1${c.strain}`).slice(1)}.`,
    '',
    `Your hand (${NAMES[o.seat]}): ${handLine(o.own)}`,
    ...(o.dummy ? [`Dummy (${NAMES[dummySeat]}), face up: ${handText(o.dummy)}`] : []),
    `Tricks so far: ${done.length ? done.map((t, i) => `${i + 1}. ${t.cards.map(p => `${NAMES[p.seat]} ${cardText(p.card)}`).join(', ')} (won by ${NAMES[t.winner!]})`).join('; ') : '(none)'}`,
    `This trick: ${current.length ? current.map(p => `${NAMES[p.seat]} ${cardText(p.card)}`).join(', ') : '(you lead)'}`,
    `Tricks won: North-South ${won.NS}, East-West ${won.EW}.`,
    '',
    o.from === o.seat
      ? `It is your turn to play from your own hand. Your legal cards: ${o.legal.map(cardText).join(', ')}.`
      : `As declarer you play the dummy's cards: it is DUMMY's (${NAMES[o.from]}) turn. Legal cards from the dummy: ${o.legal.map(cardText).join(', ')}.`,
    ...(o.objection ? ['', `Your previous answer was rejected: ${o.objection}.`] : []),
    '',
    'Count the tricks you need, watch which high cards are gone, follow your partner\'s signals, and do not waste a winner your side needs later.',
    '',
    'Reply with ONLY this JSON, in this field order:',
    '{"why": "<one short sentence: your plan for this card>", "card": "<one card, copied from the legal cards>"}',
  ].join('\n')
}

const schema = (field: 'call' | 'card') => ({
  type: 'object',
  properties: {
    why: { type: 'string', description: 'One short sentence: your reason.' },
    [field]: { type: 'string', description: field === 'call' ? 'One call copied from the legal calls.' : 'One card copied from the legal cards.' },
  },
  required: ['why', field],
  additionalProperties: false,
})

/** The field and reason of a reply. Tolerant of prose around the JSON, code
 *  fences, a reply cut off after the field, and brackets after the value. */
export function readReply(text: string, field: 'call' | 'card'): { value: string | null; why?: string } {
  let value: string | null = null, why: string | undefined
  for (const b of [...(text.match(/\{[\s\S]*?\}/g) ?? [])].reverse()) {
    try {
      const o = JSON.parse(b)
      if (typeof o[field] === 'string') { value = o[field]; if (typeof o.why === 'string') why = o.why; break }
    } catch { /* the next block */ }
  }
  if (!value) {
    const m = new RegExp(`["']${field}["']\\s*:\\s*["']([^"']{1,20})["']`).exec(text)
    if (m) value = m[1]
    const w = /["']why["']\s*:\s*["']([^"]{1,400})/.exec(text)
    if (w) why = w[1]
  }
  return { value: value ? value.replace(/\s*[(（][^)）]*[)）]\s*$/, '').trim() : null, why: why?.trim().slice(0, 240) || undefined }
}

export const toCall = (v: string | null): Call | null => (v ? readCall(v) : null)
export const toCard = (v: string | null): Card | null => (v ? readCard(v) : null)

export type Asked = { text: string; cost: number; ms: number; timedOut: boolean; inTokens: number; outTokens: number }

export async function askOnce(model: ModelInfo, prompt: string, field: 'call' | 'card', thinking: string | null, userId: string | null, timeoutMs = MODEL_TIMEOUT_MS): Promise<Asked> {
  const t0 = Date.now()
  let text = '', cost = 0, inTokens = 0, outTokens = 0, timedOut = false
  let timer: ReturnType<typeof setTimeout> | null = null
  const s = schema(field)
  await Promise.race([
    new Promise<void>(resolve => {
      providers.streamText(model, [{ role: 'user', content: prompt }], {
        onDelta: (t: string) => { text += t },
        onDone: (r: any) => { cost += Number(r.cost) || 0; inTokens = r.inputTokens ?? 0; outTokens = r.outputTokens ?? 0; resolve() },
        onError: (m: string) => { console.warn(`${LOG} ${model.display_name}:`, m); resolve() },
      }, [], { userId, surface: 'xgame-bridge' } as any, {
        thinking, search: false,
        jsonSchema: { name: `bridge_${field}`, schema: adaptSchema(s, model.provider), strict: strictIsSafe(s) },
      }).catch(() => resolve())
    }),
    new Promise<void>(resolve => { timer = setTimeout(() => { timedOut = true; resolve() }, timeoutMs) }),
  ])
  if (timer) clearTimeout(timer)
  return { text, cost, ms: Date.now() - t0, timedOut, inTokens, outTokens }
}
