// app/api/xtell/chart/route.ts — compute a chart. Free: pure computation,
// no tokens, no credits. The client renders the result and the USER confirms
// it before any reading is bought — the chart is the part they can verify
// against any 排盤 site, so it is shown before money moves.

export const runtime = 'nodejs'

import { createSupabaseServer } from '@/lib/supabase-server'
import { baziChart, ziweiChart, validBirth, type Temple } from '@/lib/xtell'

export async function POST(req: Request) {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const temple: Temple = body?.temple === 'ziwei' ? 'ziwei' : 'bazi'
  if (!validBirth(body?.birth)) return Response.json({ error: 'bad birth input' }, { status: 400 })

  try {
    const chart = temple === 'ziwei' ? ziweiChart(body.birth) : baziChart(body.birth)
    return Response.json({ temple, chart })
  } catch (e: any) {
    console.error('[xtell/chart]', e?.message ?? e)
    return Response.json({ error: 'chart computation failed' }, { status: 500 })
  }
}
