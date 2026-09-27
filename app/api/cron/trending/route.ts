// app/api/cron/trending/route.ts
//
// Weekly "Trending on social media" search (vercel.json: Mondays 01:00 UTC,
// 09:00 Taipei). Runs lib/trending-job for each enabled kind and stores the
// candidates as 'pending'; the owner publishes up to 20 at /admin/trending.
// Each weekly run searches the most recent 30 days.
// Paid (Grok x_search, up to six searches over the models XCreate offers; a
// search can't be capped and one has cost $3.34), guarded by a monthly
// budget, so it fails closed without CRON_SECRET, like sweep-orphans.
//
// Manual run:
//   curl -H "Authorization: Bearer $CRON_SECRET" https://www.modelxd.com/api/cron/trending

import { NextRequest, NextResponse } from 'next/server'
import { enabledKinds, runTrendingKinds } from '@/lib/trending-job'

export const maxDuration = 800

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 })
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Every kind in one parallel run (lib/trending-job: searches <= 480s, post
  // checks <= 120s), so video + image finish inside maxDuration together.
  let reports: Awaited<ReturnType<typeof runTrendingKinds>>['reports'] = []
  let errors: string[] = []
  try {
    ;({ reports, errors } = await runTrendingKinds(enabledKinds()))
  } catch (err) {
    errors = [(err as Error).message]
  }
  for (const r of reports) console.log(`[cron/trending] ${r.kind} week=${r.week} found=${r.found} inserted=${r.inserted} already=${r.alreadyListed} dropped=${r.dropped.length} cost=$${r.costUsd.toFixed(3)}${r.costUnknown ? ` +${r.costUnknown} unknown` : ''}${r.deferred.length ? ` deferred by budget: ${r.deferred.join(' | ')}` : ''}`)
  for (const e of errors) console.error(`[cron/trending] failed: ${e}`)
  return NextResponse.json({ reports, errors }, { status: errors.length && !reports.length ? 500 : 200 })
}

export async function GET(req: NextRequest)  { return handle(req) }
export async function POST(req: NextRequest) { return handle(req) }
