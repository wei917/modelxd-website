// lib/poker-table.ts — the hold'em table behind /api/xgame/poker (Oct 19).
//
// SERVER-ONLY. Gomoku's architecture: the server holds the game, one act per
// request (create / state / step / act / end), the client loops. The route
// is a thin shell around handlePoker() (sign-in, the database, the wallet);
// everything else is here, with those three passed in, so
// scripts/poker-live.ts can run a real table through the same code with an
// in-memory store and no wallet.
//
//   create  seats 2-9 (models and at most one person), hands, language
//   state   the table as the caller may see it
//   step    one thing happens: a model acts, or the next hand is dealt
//   act     the seated person acts
//   end     the game stops now; the unfinished hand does not count
//
// The row is xtalk_sessions with game 'poker' (no migration: the column has
// no CHECK). The game state lives SEALED in pending.sealed (lib/poker-seal.ts)
// because the owner can read their own row; `day` is the save counter, and a
// save only lands if nobody else saved since this request loaded the row.

import type { ModelInfo } from '@/lib/providers'
import {
  POKER, newGame, dealNext, apply, snapshot, currentHand, viewHand, fallbackDecision, HAND_NAMES,
  type PokerGame, type Viewer,
} from '@/lib/poker-engine'
import { buildPrompt, parseReply, askOnce, MODEL_TIMEOUT_MS, TURN_BUDGET_MS, type SeatInfo } from '@/lib/poker-ai'
import { seal, unseal } from '@/lib/poker-seal'
import { seatLevel } from '@/lib/xgame-speed'

const LOG = '[xgame:poker]'

export type PokerSeat = {
  seat: number
  isHuman: boolean
  modelId: string | null
  name: string
  provider: string | null
  /** The model's thinking level for this seat (null = the model's default). */
  thinking: string | null
}

export type PokerRow = {
  id: string
  user_id: string
  status: 'active' | 'over'
  human_seat: number | null
  players: PokerSeat[]
  /** Save counter (optimistic lock). */
  day: number
  pending: { sealed?: string; lang?: string }
  title: string | null
  winner: string | null
  cost_usd: number
  updated_at: string
}

export interface PokerDeps {
  userId: string
  store: {
    insert(row: Omit<PokerRow, 'id' | 'updated_at'>): Promise<string | null>
    load(id: string): Promise<PokerRow | null>
    /** Writes only if the row is still at `version`; false when another request saved first. */
    save(id: string, version: number, patch: Partial<PokerRow>): Promise<boolean>
  }
  getModel(id: string): Promise<ModelInfo | null>
  /** Charges a model's spend for one action to the user. */
  bill(usd: number, tableId: string, model: ModelInfo): Promise<void>
  /** False when the user's balance is empty. */
  canSpend(): Promise<boolean>
  /** Every model call, for measurements (scripts/poker-live.ts). */
  onCall?(c: { seat: number; model: string; attempt: number; inTokens: number; outTokens: number; cost: number; ms: number; timedOut: boolean; usable: boolean }): void
}

export type Reply = { status: number; body: any }
const fail = (status: number, error: string): Reply => ({ status, body: { error } })

const LANGS = ['en', 'zh-Hant', 'zh-Hans', 'ja', 'ko']

/** What a seat's model may be: an enabled text-in, text-out model. */
function usable(m: ModelInfo | null): m is ModelInfo {
  if (!m || !m.enabled) return false
  if (!(m.output_modalities ?? []).includes('text')) return false
  const inputs = m.input_modalities ?? []
  return inputs.length === 0 || inputs.includes('text')
}

function winnerOf(g: PokerGame): string | null {
  const top = Math.max(...g.chips)
  const at = g.chips.map((c, i) => (c === top ? i : -1)).filter(i => i >= 0)
  return at.length === 1 ? `seat-${at[0]}` : 'split'
}

// ── The view: everything the caller may see, nothing else ────────────────

function viewerFor(row: PokerRow, g: PokerGame): Viewer {
  const me = row.human_seat
  if (me == null) return { all: true }
  // A person who has lost every chip is no longer at the table: from then
  // on they watch like a spectator (nothing they see can change a decision).
  const h = currentHand(g)
  const out = g.chips[me] <= 0 && (!h || !!h.result || h.start[me] <= 0)
  return out ? { all: true } : { all: false, seat: me }
}

export function view(row: PokerRow, g: PokerGame) {
  const v = viewerFor(row, g)
  const h = currentHand(g)
  const prev = g.hands.length >= 2 ? g.hands[g.hands.length - 2] : null
  const snap = h ? snapshot(g) : null
  const next = g.over ? 'over'
    : !h || h.result ? 'deal'
    : snap?.toAct != null && row.players[snap.toAct]?.isHuman ? 'human'
    : 'ai'
  return {
    id: row.id,
    /** Save counter: the client keeps the newest view when replies cross. */
    version: row.day,
    status: g.over ? 'over' : row.status,
    title: row.title,
    lang: row.pending.lang ?? 'en',
    settings: {
      smallBlind: POKER.smallBlind, bigBlind: POKER.bigBlind, startStack: POKER.startStack,
      maxHands: g.maxHands, retries: 1, timeoutSec: MODEL_TIMEOUT_MS / 1000,
    },
    me: row.human_seat,
    spectator: v.all,
    seats: row.players.map((p, i) => ({
      seat: i, name: p.name, isHuman: p.isHuman, provider: p.provider, thinking: p.thinking,
      chips: g.chips[i], stats: g.stats[i],
    })),
    handsPlayed: g.hands.filter(x => x.result).length,
    hand: h ? viewHand(g, h, v, snap) : null,
    prev: prev ? viewHand(g, prev, v) : null,
    // Finished hands in brief, for the history list. Only showdown cards.
    results: g.hands.filter(x => x.result).map(x => ({
      n: x.n, won: x.result!.won, net: x.result!.net, shown: x.result!.shown,
      rank: x.result!.rank, showdown: x.result!.showdown,
    })),
    next,
    toAct: snap?.toAct ?? null,
    winner: g.over ? winnerOf(g) : null,
    costUsd: Number(row.cost_usd) || 0,
    handNames: HAND_NAMES,
  }
}

// ── The handler ──────────────────────────────────────────────────────────

export async function handlePoker(body: any, d: PokerDeps): Promise<Reply> {
  if (body?.action === 'create') return create(body, d)

  const row = typeof body?.id === 'string' ? await d.store.load(body.id) : null
  if (!row || row.user_id !== d.userId) return fail(404, 'Not found')
  let g: PokerGame
  try { g = unseal<PokerGame>(row.pending.sealed ?? '') }
  catch (e: any) {
    console.warn(`${LOG} ${row.id}: unreadable state:`, e?.message)
    return fail(409, 'This table can no longer be opened.')
  }

  const save = async (patch: Partial<PokerRow> = {}): Promise<boolean> => {
    const full: Partial<PokerRow> = {
      pending: { ...row.pending, sealed: seal(g) },
      day: row.day + 1,
      ...(g.over ? { status: 'over' as const, winner: winnerOf(g) } : {}),
      ...patch,
    }
    const ok = await d.store.save(row.id, row.day, full)
    if (ok) Object.assign(row, full)
    return ok
  }
  /** Another request saved first: show what it saved. */
  const latest = async (): Promise<Reply> => {
    const fresh = await d.store.load(row.id)
    if (!fresh) return fail(404, 'Not found')
    try { return { status: 200, body: view(fresh, unseal<PokerGame>(fresh.pending.sealed ?? '')) } }
    catch { return fail(409, 'This table can no longer be opened.') }
  }
  const ok = (): Reply => ({ status: 200, body: view(row, g) })

  switch (body.action) {
    case 'state':
      return ok()

    case 'end': {
      if (!g.over) {
        // The hand in progress is void: chips stay as the last finished hand left them.
        if (currentHand(g) && !currentHand(g)!.result) g.hands.pop()
        g.over = true
        if (!(await save())) return latest()
      }
      return ok()
    }

    case 'act': {
      const me = row.human_seat
      const s = g.over ? null : snapshot(g)
      if (me == null || !s || s.done || s.toAct !== me) return fail(409, 'It is not your turn.')
      const ms = Math.max(0, Date.now() - new Date(row.updated_at).getTime())
      const r = apply(g, me, { act: body.move, amount: body.amount ?? null }, { ms })
      if (!r.ok) return fail(400, r.reason)
      if (!(await save())) return latest()
      return ok()
    }

    case 'step': {
      if (g.over) {
        if (row.status !== 'over' && !(await save())) return latest()
        return ok()
      }
      const h = currentHand(g)
      if (!h || h.result) {
        dealNext(g)
        if (!(await save())) return latest()
        return ok()
      }
      const s = snapshot(g)!
      if (s.toAct == null) return ok()
      const p = row.players[s.toAct]
      if (p.isHuman) return ok()
      return aiTurn(row, g, s.toAct, d, save, latest, ok)
    }
  }
  return fail(400, 'unknown action')
}

async function create(body: any, d: PokerDeps): Promise<Reply> {
  const cfg: any[] = Array.isArray(body.seats) ? body.seats : []
  if (cfg.length < POKER.minSeats || cfg.length > POKER.maxSeats) {
    return fail(400, `A table needs ${POKER.minSeats} to ${POKER.maxSeats} seats.`)
  }
  if (cfg.filter(c => c?.human).length > 1) return fail(400, 'At most one person can sit at a table.')
  const hands = (POKER.handChoices as readonly number[]).includes(Number(body.hands)) ? Number(body.hands) : POKER.defaultHands
  const lang = LANGS.includes(body.lang) ? body.lang : 'en'

  const seats: PokerSeat[] = []
  const counts = new Map<string, number>()
  for (let i = 0; i < cfg.length; i++) {
    const c = cfg[i]
    if (c?.human) {
      const nm = typeof body.playerName === 'string' && body.playerName.trim() ? body.playerName.trim().slice(0, 24) : 'Player'
      seats.push({ seat: i, isHuman: true, modelId: null, name: nm, provider: null, thinking: null })
      continue
    }
    const m = typeof c?.modelId === 'string' ? await d.getModel(c.modelId) : null
    if (!usable(m)) return fail(400, `Seat ${i + 1}: that model is not available.`)
    // Only the models, and thinking levels, that passed poker's speed test
    // (lib/xgame-speed.ts); the picker offers no others.
    const lv = seatLevel('poker', m, c.thinking)
    if (!lv.ok) return fail(400, `Seat ${i + 1}: ${m.display_name}: ${lv.reason}.`)
    const thinking = lv.level
    // The same model may take several seats: "name (2)", "name (3)", as in Werewolf.
    const k = (counts.get(m.id) ?? 0) + 1
    counts.set(m.id, k)
    seats.push({
      seat: i, isHuman: false, modelId: m.id, provider: m.provider, thinking,
      name: k > 1 ? `${m.display_name} (${k})` : m.display_name,
    })
  }

  const g = newGame(seats.length, hands)
  dealNext(g)
  const names = seats.map(s => (s.isHuman ? 'You' : s.name))
  const title = `Hold'em · ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` +${names.length - 3}` : ''}`
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
  row: PokerRow, g: PokerGame, seat: number, d: PokerDeps,
  save: (patch?: Partial<PokerRow>) => Promise<boolean>, latest: () => Promise<Reply>, ok: () => Reply,
): Promise<Reply> {
  const p = row.players[seat]
  if (!(await d.canSpend())) return fail(402, 'Your balance is empty. Top up on your profile page to keep the table going.')
  const model = p.modelId ? await d.getModel(p.modelId) : null
  const infos: SeatInfo[] = row.players.map(x => ({ seat: x.seat, name: x.name, isHuman: x.isHuman }))
  const lang = row.pending.lang ?? 'en'

  let cost = 0, ms = 0, objection: string | null = null, done = false, attempts = 0
  if (usable(model)) {
    for (let attempt = 0; attempt < 2 && !done; attempt++) {
      const prompt = buildPrompt(g, seat, infos, lang, objection)
      if (!prompt) break
      const left = TURN_BUDGET_MS - ms
      if (left < 15_000) break
      attempts++
      const a = await askOnce(model, prompt, p.thinking, d.userId, Math.min(MODEL_TIMEOUT_MS, left))
      cost += a.cost; ms += a.ms
      if (a.timedOut) { d.onCall?.({ seat, model: model.display_name, attempt, inTokens: a.inTokens, outTokens: a.outTokens, cost: a.cost, ms: a.ms, timedOut: true, usable: false }); break }   // never re-ask a slow model
      const parsed = parseReply(a.text)
      d.onCall?.({ seat, model: model.display_name, attempt, inTokens: a.inTokens, outTokens: a.outTokens, cost: a.cost, ms: a.ms, timedOut: a.timedOut, usable: !!parsed.decision })
      if (!parsed.decision) { objection = parsed.problem ?? 'the reply could not be read.'; continue }
      const r = apply(g, seat, parsed.decision, {
        why: parsed.why, say: parsed.say, ms, cost,
        ...(attempt > 0 ? { retried: true } : {}),
      })
      if (r.ok) done = true
      else objection = r.reason
    }
  }
  if (!done) {
    const r = apply(g, seat, fallbackDecision(g), { auto: true, ms, cost })
    if (!r.ok) { console.warn(`${LOG} ${row.id}: fallback refused: ${r.reason}`); return ok() }
    console.warn(`${LOG} ${row.id}: ${p.name} fell back (${objection ?? 'timeout or no model'})`)
  }
  const st = g.stats[seat]
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
