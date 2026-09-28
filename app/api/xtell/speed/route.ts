// app/api/xtell/speed/route.ts — how soon each teacher starts answering, for
// the seats in a temple room (owner, Sep 27: "how about TTFT besides
// money?").
//
// The numbers are model_latency's (supabase/95, written by
// scripts/probe-latency.ts): the median seconds to the first VISIBLE token,
// per model and thinking level, over at least three probe runs. The table
// itself stays closed to browsers; only these medians leave, rounded to a
// tenth of a second. A short probe prompt, so a real reading (a chart and a
// long system prompt) starts somewhat later; the seats say "about".

export const runtime = 'nodejs'

import { xtellAdmin } from '@/lib/xtell-admin'

export async function GET() {
  const { data, error } = await xtellAdmin().from('model_latency').select('model_id, effort, ttft_s, samples').gte('samples', 3)
  if (error) {
    console.warn('[xtell/speed]', error.message)
    return Response.json({ speeds: {} })
  }
  const speeds: Record<string, Record<string, number>> = {}
  for (const r of data ?? []) {
    if (typeof r.ttft_s !== 'number' || !(r.ttft_s > 0)) continue
    ;(speeds[r.model_id] ??= {})[r.effort ?? ''] = Math.round(r.ttft_s * 10) / 10
  }
  return Response.json({ speeds }, { headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600' } })
}
