// lib/matchScore.ts
//
// Per-run performance score — the 傳說對決-style match grade (0–15, one
// decimal) shown on the result screens. NOT the persistent XDRating
// (模型戰力): this number grades ONE run from that run's observables, so
// losing models still get an informative grade.
//
// Formula (CC, July 16; rescaled July 29) — vote-heavy:
//   score = 15 × (0.6·votePts + 0.2·speedPts + 0.2·costPts)
//   • votePts  0..1 — XCreate: picked 1, others 0.
//                     XDuel: (vote1 + vote2)/2, tie = 0.5 each.
//   • speedPts 0..1 — RATIO to the fastest in the run: fastest/mine.
//   • costPts  0..1 — RATIO to the cheapest in the run: cheapest/mine.
//   • errored slot → 0.0 flat (DNF) and excluded from the ratio bases.
//   • a slot that RESPONDED never scores 0.0 — it floors at 0.1. 0.0 is
//     reserved for DNF, so the two are never confusable on the card.
//
// Why ratios and not min-max:
//   Min-max normalisation maps the worst value in the run to exactly 0. In
//   a 2-model duel — the default — that means the slower model scores 0 on
//   speed whether it lost by 1ms or by 25 seconds, and the same for cost.
//   A model that loses both votes then scores a flat 0.0 no matter how
//   close the run was, which is both uninformative and reads as breakage.
//   Ratios keep the magnitude: 1.6s vs 1.7s → 0.94, 1.6s vs 26.7s → 0.06.
//   DNF stays the only way to show nothing at all.
//
// MVP = highest score in the run (vote-heavy weighting makes this the
// picked model in practice; specific enough runs can still crown a
// blisteringly fast+cheap loser — that's a feature, it sparks the
// "wait, why did I pick the slow one?" reflection the product wants).

export interface MatchScoreInput {
  votePts: number        // 0..1
  responseTime: number   // ms
  cost: number           // USD
  error?: boolean
}

/**
 * Points for a lower-is-better measure, relative to the run's best.
 * best/mine, clamped to 0..1. Zero and non-finite inputs are treated as
 * "no signal" → everyone gets full marks, because a free or instant run
 * carries no cost/speed information to rank on (mock mode does this).
 */
function ratioPts(mine: number, best: number): number {
  if (!Number.isFinite(mine) || !Number.isFinite(best)) return 1
  if (best <= 0) return mine <= 0 ? 1 : 0
  if (mine <= 0) return 1
  return Math.min(1, best / mine)
}

/** Lowest grade a model that actually responded can receive. */
const RESPONDED_FLOOR = 0.1

export function computeMatchScores(entries: MatchScoreInput[]): number[] {
  const ok = entries.filter(e => !e.error)
  // All-errored run: nothing to rank against, everyone is a DNF anyway.
  const bestT = ok.length ? Math.min(...ok.map(e => e.responseTime)) : 0
  const bestC = ok.length ? Math.min(...ok.map(e => e.cost)) : 0

  return entries.map(e => {
    if (e.error) return 0
    const speedPts = ratioPts(e.responseTime, bestT)
    const costPts  = ratioPts(e.cost, bestC)
    const raw = 15 * (0.6 * e.votePts + 0.2 * speedPts + 0.2 * costPts)
    // It answered, so it gets a grade. Rounding a crushed-but-valid run
    // down to 0.0 would put it in the same box as a model that never
    // replied — 0.0 belongs to DNF alone.
    return Math.max(RESPONDED_FLOOR, Math.round(raw * 10) / 10)
  })
}

/** XDuel votePts for slot i given the two votes ('T' | slot index | null). */
export function duelVotePts(i: number, vote1: string | number | null, vote2: string | number | null): number {
  const pts = (v: string | number | null) => v === null ? 0.5 : v === 'T' ? 0.5 : (v === i ? 1 : 0)
  // vote2 null (user bailed before revote) → grade on vote1 alone.
  if (vote2 === null) return pts(vote1)
  return (pts(vote1) + pts(vote2)) / 2
}
