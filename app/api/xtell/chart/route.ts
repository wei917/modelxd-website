// app/api/xtell/chart/route.ts — compute a chart. Free: pure computation,
// no tokens, no credits. The client renders the result and the USER confirms
// it before any reading is bought — the chart is the part they can verify
// against any 排盤 site, so it is shown before money moves.
//
// 關帝廟 has no chart: the input is the stick number the ritual produced,
// and the "chart" is the poem loaded from disk. 四面佛 is a 八字 chart plus
// this year's 流年 read against it.

export const runtime = 'nodejs'

import { createSupabaseServer } from '@/lib/supabase-server'
import { baziChart, ziweiChart, heMatch, liuNian, qianOf, navagrahaChart, zhanxingChart, asAstroMode, validBirth, validQian, isQianTemple, validWishes, validPlace, asTemple, nameChart, validName, charInfo, validChar, ENGINES } from '@/lib/xtell'

export async function POST(req: Request) {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const temple = asTemple(body?.temple)

  if (isQianTemple(temple)) {
    if (!validQian(body?.n, temple)) return Response.json({ error: 'bad stick number' }, { status: 400 })
    const qian = qianOf(body.n, temple)
    if (!qian) return Response.json({ error: 'stick not in corpus' }, { status: 500 })
    // Optional 稟告: a birth turns into the same 八字 + 流年 the 四面佛 gets,
    // shown under the stick and handed to the master for reference.
    if (body?.birth !== undefined && !validBirth(body.birth)) return Response.json({ error: 'bad birth input' }, { status: 400 })
    const bz = validBirth(body?.birth) ? baziChart(body.birth) : null
    const year = bz ? liuNian(bz, body.birth.y, new Date().getFullYear()) : undefined
    return Response.json({ temple, chart: qian, bazi: bz ?? undefined, year, engine: ENGINES[temple] })
  }

  // 姓名亭 and 測字亭 start from characters, not a birth.
  if (temple === 'xingming') {
    if (!validName(body?.surname) || !validName(body?.given)) return Response.json({ error: 'bad name' }, { status: 400 })
    try { return Response.json({ temple, chart: nameChart(body.surname, body.given), engine: ENGINES[temple] }) }
    catch (e: any) { return Response.json({ error: e?.message ?? 'no stroke data' }, { status: 400 }) }
  }
  if (temple === 'cezi') {
    if (!validChar(body?.ch)) return Response.json({ error: 'write exactly one character' }, { status: 400 })
    const info = charInfo(body.ch)
    if (!info) return Response.json({ error: `no data for ${body.ch}` }, { status: 400 })
    return Response.json({ temple, chart: info, engine: ENGINES[temple] })
  }

  if (!validBirth(body?.birth)) return Response.json({ error: 'bad birth input' }, { status: 400 })
  if (temple === 'yuelao' && !validBirth(body?.birth2)) return Response.json({ error: 'bad birth input (second person)' }, { status: 400 })
  if (temple === 'simianfo' && !validWishes(body?.wishes)) return Response.json({ error: 'write at least one wish' }, { status: 400 })
  if (temple === 'navagraha' && !validPlace(body?.place)) return Response.json({ error: 'bad place' }, { status: 400 })
  // 占星塔 needs a place for the same reason 九曜廟 does — no houses without
  // one — and its 配對 room needs a whole second person.
  const mode = asAstroMode(body?.mode)
  if (temple === 'zhanxing') {
    if (!validPlace(body?.place)) return Response.json({ error: 'bad place' }, { status: 400 })
    if (mode === 'synastry') {
      if (!validBirth(body?.birth2)) return Response.json({ error: 'bad birth input (second person)' }, { status: 400 })
      if (!validPlace(body?.place2)) return Response.json({ error: 'bad place (second person)' }, { status: 400 })
    }
  }

  try {
    // 月老廟 is two BaZi charts — the engine run twice, labeled a and b.
    const chart = temple === 'zhanxing'
      ? zhanxingChart(body.birth, body.place, mode, { b2: body.birth2, place2: body.place2, year: Number(body.year) || undefined })
      : temple === 'ziwei' ? ziweiChart(body.birth)
      : temple === 'navagraha' ? navagrahaChart(body.birth, body.place)
      : temple === 'yuelao' ? { a: baziChart(body.birth), b: baziChart(body.birth2) }
      : baziChart(body.birth)
    // 月老廟 also gets its 合盤 here, because it is the same kind of thing as a
    // chart: pure computation, free, and shown before any reading is bought.
    const match = temple === 'yuelao'
      ? heMatch((chart as any).a, (chart as any).b, new Date().getFullYear())
      : undefined
    // 四面佛: this year's 流年 against the chart, the one computed thing the
    // master is allowed to say about "which face the year favours".
    const year = temple === 'simianfo'
      ? liuNian(chart as any, body.birth.y, new Date().getFullYear())
      : undefined
    return Response.json({ temple, chart, match, year, engine: ENGINES[temple] })
  } catch (e: any) {
    console.error('[xtell/chart]', e?.message ?? e)
    return Response.json({ error: 'chart computation failed' }, { status: 500 })
  }
}
