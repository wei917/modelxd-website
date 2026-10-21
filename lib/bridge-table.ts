// lib/bridge-table.ts — the bridge table behind /api/xgame/bridge (Oct 20).
//
// SERVER-ONLY. Poker's architecture (lib/poker-table.ts): the server holds
// the game, one act per request, the client loops; the route is a thin shell
// that hands in the database, the models and the wallet, so
// scripts/bridge-live.ts can run a real table through the same code.
//
//   create  four seats (N, E, S, W; models, at most one person), boards, language
//   state   the table as the caller may see it
//   step    one thing happens: the next board is dealt, a model calls or
//           plays, or the table plays a card that is the only legal one
//   call    the seated person calls
//   play    the seated person plays (from the dummy too, when they declare)
//   end     the game stops; an unfinished board does not count
//
// What a seated person sees: their own hand, the dummy once the opening lead
// is made, every call and card; the other seats' reasons only once the board
// is over (a reason can name the cards behind it). Spectators see all four
// hands. The deal is SEALED in pending.sealed (lib/game-seal.ts) because the
// owner can read their own row; `day` is the save counter, and a save only
// lands if nobody else saved since this request loaded the row.

import type { ModelInfo } from '@/lib/providers'
import {
  BRIDGE, dealHands, dealerOf, vulOf, isVul, partner, sideOf, rankOf,
  auctionOver, nextCaller, legalCalls, contractOf, nextPlayer, legalCards, remaining,
  tricksOf, tricksWon, scoreContract, readCall, readCard,
  type Seat, type Card, type Call, type Contract, type AuctionEntry, type PlayEntry, type Vul,
} from '@/lib/bridge-engine'
import { biddingPrompt, playPrompt, readReply, askOnce, MODEL_TIMEOUT_MS, BRIDGE_HARNESS } from '@/lib/bridge-ai'
import { sealer } from '@/lib/game-seal'
import { seatLevel } from '@/lib/xgame-speed'

const LOG = '[xgame:bridge]'
const { seal, unseal } = sealer('bridge')
/** A model's turn may hold two asks; leave room for the reads and the save. */
const TURN_BUDGET_MS = 170_000

export type BridgeSeat = {
  seat: Seat
  isHuman: boolean
  modelId: string | null
  name: string
  provider: string | null
  thinking: string | null
}

export type BridgeRow = {
  id: string
  user_id: string
  status: 'active' | 'over'
  human_seat: number | null
  players: BridgeSeat[]
  day: number
  pending: { sealed?: string; lang?: string }
  title: string | null
  winner: string | null
  cost_usd: number
  updated_at: string
}

export type SeatStats = { asked: number; retried: number; auto: number; forced: number; costUsd: number; ms: number }

export type Deal = {
  board: number
  dealer: Seat
  vul: Vul
  hands: Card[][]
  auction: AuctionEntry[]
  contract: Contract | null
  passedOut: boolean
  plays: PlayEntry[]
  /** Declarer's side's tricks, and the board's score for each side. */
  result: { tricks: number; ns: number; ew: number } | null
}

export type BridgeGame = {
  deals: Deal[]
  maxDeals: number
  over: boolean
  total: { NS: number; EW: number }
  stats: SeatStats[]
}

export interface BridgeDeps {
  userId: string
  store: {
    insert(row: Omit<BridgeRow, 'id' | 'updated_at'>): Promise<string | null>
    load(id: string): Promise<BridgeRow | null>
    save(id: string, version: number, patch: Partial<BridgeRow>): Promise<boolean>
  }
  getModel(id: string): Promise<ModelInfo | null>
  bill(usd: number, tableId: string, model: ModelInfo): Promise<void>
  canSpend(): Promise<boolean>
  onCall?(c: { seat: number; model: string; kind: 'call' | 'card'; attempt: number; inTokens: number; outTokens: number; cost: number; ms: number; timedOut: boolean; usable: boolean }): void
}

export type Reply = { status: number; body: any }
const fail = (status: number, error: string): Reply => ({ status, body: { error } })
const LANGS = ['en', 'zh-Hant', 'zh-Hans', 'ja', 'ko']

function usable(m: ModelInfo | null): m is ModelInfo {
  if (!m || !m.enabled) return false
  if (!(m.output_modalities ?? []).includes('text')) return false
  const inputs = m.input_modalities ?? []
  return inputs.length === 0 || inputs.includes('text')
}

// ── the game ─────────────────────────────────────────────────────────────

export function newGame(maxDeals: number): BridgeGame {
  return {
    deals: [], maxDeals, over: false, total: { NS: 0, EW: 0 },
    stats: [0, 1, 2, 3].map(() => ({ asked: 0, retried: 0, auto: 0, forced: 0, costUsd: 0, ms: 0 })),
  }
}

export function dealNext(g: BridgeGame, rand?: () => number) {
  const board = g.deals.length + 1
  g.deals.push({
    board, dealer: dealerOf(board), vul: vulOf(board), hands: dealHands(rand),
    auction: [], contract: null, passedOut: false, plays: [], result: null,
  })
}

export const current = (g: BridgeGame): Deal | null => g.deals.length ? g.deals[g.deals.length - 1] : null

export type Turn = { kind: 'call' | 'card'; seat: Seat; decider: Seat }

/** Whose call or card it is, and who decides it (the declarer plays the dummy). */
export function turnOf(d: Deal): Turn | null {
  if (d.result) return null
  if (!auctionOver(d.auction)) {
    const s = nextCaller(d.dealer, d.auction)
    return { kind: 'call', seat: s, decider: s }
  }
  if (!d.contract || d.plays.length >= 52) return null
  const s = nextPlayer(d.contract, d.plays)
  return { kind: 'card', seat: s, decider: s === partner(d.contract.declarer) ? d.contract.declarer : s }
}

function finish(g: BridgeGame, d: Deal) {
  if (d.passedOut || !d.contract) d.result = { tricks: 0, ns: 0, ew: 0 }
  else {
    const c = d.contract
    const won = tricksWon(c, d.plays)
    const tricks = won[sideOf(c.declarer)]
    const score = scoreContract(c, tricks, isVul(d.vul, c.declarer))
    const ns = sideOf(c.declarer) === 'NS' ? score : -score
    d.result = { tricks, ns, ew: -ns }
  }
  // Duplicate scores: one side's plus is the other's minus. A side's total
  // is what it scored.
  if (d.result.ns > 0) g.total.NS += d.result.ns
  if (d.result.ew > 0) g.total.EW += d.result.ew
  if (g.deals.length >= g.maxDeals) g.over = true
}

export function applyCall(g: BridgeGame, d: Deal, seat: Seat, call: Call, meta: Partial<AuctionEntry> = {}): { ok: true } | { ok: false; reason: string } {
  const t = turnOf(d)
  if (!t || t.kind !== 'call' || t.seat !== seat) return { ok: false, reason: 'it is not that seat\'s call' }
  if (!legalCalls(d.auction, seat).includes(call)) return { ok: false, reason: `${call} is not a legal call now` }
  d.auction.push({ seat, call, ...meta })
  if (auctionOver(d.auction)) {
    d.contract = contractOf(d.auction)
    if (!d.contract) { d.passedOut = true; finish(g, d) }
  }
  return { ok: true }
}

export function applyCard(g: BridgeGame, d: Deal, seat: Seat, card: Card, meta: Partial<PlayEntry> = {}): { ok: true } | { ok: false; reason: string } {
  const t = turnOf(d)
  if (!t || t.kind !== 'card' || t.seat !== seat || !d.contract) return { ok: false, reason: 'it is not that seat\'s card' }
  const hand = remaining(d.hands, d.plays)[seat]
  if (!hand.includes(card)) return { ok: false, reason: `${card} is not in that hand` }
  if (!legalCards(hand, d.contract, d.plays).includes(card)) return { ok: false, reason: 'you must follow suit' }
  d.plays.push({ seat, card, ...meta })
  if (d.plays.length === 52) finish(g, d)
  return { ok: true }
}

/** The marked fallback: pass in the auction; the lowest legal card in the play. */
export function fallbackFor(d: Deal, t: Turn): string {
  if (t.kind === 'call') return 'P'
  const legal = legalCards(remaining(d.hands, d.plays)[t.seat], d.contract!, d.plays)
  return [...legal].sort((a, b) => rankOf(b) - rankOf(a))[0]
}

// ── the view ─────────────────────────────────────────────────────────────

export function view(row: BridgeRow, g: BridgeGame) {
  const me = row.human_seat as Seat | null
  const spectator = me == null
  const d = current(g)
  const t = d ? turnOf(d) : null
  const humanTurn = !!t && me != null && t.decider === me && !g.over
  const dummy = d?.contract ? partner(d.contract.declarer) : null
  const canSeeHand = (s: Seat) => !d ? false
    : spectator || !!d.result || s === me || (s === dummy && d.plays.length > 0)
  const canSeeWhy = (s: Seat) => spectator || !!d?.result || s === me
  const left = d ? remaining(d.hands, d.plays) : null
  const next = g.over ? 'over'
    : !d || d.result ? 'deal'
    : humanTurn ? 'human' : 'ai'
  return {
    id: row.id,
    version: row.day,
    status: g.over ? 'over' : row.status,
    title: row.title,
    lang: row.pending.lang ?? 'en',
    me, spectator,
    settings: { deals: g.maxDeals, harness: BRIDGE_HARNESS },
    seats: row.players.map((p, i) => ({ seat: i, name: p.name, isHuman: p.isHuman, provider: p.provider, thinking: p.thinking, stats: g.stats[i] })),
    deal: d ? {
      board: d.board, dealer: d.dealer, vul: d.vul,
      phase: d.result ? 'done' : !auctionOver(d.auction) ? 'auction' : 'play',
      auction: d.auction.map(a => ({ seat: a.seat, call: a.call, auto: a.auto, retried: a.retried, ms: a.ms, ...(canSeeWhy(a.seat) && a.why ? { why: a.why } : {}) })),
      contract: d.contract, passedOut: d.passedOut, dummy,
      hands: ([0, 1, 2, 3] as Seat[]).map(s => (canSeeHand(s) ? left![s] : null)),
      counts: left!.map(h => h.length),
      // The four hands as dealt, once the board is over, for looking back.
      dealt: d.result ? d.hands : null,
      tricks: d.contract ? tricksOf(d.contract, d.plays).map(tr => ({
        leader: tr.leader, winner: tr.winner,
        cards: tr.cards.map(p => {
          // A reason for a dummy card is the declarer's.
          const by = dummy != null && p.seat === dummy ? d.contract!.declarer : p.seat
          return { seat: p.seat, card: p.card, auto: p.auto, forced: p.forced, retried: p.retried, ms: p.ms, ...(canSeeWhy(by) && p.why ? { why: p.why } : {}) }
        }),
      })) : [],
      won: d.contract ? tricksWon(d.contract, d.plays) : { NS: 0, EW: 0 },
      turn: t,
      legal: humanTurn && t ? (t.kind === 'call' ? legalCalls(d.auction, t.seat) : legalCards(left![t.seat], d.contract!, d.plays)) : [],
      result: d.result,
    } : null,
    results: g.deals.filter(x => x.result).map(x => ({
      board: x.board, vul: x.vul, contract: x.contract, passedOut: x.passedOut,
      tricks: x.result!.tricks, ns: x.result!.ns, ew: x.result!.ew,
    })),
    total: g.total,
    next,
    humanTurn,
    winner: g.over ? (g.total.NS > g.total.EW ? 'NS' : g.total.EW > g.total.NS ? 'EW' : 'draw') : null,
    costUsd: Number(row.cost_usd) || 0,
  }
}

// ── the handler ──────────────────────────────────────────────────────────

export async function handleBridge(body: any, d: BridgeDeps): Promise<Reply> {
  if (body?.action === 'create') return create(body, d)

  const row = typeof body?.id === 'string' ? await d.store.load(body.id) : null
  if (!row || row.user_id !== d.userId) return fail(404, 'Not found')
  let g: BridgeGame
  try { g = unseal<BridgeGame>(row.pending.sealed ?? '') }
  catch (e: any) {
    console.warn(`${LOG} ${row.id}: unreadable state:`, e?.message)
    return fail(409, 'This table can no longer be opened.')
  }

  const winner = () => (g.total.NS > g.total.EW ? 'NS' : g.total.EW > g.total.NS ? 'EW' : 'draw')
  const save = async (patch: Partial<BridgeRow> = {}): Promise<boolean> => {
    const full: Partial<BridgeRow> = {
      pending: { ...row.pending, sealed: seal(g) },
      day: row.day + 1,
      ...(g.over ? { status: 'over' as const, winner: winner() } : {}),
      ...patch,
    }
    const ok = await d.store.save(row.id, row.day, full)
    if (ok) Object.assign(row, full)
    return ok
  }
  const latest = async (): Promise<Reply> => {
    const fresh = await d.store.load(row.id)
    if (!fresh) return fail(404, 'Not found')
    try { return { status: 200, body: view(fresh, unseal<BridgeGame>(fresh.pending.sealed ?? '')) } }
    catch { return fail(409, 'This table can no longer be opened.') }
  }
  const ok = (): Reply => ({ status: 200, body: view(row, g) })

  switch (body.action) {
    case 'state':
      return ok()

    case 'end': {
      if (!g.over) {
        const cur = current(g)
        if (cur && !cur.result) g.deals.pop()
        g.over = true
        if (!(await save())) return latest()
      }
      return ok()
    }

    case 'call':
    case 'play': {
      const me = row.human_seat as Seat | null
      const deal = g.over ? null : current(g)
      const t = deal ? turnOf(deal) : null
      if (me == null || !deal || !t || t.decider !== me) return fail(409, 'It is not your turn.')
      const ms = Math.max(0, Date.now() - new Date(row.updated_at).getTime())
      let r
      if (body.action === 'call') {
        const call = t.kind === 'call' ? readCall(String(body.call ?? '')) : null
        if (!call) return fail(400, 'That is not a call.')
        r = applyCall(g, deal, t.seat, call, { ms })
      } else {
        const card = t.kind === 'card' ? readCard(String(body.card ?? '')) : null
        if (!card) return fail(400, 'That is not a card.')
        r = applyCard(g, deal, t.seat, card, { ms })
      }
      if (!r.ok) return fail(400, r.reason)
      if (!(await save())) return latest()
      return ok()
    }

    case 'step': {
      if (g.over) {
        if (row.status !== 'over' && !(await save())) return latest()
        return ok()
      }
      const deal = current(g)
      if (!deal || deal.result) {
        if (g.deals.length >= g.maxDeals) g.over = true
        else dealNext(g)
        if (!(await save())) return latest()
        return ok()
      }
      const t = turnOf(deal)!
      if (row.players[t.decider].isHuman) return ok()
      if (t.kind === 'card') {
        // The only legal card is played by the table, with no call.
        const legal = legalCards(remaining(deal.hands, deal.plays)[t.seat], deal.contract!, deal.plays)
        if (legal.length === 1) {
          applyCard(g, deal, t.seat, legal[0], { forced: true })
          g.stats[t.decider].forced++
          if (!(await save())) return latest()
          return ok()
        }
      }
      return aiTurn(row, g, deal, t, d, save, latest, ok)
    }
  }
  return fail(400, 'unknown action')
}

async function create(body: any, d: BridgeDeps): Promise<Reply> {
  const cfg: any[] = Array.isArray(body.seats) ? body.seats : []
  if (cfg.length !== 4) return fail(400, 'A bridge table needs four seats: North, East, South and West.')
  if (cfg.filter(c => c?.human).length > 1) return fail(400, 'At most one person can sit at a table.')
  const deals = (BRIDGE.dealChoices as readonly number[]).includes(Number(body.deals)) ? Number(body.deals) : BRIDGE.defaultDeals
  const lang = LANGS.includes(body.lang) ? body.lang : 'en'

  const seats: BridgeSeat[] = []
  const counts = new Map<string, number>()
  for (let i = 0; i < 4; i++) {
    const c = cfg[i]
    if (c?.human) {
      const nm = typeof body.playerName === 'string' && body.playerName.trim() ? body.playerName.trim().slice(0, 24) : 'You'
      seats.push({ seat: i as Seat, isHuman: true, modelId: null, name: nm, provider: null, thinking: null })
      continue
    }
    const m = typeof c?.modelId === 'string' ? await d.getModel(c.modelId) : null
    if (!usable(m)) return fail(400, `Seat ${'NESW'[i]}: that model is not available.`)
    // Only the models, and thinking levels, that passed bridge's speed test
    // (lib/xgame-speed.ts); the picker offers no others.
    const lv = seatLevel('bridge', m, c.thinking)
    if (!lv.ok) return fail(400, `Seat ${'NESW'[i]}: ${m.display_name}: ${lv.reason}.`)
    // The same model may take several seats: "name (2)", as in Werewolf.
    const k = (counts.get(m.id) ?? 0) + 1
    counts.set(m.id, k)
    seats.push({
      seat: i as Seat, isHuman: false, modelId: m.id, provider: m.provider, thinking: lv.level,
      name: k > 1 ? `${m.display_name} (${k})` : m.display_name,
    })
  }

  const g = newGame(deals)
  dealNext(g)
  const nm = (s: BridgeSeat) => (s.isHuman ? 'You' : s.name)
  const title = `Bridge · ${nm(seats[0])} & ${nm(seats[2])} vs ${nm(seats[1])} & ${nm(seats[3])}`
  const human = seats.findIndex(s => s.isHuman)
  const id = await d.store.insert({
    user_id: d.userId, status: 'active', human_seat: human >= 0 ? human : null,
    players: seats, day: 0, pending: { sealed: seal(g), lang },
    title, winner: null, cost_usd: 0,
  })
  if (!id) return fail(503, 'Could not create the table.')
  const row = await d.store.load(id)
  if (!row) return fail(503, 'Could not create the table.')
  return { status: 200, body: view(row, g) }
}

async function aiTurn(
  row: BridgeRow, g: BridgeGame, deal: Deal, t: Turn, d: BridgeDeps,
  save: (patch?: Partial<BridgeRow>) => Promise<boolean>, latest: () => Promise<Reply>, ok: () => Reply,
): Promise<Reply> {
  const p = row.players[t.decider]
  if (!(await d.canSpend())) return fail(402, 'Your balance is empty. Top up on your profile page to keep the table going.')
  const model = p.modelId ? await d.getModel(p.modelId) : null
  const field = t.kind
  const left = remaining(deal.hands, deal.plays)
  const dummySeat = deal.contract ? partner(deal.contract.declarer) : null
  const legal = t.kind === 'call' ? legalCalls(deal.auction, t.seat) : legalCards(left[t.seat], deal.contract!, deal.plays)

  let cost = 0, ms = 0, objection: string | null = null, done = false, attempts = 0
  if (usable(model)) {
    for (let attempt = 0; attempt < 1 + BRIDGE_HARNESS.retries && !done; attempt++) {
      const prompt = t.kind === 'call'
        ? biddingPrompt({ seat: t.seat, board: deal.board, dealer: deal.dealer, vul: deal.vul, hand: deal.hands[t.seat], auction: deal.auction, legal, objection })
        : playPrompt({
          seat: t.decider, board: deal.board, dealer: deal.dealer, vul: deal.vul, auction: deal.auction,
          contract: deal.contract!, plays: deal.plays, from: t.seat,
          own: left[t.decider],
          dummy: deal.plays.length > 0 && dummySeat != null && dummySeat !== t.decider ? left[dummySeat] : null,
          legal, objection,
        })
      const budget = TURN_BUDGET_MS - ms
      if (budget < 15_000) break
      attempts++
      const a = await askOnce(model, prompt, field, p.thinking, d.userId, Math.min(MODEL_TIMEOUT_MS, budget))
      cost += a.cost; ms += a.ms
      const r = readReply(a.text, field)
      const value = r.value ? (field === 'call' ? readCall(r.value) : readCard(r.value)) : null
      d.onCall?.({ seat: t.decider, model: model.display_name, kind: field, attempt, inTokens: a.inTokens, outTokens: a.outTokens, cost: a.cost, ms: a.ms, timedOut: a.timedOut, usable: !!value })
      if (a.timedOut && !a.text.trim()) break   // never re-ask a slow model
      if (!value) { objection = r.value ? `"${r.value.slice(0, 20)}" is not a ${field === 'call' ? 'call' : 'card'}` : 'no answer could be read from your reply; reply with ONLY the JSON'; continue }
      const meta = { why: r.why, ms, cost, ...(attempt > 0 ? { retried: true } : {}) }
      const res = field === 'call' ? applyCall(g, deal, t.seat, value, meta) : applyCard(g, deal, t.seat, value, meta)
      if (res.ok) done = true
      else objection = `${r.value}: ${res.reason}`
    }
  }
  if (!done) {
    const fb = fallbackFor(deal, t)
    const meta = { auto: true, ms, cost }
    const res = t.kind === 'call' ? applyCall(g, deal, t.seat, fb, meta) : applyCard(g, deal, t.seat, fb, meta)
    if (!res.ok) { console.warn(`${LOG} ${row.id}: fallback refused: ${res.reason}`); return ok() }
    console.warn(`${LOG} ${row.id}: ${p.name} fell back (${objection ?? 'timeout or no model'})`)
  }
  const st = g.stats[t.decider]
  st.asked++
  if (attempts > 1 && done) st.retried++
  if (!done) st.auto++
  st.costUsd += cost
  st.ms += ms

  // The model was called whether or not this save lands: bill what it cost.
  if (cost > 0 && model) {
    try { await d.bill(cost, row.id, model) } catch (e: any) { console.warn(`${LOG} bill failed:`, e?.message) }
  }
  if (!(await save({ cost_usd: (Number(row.cost_usd) || 0) + cost }))) return latest()
  return ok()
}
