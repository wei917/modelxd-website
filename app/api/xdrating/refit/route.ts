// app/api/xdrating/refit/route.ts
//
// Recompute the model_ratings snapshot from the aggregate tables.
// See docs/xdrating-pipeline.md.
//
// Callers:
//   • /api/xduel/vote        — awaited after each duel vote write
//   • XCreate pickModel      — fire-and-forget from the client
//   • Vercel cron            — GET ?source=cron every 5 min (backstop)
//   • manual                 — ?force=1 to bypass the 10s throttle
//
// The endpoint is deliberately unauthenticated: it takes no input, only
// recomputes public data, and the 10s throttle bounds the work an abuser
// can cause to one O(models²) fit per 10 seconds.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { maybeRefit } from '@/lib/xdrating'

async function handle(req: NextRequest) {
  const source = req.nextUrl.searchParams.get('source') ?? 'manual'
  const force  = req.nextUrl.searchParams.get('force') === '1'
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
  )
  try {
    const result = await maybeRefit(sb, source, force)
    return NextResponse.json(result)
  } catch (err) {
    // Aggregate tables missing (migration not run yet) lands here — report
    // instead of 500ing so callers' fire-and-forget kicks stay silent.
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[xdrating/refit] failed:', msg)
    return NextResponse.json({ ran: false, error: msg }, { status: 200 })
  }
}

export async function POST(req: NextRequest) { return handle(req) }
export async function GET(req: NextRequest)  { return handle(req) }
