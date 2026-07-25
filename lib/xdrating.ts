// lib/xdrating.ts
//
// XDRating computation, shared by:
//   • POST /api/xdrating/refit  — fits BT over the aggregate tables and
//     writes the model_ratings snapshot (the normal path)
//   • GET  /api/xboard          — falls back to computeLiveLeaderboard()
//     (full raw-vote scan, the legacy algorithm) if the snapshot is
//     missing, so a half-applied migration can't blank XBoard.
//
// Pipeline design: docs/xdrating-pipeline.md. The aggregate tables
// (model_pairwise_wins / model_vote_stats) are maintained by DB triggers
// (supabase/45_xdrating_pipeline.sql) in the same transaction as each vote.
//
// XD = Quality BT * 0.4 + Value BT * 0.4 + Stickiness bonus * 0.2

import type { SupabaseClient } from '@supabase/supabase-js'

export const BASE_RATING = 1000
const BT_ITERATIONS = 50
const MODES = ['text', 'image', 'video'] as const

// ── Bradley-Terry MLE with a pseudo-count prior ─────────────────────────────
//
// Regularization (July 17): every model carries PRIOR_MATCHES worth of
// virtual TIES, spread evenly across all opponents (ε per direction =
// PRIOR_MATCHES / (2·(n-1))). Why:
//   • The raw MLE is degenerate on sparse data — a model with ZERO wins in
//     a signal has strength → 0, and the old `|| 1` guards then parked it
//     at an arbitrary ~1000 placeholder. Its first real win would snap it
//     to its true (often much lower) position — which read as "I won but
//     my rating dropped" on the result screen.
//   • With the prior, unrated models sit at exactly BASE_RATING, first
//     votes move them smoothly, and the prior's weight fades as real
//     matches accumulate (2 virtual matches vs hundreds of real ones).
// The prior total is FIXED per model (not per pair) so shrinkage doesn't
// grow with catalog size. Changing PRIOR_MATCHES is retroactive — it's
// fit-time only; just POST /api/xdrating/refit?force=1.
const PRIOR_MATCHES = 2

export function bradleyTerry(
  modelIds: string[],
  wins: Record<string, Record<string, number>>,
): Record<string, number> {
  const n = modelIds.length
  if (n === 0) return {}
  const eps = n > 1 ? PRIOR_MATCHES / (2 * (n - 1)) : 0
  const p: Record<string, number> = {}
  for (const id of modelIds) p[id] = 1.0

  for (let iter = 0; iter < BT_ITERATIONS; iter++) {
    const newP: Record<string, number> = {}
    for (const i of modelIds) {
      let winsTotal = 0
      let denomSum = 0
      for (const j of modelIds) {
        if (i === j) continue
        const wij = (wins[i]?.[j] || 0) + eps
        const wji = (wins[j]?.[i] || 0) + eps
        const nij = wij + wji
        if (nij === 0) continue
        winsTotal += wij
        denomSum += nij / (p[i] + p[j])
      }
      newP[i] = denomSum > 0 ? winsTotal / denomSum : 1.0
    }
    const logSum = modelIds.reduce((s, id) => s + Math.log(newP[id] || 1), 0)
    const logMean = logSum / n
    for (const id of modelIds) p[id] = (newP[id] || 1) / Math.exp(logMean)
  }

  const ratings: Record<string, number> = {}
  for (const id of modelIds) {
    ratings[id] = Math.round(BASE_RATING + 400 * Math.log10(p[id] || 1))
  }
  return ratings
}

function xdScoreOf(qR: number, vR: number, sRate: number | null): number {
  const sRating = sRate !== null ? 600 + sRate * 800 : BASE_RATING
  return Math.round(qR * 0.4 + vR * 0.4 + sRating * 0.2)
}

// ── Refit from aggregates → model_ratings snapshot ──────────────────────────
//
// Computes each concrete mode from its own aggregate rows, and 'all' from
// the summed aggregates (matching the legacy route's mode=all behavior of
// pooling every vote into one fit).
export async function refitFromAggregates(sb: SupabaseClient): Promise<{ rows: number }> {
  const [{ data: pw, error: e1 }, { data: st, error: e2 }] = await Promise.all([
    sb.from('model_pairwise_wins').select('mode, signal, winner_id, loser_id, wins'),
    sb.from('model_vote_stats').select('mode, model_id, votes, voted1, retained, price_label'),
  ])
  if (e1 || e2) throw new Error(`aggregate read failed: ${e1?.message ?? e2?.message}`)

  type Matrix = Record<string, Record<string, number>>
  const upserts: any[] = []

  const fitMode = (modeKey: string, modes: readonly string[]) => {
    const qWins: Matrix = {}
    const vWins: Matrix = {}
    const votes: Record<string, number> = {}
    const voted1: Record<string, number> = {}
    const retained: Record<string, number> = {}
    const priceLabel: Record<string, string | null> = {}

    for (const r of pw ?? []) {
      if (!modes.includes(r.mode)) continue
      const m = r.signal === 'value' ? vWins : qWins
      if (!m[r.winner_id]) m[r.winner_id] = {}
      m[r.winner_id][r.loser_id] = (m[r.winner_id][r.loser_id] || 0) + Number(r.wins)
    }
    for (const r of st ?? []) {
      if (!modes.includes(r.mode)) continue
      votes[r.model_id] = (votes[r.model_id] || 0) + Number(r.votes)
      voted1[r.model_id] = (voted1[r.model_id] || 0) + r.voted1
      retained[r.model_id] = (retained[r.model_id] || 0) + r.retained
      if (r.price_label) priceLabel[r.model_id] = r.price_label
    }

    const activeIds = Object.keys(votes).filter(id => votes[id] >= 1)
    const qRatings = bradleyTerry(activeIds, qWins)
    const vRatings = bradleyTerry(activeIds, vWins)

    for (const id of activeIds) {
      const sRate = voted1[id] > 0 ? retained[id] / voted1[id] : null
      const qR = qRatings[id] ?? BASE_RATING
      const vR = vRatings[id] ?? BASE_RATING
      upserts.push({
        mode:           modeKey,
        model_id:       id,
        quality_rating: qR,
        value_rating:   vR,
        stickiness:     sRate,
        xd_score:       xdScoreOf(qR, vR, sRate),
        total_votes:    votes[id],
        price_label:    priceLabel[id] ?? null,
        updated_at:     new Date().toISOString(),
      })
    }
  }

  for (const m of MODES) fitMode(m, [m])
  fitMode('all', MODES)

  // Full replace: delete-then-upsert keeps models that dropped out of the
  // aggregates (deleted model, rebuilt matrix) from lingering in the snapshot.
  const { error: delErr } = await sb.from('model_ratings').delete().neq('mode', '__none__')
  if (delErr) throw new Error(`snapshot clear failed: ${delErr.message}`)
  if (upserts.length > 0) {
    const { error: upErr } = await sb.from('model_ratings').upsert(upserts)
    if (upErr) throw new Error(`snapshot write failed: ${upErr.message}`)
  }
  return { rows: upserts.length }
}

// ── Legacy full-scan computation (fallback + verification) ──────────────────
//
// Byte-for-byte the algorithm that used to live in the old /api/leaderboard. Kept as
// the fallback read path and as the oracle for scripts/verify-xdrating.ts.
export interface LeaderboardRow {
  modelId: string
  name: string
  provider: string
  priceLabel: string
  releasedAt: string | null
  /** Blind-vote-only Bradley-Terry rating — pure quality, price unseen. */
  qualityScore: number
  xdScore: number
  totalVotes: number
}

export async function computeLiveLeaderboard(sb: SupabaseClient, mode: string): Promise<LeaderboardRow[]> {
  const { data: aiModels } = await sb
    .from('ai_models')
    .select('id, provider, model_name, display_name, released_at')

  const canonicalById = new Map<string, { name: string; provider: string; releasedAt: string | null }>()
  for (const m of aiModels ?? []) {
    canonicalById.set(m.id, { name: m.display_name, provider: m.provider, releasedAt: m.released_at })
  }
  const validModelIds = new Set([...canonicalById.keys()])

  interface ModelInfo { name: string; provider: string; priceLabel: string; releasedAt: string | null }
  const qWins: Record<string, Record<string, number>> = {}
  const vWins: Record<string, Record<string, number>> = {}
  const info: Record<string, ModelInfo> = {}
  const votes: Record<string, number> = {}
  const timesVoted1: Record<string, number> = {}
  const timesRetained: Record<string, number> = {}

  const ensure = (id: string, m: ModelInfo) => {
    if (!(id in info)) {
      const canonical = canonicalById.get(id)
      info[id] = canonical
        ? { name: canonical.name, provider: canonical.provider, priceLabel: m.priceLabel, releasedAt: canonical.releasedAt }
        : m
      votes[id] = 0
      qWins[id] = {}
      vWins[id] = {}
      timesVoted1[id] = 0
      timesRetained[id] = 0
    }
  }
  const addWin = (matrix: Record<string, Record<string, number>>, winner: string, loser: string) => {
    if (!matrix[winner]) matrix[winner] = {}
    matrix[winner][loser] = (matrix[winner][loser] || 0) + 1
  }
  const addTie = (matrix: Record<string, Record<string, number>>, a: string, b: string) => {
    if (!matrix[a]) matrix[a] = {}
    if (!matrix[b]) matrix[b] = {}
    matrix[a][b] = (matrix[a][b] || 0) + 0.5
    matrix[b][a] = (matrix[b][a] || 0) + 0.5
  }

  let duelQ = sb.from('duels').select('mode, slots, vote1, vote2, vote1_model_id, vote2_model_id, vote_changed')
  if (mode !== 'all') duelQ = duelQ.eq('mode', mode)
  const { data: duels } = await duelQ

  for (const duel of duels ?? []) {
    const slots = ((duel.slots as any[]) || []).filter(Boolean)
    if (slots.length < 2) continue
    for (const slot of slots) {
      const id = slot.model_id || slot.id
      if (id && validModelIds.has(id)) {
        ensure(id, { name: slot.name, provider: slot.provider, priceLabel: slot.priceLabel || '', releasedAt: null })
      }
    }
    const slotIds = slots.map(s => s.model_id || s.id).filter((id): id is string => !!id && validModelIds.has(id))

    if (duel.vote1 != null) {
      const isTie = duel.vote1 === 'T'
      const winnerId = duel.vote1_model_id
      for (const id of slotIds) votes[id]++
      for (let i = 0; i < slotIds.length; i++) {
        for (let j = i + 1; j < slotIds.length; j++) {
          const a = slotIds[i], b = slotIds[j]
          if (isTie) addTie(qWins, a, b)
          else if (winnerId === a) addWin(qWins, a, b)
          else if (winnerId === b) addWin(qWins, b, a)
          else addTie(qWins, a, b)
        }
      }
    }
    if (duel.vote2 != null) {
      const isTie = duel.vote2 === 'T'
      const winnerId = duel.vote2_model_id
      for (const id of slotIds) votes[id]++
      for (let i = 0; i < slotIds.length; i++) {
        for (let j = i + 1; j < slotIds.length; j++) {
          const a = slotIds[i], b = slotIds[j]
          if (isTie) addTie(vWins, a, b)
          else if (winnerId === a) addWin(vWins, a, b)
          else if (winnerId === b) addWin(vWins, b, a)
          else addTie(vWins, a, b)
        }
      }
    }
    if (duel.vote1 != null && duel.vote2 != null && duel.vote1 !== 'T') {
      const v1Winner = duel.vote1_model_id
      if (v1Winner && v1Winner in info) {
        timesVoted1[v1Winner]++
        if (!duel.vote_changed) timesRetained[v1Winner]++
      }
    }
  }

  let xcQ = sb.from('xcreates').select('mode, slots, chosen_model_id').not('chosen_model_id', 'is', null)
  if (mode !== 'all') xcQ = xcQ.eq('mode', mode)
  const { data: xcreates } = await xcQ

  for (const xc of xcreates ?? []) {
    const slots = ((xc.slots as any[]) || []).filter(Boolean)
    if (slots.length < 2) continue
    const chosenId = xc.chosen_model_id
    for (const slot of slots) {
      const id = slot.model_id || slot.id
      if (id && validModelIds.has(id)) {
        ensure(id, { name: slot.name, provider: slot.provider, priceLabel: slot.priceLabel || '', releasedAt: null })
      }
    }
    const slotIdsRaw = slots.map(s => s.model_id || s.id).filter((id): id is string => !!id && validModelIds.has(id))
    const slotIds = Array.from(new Set(slotIdsRaw))
    if (slotIds.length < 2) continue
    for (const id of slotIds) votes[id]++
    const otherIds = slotIds.filter(id => id !== chosenId)
    for (const otherId of otherIds) addWin(qWins, chosenId, otherId)
  }

  const modelIds = Object.keys(info)
  const activeIds = modelIds.filter(id => votes[id] >= 1)
  const qRatings = bradleyTerry(activeIds, qWins)
  const vRatings = bradleyTerry(activeIds, vWins)

  return activeIds
    .map(modelId => {
      const sRate = timesVoted1[modelId] > 0 ? timesRetained[modelId] / timesVoted1[modelId] : null
      const qR = qRatings[modelId] ?? BASE_RATING
      const vR = vRatings[modelId] ?? BASE_RATING
      return {
        modelId,
        name: info[modelId].name,
        provider: info[modelId].provider,
        priceLabel: info[modelId].priceLabel,
        releasedAt: info[modelId].releasedAt,
        qualityScore: qR,
        xdScore: xdScoreOf(qR, vR, sRate),
        totalVotes: votes[modelId],
      }
    })
    .sort((a, b) => b.xdScore - a.xdScore || b.totalVotes - a.totalVotes)
}

// ── Throttled refit entry point (vote paths + cron both land here) ──────────
//
// Skips when a refit ran in the last THROTTLE_MS (unless force). Returns
// whether it ran. Cheap to call optimistically after every vote.
const THROTTLE_MS = 10_000

export async function maybeRefit(
  sb: SupabaseClient,
  source: string,
  force = false,
): Promise<{ ran: boolean; rows?: number }> {
  if (!force) {
    const { data: last } = await sb
      .from('xdrating_refit_log')
      .select('ran_at')
      .order('ran_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (last && Date.now() - new Date(last.ran_at).getTime() < THROTTLE_MS) {
      return { ran: false }
    }
  }
  const t0 = Date.now()
  const { rows } = await refitFromAggregates(sb)
  await sb.from('xdrating_refit_log').insert({ source, duration_ms: Date.now() - t0 })
  return { ran: true, rows }
}
