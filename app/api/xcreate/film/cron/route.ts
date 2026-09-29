// app/api/xcreate/film/cron/route.ts — every minute (vercel.json): one drive
// pass for each film still being made, so a film keeps moving after its page
// is closed. Under /api/xcreate/ so the www password gate lets Vercel's cron
// through (proxy.ts isBypassed); CRON_SECRET is what guards it.
//
// Manual run:
//   curl -H "Authorization: Bearer $CRON_SECRET" https://www.modelxd.com/api/xcreate/film/cron

export const runtime = 'nodejs'
export const maxDuration = 800

import { NextRequest, NextResponse } from 'next/server'
import { activeFilmIds, driveFilm } from '@/lib/film/driver'

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 })
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const ids = await activeFilmIds()
  await Promise.all(ids.map(id => driveFilm(id).catch(e => console.error(`[film] ${id} cron pass failed:`, e))))
  return NextResponse.json({ driven: ids.length })
}
