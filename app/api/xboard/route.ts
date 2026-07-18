// app/api/xboard/route.ts
// XBoard read path — serves the model_ratings snapshot.
//
// The rating pipeline (docs/xdrating-pipeline.md):
//   votes → DB triggers → aggregate tables → /api/xdrating/refit → model_ratings
// This route is now a thin indexed read. If the snapshot is empty or the
// table doesn't exist yet (migration not run), it falls back to the legacy
// full-scan computation in lib/xdrating.ts so XBoard never blanks.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { computeLiveLeaderboard, type LeaderboardRow } from '@/lib/xdrating'

export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get('mode') || 'all'

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
  )

  const { data: snapshot, error } = await sb
    .from('model_ratings')
    .select('model_id, xd_score, total_votes, price_label')
    .eq('mode', mode)
    .order('xd_score', { ascending: false })
    .order('total_votes', { ascending: false })

  if (!error && snapshot && snapshot.length > 0) {
    // Join canonical model info (same source the legacy path used).
    const { data: aiModels } = await sb
      .from('ai_models')
      .select('id, provider, display_name, released_at')
    const byId = new Map((aiModels ?? []).map(m => [m.id, m]))

    const result: LeaderboardRow[] = snapshot
      .filter(r => byId.has(r.model_id))   // drop models deleted since last refit
      .map(r => {
        const m = byId.get(r.model_id)!
        return {
          modelId:    r.model_id,
          name:       m.display_name,
          provider:   m.provider,
          priceLabel: r.price_label ?? '',
          releasedAt: m.released_at,
          xdScore:    r.xd_score,
          totalVotes: Number(r.total_votes),
        }
      })
    return NextResponse.json(result)
  }

  // Fallback: snapshot missing/empty → legacy live computation.
  if (error) console.warn('[xboard] snapshot read failed, using live fallback:', error.message)
  else console.warn('[xboard] snapshot empty, using live fallback (run xd_rebuild_aggregates + refit)')
  const result = await computeLiveLeaderboard(sb, mode)
  return NextResponse.json(result)
}
