// app/api/admin/trending/route.ts
// Admin-only actions behind /admin/trending:
//   { action: 'publish', week, ids }  the chosen rows of that week go live,
//                                     ranked by likes per kind (20 max per
//                                     kind); every other row of the week is
//                                     hidden.
//   { action: 'run', kind }           a search now, same code and monthly
//                                     budget as the Monday cron (paid).

import { NextRequest, NextResponse } from 'next/server'
import { assertAdmin } from '@/lib/admin'
import { runTrending, serviceClient, type TrendKind } from '@/lib/trending-job'

export const maxDuration = 800

const MAX_LIVE = 20

export async function POST(req: NextRequest) {
  const guard = await assertAdmin()
  if (guard) return guard

  const body = await req.json().catch(() => ({}))
  const sb = serviceClient()

  if (body.action === 'run') {
    const kind: TrendKind = body.kind === 'image' ? 'image' : 'video'
    try {
      return NextResponse.json({ report: await runTrending(kind) })
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 })
    }
  }

  if (body.action === 'publish') {
    const week = String(body.week ?? '')
    const ids: string[] = Array.isArray(body.ids) ? body.ids.map(String) : []
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) return NextResponse.json({ error: 'bad week' }, { status: 400 })

    const { data: rows, error } = await sb.from('trending_posts').select('id, kind, likes').eq('week', week)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const chosen = new Set(ids)
    const updates: { id: string; status: string; rank: number | null }[] = []
    for (const kind of ['video', 'image']) {
      const ofKind = (rows ?? []).filter(r => r.kind === kind)
      const live = ofKind.filter(r => chosen.has(r.id)).sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0))
      if (live.length > MAX_LIVE) {
        return NextResponse.json({ error: `${live.length} ${kind} posts chosen; the list holds ${MAX_LIVE}.` }, { status: 400 })
      }
      live.forEach((r, i) => updates.push({ id: r.id, status: 'live', rank: i + 1 }))
      ofKind.filter(r => !chosen.has(r.id)).forEach(r => updates.push({ id: r.id, status: 'hidden', rank: null }))
    }
    const now = new Date().toISOString()
    for (const u of updates) {
      const { error: e } = await sb.from('trending_posts')
        .update({ status: u.status, rank: u.rank, updated_at: now }).eq('id', u.id)
      if (e) return NextResponse.json({ error: e.message }, { status: 500 })
    }
    return NextResponse.json({ live: updates.filter(u => u.status === 'live').length, hidden: updates.filter(u => u.status === 'hidden').length })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
