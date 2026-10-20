// lib/poker-cost.ts — what a hold'em table may cost, shown before it starts
// (Oct 19). Client-safe: list prices only (model_pricing.tokens, per 1M).
//
// A table makes many calls: seats × hands × decisions. The range is built
// from measured play (scripts/poker-live.ts, Oct 19: GPT-6 Luna and Qwen 3.8
// Flash at 4 seats, see DECISIONS and the token figures below), widened for
// what a short test cannot show: longer games carry more history in the
// prompt, and a deep thinking level writes far more than a light one.

/** Decisions a seat makes per hand, low and high. Measured ~1.5 at 4 seats
 *  (many hands end preflop); more seats fold more often. */
const DECISIONS = { low: 1.1, high: 2.6 }

/** Prompt tokens per decision: ~700 measured at hand 1, growing with the
 *  earlier-hands summary (6 hands at most) and the seat count. */
const promptTokens = (seats: number) => ({ low: 650 + 30 * seats, high: 1400 + 60 * seats })

/** Reply tokens (reasoning included, it is billed as output) by thinking level. */
function replyTokens(level: string | null, levels: string[]): { low: number; high: number } {
  if (!levels.length) return { low: 120, high: 400 }
  switch (level) {
    case 'none': case 'minimal': case 'thinking_false': return { low: 80, high: 300 }
    case 'low': return { low: 120, high: 1200 }
    case 'thinking_true': return { low: 300, high: 2500 }
    case 'medium': return { low: 400, high: 3000 }
    case 'high': return { low: 1000, high: 6000 }
    case 'xhigh': case 'max': return { low: 2000, high: 12000 }
    // The model's own default: anywhere from no thinking to a medium budget.
    default: return { low: 120, high: 3000 }
  }
}

const rate = (v: any): number | null =>
  typeof v === 'number' ? v : typeof v?.default === 'number' ? v.default : null

/** Per 1M tokens; output may differ by thinking level ({ default, by_level }). */
export function textRates(pricing: any, level: string | null): { input: number; output: number } | null {
  const t = pricing?.tokens
  const input = rate(t?.text_input)
  const outRaw = t?.text_output
  const output = level && typeof outRaw?.by_level?.[level] === 'number' ? outRaw.by_level[level] : rate(outRaw)
  if (input == null || output == null) return null
  return { input, output }
}

export type CostSeat = { pricing: any; thinking: string | null; levels: string[] }

/** Low/high estimate in USD for the AI seats of a table, or null when a seat has no list price. */
export function pokerCostRange(ai: CostSeat[], totalSeats: number, hands: number): { low: number; high: number } | null {
  let low = 0, high = 0
  const p = promptTokens(totalSeats)
  for (const s of ai) {
    const r = textRates(s.pricing, s.thinking)
    if (!r) return null
    const o = replyTokens(s.thinking, s.levels)
    low += hands * DECISIONS.low * (p.low * r.input + o.low * r.output) / 1e6
    high += hands * DECISIONS.high * (p.high * r.input + o.high * r.output) / 1e6
  }
  return { low, high }
}

/** "$0.004", "$0.12", "$3.40" */
export function usd(n: number): string {
  if (n > 0 && n < 0.01) return `$${n.toFixed(3)}`
  return `$${n.toFixed(2)}`
}
