// scripts/test-xoracle-wall.ts — 觀音廟's 廟外 (Oct 22, supabase/151,
// docs/GUANYIN-HANGING-PLAN.md): the wish rules, what the wall may show, the
// tie route (own visit, number from the visit and grade from disk, one per
// visit), the wish route (every check before the debit, a refund when the
// write fails, nothing charged on a refusal), the report route, the room's
// mount points and the words in five languages. No network, no database:
// both are stubbed.
//   npx tsx scripts/test-xoracle-wall.ts

import * as ts from 'typescript'
import vm from 'node:vm'
import fs from 'node:fs'
import path from 'node:path'
import * as wall from '../lib/xoracle-wall'
import * as xo from '../lib/xoracle'
import { WALL_COPY, wallWords } from '../app/components/xoracle/wall-copy'

let fails = 0
const check = (name: string, cond: boolean, extra = '') => { if (!cond) { fails++; console.log('FAIL', name, extra) } else console.log('ok  ', name) }
const LANGS = ['en', 'zh-Hant', 'zh-Hans', 'ja', 'ko'] as const
const read = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')

function loadRoute(file: string, modules: Record<string, unknown>) {
  const js = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const exports: any = {}
  vm.runInNewContext(js, {
    exports, console: { ...console, warn: () => {}, error: () => {} }, process, Response, Request, URL, crypto: globalThis.crypto, Date,
    require: (name: string) => { if (!(name in modules)) throw new Error('unexpected route dependency: ' + name); return modules[name] },
  }, { filename: file })
  return exports
}

// ── The wish rules ─────────────────────────────────────────────────────────
{
  const ok = (s: string) => wall.wishProblem(wall.cleanWish(s)) === null
  const contact = (s: string) => wall.wishProblem(wall.cleanWish(s)) === 'contact'
  check('wish: ordinary wishes pass, in every language', ['希望媽媽手術順利', '明年考上台大', '2027年考上理想的學校', '數學考100分', 'I hope my dog gets better soon', '家族みんなが健康でありますように', '우리 가족 모두 건강하게 해 주세요', '希望大谷翔平拿MVP'].every(ok))
  check('wish: empty and 61 characters are refused', wall.wishProblem('') === 'empty' && wall.wishProblem('願'.repeat(61)) === 'too_long' && wall.wishProblem('願'.repeat(60)) === null)
  check('wish: phone numbers, emails, links and handles are refused',
    ['打給我 0912-345-678', '0912345678', 'mail me a.b@gmail.com', '看 https://x.com/abc', 'www.example.com', 'abc.com.tw 見', '追蹤 @lucky_cat', 'LINE ID: abc123', 'ig：hello'].every(contact))
  check('wish: addresses are refused (Taiwan, Japan, Korea)', ['住中正路100號', '民生東路 5 巷', '新宿3丁目', '1-2-3 に住む', '테헤란로 123'].every(contact))
  check('wish: full-width digits count as digits (NFKC)', contact('０９１２３４５６７８'))
  check('wish: invisible characters and runs of blanks are folded', wall.cleanWish('  希望​平安 \n\n\n 順利  ') === '希望平安\n順利')
  check('wish: characters counted as Postgres counts them (code points)', wall.charCount('🙏願望') === 3 && wall.charCount('願'.repeat(60)) === 60)
  check('wish: stamps and report reasons are fixed lists', wall.asWishFor('health') === 'health' && wall.asWishFor('money') === null && wall.asReason('spam') === 'spam' && wall.asReason('nonsense') === null)
  check('price: a wish is ten cents, a year; a stick 30 days', wall.WISH_CENTS === 10 && wall.WISH_DAYS === 365 && wall.STICK_DAYS === 30 && wall.WISH_MAX === 60)
  check('grades: 凶 and 下 are bad; 吉, 末吉, 上上 and a blank slip are not', wall.badLuck('凶') && wall.badLuck('下下') && !wall.badLuck('末吉') && !wall.badLuck('上上') && !wall.badLuck('') && !wall.badLuck(undefined))
  const gansan = Array.from({ length: 100 }, (_, i) => xo.qianOf(i + 1, 'guanyin', 'gansan')?.luck)
  const yibai = Array.from({ length: 100 }, (_, i) => xo.qianOf(i + 1, 'guanyin', 'yibai')?.luck)
  check('grades: 30 of 元三大師\'s 100 are 凶 (the strong offer); the 觀音一百籤 prints none', gansan.filter(wall.badLuck).length === 30 && yibai.filter(wall.badLuck).length === 0)
}

// ── What the wall may show ─────────────────────────────────────────────────
{
  check('wall: the public columns hold no user or visit', !/user_id|reading_id|hidden|taken_down|report/.test(wall.WALL_COLUMNS))
  const row = { id: 'x1', kind: 'wish', user_id: 'secret', reading_id: 'visit', wish_text: '平安', wish_for: 'peace', sealed: true, fulfilled_at: null, lang: 'zh-Hant', created_at: '2026-10-22T00:00:00Z', down_at: '2027-10-22T00:00:00Z' }
  const pub = wall.wallItem(row)
  check('wall: a sealed plaque comes without its words', pub.text === null && pub.sealed === true && pub.wishFor === 'peace')
  check('wall: no user id or visit leaves, whatever the row holds', !JSON.stringify(pub).includes('secret') && !JSON.stringify(pub).includes('visit'))
  const mine = wall.myItem({ ...row, taken_down_at: null, hidden_at: null })
  check('wall: the writer reads their own sealed plaque', mine.text === '平安' && mine.mine === true && wall.isUp(mine, Date.parse('2026-11-01')) && !wall.isUp(mine, Date.parse('2027-11-01')))
  const stick = wall.wallItem({ id: 's1', kind: 'stick', edition: 'gansan', stick_no: 37, luck: '凶', lang: 'ja', created_at: '2026-10-22T00:00:00Z' })
  check('wall: a stick is its number, edition and grade', stick.n === 37 && stick.edition === 'gansan' && stick.luck === '凶' && stick.text === undefined)
}

// ── Routes ─────────────────────────────────────────────────────────────────
const UID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const VISIT = '00000000-0000-4000-8000-00000000abcd'
type Call = { op: string; table: string; values?: any; filters: [string, unknown][]; head?: boolean }

/** A Supabase stand-in: every query is recorded; `answer` decides its result. */
function fakeDb(answer: (c: Call) => any, calls: Call[]) {
  const query = (table: string) => {
    const c: Call = { op: 'select', table, filters: [] }
    const q: any = {}
    for (const k of ['eq', 'is', 'gte', 'gt', 'lt']) q[k] = (f: string, v: unknown) => { c.filters.push([`${k}:${f}`, v]); return q }
    q.select = (_cols?: string, o?: any) => { if (o?.head) c.head = true; return q }
    q.order = () => q; q.limit = () => q; q.maybeSingle = () => q; q.single = () => q
    q.insert = (v: any) => { c.op = 'insert'; c.values = v; return q }
    q.update = (v: any) => { c.op = 'update'; c.values = v; return q }
    q.then = (res: any, rej: any) => { calls.push(c); return Promise.resolve(answer(c)).then(res, rej) }
    return q
  }
  return { from: query, rpc: (fn: string, args: any) => { const c: Call = { op: 'rpc', table: fn, values: args, filters: [] }; calls.push(c); return Promise.resolve(answer(c)) } }
}
const missingFn = (e: any) => !!e && e.code === 'PGRST205'

function tieRoute(opts: { user?: string | null; visit?: any; existing?: any; today?: number; insertError?: any }) {
  const calls: Call[] = []
  const session = { auth: { getUser: async () => ({ data: { user: opts.user === null ? null : { id: opts.user ?? UID } } }) },
    from: (t: string) => fakeDb(() => ({ data: opts.visit ?? null, error: null }), calls).from(t) }
  const admin = fakeDb(c => {
    if (c.op === 'insert') return opts.insertError ? { data: null, error: opts.insertError } : { data: { ...c.values, id: 'new', taken_down_at: null, hidden_at: null }, error: null }
    if (c.head) return { count: opts.today ?? 0, error: null }
    return { data: opts.existing ?? null, error: null }
  }, calls)
  const { POST } = loadRoute('app/api/xoracle/wall/tie/route.ts', {
    '@/lib/supabase-server': { createSupabaseServer: async () => session },
    '@/lib/xoracle-admin': { xoracleAdmin: () => admin, dailyMissing: missingFn },
    '@/lib/xoracle': xo, '@/lib/xoracle-wall': wall,
  })
  const post = (body: unknown) => POST(new Request('http://t/api/xoracle/wall/tie', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })) as Promise<Response>
  return { calls, post }
}

function wishRoute(opts: { user?: string | null; email?: string; check?: string; poor?: boolean; insertError?: any; today?: number; row?: any }) {
  const calls: Call[] = [], money: string[] = [], checked: boolean[] = []
  const session = { auth: { getUser: async () => ({ data: { user: opts.user === null ? null : { id: opts.user ?? UID, email: opts.email ?? 'someone@example.com' } } }) } }
  const admin = fakeDb(c => {
    if (c.op === 'insert') return opts.insertError ? { data: null, error: opts.insertError } : { data: { ...c.values, taken_down_at: null, hidden_at: null }, error: null }
    if (c.op === 'update') return { data: { ...(opts.row ?? {}), ...c.values, lang: 'en', created_at: '2026-10-22T00:00:00Z', down_at: '2027-10-22T00:00:00Z' }, error: null }
    if (c.head) return { count: opts.today ?? 0, error: null }
    return { data: opts.row ?? null, error: null }
  }, calls)
  class InsufficientCreditsError extends Error {}
  const { POST, PATCH } = loadRoute('app/api/xoracle/wall/wish/route.ts', {
    '@/lib/supabase-server': { createSupabaseServer: async () => session },
    '@/lib/xoracle-admin': { xoracleAdmin: () => admin, dailyMissing: missingFn },
    '@/lib/admin': { isAdminEmail: (e: string) => e === 'boss@example.com' },
    '@/lib/credits': {
      InsufficientCreditsError,
      debitCredits: async (o: any) => { if (opts.poor) throw new InsufficientCreditsError('insufficient_credits'); money.push(`debit ${o.amountCents} ${o.referenceType} ${o.referenceId}`); return 990 },
      grantCredits: async (o: any) => { money.push(`refund ${o.amountCents} ${o.referenceId}`); return 1000 },
    },
    '@/lib/xoracle-wall-check': { checkWish: async (_t: string, _u: string, open: boolean) => { checked.push(open); return opts.check ?? 'ok' } },
    '@/lib/xoracle-wall': wall,
  })
  const post = (body: unknown) => POST(new Request('http://t/api/xoracle/wall/wish', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })) as Promise<Response>
  const patch = (body: unknown) => PATCH(new Request('http://t/api/xoracle/wall/wish', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })) as Promise<Response>
  return { calls, money, checked, post, patch }
}

async function routes() {
  // Tie
  check('tie: signed out is 401', (await tieRoute({ user: null }).post({ readingId: VISIT })).status === 401)
  check('tie: a bad id is 400', (await tieRoute({}).post({ readingId: 'nope' })).status === 400)
  const none = tieRoute({ visit: null })
  check('tie: a visit that is not the caller\'s is 404, nothing written', (await none.post({ readingId: VISIT })).status === 404 && !none.calls.some(c => c.op === 'insert'))
  check('tie: a visit to another temple is 404', (await tieRoute({ visit: { temple: 'guandi', subject: { n: 5 }, chart: {} } }).post({ readingId: VISIT })).status === 404)
  const t = tieRoute({ visit: { temple: 'guanyin', subject: { n: 37, edition: 'gansan', ask: 'secret question' }, chart: { edition: 'gansan', luck: 'forged' } } })
  const tr = await t.post({ readingId: VISIT, lang: 'ja', n: 1, luck: '大吉', userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' })
  const ins = t.calls.find(c => c.op === 'insert')!
  const visitRead = t.calls.find(c => c.table === 'xtell_readings')!
  check('tie: the visit is read with the caller\'s session, own and not deleted', visitRead.filters.some(([k, v]) => k === 'eq:user_id' && v === UID) && visitRead.filters.some(([k, v]) => k === 'is:deleted_at' && v === null))
  check('tie: number and edition from the visit, grade from disk, never the body', tr.status === 200 && ins.values.stick_no === 37 && ins.values.edition === 'gansan' && ins.values.luck === xo.qianOf(37, 'guanyin', 'gansan')!.luck && ins.values.user_id === UID)
  check('tie: the question never goes up', !JSON.stringify(ins.values).includes('secret question'))
  check('tie: 30 days on the wall', Math.round((Date.parse(ins.values.down_at) - Date.parse(ins.values.created_at)) / 86_400_000) === 30)
  const again = tieRoute({ visit: { temple: 'guanyin', subject: { n: 37, edition: 'gansan' } }, existing: { id: 'old', kind: 'stick', stick_no: 37, edition: 'gansan', luck: '凶', lang: 'ja', created_at: '2026-10-22T00:00:00Z', down_at: '2026-11-21T00:00:00Z' } })
  const ar = await again.post({ readingId: VISIT }); const aj = await ar.json() as any
  check('tie: a second tie of the same visit answers the first, writes nothing', ar.status === 200 && aj.already === true && aj.item.id === 'old' && !again.calls.some(c => c.op === 'insert'))
  check('tie: 20 a day', (await tieRoute({ visit: { temple: 'guanyin', subject: { n: 3 } }, today: 20 }).post({ readingId: VISIT })).status === 429)
  check('tie: before 151, 503', (await tieRoute({ visit: { temple: 'guanyin', subject: { n: 3 } }, insertError: { code: 'PGRST205', message: 'schema cache' } }).post({ readingId: VISIT })).status === 503)

  // Wish
  const good = { text: '希望媽媽手術順利', wishFor: 'health', sealed: false, lang: 'zh-Hant' }
  check('wish: signed out is 401', (await wishRoute({ user: null }).post(good)).status === 401)
  const bad = wishRoute({})
  const st = await Promise.all([{ ...good, text: '' }, { ...good, text: '願'.repeat(61) }, { ...good, text: '打給我 0912345678' }].map(b => bad.post(b).then(r => r.status)))
  check('wish: empty, too long and contact details are 400, nothing checked, charged or written', st.every(s => s === 400) && bad.checked.length === 0 && bad.money.length === 0 && !bad.calls.some(c => c.op === 'insert'))
  for (const [verdict, status] of [['refused', 422], ['names_person', 422], ['personal_info', 422], ['harm', 422], ['ad', 422], ['unavailable', 503]] as const) {
    const r = wishRoute({ check: verdict })
    const res = await r.post(good)
    check(`wish: a check that says ${verdict} is ${status}, nothing charged or written`, res.status === status && r.money.length === 0 && !r.calls.some(c => c.op === 'insert'))
  }
  const w = wishRoute({})
  const wr = await w.post({ ...good, userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' })
  const wi = w.calls.find(c => c.op === 'insert')!
  check('wish: checked as an open plaque, then 10¢ debited, then written', wr.status === 200 && w.checked[0] === true && w.money.length === 1 && /^debit 10 xtell wish:/.test(w.money[0]) && wi.values.price_cents === 10)
  check('wish: written for the session\'s user, the ledger id is the row id', wi.values.user_id === UID && w.money[0].endsWith(wi.values.id))
  check('wish: a year on the wall', Math.round((Date.parse(wi.values.down_at) - Date.parse(wi.values.created_at)) / 86_400_000) === 365)
  const sealedRoute = wishRoute({})
  await sealedRoute.post({ ...good, sealed: true })
  check('wish: a sealed plaque is checked as not open', sealedRoute.checked[0] === false && sealedRoute.calls.find(c => c.op === 'insert')?.values.sealed === true)
  const poor = wishRoute({ poor: true })
  check('wish: not enough credit is 402, nothing written', (await poor.post(good)).status === 402 && !poor.calls.some(c => c.op === 'insert'))
  const broken = wishRoute({ insertError: { code: 'XX000', message: 'boom' } })
  const br = await broken.post(good)
  check('wish: a failed write is refunded at once', br.status === 500 && broken.money.length === 2 && broken.money[1].startsWith('refund 10 wish:') && broken.money[0].endsWith(broken.money[1].split(' ')[2]))
  check('wish: ten a day', (await wishRoute({ today: 10 }).post(good)).status === 429)

  const own = { id: '11111111-2222-4333-8444-555555555555', kind: 'wish', user_id: UID, wish_text: '平安', sealed: true }
  const open = wishRoute({ row: own, check: 'names_person' })
  check('wish: opening a sealed plaque runs the checks again', (await open.patch({ id: own.id, action: 'open' })).status === 422 && open.checked[0] === true && !open.calls.some(c => c.op === 'update'))
  const take = wishRoute({ row: own })
  const tk = await take.patch({ id: own.id, action: 'take_down' })
  const read2 = take.calls.find(c => c.op === 'select')!
  check('wish: take_down on one\'s own plaque, read by the session\'s user', tk.status === 200 && read2.filters.some(([k, v]) => k === 'eq:user_id' && v === UID) && !!take.calls.find(c => c.op === 'update')?.values.taken_down_at && take.money.length === 0)
  check('wish: hide is for admins only', (await wishRoute({ row: own }).patch({ id: own.id, action: 'hide' })).status === 403)
  const boss = wishRoute({ row: { ...own, user_id: 'someone-else' }, email: 'boss@example.com' })
  const bh = await boss.patch({ id: own.id, action: 'hide' })
  check('wish: an admin hides anyone\'s plaque', bh.status === 200 && boss.calls.find(c => c.op === 'update')?.values.hidden_by === 'admin' && !boss.calls.find(c => c.op === 'select')!.filters.some(([k]) => k === 'eq:user_id'))

  // Report
  const reportRoute = (err: any, data: any = [{ reports: 1, is_hidden: false }], user: string | null = UID) => {
    const calls: Call[] = []
    const { POST } = loadRoute('app/api/xoracle/wall/report/route.ts', {
      '@/lib/supabase-server': { createSupabaseServer: async () => ({ auth: { getUser: async () => ({ data: { user: user ? { id: user } : null } }) } }) },
      '@/lib/xoracle-admin': { xoracleAdmin: () => fakeDb(() => ({ data, error: err }), calls), dailyMissing: missingFn },
      '@/lib/xoracle-wall': wall,
    })
    return { calls, post: (b: unknown) => POST(new Request('http://t/r', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })) as Promise<Response> }
  }
  const rp = reportRoute(null)
  const rr = await rp.post({ id: own.id, reason: 'personal_info', details: ' 有全名 ', user: 'x' })
  check('report: through the function, for the session\'s user, trimmed', rr.status === 200 && rp.calls[0].table === 'xoracle_report_hanging' && rp.calls[0].values.p_user === UID && rp.calls[0].values.p_details === '有全名')
  check('report: hidden at 3 is passed on', (await (await reportRoute(null, [{ reports: 3, is_hidden: true }]).post({ id: own.id, reason: 'spam' })).json() as any).hidden === true)
  check('report: unknown reason 400, signed out 401', (await reportRoute(null).post({ id: own.id, reason: 'nonsense' })).status === 400 && (await reportRoute(null, null, null).post({ id: own.id, reason: 'spam' })).status === 401)
  check('report: own plaque 400, unknown plaque 404', (await reportRoute({ code: '22023', message: 'own_hanging' }).post({ id: own.id, reason: 'spam' })).status === 400
    && (await reportRoute({ code: 'P0002', message: 'hanging_not_found' }).post({ id: own.id, reason: 'spam' })).status === 404)
}

// ── The room and the words ─────────────────────────────────────────────────
{
  const client = read('app/xoracle/client.tsx')
  check('room: 廟外 under 觀音廟\'s form, the tie offer under its stick, nowhere else', /temple === 'guanyin' && <TempleWall \/>/.test(client) && /temple === 'guanyin' && chart && !savedProblem && typeof chart\.n === 'number'/.test(client))
  const wallSrc = read('app/components/xoracle/TempleWall.tsx')
  check('room: two cards, 結籤處 (with 先抽一支籤 outside a drawn stick) then 許願牌', /xoracle-wall-sticks[\s\S]*drawFirst[\s\S]*xoracle-wall-wishes/.test(wallSrc) && /!embedded && <div[^\n]*drawFirst/.test(wallSrc))
  check('room: 廟外 above the visit history', client.indexOf("temple === 'guanyin' && <TempleWall />") < client.indexOf('<TempleHistory temple={temple}'))
  check('code: no real temple named in the wall\'s files', !/淺草寺|浅草寺|龍山寺|Sensoji|Senso-ji|Longshan/i.test(wallSrc + read('lib/xoracle-wall.ts') + read('lib/xoracle-wall-check.ts')))
  check('room: 許願牌 is a rack, plaques on its hooks, tap to read', /plaque-rack\.avif/.test(wallSrc) && /HOOK_X\[hook\]/.test(wallSrc) && /<PlaqueRack /.test(wallSrc) && !/<PlaqueGrid/.test(wallSrc))
  for (const f of ['rack', 'slip', 'plaque', 'plaque-back', 'plaque-rack']) check(`picture: public/xoracle/wall/${f}.avif is there`, fs.existsSync(path.join(__dirname, '..', 'public/xoracle/wall', `${f}.avif`)))
  let missing: string[] = []
  for (const [table, keys] of Object.entries(WALL_COPY)) for (const [k, words] of Object.entries(keys)) for (const l of LANGS) if (!words[l]?.trim()) missing.push(`${table}.${k}.${l}`)
  check('words: every line in all five languages', missing.length === 0, missing.join(', '))
  const w = wallWords('zh-Hant')
  check('words: refusals by code, an unknown code falls back', w.err('wish_contact').includes('電話') && w.err('mystery') === w.err('failed'))
  const all = JSON.stringify(WALL_COPY)
  check('words: no real temple named', !/龍山寺|淺草寺|浅草寺|Sensoji|Longshan/i.test(all))
  check('words: nothing promises the bad luck is gone', !/化解|消災|転じ|厄落とし|removes? (the )?bad luck|액땜/.test(all))
  const prompt = (xo as any).MASTERS.guanyin as string
  check('master: a tied stick is a fact to acknowledge, never a cure', prompt.includes('綁在廟外') && prompt.includes('不說綁了就化解'))
}

routes().then(() => {
  console.log(fails ? `\n${fails} FAILED` : '\nall passed')
  process.exit(fails ? 1 : 0)
})
