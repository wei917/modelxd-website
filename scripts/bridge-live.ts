// scripts/bridge-live.ts — real models at a real bridge table, through the
// route's own code (lib/bridge-table.ts handleBridge), with an in-memory
// store instead of xtalk_sessions and no wallet: nothing is written to the
// database and nobody is charged, but every model call is real and costs the
// house its list price. Two tables, one board each by default:
//
//   A  AI only: GPT-6 Luna North and South, Qwen 3.8 Flash East and West.
//   B  a person at South (this script: passes, then plays its lowest legal
//      card) with three models: every view the person gets is checked for a
//      hand or a reason they may not see yet.
//
//   npx tsx scripts/bridge-live.ts [A|B|AB]   stops at $1.50 of spend

process.loadEnvFile('.env.local')
import { getModelById } from '../lib/models'
import { handleBridge, type BridgeRow, type BridgeDeps } from '../lib/bridge-table'
import { callText, cardText, partner, type Seat } from '../lib/bridge-engine'

const LUNA = '8837c35c-90fd-4975-a3fa-05e64c268ce1'   // GPT-6 Luna
const QWEN = '488d4156-c49e-4eeb-afc7-93760b7bb4f1'   // Qwen 3.8 Flash
const CAP_USD = 1.5
const which = (process.argv[2] ?? 'AB').toUpperCase()
const NAMES = ['N', 'E', 'S', 'W']

let spent = 0, fails = 0
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails++ }
const calls: any[] = []

function deps(): BridgeDeps & { rows: Map<string, BridgeRow> } {
  const rows = new Map<string, BridgeRow>()
  let n = 0
  return {
    rows,
    userId: '',
    store: {
      async insert(row) { const id = `live-${++n}`; rows.set(id, { ...row, id, updated_at: new Date().toISOString() } as BridgeRow); return id },
      async load(id) { const r = rows.get(id); return r ? JSON.parse(JSON.stringify(r)) : null },
      async save(id, version, patch) {
        const r = rows.get(id)
        if (!r || r.day !== version) return false
        rows.set(id, { ...r, ...patch, updated_at: new Date().toISOString() } as BridgeRow)
        return true
      },
    },
    getModel: id => getModelById(id),
    async bill(usd) { spent += usd },
    async canSpend() { return spent < CAP_USD },
    onCall(c) { calls.push(c) },
  }
}

async function run(label: string, seats: any[]) {
  console.log(`\n── table ${label} ──`)
  const d = deps()
  let v = (await handleBridge({ action: 'create', seats, deals: 1, lang: 'en' }, d)).body
  const id = v.id
  let steps = 0
  const checkView = (v: any) => {
    if (v.me == null || !v.deal) return
    const me = v.me as Seat
    const dummy = v.deal.dummy
    const over = !!v.deal.result
    v.deal.hands.forEach((h: any, s: number) => {
      const may = over || s === me || (s === dummy && (v.deal.tricks.flatMap((t: any) => t.cards).length > 0))
      if (h && !may) { ok(false, `${label}: the person saw ${NAMES[s]}'s hand`); throw new Error('leak') }
    })
    const reasons = [...v.deal.auction, ...v.deal.tricks.flatMap((t: any) => t.cards)]
      .filter((a: any) => a.why && a.seat !== me && !(a.seat === dummy && v.deal.contract?.declarer === me))
    if (!over && reasons.length) { ok(false, `${label}: the person saw another seat's reason`); throw new Error('leak') }
  }
  let views = 0
  while (v.next !== 'over' && steps < 400 && spent < CAP_USD) {
    steps++
    if (v.next === 'human') {
      const me = v.me
      const t = v.deal.turn
      if (t.kind === 'call') v = (await handleBridge({ action: 'call', id, call: 'P' }, d)).body
      else v = (await handleBridge({ action: 'play', id, card: v.deal.legal[v.deal.legal.length - 1] }, d)).body
      void me
    } else {
      const r = await handleBridge({ action: 'step', id }, d)
      if (r.status !== 200) { console.log('step failed', r.status, r.body); break }
      v = r.body
    }
    checkView(v); views++
    if (v.deal?.phase === 'play' && v.deal.tricks.length === 1 && v.deal.tricks[0].cards.length === 1) {
      console.log(`auction: ${v.deal.auction.map((a: any) => `${NAMES[a.seat]} ${callText(a.call)}${a.auto ? '⚠' : ''}${a.retried ? '↻' : ''}`).join(', ')}`)
      console.log(`contract: ${v.deal.contract.level}${v.deal.contract.strain}${v.deal.contract.doubled ? 'X'.repeat(v.deal.contract.doubled) : ''} by ${NAMES[v.deal.contract.declarer]}, opening lead ${cardText(v.deal.tricks[0].cards[0].card)}`)
    }
  }
  const row = d.rows.get(id)!
  const final = (await handleBridge({ action: 'state', id }, d)).body
  const deal = final.results[0]
  if (deal?.passedOut) console.log('passed out')
  else if (deal) console.log(`result: ${deal.contract.level}${deal.contract.strain} by ${NAMES[deal.contract.declarer]}, declarer's side took ${deal.tricks}; NS ${deal.ns} / EW ${deal.ew}`)
  final.seats.forEach((s: any) => console.log(`${NAMES[s.seat]} ${s.name}: asked ${s.stats.asked}, retried ${s.stats.retried}, auto ${s.stats.auto}, forced ${s.stats.forced}, $${s.stats.costUsd.toFixed(4)}, avg ${(s.stats.ms / Math.max(1, s.stats.asked) / 1000).toFixed(1)}s`))
  ok(final.status === 'over' && row.status === 'over', `${label}: the table finished (${steps} steps, ${views} views checked)`)
  const autos = final.seats.reduce((n: number, s: any) => n + s.stats.auto, 0)
  ok(autos <= 2, `${label}: automatic calls/cards: ${autos}`)
}

;(async () => {
  if (which.includes('A')) await run('A', [{ modelId: LUNA }, { modelId: QWEN }, { modelId: LUNA }, { modelId: QWEN }])
  if (which.includes('B')) await run('B', [{ modelId: QWEN }, { modelId: LUNA }, { human: true }, { modelId: LUNA }])
  const asked = calls.length, bad = calls.filter(c => !c.usable).length
  console.log(`\nmodel calls ${asked}, unusable replies ${bad}, spent $${spent.toFixed(4)}`)
  console.log(fails ? `${fails} FAILED` : 'all passed')
  process.exit(fails ? 1 : 0)
})()
