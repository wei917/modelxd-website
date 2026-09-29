// scripts/test-xtell-cookie.ts — 幸運餅乾 (Sep 28): the meal a time belongs
// to, the slip's checks (a known taste, no digits), and the chart route: two
// cookies a meal free, the third charged before the model runs, refused on an
// empty balance, refunded when no slip comes back, never cracked on a
// refresh, and every cookie its own saved visit. Models and credits are
// stubbed: no network, no spend.
//   npx tsx scripts/test-xtell-cookie.ts

import * as ts from 'typescript'
import vm from 'node:vm'
import fs from 'node:fs'
import path from 'node:path'
import { mealOf, mealKey, cookieProblem, cookieFacts, FLAVOR_ELEMENT, parsePick, parseNote, pickBrief, PICK_TOP } from '../lib/xtell-cookie'
import { cookieFortunes } from '../lib/xtell-cookie-fortunes'
import * as xtell from '../lib/xtell'
import { STRINGS } from '../lib/i18n'

let fails = 0
const check = (name: string, cond: boolean, extra = '') => { if (!cond) { fails++; console.log('FAIL', name, extra) } else console.log('ok  ', name) }

// ── The meal and the slip ─────────────────────────────────────────────────
check('meals by the hour: breakfast, lunch, tea, dinner, late', ['07:30', '12:00', '15:30', '18:45', '22:10'].map(h => mealOf(`2026-09-28T${h}`)!.slot).join() === 'breakfast,lunch,tea,dinner,late')
check('a snack at 01:10 belongs to the evening before', mealKey(mealOf('2026-09-29T01:10')!) === '2026-09-28|late')
check('no meal at an impossible time', mealOf('2026-02-30T12:00') === null && mealOf('2026-09-28 12:00') === null && mealOf('2026-09-28T24:00') === null && mealOf(12) === null)
check('what was eaten is required, and short', cookieProblem('', '2026-09-28T12:00') === 'food_required' && cookieProblem('x'.repeat(201), '2026-09-28T12:00') === 'food_too_long' && cookieProblem('麵', 'noon') === 'meal_time_invalid' && cookieProblem('麵', '2026-09-28T12:00') === null)
// The slips: real fortunes, chosen by the model, one of the best drawn here.
const list = cookieFortunes()
const ids = new Set(list.map(f => f.id))
check('206 real fortunes, in five languages, none with a number', list.length === 206 && list.every(f => ['en', 'zh-Hant', 'zh-Hans', 'ja', 'ko'].every(l => (f as any)[l]?.trim() && !/[0-9０-９]/.test((f as any)[l]))))
check('the source and its MIT licence travel with the list', (() => { const j = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'cookie', 'fortunes.json'), 'utf8')); return j.source.licence === 'MIT' && /Thomas Reggi/.test(j.source.copyright) && fs.readFileSync(path.join(__dirname, '..', j.source.licenceFile), 'utf8').startsWith('MIT License') })())
check('the chooser sees every fortune, numbered', (() => { const b = pickBrief(list); return list.every(f => b.includes(`${f.id} ${f.en}`)) })())
const pk = parsePick('{"flavor":"鹹","ids":[52, "243", 52, 9999, 48, 50, 30, 12, 8, 1, 2, 4, 5]}', id => ids.has(id))
check(`a pick: the taste's element, real numbers only, no repeats, at most ${PICK_TOP}`, !!pk && pk.element === '水' && pk.ids.length === PICK_TOP && pk.ids[0] === 52 && pk.ids[1] === 243 && !pk.ids.includes(9999))
check('a pick with an unknown taste, or no real number, is refused', parsePick('{"flavor":"鮮","ids":[52]}', id => ids.has(id)) === null && parsePick('{"flavor":"甘","ids":[9999]}', id => ids.has(id)) === null && parsePick('nope', () => true) === null)
check('the note: no digits (no lucky numbers)', parseNote('{"note":"鹹屬水。"}') === '鹹屬水。' && parseNote('{"note":"第８天"}') === null && parseNote('{"note":"lucky 7"}') === null)
check('five tastes, five elements', Object.entries(FLAVOR_ELEMENT).map(([k, v]) => k + v).join('') === '酸木苦火甘土辛金鹹水')
check('the writer gets the meal, the 時辰 and the day', (() => { const f = cookieFacts({ food: '牛肉麵', ask: '', meal: mealOf('2026-09-28T12:30')!, dayGz: '乙巳' }); return f.includes('牛肉麵') && f.includes('午餐') && f.includes('午時') && f.includes('乙巳日') })())

// ── The chart route ───────────────────────────────────────────────────────
function loadRoute(file: string, modules: Record<string, unknown>) {
  const js = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const exports: any = {}
  vm.runInNewContext(js, {
    exports, console: { ...console, warn: () => {} }, process, Response, Request, ReadableStream, TextEncoder, crypto: globalThis.crypto,
    require: (name: string) => { if (!(name in modules)) throw new Error('unexpected route dependency: ' + name); return modules[name] },
  }, { filename: file })
  return exports
}

function world(opts: { reply?: string | null; note?: string | null; balance?: number } = {}) {
  const rows: any[] = [], debits: number[] = [], grants: number[] = []
  let balance = opts.balance ?? 100
  class InsufficientCreditsError extends Error {}
  const pick = (r: any, k: string) => k === 'subject->>meal' ? r.subject?.meal : r[k]
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-a' } } }) },
    from(_table: string) {
      let op = 'select', values: any = null, single = false, head = false
      const filters: Array<[string, unknown]> = []
      const q: any = {
        select: (_c?: string, o?: any) => { if (o?.head) head = true; return q },
        is: () => q, order: () => q, limit: () => q,
        eq: (k: string, v: unknown) => { filters.push([k, v]); return q },
        single: () => { single = true; return q }, maybeSingle: () => { single = true; return q },
        insert: (v: any) => { op = 'insert'; values = v; return q },
        update: (v: any) => { op = 'update'; values = v; return q },
        then: (resolve: any, reject: any) => {
          const mine = rows.filter(r => filters.every(([k, v]) => pick(r, k) === v))
          let out: any
          if (op === 'insert') { const id = `00000000-0000-4000-8000-${String(rows.length + 1).padStart(12, '0')}`; rows.push({ id, ...values }); out = { data: { id }, error: null } }
          else if (op === 'update') out = { data: null, error: null }
          else if (head) out = { count: mine.length, data: null, error: null }
          else out = single ? { data: mine[0] ?? null, error: null } : { data: mine, error: null }
          return Promise.resolve(out).then(resolve, reject)
        },
      }
      return q
    },
  }
  const pickReply = opts.reply === undefined ? '{"flavor":"鹹","ids":[52,243,48,50,30,12,8,1,2,4]}' : opts.reply
  const noteReply = opts.note === undefined ? '{"note":"這一餐主味鹹，鹹屬水；午時正旺，好消息就像水一樣會流過來。"}' : opts.note
  const POST = loadRoute('app/api/xtell/chart/route.ts', {
    '@/lib/supabase-server': { createSupabaseServer: async () => db }, '@/lib/xtell': xtell, '@/lib/yijing': require('../lib/yijing'),
    '@/lib/tarot': require('../lib/tarot'), '@/lib/xtell-cookie': require('../lib/xtell-cookie'), '@/lib/xtell-almanac': require('../lib/xtell-almanac'),
    '@/lib/xtell-daily-model': { dailyText: async (o: any) => { const r = /You choose fortune-cookie slips/.test(o.system) ? pickReply : noteReply; return r && o.accept(r) ? r : null } },
    '@/lib/xtell-cookie-fortunes': require('../lib/xtell-cookie-fortunes'),
    '@/lib/credits': {
      InsufficientCreditsError,
      debitCredits: async (o: any) => { if (balance < o.amountCents) throw new InsufficientCreditsError('insufficient_credits'); balance -= o.amountCents; debits.push(o.amountCents); return balance },
      grantCredits: async (o: any) => { balance += o.amountCents; grants.push(o.amountCents); return balance },
    },
    '@/lib/jiemeng': require('../lib/jiemeng'), '@/lib/jiemeng-scan': { scanDream: async () => null },
  }).POST
  const crack = async (body: any) => { const r = await POST(new Request('http://t/api/xtell/chart', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ temple: 'cookie', lang: 'zh-Hant', ...body }) })); return { status: r.status, d: await r.json() as any } }
  return { rows, debits, grants, crack, balance: () => balance }
}

async function route() {
  const meal = { food: '牛肉麵', mealAt: '2026-09-28T12:30' }
  const w = world()
  const c1 = await w.crack(meal), c2 = await w.crack(meal), c3 = await w.crack(meal)
  check('the first two cookies of a meal are free', c1.status === 200 && c2.status === 200 && c1.d.chart.charged === 0 && c2.d.chart.charged === 0, `${c1.status} ${c2.status}`)
  check('the third is charged one cent, before the model runs', c3.status === 200 && c3.d.chart.charged === 1 && w.debits.join() === '1')
  check('each cookie is its own saved visit, titled by its slip', w.rows.length === 3 && new Set(w.rows.map(r => r.subject.crack)).size === 3 && w.rows.every(r => r.subject.meal === '2026-09-28|lunch' && r.title === r.chart.fortune))
  check('the slip is one of the ten chosen, a real fortune, in the page language and all five', [52, 243, 48, 50, 30, 12, 8, 1, 2, 4].includes(c1.d.chart.fortuneId) && c1.d.chart.fortune === list.find(f => f.id === c1.d.chart.fortuneId)!['zh-Hant'] && Object.keys(c1.d.chart.fortunes).length === 5)
  check('the slip carries the meal, the 時辰, the day, the element and the note', c1.d.chart.shichen === '午時' && c1.d.chart.meal.slot === 'lunch' && c1.d.chart.element === '水' && typeof c1.d.chart.dayGz === 'string' && /鹹屬水/.test(c1.d.chart.note))
  const many = world({ balance: 1000 }); const drawn = new Set<number>()
  for (let i = 0; i < 40; i++) { const c = await many.crack({ ...meal, mealAt: `2026-${String(1 + (i % 12)).padStart(2, '0')}-10T12:30` }); drawn.add(c.d.chart.fortuneId) }
  check('one of the ten is drawn at random: different slips turn up', drawn.size >= 4, String(drawn.size))
  const noNote = world({ note: 'lucky 7' })
  const nn = await noNote.crack(meal)
  check('no usable note: the slip still comes, without a note', nn.status === 200 && nn.d.chart.note === null && typeof nn.d.chart.fortune === 'string')
  const dinner = await w.crack({ ...meal, mealAt: '2026-09-28T19:00' })
  check('another meal starts free again', dinner.status === 200 && dinner.d.chart.charged === 0)

  const poor = world({ balance: 0 })
  await poor.crack(meal); await poor.crack(meal)
  const p3 = await poor.crack(meal)
  check('an empty balance: the third is refused, nothing written', p3.status === 402 && p3.d.code === 'no_credits' && poor.rows.length === 2)

  const broken = world({ reply: '{"flavor":"甘","ids":[99999]}' })
  await broken.crack(meal)
  const b1 = await broken.crack(meal)
  check('no slip: refused, and nothing saved', b1.status === 502 && b1.d.code === 'cookie_failed' && broken.rows.length === 0)
  const b3w = world({ reply: null })
  for (let i = 0; i < 2; i++) b3w.rows.push({ id: `r${i}`, user_id: 'user-a', temple: 'cookie', subject: { meal: '2026-09-28|lunch' } })
  const b3 = await b3w.crack(meal)
  check('a charged cookie that fails is refunded', b3.status === 502 && b3w.debits.join() === '1' && b3w.grants.join() === '1' && b3w.balance() === 100)

  const again = await w.crack({ ...meal, refresh: true })
  check('a cookie is never cracked again on a refresh', again.status === 400 && again.d.code === 'cookie_refresh')
  const bad = await w.crack({ food: ' ', mealAt: '2026-09-28T12:30' })
  check('nothing eaten: refused', bad.status === 400 && bad.d.code === 'food_required')
}

// ── Strings ───────────────────────────────────────────────────────────────
const LANGS = ['en', 'zh-Hant', 'zh-Hans', 'ja', 'ko'] as const
const keys = Object.keys(STRINGS).filter(k => k.startsWith('xtell.cookie.') || k.startsWith('xtell.site.focus.cookie.') || ['xtell.err.food_required', 'xtell.err.no_credits', 'xtell.err.cookie_failed'].includes(k))
check(`${keys.length} cookie strings, all in five languages`, keys.length >= 20 && keys.every(k => LANGS.every(l => typeof (STRINGS as any)[k][l] === 'string' && (STRINGS as any)[k][l].trim())))

route().then(() => {
  console.log(fails ? `\n${fails} FAILED` : '\nall cookie checks passed')
  if (fails) process.exit(1)
}).catch(e => { console.error(e); process.exit(1) })
