// GET /api/v1/router/preview?quality=..&cost=..&speed=..
//
// What the router WOULD pick for a set of weights, without calling a model or
// spending anything. Powers the tuning panel on XDev.
//
// It ranks the same candidates through the same rank() the live routes use, so
// the panel cannot show a developer one model while the API serves another —
// that would make a tool built to explain the router into a way to be wrong
// about it.
//
// SECRET: total_votes never leaves the server. routerCandidates() reads it to
// apply the vote floor and does not carry it onto a Candidate, so there is
// nothing to leak here. Sample sizes are not published (owner rule).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { routerCandidates } from '@/lib/inference'
import { PRESETS, rank, type Weights } from '@/lib/router-weights'
import { getModelById } from '@/lib/models'

const clamp01 = (v: string | null, fallback: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback
}

export async function GET(req: Request) {
  const url = new URL(req.url)

  // A named preset can be asked for directly, so the panel's preset chips and
  // the API's own routes are provably the same thing.
  const presetId = url.searchParams.get('preset')
  const preset = presetId ? PRESETS[presetId] : null
  if (presetId && !preset) {
    return Response.json({ error: { message: `Unknown preset \`${presetId}\`.`, type: 'invalid_request_error' } }, { status: 400 })
  }

  const weights: Weights = preset ? preset.weights : {
    quality: clamp01(url.searchParams.get('quality'), 0.5),
    cost:    clamp01(url.searchParams.get('cost'), 0.3),
    speed:   clamp01(url.searchParams.get('speed'), 0.2),
  }
  const useFloor = preset ? preset.floor : url.searchParams.get('floor') !== '0'

  const { candidates, floorQuality } = await routerCandidates()
  if (!candidates.length) return Response.json({ weights, floor: useFloor, data: [] })

  const inPool = useFloor ? candidates.filter(c => (c.quality ?? 0) >= floorQuality) : candidates
  const ranked = rank(inPool.length ? inPool : candidates, weights)

  const data = await Promise.all(ranked.map(async r => {
    const m = await getModelById(r.model_id)
    return {
      id: m ? `${m.provider}/${m.model_name}` : r.model_id,
      display_name: m?.display_name ?? null,
      provider: m?.provider ?? null,
      score: Number(r.score.toFixed(4)),
      // The axis values behind the score, so the panel can explain a winner
      // instead of asserting one.
      quality: r.quality,
      price_per_1m: r.pricePer1m,
      ttft_s: r.ttftS,
      parts: {
        quality: Number(r.parts.quality.toFixed(3)),
        cost: Number(r.parts.cost.toFixed(3)),
        speed: Number(r.parts.speed.toFixed(3)),
      },
    }
  }))

  return Response.json({
    weights, floor: useFloor, floor_quality: useFloor ? Math.round(floorQuality) : null,
    preset: presetId ?? null, data,
  })
}
