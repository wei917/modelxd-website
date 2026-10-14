// scripts/xsports-room-check.ts — checks the two AI commentators of X體育's
// public chat (Oct 14: Qwen 3.8 Flash joined GPT-6 Luna) without a network,
// a database or a provider:
//   - lib/xsports-ais askedAis(): who a message asks (@AI, @Luna, @Qwen); a
//     fan's @ID that only starts like one never counts
//   - lib/xsports-room-ai roomSpeak(), transpiled and run with every import
//     mocked (the harness of scripts/xsports-turn-check.ts): they take
//     turns; a named one answers, and only it; @AI and ticks fall to the
//     other when one fails; one asking the other gets one answer, never a
//     question back; each thinks at its quickest; what each one reads
//   - app/api/xsports/room/route.ts POST: each commentator named answers, in
//     order, one after the other
//
//   npx tsx scripts/xsports-room-check.ts       exit code 1 on any failure

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import { askedAis } from '../lib/xsports-ais'

let fails = 0
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails++ }
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

function asks() {
  const who = (t: string) => askedAis(t).map(w => (w === 'any' ? 'any' : w.handle)).join(',')
  ok(who('@Qwen 誰會贏？') === 'Qwen', 'askedAis: @Qwen asks Qwen')
  ok(who('@luna @QWEN 你們覺得呢') === 'Luna,Qwen' && who('@Qwen 先說，@Luna 再說') === 'Qwen,Luna', 'askedAis: both, in the order named, any case')
  ok(who('@AI 誰會贏') === 'any' && who('＠ＡＩ 誰會贏') === 'any' && who('@ai球友 你好') === 'any', 'askedAis: @AI (full-width too) asks whichever is up')
  ok(who('@AI @Qwen 誰會贏') === 'Qwen', 'askedAis: a commentator named outranks @AI')
  ok(who('@aiko 你好') === '' && who('@lunatic 你好') === '' && who('@qwen_fan 你好') === '' && who('@luna.x 你好') === '' && who('寫信到 a@ai.com') === '', "askedAis: a fan's @ID that only starts like one asks nobody")
  ok(who('Luna 跟 Qwen 都不錯') === '' && who('好球！') === '', 'askedAis: a name without @ asks nobody')
}

// ── lib/xsports-room-ai.ts with every import mocked ──────────────────────
const root = join(__dirname, '..')
const warned: string[] = []
const quiet = { ...console, warn: (...a: unknown[]) => { warned.push(a.map(String).join(' ')) } }
function load(rel: string, mocks: Record<string, unknown>) {
  const js = ts.transpileModule(readFileSync(join(root, rel), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const module = { exports: {} as any }
  vm.runInNewContext(js, {
    module, exports: module.exports, require: (id: string) => { if (id in mocks) return mocks[id]; throw Error('Unmocked import: ' + id) },
    console: quiet, Request, Response, URL, clearTimeout,
    // The room's lock waits 1.5 s between tries; not here.
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, Math.min(ms, 5)),
  }, { filename: rel })
  return module.exports
}
const ais = load('lib/xsports-ais.ts', {})
const [LUNA, QWEN] = ais.HOUSE_AIS
const K = { league: 'mlb', game: '849811', lang: 'zh-Hant' }

type Reply = string | { fail: string } | { silent: true }
function room(o: { plan?: Record<string, Reply | Reply[]>; rows?: any[]; missing?: string[]; disabled?: string[]; busy?: number } = {}) {
  const calls: { model: string; thinking: string | null; system: string; prompt: string; search: boolean }[] = []
  const stored: any[] = (o.rows ?? []).map((r, i) => ({ id: i + 1, kind: 'human', author_name: 'Fan', author_handle: null, author_avatar: null, model_name: null, reply_to: null, created_at: '', ...r }))
  const released: any[] = []
  let id = 100, busy = o.busy ?? 0
  const levels: Record<string, string[]> = { 'gpt-6-luna': ['none', 'low', 'medium', 'high', 'xhigh', 'max'], 'qwen3.8-flash': ['thinking_true', 'thinking_false'] }
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
        cb.onDone({ cost: 0.0001 })
      },
    },
    './models': {
      getModelByProviderName: async (provider: string, name: string) => (o.missing?.includes(name) ? null : {
        provider, model_name: name, display_name: name === LUNA.model_name ? LUNA.name : QWEN.name, enabled: !o.disabled?.includes(name),
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
    './provider-errors': { sanitizeProviderError: (s: string) => s },
  })
  const ai = () => stored.filter(m => m.kind === 'ai')
  return { speak: mod.roomSpeak as (k: typeof K, t: string, opts?: any) => Promise<void>, transcript: mod.transcript, nextUp: mod.nextUp, calls, stored, released, ai }
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
  const up = (names: (string | null)[]) => r.nextUp(names.map((n, i) => ({ id: i, kind: n ? 'ai' : 'human', model_name: n, content: '', author_name: '' }))).handle
  ok(up([]) === 'Luna' && up(['GPT-6 Luna']) === 'Qwen' && up(['GPT-6 Luna', null, 'Qwen 3.8 Flash', null]) === 'Luna' && up(['an old model']) === 'Luna', 'nextUp: turns by who spoke last; fans in between do not count')
}

// ── app/api/xsports/room/route.ts POST with every import mocked ───────────
async function post(content: string) {
  const spoke: string[] = [], asked: any[] = [], waits: Promise<unknown>[] = []
  const route = load('app/api/xsports/room/route.ts', {
    'next/server': { after: (p: Promise<unknown>) => { waits.push(p) } },
    '@/lib/supabase-server': { createSupabaseServer: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'fixture-user', user_metadata: {} } } }) } }) },
    '@/lib/moderation': { moderate: async () => 'ok' },
    '@/lib/user-face': { userName: () => 'Fixture', userPhoto: () => null },
    '@/lib/profile-handle': { ensureHandle: async () => ({ handle: 'aming', nextChangeAt: null }) },
    '@/lib/xsports-store': { xsportsAdmin: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { display_name: '阿明', avatar_url: null } }) }) }) }) }) },
    '@/lib/xsports-room': {
      addRoomMessage: async (_k: unknown, m: any) => ({ id: 7, ...m }), confirmName: async () => {}, member: async () => ({ confirmed: true, mutedUntil: null }),
      ownIds: async () => [], recentMessages: async () => [], roomKeyOf: (league: string, game: unknown, lang: string) => ({ league, game: String(game), lang }),
      roomMissing: () => false, secondsSinceLast: async () => null, MESSAGE_MAX: 500,
    },
    '@/lib/xsports-ais': ais,
    '@/lib/xsports-room-ai': {
      roomSpeak: async (_k: unknown, trigger: string, opts: any) => {
        const h = opts.who?.handle ?? 'any'
        spoke.push(`start:${h}`); asked.push({ trigger, ...opts })
        await wait(10)
        spoke.push(`end:${h}`)
      },
    },
  })
  const res: Response = await route.POST(new Request('http://fixture.invalid/api/xsports/room', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ league: 'mlb', game: 849811, lang: 'zh-Hant', content }),
  }))
  await Promise.all(waits)
  return { status: res.status, spoke, asked }
}

async function roomRoute() {
  const both = await post('@Luna @Qwen 誰會贏？')
  ok(both.status === 200 && both.spoke.join(',') === 'start:Luna,end:Luna,start:Qwen,end:Qwen', 'route: a fan naming both gets both, in order, one after the other')
  ok(both.asked.every(a => a.trigger === 'user' && a.wait === true && a.asker?.id === 7 && a.asker?.name === '阿明' && a.asker?.text === '@Luna @Qwen 誰會贏？'), 'route: each is told who asked, what, and which message to reply to')
  const any = await post('@AI 誰會贏？')
  ok(any.spoke.join(',') === 'start:any,end:any' && any.asked[0].who === undefined, 'route: @AI asks whichever is up')
  const none = await post('好球！')
  ok(none.status === 200 && none.spoke.length === 0, 'route: a message asking nobody starts no commentator')
}

;(async () => {
  asks()
  await commentators()
  await roomRoute()
  console.log(fails ? `${fails} FAILED` : 'all passed')
  process.exitCode = fails ? 1 : 0
})().catch(e => { console.error(e); process.exitCode = 1 })
