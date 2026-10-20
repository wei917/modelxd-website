// lib/bridge-cost.ts — what a bridge table may cost, shown before it starts
// (Oct 20). Client-safe: list prices only, poker's per-model rates and reply
// sizes (lib/poker-cost.ts).
//
// Per board a seat makes ~2-5 calls in the auction and ~8-12 card decisions
// (the cards that are the only legal play cost nothing); the declarer also
// decides the dummy's cards. Play prompts carry the tricks so far, so they
// grow through the board.

import { textRates, replyTokens, type CostSeat } from './poker-cost'

const DECISIONS_PER_SEAT = { low: 8, high: 20 }
const PROMPT_TOKENS = { low: 900, high: 2400 }

export function bridgeCostRange(ai: CostSeat[], boards: number): { low: number; high: number } | null {
  let low = 0, high = 0
  for (const s of ai) {
    const r = textRates(s.pricing, s.thinking)
    if (!r) return null
    const o = replyTokens(s.thinking, s.levels)
    low += boards * DECISIONS_PER_SEAT.low * (PROMPT_TOKENS.low * r.input + o.low * r.output) / 1e6
    high += boards * DECISIONS_PER_SEAT.high * (PROMPT_TOKENS.high * r.input + o.high * r.output) / 1e6
  }
  return { low, high }
}
