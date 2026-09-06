// lib/router-weights.ts — the one place a routing preference becomes a model.
//
// Both the named routes on /api/v1 (xd/auto, xd/fast, xd/budget, xd/max) and
// the sliders on XDev resolve through THIS function. That is deliberate: if the
// panel scored candidates its own way it would show a developer one model while
// the API served another, and the panel exists precisely to make the router
// legible. The four routes are presets — named points in the same weight space,
// not separate algorithms.
//
// WHAT THIS IS NOT: it does not look at the request. Three routers that
// classified the prompt were built, frozen and tested against unseen tasks, and
// all three lost to simply always using one strong model (sector table 9-10,
// prompt-shape 16-20, embedding similarity 8/27 vs a 52% baseline). The cause
// was measured afterwards: of 27 per-task winners only 6 were confirmed by
// GDPval's human rubrics, so the routers were learning judge taste. Weighting
// global axes the CALLER chooses has nothing to overfit — there is no
// prediction being made.

export type Axis = 'quality' | 'cost' | 'speed'
export type Weights = Record<Axis, number>

export interface Candidate {
  model_id: string
  /** Blind-vote quality rating. Higher is better. */
  quality: number | null
  /** Blended list price per 1M tokens (input + output). Lower is better. */
  pricePer1m: number | null
  /** Measured seconds to first visible token, WORST dot. Lower is better. */
  ttftS: number | null
}

export interface Scored extends Candidate {
  score: number
  /** 0-1 per axis after normalisation, so a UI can show why something won. */
  parts: Weights
}

/**
 * The four named routes as weights. `floor` keeps a model out of the running
 * unless its quality is within a fixed gap of the leader (see inference.ts —
 * a median floor cut half the board no matter how alike the halves were).
 *
 * budget and fast BOTH need the floor: the cheapest model and the quickest
 * model are very often the same one, and without a floor either route
 * degenerates into "the worst model that is technically usable" — not
 * something to hand a paying caller by default. max deliberately has no floor
 * because it is already sorting on quality alone.
 */
export const PRESETS: Record<string, { weights: Weights; floor: boolean; label: string }> = {
  'xd/auto':   { weights: { quality: 0.5, cost: 0.3, speed: 0.2 }, floor: true,  label: 'Balanced' },
  'xd/fast':   { weights: { quality: 0.2, cost: 0.1, speed: 0.7 }, floor: true,  label: 'Fastest first token' },
  'xd/budget': { weights: { quality: 0.2, cost: 0.7, speed: 0.1 }, floor: true,  label: 'Cheapest that is good enough' },
  'xd/max':    { weights: { quality: 1.0, cost: 0.0, speed: 0.0 }, floor: false, label: 'Best quality, price ignored' },
}

/** Min-max to 0-1 where BIGGER input is better. Flat sets score 1, not 0 or
 *  NaN — one candidate, or ten identical ones, is not a reason to rank nobody. */
function normHigh(values: (number | null)[], v: number | null): number {
  const nums = values.filter((x): x is number => x != null && Number.isFinite(x))
  if (v == null || !Number.isFinite(v) || !nums.length) return 0
  const lo = Math.min(...nums), hi = Math.max(...nums)
  return hi === lo ? 1 : (v - lo) / (hi - lo)
}

/**
 * Same, where SMALLER input is better (price, latency) — on a LOG scale.
 *
 * Linear was the first version and it hid the cheap models. Prices on the board
 * span 120x ($1.75 to $210 per 1M), so linearly $35 normalises to 0.84 — all
 * but indistinguishable from $1.75 at 1.0 — and xd/budget kept returning the
 * $35 model. Cost and latency differences are MULTIPLICATIVE: 20x cheaper is
 * the interesting fact, and a linear scale says the $35-to-$210 gap matters
 * more than the $1.75-to-$35 one, which is backwards for anyone spending money.
 */
function normLow(values: (number | null)[], v: number | null): number {
  const nums = values.filter((x): x is number => x != null && Number.isFinite(x) && x > 0)
  if (v == null || !Number.isFinite(v) || v <= 0 || !nums.length) return 0
  const lo = Math.log(Math.min(...nums)), hi = Math.log(Math.max(...nums))
  return hi === lo ? 1 : (hi - Math.log(v)) / (hi - lo)
}

/**
 * Score and order candidates. Highest score first.
 *
 * A candidate MISSING the data for an axis the caller actually weighted is
 * dropped, not scored as zero and not scored as average. An unmeasured model
 * winning a route named "fast" is the failure that got xd/fast pulled the first
 * time round; scoring it as zero is only marginally better, because it silently
 * ranks "we never measured this" as "this is the slowest thing we have".
 */
export function rank(candidates: Candidate[], weights: Weights): Scored[] {
  const needs = (a: Axis) => weights[a] > 0
  const usable = candidates.filter(c =>
    (!needs('quality') || c.quality != null) &&
    (!needs('cost') || c.pricePer1m != null) &&
    (!needs('speed') || c.ttftS != null))

  const q = usable.map(c => c.quality)
  const p = usable.map(c => c.pricePer1m)
  const t = usable.map(c => c.ttftS)
  const total = weights.quality + weights.cost + weights.speed || 1

  return usable
    .map(c => {
      const parts: Weights = {
        quality: normHigh(q, c.quality),
        cost: normLow(p, c.pricePer1m),
        speed: normLow(t, c.ttftS),
      }
      const score =
        (parts.quality * weights.quality + parts.cost * weights.cost + parts.speed * weights.speed) / total
      return { ...c, score, parts }
    })
    .sort((a, b) => b.score - a.score)
}
