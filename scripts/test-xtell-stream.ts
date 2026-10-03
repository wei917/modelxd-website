// scripts/test-xtell-stream.ts — a visitor who leaves mid-answer (Oct 1: the
// owner switched apps on the phone and the page said "Load failed"). The
// reading route still finishes, saves and bills the answer, beats while a
// teacher is quiet, and never hangs on a provider that throws; the page
// fetches a dropped answer from the saved visit instead of showing the
// browser's error. Models are stubbed: no network, no spend.
//   npx tsx scripts/test-xtell-stream.ts

import * as ts from 'typescript'
import vm from 'node:vm'
import fs from 'node:fs'
import path from 'node:path'
import * as sz from '../lib/sunzi'
import * as jm from '../lib/jiemeng'
import * as xtell from '../lib/xtell'
import * as yijing from '../lib/yijing'
import { STRINGS } from '../lib/i18n'

let fails = 0
const check = (name: string, cond: boolean, extra = '') => { if (!cond) { fails++; console.log('FAIL', name, extra) } else console.log('ok  ', name) }
const LANGS = ['en', 'zh-Hant', 'zh-Hans', 'ja', 'ko'] as const
const read = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
const tick = () => new Promise(r => setTimeout(r, 5))

/** The route in a sandbox: after() and the 15 s beat are captured. */
function loadRoute(file: string, modules: Record<string, unknown>, afters: Promise<unknown>[], beats: Array<{ fn: () => void; cleared: boolean }>) {
  const js = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const exports: any = {}
  const deps: Record<string, unknown> = { 'next/server': { after: (p: Promise<unknown>) => { afters.push(p) } }, '@/lib/xtell-thread': require('../lib/xtell-thread'), ...modules }
  vm.runInNewContext(js, {
    exports, console: { ...console, warn: () => {} }, process, Response, Request, ReadableStream, TextEncoder, crypto: globalThis.crypto,
    setInterval: (fn: () => void) => { const b = { fn, cleared: false }; beats.push(b); return b },
    clearInterval: (b: { cleared: boolean }) => { if (b) b.cleared = true },
    require: (name: string) => { if (!(name in deps)) throw new Error('unexpected route dependency: ' + name); return deps[name] },
  }, { filename: file })
  return exports
}
const post = (body: unknown) => new Request('http://t/api/xtell/reading', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

const visitId = '00000000-0000-4000-8000-00000000abcd'
const qid = '11111111-2222-4333-8444-555555555555'

/** One reading request whose teacher is driven by the test. */
function harness(streamText: (cb: any) => Promise<void>) {
  const log: string[] = [], saved: any[] = [], debits: number[] = [], afters: Promise<unknown>[] = [], beats: Array<{ fn: () => void; cleared: boolean }> = []
  const row = { id: visitId, user_id: 'user-a', temple: 'sunzi', created_at: new Date().toISOString(), chart: { situation: '對手降價', ask: '', lang: 'zh-Hant', lines: sz.sunziLines([40]), scan: 'x' } }
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-a' } } }) },
    rpc: async (name: string, args: any) => { if (name === 'xtell_append_turns') { log.push('save'); saved.push(args) } return { error: null } },
    from() {
      const filters: any[] = []
      const q: any = {
        select: () => q, is: () => q, order: () => q, limit: () => q, single: () => q, maybeSingle: () => q,
        eq: (k: string, v: unknown) => { filters.push([k, v]); return q },
        then: (resolve: any, reject: any) => Promise.resolve({ data: filters.every(([k, v]) => (row as any)[k] === v) ? row : null, error: null }).then(resolve, reject),
      }
      return q
    },
  }
  const { POST } = loadRoute('app/api/xtell/reading/route.ts', {
    '@/lib/supabase-server': { createSupabaseServer: async () => db },
    '@/lib/xtell-admin': { xtellAdmin: () => { throw new Error('not for temple readings') }, dailyMissing: () => false },
    '@/lib/models': { getModelById: async () => ({ id: 'm1', provider: 'openai', model_name: 'test', display_name: 'Test', enabled: true, blocked_features: [], output_config: { text: { capabilities: [], thinking_levels: [] } } }) },
    '@/lib/providers': { streamText: async (_m: unknown, _msgs: unknown, cb: any) => streamText(cb) },
    '@/lib/credits': { debitCredits: async (o: any) => { log.push('debit'); debits.push(o.amountCents) }, accrueFraction: async () => null, InsufficientCreditsError: class extends Error {} },
    '@/lib/provider-errors': { sanitizeProviderError: (m: string) => m },
    '@/lib/xtell': xtell, '@/lib/classics': { classicsBlock: () => '' }, '@/lib/yijing': yijing, '@/lib/xtell-daily': require('../lib/xtell-daily'), '@/lib/tarot': require('../lib/tarot'), '@/lib/xtell-cookie': require('../lib/xtell-cookie'), '@/lib/kyusei': require('../lib/kyusei'), '@/lib/sukuyo': require('../lib/sukuyo'), '@/lib/xtell-lang-check': require('../lib/xtell-lang-check'), '@/lib/xtell-personality': require('../lib/xtell-personality'), '@/lib/jiemeng': jm, '@/lib/sunzi': sz,
  }, afters, beats)
  const ask = () => POST(post({ temple: 'sunzi', modelId: 'm1', question: '第一步該做什麼？', situation: '對手降價', readingId: visitId, qid, to: [], seats: [] })) as Promise<Response>
  return { log, saved, debits, afters, beats, ask }
}

async function server() {
  // Like the real providers: onDone is called, not awaited.
  let release = () => {}
  const gate = new Promise<void>(r => { release = r })
  const a = harness(async cb => { cb.onDelta('第一段，'); await gate; cb.onDelta('第二段。'); cb.onDone({ cost: 0.02 }) })
  const res = await a.ask()
  const reader = res.body!.getReader()
  const first = new TextDecoder().decode((await reader.read()).value)
  check('the first words reach the page', first.includes('第一段'))
  // While the teacher is quiet, the beat sends a comment line the page skips.
  a.beats[0]?.fn()
  const ping = new TextDecoder().decode((await reader.read()).value)
  check('a quiet teacher: a comment line keeps the connection alive', ping === ': ping\n\n')
  // The visitor leaves: the browser drops the stream.
  await reader.cancel()
  release()
  await Promise.all(a.afters)
  check('the visitor left: the whole answer is still saved under its question', a.saved.length === 1 && a.saved[0].p_assistant_turn.content === '第一段，第二段。' && a.saved[0].p_assistant_turn.qid === qid && a.saved[0].p_id === visitId)
  check('and billed once, as it would have been', a.debits.join() === '2')
  check('the work is held open by after() until the save and debit are done', a.afters.length === 1 && a.log.join() === 'save,debit')
  check('the beat stops when the answer ends', a.beats.length === 1 && a.beats[0].cleared)

  // A visitor who stays: the done event comes after the save and the debit.
  const b = harness(async cb => { cb.onDelta('答。'); cb.onDone({ cost: 0.01 }) })
  const text = await (await b.ask()).text()
  check('a visitor who stays: delta, then done, after the save and debit', /event: delta[\s\S]*event: done/.test(text) && b.log.join() === 'save,debit' && b.beats[0].cleared)

  // A provider that throws: an error event and a closed stream, not a hang.
  const c = harness(async () => { throw new Error('upstream 500') })
  const t2 = await Promise.race([(await c.ask()).text(), new Promise<string>(r => setTimeout(() => r('HUNG'), 2000))])
  check('a provider that throws: an error event and the stream ends', t2 !== 'HUNG' && t2.includes('event: error') && t2.includes('upstream 500') && c.saved.length === 0 && c.debits.length === 0)
  await tick()
}

function page() {
  const client = read('app/xtell/client.tsx')
  const ask = client.slice(client.indexOf('const askTeacher = async'), client.indexOf('const recovering = useRef'))
  const rec = client.slice(client.indexOf('const recoverAnswer = async'), client.indexOf('const signedIn = async'))
  check('page: a dropped line (TypeError) is never shown as the browser wrote it', /e instanceof TypeError/.test(ask) && !/Load failed/.test(ask.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')))
  check('page: after the server took the question, the answer is fetched from the visit', /taken = true/.test(ask) && /if \(taken && visit\) return recoverAnswer\(idx, m\.id, qid, since, visit\)/.test(ask))
  check('page: before that, a plain "could not reach the server"', /fail\('network', 'network'\)/.test(ask))
  check('page: an answer already done is not turned into an error by a late drop', /if \(ended\) return/.test(ask))
  check('page: the saved answer is found by its question and its teacher', /tn\.qid === qid && tn\.modelId === modelId/.test(rec) && /from\('xtell_readings'\)\.select\('turns'\)\.eq\('id', visit\)/.test(rec))
  check('page: fetched for as long as the server may write it, and only while the page is in front', /320_000/.test(rec) && /document\.hidden/.test(rec) && /visibilitychange/.test(rec))
  check('page: the found answer and its cost replace the partial one', /content: String\(found\.content/.test(rec) && /doneAssistant\(idx, Number\(found\.cost\)/.test(rec))
  check('page: only the fetching notice is cleared, and only when none is left', /recovering\.current === 0 && errCodeRef\.current === 'stream_recovering'/.test(rec))
  const route = read('app/api/xtell/reading/route.ts')
  check('route: maxDuration still 300 s (the page waits 320 s)', /export const maxDuration = 300\b/.test(route))
  for (const k of ['xtell.err.stream_recovering', 'xtell.err.stream_lost', 'xtell.err.network']) {
    const s = (STRINGS as any)[k]
    check(`strings: ${k} in every language, no em dash`, !!s && LANGS.every(l => typeof s[l] === 'string' && s[l].length > 5 && !s[l].includes('—')))
  }
}

server().then(() => { page(); console.log(fails ? `\n${fails} FAILED` : '\nall ok'); process.exit(fails ? 1 : 0) })
