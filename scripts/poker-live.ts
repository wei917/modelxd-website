// scripts/poker-live.ts — real models at a real hold'em table, through the
// route's own code (lib/poker-table.ts handlePoker), with an in-memory store
// instead of xtalk_sessions and no wallet: nothing is written to the
// database and nobody is charged, but every model call is real and costs
// the house its list price. Two tables:
//
//   A  AI only, 4 seats (GPT-6 Luna and Qwen 3.8 Flash, each twice, at
//      different thinking levels), a few hands: the spectator sees all.
//   B  a person (this script, always check/call) and 2 models: every view
//      the person gets is checked for a hole card or a reason they may not
//      see yet.
//
//   npx tsx scripts/poker-live.ts [handsA] [handsB]     stops at $2 of spend

process.loadEnvFile('.env.local')
import { getModelById } from '../lib/models'
import { handlePoker, type PokerRow, type PokerDeps } from '../lib/poker-table'
import { unseal } from '../lib/poker-seal'
import { snapshot, currentHand, type PokerGame } from '../lib/poker-engine'

const LUNA = '8837c35c-90fd-4975-a3fa-05e64c268ce1'   // GPT-6 Luna
const QWEN = '488d4156-c49e-4eeb-afc7-93760b7bb4f1'   // Qwen 3.8 Flash
const CAP_USD = 2
const handsA = Number(process.argv[2] ?? 5)
const handsB = Number(process.argv[3] ?? 3)

let spent = 0, fails = 0
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails++ }
const calls: any[] = []

function deps(): PokerDeps & { rows: Map<string, PokerRow> } {
  const rows = new Map<string, PokerRow>()
  let n = 0
  return {
    rows,
    userId: '',   // no account: provider_calls logs these calls with no user
    store: {
      async insert(row) { const id = `live-${++n}`; rows.set(id, { ...row, id, updated_at: new Date().toISOString() } as PokerRow); return id },
      async load(id) { const r = rows.get(id); return r ? JSON.parse(JSON.stringify(r)) : null },
      async save(id, version, patch) {
        const r = rows.get(id)
        if (!r || r.day !== version) return false
        rows.set(id, { ...r, ...patch, updated_at: new Date().toISOString() } as PokerRow)
        return true
      },
    },
    getModel: id => getModelById(id),
    async bill(usd) { spent += usd },
    async canSpend() { return spent < CAP_USD },
    onCall(c) { calls.push(c) },
  }
}

const name = (v: any, s: number) => v.seats[s]?.name ?? `Seat ${s + 1}`

function printHand(v: any) {
  const h = v.hand
  if (!h) return
  console.log(`\n── Hand ${h.n} · button ${name(v, h.button)} · board ${h.board.join(' ') || '-'}`)
  for (const l of h.log) {
    if (l.t === 'post') console.log(`   ${name(v, l.seat)} posts ${l.blind} ${l.amount}`)
    else if (l.t === 'board') console.log(`   ── ${l.street}: ${l.board.join(' ')}`)
    else console.log(`   ${name(v, l.seat)}: ${l.act}${l.act === 'call' ? ' ' + l.put : l.to && l.act !== 'fold' && l.act !== 'check' ? ' to ' + l.to : ''}`
      + `${l.retried ? ' [retried]' : ''}${l.auto ? ' [AUTO]' : ''}${l.ms ? ` ${(l.ms / 1000).toFixed(1)}s` : ''}`
      + `${l.say ? `  💬 "${l.say}"` : ''}${l.why ? `\n        why: ${l.why}` : ''}`)
  }
  if (h.result) {
    const r = h.result
    console.log(`   result: ${Object.entries(r.won).map(([s, w]) => `${name(v, +s)} +${w}`).join(', ')}`
      + `${r.showdown ? ' · shown ' + Object.entries(r.shown).map(([s, c]: any) => `${name(v, +s)} ${c.join(' ')} (${v.handNames[r.rank[s]]})`).join('; ') : ''}`)
  }
}

async function drive(d: ReturnType<typeof deps>, v: any, human?: (v: any) => any, check?: (v: any) => void) {
  let lastHand = 0
  for (let i = 0; i < 400 && v.next !== 'over'; i++) {
    if (spent >= CAP_USD) { console.log(`\nSTOP: spend reached $${spent.toFixed(4)}`); break }
    const prevN = v.hand?.n
    const r = v.next === 'human'
      ? await handlePoker({ action: 'act', id: v.id, ...human!(v) }, d)
      : await handlePoker({ action: 'step', id: v.id }, d)
    if (r.status !== 200) { console.log('error', r.status, r.body); fails++; break }
    if (prevN && r.body.hand?.n !== prevN && v.hand) { /* new hand dealt */ }
    if (v.hand && v.hand.result && lastHand !== v.hand.n) { printHand(v); lastHand = v.hand.n }
    v = r.body
    check?.(v)
  }
  if (v.hand && lastHand !== v.hand.n) printHand(v)
  return v
}

;(async () => {
  // ── Table A: AI only ─────────────────────────────────────────────────
  const dA = deps()
  const c = await handlePoker({ action: 'create', hands: handsA, lang: 'zh-Hant', seats: [
    { modelId: LUNA, thinking: null }, { modelId: QWEN, thinking: null },
    { modelId: LUNA, thinking: 'low' }, { modelId: QWEN, thinking: 'thinking_true' },
  ] }, dA)
  ok(c.status === 200, `table A created (${c.status})`)
  let v = c.body
  ok(v.spectator === true && v.hand.seats.every((s: any) => s.cards?.length === 2), 'table A: AI only, the spectator sees every hand')
  const t0 = Date.now()
  v = await drive(dA, v)
  console.log(`\nTable A: ${v.handsPlayed} hands in ${((Date.now() - t0) / 1000).toFixed(0)} s, over=${v.next === 'over'}, winner ${v.winner}`)
  for (const s of v.seats) console.log(`   ${s.name}${s.thinking ? ` (${s.thinking})` : ''}: ${s.chips} chips · asked ${s.stats.asked}, retried ${s.stats.retried}, auto ${s.stats.auto}, $${s.stats.costUsd.toFixed(5)}, ${(s.stats.ms / Math.max(1, s.stats.asked) / 1000).toFixed(1)} s/decision`)
  ok(v.seats.reduce((a: number, s: any) => a + s.chips, 0) === 4000, 'table A: 4,000 chips at the end')
  ok(v.next === 'over' || spent >= CAP_USD, 'table A: the game ran to its end')
  const g: PokerGame = unseal(dA.rows.get(v.id)!.pending.sealed!)
  ok(g.hands.length === v.handsPlayed, 'table A: sealed state round-trips')

  // ── Table B: a person and two models ──────────────────────────────────
  const dB = deps()
  const cb = await handlePoker({ action: 'create', hands: handsB, lang: 'en', seats: [
    { human: true }, { modelId: LUNA, thinking: 'low' }, { modelId: QWEN, thinking: 'thinking_false' },
  ] }, dB)
  ok(cb.status === 200, `table B created (${cb.status})`)
  let leaks = 0, whyEarly = 0, views = 0, legalOthers = 0
  const check = (view: any) => {
    views++
    const row = dB.rows.get(view.id)!
    const gs: PokerGame = unseal(row.pending.sealed!)
    const h = currentHand(gs)!
    const snap = snapshot(gs)!
    const out = JSON.stringify(view)
    if (view.spectator) return
    snap.holes.forEach((cs, seat) => {
      if (!cs || seat === 0) return
      const shownNow = h.result?.shown[seat]
      for (const card of cs) if (!shownNow && !snap.board.includes(card) && out.includes(`"${card}"`)) leaks++
    })
    if (!h.result && view.hand.log.some((l: any) => l.t === 'act' && l.why)) whyEarly++
    if (view.hand.legal && view.hand.legal.seat !== 0) legalOthers++
  }
  check(cb.body)
  const human = (view: any) => ({ move: view.hand.legal?.canCheck ? 'check' : 'call' })
  const vb = await drive(dB, cb.body, human, check)
  console.log(`\nTable B: ${vb.handsPlayed} hands, ${views} views checked`)
  ok(leaks === 0, `table B: no unseen hole card in any of the person's ${views} views (${leaks})`)
  ok(whyEarly === 0, 'table B: no model reason shown to the person before the hand is over')
  ok(legalOthers === 0, "table B: the person never sees another seat's legal range")
  const rowB = dB.rows.get(vb.id)!
  ok(!JSON.stringify(rowB).match(/"deck"|"moves"/), 'table B: the stored row carries no deck or moves in the clear')

  // ── Calls ────────────────────────────────────────────────────────────
  const by = new Map<string, any[]>()
  for (const c of calls) by.set(c.model, [...(by.get(c.model) ?? []), c])
  console.log('\nModel calls:')
  for (const [m, cs] of by) {
    const avg = (f: (c: any) => number) => (cs.reduce((a, c) => a + f(c), 0) / cs.length)
    console.log(`   ${m}: ${cs.length} calls, avg in ${avg(c => c.inTokens).toFixed(0)} / out ${avg(c => c.outTokens).toFixed(0)} tokens, $${avg(c => c.cost).toFixed(6)}/call, ${(avg(c => c.ms) / 1000).toFixed(1)} s, unusable ${cs.filter(c => !c.usable).length}, timeouts ${cs.filter(c => c.timedOut).length}`)
  }
  console.log(`\nTotal model spend: $${spent.toFixed(4)}`)
  console.log(fails ? `\n${fails} FAILED` : '\nall passed')
  process.exit(fails ? 1 : 0)
})()
