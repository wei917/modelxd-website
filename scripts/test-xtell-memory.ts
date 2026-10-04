// scripts/test-xtell-memory.ts — XTell masters' memory (Oct 3,
// docs/XTELL-MEMORY.md): each master's own memo written by its own model past
// 70% of its window, the newest ~40% kept word for word; messages stored one
// per row; the reading route assembling a (prompt), b (account basics), c
// (today, facts, passages for the opening question), d (memo), e (messages
// after the memo). No network, no database: both stubbed.
//   npx tsx scripts/test-xtell-memory.ts

import * as ts from 'typescript'
import vm from 'node:vm'
import fs from 'node:fs'
import path from 'node:path'
import * as sz from '../lib/sunzi'
import * as jm from '../lib/jiemeng'
import * as xtell from '../lib/xtell'
import * as yijing from '../lib/yijing'
import * as mem from '../lib/xtell-memory'
import * as cm from '../lib/conversation-memory'

let fails = 0
const check = (name: string, cond: boolean, extra = '') => { if (!cond) { fails++; console.log('FAIL', name, extra) } else console.log('ok  ', name) }
const read = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
const A = 'aaaaaaaa-0000-4000-8000-00000000000a', B = 'bbbbbbbb-0000-4000-8000-00000000000b'
const VISIT = '00000000-0000-4000-8000-00000000abcd', ME = 'user-a'

/** A tiny stand-in for the service role over three tables. */
function fakeAdmin(init: { messages?: any[]; memories?: any[]; profile?: any; missing?: boolean } = {}) {
  const t: Record<string, any[]> = { xtell_messages: [...(init.messages ?? [])], xtell_memories: [...(init.memories ?? [])], xtell_profiles: init.profile ? [{ user_id: ME, ...init.profile }] : [] }
  let nextSeq = Math.max(0, ...t.xtell_messages.map(r => r.seq)) + 1
  const log: string[] = []
  const admin = {
    // Before migration 127 there is no xtell_add_message, so addMessage falls
    // back to the plain insert this fake handles (PostgREST says PGRST202).
    rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }),
    log, t,
    from(table: string) {
      const f: Array<(r: any) => boolean> = []
      let order: [string, boolean] | null = null, limit = Infinity, single = false, op: 'select' | 'insert' = 'select', values: any = null
      const q: any = {
        select: () => q, maybeSingle: () => { single = true; return q },
        eq: (k: string, v: unknown) => { f.push(r => r[k] === v); return q },
        gt: (k: string, v: number) => { f.push(r => r[k] > v); return q },
        order: (k: string, o: { ascending: boolean }) => { order = [k, o.ascending]; return q },
        limit: (n: number) => { limit = n; return q },
        insert: (v: any) => { op = 'insert'; values = v; return q },
        then: (res: any, rej: any) => {
          if (init.missing && table !== 'xtell_profiles') return Promise.resolve({ data: null, error: { code: 'PGRST205', message: 'Could not find the table' } }).then(res, rej)
          if (op === 'insert') {
            const rows = t[table]
            if (table === 'xtell_messages') {
              const dup = rows.some(r => r.reading_id === values.reading_id && r.qid && r.qid === values.qid && r.role === values.role && (values.role === 'user' || r.model_id === values.model_id))
              if (dup) return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate' } }).then(res, rej)
              const row = { ...values, seq: nextSeq++ }; rows.push(row); log.push(`message ${row.role} ${row.seq}`)
              return Promise.resolve({ data: { seq: row.seq }, error: null }).then(res, rej)
            }
            if (rows.some(r => r.reading_id === values.reading_id && r.model_id === values.model_id && r.through_seq === values.through_seq)) return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate' } }).then(res, rej)
            rows.push({ ...values }); log.push(`memo ${values.through_seq}`)
            return Promise.resolve({ data: null, error: null }).then(res, rej)
          }
          let rows = t[table].filter(r => f.every(fn => fn(r)))
          if (order) { const [k, asc] = order; rows = [...rows].sort((a, b) => (a[k] - b[k]) * (asc ? 1 : -1)) }
          rows = rows.slice(0, limit)
          return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(res, rej)
        },
      }
      return q
    },
  }
  return admin
}
const msg = (seq: number, role: 'user' | 'assistant', content: string, extra: any = {}) => ({ seq, reading_id: VISIT, role, content, model_id: role === 'assistant' ? A : null, qid: `q${Math.ceil(seq / 2)}`, to: null, ...extra })

async function unit() {
  check('window: the catalog\'s, else 100k', cm.windowOf({ context_window: 200_000 }) === 200_000 && cm.windowOf({}) === 100_000 && cm.windowOf({ context_window: 0 }) === 100_000)
  check('what a master read: the provider\'s input count, cache hits inside it (Anthropic folds its own back in), never added twice', cm.tokensRead({ inputTokens: 5000, cachedTokens: 4000 }) === 5000 && cm.tokensRead({ inputTokens: 72_000, cachedTokens: 70_000 }) === 72_000 && cm.tokensRead({}) === null)
  check('raw budget: the window less the instructions and room for the answer', cm.rawBudget({ context_window: 100_000 }, 10_000) === 72_000 && cm.rawBudget({ context_window: 10_000 }, 20_000) === 4_000)
  const rows = [msg(1, 'user', '問一', { to: [A, B] }), msg(2, 'assistant', 'A答一'), { ...msg(3, 'assistant', 'B答一'), model_id: B, qid: 'q1' }, msg(4, 'user', '問二')]
  const tr = mem.threadRows(rows as any, A, null)
  check('a master\'s thread keeps each message\'s own number; another master\'s answers are not in it', tr.map(m => `${m.seq}:${m.content}`).join('|') === '1:問一|2:A答一|4:問二')

  // Under the threshold: nothing.
  let calls = 0
  const run = async () => { calls++; return { text: '摘要：來訪者在考慮換工作。', inputTokens: 50_000, outputTokens: 400, cost: 0.02 } }
  let charged = 0
  const charge = async (usd: number) => { charged += usd }
  const base = { readingId: VISIT, model: { id: A, display_name: 'Opus', context_window: 100_000 }, lang: 'zh-Hant', userId: ME, run, charge }
  const r0 = await mem.maybeSummarize({ ...base, admin: fakeAdmin({ messages: rows }), inputTokens: 69_000 })
  check('under 70% of the window: no summary, no call, no charge', !r0.saved && calls === 0 && charged === 0, r0.reason)

  // Over the threshold: 60 rounds of 1,000 字 (about 120k tokens) for master A.
  const long = Array.from({ length: 120 }, (_, i) => msg(i + 1, i % 2 ? 'assistant' : 'user', `${i % 2 ? '答' : '問'}${Math.floor(i / 2)}` + '字'.repeat(1000)))
  let seen = { sys: '', content: '' }
  const admin = fakeAdmin({ messages: long, memories: [{ reading_id: VISIT, model_id: A, through_seq: 0, text: '舊摘要' }] })
  const r1 = await mem.maybeSummarize({ ...base, admin, inputTokens: 80_000, run: async (sys: string, content: string) => { seen = { sys, content }; return run() } })
  const memoRow = admin.t.xtell_memories.find(m => m.through_seq > 0)
  check('over 70%: the master\'s own model writes a memo, saved as a new row', r1.saved && !!memoRow && memoRow.model_id === A && memoRow.text === '摘要：來訪者在考慮換工作。', r1.reason)
  const keptTokens = long.filter(m => m.seq > memoRow.through_seq).reduce((n, m) => n + m.content.length, 0)
  check('the newest messages filling about 40% of the window stay word for word; the rest is folded', keptTokens <= 40_000 && keptTokens > 30_000 && seen.content.includes('問0') && !seen.content.includes(long.at(-1)!.content.slice(0, 6)), String(keptTokens))
  check('the memo is folded from the old memo and the messages, in order', seen.content.startsWith('舊摘要：\n舊摘要') && seen.content.indexOf('問0') < seen.content.indexOf('問1字'))
  check('the memo instructions: five fixed sections, concrete details, no new readings, the conversation\'s language', ['來訪者的處境', '問過的問題', '用到的盤面重點', '你的解讀與建議', '尚未了結的事'].every(x => seen.sys.includes(x)) && seen.sys.includes('不要新增解讀') && seen.sys.includes('繁體中文') && seen.sys.includes('Opus') && seen.sys.includes('### 1. 來訪者的處境'))
  check('the summary is billed like an answer: its cost, to the visitor', charged === 0.02)
  check('the memo keeps its tokens and cost, for comparing models', memoRow.input_tokens === 50_000 && memoRow.output_tokens === 400 && memoRow.cost === 0.02)

  const r2 = await mem.maybeSummarize({ ...base, admin: fakeAdmin({ messages: long.slice(0, 10) }), inputTokens: 80_000 })
  check('everything already fits the 40%: nothing to fold', !r2.saved && r2.reason === 'nothing old enough to fold', r2.reason)
  const before = charged
  const r3 = await mem.maybeSummarize({ ...base, admin: fakeAdmin({ messages: long }), inputTokens: 80_000, run: async () => ({ text: '  ', inputTokens: 1, outputTokens: 0, cost: 0.01 }) })
  check('the model writes nothing: no memo, no charge', !r3.saved && charged === before)
  const r4 = await mem.maybeSummarize({ ...base, admin: fakeAdmin({ missing: true }), inputTokens: 80_000 })
  check('before migration 126: no memo, no error', !r4.saved && r4.reason === 'messages table missing', r4.reason)
  const other = long.map(m => m.role === 'assistant' ? { ...m, model_id: B } : { ...m, to: [B] })
  const r5 = await mem.maybeSummarize({ ...base, admin: fakeAdmin({ messages: other }), inputTokens: 80_000 })
  check('another master\'s conversation is never folded into this master\'s memo', !r5.saved, r5.reason)
}

// ── The route with memory on ───────────────────────────────────────────────
function loadRoute(file: string, modules: Record<string, unknown>, afters: Promise<unknown>[]) {
  const js = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const exports: any = {}
  const deps: Record<string, unknown> = { 'next/server': { after: (p: Promise<unknown>) => { afters.push(p) } }, ...modules }
  vm.runInNewContext(js, {
    exports, console: { ...console, warn: () => {} }, process, Response, Request, ReadableStream, TextEncoder, crypto: globalThis.crypto, setInterval, clearInterval, setTimeout, clearTimeout, Intl,
    require: (name: string) => { if (!(name in deps)) throw new Error('unexpected route dependency: ' + name); return deps[name] },
  }, { filename: file })
  return exports
}
function route(o: { turns: any[]; admin: any; inputTokens?: number; window?: number; provider?: string; cached?: number }) {
  const calls: Array<{ system: string; msgs: any[] }> = [], queries: string[] = [], debits: string[] = []
  const afters: Promise<unknown>[] = []
  const row = { id: VISIT, user_id: ME, temple: 'sunzi', created_at: new Date().toISOString(), chart: { situation: '對手降價', ask: '', lang: 'zh-Hant', lines: sz.sunziLines([40]), scan: 'x' }, turns: o.turns }
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: ME } } }) },
    rpc: async () => ({ error: null }),
    from() {
      const filters: any[] = []
      const q: any = {
        select: () => q, is: () => q, order: () => q, limit: () => q, single: () => q, maybeSingle: () => q,
        eq: (k: string, v: unknown) => { filters.push([k, v]); return q },
        then: (res: any, rej: any) => Promise.resolve({ data: filters.every(([k, v]) => (row as any)[k] === v) ? row : null, error: null }).then(res, rej),
      }
      return q
    },
  }
  const model = { id: A, provider: o.provider ?? 'openai', model_name: 'test', display_name: 'Opus', enabled: true, blocked_features: [], context_window: o.window ?? 100_000, output_config: { text: { capabilities: [], thinking_levels: [] } } }
  const { POST } = loadRoute('app/api/xtell/reading/route.ts', {
    '@/lib/supabase-server': { createSupabaseServer: async () => db },
    '@/lib/xtell-admin': { xtellAdmin: () => o.admin, dailyMissing: () => false },
    '@/lib/models': { getModelById: async () => model },
    '@/lib/providers': { streamText: async (_m: unknown, msgs: any, cb: any, _a: unknown, _c: unknown, g: any) => {
      calls.push({ system: g.system, msgs })
      const memo = /摘要/.test(g.system) && /要寫進摘要/.test(msgs[0]?.content ?? '')
      if (memo) { cb.onDelta('新的摘要'); cb.onDone({ cost: 0.01, inputTokens: 40_000, outputTokens: 300 }) }
      else { cb.onDelta('答'); cb.onDone({ cost: 0.03, inputTokens: o.inputTokens ?? 1000, cachedTokens: o.cached ?? 0 }) }
    } },
    '@/lib/credits': { debitCredits: async (d: any) => { debits.push(d.description) }, accrueFraction: async () => null, InsufficientCreditsError: class extends Error {} },
    '@/lib/provider-errors': { sanitizeProviderError: (m: string) => m },
    '@/lib/xtell': xtell, '@/lib/classics': { classicsBlock: (_t: string, query: string) => { queries.push(query); return '' } }, '@/lib/yijing': yijing, '@/lib/xtell-daily': require('../lib/xtell-daily'), '@/lib/tarot': require('../lib/tarot'), '@/lib/xtell-cookie': require('../lib/xtell-cookie'), '@/lib/kyusei': require('../lib/kyusei'), '@/lib/sukuyo': require('../lib/sukuyo'), '@/lib/xtell-lang-check': require('../lib/xtell-lang-check'), '@/lib/xtell-personality': require('../lib/xtell-personality'), '@/lib/jiemeng': jm, '@/lib/sunzi': sz,
    '@/lib/xtell-thread': require('../lib/xtell-thread'), '@/lib/xtell-memory': mem, '@/lib/conversation-memory': cm,
  }, afters)
  const ask = async (body: any) => {
    const r = await POST(new Request('http://t/api/xtell/reading', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ temple: 'sunzi', modelId: A, situation: '對手降價', readingId: VISIT, tz: 'Asia/Tokyo', ...body }) }))
    const text = await r.text(); await Promise.all(afters)
    return { status: r.status, text }
  }
  return { calls, queries, debits, ask }
}

async function routeChecks() {
  const Q = '11111111-2222-4333-8444-555555555555'
  // A conversation with no memo yet: the whole thread from the saved turns.
  const turns = [{ role: 'user', content: '開場：對手降價怎麼辦？', qid: 'q-open', ts: '2026-10-01T10:00:00Z' }, { role: 'assistant', content: '先觀察', modelId: A, qid: 'q-open', ts: '2026-10-01T10:01:00Z' }]
  const admin = fakeAdmin({ profile: { birth: { y: 1990, m: 9, d: 17, h: 0, mi: 0 }, birth_place: 'hsinchu' } })
  const a = route({ turns, admin })
  const r = await a.ask({ question: '那價格要跟嗎？', qid: Q, to: [A], seats: [A] })
  const sys = a.calls[0].system
  check('the visitor\'s message is stored when the question arrives, before the answer', admin.log[0] === 'message user 1' && admin.log[1] === 'message assistant 2' && admin.t.xtell_messages[0].qid === Q && admin.t.xtell_messages[0].to.join() === A)
  check('the answer is stored with what the master read and its cost', admin.t.xtell_messages[1].input_tokens === 1000 && admin.t.xtell_messages[1].cost === 0.03 && admin.t.xtell_messages[1].content === '答')
  check('no memo yet: the whole thread from the saved conversation, then the new question', a.calls[0].msgs.map((m: any) => m.content).join('|') === '開場：對手降價怎麼辦？|先觀察|那價格要跟嗎？')
  check('b: the account\'s birth details, for reference, never recited back', sys.includes('來訪者本人存在帳戶的出生資料') && sys.includes('1990-09-17 00:00') && sys.includes('新竹') && sys.includes('不要在回答中複述'))
  check('c: today in the visitor\'s own zone; a note that the date moved on since the last answer', sys.includes('來訪者當地') && /上次對話是 2026-10-01，今天是 \d{4}-\d{2}-\d{2}/.test(sys))
  check('c4: the reference passages are looked up for the opening question, not the latest one', a.queries.length > 0 && a.queries.every(q => q.startsWith('開場：對手降價怎麼辦？')))
  check('order of the instructions: a (prompt), b (basics), c (today, facts)', sys.indexOf('孫子') >= 0 && sys.indexOf('來訪者本人存在帳戶的出生資料') < sys.indexOf('今天的日期') && sys.indexOf('今天的日期') < sys.indexOf(xtell.MASTERS.sunzi.slice(0, 0) + '來訪者的處境與《孫子兵法》'))
  check('a short answer: no summary', !admin.log.some(l => l.startsWith('memo')) && a.calls.length === 1 && r.status === 200)

  // A master with a memo: the memo in its instructions, and only the messages after it.
  const rows = [msg(1, 'user', '很早的問題'), msg(2, 'assistant', '很早的回答'), msg(3, 'user', '較近的問題'), msg(4, 'assistant', '較近的回答')]
  const admin2 = fakeAdmin({ messages: rows, memories: [{ reading_id: VISIT, model_id: A, through_seq: 2, text: '我的摘要：來訪者在考慮降價。' }] })
  const b = route({ turns: [{ role: 'user', content: '很早的問題', qid: 'q1' }, { role: 'assistant', content: '很早的回答', modelId: A, qid: 'q1' }, { role: 'user', content: '較近的問題', qid: 'q2' }, { role: 'assistant', content: '較近的回答', modelId: A, qid: 'q2' }], admin: admin2 })
  await b.ask({ question: '現在呢？', qid: Q })
  check('d: the master\'s own memo is in its instructions, after the facts', b.calls[0].system.includes('你先前寫的對話摘要') && b.calls[0].system.includes('我的摘要：來訪者在考慮降價。') && b.calls[0].system.indexOf('你先前寫的對話摘要') > b.calls[0].system.indexOf('來訪者的處境與《孫子兵法》'))
  check('e: only the messages after the memo, word for word, then the new question', b.calls[0].msgs.map((m: any) => m.content).join('|') === '較近的問題|較近的回答|現在呢？')

  // A long answer past 70% of the window: the master summarizes after answering.
  const long = Array.from({ length: 120 }, (_, i) => msg(i + 1, i % 2 ? 'assistant' : 'user', `${i}` + '字'.repeat(1000)))
  const admin3 = fakeAdmin({ messages: long })
  const c = route({ turns: [], admin: admin3, inputTokens: 80_000 })
  const rc = await c.ask({ question: '總結一下？', qid: Q })
  check('past 70%: after the answer, the master\'s own model writes its memo', c.calls.length === 2 && /要寫進摘要/.test(c.calls[1].msgs[0].content) && admin3.t.xtell_memories.length === 1 && admin3.t.xtell_memories[0].text === '新的摘要')
  check('the visitor got the answer first; the summary is billed like an answer', rc.text.indexOf('event: done') > 0 && c.debits.some(d => d.startsWith('XTell summary')) && c.debits.some(d => d.startsWith('XTell sunzi reading')))

  // Anthropic serves most of a long conversation from its cache. Its provider
  // folds the cache reads into the input count (7688e02): counted once.
  const admin4 = fakeAdmin({ messages: long })
  const e = route({ turns: [], admin: admin4, provider: 'anthropic', inputTokens: 72_000, cached: 70_000 })
  const re = await e.ask({ question: '總結一下？', qid: Q })
  check('Anthropic: what the master read is its whole count, cache included and not added twice, in the store, the page and the summary rule', admin4.t.xtell_messages.filter((m: any) => m.role === 'assistant').at(-1)?.input_tokens === 72_000 && /"inputTokens":72000/.test(re.text) && admin4.t.xtell_memories.length === 1)

  // No service role (or before 126): the same reading, memory off.
  const d = route({ turns, admin: fakeAdmin({ missing: true }) })
  const rd = await d.ask({ question: '那價格要跟嗎？', qid: Q })
  check('before migration 126: the reading works as step 0, nothing stored, no memo', rd.status === 200 && d.calls.length === 1 && d.calls[0].msgs.length === 3)

  const src = read('app/api/xtell/reading/route.ts')
  check('route: the conversation is read with the visitor\'s own session before the service role touches memory', src.indexOf(".from('xtell_readings').select('turns').eq('id', savedId).eq('user_id', user.id)") < src.indexOf('latestMemo(admin, savedId, modelKey)'))
  check('route: the summary runs after the answer is delivered, then the function finishes', /end\(false\)[\s\S]*maybeSummarize\([\s\S]*settle\(\)/.test(src))
  const page = read('app/xtell/client.tsx')
  check('page: each seat\'s logo sits in a ring filled with what its master read against its own limit, from the finished answer or the stored ones; the numbers are in the dialog', /setMemUse\(u => \(\{ \.\.\.u, \[m\.id\]: j\.inputTokens \}\)\)/.test(page) && /from\('xtell_messages'\)\.select\('model_id, input_tokens'\)\.eq\('reading_id', readingId\)\.eq\('role', 'assistant'\)/.test(page) && /<ContextMeter className="xtell-seat-logo xtell-seat-ring" used=\{memUse\[m\.id\]\} max=\{maxInputOf\(m\)\} point=\{summaryPointOf\(m\)\}/.test(page) && !/className="xtell-seat-mem"/.test(page) && /model_pricing, context_window, output_config/.test(page))
  check('page: beside each master\'s price, its memory as current / max', /<dt>\{t\('xtell\.mem\.label'\)\}<\/dt><dd>\{memUse\[m\.id\] == null \? '~' : ''\}\{formatTokens\(read\)\} \/ \{formatTokens\(maxInputOf\(m\)\)\}<\/dd>/.test(page))
  const dialog = read('app/components/xtell/MemoryDialog.tsx')
  check('summary: the master\'s newest one in this conversation, read with the visitor\'s own session', /from\('xtell_memories'\)\.select\('text, created_at'\)\.eq\('reading_id', readingId\)\.eq\('model_id', m\.id\)\s*\.order\('through_seq', \{ ascending: false \}\)\.limit\(1\)/.test(dialog) && !/SECRET|service/i.test(dialog))
  check('page: sends the visitor\'s time zone with each question', /tz: \(\(\) => \{ try \{ return Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone/.test(page))
}

// ── 「立即摘要」: the button's route ──────────────────────────────────────────
function memoryRoute(o: { admin: any; user?: string | null; owner?: string; balance?: number }) {
  const calls: Array<{ system: string; msgs: any[]; g: any }> = [], debits: string[] = []
  const afters: Promise<unknown>[] = []
  const reading = { id: VISIT, user_id: o.owner ?? ME, temple: 'sunzi', deleted_at: null }
  const db = {
    auth: { getUser: async () => ({ data: { user: o.user === null ? null : { id: o.user ?? ME } } }) },
    from(table: string) {
      const filters: any[] = []
      const q: any = {
        select: () => q, is: () => q, maybeSingle: () => q,
        eq: (k: string, v: unknown) => { filters.push([k, v]); return q },
        then: (res: any, rej: any) => {
          const row = table === 'xtell_readings' ? reading : table === 'user_credits' ? { user_id: ME, balance_cents: o.balance ?? 500 } : null
          return Promise.resolve({ data: row && filters.every(([k, v]) => (row as any)[k] === v) ? row : null, error: null }).then(res, rej)
        },
      }
      return q
    },
  }
  const model = { id: A, provider: 'openai', model_name: 'test-model', display_name: 'Opus', enabled: true, blocked_features: [], context_window: 1_000_000, output_config: { text: { thinking_levels: ['high'] } } }
  const modelB = { ...model, id: B, provider: 'alibaba', model_name: 'test-model-b', display_name: 'Qwen' }
  const { POST } = loadRoute('app/api/xtell/memory/route.ts', {
    '@/lib/supabase-server': { createSupabaseServer: async () => db },
    '@/lib/models': { getModelById: async (id: string) => (id === A ? model : id === B ? modelB : null) },
    '@/lib/providers': { streamText: async (_m: unknown, msgs: any, cb: any, _a: unknown, _c: unknown, g: any) => { calls.push({ system: g.system, msgs, g }); cb.onDelta('立即的摘要'); cb.onDone({ cost: 0.02, inputTokens: 3_000, outputTokens: 200 }) } },
    '@/lib/credits': { debitCredits: async (d: any) => { debits.push(d.description) }, accrueFraction: async () => null },
    '@/lib/xtell-admin': { xtellAdmin: () => o.admin },
    '@/lib/xtell-memory': mem,
  }, afters)
  const press = async (body: any = {}) => {
    const r = await POST(new Request('http://t/api/xtell/memory', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ readingId: VISIT, modelId: A, lang: 'zh-Hant', ...body }) }))
    return { status: r.status, json: await r.json() }
  }
  return { calls, debits, press }
}

async function nowChecks() {
  const four = [msg(1, 'user', '第一問'), msg(2, 'assistant', '第一答'), msg(3, 'user', '第二問'), msg(4, 'assistant', '第二答')]
  const admin = fakeAdmin({ messages: four })
  const a = memoryRoute({ admin })
  const r = await a.press({ thinking: 'high' })
  check('立即摘要: a short conversation is summarized now, whatever its size, through its last message', r.status === 200 && r.json.text === '立即的摘要' && admin.t.xtell_memories.length === 1 && admin.t.xtell_memories[0].through_seq === 4, JSON.stringify(r))
  check('立即摘要: the whole conversation goes in, both questions and both answers (owner: one question missing "is bad")', ['第一問', '第一答', '第二問', '第二答'].every(x => a.calls[0].msgs[0].content.includes(x)))
  check('立即摘要: the master\'s own model and seat setting, billed like an answer', a.calls[0].g.thinking === 'high' && a.calls[0].g.maxTokens === 4000 && a.debits.length === 1 && a.debits[0] === 'XTell summary (test-model)')
  const again = await a.press()
  check('pressed again with nothing new since: nothing to summarize, no call, no charge', again.status === 409 && again.json.code === 'nothing_to_summarize' && a.calls.length === 1 && a.debits.length === 1, JSON.stringify(again))
  const empty = memoryRoute({ admin: fakeAdmin({ messages: [] }) })
  const rs = await empty.press()
  check('no messages yet: nothing to summarize, no call', rs.status === 409 && empty.calls.length === 0)
  const broke = memoryRoute({ admin: fakeAdmin({ messages: four }), balance: 0 })
  const rb = await broke.press()
  check('an empty wallet: refused before any model call', rb.status === 402 && rb.json.code === 'no_credits' && broke.calls.length === 0)
  const other = memoryRoute({ admin: fakeAdmin({ messages: four }), owner: 'someone-else' })
  check('another visitor\'s conversation: not found, nothing read or run', (await other.press()).status === 404 && other.calls.length === 0)
  const anon = memoryRoute({ admin: fakeAdmin({ messages: four }), user: null })
  check('signed out: refused', (await anon.press()).status === 401)
  // Several masters seated: each press summarizes only that master's own
  // thread (both questions, its own answers, never another master's), and
  // two masters can be summarized at the same time.
  const both = [
    msg(1, 'user', '共同第一問', { to: [A, B] }), msg(2, 'assistant', 'A的第一答'), { ...msg(3, 'assistant', 'B的第一答'), model_id: B, qid: 'q1' },
    msg(4, 'user', '共同第二問', { to: [A, B], qid: 'q2' }), { ...msg(5, 'assistant', 'A的第二答'), qid: 'q2' }, { ...msg(6, 'assistant', 'B的第二答'), model_id: B, qid: 'q2' },
  ]
  const shared = fakeAdmin({ messages: both })
  const duo = memoryRoute({ admin: shared })
  const [ra, rb2] = await Promise.all([duo.press({ modelId: A }), duo.press({ modelId: B })])
  const sentFor = (name: string) => duo.calls.find(c => c.system.includes(`「${name}」`))?.msgs[0].content ?? ''
  check('two masters pressed at once: both summaries saved, one per master', ra.status === 200 && rb2.status === 200 && shared.t.xtell_memories.length === 2 && shared.t.xtell_memories.map((r: any) => r.model_id).sort().join() === [A, B].sort().join(), `${ra.status} ${rb2.status}`)
  check('each master\'s summary reads both questions and only its own answers', ['共同第一問', '共同第二問', 'A的第一答', 'A的第二答'].every(x => sentFor('Opus').includes(x)) && !/B的/.test(sentFor('Opus')) && ['共同第一問', '共同第二問', 'B的第一答', 'B的第二答'].every(x => sentFor('Qwen').includes(x)) && !/A的/.test(sentFor('Qwen')))
  check('each summary is through that master\'s own last message, billed once each', shared.t.xtell_memories.find((r: any) => r.model_id === A)?.through_seq === 5 && shared.t.xtell_memories.find((r: any) => r.model_id === B)?.through_seq === 6 && duo.debits.length === 2)
  const dialog = read('app/components/xtell/MemoryDialog.tsx')
  check('the dialog renders the summary as Markdown, as answers are (### headings, - lists)', /<ReactMarkdown skipHtml remarkPlugins=\{REMARK_PLUGINS\}>\{shown\.text\}<\/ReactMarkdown>/.test(dialog) && /xtell-mem-text markdown-body/.test(dialog))
  check('the dialog: the button shows its price and stays off until two rounds and while an answer is coming in', /disabled=\{!canNow \|\| busy \|\| working\}/.test(dialog) && /<small>~\{price\}<\/small>/.test(dialog) && !/fetch\(/.test(dialog))
  const page = read('app/xtell/client.tsx')
  check('the page: two answers from that master before the button works', /canNow=\{answers >= 2\}/.test(page) && /busy=\{answering\}/.test(page))
  check('the page runs the press, so closing and reopening the dialog keeps 摘要中… and one press at a time (owner, Oct 3)', /fetch\('\/api\/xtell\/memory'/.test(page) && /if \(summarizingRef\.current\.has\(key\)\) return/.test(page) && /working=\{!!summarizing\[key\]\}/.test(page) && /fresh=\{freshMemo\[key\] \?\? null\}/.test(page))
}

unit().then(routeChecks).then(nowChecks).then(() => { console.log(fails ? `\n${fails} FAILED` : '\nall ok'); process.exit(fails ? 1 : 0) })
