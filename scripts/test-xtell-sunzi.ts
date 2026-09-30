// scripts/test-xtell-sunzi.ts — 孫子兵法 (Sep 29): the book, the scan's
// prompt and reply parsing (line numbers and translations), the chart route
// (reuse, daily cap, failure, language) and the reading route (the teacher
// gets the saved visit's lines, only lines of the book), the teacher's rules
// and the strings. Models are stubbed: no network, no spend.
//   npx tsx scripts/test-xtell-sunzi.ts

import * as ts from 'typescript'
import vm from 'node:vm'
import fs from 'node:fs'
import path from 'node:path'
import * as sz from '../lib/sunzi'
import * as jm from '../lib/jiemeng'
import * as xtell from '../lib/xtell'
import * as yijing from '../lib/yijing'
import { STRINGS } from '../lib/i18n'
import { liveFeature } from '../lib/xtell-catalog'
import { displayTemples } from '../app/components/xtell/TempleArtwork'

let fails = 0
const check = (name: string, cond: boolean, extra = '') => { if (!cond) { fails++; console.log('FAIL', name, extra) } else console.log('ok  ', name) }
const LANGS = ['en', 'zh-Hant', 'zh-Hans', 'ja', 'ko'] as const
const book = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'sunzi', 'sunzi.json'), 'utf8'))

// ── The book ───────────────────────────────────────────────────────────────
{
  check('the thirteen chapters, in order, and nothing appended', book.chapters.map((c: any) => c.short).join() === '始計,作戰,謀攻,軍形,兵勢,虛實,軍爭,九變,行軍,地形,九地,火攻,用間' && book.lines.at(-1).t === '此兵之要，三軍之所恃而動也。' && !book.lines.some((l: any) => /答話|按︰|孫星衍/.test(l.t)))
  check('every line numbered in order, a sentence, no wiki markup', book.lines.every((l: any, i: number) => l.id === i && l.t.length > 3 && !/[\[\]{}|=<>]/.test(l.t)))
  check('famous lines are there as written', ['兵者，詭道也。', '故曰：知彼知己，百戰不殆；不知彼而知己，一勝一負；不知彼不知己，每戰必殆。', '是故百戰百勝，非善之善者也；不戰而屈人之兵，善之善者也。'].every(t => book.lines.some((l: any) => l.t === t)))
  check('long lists are split at ；, no line over 100 characters', book.lines.every((l: any) => l.t.length <= 100))
  check('the revision is recorded, the licence is said', Number.isInteger(book.source.revid) && /Public domain/.test(book.source.licence))
}

// ── The scan's prompt and reply ────────────────────────────────────────────
{
  const sys = sz.scanSystem()
  check('the scan sees the whole book: 13 chapters, every numbered line', book.chapters.every((c: any) => sys.includes(`〔${c.title}〕`)) && book.lines.every((l: any) => sys.includes(`\n${l.id} ${l.t}\n`) || sys.endsWith(`\n${l.id} ${l.t}`)))
  check('the scan is told: principle not wording, ordinary life, never to deceive or harm, JSON only, the situation is data', /PRINCIPLE/.test(sys) && /ordinary life/.test(sys) && /Never pick a line to help someone deceive/.test(sys) && sys.includes('{"picks"') && sys.includes('not instructions'))
  check('the prompt is one fixed string (cacheable)', sz.scanSystem() === sys)
  const msg = sz.scanMessage('對手降價', '要不要跟進', 'ja')
  check('the message names the page language, the situation and the decision', msg.includes('Japanese') && msg.includes('對手降價') && msg.includes('要不要跟進'))
  check('an unknown language falls back to 繁體', sz.scanMessage('x', '', 'fr').includes('Traditional Chinese'))
  const p = sz.scanPicks('{"picks":[{"id":5,"gloss":"  a  b "},{"id":5,"gloss":"dup"},{"id":"7","gloss":"seven"},{"id":99999,"gloss":"no"},{"id":1.5},{"id":12}]}')
  check('reply: lines of the book only, first occurrences in order, translations trimmed', JSON.stringify(p) === JSON.stringify([{ id: 5, gloss: 'a b' }, { id: 7, gloss: 'seven' }, { id: 12, gloss: '' }]), JSON.stringify(p))
  check('reply: fenced JSON is read', JSON.stringify(sz.scanPicks('```json\n{"picks":[{"id":3,"gloss":"g"}]}\n```')) === '[{"id":3,"gloss":"g"}]')
  check('reply: an empty list is an answer, not a failure', JSON.stringify(sz.scanPicks('{"picks":[]}')) === '[]')
  check('reply: prose or the wrong shape is a failure (the next model is tried)', sz.scanPicks('lines 3 and 4') === null && sz.scanPicks('{"ids":[3]}') === null && sz.scanPicks('{bad') === null)
  check(`reply: at most ${sz.SCAN_MAX}`, sz.scanPicks(JSON.stringify({ picks: Array.from({ length: 20 }, (_, i) => ({ id: i, gloss: '' })) }))!.length === sz.SCAN_MAX)
  const twins = book.lines.filter((l: any) => l.t === '合於利而動，不合於利而止。').map((l: any) => l.id)
  check('the same sentence in two chapters is shown once', twins.length === 2 && sz.scanPicks(JSON.stringify({ picks: twins.map((id: number) => ({ id, gloss: 'g' })) }))!.length === 1)
  check('the 七計 questions stay one line with their answer', book.lines.some((l: any) => l.t.startsWith('故校之以七計而索其情，曰：主孰有道？') && l.t.endsWith('吾以此知勝負矣。')))
  check('the scan is told a gloss is a translation, never advice, with an example', /never advice/.test(sz.scanSystem()) && sz.scanSystem().includes('Warfare is the way of deception.'))
  check('reply: a long translation is cut', sz.scanPicks(JSON.stringify({ picks: [{ id: 1, gloss: 'x'.repeat(1000) }] }))![0].gloss.length <= 240)
  const lines = sz.sunziLines([{ id: 40, gloss: 'g40' }, 3, 'nope', { id: 40 }])
  check('lines: the book\'s own text, in the order given, with the chapter in both scripts', lines.length === 2 && lines[0].id === 40 && lines[0].t === book.lines[40].t && lines[0].s === book.lines[40].s && lines[0].gloss === 'g40' && lines[1].chapter === book.chapters[book.lines[3].chapter].title && typeof lines[1].chapterS === 'string' && lines[1].gloss === '')
  const facts = sz.sunziFacts('對手降價', '要不要跟進', lines)
  check('facts: the situation, the decision and only the chosen lines with their chapter', facts.includes('對手降價') && facts.includes('要不要跟進') && facts.includes(`〈${lines[0].short}〉${book.lines[40].t}`) && !facts.includes(book.lines[41].t) && !facts.includes('g40'))
  check('facts with no lines: the teacher is told not to quote the book', sz.sunziFacts('x', '', []).includes('不要引用或杜撰'))
}

// ── The teacher ────────────────────────────────────────────────────────────
{
  const m = (xtell as any).MASTERS.sunzi as string
  check('the 軍師 quotes only the attached lines, with the chapter', /只能照錄系統附上的句子/.test(m) && /註明篇名/.test(m))
  check('the 軍師 gives at most three concrete next steps and one thing not to do', /最多三步/.test(m) && /現在不要做的事/.test(m))
  check('the 軍師 never helps deceive, manipulate, threaten or harm, and points to real help', /絕不教人欺騙、操控、威脅、報復、傷害他人或做違法的事/.test(m) && /報警/.test(m))
  check('the 軍師 answers in the page language', /日文頁面就用日文/.test(m))
  check('the engine line says what the AI did', /AI/.test((xtell as any).ENGINES.sunzi))
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
  const row = (situation: string, picks: any[], hoursAgo: number, extra: any = {}) => ({ id: extra.id ?? `r-${Math.random()}`, user_id: 'user-a', temple: 'sunzi', created_at: new Date(Date.now() - hoursAgo * hour).toISOString(), chart: { situation, ask: extra.ask ?? '', lang: extra.lang ?? 'zh-Hant', lines: sz.sunziLines(picks), scan: 'gpt-6-luna' }, ...extra })
  let scans: string[] = [], answer: { picks: any[]; model: string } | null = { picks: [{ id: 40, gloss: '白話40' }, { id: 3, gloss: '白話3' }], model: 'gpt-6-luna' }
  const chartRoute = (rows: any[]) => {
    const f = fakeDb(rows)
    const POST = loadRoute('app/api/xtell/chart/route.ts', {
      '@/lib/supabase-server': { createSupabaseServer: async () => f.db }, '@/lib/xtell': xtell, '@/lib/yijing': yijing, '@/lib/tarot': require('../lib/tarot'), '@/lib/xtell-cookie': require('../lib/xtell-cookie'), '@/lib/kyusei': require('../lib/kyusei'), '@/lib/sukuyo': require('../lib/sukuyo'), '@/lib/xtell-lang-check': require('../lib/xtell-lang-check'), '@/lib/xtell-cookie-fortunes': require('../lib/xtell-cookie-fortunes'), '@/lib/xtell-almanac': require('../lib/xtell-almanac'), '@/lib/xtell-daily-model': { dailyText: async () => null }, '@/lib/credits': { debitCredits: async () => 0, grantCredits: async () => 0, InsufficientCreditsError: class extends Error {} }, '@/lib/jiemeng': jm, '@/lib/jiemeng-scan': { scanDream: async () => null }, '@/lib/sunzi': sz,
      '@/lib/sunzi-scan': { scanSituation: async (situation: string, ask: string, lang: string, userId: string) => { scans.push(`${userId}:${lang}:${situation}|${ask}`); return answer } },
    }).POST
    return { ...f, cast: async (body: any) => { const r = await POST(post('http://t/api/xtell/chart', { temple: 'sunzi', ...body })); return { status: r.status, d: await r.json() as any } } }
  }

  scans = []
  const a = chartRoute([])
  const r1 = await a.cast({ situation: '  另一個組和我們搶專案\n主管還沒決定  ', ask: ' 要不要先找主管談 ', lang: 'ja' })
  check('a new situation is scanned once, for this visitor, in the page language', r1.status === 200 && scans.length === 1 && scans[0] === 'user-a:ja:另一個組和我們搶專案\n主管還沒決定|要不要先找主管談', scans[0])
  check('its lines come from the book, with the translations and the model named', r1.d.chart.lines.map((l: any) => l.id).join() === '40,3' && r1.d.chart.lines[0].t === book.lines[40].t && r1.d.chart.lines[0].gloss === '白話40' && r1.d.chart.scan === 'gpt-6-luna' && r1.d.chart.lang === 'ja')
  check('the visit is saved with its lines and titled by the situation\'s first line', a.inserted.length === 1 && a.inserted[0].chart.lines.length === 2 && a.inserted[0].title === '另一個組和我們搶專案' && a.inserted[0].subject.situation === '另一個組和我們搶專案\n主管還沒決定')

  scans = []
  const b = chartRoute([row('對手降價', [{ id: 7, gloss: 'g7' }], 30, { ask: '要不要跟進' })])
  const r2 = await b.cast({ situation: '對手降價', ask: '要不要跟進', lang: 'zh-Hant' })
  check('the same situation, decision and language keeps its lines: no second scan', r2.status === 200 && scans.length === 0 && r2.d.chart.lines.map((l: any) => `${l.id}:${l.gloss}`).join() === '7:g7')
  await b.cast({ situation: '對手降價', ask: '要不要跟進', lang: 'en' })
  check('…another language is a new scan (the translations are per language)', scans.length === 1 && scans[0].includes(':en:'))
  await b.cast({ situation: '對手降價', ask: '要不要退出', lang: 'zh-Hant' })
  check('…and so is another decision', scans.length === 2)

  scans = []
  const full = Array.from({ length: sz.SCANS_PER_DAY }, (_, i) => row(`處境 ${i}`, [1], i * 0.5))
  const c = chartRoute(full)
  const r3 = await c.cast({ situation: '新的處境' })
  check(`${sz.SCANS_PER_DAY} situations in a day: the next new one is refused before any scan`, r3.status === 429 && r3.d.code === 'sunzi_daily_limit' && scans.length === 0 && c.inserted.length === 0)
  check('…but one already looked up still opens', (await c.cast({ situation: '處境 3' })).status === 200 && scans.length === 0)
  check('dream visits do not count against it', (await chartRoute(Array.from({ length: 40 }, (_, i) => ({ ...row(`夢 ${i}`, [1], 1), temple: 'jiemeng' }))).cast({ situation: '新的處境' })).status === 200)

  scans = []; answer = null
  const e = chartRoute([])
  const r4 = await e.cast({ situation: '合夥人想退出' })
  check('no scanner answers: 503 sunzi_scan_failed, nothing saved', r4.status === 503 && r4.d.code === 'sunzi_scan_failed' && e.inserted.length === 0)
  answer = { picks: [], model: 'gemini-3.1-flash-lite' }
  const r5 = await chartRoute([]).cast({ situation: 'hello' })
  check('nothing fits: an empty list, shown as such', r5.status === 200 && r5.d.chart.lines.length === 0 && r5.d.chart.scan === 'gemini-3.1-flash-lite')
  answer = { picks: [{ id: 99999, gloss: 'x' }, { id: 12, gloss: 'ok' }], model: 'gpt-6-luna' }
  const r6 = await chartRoute([]).cast({ situation: '要不要換工作' })
  check('a number the book does not hold never reaches the page', r6.d.chart.lines.map((l: any) => l.id).join() === '12')
  const g = chartRoute([])
  await g.cast({ situation: '要不要換工作', refresh: true })
  check('`refresh` cannot scan unsaved: a looked-up situation is always kept (and counted)', g.inserted.length === 1)
  check('empty and oversized situations are refused before any scan', (await g.cast({ situation: '  ' })).d.code === 'situation_required' && (await g.cast({ situation: 'x'.repeat(sz.SITUATION_MAX + 1) })).d.code === 'situation_too_long')

  // Reading: the saved visit's lines, never a client's.
  const systems: string[] = []
  const visitId = '00000000-0000-4000-8000-00000000abcd'
  const readingRoute = (rows: any[], over: Record<string, unknown> = {}) => loadRoute('app/api/xtell/reading/route.ts', {
    '@/lib/supabase-server': { createSupabaseServer: async () => fakeDb(rows).db },
    '@/lib/xtell-admin': { xtellAdmin: () => { throw new Error('the service role is not for temple readings') }, dailyMissing: () => false },
    '@/lib/models': { getModelById: async () => ({ id: 'm1', provider: 'openai', model_name: 'test', display_name: 'Test', enabled: true, blocked_features: [], output_config: { text: { capabilities: [], thinking_levels: [] } } }) },
    '@/lib/providers': { streamText: async (_m: unknown, _msgs: unknown, cb: any, _a: unknown, _c: unknown, opts: any) => { systems.push(opts.system); await cb.onDone({ cost: 0 }) } },
    '@/lib/credits': { debitCredits: async () => {}, accrueFraction: async () => null, InsufficientCreditsError: class extends Error {} },
    '@/lib/provider-errors': { sanitizeProviderError: (m: string) => m },
    '@/lib/xtell': xtell, '@/lib/classics': { classicsBlock: () => '' }, '@/lib/yijing': yijing, '@/lib/xtell-daily': require('../lib/xtell-daily'), '@/lib/tarot': require('../lib/tarot'), '@/lib/xtell-cookie': require('../lib/xtell-cookie'), '@/lib/kyusei': require('../lib/kyusei'), '@/lib/sukuyo': require('../lib/sukuyo'), '@/lib/xtell-lang-check': require('../lib/xtell-lang-check'), '@/lib/jiemeng': jm, '@/lib/sunzi': sz,
    ...over,
  }).POST
  const ask = async (rows: any[], body: any) => { const r = await readingRoute(rows)(post('http://t/api/xtell/reading', { temple: 'sunzi', modelId: 'm1', question: '第一步該做什麼？', situation: '對手降價', ...body })); await r.text(); return { status: r.status, sys: systems.at(-1) ?? '' } }
  const s1 = await ask([row('對手降價', [40], 1, { id: visitId })], { readingId: visitId, lines: [200, 201] })
  check('reading: the saved visit\'s lines reach the 軍師; the client\'s list is ignored', s1.status === 200 && s1.sys.includes(book.lines[40].t) && !s1.sys.includes(book.lines[200].t) && s1.sys.includes('軍師'))
  const s2 = await ask([], { lines: [12, 99999, '<x>'] })
  check('reading without a saved visit: only real book lines, from disk', s2.status === 200 && s2.sys.includes(book.lines[12].t) && !s2.sys.includes('<x>'))
  const s3 = await ask([row('對手降價', [40], 1, { id: visitId, user_id: 'user-b' })], { readingId: visitId })
  check('reading: another visitor\'s visit is not read', s3.status === 200 && !s3.sys.includes(book.lines[40].t))
  // Billing (Sep 29, supabase/114): a charge under a cent is carried, never
  // rounded away (18 answers of a test round were billed nothing) or up.
  const bill = async (costs: number[], carry: Array<number | null>) => {
    const debits: number[] = [], micros: number[] = []
    let i = 0, j = 0
    const POST = readingRoute([], {
      '@/lib/providers': { streamText: async (_m: unknown, _msgs: unknown, cb: any) => { await cb.onDone({ cost: costs[i++] }) } },
      '@/lib/credits': { debitCredits: async (o: any) => { debits.push(o.amountCents) }, accrueFraction: async (_u: string, m: number) => { micros.push(Math.round(m)); return carry[j++] }, InsufficientCreditsError: class extends Error {} },
    })
    for (let k = 0; k < costs.length; k++) { const r = await POST(post('http://t/api/xtell/reading', { temple: 'sunzi', modelId: 'm1', question: 'q', situation: '對手降價' })); await r.text() }
    return { debits, micros }
  }
  const b1 = await bill([0.0004, 0.0004, 0.0093], [0, 0, 1])
  check('each answer\'s cost joins the carry in millionths of a dollar; a cent is debited only when one is due', b1.micros.join() === '400,400,9300' && b1.debits.join() === '1')
  const b2 = await bill([0.0004, 0.012], [null, null])
  check('without the carry (migration 114 not run) the old rounding stands: nothing under half a cent', b2.debits.join() === '1')
  const b3 = await bill([0.0349], [3])
  check('a larger charge bills its whole cents and carries the rest', b3.micros[0] === 34900 && b3.debits.join() === '3')
  // Japanese pages (Sep 30): the listed Chinese terms are replaced as the
  // answer streams, even when a word arrives in two pieces.
  const said = async (body: any) => {
    const POST = readingRoute([], { '@/lib/providers': { streamText: async (_m: unknown, _msgs: unknown, cb: any) => { for (const d of ['まず白', '話訳：戦う前に勝つ。', 'それから長い説明が続きます。']) cb.onDelta(d); await cb.onDone({ cost: 0 }) } } })
    const r = await POST(post('http://t/api/xtell/reading', { temple: 'sunzi', modelId: 'm1', situation: '對手降價', ...body }))
    return (await r.text()).split('\n').filter((l: string) => l.startsWith('data:')).map((l: string) => { try { return JSON.parse(l.slice(5)).text ?? '' } catch { return '' } }).join('')
  }
  check('a Japanese answer streams with its terms replaced, whole to the last character', await said({ lang: 'ja', question: 'まず何をすべきですか？' }) === 'まず現代語訳：戦う前に勝つ。それから長い説明が続きます。')
  check('…but not when the visitor wrote in Chinese, or on another page language', (await said({ lang: 'ja', question: '第一步該做什麼？' })).includes('白話訳') && (await said({ lang: 'zh-Hant', question: 'まず何を' })).includes('白話訳'))
  const mig = fs.readFileSync(path.join(__dirname, '..', 'supabase', '114_credit_fractions.sql'), 'utf8')
  check('114: the carry is service-role only, by name', /revoke all on function public\.accrue_fraction\(uuid, bigint\) from public, anon, authenticated/.test(mig) && /grant execute on function public\.accrue_fraction\(uuid, bigint\) to service_role/.test(mig) && /enable row level security/.test(mig))

  const r7 = await readingRoute([])(post('http://t/api/xtell/reading', { temple: 'sunzi', modelId: 'm1', question: 'q', situation: ' ' }))
  check('reading: a missing situation is refused', r7.status === 400 && (await r7.json() as any).code === 'situation_required')
}

// ── The street, the catalog, the strings ───────────────────────────────────
{
  check('the room is live in the catalog, free lookup, paid teacher', liveFeature('sunzi')?.temple === 'sunzi' && liveFeature('sunzi')!.free.includes('lookup') && liveFeature('sunzi')!.paid === 'teacher')
  check('every market lists it once', LANGS.every(l => displayTemples(l).filter(k => k === 'sunzi').length === 1))
  const keys = Object.keys(STRINGS).filter(k => /\bsunzi\b|situation_/.test(k))
  check('its strings exist in five languages', keys.length >= 25 && keys.every(k => LANGS.every(l => typeof (STRINGS as any)[k]?.[l] === 'string' && (STRINGS as any)[k][l].trim())), String(keys.length))
  check('no em dashes in its strings', !keys.some(k => LANGS.some(l => /—/.test((STRINGS as any)[k][l]))))
  check('the art exists: icon, clear icon, portrait, share picture', ['approved/sunzi-icon.avif', 'approved/sunzi-icon-clear.avif', 'approved/sunzi-portrait.avif', 'og/sunzi.jpg'].every(f => fs.existsSync(path.join(__dirname, '..', 'public', 'xtell', f))))
}

routes().then(() => {
  console.log(fails ? `\n${fails} FAILED` : '\nall 孫子兵法 checks passed')
  if (fails) process.exit(1)
}).catch(e => { console.error(e); process.exit(1) })
