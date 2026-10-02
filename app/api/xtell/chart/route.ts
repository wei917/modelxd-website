// app/api/xtell/chart/route.ts — compute a chart. Free: pure computation,
// no tokens, no credits. The client renders the result and the USER confirms
// it before any reading is bought — the chart is the part they can verify
// against any 排盤 site, so it is shown before money moves.
//
// Signed out (owner, Oct 1), the free chart is cast too, and not saved: no
// account to keep it under. 解夢 and the fortune cookie still need a
// session, because their free step calls a model on our account
// (lib/xtell-guest.ts). 孫子兵法 does too, but since Oct 2 a signed-out
// visitor gets GUEST_SUNZI_PER_DAY lookups a day from one address.
//
// 關帝廟 has no chart: the input is the stick number the ritual produced,
// and the "chart" is the poem loaded from disk. 四面佛 is a 八字 chart plus
// this year's 流年 read against it. 八字廟 also weighs the birth (稱骨).

export const runtime = 'nodejs'

import { createSupabaseServer } from '@/lib/supabase-server'
import { baziChart, chengGu, ziweiChart, heMatch, liuNian, qianOf, navagrahaChart, zhanxingChart, asAstroMode, validBirth, birthProblem, validQian, isQianTemple, validWishes, validPlace, asTemple, type Temple, nameChart, validName, charInfo, validChar, ENGINES, asQianEdition } from '@/lib/xtell'
import { asSpread, asOptions, validPicks, tarotChart, ASK_MAX as TAROT_ASK_MAX } from '@/lib/tarot'
import { cookieProblem, mealOf, mealKey, shichenOf, cookieFacts, pickBrief, parsePick, FREE_PER_MEAL, EXTRA_CENTS, ASK_MAX as COOKIE_ASK_MAX } from '@/lib/xtell-cookie'
import { cookieFortunes, fortuneOf, fortuneTexts } from '@/lib/xtell-cookie-fortunes'
import { dailyText } from '@/lib/xtell-daily-model'
import { debitCredits, grantCredits, InsufficientCreditsError } from '@/lib/credits'
import { almanacFor } from '@/lib/xtell-almanac'
import { yixueChart, yixueInputError } from '@/lib/yijing'
import { dreamEntries, dreamProblem, dreamLang, ASK_MAX, SCANS_PER_DAY } from '@/lib/jiemeng'
import { scanDream } from '@/lib/jiemeng-scan'
import { situationProblem, sunziLines, glossLang, ASK_MAX as SUNZI_ASK_MAX, SCANS_PER_DAY as SUNZI_PER_DAY } from '@/lib/sunzi'
import { scanSituation } from '@/lib/sunzi-scan'
import { kyuseiChart, asToday } from '@/lib/kyusei'
import { sukuyoChart, asPartnerDate } from '@/lib/sukuyo'

// Every refusal carries a stable `code` the client turns into a sentence in
// the visitor's language, next to the field it is about (audit F05: 「bad
// name」 and 「write at least one wish」 reached a 繁體 page raw). `error`
// stays English for logs and older clients.
const refuse = (code: string, error: string, status = 400) => Response.json({ error, code }, { status })
/** 孫子兵法 for a signed-out visitor (Oct 2): its lookup is a model call we
 *  pay for, so a few a day from one address. Counted in memory, per server
 *  instance: a floor like the site agent's, not a wall. */
const GUEST_SUNZI_PER_DAY = 3
const guestScans = new Map<string, { n: number; reset: number }>()
function guestScanAllowed(req: Request): boolean {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
  const now = Date.now()
  if (guestScans.size > 5000) for (const [k, g] of guestScans) if (g.reset < now) guestScans.delete(k)
  const g = guestScans.get(ip)
  if (!g || g.reset < now) { guestScans.set(ip, { n: 1, reset: now + 86_400_000 }); return true }
  return ++g.n <= GUEST_SUNZI_PER_DAY
}

/** Temples whose chart cannot exist without the birth hour. */
const HOUR_REQUIRED = new Set<Temple>(['ziwei', 'navagraha'])
/** A birth that does not exist or cannot be charted (audit F01: 1990-02-31
 *  was accepted). `who` is 'birth' or 'birth2', the field it names. */
function birthRefusal(b: unknown, who: 'birth' | 'birth2' = 'birth'): Response | null {
  const problem = birthProblem(b)
  return problem ? refuse(`${who}_${problem}`, `bad birth input${who === 'birth2' ? ' (second person)' : ''}: ${problem}`) : null
}

// The subject is what the client sent, reduced to the keys the routes read,
// so a saved reading can be recomputed later exactly as it was cast.
const SUBJECT_KEYS = ['birth', 'birth2', 'n', 'ask', 'name', 'city', 'wishes', 'place', 'place2', 'mode', 'year', 'surname', 'given', 'gender', 'ch', 'lines', 'coins', 'dream', 'situation', 'edition', 'spread', 'picks', 'food', 'mealAt', 'meal', 'crack', 'today', 'partner', 'mbti', 'mbti2', 'optA', 'optB'] as const
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
async function save(sb: Awaited<ReturnType<typeof createSupabaseServer>>, userId: string | null, temple: Temple, body: any, chart: unknown, extras: Record<string, unknown>, title?: string) {
  // A signed-out visitor's chart is shown, not saved.
  if (!userId) return null
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
  const uid = user?.id ?? null
  const signInFirst = () => Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const temple = asTemple(body?.temple)
  // `refresh`: a reopened visit asks for its chart again from its saved
  // subject, so a record saved before an engine fix shows what the engine
  // says now (an unknown hour without a 時柱, an impossible date refused).
  // Nothing is written: the saved row, its chart and its turns stay as they
  // are, and no second row is made.
  const persist = body?.refresh !== true
  const keep = (write: () => Promise<string | null>) => (persist ? write() : Promise.resolve(null))

  // 易學堂: no birth. A cast (six line values and the one matter asked), a
  // lookup (a hexagram number) or a learner's visit with no hexagram. A cast
  // is titled by its matter, so the history lists say what it was about.
  if (temple === 'yixue') {
    const bad = yixueInputError(body)
    if (bad) return Response.json({ error: bad }, { status: 400 })
    try {
      const chart = yixueChart(body)
      const readingId = persist ? await save(sb, uid, temple, body, chart, {}, chart.mode === 'cast' ? chart.ask : undefined) : null
      return Response.json({ temple, chart, engine: ENGINES[temple], readingId })
    } catch (e: any) {
      console.error('[xtell/chart] yixue', e?.message ?? e)
      return Response.json({ error: 'hexagram text unavailable' }, { status: 500 })
    }
  }

  // 解夢: the dream as written, and the 《周公解夢》 lines it points at,
  // chosen by a quick model (lib/jiemeng-scan.ts) and checked against the
  // book (lib/jiemeng.ts). Free to the visitor: the house pays the scan, the
  // reading is paid. A dream this visitor has already looked up keeps its
  // lines and costs nothing. At most SCANS_PER_DAY dream visits a day,
  // counted from their own saved visits (a re-sent dream updates its row,
  // it never frees a slot). Always saved, `refresh` or not, so every scan
  // is counted. The visit is titled by the dream.
  if (temple === 'jiemeng') {
    if (!user) return signInFirst()
    const bad = dreamProblem(body?.dream)
    if (bad) return refuse(bad, bad === 'dream_required' ? 'write the dream' : 'the dream is too long')
    const dream = String(body.dream).trim()
    const ask = typeof body?.ask === 'string' ? body.ask.slice(0, ASK_MAX) : ''
    const { data: recent } = await sb.from('xtell_readings')
      .select('chart, created_at').eq('user_id', user.id).eq('temple', 'jiemeng')
      .order('created_at', { ascending: false }).limit(SCANS_PER_DAY + 20)
    const rows = (recent ?? []) as Array<{ chart: any; created_at: string }>
    // The translations are per language: a dream looked up on a Chinese page
    // (no translations) is looked up again on a Japanese one.
    const dl = dreamLang(body?.lang)
    const seen = rows.find(r => r.chart?.scan && r.chart?.dream === dream && Array.isArray(r.chart?.entries) && dreamLang(r.chart?.lang) === dl)
    let entries, by: string
    if (seen) {
      entries = dreamEntries(seen.chart.entries)
      by = seen.chart.scan
    } else {
      const dayAgo = Date.now() - 86_400_000
      if (rows.filter(r => r.chart?.scan && Date.parse(r.created_at) > dayAgo).length >= SCANS_PER_DAY)
        return refuse('dream_daily_limit', 'too many dreams looked up today', 429)
      const scan = await scanDream(dream, user.id, typeof body?.lang === 'string' ? body.lang : 'zh-Hant')
      if (!scan) return refuse('dream_scan_failed', 'the dream book lookup is unavailable', 503)
      entries = dreamEntries(scan.picks ?? scan.ids)
      by = scan.model
    }
    // `scan` names the model that chose the lines; `lang` the translations' language.
    const chart = { dream, ask, entries, scan: by, lang: dl }
    const readingId = await save(sb, user.id, temple, { ...body, dream, ask }, chart, {}, dream.split('\n')[0])
    return Response.json({ temple, chart, engine: ENGINES[temple], readingId })
  }

  // 孫子兵法 (Sep 29): built like 解夢 above. The situation as written and
  // the lines of the thirteen chapters it calls for, each with a plain
  // translation in the page's language, chosen by a quick model
  // (lib/sunzi-scan.ts) and checked against the book (lib/sunzi.ts). Free to
  // the visitor, the next steps are paid. The same situation, decision and
  // language looked up again keeps its lines; the same daily cap, counted
  // from saved visits; always saved. The visit is titled by the situation.
  if (temple === 'sunzi') {
    const bad = situationProblem(body?.situation)
    if (bad) return refuse(bad, bad === 'situation_required' ? 'describe the situation' : 'the situation is too long')
    const situation = String(body.situation).trim()
    const ask = typeof body?.ask === 'string' ? body.ask.trim().slice(0, SUNZI_ASK_MAX) : ''
    const lang = glossLang(body?.lang)
    // A signed-out visitor has no saved visits to reuse or count.
    const { data: recent } = user
      ? await sb.from('xtell_readings')
        .select('chart, created_at').eq('user_id', user.id).eq('temple', 'sunzi')
        .order('created_at', { ascending: false }).limit(SUNZI_PER_DAY + 20)
      : { data: [] }
    const rows = (recent ?? []) as Array<{ chart: any; created_at: string }>
    const seen = rows.find(r => r.chart?.scan && r.chart?.situation === situation && (r.chart?.ask ?? '') === ask && r.chart?.lang === lang && Array.isArray(r.chart?.lines))
    let lines, by: string
    if (seen) {
      lines = sunziLines(seen.chart.lines)
      by = seen.chart.scan
    } else {
      const dayAgo = Date.now() - 86_400_000
      if (rows.filter(r => r.chart?.scan && Date.parse(r.created_at) > dayAgo).length >= SUNZI_PER_DAY)
        return refuse('sunzi_daily_limit', 'too many situations looked up today', 429)
      if (!user && !guestScanAllowed(req))
        return refuse('sunzi_guest_limit', 'sign in to look up more situations today', 429)
      const scan = await scanSituation(situation, ask, lang, uid)
      if (!scan) return refuse('sunzi_scan_failed', 'the Sunzi lookup is unavailable', 503)
      lines = sunziLines(scan.picks)
      by = scan.model
    }
    // `scan` names the model that chose the lines; `lang` the translations' language.
    const chart = { situation, ask, lang, lines, scan: by }
    const readingId = await save(sb, uid, temple, { ...body, situation, ask }, chart, {}, situation.split('\n')[0])
    return Response.json({ temple, chart, engine: ENGINES[temple], readingId })
  }

  // 幸運餅乾 (Sep 28): which meal it was, its 時辰 and the day's 干支 by code;
  // a quick house model names the taste and writes the slip. Two cookies a
  // meal are free; from the third each is debited EXTRA_CENTS before the
  // model is called, and refunded if no slip comes back. A cookie is never
  // cracked again on a refresh: the saved slip is the slip.
  if (temple === 'cookie') {
    if (!user) return signInFirst()
    if (!persist) return refuse('cookie_refresh', 'a cookie is not cracked again')
    const bad = cookieProblem(body?.food, body?.mealAt)
    if (bad) return refuse(bad, 'bad cookie input')
    const food = String(body.food).trim()
    const ask = typeof body?.ask === 'string' ? body.ask.trim().slice(0, COOKIE_ASK_MAX) : ''
    const meal = mealOf(body.mealAt)!
    const key = mealKey(meal)
    const { count } = await sb.from('xtell_readings').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).eq('temple', 'cookie').eq('subject->>meal', key)
    const cents = (count ?? 0) >= FREE_PER_MEAL ? EXTRA_CENTS : 0
    if (cents) {
      try {
        await debitCredits({ userId: user.id, amountCents: cents, referenceType: 'xtell', referenceId: 'cookie', description: 'XTell fortune cookie (third or later of a meal)', metadata: { temple: 'cookie', meal: key } })
      } catch (e) {
        if (e instanceof InsufficientCreditsError) return refuse('no_credits', 'not enough credits', 402)
        throw e
      }
    }
    const dayGz = (() => { try { return almanacFor(meal.date, 'zh-Hant').dayGz } catch { return null } })()
    const lang = typeof body?.lang === 'string' ? body.lang : 'zh-Hant'
    const facts = cookieFacts({ food, ask, meal, dayGz })
    // 1. The quick model names the taste and the PICK_TOP fortunes that fit
    //    best; 2. one of them is drawn at random here (a cookie keeps its
    //    chance); 3. the note for that slip is written after, streamed by
    //    /api/xtell/cookie/note (Sep 29: the slip shows the moment it is
    //    drawn). A missing note is not a failure: the slip is what the
    //    visitor came for.
    const list = cookieFortunes()
    const valid = (id: number) => list.some(f => f.id === id)
    const pickText = await dailyText({ system: pickBrief(list), content: facts, userId: user.id, accept: t => !!parsePick(t, valid) }).catch(() => null)
    const pick = pickText ? parsePick(pickText, valid) : null
    const slip = pick ? fortuneOf(pick.ids[crypto.getRandomValues(new Uint32Array(1))[0] % pick.ids.length]) : null
    if (!pick || !slip) {
      if (cents) await grantCredits({ userId: user.id, amountCents: cents, kind: 'refund', referenceType: 'xtell', referenceId: 'cookie', description: 'XTell fortune cookie refund (no slip)' }).catch(() => null)
      return refuse('cookie_failed', 'the cookie could not be cracked', 502)
    }
    const texts = fortuneTexts(slip)
    const fortune = (texts as Record<string, string>)[lang] ?? texts['zh-Hant']
    // `notePending`: the note is still to be written, once, in `noteLang`.
    const chart = { food, ask, meal: { ...meal, key }, shichen: shichenOf(meal.hour), dayGz, flavor: pick.flavor, element: pick.element, fortuneId: slip.id, fortune, fortunes: texts, note: null, notePending: true, noteLang: texts[lang as keyof typeof texts] ? lang : 'zh-Hant', charged: cents }
    // `crack`: every cookie is its own visit. Without it, save() would hand
    // back an earlier row with the same meal and no questions, and the meal's
    // count (and the charge from the third) would never move.
    const readingId = await save(sb, user.id, temple, { food, ask, mealAt: body.mealAt, meal: key, crack: crypto.randomUUID() }, chart, {}, fortune)
    return Response.json({ temple, chart, engine: ENGINES[temple], readingId })
  }

  // 塔羅 (Sep 28): the browser shuffled and drew; the ids are checked and the
  // cards laid here, with Waite's meaning for the way each one landed.
  if (temple === 'tarot') {
    const spread = asSpread(body?.spread)
    if (!validPicks(spread, body?.picks)) return refuse('cards_invalid', 'bad draw')
    const ask = typeof body?.ask === 'string' ? body.ask.trim().slice(0, TAROT_ASK_MAX) : ''
    const options = asOptions(body)
    const chart = tarotChart(spread, body.picks, ask, options)
    const readingId = await keep(() => save(sb, uid, temple, { ...body, spread, ask, ...(spread === 'choice' ? { optA: options.a, optB: options.b } : { optA: undefined, optB: undefined }) }, chart, {}, ask || undefined))
    return Response.json({ temple, chart, engine: ENGINES[temple], readingId })
  }

  if (isQianTemple(temple)) {
    // 觀音廟 draws from the 觀音一百籤 or 元三大師's 觀音百籤 (the page's language picks).
    const edition = asQianEdition(body?.edition)
    if (!validQian(body?.n, temple, edition)) return refuse('stick_invalid', 'bad stick number')
    const qian = qianOf(body.n, temple, edition)
    if (!qian) return refuse('stick_invalid', 'stick not in corpus', 500)
    // Optional 稟告: a birth turns into the same 八字 + 流年 the 四面佛 gets,
    // shown under the stick and handed to the master for reference.
    if (body?.birth !== undefined) {
      const bad = birthRefusal(body.birth)
      if (bad) return bad
    }
    const bz = validBirth(body?.birth) ? baziChart(body.birth) : null
    const year = bz ? liuNian(bz, body.birth.y, new Date().getFullYear()) : undefined
    const saved = temple === 'guanyin' ? { ...body, edition } : body
    const chart = temple === 'guanyin' ? { ...qian, edition } : qian
    const readingId = await keep(() => save(sb, uid, temple, saved, chart, { bazi: bz ?? undefined, year }))
    return Response.json({ temple, chart, bazi: bz ?? undefined, year, engine: ENGINES[temple], readingId })
  }

  // 姓名亭 and 測字亭 start from characters, not a birth.
  if (temple === 'xingming') {
    if (!validName(body?.surname)) return refuse('surname_invalid', 'bad name')
    if (!validName(body?.given)) return refuse('given_invalid', 'bad name')
    try {
      const chart = nameChart(body.surname, body.given)
      const readingId = await keep(() => save(sb, uid, temple, body, chart, {}))
      return Response.json({ temple, chart, engine: ENGINES[temple], readingId })
    } catch (e: any) { return refuse('name_nodata', e?.message ?? 'no stroke data') }
  }
  if (temple === 'cezi') {
    if (!validChar(body?.ch)) return refuse('char_invalid', 'write exactly one character')
    const info = charInfo(body.ch)
    if (!info) return refuse('char_nodata', `no data for ${body.ch}`)
    const readingId = await keep(() => save(sb, uid, temple, body, info, {}))
    return Response.json({ temple, chart: info, engine: ENGINES[temple], readingId })
  }

  const badBirth = birthRefusal(body?.birth)
  if (badBirth) return badBirth
  // 紫微 places 命宮 by the 時辰 and 九曜 its 上升 by the minute: neither has
  // an unknown-hour reading, and the form hides the checkbox there. The
  // server says so too, rather than charting the noon placeholder (Codex
  // review, Sep 26: a direct request with hourUnknown charted 紫微 at noon).
  if (HOUR_REQUIRED.has(temple) && body.birth.hourUnknown === true) return refuse('birth_hour_required', 'this temple needs the birth hour')
  validBirth(body.birth)   // normalises an unknown hour, see BirthInput
  if (temple === 'yuelao') {
    const bad = birthRefusal(body?.birth2, 'birth2')
    if (bad) return bad
    validBirth(body.birth2)
  }
  if (temple === 'simianfo' && !validWishes(body?.wishes)) return refuse('wish_required', 'write at least one wish')
  if (temple === 'navagraha' && !validPlace(body?.place)) return refuse('place_invalid', 'bad place')
  // 占星塔 needs a place for the same reason 九曜廟 does — no houses without
  // one — and its 配對 room needs a whole second person.
  const mode = asAstroMode(body?.mode)
  if (temple === 'zhanxing') {
    if (!validPlace(body?.place)) return refuse('place_invalid', 'bad place')
    if (mode === 'synastry') {
      const bad = birthRefusal(body?.birth2, 'birth2')
      if (bad) return bad
      validBirth(body.birth2)
      if (!validPlace(body?.place2)) return refuse('place2_invalid', 'bad place (second person)')
    }
  }

  try {
    // 月老廟 is two BaZi charts — the engine run twice, labeled a and b.
    const chart = temple === 'zhanxing'
      ? zhanxingChart(body.birth, body.place, mode, { b2: body.birth2, place2: body.place2, year: Number(body.year) || undefined })
      : temple === 'ziwei' ? ziweiChart(body.birth)
      : temple === 'navagraha' ? navagrahaChart(body.birth, body.place)
      // 九星気学: the boards are this year's and month's, as of the visit's date.
      : temple === 'kyusei' ? kyuseiChart(body.birth, (body.today = asToday(body?.today)))
      // 宿曜: today's 宿 as of the visit's date, and a partner's if one was given.
      : temple === 'sukuyo' ? sukuyoChart(body.birth, (body.today = asToday(body?.today)), (body.partner = asPartnerDate(body?.partner) ?? undefined))
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
    // 八字廟: the same birth weighed by the 稱骨 table (lib/xtell-chenggu),
    // shown under the pillars. Saved with the visit, and recomputed with
    // the chart when it is reopened (`refresh`).
    const chenggu = temple === 'bazi' ? chengGu(body.birth) : undefined
    const readingId = await keep(() => save(sb, uid, temple, body, chart, { match, year, chenggu }))
    return Response.json({ temple, chart, match, year, chenggu, engine: ENGINES[temple], readingId })
  } catch (e: any) {
    console.error('[xtell/chart]', e?.message ?? e)
    return refuse('chart_failed', 'chart computation failed', 500)
  }
}
