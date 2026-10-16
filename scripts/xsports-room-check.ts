// scripts/xsports-room-check.ts — checks the two AI commentators of X體育's
// public chat (Oct 14: Qwen 3.8 Flash joined GPT-6 Luna; Oct 15: each game
// draws two top models, the cheap pair past the day's cap) without a
// network, a database or a provider:
//   - lib/xsports-ais askedAis(): who a message asks (@AI, @Luna, @Qwen, a
//     top pair's handles); a fan's @ID that only starts like one, or a
//     model not in the room, never counts; gameDraw(): fixed per game, two
//     makers, every top model drawn
//   - lib/xsports-ai-spend: the Taipei day's total against $50, failing
//     closed when the day cannot be read
//   - lib/xsports-room-ai roomSpeak(), transpiled and run with every import
//     mocked (the harness of scripts/xsports-turn-check.ts): they take
//     turns; a named one answers, and only it; @AI and ticks fall to the
//     other when one fails; one asking the other gets one answer, never a
//     question back; the cheap pair thinks at its quickest, the top pair at
//     its middle; what each one reads; every remark's cost is counted
//   - app/api/xsports/room/route.ts POST: each commentator named answers, in
//     order, one after the other; the first message confirms the name, which
//     may be the sign-in name
//   - 晴晴 (lib/xsports-cheer, lib/xsports-cheer-media): when she cheers, her
//     pictures and clips, her team, and an admin's asks from her card
//     (app/api/xsports/cheer: admins only; the 加油 picture is drawn, shown,
//     then posted)
//
//   npx tsx scripts/xsports-room-check.ts       exit code 1 on any failure

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import { askedAis, CHEAP_AIS, TOP_AIS, gameDraw } from '../lib/xsports-ais'

let fails = 0
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails++ }
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

function asks() {
  const who = (t: string, room = CHEAP_AIS) => askedAis(t, room).map(w => (w === 'any' ? 'any' : w.handle)).join(',')
  ok(who('@Qwen 誰會贏？') === 'Qwen', 'askedAis: @Qwen asks Qwen')
  ok(who('@luna @QWEN 你們覺得呢') === 'Luna,Qwen' && who('@Qwen 先說，@Luna 再說') === 'Qwen,Luna', 'askedAis: both, in the order named, any case')
  ok(who('@AI 誰會贏') === 'any' && who('＠ＡＩ 誰會贏') === 'any' && who('@ai球友 你好') === 'any', 'askedAis: @AI (full-width too) asks whichever is up')
  ok(who('@AI @Qwen 誰會贏') === 'Qwen', 'askedAis: a commentator named outranks @AI')
  ok(who('@aiko 你好') === '' && who('@lunatic 你好') === '' && who('@qwen_fan 你好') === '' && who('@luna.x 你好') === '' && who('寫信到 a@ai.com') === '', "askedAis: a fan's @ID that only starts like one asks nobody")
  ok(who('Luna 跟 Qwen 都不錯') === '' && who('好球！') === '', 'askedAis: a name without @ asks nobody')
  const OG = [TOP_AIS[0], TOP_AIS[2]]
  ok(who('@Opus 誰會贏', OG) === 'Opus' && who('@gemini @OPUS 你們呢', OG) === 'Gemini,Opus', 'askedAis: a top pair by its handles, in the order named')
  ok(who('@Sol 你好', OG) === '' && who('@Luna 你好', OG) === '' && who('@Sol @AI 你好', OG) === 'any', 'askedAis: a model that is not in this room asks nobody (@AI still asks whoever is up)')
}

function draws() {
  const a = gameDraw('mlb', '849811')
  ok(a.map(x => x.handle).join() === gameDraw('mlb', '849811').map(x => x.handle).join() && a.length === TOP_AIS.length, 'gameDraw: the same order every time for a game')
  ok(new Set(a.slice(0, 2).map(x => x.provider)).size === 2, "gameDraw: a game's two are two makers")
  const n = new Map<string, number>()
  for (let g = 800000; g < 800500; g++) for (const x of gameDraw('mlb', String(g)).slice(0, 2)) n.set(x.handle, (n.get(x.handle) ?? 0) + 1)
  ok(TOP_AIS.every(x => (n.get(x.handle) ?? 0) > 120), `gameDraw: over 500 games every top model is drawn, ~200 each (${[...n].map(([h, c]) => `${h} ${c}`).join(', ')})`)
  const pairs = new Set(Array.from({ length: 50 }, (_, i) => gameDraw('nba', String(401898400 + i)).slice(0, 2).map(x => x.handle).sort().join('+')))
  ok(pairs.size >= 8, `gameDraw: games draw different pairs (${pairs.size} of 10 possible over 50 games)`)
}

// ── lib/xsports-ai-spend.ts: the day's total and the cap ──────────────────
async function ledger() {
  const mk = (o: { usd?: number; error?: boolean; rpcUsd?: number } = {}) => {
    const rpcCalls: any[] = []
    const mod = load('lib/xsports-ai-spend.ts', {
      './xsports-store': {
        xsportsAdmin: () => ({
          from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => (o.error ? { data: null, error: { code: '42P01', message: 'relation does not exist' } } : { data: o.usd === undefined ? null : { usd: o.usd }, error: null }) }) }) }),
          rpc: async (name: string, args: any) => { rpcCalls.push({ name, ...args }); return { data: [{ usd: o.rpcUsd ?? 1, remarks: 1, capped_at: null }], error: null } },
        }),
      },
    })
    return { mod, rpcCalls }
  }
  ok(await mk({ error: true }).mod.overCapToday() === true, 'ledger: a day that cannot be read (no table yet) counts as over the cap: the cheap pair')
  ok(await mk({}).mod.overCapToday() === false && await mk({ usd: 49.99 }).mod.overCapToday() === false, 'ledger: nothing spent, or under $50: the top models')
  ok(await mk({ usd: 50 }).mod.overCapToday() === true, 'ledger: $50 reached: over the cap')
  const a = mk({ rpcUsd: 50.01 })
  await a.mod.addSpend(0.03)
  ok(a.rpcCalls[0]?.name === 'add_xsports_ai_spend' && a.rpcCalls[0].p_usd === 0.03 && a.rpcCalls[0].p_cap === 50 && /^\d{4}-\d{2}-\d{2}$/.test(a.rpcCalls[0].p_day), 'ledger: a remark adds its cost to the Taipei day, against $50')
  ok(await a.mod.overCapToday() === true, 'ledger: the remark that crosses the cap switches this server at once')
  ok(a.mod.taipeiDay(new Date('2026-10-14T16:30:00Z')) === '2026-10-15' && a.mod.taipeiDay(new Date('2026-10-14T15:59:00Z')) === '2026-10-14', 'ledger: the day turns at Taipei midnight')
}

// ── lib/xsports-room-ai.ts with every import mocked ──────────────────────
const root = join(__dirname, '..')
const warned: string[] = []
const quiet = { ...console, warn: (...a: unknown[]) => { warned.push(a.map(String).join(' ')) } }
function load(rel: string, mocks: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const js = ts.transpileModule(readFileSync(join(root, rel), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const module = { exports: {} as any }
  vm.runInNewContext(js, {
    module, exports: module.exports, require: (id: string) => { if (id in mocks) return mocks[id]; throw Error('Unmocked import: ' + id) },
    console: quiet, Request, Response, URL, clearTimeout, process: { env: {} },
    // The room's lock waits 1.5 s between tries; not here.
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, Math.min(ms, 5)),
    ...globals,
  }, { filename: rel })
  return module.exports
}
const ais = load('lib/xsports-ais.ts', {})
const [LUNA, QWEN] = ais.CHEAP_AIS
const K = { league: 'mlb', game: '849811', lang: 'zh-Hant' }

type Reply = string | { fail: string } | { silent: true }
function room(o: { plan?: Record<string, Reply | Reply[]>; rows?: any[]; missing?: string[]; disabled?: string[]; busy?: number; capped?: boolean } = {}) {
  const spent: number[] = []
  const names: Record<string, string> = Object.fromEntries(ais.ALL_AIS.map((a: any) => [a.model_name, a.name]))
  const tops = new Set(ais.TOP_AIS.map((a: any) => a.model_name))
  const calls: { model: string; thinking: string | null; system: string; prompt: string; search: boolean }[] = []
  const stored: any[] = (o.rows ?? []).map((r, i) => ({ id: i + 1, kind: 'human', author_name: 'Fan', author_handle: null, author_avatar: null, model_name: null, reply_to: null, created_at: '', ...r }))
  const released: any[] = []
  let id = 100, busy = o.busy ?? 0
  const levels: Record<string, string[]> = {
    'gpt-6-luna': ['none', 'low', 'medium', 'high', 'xhigh', 'max'], 'qwen3.8-flash': ['thinking_true', 'thinking_false'],
    'claude-opus-5-5': ['low', 'medium', 'high', 'xhigh', 'max'], 'gpt-6.1-sol': ['low', 'medium', 'high', 'xhigh', 'max'],
    'gemini-3.1-pro-preview': ['low', 'medium', 'high'], 'grok-4.7': ['low', 'medium', 'high', 'xhigh'], 'qwen3.8-max': ['thinking_true', 'thinking_false'],
  }
  const said: Record<string, number> = {}
  const mod = load('lib/xsports-room-ai.ts', {
    './providers': {
      streamText: async (model: any, messages: any[], cb: any, _att: unknown, _ctx: unknown, opts: any) => {
        calls.push({ model: model.model_name, thinking: opts?.thinking ?? null, system: opts?.system ?? '', prompt: messages[0].content, search: !!opts?.search })
        const p = o.plan?.[model.model_name]
        const n = said[model.model_name] = (said[model.model_name] ?? 0) + 1
        const r: Reply = Array.isArray(p) ? p[n - 1] ?? `${model.display_name} remark ${n}` : p ?? `${model.display_name} remark ${n}`
        await wait(2)
        if (typeof r === 'object' && 'fail' in r) { cb.onError(r.fail); return }
        if (typeof r === 'object') return // ends without done or error
        for (const piece of r.match(/.{1,6}/gu) ?? []) cb.onDelta(piece)
        cb.onDone({ cost: tops.has(model.model_name) ? 0.02 : 0.0001 })
      },
    },
    './models': {
      getModelByProviderName: async (provider: string, name: string) => (o.missing?.includes(name) ? null : {
        provider, model_name: name, display_name: names[name], enabled: !o.disabled?.includes(name), blocked_features: [],
        output_config: { text: { thinking_levels: levels[name] ?? [], capabilities: ['web_search'] } },
      }),
    },
    './mlb': { getGame: async () => ({ status: 'live', start: '2026-10-15T00:00:00Z', events: [] }), getSchedule: async () => [], mlbToday: () => '2026-10-14' },
    './nba': { getNbaGame: async () => ({ status: 'live', events: [] }), getNbaSchedule: async () => [] },
    './xsports-prompt': { systemText: () => 'SYSTEM', stateBlock: () => 'STATE', cueText: (t: string) => `[cue: ${t}]`, newSince: () => [], lastEventId: () => 'ev9' },
    './xsports-room': {
      addRoomMessage: async (_k: unknown, m: any) => { const msg = { id: id++, author_handle: null, author_avatar: null, model_name: null, reply_to: null, created_at: '', ...m }; stored.push(msg); return msg },
      claimSpeaker: async () => (busy > 0 ? (busy--, null) : { ai_since: 'ev1', ai_lulls: 0, ai_last_at: '2026-10-14T00:00:00Z' }),
      recentMessages: async () => stored.slice(-30),
      releaseSpeaker: async (_k: unknown, patch: any) => { released.push(patch) },
    },
    './xsports-ais': ais,
    './model-features': { FEATURE: { xsports: 'xsports' } },
    // The cheap pair unless a check says otherwise: the checks from Oct 14.
    './xsports-ai-spend': { overCapToday: async () => o.capped ?? true, addSpend: async (usd: number) => { spent.push(usd) } },
    './provider-errors': { sanitizeProviderError: (s: string) => s },
  })
  const ai = () => stored.filter(m => m.kind === 'ai')
  return { speak: mod.roomSpeak as (k: typeof K, t: string, opts?: any) => Promise<void>, transcript: mod.transcript, nextUp: mod.nextUp, calls, stored, released, ai, spent }
}

async function commentators() {
  // Turns: nobody asked, three ticks; Luna, Qwen, Luna.
  const r = room({ rows: [{ author_name: '阿明', author_handle: 'aming', content: '今天誰會贏？' }] })
  for (let i = 0; i < 3; i++) await r.speak(K, 'lull')
  ok(r.ai().map(m => m.model_name).join(',') === 'GPT-6 Luna,Qwen 3.8 Flash,GPT-6 Luna' && r.ai().every(m => m.author_name === m.model_name), 'roomSpeak: unasked, they take turns, each under its own model name')
  ok(r.calls.map(c => c.thinking).join(',') === 'none,thinking_false,none' && r.calls.every(c => !c.search), "roomSpeak: each at its quickest thinking (Luna 'none', Qwen 'thinking_false'), no search unasked")
  const q = r.calls[1], l = r.calls[2]
  ok(q.system.includes('You are Qwen 3.8 Flash (@Qwen)') && q.system.includes('GPT-6 Luna (@Luna)') && r.calls[0].system.includes('You are GPT-6 Luna (@Luna)'), 'roomSpeak: each is told who it is and who the other is')
  ok(q.prompt.includes('GPT-6 Luna (@Luna, the other AI commentator): GPT-6 Luna remark 1') && q.prompt.includes('阿明 (@aming): 今天誰會贏？') && !q.prompt.includes('(you)'), "roomSpeak: the other's words come under its name, a fan's under name and @ID")
  ok(l.prompt.includes('(you): GPT-6 Luna remark 1') && l.prompt.includes('Qwen 3.8 Flash (@Qwen, the other AI commentator): Qwen 3.8 Flash remark 1'), 'roomSpeak: its own words come as "(you)"')
  ok(r.released.length === 3 && r.released.every(p => p.spoke === true), 'roomSpeak: the floor is released after every remark')

  // A fan names one: it answers even when it is not its turn, with search.
  const a = room({ rows: [{ id: 1, author_name: '阿明', author_handle: 'aming', content: '@Qwen 誰會贏？' }] })
  await a.speak(K, 'user', { asker: { name: '阿明', text: '@Qwen 誰會贏？', id: 1 }, wait: true, who: QWEN })
  ok(a.calls.map(c => c.model).join() === 'qwen3.8-flash' && a.ai().length === 1 && a.ai()[0].model_name === 'Qwen 3.8 Flash' && a.ai()[0].reply_to === 1 && a.calls[0].search, 'roomSpeak: @Qwen is answered by Qwen, as a reply, with search')
  ok(a.calls[0].prompt.includes('阿明 asked you: @Qwen 誰會贏？') && a.calls[0].prompt.includes('[Answer 阿明 by name, briefly.]'), 'roomSpeak: the one named is told who asked and what')

  // The one named fails or is not in the catalog: nobody stands in.
  const f = room({ plan: { 'qwen3.8-flash': { fail: 'fixture failure' } } })
  await f.speak(K, 'user', { asker: { name: '阿明', text: '@Qwen 你好', id: 1 }, wait: true, who: QWEN })
  ok(f.calls.map(c => c.model).join() === 'qwen3.8-flash' && f.ai().length === 0 && f.released[0]?.spoke === false, 'roomSpeak: the one named fails, nobody answers in its place')
  const m = room({ missing: ['qwen3.8-flash'] })
  await m.speak(K, 'user', { asker: { name: '阿明', text: '@Qwen 你好', id: 1 }, wait: true, who: QWEN })
  ok(m.calls.length === 0 && m.ai().length === 0, 'roomSpeak: the one named is not in the catalog, nobody answers')

  // @AI and ticks: the one up fails, is off, or says nothing; the other speaks.
  const t = room({ plan: { 'gpt-6-luna': { fail: 'fixture failure' } } })
  await t.speak(K, 'lull')
  ok(t.calls.map(c => c.model).join() === 'gpt-6-luna,qwen3.8-flash' && t.ai().map(x => x.model_name).join() === 'Qwen 3.8 Flash', 'roomSpeak: a tick whose one up fails is spoken by the other')
  const d = room({ disabled: ['gpt-6-luna'] })
  await d.speak(K, 'user', { asker: { name: '阿明', text: '@AI 你好', id: 1 }, wait: true })
  ok(d.calls.map(c => c.model).join() === 'qwen3.8-flash' && d.ai().length === 1, '@AI with the one up switched off in the catalog: the other answers')
  const s = room({ plan: { 'gpt-6-luna': { silent: true } } })
  await s.speak(K, 'lull')
  ok(s.calls.map(c => c.model).join() === 'gpt-6-luna,qwen3.8-flash' && s.ai().length === 1, 'roomSpeak: a stream that ends with no word falls to the other')

  // One asks the other: one answer, as a reply, and it asks nothing back.
  const x = room({ plan: { 'gpt-6-luna': ['我看好道奇。@Qwen 你覺得呢？'], 'qwen3.8-flash': ['同意，但釀酒人的牛棚很深。@Luna 你說呢？'] } })
  await x.speak(K, 'lull')
  const [first, second] = x.ai()
  ok(x.ai().length === 2 && first.model_name === 'GPT-6 Luna' && second.model_name === 'Qwen 3.8 Flash' && second.reply_to === first.id, 'roomSpeak: Luna asks @Qwen, Qwen answers it as a reply')
  ok(x.calls[1].prompt.includes('GPT-6 Luna (the other AI commentator) asked you:') && x.calls[1].prompt.includes('Do not ask it anything back.'), 'roomSpeak: the answer is told it was asked by the other commentator, and not to ask back')
  ok(x.calls.length === 2 && x.released.length === 2, "roomSpeak: the answer's own @Luna starts nothing; two models cannot keep each other talking")
  const y = room({ plan: { 'gpt-6-luna': ['我是 @Luna，@AI 都可以問我。'] } })
  await y.speak(K, 'lull')
  ok(y.calls.length === 1 && y.ai().length === 1, 'roomSpeak: writing its own @handle or @AI asks nobody')
  const z = room({ plan: { 'gpt-6-luna': ['阿明，我看道奇。@Qwen 補充一下？'] } })
  await z.speak(K, 'user', { asker: { name: '阿明', text: '@Luna 誰會贏？', id: 1 }, wait: true, who: LUNA })
  ok(z.ai().map(v => v.model_name).join() === 'GPT-6 Luna,Qwen 3.8 Flash' && z.ai()[1].reply_to === z.ai()[0].id, "roomSpeak: answering a fan, Luna may ask @Qwen; Qwen answers once")

  // The floor: a fan's question waits for it; a tick does not.
  const w = room({ busy: 2 })
  await w.speak(K, 'user', { asker: { name: '阿明', text: '@AI 你好', id: 1 }, wait: true })
  ok(w.ai().length === 1, 'roomSpeak: a question waits for the floor')
  const b = room({ busy: 1 })
  await b.speak(K, 'lull')
  ok(b.calls.length === 0 && b.ai().length === 0, 'roomSpeak: a tick that finds the floor taken says nothing')

  // nextUp(): whoever did not speak last; the first word is Luna's.
  const up = (names: (string | null)[]) => r.nextUp(names.map((n, i) => ({ id: i, kind: n ? 'ai' : 'human', model_name: n, content: '', author_name: '' })), CHEAP_AIS).handle
  ok(up([]) === 'Luna' && up(['GPT-6 Luna']) === 'Qwen' && up(['GPT-6 Luna', null, 'Qwen 3.8 Flash', null]) === 'Luna' && up(['an old model']) === 'Luna', 'nextUp: turns by who spoke last; fans in between do not count')
}

// ── The top pair (Oct 15): the game's draw, middle thinking, the cap ───────
async function topPair() {
  const [A, B, C] = gameDraw('mlb', K.game)
  const r = room({ capped: false })
  for (let i = 0; i < 3; i++) await r.speak(K, 'lull')
  ok(r.ai().map(m => m.model_name).join() === [A.name, B.name, A.name].join(), `top pair: the game's draw speaks, taking turns (${A.handle}, ${B.handle})`)
  ok(r.calls.every(c => c.thinking === (c.model === 'qwen3.8-max' ? 'thinking_true' : 'medium')), 'top pair: each at its middle thinking (medium; Qwen thinking on)')
  ok(r.calls[1].system.includes(`You are ${B.name} (@${B.handle})`) && r.calls[1].system.includes(`${A.name} (@${A.handle})`) && r.calls[1].prompt.includes(`${A.name} (@${A.handle}, the other AI commentator)`), 'top pair: each is told who it is and who the other is')
  ok(r.spent.length === 3 && r.spent.every(x => x === 0.02), "top pair: every remark's cost goes to the day's total")
  const d = room({ capped: false, disabled: [A.model_name] })
  await d.speak(K, 'lull')
  await d.speak(K, 'lull')
  ok(d.ai().map(m => m.model_name).join() === [B.name, C.name].join(), 'top pair: a drawn model switched off is replaced by the next in the draw')
  const c = room({ capped: true })
  await c.speak(K, 'lull')
  ok(c.ai()[0]?.model_name === 'GPT-6 Luna' && c.calls[0].thinking === 'none', 'over the cap: the cheap pair speaks, at its quickest')
  const f = room({ capped: false, plan: { [A.model_name]: { fail: 'fixture failure' }, [B.model_name]: { fail: 'fixture failure' } } })
  await f.speak(K, 'lull')
  ok(f.calls.map(x => x.model).join() === [A.model_name, B.model_name, 'gpt-6-luna'].join() && f.ai()[0]?.model_name === 'GPT-6 Luna', 'top pair: both fail, the cheap pair speaks instead')
  const g = room({ capped: true })
  await g.speak(K, 'user', { asker: { name: '阿明', text: `@${A.handle} 你好`, id: 1 }, wait: true, who: A })
  ok(g.calls.length === 0 && g.ai().length === 0, 'a commentator named that has left the room (the cap was reached since): nobody answers')
  const x = room({ capped: false, plan: { [A.model_name]: [`我看好道奇。@${B.handle} 你覺得呢？`] } })
  await x.speak(K, 'lull')
  ok(x.ai().map(m => m.model_name).join() === [A.name, B.name].join() && x.ai()[1].reply_to === x.ai()[0].id, `top pair: ${A.handle} asks @${B.handle}, which answers once`)
}

// ── 晴晴, the room's cheerleader (Oct 15) ─────────────────────────────────
const T0 = Date.parse('2026-10-15T01:00:00Z')
const cheerMedia = load('lib/xsports-cheer-media.ts', { './face': load('lib/face.ts', {}) })
const SB = 'https://sb.test'
const SHOUT_DIR = `${SB}/storage/v1/object/public/x-characters/c9a73e58-b5b4-48bf-a794-0b8bb347af89/cheer/shout/`
const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e'
const play = (i: number, o: { type?: string; scoring?: boolean; away?: number; home?: number; inning?: number; text?: string } = {}) => ({
  id: String(i), inning: o.inning ?? 1, half: 'top', kind: 'pa', type: o.type ?? 'single', text: o.text ?? `play ${i}`, scoring: !!o.scoring,
  away: o.away ?? 0, home: o.home ?? 0, outs: 1, endsHalf: false, big: !!o.scoring, at: new Date(T0 + i * 60_000).toISOString(),
})
const game = (status: string, events: any[]) => ({ league: 'mlb', status, events, away: { name: 'Brewers', runs: events.at(-1)?.away ?? 0 }, home: { name: 'Dodgers', runs: events.at(-1)?.home ?? 0 } })
function cheerRoom(o: { capped?: boolean; last?: number | null; lastAfterLock?: number | null; visibility?: string; reply?: Reply; g?: any; mediaRows?: { media_url: string; created_at: string }[]; media?: boolean } = {}) {
  const calls: { model: string; thinking: string | null; system: string; prompt: string }[] = [], stored: any[] = [], released: any[] = [], spent: number[] = []
  let reads = 0
  const chain = (table: string) => {
    const q: any = { select: () => q, eq: () => q, order: () => q, limit: () => q, not: () => q,
      // A list read (her recent pictures) is awaited as it is.
      then: (ok2: any, no: any) => Promise.resolve({ data: o.mediaRows ?? [], error: null }).then(ok2, no),
      maybeSingle: async () => {
      if (table === 'x_characters') return { data: { id: 'c1', name: '晴晴', persona: 'PERSONA-晴晴', avatar_path: 'f/a.jpg', model_id: 'm-sonnet', thinking: 'low', visibility: o.visibility ?? 'public' } }
      if (table === 'ai_models') return { data: { id: 'm-sonnet', provider: 'anthropic', model_name: 'claude-sonnet-5', enabled: true, blocked_features: [], output_config: { text: { thinking_levels: ['low', 'medium', 'high'] } } } }
      // roomCheer reads it once, after taking the floor (the tick decided before).
      reads++
      const t = o.lastAfterLock !== undefined ? o.lastAfterLock : o.last ?? null
      return { data: t === null ? null : { created_at: new Date(t).toISOString() } }
    } }
    return q
  }
  const mod = load('lib/xsports-cheer.ts', {
    './providers': {
      streamText: async (model: any, messages: any[], cb: any, _a: unknown, _c: unknown, opts: any) => {
        calls.push({ model: model.model_name, thinking: opts?.thinking ?? null, system: opts?.system ?? '', prompt: messages[0].content })
        const r = o.reply ?? '安打安打！大家一起喊！📣'
        if (typeof r === 'object' && 'fail' in r) { cb.onError(r.fail); return }
        cb.onDelta(r as string)
        cb.onDone({ cost: 0.006 })
      },
    },
    './models': { getModelByProviderName: async (provider: string, name: string) => ({ provider, model_name: name, enabled: true, blocked_features: [], output_config: { text: { thinking_levels: ['none', 'low'] } } }) },
    './model-features': { FEATURE: { xsports: 'xsports' } },
    './xsports-store': { xsportsAdmin: () => ({ from: (t: string) => chain(t) }) },
    './xsports-prompt': { stateBlock: () => 'STATE' },
    './xsports-room': {
      addRoomMessage: async (_k: unknown, m: any) => { const msg = { id: 500 + stored.length, ...m }; stored.push(msg); return msg },
      claimSpeaker: async () => ({ ai_since: null }), recentMessages: async () => [], releaseSpeaker: async (_k: unknown, p: any) => { released.push(p) },
      roomMedia: () => o.media ?? true,
    },
    './xsports-ai-spend': { overCapToday: async () => o.capped ?? false, addSpend: async (usd: number) => { spent.push(usd) } },
    './xsports-ais': ais,
    './xsports-cheer-media': cheerMedia,
    './xsports-room-ai': { gameFor: async () => o.g ?? game('live', [play(1)]) },
    './provider-errors': { sanitizeProviderError: (s: string) => s },
  }, { process: { env: { NEXT_PUBLIC_SUPABASE_URL: SB } } })
  return { mod, calls, stored, released, spent }
}

// ── lib/xsports-cheer-fresh.ts: an admin's ask, made fresh (Oct 16) ───────
const FRESH = `${SB}/storage/v1/object/public/x-characters/c9a73e58-b5b4-48bf-a794-0b8bb347af89/cheer/fresh/`
function freshRoom(o: { g?: any; videoFails?: boolean; off?: string; listed?: string[] } = {}) {
  const images: { model: string; prompt: string; size: string; ports: string[] }[] = [], videos: any[] = [], uploads: { bucket: string; path: string; type: string }[] = []
  const fetched: string[] = [], spent: number[] = [], ran: string[][] = [], disk = new Map<string, Buffer>()
  const mod = load('lib/xsports-cheer-fresh.ts', {
    'crypto': { randomUUID: () => UUID },
    'node:fs/promises': { mkdtemp: async (p: string) => p + 'X', writeFile: async (f: string, b: Buffer) => { disk.set(f, b) }, readFile: async (f: string) => disk.get(f) ?? Buffer.from(''), rm: async () => {} },
    'node:os': { tmpdir: () => '/tmp' },
    'node:path': { join: (...a: string[]) => a.join('/') },
    './providers': {
      generateImage: async (model: any, prompt: string, _q: string, size: string, atts: any[]) => {
        images.push({ model: model.model_name, prompt, size, ports: atts.map(a => a.port) })
        return { buffer: Buffer.from('png'), mediaType: 'image/png', cost: 0.053 }
      },
      generateVideo: async (model: any, prompt: string, size: string, seconds: number, atts: any[], _p: unknown, _c: unknown, opts: any) => {
        videos.push({ model: model.model_name, prompt, size, seconds, ports: atts.map(a => a.port), url: atts[0]?.url, watermark: opts?.watermark })
        if (o.videoFails) throw new Error('fixture: the clip failed')
        return { buffer: Buffer.from('raw-mp4'), mediaType: 'video/mp4', durationSeconds: 5, cost: 0.9 }
      },
    },
    './models': { getModelByProviderName: async (provider: string, name: string) => ({ provider, model_name: name, enabled: o.off !== name, blocked_features: [] }) },
    './xsports-store': { xsportsAdmin: () => ({ storage: { from: (bucket: string) => ({
      upload: async (path: string, _b: unknown, opt: any) => { uploads.push({ bucket, path, type: opt?.contentType }); return { error: null } },
      list: async (_dir: string, opt: any) => ({ data: (o.listed ?? []).filter(n => n.includes(opt?.search ?? '')).map(name => ({ name })), error: null }),
    }) } }) },
    './xsports-ai-spend': { addSpend: async (usd: number) => { spent.push(usd) } },
    './xsports-room-ai': { gameFor: async () => o.g ?? game('live', [play(1)]) },
    './xcut-render': { ffmpegPath: () => 'ffmpeg', run: async (_bin: string, args: string[]) => { ran.push(args); disk.set(args[args.length - 1], Buffer.from('mp4-small')) } },
    './xsports-cheer-media': cheerMedia,
    './xsports-cheer': {
      publicBase: () => `${SB}/storage/v1/object/public/x-characters`,
      mediaUrl: (m: any) => `${SB}/storage/v1/object/public/x-characters/c9a73e58-b5b4-48bf-a794-0b8bb347af89/cheer/${m.file}`,
      teamSide: (g: any) => (g.home?.abbr === 'LAD' ? 'home' : g.away?.abbr === 'LAD' ? 'away' : null),
      usable: (m: any) => !!m && m.enabled !== false,
    },
    'sharp': { __esModule: true, default: () => { const q: any = { resize: () => q, jpeg: () => q, toBuffer: async () => Buffer.from('jpg') }; return q } },
  }, {
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: SB } }, Buffer,
    fetch: async (url: string) => { fetched.push(url); return new Response('jpeg-bytes') },
  })
  return { mod, images, videos, uploads, fetched, spent, ran }
}

async function cheerleader() {
  ok(ais.asksCheer('@晴晴 加油') && ais.asksCheer('＠晴晴 你好') && !ais.asksCheer('晴晴好可愛'), 'asksCheer: @晴晴 (full-width ＠ too) asks her; her name without @ does not')
  ok(ais.cheersIn({ league: 'mlb', lang: 'zh-Hant' }) && !ais.cheersIn({ league: 'mlb', lang: 'en' }) && !ais.cheersIn({ league: 'nba', lang: 'zh-Hant' }), 'cheersIn: MLB 繁中 rooms only')
  const { mod } = cheerRoom()
  const due = (g: any, last: number | null, now: number) => mod.cheerDue(g, last, now)?.trigger ?? null
  const hr = [play(1, { scoring: true, away: 1 }), play(2, { type: 'home_run', scoring: true, away: 2, inning: 3 })]
  ok(due(game('live', [play(1)]), null, T0 + 120_000) === 'first', 'cheerDue: a live game she has not cheered: the game as it stands')
  ok(due(game('live', hr), T0 + 150_000 - 30_000, T0 + 150_000) === null, 'cheerDue: at most one cheer every two minutes')
  const m = mod.cheerDue(game('live', hr), T0 + 90_000, T0 + 400_000)
  ok(m?.trigger === 'moment' && m.event.type === 'home_run', 'cheerDue: a home run since her last word')
  ok(due(game('live', [play(1, { scoring: true, away: 1 }), play(3, { scoring: true, away: 2, inning: 3 })]), T0 + 120_000, T0 + 600_000) === 'moment', 'cheerDue: every run, even one that only adds to a lead (Oct 16: a 2-run double in the 4th left her silent)')
  const halfEnd = { ...play(3, { inning: 4 }), endsHalf: true }
  const rally = mod.cheerDue(game('live', [play(1), halfEnd]), T0 + 120_000, T0 + 600_000)
  ok(rally?.trigger === 'moment' && rally.event.endsHalf === true, 'cheerDue: a half-inning ended with no run since: a rally for the team coming up')
  const both = mod.cheerDue(game('live', [play(3, { scoring: true, away: 1, inning: 4 }), { ...play(4, { away: 1, inning: 4 }), endsHalf: true }]), T0 + 120_000, T0 + 600_000)
  ok(both?.trigger === 'moment' && both.event.scoring === true, 'cheerDue: a run since her last word comes before the half-inning that followed it')
  const rallyRoom = cheerRoom({ last: T0 + 120_000, g: game('live', [play(1), halfEnd]) })
  await rallyRoom.mod.roomCheer({ league: 'mlb', game: '849818', lang: 'zh-Hant' }, { trigger: 'moment', event: halfEnd })
  ok(rallyRoom.calls[0]?.prompt.includes('Dodgers come up to bat: lead their fans in a rally chant'), 'roomCheer: at a half-inning she rallies the team coming up (top over: the home team)')
  ok(due(game('live', [play(1, { scoring: true, away: 1 }), play(3, { scoring: true, away: 1, home: 1, inning: 3 })]), T0 + 120_000, T0 + 600_000) === 'moment', 'cheerDue: a run that ties the game')
  ok(due(game('live', [play(1, { scoring: true, away: 3, home: 1 }), play(3, { scoring: true, away: 4, home: 1, inning: 7 })]), T0 + 120_000, T0 + 600_000) === 'moment', 'cheerDue: any run from the seventh on')
  const fin = game('final', [play(1), play(5)])
  ok(due(fin, T0 + 60_000, T0 + 600_000) === 'final' && due(fin, T0 + 360_000, T0 + 600_000) === null && due(fin, null, T0 + 5 * 3_600_000) === null, 'cheerDue: a finished game once after its last play, while fresh')
  ok(due(game('preview', []), null, T0) === null, 'cheerDue: nothing before a game')

  const K2 = { league: 'mlb', game: '849818', lang: 'zh-Hant' }
  const a = cheerRoom()
  await a.mod.roomCheer(K2, { trigger: 'first' })
  const msg = a.stored[0]
  ok(msg?.kind === 'ai' && msg.model_name === '晴晴' && msg.author_name === '晴晴' && String(msg.author_avatar).endsWith('/x-characters/f/a.jpg') && msg.reply_to === null, 'roomCheer: her message carries her name and photo')
  ok(a.calls[0]?.model === 'claude-sonnet-5' && a.calls[0].thinking === 'low' && a.calls[0].system.includes('PERSONA-晴晴') && a.calls[0].system.includes("the room's AI cheerleader"), 'roomCheer: her own persona, model and thinking (from her character), plus the room rules')
  ok(a.spent.join() === '0.006' && a.released.length === 1 && Object.keys(a.released[0]).length === 0, "roomCheer: her cost counts toward the day; the floor is released without touching the commentators' state")
  const c = cheerRoom({ capped: true })
  await c.mod.roomCheer(K2, { trigger: 'first' })
  ok(c.calls[0]?.model === 'gpt-6-luna' && c.calls[0].thinking === 'none' && c.stored.length === 1, "roomCheer: past the day's cap she speaks on the cheap model")
  const p = cheerRoom({ visibility: 'private' })
  await p.mod.roomCheer(K2, { trigger: 'first' })
  ok(p.calls.length === 0 && p.stored.length === 0 && p.released.length === 1, 'roomCheer: a private character never speaks in a room')
  const r = cheerRoom({ last: null, lastAfterLock: Date.now() - 10_000 })
  await r.mod.roomCheer(K2, { trigger: 'first' })
  ok(r.calls.length === 0 && r.stored.length === 0, 'roomCheer: another page cheered while this one waited: nothing twice')
  const u = cheerRoom({ last: Date.now() - 10_000 })
  await u.mod.roomCheer(K2, { trigger: 'user', asker: { name: '阿明', text: '@晴晴 幫道奇加油！', id: 42 } })
  ok(u.stored[0]?.reply_to === 42 && u.calls[0].prompt.includes('阿明 asked you: @晴晴 幫道奇加油！'), "roomCheer: a fan's @晴晴 is answered at once, as a reply")
  const hrGame = game('live', hr)
  const mo = cheerRoom({ last: T0 + 90_000, g: hrGame })
  await mo.mod.roomCheer(K2, { trigger: 'moment', event: hr[1] })
  ok(mo.calls[0]?.prompt.includes('play 2') && mo.calls[0].prompt.includes('Brewers 2, Dodgers 0'), 'roomCheer: a moment is told the play and the score after it')
  const f = cheerRoom({ reply: { fail: 'fixture failure' } })
  await f.mod.roomCheer(K2, { trigger: 'first' })
  ok(f.stored.length === 0 && f.mod.cheerResting(K2) === true && f.released.length === 1, 'roomCheer: a failure says nothing and rests the room two minutes')
  // Her pictures (Oct 15).
  ok(cheerMedia.askedMedia('@晴晴 自拍一張！') === 'selfie' && cheerMedia.askedMedia('@晴晴 跳舞給我們看') === 'dance' && cheerMedia.askedMedia('@晴晴 拍張照') === 'any' && cheerMedia.askedMedia('@晴晴 鼓舞士氣') === null && cheerMedia.askedMedia('@晴晴 加油') === null, 'askedMedia: a selfie, a dance, any photo; other words ask for none')
  ok(cheerMedia.pickMedia('selfie', ['selfie.jpg', 'selfie2.jpg'], () => 0).file === 'ball.jpg', 'pickMedia: not one the room saw lately')
  ok(cheerMedia.pickMedia('any', [], () => 0.99).kind === 'image' && cheerMedia.pickMedia('dance', [], () => 0.99).kind === 'video', 'pickMedia: "any photo" is a photo; a dance may be a clip')
  const hi = cheerRoom()
  await hi.mod.roomCheer(K2, { trigger: 'first' })
  ok(String(hi.stored[0]?.media_url).endsWith('/cheer/wave.jpg') && hi.stored[0]?.media_kind === 'image' && hi.calls[0].prompt.includes('comes with a picture: you waving hello'), 'roomCheer: her first word in a room comes with a hello picture, and she knows what it shows')
  const sf = cheerRoom({ last: Date.now() - 10_000 })
  await sf.mod.roomCheer(K2, { trigger: 'user', asker: { name: '阿明', text: '@晴晴 自拍一張！', id: 43 } })
  ok(['selfie.jpg', 'selfie2.jpg', 'ball.jpg'].some(x => String(sf.stored[0]?.media_url).endsWith('/cheer/' + x)) && sf.stored[0]?.reply_to === 43, 'roomCheer: a fan asks for a selfie and gets one, as a reply')
  const soon = cheerRoom({ last: Date.now() - 10_000, mediaRows: [{ media_url: 'https://x/cheer/wave.jpg', created_at: new Date(Date.now() - 3 * 60_000).toISOString() }] })
  await soon.mod.roomCheer(K2, { trigger: 'user', asker: { name: '阿明', text: '@晴晴 跳舞！', id: 44 } })
  ok(!soon.stored[0]?.media_url && soon.calls[0].prompt.includes('the next one comes a little later'), 'roomCheer: within ten minutes of her last picture, words only, and she says the next comes later')
  const tie = [play(1, { scoring: true, away: 1 }), play(3, { scoring: true, away: 1, home: 1, inning: 3 })]
  const nolead = cheerRoom({ last: T0 + 90_000, g: game('live', tie) })
  await nolead.mod.roomCheer(K2, { trigger: 'moment', event: tie[1] })
  ok(nolead.stored.length === 1 && !nolead.stored[0].media_url, 'roomCheer: a tying run gets words only')
  const homer = cheerRoom({ last: T0 + 90_000, g: game('live', hr) })
  await homer.mod.roomCheer(K2, { trigger: 'moment', event: hr[1] })
  ok(/\/cheer\/(homerun\.jpg|clip-\d\.mp4)$/.test(String(homer.stored[0]?.media_url)), 'roomCheer: a home run comes with the 全壘打 sign or a dance clip')
  const pre = cheerRoom({ media: false })
  await pre.mod.roomCheer(K2, { trigger: 'first' })
  ok(pre.stored.length === 1 && !pre.stored[0].media_url && !pre.calls[0].prompt.includes('comes with'), 'roomCheer: before 136, words only')
  // Her team (Oct 16: "she support LA dodgers").
  const lad = (status: string, events: any[]) => ({ ...game(status, events), away: { name: 'Brewers', abbr: 'MIL', runs: 0 }, home: { name: 'Dodgers', abbr: 'LAD', runs: 0 } })
  ok(mod.teamSide(lad('live', [])) === 'home' && mod.teamSide({ ...game('live', []), away: { name: 'Rays', abbr: 'TB' }, home: { name: 'Guardians', abbr: 'CLE' } }) === null, 'teamSide: the Dodgers at home; no side in a game without them')
  const fan = cheerRoom({ g: lad('live', [play(1)]) })
  await fan.mod.roomCheer(K2, { trigger: 'first' })
  ok(fan.calls[0]?.prompt.includes('道奇迷') && fan.calls[0].prompt.includes('cheer for the Dodgers and their players by name'), 'roomCheer: in a Dodgers game she is a Dodgers fan')
  ok(!a.calls[0]?.prompt.includes('道奇迷'), 'roomCheer: in other games she cheers both sides')
  const blueSet = cheerMedia.CHEER_MEDIA.filter((m: any) => m.set === 'dodgers')
  ok(blueSet.length === 0 || /\/cheer\/blue-/.test(String(fan.stored[0]?.media_url)), 'roomCheer: in a Dodgers game her picture comes from the Dodger-blue set')
  ok(!String(hi.stored[0]?.media_url).includes('/cheer/blue-'), 'roomCheer: elsewhere from her red XD set')
  ok(cheerMedia.pickMedia('dance', [], () => 0.99, 'dodgers').file === 'blue-clip-2.mp4' && cheerMedia.pickMedia('dance', [], () => 0.99).file === 'clip-2.mp4', 'pickMedia: a dance clip in Dodger blue in her team\'s games, in red elsewhere')
  // An admin's asks from her card (Oct 16), made fresh ("fresh each time").
  ok(cheerMedia.CHEER_ACTIONS.join() === 'selfie,dance,cheer,shout' && cheerMedia.freshKind('dance') === 'video' && cheerMedia.freshKind('cheer') === 'video' && cheerMedia.freshKind('selfie') === 'image' && cheerMedia.freshKind('shout') === 'image', 'freshKind: a dance or a cheer is a clip; a selfie or a 加油 a picture')
  ok(cheerMedia.shoutName('  大谷 ') === '大谷' && cheerMedia.shoutName('「山本」') === '山本' && cheerMedia.shoutName('\u202eabc') === 'abc' && cheerMedia.shoutName('x'.repeat(17)) === '' && cheerMedia.shoutName('x'.repeat(16)).length === 16 && cheerMedia.shoutName(42) === '' && cheerMedia.shoutName('   ') === '', 'shoutName: cleaned like a website name, no brackets, at most 16; too long or empty is none')
  const clipUrl = FRESH + 'mg1abcde-' + UUID + '.mp4'
  const ad = cheerRoom({ last: Date.now() - 10_000, mediaRows: [{ media_url: 'https://x/cheer/wave.jpg', created_at: new Date(Date.now() - 60_000).toISOString() }] })
  await ad.mod.roomCheer(K2, { trigger: 'admin', action: 'dance', media: { url: clipUrl, kind: 'video' } })
  ok(ad.stored[0]?.media_url === clipUrl && ad.stored[0]?.media_kind === 'video' && ad.stored[0]?.reply_to === null && ad.calls[0].prompt.includes('Post a dance for the room now') && ad.calls[0].prompt.includes('comes with a clip: a short clip of you dancing') && ad.released.length === 1, "roomCheer: an admin's dance posts the clip the admin saw, at once: inside both gaps, not a reply")
  const picUrl = FRESH + 'mg1abcde-' + UUID + '.jpg'
  const sh = cheerRoom()
  await sh.mod.roomCheer(K2, { trigger: 'admin', action: 'shout', name: '大谷', media: { url: picUrl, kind: 'image' } })
  ok(sh.stored[0]?.media_url === picUrl && sh.stored[0]?.media_kind === 'image' && sh.calls[0].prompt.includes('Cheer for 大谷 by name') && sh.calls[0].prompt.includes('「大谷 加油！」'), "roomCheer: an admin's 加油 posts its picture, and she cheers the name")
  const old = cheerRoom({ media: false })
  await old.mod.roomCheer(K2, { trigger: 'admin', action: 'selfie', media: { url: picUrl, kind: 'image' } })
  ok(old.stored.length === 1 && !old.stored[0].media_url, 'roomCheer: before 136, an admin\'s ask gets words only')
  // The commentators read her as the cheerleader.
  const t = room({ rows: [{ kind: 'ai', author_name: '晴晴', model_name: '晴晴', content: '全壘打！！' }] })
  await t.speak(K, 'lull')
  ok(t.calls[0]?.prompt.includes("晴晴 (the room's AI cheerleader): 全壘打！！"), 'commentators: her words come under her name, as the cheerleader')
}

// ── app/api/xsports/room/route.ts POST with every import mocked ───────────
async function post(content: string, o: { confirmed?: boolean; confirm?: boolean; displayName?: string | null; signin?: string; lang?: string } = {}) {
  const spoke: string[] = [], asked: any[] = [], waits: Promise<unknown>[] = [], confirmedNow: string[] = [], cheered: any[] = []
  ;(globalThis as any).__cheered = cheered
  const route = load('app/api/xsports/room/route.ts', {
    'next/server': { after: (p: Promise<unknown>) => { waits.push(p) } },
    '@/lib/supabase-server': { createSupabaseServer: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'fixture-user', user_metadata: {} } } }) } }) },
    '@/lib/admin': { isAdminEmail: (e?: string) => e === 'admin@fixture.test' },
    '@/lib/moderation': { moderate: async () => 'ok' },
    '@/lib/user-face': { userName: () => o.signin ?? 'Fixture', userPhoto: () => null },
    '@/lib/profile-handle': { ensureHandle: async () => ({ handle: 'aming', nextChangeAt: null }) },
    '@/lib/xsports-store': { xsportsAdmin: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: o.displayName === null ? null : { display_name: o.displayName ?? '阿明', avatar_url: null } }) }) }) }) }) },
    '@/lib/xsports-room': {
      addRoomMessage: async (_k: unknown, m: any) => ({ id: 7, ...m }), confirmName: async (id: string) => { confirmedNow.push(id) }, member: async () => ({ confirmed: o.confirmed ?? true, mutedUntil: null }),
      ownIds: async () => [], recentMessages: async () => [], roomKeyOf: (league: string, game: unknown, lang: string) => ({ league, game: String(game), lang }),
      roomMissing: () => false, secondsSinceLast: async () => null, MESSAGE_MAX: 500,
    },
    '@/lib/xsports-ais': ais,
    '@/lib/xsports-cheer': { cheerFace: async () => ({ handle: '晴晴', name: '晴晴', avatar: 'https://x/a.jpg' }), roomCheer: async (_k: unknown, cue: any) => { (globalThis as any).__cheered?.push(cue) } },
    '@/lib/xsports-room-ai': {
      roomPair: async () => ({ pair: ais.CHEAP_AIS, capped: true }),
      roomSpeak: async (_k: unknown, trigger: string, opts: any) => {
        const h = opts.who?.handle ?? 'any'
        spoke.push(`start:${h}`); asked.push({ trigger, ...opts })
        await wait(10)
        spoke.push(`end:${h}`)
      },
    },
  })
  const res: Response = await route.POST(new Request('http://fixture.invalid/api/xsports/room', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ league: 'mlb', game: 849811, lang: o.lang ?? 'zh-Hant', content, confirmName: o.confirm }),
  }))
  const body = await res.clone().json().catch(() => null)
  await Promise.all(waits)
  return { status: res.status, body, spoke, asked, confirmedNow, cheered }
}

async function roomRoute() {
  const both = await post('@Luna @Qwen 誰會贏？')
  ok(both.status === 200 && both.spoke.join(',') === 'start:Luna,end:Luna,start:Qwen,end:Qwen', 'route: a fan naming both gets both, in order, one after the other')
  ok(both.asked.every(a => a.trigger === 'user' && a.wait === true && a.asker?.id === 7 && a.asker?.name === '阿明' && a.asker?.text === '@Luna @Qwen 誰會贏？'), 'route: each is told who asked, what, and which message to reply to')
  const any = await post('@AI 誰會贏？')
  ok(any.spoke.join(',') === 'start:any,end:any' && any.asked[0].who === undefined, 'route: @AI asks whichever is up')
  const none = await post('好球！')
  ok(none.status === 200 && none.spoke.length === 0, 'route: a message asking nobody starts no commentator')

  // The first message: the name is shown and confirmed once; it may be the
  // sign-in name (owner, Oct 14: "the display name can be the same as sign in
  // name"; a rule that it differ reopened the panel forever).
  const ask = await post('嗨', { confirmed: false, displayName: 'Wei Chen', signin: 'Wei Chen' })
  ok(ask.status === 409 && ask.body?.code === 'name_unconfirmed' && ask.body?.name === 'Wei Chen' && ask.confirmedNow.length === 0, 'route: an unconfirmed name is asked for, filled in with the current one even when it is the sign-in name')
  const same = await post('嗨', { confirmed: false, confirm: true, displayName: 'Wei Chen', signin: 'Wei Chen' })
  ok(same.status === 200 && same.confirmedNow.length === 1, 'route: confirming the sign-in name as it is lets the message in')
  const fresh = await post('嗨', { confirmed: false, displayName: null, signin: 'Wei Chen' })
  ok(fresh.status === 409 && fresh.body?.name === 'Wei Chen', 'route: with no saved name the panel starts from the sign-in name')
  const cheerAsk = await post('@晴晴 今天幫道奇加油！')
  ok(cheerAsk.status === 200 && cheerAsk.cheered[0]?.trigger === 'user' && cheerAsk.cheered[0]?.asker?.id === 7 && cheerAsk.spoke.length === 0, 'route: @晴晴 in an MLB 繁中 room: she answers it as a reply; no commentator is asked')
  const cheerEn = await post('@晴晴 hi', { lang: 'en' })
  ok(cheerEn.status === 200 && cheerEn.cheered.length === 0, 'route: @晴晴 in a room she is not in asks nobody')
  const done = await post('嗨', { confirmed: true })
  ok(done.status === 200 && done.confirmedNow.length === 0, 'route: a confirmed name is not asked again')
}

async function fresh() {
  const K2 = { league: 'mlb', game: '849818', lang: 'zh-Hant' }
  const lad = (status: string, events: any[]) => ({ ...game(status, events), away: { name: 'Brewers', abbr: 'MIL', runs: 0 }, home: { name: 'Dodgers', abbr: 'LAD', runs: 0 } })
  const f0 = freshRoom()
  const id = f0.mod.newFreshId()
  ok(f0.mod.isFreshId(id) && !f0.mod.isFreshId(UUID) && !f0.mod.isFreshId('../' + id) && !f0.mod.isFreshId(id + '.jpg') && !f0.mod.isFreshId(42), 'isFreshId: when it began, then a uuid; nothing else')
  ok(f0.mod.lightNow(new Date('2026-10-16T23:00:00Z')).includes('night-game') && f0.mod.lightNow(new Date('2026-10-16T17:00:00Z')).includes('afternoon'), 'lightNow: night lights after 6 pm in the US East, sun in the afternoon')

  const sf = freshRoom()
  await sf.mod.makeFresh(K2, id, 'selfie', '', () => 0)
  ok(sf.images.length === 1 && sf.images[0].model === 'gpt-image-2' && sf.images[0].size === '1024x1536' && sf.images[0].ports.join() === 'reference_image' && sf.fetched[0]?.endsWith('/cheer/selfie.jpg') && sf.images[0].prompt.includes('selfie') && sf.images[0].prompt.includes('"XD" emblem'), 'makeFresh: a selfie is GPT Image 2 with her own photo as the face reference, her red look')
  ok(sf.uploads.map(u => u.path.split('/').pop() + ':' + u.type).join() === id + '.jpg:image/jpeg' && sf.videos.length === 0 && sf.spent.join() === '0.053', "makeFresh: it goes to her folder's fresh/ as <id>.jpg; counted toward the day")
  const sb = freshRoom({ g: lad('live', [play(1)]) })
  await sb.mod.makeFresh(K2, id, 'selfie', '', () => 0)
  ok(sb.fetched[0]?.endsWith('/cheer/blue-selfie.jpg') && sb.images[0].prompt.includes('royal-blue') && sb.images[0].prompt.includes('Absolutely no logos'), 'makeFresh: in a Dodgers game, Dodger blue with no marks')
  const dn = freshRoom()
  await dn.mod.makeFresh(K2, id, 'dance', '', () => 0)
  ok(dn.uploads.map(u => u.path.split('/').pop()).join() === `${id}-frame.jpg,${id}.mp4` && dn.uploads[1].type === 'video/mp4', 'makeFresh: a dance is a picture (kept as its first frame), then <id>.mp4')
  ok(dn.videos[0]?.model === 'happyhorse-1.1-i2v' && dn.videos[0].size === '720x1080' && dn.videos[0].seconds === 5 && dn.videos[0].ports.join() === 'first_frame' && dn.videos[0].url === FRESH + id + '-frame.jpg' && dn.videos[0].watermark === false && dn.videos[0].prompt.includes('pom-poms'), 'makeFresh: the clip is HappyHorse 1.1 from that frame by its link, 5 s, watermark off')
  ok(dn.ran[0]?.includes('-an') && dn.ran[0].includes('scale=720:-2') && dn.ran[0].includes('+faststart') && dn.spent.join() === '0.053,0.9', 'makeFresh: re-encoded small for phones; the picture and the clip both counted')
  const ch = freshRoom()
  await ch.mod.makeFresh(K2, id, 'cheer', '', () => 0)
  ok(ch.fetched[0]?.endsWith('/cheer/megaphone.jpg') && ch.images[0].prompt.includes('megaphone') && ch.videos[0]?.prompt.includes('chant') && ch.uploads.at(-1)?.path.endsWith(id + '.mp4'), 'makeFresh: a cheer clip leads a chant')
  const so = freshRoom()
  await so.mod.makeFresh(K2, id, 'shout', '大谷', () => 0)
  ok(so.images[0]?.prompt.includes('comic') && so.images[0].prompt.includes('「大谷 加油！」') && so.fetched[0]?.endsWith('/cheer/cheer.jpg') && so.uploads.map(u => u.path.split('/').pop()).join() === id + '.jpg' && so.videos.length === 0, 'makeFresh: a 加油 is a comic picture with the name in the bubble')
  const bad = freshRoom({ videoFails: true })
  let threw = false
  try { await bad.mod.makeFresh(K2, id, 'dance', '', () => 0) } catch { threw = true }
  ok(!threw && bad.uploads.map(u => u.path.split('/').pop() + ':' + u.type).join() === `${id}-frame.jpg:image/jpeg,${id}.failed:text/plain`, 'makeFresh: a clip that fails leaves <id>.failed (and never throws)')
  const off = freshRoom({ off: 'gpt-image-2' })
  await off.mod.makeFresh(K2, id, 'selfie', '', () => 0)
  ok(off.images.length === 0 && off.uploads.map(u => u.path.split('/').pop()).join() === id + '.failed', 'makeFresh: no drawing model, nothing drawn; it says failed')

  const st = async (listed: string[], jid = id, now?: number) => freshRoom({ listed }).mod.freshStatus(jid, now)
  const vid = await st([id + '-frame.jpg', id + '.mp4'])
  const pic = await st([id + '.jpg'])
  ok(vid.status === 'done' && vid.kind === 'video' && vid.url === FRESH + id + '.mp4' && pic.status === 'done' && pic.kind === 'image' && pic.url === FRESH + id + '.jpg', 'freshStatus: done, with its link and kind')
  ok((await st([id + '-frame.jpg'])).status === 'working' && (await st([])).status === 'working' && (await st([id + '.failed'])).status === 'failed', 'freshStatus: a first frame alone is still working; .failed is failed')
  ok((await st([], id, Date.now() + 15 * 60_000)).status === 'failed', 'freshStatus: a job past 14 minutes has failed')
}

// ── app/api/xsports/cheer: an admin's asks of 晴晴 (Oct 16) ───────────────
const FID = 'mg1abcde-' + UUID
async function cheerCall(method: 'GET' | 'POST', body: Record<string, unknown>, o: { admin?: boolean; verdict?: string; face?: boolean; status?: any } = {}) {
  const waits: Promise<unknown>[] = [], cues: any[] = [], made: any[] = []
  const route = load('app/api/xsports/cheer/route.ts', {
    'next/server': { after: (p: Promise<unknown>) => { waits.push(p) } },
    '@/lib/admin': { getAdminUser: async () => (o.admin === false ? null : { id: 'a1', email: 'admin@fixture.test' }) },
    '@/lib/moderation': { moderate: async () => o.verdict ?? 'ok' },
    '@/lib/xsports-room': { roomKeyOf: (league: string, game: unknown, lang: string) => (league && game && lang ? { league, game: String(game), lang } : null) },
    '@/lib/xsports-ais': ais,
    '@/lib/xsports-cheer-media': cheerMedia,
    '@/lib/xsports-cheer': {
      cheerFace: async () => (o.face === false ? null : { handle: '晴晴', name: '晴晴', avatar: 'https://x/a.jpg' }),
      roomCheer: async (_k: unknown, cue: any) => { cues.push(cue) },
    },
    '@/lib/xsports-cheer-fresh': {
      isFreshId: (s: unknown) => s === FID,
      newFreshId: () => FID,
      makeFresh: async (k: any, id: string, action: string, name?: string) => { made.push({ k, id, action, name }) },
      freshStatus: async () => o.status ?? { status: 'working' },
    },
  })
  const res: Response = method === 'GET'
    ? await route.GET(new Request(`http://fixture.invalid/api/xsports/cheer?draft=${encodeURIComponent(String(body.draft ?? ''))}`))
    : await route.POST(new Request('http://fixture.invalid/api/xsports/cheer', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ league: 'mlb', game: 849811, lang: 'zh-Hant', ...body }),
    }))
  await Promise.all(waits)
  return { status: res.status, body: await res.json().catch(() => null), cues, made }
}

async function cheerRoute() {
  const fan = await cheerCall('POST', { action: 'dance' }, { admin: false })
  const fanGet = await cheerCall('GET', { draft: FID }, { admin: false })
  ok(fan.status === 403 && fanGet.status === 403 && fan.made.length + fan.cues.length === 0, 'cheer route: anyone but an admin gets 403 and nothing is made')
  const dance = await cheerCall('POST', { action: 'dance' })
  ok(dance.status === 200 && dance.body?.draft === FID && dance.made[0]?.action === 'dance' && dance.made[0].id === FID && dance.made[0].k?.game === '849811' && dance.cues.length === 0, "cheer route: an admin's dance starts one fresh clip and hands back its draft; nothing posted")
  const en = await cheerCall('POST', { action: 'selfie', lang: 'en' })
  const priv = await cheerCall('POST', { action: 'selfie' }, { face: false })
  const odd = await cheerCall('POST', { action: 'sing' })
  ok(en.status === 409 && priv.status === 409 && odd.status === 400 && en.made.length + priv.made.length + odd.made.length === 0, 'cheer route: 409 where she is not, or while she is private; an unknown action 400')
  const shout = await cheerCall('POST', { action: 'shout', name: ' 大谷 ' })
  ok(shout.status === 200 && shout.made[0]?.name === '大谷', 'cheer route: a 加油 is made with the cleaned name')
  const noname = await cheerCall('POST', { action: 'shout', name: '   ' })
  const refused = await cheerCall('POST', { action: 'shout', name: '壞字' }, { verdict: 'refused' })
  const nocheck = await cheerCall('POST', { action: 'shout', name: '大谷' }, { verdict: 'unavailable' })
  ok(noname.status === 400 && refused.status === 422 && refused.body?.code === 'name_refused' && nocheck.status === 503 && noname.made.length + refused.made.length + nocheck.made.length === 0, 'cheer route: no name 400; a name moderation refuses 422; a check that cannot run refuses (503); nothing made')
  const look = await cheerCall('GET', { draft: FID }, { status: { status: 'done', url: FRESH + FID + '.mp4', kind: 'video' } })
  const badGet = await cheerCall('GET', { draft: 'x' })
  ok(look.status === 200 && look.body?.status === 'done' && look.body.url === FRESH + FID + '.mp4' && badGet.status === 400, "cheer route: GET says where a draft is; a draft that is not one is 400")
  const post = await cheerCall('POST', { action: 'dance', draft: FID }, { status: { status: 'done', url: FRESH + FID + '.mp4', kind: 'video' } })
  ok(post.status === 200 && post.cues[0]?.trigger === 'admin' && post.cues[0].action === 'dance' && post.cues[0].media?.url === FRESH + FID + '.mp4' && post.cues[0].media.kind === 'video' && post.made.length === 0, 'cheer route: posting a finished draft asks her with it')
  const early = await cheerCall('POST', { action: 'dance', draft: FID })
  const forged = await cheerCall('POST', { action: 'dance', draft: 'https://evil.test/x.mp4' })
  ok(early.status === 409 && early.body?.code === 'not_ready' && forged.status === 400 && early.cues.length + forged.cues.length === 0, 'cheer route: a draft not done yet is 409; anything that is not a draft id 400')
}

// ── The room's GET: a page at a time, back to the first (Oct 14) ──────────
async function get(query: string, stored: number, user: { id: string; email: string } | null = null) {
  const calls: { limit: number; before?: number }[] = []
  const route = load('app/api/xsports/room/route.ts', {
    'next/server': { after: () => {} },
    '@/lib/supabase-server': { createSupabaseServer: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }) },
    '@/lib/admin': { isAdminEmail: (e?: string) => e === 'admin@fixture.test' },
    '@/lib/moderation': { moderate: async () => 'ok' },
    '@/lib/user-face': { userName: () => 'Fixture', userPhoto: () => null },
    '@/lib/profile-handle': { ensureHandle: async () => ({ handle: 'aming', nextChangeAt: null }) },
    '@/lib/xsports-store': { xsportsAdmin: () => ({}) },
    '@/lib/xsports-room': {
      // Messages 1..stored; the real one's order: oldest first.
      recentMessages: async (_k: unknown, limit: number, before?: number) => {
        calls.push({ limit, before })
        return Array.from({ length: stored }, (_, i) => i + 1).filter(id => !before || id < before).slice(-limit).map(id => ({ id, kind: 'human' }))
      },
      ownIds: async () => [], roomKeyOf: (league: string, game: unknown, lang: string) => ({ league, game: String(game), lang }), roomMissing: () => false,
      addRoomMessage: async () => null, confirmName: async () => {}, member: async () => null, secondsSinceLast: async () => null, MESSAGE_MAX: 500,
    },
    '@/lib/xsports-ais': ais,
    '@/lib/xsports-cheer': { cheerFace: async () => ({ handle: '晴晴', name: '晴晴', avatar: 'https://x/a.jpg' }), roomCheer: async (_k: unknown, cue: any) => { (globalThis as any).__cheered?.push(cue) } },
    '@/lib/xsports-room-ai': { roomSpeak: async () => {}, roomPair: async () => ({ pair: ais.CHEAP_AIS, capped: true }) },
  })
  const res: Response = await route.GET(new Request(`http://fixture.invalid/api/xsports/room?league=mlb&game=849811&lang=zh-Hant${query}`))
  return { status: res.status, body: await res.json(), calls }
}

async function roomPages() {
  const newest = await get('', 200)
  ok(newest.status === 200 && newest.body.messages.length === 80 && newest.body.messages[0].id === 121 && newest.body.more === true && newest.calls[0].before === undefined, 'GET: the newest 80, oldest first, and more before them')
  ok(newest.body.ais?.map((a: any) => a.handle).join() === 'Luna,Qwen', "GET: the newest page names the room's two commentators (the @ list)")
  ok(newest.body.cheer?.handle === '晴晴' && newest.body.cheer?.avatar === 'https://x/a.jpg', "GET: an MLB 繁中 room names 晴晴 with her photo")
  const asAdmin = await get('', 200, { id: 'a1', email: 'admin@fixture.test' })
  const asFan = await get('', 200, { id: 'f1', email: 'fan@fixture.test' })
  ok(asAdmin.body.admin === true && asFan.body.admin === false && newest.body.admin === false, 'GET: says whether the reader is an admin (her card then offers her actions)')
  const back = await get('&before=41', 200)
  ok(back.body.messages.length === 40 && back.body.messages[0].id === 1 && back.body.more === false && back.calls[0].before === 41 && back.body.ais === undefined, 'GET: ?before= reads the page older than that id; the last one says there is no more')
  const bad = await get('&before=1%3Bdrop', 200)
  ok(bad.calls[0].before === undefined && bad.body.messages.length === 80, 'GET: a before that is not an id is ignored')
}

;(async () => {
  asks()
  draws()
  await ledger()
  await commentators()
  await topPair()
  await cheerleader()
  await fresh()
  await roomRoute()
  await cheerRoute()
  await roomPages()
  console.log(fails ? `${fails} FAILED` : 'all passed')
  process.exitCode = fails ? 1 : 0
})().catch(e => { console.error(e); process.exitCode = 1 })
