// app/api/leaderboard/route.ts
// Leaderboard — Bradley-Terry MLE rating starting at 1000.
//
// Collects pairwise win/loss data from:
//   - XDuel vote1 (blind)       → quality signal
//   - XDuel vote2 (informed)    → value signal (price-aware)
//   - XCreate chosen model      → quality signal (chosen beats all others)
//
// Runs iterative BT to fit strength parameters, then combines:
//   XD = Quality BT * 0.4 + Value BT * 0.4 + Stickiness bonus * 0.2

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const BASE_RATING = 1000
const BT_ITERATIONS = 50  // convergence iterations for MLE

// ── Bradley-Terry MLE ──
// Given pairwise win counts, compute strength parameters via iterative algorithm.
// wins[a][b] = number of times a beat b.
// Returns strength params scaled so average = BASE_RATING.
function bradleyTerry(
  modelIds: string[],
  wins: Record<string, Record<string, number>>,
): Record<string, number> {
  const n = modelIds.length
  if (n === 0) return {}

  // Initialize all strengths to 1.0
  const p: Record<string, number> = {}
  for (const id of modelIds) p[id] = 1.0

  // Iterative MLE update (MM algorithm)
  for (let iter = 0; iter < BT_ITERATIONS; iter++) {
    const newP: Record<string, number> = {}
    for (const i of modelIds) {
      let winsTotal = 0   // total wins for model i
      let denomSum = 0    // sum of n_ij / (p_i + p_j) for all opponents j

      for (const j of modelIds) {
        if (i === j) continue
        const wij = (wins[i]?.[j] || 0)  // i beat j
        const wji = (wins[j]?.[i] || 0)  // j beat i
        const nij = wij + wji             // total matches between i and j
        if (nij === 0) continue

        winsTotal += wij
        denomSum += nij / (p[i] + p[j])
      }

      // BT update: new p_i = wins_i / sum(n_ij / (p_i + p_j))
      newP[i] = denomSum > 0 ? winsTotal / denomSum : 1.0
    }

    // Normalize so geometric mean = 1
    const logSum = modelIds.reduce((s, id) => s + Math.log(newP[id] || 1), 0)
    const logMean = logSum / n
    for (const id of modelIds) {
      p[id] = (newP[id] || 1) / Math.exp(logMean)
    }
  }

  // Scale to rating centered at BASE_RATING using log scale (like Elo)
  // rating = BASE_RATING + 400 * log10(strength)
  const ratings: Record<string, number> = {}
  for (const id of modelIds) {
    ratings[id] = Math.round(BASE_RATING + 400 * Math.log10(p[id] || 1))
  }
  return ratings
}

interface ModelInfo {
  name: string
  provider: string
  priceLabel: string
  releasedAt: string | null
}

export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get('mode') || 'all'

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
  )

  // Load canonical model info from ai_models to get current provider names
  // and released_at dates. This also lets us skip models that no longer exist
  // (e.g. deleted openrouter rows).
  const { data: aiModels } = await sb
    .from('ai_models')
    .select('id, provider, model_name, display_name, released_at')

  // Lookup by model id (UUID) → canonical info. The map's `name` field is
  // the leaderboard display string; keep that key on the map so the rest
  // of this file (and any consumer) doesn't need to change.
  const canonicalById = new Map<string, { name: string; provider: string; releasedAt: string | null }>()
  // Also by model_name for slot matching (old slots may use model_name as id)
  const canonicalByName = new Map<string, { id: string; name: string; provider: string; releasedAt: string | null }>()
  for (const m of aiModels ?? []) {
    canonicalById.set(m.id, { name: m.display_name, provider: m.provider, releasedAt: m.released_at })
    canonicalByName.set(m.model_name, { id: m.id, name: m.display_name, provider: m.provider, releasedAt: m.released_at })
  }
  // Set of valid model IDs (only models currently in ai_models)
  const validModelIds = new Set([...canonicalById.keys()])

  // Pairwise win matrices for quality and value
  const qWins: Record<string, Record<string, number>> = {}  // quality (blind)
  const vWins: Record<string, Record<string, number>> = {}  // value (informed)
  const info: Record<string, ModelInfo> = {}
  const votes: Record<string, number> = {}
  // Stickiness tracking
  const timesVoted1: Record<string, number> = {}
  const timesRetained: Record<string, number> = {}

  const ensure = (id: string, m: ModelInfo) => {
    if (!(id in info)) {
      // Override with canonical info if available
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

  // Ties: each model gets 0.5 wins against the other
  const addTie = (matrix: Record<string, Record<string, number>>, a: string, b: string) => {
    if (!matrix[a]) matrix[a] = {}
    if (!matrix[b]) matrix[b] = {}
    matrix[a][b] = (matrix[a][b] || 0) + 0.5
    matrix[b][a] = (matrix[b][a] || 0) + 0.5
  }

  // ── 1. XDuel votes ──
  let duelQ = sb
    .from('duels')
    .select('mode, slots, vote1, vote2, vote1_model_id, vote2_model_id, vote_changed')

  if (mode !== 'all') duelQ = duelQ.eq('mode', mode)
  const { data: duels } = await duelQ

  if (duels) {
    for (const duel of duels) {
      const slots = ((duel.slots as any[]) || []).filter(Boolean)
      if (slots.length < 2) continue

      // Ensure all models — skip any that no longer exist in ai_models
      for (const slot of slots) {
        const id = slot.model_id || slot.id
        if (id && validModelIds.has(id)) {
          ensure(id, { name: slot.name, provider: slot.provider, priceLabel: slot.priceLabel || '', releasedAt: null })
        }
      }

      const slotIds = slots.map(s => s.model_id || s.id).filter((id): id is string => !!id && validModelIds.has(id))

      // ── Quality signal (vote1 — blind) ──
      if (duel.vote1 != null) {
        const isTie = duel.vote1 === 'T'
        const winnerId = duel.vote1_model_id

        for (const id of slotIds) votes[id]++

        for (let i = 0; i < slotIds.length; i++) {
          for (let j = i + 1; j < slotIds.length; j++) {
            const a = slotIds[i], b = slotIds[j]
            if (isTie) {
              addTie(qWins, a, b)
            } else if (winnerId === a) {
              addWin(qWins, a, b)
            } else if (winnerId === b) {
              addWin(qWins, b, a)
            } else {
              addTie(qWins, a, b)  // neither won this pair in multi-model duel
            }
          }
        }
      }

      // ── Value signal (vote2 — informed / post-price) ──
      if (duel.vote2 != null) {
        const isTie = duel.vote2 === 'T'
        const winnerId = duel.vote2_model_id

        for (const id of slotIds) votes[id]++

        for (let i = 0; i < slotIds.length; i++) {
          for (let j = i + 1; j < slotIds.length; j++) {
            const a = slotIds[i], b = slotIds[j]
            if (isTie) {
              addTie(vWins, a, b)
            } else if (winnerId === a) {
              addWin(vWins, a, b)
            } else if (winnerId === b) {
              addWin(vWins, b, a)
            } else {
              addTie(vWins, a, b)
            }
          }
        }
      }

      // ── Stickiness ──
      if (duel.vote1 != null && duel.vote2 != null && duel.vote1 !== 'T') {
        const v1Winner = duel.vote1_model_id
        if (v1Winner && v1Winner in info) {
          timesVoted1[v1Winner]++
          if (!duel.vote_changed) {
            timesRetained[v1Winner]++
          }
        }
      }
    }
  }

  // ── 2. XCreate implicit votes (Quality only) ──
  let xcQ = sb
    .from('xcreates')
    .select('mode, slots, chosen_model_id')
    .not('chosen_model_id', 'is', null)

  if (mode !== 'all') xcQ = xcQ.eq('mode', mode)
  const { data: xcreates } = await xcQ

  if (xcreates) {
    for (const xc of xcreates) {
      const slots = ((xc.slots as any[]) || []).filter(Boolean)
      if (slots.length < 2) continue

      const chosenId = xc.chosen_model_id

      for (const slot of slots) {
        const id = slot.model_id || slot.id
        if (id && validModelIds.has(id)) {
          ensure(id, { name: slot.name, provider: slot.provider, priceLabel: slot.priceLabel || '', releasedAt: null })
        }
      }

      // Dedupe slot ids — same model in multiple slots (e.g. user comparing
      // gpt-image-2 at low vs high quality) is one model from the leaderboard's
      // perspective. Bradley-Terry tracks model identity, not per-config
      // preference, so the duplicates would otherwise either:
      //   • produce no rank signal (all-same-model run, harmless), OR
      //   • double-count a loss when the chosen model is the unique one
      //     (otherIds keeps every duplicate of the loser → addWin fires
      //     twice for the same vote).
      // Collapsing to a Set fixes both. Runs without duplicates are unaffected.
      const slotIdsRaw = slots
        .map(s => s.model_id || s.id)
        .filter((id): id is string => !!id && validModelIds.has(id))
      const slotIds = Array.from(new Set(slotIdsRaw))
      if (slotIds.length < 2) continue   // all-same-model run → no signal

      for (const id of slotIds) votes[id]++

      // Chosen model beats every other distinct model
      const otherIds = slotIds.filter(id => id !== chosenId)
      for (const otherId of otherIds) {
        addWin(qWins, chosenId, otherId)
      }
    }
  }

  // ── Run Bradley-Terry MLE for quality and value ──
  const modelIds = Object.keys(info)
  // Only include models that have at least 1 vote
  const activeIds = modelIds.filter(id => votes[id] >= 1)

  const qRatings = bradleyTerry(activeIds, qWins)
  const vRatings = bradleyTerry(activeIds, vWins)

  // ── Build final XD rating ──
  // XD = Quality BT * 0.4 + Value BT * 0.4 + Stickiness bonus * 0.2
  const result = activeIds
    .map(modelId => {
      const sRate = timesVoted1[modelId] > 0
        ? timesRetained[modelId] / timesVoted1[modelId]
        : null
      // Stickiness → rating scale: 0% retention → 600, 50% → 1000, 100% → 1400
      const sRating = sRate !== null ? 600 + sRate * 800 : BASE_RATING

      const qR = qRatings[modelId] ?? BASE_RATING
      const vR = vRatings[modelId] ?? BASE_RATING
      const xdScore = Math.round(qR * 0.4 + vR * 0.4 + sRating * 0.2)

      return {
        modelId,
        name: info[modelId].name,
        provider: info[modelId].provider,
        priceLabel: info[modelId].priceLabel,
        releasedAt: info[modelId].releasedAt,
        xdScore,
        totalVotes: votes[modelId],
      }
    })
    .sort((a, b) => b.xdScore - a.xdScore || b.totalVotes - a.totalVotes)

  return NextResponse.json(result)
}
