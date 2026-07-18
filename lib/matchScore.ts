// lib/matchScore.ts
//
// Per-run performance score — the 傳說對決-style match grade (0–15, one
// decimal) shown on the result screens. NOT the persistent XDRating
// (模型戰力): this number grades ONE run from that run's observables, so
// losing models still get an informative grade.
//
// Formula (CC, July 16): vote-heavy —
//   score = 15 × (0.6·votePts + 0.2·speedPts + 0.2·costPts)
//   • votePts  0..1 — XCreate: picked 1, others 0.
//                     XDuel: (vote1 + vote2)/2, tie = 0.5 each.
//   • speedPts 0..1 — normalized inverse response time within the run
//                     (fastest 1, slowest 0; all equal → 0.5).
//   • costPts  0..1 — same, on actual cost (cheapest 1).
//   • errored slot → 0.0 flat (DNF) and excluded from others' normalization.
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

export function computeMatchScores(entries: MatchScoreInput[]): number[] {
  const ok = entries.filter(e => !e.error)
  const times = ok.map(e => e.responseTime)
  const costs = ok.map(e => e.cost)
  const minT = Math.min(...times), maxT = Math.max(...times)
  const minC = Math.min(...costs), maxC = Math.max(...costs)

  return entries.map(e => {
    if (e.error) return 0
    const speedPts = maxT > minT ? (maxT - e.responseTime) / (maxT - minT) : 0.5
    const costPts  = maxC > minC ? (maxC - e.cost) / (maxC - minC) : 0.5
    const raw = 15 * (0.6 * e.votePts + 0.2 * speedPts + 0.2 * costPts)
    return Math.round(raw * 10) / 10
  })
}

/** XDuel votePts for slot i given the two votes ('T' | slot index | null). */
export function duelVotePts(i: number, vote1: string | number | null, vote2: string | number | null): number {
  const pts = (v: string | number | null) => v === null ? 0.5 : v === 'T' ? 0.5 : (v === i ? 1 : 0)
  // vote2 null (user bailed before revote) → grade on vote1 alone.
  if (vote2 === null) return pts(vote1)
  return (pts(vote1) + pts(vote2)) / 2
}
