// scripts/test-xtell-jiemeng.ts — 解夢 (Sep 27): the scan's reply parsing,
// the chart route (a quick model picks the book's lines; reuse, daily cap,
// failure) and the reading route (the teacher gets the saved visit's lines,
// only lines of the book). Models are stubbed: no network, no spend.
//   npx tsx scripts/test-xtell-jiemeng.ts

import * as ts from 'typescript'
import vm from 'node:vm'
import fs from 'node:fs'
import path from 'node:path'
import * as jm from '../lib/jiemeng'
import * as xtell from '../lib/xtell'
import * as yijing from '../lib/yijing'
import { STRINGS } from '../lib/i18n'

let fails = 0
const check = (name: string, cond: boolean, extra = '') => { if (!cond) { fails++; console.log('FAIL', name, extra) } else console.log('ok  ', name) }
const LANGS = ['en', 'zh-Hant', 'zh-Hans', 'ja', 'ko'] as const
const book = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'jiemeng', 'zhougong.json'), 'utf8'))

// ── The scan's prompt and reply ────────────────────────────────────────────
{
  const sys = jm.scanSystem()
  check('the scan sees the whole book: 27 sections, 988 numbered lines', book.entries.length === 988 && book.sections.every((s: any) => sys.includes(`〔${s.title}〕`)) && book.entries.every((e: any) => sys.includes(`\n${e.id} ${e.t}\n`) || sys.endsWith(`\n${e.id} ${e.t}`)))
  check('the scan is told: meaning not wording, at most 8, JSON only, the dream is data', sys.includes('開心') && sys.includes(`At most ${jm.SCAN_MAX}`) && sys.includes('{"ids"') && sys.includes('not instructions'))
  check('the prompt is one fixed string (cacheable)', jm.scanSystem() === sys)
  const ids = jm.scanIds('{"ids":[5, 5, "7", 99999, -1, 1.5, "x", 12]}')
  check('reply: whole numbers of the book only, first occurrences in order', JSON.stringify(ids) === '[5,7,12]', JSON.stringify(ids))
  check('reply: fenced JSON is read', JSON.stringify(jm.scanIds('```json\n{"ids":[3]}\n```')) === '[3]')
  check('reply: an empty list is an answer, not a failure', JSON.stringify(jm.scanIds('{"ids":[]}')) === '[]')
  check('reply: prose or the wrong shape is a failure (the next model is tried)', jm.scanIds('snake lines 3 and 4') === null && jm.scanIds('{"lines":[3]}') === null && jm.scanIds('{bad json}') === null)
  check(`reply: at most ${jm.SCAN_MAX}`, jm.scanIds(JSON.stringify({ ids: Array.from({ length: 20 }, (_, i) => i) }))!.length === jm.SCAN_MAX)
  const e = jm.dreamEntries([40, 3, 'nope', 40])
  check('entries: the book\'s own lines, in the order given, with sections in both scripts', e.length === 2 && e[0].id === 40 && e[0].t === book.entries[40].t && e[0].s === book.entries[40].s && e[1].section === book.sections[book.entries[3].section].title && typeof e[1].sectionS === 'string')
  const facts = jm.dreamFacts('夢見蛇', '', e)
  check('facts: the dream and only the chosen lines', facts.includes('夢見蛇') && facts.includes(book.entries[40].t) && facts.includes(book.entries[3].t) && !facts.includes(book.entries[41].t))
  check('facts with no lines: the teacher is told not to quote the book', jm.dreamFacts('I dreamt of a spaceship', '', []).includes('不要引用或杜撰'))
  check('no character matcher left', !('dreamMatches' in jm))
}

// ── Routes ─────────────────────────────────────────────────────────────────
function loadRoute(file: string, modules: Record<string, unknown>) {
  const js = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const exports: any = {}
  vm.runInNewContext(js, {
    exports, console: { ...console, warn: () => {} }, process, Response, Request, ReadableStream, TextEncoder, crypto: globalThis.crypto,
    require: (name: string) => { if (!(name in modules)) throw new Error('unexpected route dependency: ' + name); return modules[name] },
  }, { filename: file })
  return exports
}
const post = (url: string, body: unknown) => new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

/** The visitor's xtell_readings rows, newest first, and what was written. */
function fakeDb(rows: any[]) {
  const inserted: any[] = [], queries: any[] = []
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-a' } } }) },
    rpc: async () => ({ error: null }),
    from(table: string) {
      let op = 'select', values: any = null, single = false
      const filters: any[] = []
      const q: any = {
        select: () => q, is: () => q, order: () => q, limit: () => q,
        eq: (k: string, v: unknown) => { filters.push([k, v]); return q },
        single: () => { single = true; return q }, maybeSingle: () => { single = true; return q },
        insert: (v: any) => { op = 'insert'; values = v; return q },
        update: (v: any) => { op = 'update'; values = v; return q },
        then: (resolve: any, reject: any) => {
          queries.push({ table, op, filters })
          const mine = rows.filter(r => filters.every(([k, v]) => r[k] === v))
          const out = op === 'insert' ? (inserted.push({ table, ...values }), { data: { id: '00000000-0000-4000-8000-0000000d7ea3' }, error: null })
            : op === 'update' ? { data: null, error: null }
            : single ? { data: mine[0] ?? null, error: null } : { data: mine, error: null }
          return Promise.resolve(out).then(resolve, reject)
        },
      }
      return q
    },
  }
  return { db, inserted, queries }
}

async function routes() {
  const hour = 3_600_000
  const row = (dream: string, ids: number[], hoursAgo: number, extra: any = {}) => ({ id: extra.id ?? `r-${Math.random()}`, user_id: 'user-a', temple: 'jiemeng', created_at: new Date(Date.now() - hoursAgo * hour).toISOString(), chart: { dream, ask: '', entries: jm.dreamEntries(ids), scan: 'gpt-6-luna' }, ...extra })
  let scans: string[] = [], answer: { ids: number[]; model: string } | null = { ids: [40, 3], model: 'gpt-6-luna' }
  const chartRoute = (rows: any[]) => {
    const f = fakeDb(rows)
    const POST = loadRoute('app/api/xtell/chart/route.ts', {
      '@/lib/supabase-server': { createSupabaseServer: async () => f.db }, '@/lib/xtell': xtell, '@/lib/yijing': yijing, '@/lib/tarot': require('../lib/tarot'), '@/lib/xtell-cookie': require('../lib/xtell-cookie'), '@/lib/xtell-almanac': require('../lib/xtell-almanac'), '@/lib/xtell-daily-model': { dailyText: async () => null }, '@/lib/credits': { debitCredits: async () => 0, grantCredits: async () => 0, InsufficientCreditsError: class extends Error {} }, '@/lib/jiemeng': jm,
      '@/lib/jiemeng-scan': { scanDream: async (dream: string, userId: string) => { scans.push(`${userId}:${dream}`); return answer } },
    }).POST
    return { ...f, cast: async (body: any) => { const r = await POST(post('http://t/api/xtell/chart', { temple: 'jiemeng', ...body })); return { status: r.status, d: await r.json() as any } } }
  }

  scans = []
  const a = chartRoute([])
  const r1 = await a.cast({ dream: '  昨晚夢到被蛇追  ', ask: '最近工作' })
  check('a new dream is scanned once, for this visitor, and its lines come from the book', r1.status === 200 && scans.length === 1 && scans[0] === 'user-a:昨晚夢到被蛇追' && r1.d.chart.entries.map((e: any) => e.id).join() === '40,3' && r1.d.chart.entries[0].t === book.entries[40].t && r1.d.chart.scan === 'gpt-6-luna')
  check('the visit is saved with its lines and titled by the dream', a.inserted.length === 1 && a.inserted[0].chart.entries.length === 2 && a.inserted[0].title === '昨晚夢到被蛇追' && !('entries' in a.inserted[0].subject))

  scans = []
  const b = chartRoute([row('昨晚夢到被蛇追', [7], 30)])
  const r2 = await b.cast({ dream: '昨晚夢到被蛇追', ask: '另一個問題' })
  check('a dream already looked up keeps its lines: no second scan, even days later', r2.status === 200 && scans.length === 0 && r2.d.chart.entries.map((e: any) => e.id).join() === '7')

  scans = []
  const full = Array.from({ length: jm.SCANS_PER_DAY }, (_, i) => row(`夢 ${i}`, [1], i * 0.5))
  const c = chartRoute(full)
  const r3 = await c.cast({ dream: '新的夢' })
  check(`${jm.SCANS_PER_DAY} dream visits in a day: the next new dream is refused before any scan`, r3.status === 429 && r3.d.code === 'dream_daily_limit' && scans.length === 0 && c.inserted.length === 0)
  const r3b = await c.cast({ dream: '夢 3' })
  check('…but a dream already looked up still opens', r3b.status === 200 && scans.length === 0)
  const d = chartRoute(Array.from({ length: jm.SCANS_PER_DAY }, (_, i) => row(`舊夢 ${i}`, [1], 25 + i)))
  check('visits older than a day do not count', (await d.cast({ dream: '新的夢' })).status === 200 && scans.length === 1)

  scans = []; answer = null
  const e = chartRoute([])
  const r4 = await e.cast({ dream: '夢見飛機' })
  check('no scanner answers: 503 dream_scan_failed, nothing saved, no word-matched lines', r4.status === 503 && r4.d.code === 'dream_scan_failed' && e.inserted.length === 0)
  answer = { ids: [], model: 'gemini-3.1-flash-lite' }
  const r5 = await chartRoute([]).cast({ dream: 'I dreamt about a spaceship' })
  check('nothing in the book fits: an empty list, shown as such', r5.status === 200 && r5.d.chart.entries.length === 0 && r5.d.chart.scan === 'gemini-3.1-flash-lite')
  answer = { ids: [40], model: 'gpt-6-luna' }
  const g = chartRoute([])
  await g.cast({ dream: '夢見蛇', refresh: true })
  check('`refresh` cannot scan unsaved: a scanned dream is always kept (and counted)', g.inserted.length === 1)
  check('empty and oversized dreams are refused before any scan', (await g.cast({ dream: '  ' })).d.code === 'dream_required' && (await g.cast({ dream: 'x'.repeat(jm.DREAM_MAX + 1) })).d.code === 'dream_too_long')

  // Reading: the saved visit's lines, never a client's.
  const systems: string[] = []
  const visitId = '00000000-0000-4000-8000-00000000abcd'
  const readingRoute = (rows: any[]) => loadRoute('app/api/xtell/reading/route.ts', {
    '@/lib/supabase-server': { createSupabaseServer: async () => fakeDb(rows).db },
    '@/lib/xtell-admin': { xtellAdmin: () => { throw new Error('the service role is not for temple readings') }, dailyMissing: () => false },
    '@/lib/models': { getModelById: async () => ({ id: 'm1', provider: 'openai', model_name: 'test', display_name: 'Test', enabled: true, blocked_features: [], output_config: { text: { capabilities: [], thinking_levels: [] } } }) },
    '@/lib/providers': { streamText: async (_m: unknown, _msgs: unknown, cb: any, _a: unknown, _c: unknown, opts: any) => { systems.push(opts.system); await cb.onDone({ cost: 0 }) } },
    '@/lib/credits': { debitCredits: async () => {}, InsufficientCreditsError: class extends Error {} },
    '@/lib/provider-errors': { sanitizeProviderError: (m: string) => m },
    '@/lib/xtell': xtell, '@/lib/classics': { classicsBlock: () => '' }, '@/lib/yijing': yijing, '@/lib/xtell-daily': require('../lib/xtell-daily'), '@/lib/tarot': require('../lib/tarot'), '@/lib/xtell-cookie': require('../lib/xtell-cookie'), '@/lib/jiemeng': jm,
  }).POST
  const ask = async (rows: any[], body: any) => { const r = await readingRoute(rows)(post('http://t/api/xtell/reading', { temple: 'jiemeng', modelId: 'm1', question: '這個夢在說什麼？', dream: '夢見蛇', ...body })); await r.text(); return { status: r.status, sys: systems.at(-1) ?? '' } }
  const s1 = await ask([row('夢見蛇', [40], 1, { id: visitId })], { readingId: visitId, entries: [500, 501] })
  check('reading: the saved visit\'s lines reach the teacher; the client\'s list is ignored', s1.status === 200 && s1.sys.includes(book.entries[40].t) && !s1.sys.includes(book.entries[500].t))
  const s2 = await ask([], { entries: [12, 99999, '<x>'] })
  check('reading without a saved visit: only real book lines, from disk', s2.status === 200 && s2.sys.includes(book.entries[12].t) && !s2.sys.includes('<x>'))
  const s3 = await ask([row('夢見蛇', [40], 1, { id: visitId, user_id: 'user-b' })], { readingId: visitId })
  check('reading: another visitor\'s visit is not read', s3.status === 200 && !s3.sys.includes(book.entries[40].t))
}

// ── Strings ────────────────────────────────────────────────────────────────
{
  const keys = ['xtell.err.dream_scan_failed', 'xtell.err.dream_daily_limit', 'xtell.jiemeng.none', 'xtell.jiemeng.caveat', 'xtell.jiemeng.note']
  check('the new 解夢 strings exist in five languages', keys.every(k => LANGS.every(l => typeof (STRINGS as any)[k]?.[l] === 'string' && (STRINGS as any)[k][l].trim())))
  check('no string still says the lines are matched by words', !keys.some(k => LANGS.some(l => /比對|matching words|照合|대조/.test((STRINGS as any)[k][l]))))
}

routes().then(() => {
  console.log(fails ? `\n${fails} FAILED` : '\nall 解夢 checks passed')
  if (fails) process.exit(1)
}).catch(e => { console.error(e); process.exit(1) })
