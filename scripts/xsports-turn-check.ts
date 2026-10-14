// scripts/xsports-turn-check.ts — checks the XSports private chat's turns
// (Oct 13: several models per question) without a network, a database or a
// provider:
//   - lib/xsports-turn: speak() settles once, after the debit and the saved
//     remark; inTurn() runs models one after another, survives a failure,
//     stops on cancellation or an empty wallet; nextSpeaker() takes turns
//   - lib/xsports-store historyFor(): what one model rereads when several
//     share the chat
//   - app/api/xsports/talk/route.ts itself, transpiled and run with every
//     import mocked (the harness is the one Codex wrote for its review, Oct
//     13): one stored question, persist before the next model, failure
//     isolation, cancellation, the wallet before EACH model, limits.
//
//   npx tsx scripts/xsports-turn-check.ts       exit code 1 on any failure

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import { speak, inTurn, nextSpeaker, type StreamCallbacks } from '../lib/xsports-turn'
import { historyFor, type MessageRow } from '../lib/xsports-store'

let fails = 0
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails++ }
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

async function turnHelpers() {
  // speak(): onDone is not awaited by the router, so speak waits on persist.
  const order: string[] = []
  const a = await speak(async cb => { cb.onDelta('he'); cb.onDelta('llo'); cb.onDone({ cost: 0.01 }) }, {
    onDelta: () => {},
    persist: async text => { await wait(20); order.push(`saved:${text}`) },
  })
  order.push('settled')
  ok(a.text === 'hello' && a.cost === 0.01 && a.error === null && order.join(',') === 'saved:hello,settled', 'speak settles after persist, not when the stream returns')
  const b = await speak(async cb => { cb.onDelta('x'); cb.onError('refused') }, { onDelta: () => {}, persist: async () => { throw new Error('must not persist') } })
  ok(b.error === 'refused' && b.cost === 0, 'speak: onError is a failed answer, nothing saved')
  const c = await speak(async () => { throw new Error('boom') }, { onDelta: () => {}, persist: async () => {} })
  ok(c.error === 'boom', 'speak: a stream that throws is a failed answer')
  const d = await speak(() => { throw new Error('sync') }, { onDelta: () => {}, persist: async () => {} })
  ok(d.error === 'sync', 'speak: a stream that throws before starting is a failed answer')
  const e = await speak(async () => {}, { onDelta: () => {}, persist: async () => {} })
  ok(e.error === 'no answer', 'speak: a stream that ends without onDone or onError is a failed answer')
  let saved = 0
  const f = await speak(async cb => { cb.onDone({ cost: 0.02 }); throw new Error('after done') }, { onDelta: () => {}, persist: async () => { await wait(10); saved++ } })
  ok(f.error === null && f.cost === 0.02 && saved === 1, 'speak: an error after onDone does not undo the answer')
  const g = await speak(async cb => { cb.onDone({ cost: 0 }) }, { onDelta: () => {}, persist: async () => { throw new Error('db down') } })
  ok(g.error === null, 'speak: a failed save is logged, the answer still settles')

  // inTurn(): one after another; a failure does not stop the rest.
  const log: string[] = []
  const one = (fail?: number) => async (i: number) => { log.push(`start:${i}`); await wait(5); log.push(`end:${i}`); return { text: i === fail ? '' : `t${i}`, cost: i === fail ? 0 : 0.01, error: i === fail ? 'x' : null } }
  const r1 = await inTurn(3, one(1), () => false)
  ok(log.join(',') === 'start:0,end:0,start:1,end:1,start:2,end:2' && r1.spoken.length === 3 && r1.skipped === 0, 'inTurn: models one after another; the failed one does not stop the next')
  let gone = false
  const r2 = await inTurn(3, async i => { if (i === 0) gone = true; return { text: 'a', cost: 0, error: null } }, () => gone)
  ok(r2.spoken.length === 1 && r2.skipped === 2 && r2.halted === null, 'inTurn: a page that went away skips the models not started')
  const asked: number[] = []
  const r3 = await inTurn(3, async () => ({ text: 'a', cost: 0.01, error: null }), () => false, async i => { asked.push(i); return i >= 1 ? 'no_credits' : null })
  ok(r3.spoken.length === 1 && r3.skipped === 2 && r3.halted === 'no_credits' && asked.join(',') === '0,1', 'inTurn: the gate holds back the next model and the rest (wallet empty)')
  const r4 = await inTurn(2, async () => ({ text: 'a', cost: 0, error: null }), () => false, async () => { throw new Error('db') })
  ok(r4.spoken.length === 0 && r4.halted === 'unavailable', 'inTurn: a gate that throws holds the turn back')
  const r5 = await inTurn(2, async i => { if (i === 0) throw new Error('bug'); return { text: 'b', cost: 0, error: null } }, () => false)
  ok(r5.spoken[0].error === 'bug' && r5.spoken[1].text === 'b', 'inTurn: a model that throws counts as failed, the next still runs')

  // nextSpeaker(): the picked models take turns.
  const ms = ['A', 'B', 'C']
  ok([0, 1, 2, 3, 4].map(t => nextSpeaker(ms, t)).join('') === 'ABCAB' && nextSpeaker([], 0) === null, 'nextSpeaker: in turn, round and round')
}

function history() {
  const row = (seq: number, kind: MessageRow['kind'], content: string, cue: string | null, model: string | null, name: string | null): MessageRow =>
    ({ seq, kind, content, cue, trigger: 'user', after_event: null, model_id: model, model_name: name, cost: 0.001, created_at: '' })
  // One model only: the conversation as before (no labels, nothing heard).
  const solo = historyFor([row(1, 'viewer', 'hi', null, null, null), row(2, 'remark', 'hello', 'Viewer: hi', 'a', 'A'), row(3, 'remark', 'more', 'lull', 'a', 'A')], 'a')
  ok(solo.turns.length === 4 && solo.turns[0].content === 'Viewer: hi' && solo.turns[1].content === 'hello' && solo.heard === null, 'historyFor: one model reads the conversation as before')
  // Two models answered one question; then B spoke alone (its turn).
  const rows = [
    row(1, 'viewer', 'who wins?', null, null, null),
    row(2, 'remark', 'A says TB', 'Viewer: who wins?', 'a', 'Model A'),
    row(3, 'remark', 'B says CLE', 'Viewer: who wins?', 'b', 'Model B'),
    row(4, 'remark', 'B on the bullpen', '[A quiet stretch.]', 'b', 'Model B'),
  ]
  const forA = historyFor(rows, 'a')
  ok(forA.turns.length === 2 && forA.turns[1].content === 'A says TB', "historyFor: a model's own words are its turns")
  ok(!!forA.heard && forA.heard.includes('[Model B] B says CLE') && forA.heard.includes('[Model B] B on the bullpen') && forA.heard.includes('(quiet stretch') === false, "historyFor: the others' words since its last turn come labeled, before the new cue")
  ok(!!forA.heard && forA.heard.includes('([A quiet stretch.])'), 'historyFor: a turn it sat out says what it was about')
  const forB = historyFor(rows, 'b')
  ok(forB.turns.length === 4 && forB.turns[2].content.includes('[Model A] A says TB') && forB.turns[3].content === 'B on the bullpen' && forB.heard === null, "historyFor: the other model's answer to the same question comes in the next turn")
  // The same question twice with nothing new: two turns, never one model's
  // words labeled as another's.
  const twice = historyFor([row(1, 'remark', 'first', 'Viewer: again?', 'a', 'A'), row(2, 'remark', 'second', 'Viewer: again?', 'a', 'A')], 'a')
  ok(twice.turns.length === 4 && twice.turns[3].content === 'second' && twice.heard === null, 'historyFor: a repeated cue is two turns, not one')
}

// ── The route, with every import mocked (Codex's harness, Oct 13) ─────────
const root = join(__dirname, '..')
function load(rel: string, mocks: Record<string, unknown>) {
  const js = ts.transpileModule(readFileSync(join(root, rel), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const module = { exports: {} as any }
  vm.runInNewContext(js, { module, exports: module.exports, require: (id: string) => { if (id in mocks) return mocks[id]; throw Error('Unmocked import: ' + id) }, console, Request, Response, ReadableStream, TextEncoder, TextDecoder, setInterval, clearInterval, setTimeout, clearTimeout, URL }, { filename: rel })
  return module.exports
}

async function scenario(o: { balance?: number; ids?: string[]; fail?: string; cancel?: string; cost?: number; trigger?: string; refuseDebit?: boolean; thinking?: Record<string, string> } = {}) {
  const waits: Promise<unknown>[] = [], calls: string[] = [], writes: any[] = [], order: string[] = [], thinking: Record<string, string | null> = {}
  let balance = o.balance ?? 100
  const controller = new AbortController()
  class InsufficientCreditsError extends Error {}
  const model = (id: string) => ({ id, provider: 'fixture', display_name: id, model_name: id, enabled: true, output_modalities: ['text'], output_config: { text: { capabilities: ['web_search'], thinking_levels: ['none', 'low', 'high'] } } })
  const db = { auth: { getUser: async () => ({ data: { user: { id: 'fixture-user' } } }) }, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { balance_cents: balance } }) }) }) }) }
  const game = { events: [], roster: { away: [], home: [] }, season: 2026 }
  const route = load('app/api/xsports/talk/route.ts', {
    'next/server': { after: (p: Promise<unknown>) => waits.push(p) },
    '@/lib/supabase-server': { createSupabaseServer: async () => db },
    '@/lib/models': { getModelById: async (id: string) => model(id) },
    '@/lib/providers': { streamText: async (m: any, _messages: unknown, cb: StreamCallbacks, _att: unknown, _ctx: unknown, opts: any) => {
      calls.push(m.id); order.push('start:' + m.id); thinking[m.id] = opts?.thinking ?? null
      if (o.fail === m.id) { cb.onError('fixture provider failure'); return }
      cb.onDelta('Fixture reply ' + m.id)
      if (o.cancel === m.id) controller.abort()
      cb.onDone({ cost: o.cost ?? 0.01, inputTokens: 20 })
    } },
    '@/lib/credits': {
      accrueFraction: async (_u: string, micro: number) => Math.round(micro / 10000),
      debitCredits: async ({ amountCents }: { amountCents: number }) => {
        await wait(5)
        if (o.refuseDebit || amountCents > balance) throw new InsufficientCreditsError('insufficient')
        balance -= amountCents; order.push('debit:' + calls.at(-1))
      },
      InsufficientCreditsError,
    },
    '@/lib/provider-errors': { sanitizeProviderError: (s: string) => s },
    '@/lib/model-features': { FEATURE: { xsports: 'xsports' }, isBlockedFor: () => false },
    '@/lib/mlb': { getGame: async () => game, getSchedule: async () => [], getPlayers: async () => [], isGamePk: () => true, mlbToday: () => '2026-10-13' },
    '@/lib/nba': { getNbaGame: async () => game, getNbaSchedule: async () => [], isNbaId: () => true },
    '@/lib/xsports-prompt': { systemText: () => '', stateBlock: () => '', cueText: (_t: string, _g: unknown, _f: unknown, m: string) => m, lastTurn: (_s: string, c: string) => c, newSince: () => [], lastEventId: () => 'event1', playersBlock: () => '', involved: () => [], asLang: (l: string) => l, TRIGGERS: ['user', 'open', 'event', 'lull'] },
    '@/lib/xsports-store': {
      getChat: async () => ({ id: 'fixture-chat', league: 'mlb', game_id: '849813', since: null, spent_usd: 0 }),
      getMessages: async () => [],
      addMessage: async (_id: string, m: any) => { writes.push(m); order.push('save:' + m.kind + ':' + (m.model_id || '')) },
      touchChat: async () => writes.reduce((s, m) => s + (m.cost || 0), 0),
      historyFor: () => ({ turns: [], heard: null }),
      isChatId: () => true,
    },
    '@/lib/xsports-turn': load('lib/xsports-turn.ts', {}),
  })
  const res: Response = await route.POST(new Request('http://fixture.invalid/api/xsports/talk', {
    method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ league: 'mlb', pk: 849813, chatId: 'fixture-chat', trigger: o.trigger ?? 'user', message: 'How is the game?', modelIds: o.ids ?? ['modelA', 'modelB'], thinking: o.thinking }),
  }))
  const body = await res.text()
  await Promise.all(waits)
  const end = /event: end\ndata: (.+)/.exec(body)?.[1]
  return { status: res.status, body, calls, writes, order, balance, thinking, end: end ? JSON.parse(end) : null }
}

async function route() {
  const r = await scenario()
  ok(r.status === 200 && r.calls.join() === 'modelA,modelB', 'route: a question goes to every picked model, in order')
  ok(r.writes.filter(m => m.kind === 'viewer').length === 1 && r.writes.filter(m => m.kind === 'remark').length === 2, 'route: the question is stored once, a remark per model')
  ok(r.order.indexOf('start:modelB') > r.order.indexOf('save:remark:modelA') && r.order.indexOf('start:modelB') > r.order.indexOf('debit:modelA'), "route: the next model starts only after the last one's debit and saved remark")
  ok(r.end?.cost === 0.02 && r.end?.stopped === null && r.end?.skipped === 0, 'route: the turn ends with its cost')
  const failed = await scenario({ fail: 'modelA' })
  ok(failed.calls.join() === 'modelA,modelB' && failed.writes.filter(m => m.kind === 'remark').length === 1, 'route: a failed model does not stop the next')
  const cancelled = await scenario({ cancel: 'modelA', ids: ['modelA', 'modelB', 'modelC'] })
  ok(cancelled.calls.join() === 'modelA' && cancelled.writes.some(m => m.model_id === 'modelA'), 'route: a page that went away: the model on air is saved, the rest never start')
  const empty = await scenario({ balance: 0 })
  ok(empty.status === 402 && empty.calls.length === 0, 'route: an empty wallet is refused before any model')
  const exhausted = await scenario({ balance: 1, ids: ['modelA', 'modelB', 'modelC'] })
  ok(exhausted.calls.join() === 'modelA' && exhausted.end?.stopped === 'no_credits' && exhausted.end?.skipped === 2 && exhausted.writes.some(m => m.model_id === 'modelA'), 'route: the wallet is asked before each model; run dry, the rest are skipped and the page is told (no_credits), what was said stays')
  const refused = await scenario({ refuseDebit: true, balance: 50 })
  ok(refused.calls.join() === 'modelA' && refused.end?.stopped === 'no_credits', 'route: a debit refused for lack of credits stops the rest')
  const twice = await scenario({ ids: ['modelA', 'modelA'] })
  ok(twice.calls.join() === 'modelA', 'route: a model picked twice answers once')
  const five = await scenario({ ids: ['a', 'b', 'c', 'd', 'e'] })
  ok(five.status === 400 && five.calls.length === 0, 'route: at most four models')
  const auto = await scenario({ trigger: 'lull' })
  ok(auto.status === 400 && auto.calls.length === 0, 'route: a remark nobody asked for takes exactly one model')
  const thought = await scenario({ ids: ['modelA', 'modelB', 'modelC'], thinking: { modelA: 'high', modelB: 'ultra' } })
  ok(thought.thinking.modelA === 'high' && thought.thinking.modelB === 'none' && thought.thinking.modelC === 'none', "route: each model thinks at the level chosen for it, if it declares it; else its quickest")
  const autoOne = await scenario({ trigger: 'lull', ids: ['modelB'] })
  ok(autoOne.status === 200 && autoOne.calls.join() === 'modelB' && autoOne.writes.every(m => m.kind === 'remark'), 'route: one model unasked; no viewer message is stored')
}

;(async () => {
  await turnHelpers()
  history()
  await route()
  console.log(fails ? `${fails} FAILED` : 'all passed')
  process.exitCode = fails ? 1 : 0
})().catch(e => { console.error(e); process.exitCode = 1 })
