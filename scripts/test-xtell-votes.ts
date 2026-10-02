// scripts/test-xtell-votes.ts — 👍 / 👎 on a teacher's answer and the share
// counter (Oct 1, supabase/122): what a share report may say, the vote route
// (own visit only, the session's user, replace and take back, 503 before the
// migration), the share report in /api/visit (the visit log's rules), the
// share dialog's counting, the room's buttons, the admin cards and the
// strings. No network, no database: both are stubbed.
//   npx tsx scripts/test-xtell-votes.ts

import * as ts from 'typescript'
import vm from 'node:vm'
import fs from 'node:fs'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import * as fb from '../lib/xtell-feedback'
import { STRINGS } from '../lib/i18n'
import { voteLines, shareLines } from '../app/admin/traffic/data'

let fails = 0
const check = (name: string, cond: boolean, extra = '') => { if (!cond) { fails++; console.log('FAIL', name, extra) } else console.log('ok  ', name) }
const LANGS = ['en', 'zh-Hant', 'zh-Hans', 'ja', 'ko'] as const
const read = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')

function loadRoute(file: string, modules: Record<string, unknown>) {
  const js = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const exports: any = {}
  vm.runInNewContext(js, {
    exports, console: { ...console, warn: () => {} }, process, Response, Request, URL, crypto: globalThis.crypto,
    require: (name: string) => { if (!(name in modules)) throw new Error('unexpected route dependency: ' + name); return modules[name] },
  }, { filename: file })
  return exports
}

const UID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const VISIT = '00000000-0000-4000-8000-00000000abcd'
const QID = '11111111-2222-4333-8444-555555555555'
const MODEL = '00000000-0000-4000-8000-00000000000a'

// ── What a share report may say ────────────────────────────────────────────
{
  const ok = fb.asShareReport({ kind: 'answer', temple: 'bazi', modelId: MODEL, method: 'save', outcome: 'done' })
  check('share report: an answer keeps its temple and teacher', ok?.kind === 'answer' && ok.temple === 'bazi' && ok.model_id === MODEL && ok.method === 'save' && ok.outcome === 'done')
  check('share report: only an answer has a teacher', fb.asShareReport({ kind: 'almanac', modelId: MODEL, method: 'copy', outcome: 'done' })?.model_id === null)
  check('share report: unknown kind, method or outcome is no report', fb.asShareReport({ kind: 'chart', method: 'save', outcome: 'done' }) === null
    && fb.asShareReport({ kind: 'answer', method: 'mail', outcome: 'done' }) === null && fb.asShareReport({ kind: 'answer', method: 'save', outcome: 'maybe' }) === null && fb.asShareReport('x') === null)
  check('share report: a temple or teacher of the wrong shape is dropped, not stored', (() => { const r = fb.asShareReport({ kind: 'answer', temple: 'Bazi; drop', modelId: 'x', method: 'share', outcome: 'cancelled' }); return r?.temple === null && r.model_id === null })())
  check('a vote is 1, -1 or 0 (take it back), nothing else', fb.asVote(1) === 1 && fb.asVote(-1) === -1 && fb.asVote(0) === 0 && fb.asVote(2) === null && fb.asVote('1') === null)
}

// ── The vote route ─────────────────────────────────────────────────────────
type Call = { op: string; table: string; values?: any; filters: any[]; onConflict?: string }
function voteRoute(opts: { user?: string | null; visit?: any; missing?: boolean; votes?: any[] }) {
  const calls: Call[] = []
  const query = (table: string, result: () => any) => {
    const c: Call = { op: 'select', table, filters: [] }
    const q: any = {
      select: () => q, is: (k: string, v: unknown) => { c.filters.push([k, v]); return q }, maybeSingle: () => q,
      eq: (k: string, v: unknown) => { c.filters.push([k, v]); return q },
      match: (m: Record<string, unknown>) => { c.filters.push(...Object.entries(m)); return q },
      delete: () => { c.op = 'delete'; return q },
      upsert: (v: any, o: any) => { c.op = 'upsert'; c.values = v; c.onConflict = o?.onConflict; return q },
      then: (resolve: any, reject: any) => { calls.push(c); return Promise.resolve(result()).then(resolve, reject) },
    }
    return q
  }
  const missing = { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.xtell_answer_votes' in the schema cache" } }
  const session = {
    auth: { getUser: async () => ({ data: { user: opts.user === null ? null : { id: opts.user ?? UID } } }) },
    from: (t: string) => query(t, () => ({ data: opts.visit ?? null, error: null })),
  }
  const admin = { from: (t: string) => query(t, () => opts.missing ? missing : { data: opts.votes ?? [], error: null }) }
  const { GET, POST } = loadRoute('app/api/xtell/vote/route.ts', {
    '@/lib/supabase-server': { createSupabaseServer: async () => session },
    '@/lib/xtell-admin': { xtellAdmin: () => admin, dailyMissing: (e: any) => !!e && e.code === 'PGRST205' },
    '@/lib/xtell-feedback': fb,
  })
  const post = (body: unknown) => POST(new Request('http://t/api/xtell/vote', { method: 'POST', headers: { 'content-type': 'application/json', 'x-vercel-ip-country': 'TW' }, body: JSON.stringify(body) })) as Promise<Response>
  const get = (id: string) => GET(new Request(`http://t/api/xtell/vote?readingId=${id}`)) as Promise<Response>
  return { calls, post, get }
}
const visitWith = (turns: any[]) => ({ temple: 'bazi', turns })
const answered = visitWith([{ role: 'user', content: 'q', qid: QID }, { role: 'assistant', content: 'a', qid: QID, modelId: MODEL }])
const good = { readingId: VISIT, qid: QID, modelId: MODEL, vote: 1 }

async function routes() {
  check('vote: signed out is 401', (await voteRoute({ user: null }).post(good)).status === 401)
  const bad = voteRoute({ visit: answered })
  const statuses = await Promise.all([{ ...good, vote: 2 }, { ...good, qid: 'x' }, { ...good, modelId: '' }, { ...good, readingId: 'nope' }].map(b => bad.post(b).then(r => r.status)))
  check('vote: a bad vote or id is 400, nothing written', statuses.every(s => s === 400) && bad.calls.length === 0, statuses.join())

  const none = voteRoute({ visit: null })
  check('vote: a visit that is not the caller\'s (RLS returns nothing) is 404, nothing written', (await none.post(good)).status === 404 && !none.calls.some(c => c.table === 'xtell_answer_votes'))
  const other = voteRoute({ visit: visitWith([{ role: 'user', content: 'q', qid: QID }, { role: 'assistant', content: 'a', qid: QID, modelId: '00000000-0000-4000-8000-00000000000b' }]) })
  check('vote: an answer not in the visit (another teacher, another question) is 404', (await other.post(good)).status === 404 && !other.calls.some(c => c.table === 'xtell_answer_votes'))

  const up = voteRoute({ visit: answered })
  const r1 = await up.post({ ...good, userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' })
  const read = up.calls.find(c => c.table === 'xtell_readings')!, write = up.calls.find(c => c.table === 'xtell_answer_votes')!
  check('vote: the visit is read with the caller\'s session, own and not deleted', !!read && read.filters.some(([k, v]) => k === 'id' && v === VISIT) && read.filters.some(([k, v]) => k === 'user_id' && v === UID) && read.filters.some(([k, v]) => k === 'deleted_at' && v === null))
  check('vote: stored for the session\'s user (never the body\'s), with temple, country and env', r1.status === 200 && write.op === 'upsert' && write.values.user_id === UID
    && write.values.reading_id === VISIT && write.values.qid === QID && write.values.model_id === MODEL && write.values.vote === 1 && write.values.temple === 'bazi' && write.values.country === 'TW' && typeof write.values.env === 'string')
  check('vote: one per person per answer (the upsert target)', write.onConflict === 'user_id,reading_id,qid,model_id')

  const back = voteRoute({ visit: answered })
  await back.post({ ...good, vote: 0 })
  const del = back.calls.find(c => c.table === 'xtell_answer_votes')!
  check('vote: 0 takes it back (a delete of that one row)', del.op === 'delete' && del.filters.some(([k, v]) => k === 'user_id' && v === UID) && del.filters.some(([k, v]) => k === 'model_id' && v === MODEL) && del.filters.some(([k, v]) => k === 'qid' && v === QID))

  check('vote: before migration 122, 503 votes_unavailable', (await voteRoute({ visit: answered, missing: true }).post(good)).status === 503 && (await voteRoute({ missing: true }).get(VISIT)).status === 503)
  const g = voteRoute({ votes: [{ qid: QID, model_id: MODEL, vote: -1 }] })
  const gr = await g.get(VISIT), gd = await gr.json() as any
  check('vote GET: the caller\'s own votes in that visit', gr.status === 200 && gd.votes[0].modelId === MODEL && gd.votes[0].vote === -1
    && g.calls[0].filters.some(([k, v]: any) => k === 'user_id' && v === UID) && g.calls[0].filters.some(([k, v]: any) => k === 'reading_id' && v === VISIT))
  check('vote GET: signed out 401, a bad id 400', (await voteRoute({ user: null }).get(VISIT)).status === 401 && (await voteRoute({}).get('x')).status === 400)

  // ── The share report in /api/visit ───────────────────────────────────────
  const inserts: Array<{ table: string; values: any }> = []
  const { POST: visit } = loadRoute('app/api/visit/route.ts', {
    'next/server': { NextResponse, NextRequest },
    '@supabase/supabase-js': { createClient: () => ({ from: (table: string) => ({ insert: async (values: any) => { inserts.push({ table, values }); return { error: null } } }), rpc: async () => ({ error: null }) }) },
    '@/lib/supabase-server': { createSupabaseServer: async () => ({ auth: { getClaims: async () => ({ data: null }) } }) },
    '@/lib/consent': require('../lib/consent'),
    '@/lib/signin-tap': { TAP_PROVIDERS: new Set(['google']) },
    '@/lib/xtell-feedback': fb,
  })
  const report = (body: unknown, headers: Record<string, string> = {}) => visit(new NextRequest('https://xtell.modelxd.com/api/visit', {
    method: 'POST', body: JSON.stringify(body),
    headers: { 'user-agent': 'Mozilla/5.0 (iPhone)', 'x-vercel-ip-country': 'TW', 'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 250)}`, cookie: 'modelxd_vid=22222222-2222-4222-8222-222222222222', host: 'xtell.modelxd.com', ...headers },
  })) as Promise<Response>
  await report({ share: { kind: 'answer', temple: 'bazi', modelId: MODEL, method: 'save', outcome: 'cancelled' }, path: '/xtell' })
  const row = inserts.find(i => i.table === 'xtell_shares')?.values
  check('share report: one row in xtell_shares with what, temple, teacher, how, ending, browser, country', !!row && row.kind === 'answer' && row.temple === 'bazi' && row.model_id === MODEL
    && row.method === 'save' && row.outcome === 'cancelled' && row.visitor_id === '22222222-2222-4222-8222-222222222222' && row.country === 'TW' && row.host === 'xtell.modelxd.com' && row.path === '/xtell')
  const n = inserts.length
  await report({ share: { kind: 'answer', method: 'save', outcome: 'done' } }, { 'x-vercel-ip-country': 'DE' })
  await report({ share: { kind: 'answer', method: 'save', outcome: 'done' } }, { 'user-agent': 'Googlebot/2.1' })
  await report({ share: { kind: 'nope', method: 'save', outcome: 'done' } })
  check('share report: nothing from the EEA, no crawlers, no malformed report', inserts.length === n)
  const res = await report({ share: { kind: 'tarot', temple: 'tarot', method: 'copy', outcome: 'done' } })
  check('share report: always 204, and no visit row written for it', res.status === 204 && inserts.slice(n).every(i => i.table === 'xtell_shares'))
}

function wiring() {
  const share = read('app/components/xtell/ShareButton.tsx')
  check('share dialog: 分享… and 存到相簿 count completed or closed from the sheet', /navigator\.share\(data\)\.then\(\(\) => count\(method, 'done'\)/.test(share) && /AbortError' \? 'cancelled' : 'failed'/.test(share)
    && /sheet\(\{ files: \[file\], text:/.test(share) && /sheet\(\{ files: \[file\] \}, 'save'\)/.test(share))
  check('share dialog: a download and a copied link count too', /download\(\); count\('download', 'done'\)/.test(share) && /count\('copy', 'done'\)/.test(share) && /count\('copy', 'failed'\)/.test(share))
  check('share dialog: counted only when the picture says what it is', /if \(spec\.log\) countShare\(spec\.log, method, outcome\)/.test(share))
  const sites = read('app/xtell/client.tsx') + read('app/components/xtell/XTellDaily.tsx') + read('app/components/xtell/XTellToday.tsx')
  const kinds = [...sites.matchAll(/log: \{ kind: '(\w+)'/g)].map(m => m[1]).sort()
  check('every share button says what it shares', kinds.join() === 'almanac,answer,cookie,daily,qian,tarot' && (sites.match(/<ShareButton/g) ?? []).length === 6, kinds.join())
  check('an answer\'s share names its teacher', /log: \{ kind: 'answer', temple, modelId: tn\.modelId \}/.test(sites))

  const client = read('app/xtell/client.tsx')
  check('room: buttons only once the vote route answers for a saved visit', /setVotes\(\{\}\); setVotesOn\(false\)/.test(client) && /if \(!readingId\) return/.test(client) && /setVotesOn\(true\)/.test(client))
  check('room: shown at once, put back if the server refuses', /put\(next\)/.test(client) && /if \(!r\.ok\) put\(before\)/.test(client) && /catch \{ put\(before\) \}/.test(client))
  check('room: pressing the chosen one again takes it back', /next = before === v \? 0 : v/.test(client))
  check('room: under a finished answer only, keyed by its question and teacher', /votesOn && tn\.content && \(typeof tn\.cost === 'number' \|\| typeof tn\.qid === 'string'\)/.test(client) && /votes\[`\$\{\(round\.user as any\)\.qid\}:\$\{tn\.modelId\}`\]/.test(client))
  const vote = read('app/components/xtell/AnswerVote.tsx')
  check('buttons: a named group, aria-pressed, labelled in words', /role="group" aria-label=\{t\('xtell\.vote\.label'\)\}/.test(vote) && /aria-pressed=\{value === v\}/.test(vote) && /'xtell\.vote\.up' : 'xtell\.vote\.down'/.test(vote))
  check('buttons: 40 px touch targets', /\.xtell-vote-btn \{[^}]*width: 40px; height: 40px/.test(read('app/globals.css')))

  // Admin.
  const lines = voteLines([{ temple: 'bazi', model_id: MODEL, up: 1, down: 0, people: 1 }, { temple: 'tarot', model_id: 'ffffffff-0000-4000-8000-000000000000', up: 3, down: 2, people: 4 }], { [MODEL]: 'GPT-6 Luna' })
  check('admin votes: named teachers, most votes first; an unknown model shows its id', lines[0].temple === 'tarot' && lines[0].model === 'ffffffff' && lines[1].model === 'GPT-6 Luna')
  const sl = shareLines([
    { kind: 'answer', temple: 'bazi', method: 'save', outcome: 'done', shares: 2, browsers: 2 },
    { kind: 'answer', temple: 'bazi', method: 'save', outcome: 'cancelled', shares: 3, browsers: 1 },
    { kind: 'almanac', temple: null, method: 'copy', outcome: 'done', shares: 1, browsers: 1 },
  ])
  check('admin shares: one line per what, temple and how, endings side by side', sl.length === 2 && sl[0].done === 2 && sl[0].cancelled === 3 && sl[1].temple === '' && sl[1].done === 1)
  const page = read('app/admin/traffic/page.tsx'), view = read('app/admin/traffic/TrafficView.tsx')
  check('admin: both windows asked with the range and the country', /rpc\('xtell_vote_window', \{ p_days: days, p_tz: TZ, p_country: wanted \}\)/.test(page) && /rpc\('xtell_share_window', \{ p_days: days, p_tz: TZ, p_country: wanted \}\)/.test(page))
  check('admin: the two cards, and a line instead before 122', /title="XTell teacher votes"/.test(view) && /title="XTell shares"/.test(view) && /NEEDS_122/.test(view))

  const mig = read('supabase/122_xtell_votes_shares.sql')
  check('migration: both tables and both functions revoked by name; votes outlive deletions as counts', /revoke all on table public\.xtell_answer_votes from public, anon, authenticated/.test(mig) && /revoke all on table public\.xtell_shares from public, anon, authenticated/.test(mig)
    && /revoke all on function public\.xtell_vote_window\(integer, text, text\) from public, anon, authenticated/.test(mig) && /revoke all on function public\.xtell_share_window\(integer, text, text\) from public, anon, authenticated/.test(mig)
    && /references auth\.users\(id\) on delete set null/.test(mig) && /references public\.xtell_readings\(id\) on delete set null/.test(mig))

  for (const k of ['xtell.vote.label', 'xtell.vote.up', 'xtell.vote.down']) {
    const s = (STRINGS as any)[k]
    check(`strings: ${k} in every language`, !!s && LANGS.every(l => typeof s[l] === 'string' && s[l].length > 1 && !s[l].includes('—')))
  }
}

routes().then(() => { wiring(); console.log(fails ? `\n${fails} FAILED` : '\nall ok'); process.exit(fails ? 1 : 0) })
