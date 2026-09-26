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
import { baziChart, ziweiChart, heMatch, liuNian, qianOf, navagrahaChart, zhanxingChart, asAstroMode, validBirth, validQian, isQianTemple, validWishes, validPlace, asTemple, type Temple, nameChart, validName, charInfo, validChar, ENGINES } from '@/lib/xtell'
import { yixueChart, yixueInputError } from '@/lib/yijing'

// The subject is what the client sent, reduced to the keys the routes read,
// so a saved reading can be recomputed later exactly as it was cast.
const SUBJECT_KEYS = ['birth', 'birth2', 'n', 'ask', 'name', 'city', 'wishes', 'place', 'place2', 'mode', 'year', 'surname', 'given', 'gender', 'ch', 'lines', 'coins'] as const
function subjectOf(body: any) {
  const out: Record<string, unknown> = {}
  for (const k of SUBJECT_KEYS) if (body?.[k] !== undefined) out[k] = body[k]
  return out
}

// Every visit is saved (owner, Sep 24: people paid for these). The row is
// created here, when the chart is cast, under the visitor's own session and
// RLS (supabase/105); the reading route appends the turns. A save failure
// never blocks the chart — the visitor still gets what they came for and the
// server log says why (typically: migration 105 not applied yet).
async function save(sb: Awaited<ReturnType<typeof createSupabaseServer>>, userId: string, temple: Temple, body: any, chart: unknown, extras: Record<string, unknown>, title?: string) {
  try {
    const clean = Object.fromEntries(Object.entries(extras).filter(([, v]) => v !== undefined))
    const subject = subjectOf(body)
    // Recasting the same chart is not a new visit. If a row with the same
    // inputs exists and nobody has asked anything in it yet, hand that one
    // back instead of inserting another (owner, Sep 24: seven rows for one
    // afternoon of the same 紫微 chart). A row that already holds a
    // conversation stays as it is; the history list offers Continue for it.
    // Compared in code, not in the query: a jsonb equality filter through
    // PostgREST does not match reliably (key order, serialisation), and the
    // candidate set is tiny — the visitor's last ten rows in this temple.
    const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x)) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x)
    const want = canon(subject)
    const { data: recent } = await sb.from('xtell_readings')
      .select('id, turns, subject').eq('user_id', userId).eq('temple', temple).is('deleted_at', null)
      .order('created_at', { ascending: false }).limit(10)
    const reusable = (recent ?? []).find(r => (!Array.isArray(r.turns) || r.turns.length === 0) && canon(r.subject) === want)
    if (reusable) {
      await sb.from('xtell_readings').update({ chart, extras: Object.keys(clean).length ? clean : null, updated_at: new Date().toISOString() }).eq('id', reusable.id)
      return reusable.id as string
    }
    const { data, error } = await sb.from('xtell_readings')
      // A title given here stays: xtell_append_turns only fills an empty one.
      .insert({ user_id: userId, temple, subject, chart, extras: Object.keys(clean).length ? clean : null, ...(title ? { title: title.slice(0, 80) } : {}) })
      .select('id').single()
    if (error) throw error
    return data.id as string
  } catch (e: any) {
    console.warn('[xtell/chart] save failed:', e?.message ?? e)
    return null
  }
}

export async function POST(req: Request) {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const temple = asTemple(body?.temple)

  // 易學堂: no birth. A cast (six line values and the one matter asked), a
  // lookup (a hexagram number) or a learner's visit with no hexagram. A cast
  // is titled by its matter, so the history lists say what it was about.
  if (temple === 'yixue') {
    const bad = yixueInputError(body)
    if (bad) return Response.json({ error: bad }, { status: 400 })
    try {
      const chart = yixueChart(body)
      const readingId = await save(sb, user.id, temple, body, chart, {}, chart.mode === 'cast' ? chart.ask : undefined)
      return Response.json({ temple, chart, engine: ENGINES[temple], readingId })
    } catch (e: any) {
      console.error('[xtell/chart] yixue', e?.message ?? e)
      return Response.json({ error: 'hexagram text unavailable' }, { status: 500 })
    }
  }

  if (isQianTemple(temple)) {
    if (!validQian(body?.n, temple)) return Response.json({ error: 'bad stick number' }, { status: 400 })
    const qian = qianOf(body.n, temple)
    if (!qian) return Response.json({ error: 'stick not in corpus' }, { status: 500 })
    // Optional 稟告: a birth turns into the same 八字 + 流年 the 四面佛 gets,
    // shown under the stick and handed to the master for reference.
    if (body?.birth !== undefined && !validBirth(body.birth)) return Response.json({ error: 'bad birth input' }, { status: 400 })
    const bz = validBirth(body?.birth) ? baziChart(body.birth) : null
    const year = bz ? liuNian(bz, body.birth.y, new Date().getFullYear()) : undefined
    const readingId = await save(sb, user.id, temple, body, qian, { bazi: bz ?? undefined, year })
    return Response.json({ temple, chart: qian, bazi: bz ?? undefined, year, engine: ENGINES[temple], readingId })
  }

  // 姓名亭 and 測字亭 start from characters, not a birth.
  if (temple === 'xingming') {
    if (!validName(body?.surname) || !validName(body?.given)) return Response.json({ error: 'bad name' }, { status: 400 })
    try {
      const chart = nameChart(body.surname, body.given)
      const readingId = await save(sb, user.id, temple, body, chart, {})
      return Response.json({ temple, chart, engine: ENGINES[temple], readingId })
    } catch (e: any) { return Response.json({ error: e?.message ?? 'no stroke data' }, { status: 400 }) }
  }
  if (temple === 'cezi') {
    if (!validChar(body?.ch)) return Response.json({ error: 'write exactly one character' }, { status: 400 })
    const info = charInfo(body.ch)
    if (!info) return Response.json({ error: `no data for ${body.ch}` }, { status: 400 })
    const readingId = await save(sb, user.id, temple, body, info, {})
    return Response.json({ temple, chart: info, engine: ENGINES[temple], readingId })
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
    const readingId = await save(sb, user.id, temple, body, chart, { match, year })
    return Response.json({ temple, chart, match, year, engine: ENGINES[temple], readingId })
  } catch (e: any) {
    console.error('[xtell/chart]', e?.message ?? e)
    return Response.json({ error: 'chart computation failed' }, { status: 500 })
  }
}
