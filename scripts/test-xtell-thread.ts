// scripts/test-xtell-thread.ts — what a master rereads with each question
// (Oct 2, owner: "continue and read all"): each master's own thread, built on
// the server from the visitor's saved conversation (lib/xtell-thread.ts), the
// whole of it up to the token budget, never the old last-20-messages; the
// page's copy only for a conversation that is not saved. No network, no
// database: both stubbed.
//   npx tsx scripts/test-xtell-thread.ts

import * as ts from 'typescript'
import vm from 'node:vm'
import fs from 'node:fs'
import path from 'node:path'
import * as sz from '../lib/sunzi'
import * as jm from '../lib/jiemeng'
import * as xtell from '../lib/xtell'
import * as yijing from '../lib/yijing'
import { threadFor } from '../lib/xtell-thread'
import { fitBudget, approxTokens, HISTORY_TOKENS } from '../lib/conversation-memory'

let fails = 0
const check = (name: string, cond: boolean, extra = '') => { if (!cond) { fails++; console.log('FAIL', name, extra) } else console.log('ok  ', name) }
const read = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')

// ── Threads ────────────────────────────────────────────────────────────────
const A = 'aaaaaaaa-0000-4000-8000-00000000000a', B = 'bbbbbbbb-0000-4000-8000-00000000000b', C = 'cccccccc-0000-4000-8000-00000000000c'
const U = (qid: string, content: string, to?: string[]) => ({ role: 'user', content, qid, ...(to ? { to } : {}) })
const R = (qid: string, modelId: string, content: string) => ({ role: 'assistant', content, qid, modelId })
const turns = [
  U('q1', '問一', [A, B]), R('q1', A, 'A答一'), R('q1', B, 'B答一'),
  U('q2', '只問A', [A]), R('q2', A, 'A答二'), R('q2', C, 'C後來也答二'),
  U('q3', '只問B', [B]),
]
const text = (m: Array<{ content: string }>) => m.map(x => x.content).join('|')
check('a master sees the questions put to it and its own answers, never another master\'s', text(threadFor(turns, A, null)) === '問一|A答一|只問A|A答二')
check('a question put to others is not in a master\'s thread, unless it answered it after joining', text(threadFor(turns, B, null)) === '問一|B答一|只問B' && text(threadFor(turns, C, null)) === '只問A|C後來也答二')
check('a master joining a question already saved sees what came before it, not the question twice', text(threadFor(turns, B, 'q3')) === '問一|B答一' && text(threadFor(turns, C, 'q2')) === '')
check('a question not yet saved (a new one): the whole thread', text(threadFor(turns, A, 'q9')) === text(threadFor(turns, A, null)))
check('junk in the saved list is skipped, not passed on', threadFor([null, { role: 'user' }, { role: 'system', content: 'x' }, U('q', '好')], A, null).length === 1 && threadFor('nope', A, null).length === 0)
check('roles are kept, so the model reads a conversation', threadFor(turns, A, null).map(m => m.role).join() === 'user,assistant,user,assistant')

// ── Budget ─────────────────────────────────────────────────────────────────
check('tokens, roughly: a Chinese or Japanese character about one, Latin about a quarter', approxTokens('天地人') === 3 && approxTokens('abcd') === 1 && approxTokens('こんにちは') === 5)
const long = Array.from({ length: 300 }, (_, i) => ({ role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', content: `${i}:` + '字'.repeat(1000) }))
const fit = fitBudget(long)
check('the budget is far more than 20 messages: about 100 rounds of 1,000-字 answers', fit.kept.length > 90 && fit.kept.length < 110, String(fit.kept.length))
check('past the budget, the newest messages are kept in order, the oldest left out', fit.kept.at(-1)!.content.startsWith('299:') && fit.kept[0].content.startsWith(`${fit.dropped}:`) && fit.dropped + fit.kept.length === 300)
check('the budget is 100k tokens', HISTORY_TOKENS === 100_000 && fit.kept.reduce((n, m) => n + approxTokens(m.content), 0) <= HISTORY_TOKENS)
check('a single message bigger than the budget is still sent (the latest is never dropped)', fitBudget([{ role: 'user', content: '字'.repeat(200) }], 50).kept.length === 1)
check('a short conversation is sent whole', fitBudget(long.slice(0, 40)).dropped === 0)

// ── The reading route ──────────────────────────────────────────────────────
function loadRoute(file: string, modules: Record<string, unknown>) {
  const js = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const exports: any = {}
  const deps: Record<string, unknown> = { 'next/server': { after: () => {} }, ...modules }
  vm.runInNewContext(js, {
    exports, console: { ...console, warn: () => {} }, process, Response, Request, ReadableStream, TextEncoder, crypto: globalThis.crypto, setInterval, clearInterval,
    require: (name: string) => { if (!(name in deps)) throw new Error('unexpected route dependency: ' + name); return deps[name] },
  }, { filename: file })
  return exports
}
const VISIT = '00000000-0000-4000-8000-00000000abcd', ME = 'user-a'
function route(savedTurns: unknown[] | null, owner = ME) {
  const sent: Array<{ role: string; content: string }[]> = []
  const row = savedTurns ? { id: VISIT, user_id: owner, temple: 'sunzi', created_at: new Date().toISOString(), chart: { situation: '對手降價', ask: '', lang: 'zh-Hant', lines: sz.sunziLines([40]), scan: 'x' }, turns: savedTurns } : null
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: ME } } }) },
    rpc: async () => ({ error: null }),
    from() {
      const filters: any[] = []
      const q: any = {
        select: () => q, is: () => q, order: () => q, limit: () => q, single: () => q, maybeSingle: () => q,
        eq: (k: string, v: unknown) => { filters.push([k, v]); return q },
        then: (res: any, rej: any) => Promise.resolve({ data: row && filters.every(([k, v]) => (row as any)[k] === v) ? row : null, error: null }).then(res, rej),
      }
      return q
    },
  }
  const { POST } = loadRoute('app/api/xtell/reading/route.ts', {
    '@/lib/supabase-server': { createSupabaseServer: async () => db },
    '@/lib/xtell-admin': { xtellAdmin: () => { throw new Error('not for temple readings') }, dailyMissing: () => false },
    '@/lib/models': { getModelById: async () => ({ id: A, provider: 'openai', model_name: 'test', display_name: 'Test', enabled: true, blocked_features: [], output_config: { text: { capabilities: [], thinking_levels: [] } } }) },
    '@/lib/providers': { streamText: async (_m: unknown, msgs: any, cb: any) => { sent.push(msgs); cb.onDone({ cost: 0, inputTokens: 1234 }) } },
    '@/lib/credits': { debitCredits: async () => {}, accrueFraction: async () => null, InsufficientCreditsError: class extends Error {} },
    '@/lib/provider-errors': { sanitizeProviderError: (m: string) => m },
    '@/lib/xtell': xtell, '@/lib/classics': { classicsBlock: () => '' }, '@/lib/yijing': yijing, '@/lib/xtell-daily': require('../lib/xtell-daily'), '@/lib/tarot': require('../lib/tarot'), '@/lib/xtell-cookie': require('../lib/xtell-cookie'), '@/lib/kyusei': require('../lib/kyusei'), '@/lib/sukuyo': require('../lib/sukuyo'), '@/lib/xtell-lang-check': require('../lib/xtell-lang-check'), '@/lib/xtell-personality': require('../lib/xtell-personality'), '@/lib/jiemeng': jm, '@/lib/sunzi': sz,
    '@/lib/xtell-thread': require('../lib/xtell-thread'), '@/lib/xtell-memory': require('../lib/xtell-memory'), '@/lib/conversation-memory': require('../lib/conversation-memory'),
  })
  const ask = async (body: any) => { const r = await POST(new Request('http://t/api/xtell/reading', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ temple: 'sunzi', modelId: A, question: '下一步？', situation: '對手降價', qid: 'q-new', ...body }) })); return { status: r.status, text: await r.text() } }
  return { sent, ask }
}

async function routeChecks() {
  // 30 rounds with master A: 60 saved messages, the old cap was 20.
  const saved = Array.from({ length: 30 }, (_, i) => [U(`q${i}`, `問題${i}`, [A]), R(`q${i}`, A, `回答${i}`)]).flat()
  const a = route(saved)
  const r1 = await a.ask({ readingId: VISIT, history: [{ role: 'user', content: '頁面上的副本' }] })
  const msgs = a.sent[0]
  check('a saved conversation: the master rereads all 60 messages, not the last 20', r1.status === 200 && msgs.length === 61 && msgs[0].content === '問題0' && msgs[59].content === '回答29')
  check('the newest message is the visitor\'s, last', msgs.at(-1)!.role === 'user' && msgs.at(-1)!.content === '下一步？')
  check('the page\'s copy is not used when the conversation is saved', !msgs.some(m => m.content === '頁面上的副本'))
  check('the answer reports how many tokens the master read', /"inputTokens":1234/.test(r1.text))

  const b = route(null)
  await b.ask({ history: [{ role: 'user', content: '頁面上的副本' }, { role: 'assistant', content: '頁面上的回答' }] })
  check('a conversation that is not saved: the page\'s copy, as before', text(b.sent[0]) === '頁面上的副本|頁面上的回答|下一步？')

  const c = route(saved, 'someone-else')
  await c.ask({ readingId: VISIT, history: [{ role: 'user', content: '頁面上的副本' }] })
  check('another visitor\'s conversation is never read', !c.sent[0].some(m => m.content === '問題0'))

  const huge = Array.from({ length: 200 }, (_, i) => [U(`q${i}`, '問' + '字'.repeat(1000), [A]), R(`q${i}`, A, `答${i}` + '字'.repeat(1000))]).flat()
  const d = route(huge)
  await d.ask({ readingId: VISIT })
  const dm = d.sent[0]
  const keptTokens = dm.slice(0, -1).reduce((n, m) => n + approxTokens(m.content), 0)
  check('a conversation past the master\'s window: its newest part, in order, ending with the new question, within the window', dm.length > 60 && dm.at(-2)!.content.startsWith('答199') && dm.at(-1)!.content === '下一步？' && keptTokens <= 100_000 * 0.9, `${dm.length} messages, ${keptTokens} tokens`)

  const src = read('app/api/xtell/reading/route.ts')
  check('route: no message cap left', !/\.slice\(-20\)/.test(src) && /fitBudget\(history, rawBudget\(model, approxTokens\(systemText\)\)\)/.test(src))
  check('route: the saved conversation is read with the visitor\'s own session, own row, not deleted', /from\('xtell_readings'\)\.select\('turns'\)\.eq\('id', savedId\)\.eq\('user_id', user\.id\)\.is\('deleted_at', null\)/.test(src))
}

routeChecks().then(() => { console.log(fails ? `\n${fails} FAILED` : '\nall ok'); process.exit(fails ? 1 : 0) })
