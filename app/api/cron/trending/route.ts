// app/api/cron/trending/route.ts
//
// Weekly "Trending on social media" search (vercel.json: Mondays 01:00 UTC,
// 09:00 Taipei). Runs lib/trending-job for each enabled kind and stores the
// candidates as 'pending'; the owner publishes up to 20 at /admin/trending.
// Paid (Grok x_search, ~$1–2 a run, guarded by a monthly budget), so it
// fails closed without CRON_SECRET, like sweep-orphans.
//
// Manual run:
//   curl -H "Authorization: Bearer $CRON_SECRET" https://www.modelxd.com/api/cron/trending

import { NextRequest, NextResponse } from 'next/server'
import { enabledKinds, runTrending, type RunReport } from '@/lib/trending-job'

export const maxDuration = 800

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 })
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const reports: RunReport[] = []
  const errors: string[] = []
  for (const kind of enabledKinds()) {
    try {
      const r = await runTrending(kind)
      reports.push(r)
      console.log(`[cron/trending] ${kind} week=${r.week} found=${r.found} inserted=${r.inserted} already=${r.alreadyListed} dropped=${r.dropped.length} cost=$${r.costUsd.toFixed(3)}`)
    } catch (err) {
      errors.push(`${kind}: ${(err as Error).message}`)
      console.error(`[cron/trending] ${kind} failed:`, (err as Error).message)
    }
  }
  return NextResponse.json({ reports, errors }, { status: errors.length && !reports.length ? 500 : 200 })
}

export async function GET(req: NextRequest)  { return handle(req) }
export async function POST(req: NextRequest) { return handle(req) }
