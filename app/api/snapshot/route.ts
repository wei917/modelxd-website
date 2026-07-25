// app/api/snapshot/route.ts
//
// The landing page's value snapshot: the best-value model per mode, i.e.
// the top of XBoard by XD Score for text / image / video.
//
// Why not just call /api/xboard three times: that returns a full leaderboard
// per mode and this is the busiest page on the site. One query for the three
// modes, one for the model names, and we keep only the winners.
//
// Enabled-only, matching /api/xboard — a model users can't pick shouldn't
// headline the landing page even if its historical rating still leads.

export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const MODES = ['text', 'image', 'video'] as const
type Mode = (typeof MODES)[number]

export type SnapshotEntry = { name: string; modelName: string; provider: string; xdScore: number }
export type Snapshot = Record<Mode, SnapshotEntry | null>

const EMPTY: Snapshot = { text: null, image: null, video: null }

/**
 * INTERIM nickname derivation, two rules, both keyed off naming patterns
 * that actually hold across the catalogue:
 *
 *   "Nano Banana 2 - Gemini 3.1 Flash Image"  -> "Nano Banana 2"
 *   "HappyHorse 1.0 Text to Video"            -> "HappyHorse 1.0"
 *
 * The second strips a trailing "<X> to <Y>" modality suffix, which is a
 * recipe descriptor rather than part of the name — the bar already states
 * the mode next to it, so repeating it is pure noise.
 *
 * Cost of rule two: the three HappyHorse variants (Text/Image/Reference to
 * Video) all collapse to "HappyHorse 1.0", so the bar no longer says WHICH
 * variant is winning. Fine for a headline; not fine everywhere. A nullable
 * ai_models.short_name would let each row say what it wants and make both
 * rules unnecessary.
 */
const MODALITY_SUFFIX = /\s+(?:text|image|video|reference|pdf|audio)\s+to\s+(?:text|image|video|audio)$/i

function shortName(displayName: string): string {
  return displayName.split(' - ')[0].replace(MODALITY_SUFFIX, '').trim()
}

export async function GET() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  )

  const result: Snapshot = { ...EMPTY }

  try {
    const [{ data: ratings, error: rErr }, { data: models, error: mErr }] = await Promise.all([
      sb.from('model_ratings')
        .select('model_id, mode, xd_score, total_votes')
        .in('mode', MODES as unknown as string[])
        .order('xd_score', { ascending: false })
        .order('total_votes', { ascending: false }),
      sb.from('ai_models').select('id, display_name, model_name, provider').eq('enabled', true),
    ])
    if (rErr) throw new Error(rErr.message)
    if (mErr) throw new Error(mErr.message)

    const byId = new Map((models ?? []).map(m => [m.id, m]))
    // Rows arrive sorted, so the first enabled hit per mode is the winner.
    for (const row of ratings ?? []) {
      const mode = row.mode as Mode
      if (!MODES.includes(mode) || result[mode]) continue
      const m = byId.get(row.model_id)
      if (!m) continue
      result[mode] = { name: shortName(m.display_name), modelName: m.model_name, provider: m.provider, xdScore: row.xd_score }
    }
  } catch (err) {
    // A decorative strip must never take the landing page down with it.
    console.warn('[snapshot] read failed:', err instanceof Error ? err.message : err)
    return NextResponse.json(EMPTY, { headers: { 'Cache-Control': 'no-store' } })
  }

  return NextResponse.json(result, {
    // The ratings only move when /api/xdrating/refit runs (cron, every 5
    // min), so a 60s edge cache is real-time against the underlying data
    // while keeping the landing page off the database on every hit.
    headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
  })
}
