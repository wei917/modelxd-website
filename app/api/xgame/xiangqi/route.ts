// app/api/xgame/xiangqi/route.ts
// 象棋 for the XGame arena (Oct 20; owner: "do the next game"). Chess's
// route, second ffish tenant: the server holds the game, one act per
// request (create / state / move / step / resign), the client loops. Rows
// live in xtalk_sessions with game 'xiangqi' (no migration).
//
// The record is the list of coordinate moves in pending.moves; every request
// rebuilds the position from it with lib/xiangqi-engine.ts (ffish, GPL,
// server only), which keeps the repetition rules exact. An AI move is
// lib/xiangqi-turn.ts: the same prompt, one retry and the same marked
// fallback for every model (XIANGQI_HARNESS, sent with the view).
//
// Billing as chess: the wallet is checked before an AI move, each move is
// debited at list price (referenceType xgame_xiangqi, sub-cent charges
// carried by accrueFraction).

export const runtime = 'nodejs'
// Two asks of up to 90 s each, plus the reads and the write.
export const maxDuration = 200

import { createClient } from '@supabase/supabase-js'
import { debitCredits, accrueFraction, InsufficientCreditsError } from '@/lib/credits'
import { xiangqiEngine, type XqEnd, type XiangqiEngine, type XqPosition } from '@/lib/xiangqi-engine'
import { playAiTurn, providerAsk, XIANGQI_HARNESS } from '@/lib/xiangqi-turn'
import { seatLevel } from '@/lib/xgame-speed'

const LOG = '[xgame:xiangqi]'

const svc = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false } },
)

type Side = 'w' | 'b'
type Player = { side: Side; modelId: string | null; name: string; isHuman: boolean; thinking?: string | null }
type Move = {
  n: number; side: Side; uci: string; wxf: string
  why?: string; fallback?: boolean; retried?: boolean; rejected?: string[]; timedOut?: boolean
  cost?: number; ms?: number
}

async function getModelById(id: string) {
  const { data } = await svc().from('ai_models')
    .select('id, provider, model_name, display_name, modes, model_pricing, input_config, output_config')
    .eq('id', id).eq('enabled', true).maybeSingle()
  return data
}

export async function POST(req: Request) {
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return Response.json({ error: 'Bad JSON' }, { status: 400 }) }

  let engine: XiangqiEngine
  try { engine = await xiangqiEngine() } catch (e) {
    console.error(`${LOG} engine failed to load:`, e)
    return Response.json({ error: 'The 象棋 engine is unavailable right now.' }, { status: 503 })
  }

  // ── create ────────────────────────────────────────────────────────────
  if (body.action === 'create') {
    const seats = body.seats ?? {}
    // Only the models, and thinking levels, that passed this table's speed
    // test may sit (lib/xgame-speed.ts); the picker offers no others.
    let refused: string | null = null
    const mk = async (side: Side, cfg: any): Promise<Player | null> => {
      if (cfg?.human) return { side, modelId: null, name: String(body.playerName ?? '').slice(0, 40) || 'You', isHuman: true }
      const m = cfg?.modelId ? await getModelById(cfg.modelId) : null
      const lv = m ? seatLevel('xiangqi', m, cfg?.thinking) : null
      if (m && lv && !lv.ok) { refused = `${m.display_name}: ${lv.reason}`; return null }
      return m && lv?.ok ? {
        side, modelId: m.id, name: m.display_name, isHuman: false,
        thinking: lv.level,
      } : null
    }
    const red = await mk('w', seats.red), black = await mk('b', seats.black)
    if (refused) return Response.json({ error: refused }, { status: 400 })
    if (!red || !black) return Response.json({ error: 'both seats need a model or a human' }, { status: 400 })
    if (red.isHuman && black.isHuman) return Response.json({ error: 'at most one human seat' }, { status: 400 })
    // The thinking level is part of a player's identity, as in chess.
    const label = (p: Player) => `${p.name}${p.thinking ? ` (${p.thinking})` : ''}`
    const { data, error } = await svc().from('xtalk_sessions').insert({
      user_id: user.id, game: 'xiangqi', status: 'active',
      human_seat: red.isHuman ? 0 : (black.isHuman ? 1 : null),
      players: [red, black], phase: 'w', day: 0, turn_order: [],
      transcript: [], pending: { moves: [], end: null, harness: XIANGQI_HARNESS.version },
      title: `${label(red)} vs ${label(black)}`,
    }).select('id').single()
    if (error || !data) {
      console.warn(`${LOG} create failed:`, error?.message)
      return Response.json({ error: 'Could not create the game.' }, { status: 503 })
    }
    body.id = data.id; body.action = 'state'
  }

  // ── load + owner check ────────────────────────────────────────────────
  const { data: row } = await svc().from('xtalk_sessions')
    .select('*').eq('id', body.id).maybeSingle()
  if (!row || row.user_id !== user.id || row.game !== 'xiangqi') {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }
  const s = row as any
  const players: Player[] = s.players
  let pos: XqPosition
  try { pos = engine.position(s.pending?.moves ?? []) } catch (e) {
    console.error(`${LOG} ${s.id}: the record does not replay:`, e)
    return Response.json({ error: 'This game record is damaged.' }, { status: 500 })
  }
  const turnOf = (): Player | null => s.status === 'over' ? null : players[pos.turn === 'w' ? 0 : 1]
  const turn = turnOf()

  // view() reads `s` and `pos` LIVE: after a move, the response shows it.
  const view = () => {
    const tp = turnOf()
    return Response.json({
      id: s.id, status: s.status, winner: s.winner ?? null,
      end: (s.pending?.end ?? null) as XqEnd | null,
      fen: pos.fen, turn: tp ? tp.side : null, check: pos.check,
      // The person's legal moves let the table light the targets with no
      // rules code in the browser.
      legal: tp?.isHuman ? pos.legalUci : [],
      moves: s.transcript as Move[],
      players: s.players,
      humanTurn: !!tp?.isHuman,
      costUsd: Number(s.cost_usd) || 0,
      harness: XIANGQI_HARNESS,
    })
  }

  /** Compare-and-set on the move count: a second request racing the same
   *  turn finds the row moved on and changes nothing. */
  const save = async (patch: Record<string, any>, expectDay: number): Promise<boolean> => {
    const { data } = await svc().from('xtalk_sessions')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', s.id).eq('day', expectDay).select('id')
    if (!data?.length) return false
    Object.assign(s, patch)
    return true
  }
  const reload = async () => {
    const { data } = await svc().from('xtalk_sessions').select('*').eq('id', s.id).maybeSingle()
    if (data) { Object.assign(s, data); pos = engine.position(s.pending?.moves ?? []) }
  }

  const applyMove = async (mv: Omit<Move, 'n' | 'side'>): Promise<boolean> => {
    const side = pos.turn
    const moves: string[] = [...(s.pending?.moves ?? []), mv.uci]
    const next = engine.position(moves)
    // A move cap ends a meandering game as a draw: 200 plies of AI moves is
    // real money.
    const end: XqEnd | null = next.end ?? (moves.length >= XIANGQI_HARNESS.plyCap ? { reason: 'cap', winner: 'draw' } : null)
    const entry: Move = { n: moves.length, side, ...mv }
    const cost = mv.cost ?? 0
    const ok = await save({
      pending: { ...s.pending, moves, end },
      transcript: [...(s.transcript ?? []), entry],
      day: moves.length, phase: next.turn,
      ...(end ? { status: 'over', winner: end.winner } : {}),
      cost_usd: Number(s.cost_usd) + cost,
    }, s.day)
    if (!ok) { await reload(); return false }
    pos = next
    if (cost > 0) {
      const carried = await accrueFraction(user.id, cost * 1e6)
      const cents = carried ?? Math.round(cost * 100)
      if (cents > 0) debitCredits({
        userId: user.id, amountCents: cents, referenceType: 'xgame_xiangqi',
        referenceId: s.id, description: 'XGame 象棋 move', metadata: { ply: moves.length },
      }).catch(err => {
        if (!(err instanceof InsufficientCreditsError)) console.warn(`${LOG} debit failed:`, err)
      })
    }
    return true
  }

  // ── human move ────────────────────────────────────────────────────────
  if (body.action === 'move') {
    if (!turn?.isHuman) return view()
    const uci = String(body.uci ?? '').toLowerCase()
    const i = pos.legalUci.indexOf(uci)
    if (i < 0) return Response.json({ error: 'illegal move' }, { status: 400 })
    // Think time = since the previous move was saved (when this turn began).
    const ms = Math.max(0, Date.now() - new Date(s.updated_at).getTime())
    await applyMove({ uci, wxf: pos.legalWxf[i], ms })
    return view()
  }

  // ── resign (the human seat only) ──────────────────────────────────────
  if (body.action === 'resign') {
    const me = players.findIndex(p => p.isHuman)
    if (me < 0 || s.status !== 'active') return view()
    const end: XqEnd = { reason: 'resign', winner: me === 0 ? 'black' : 'red' }
    if (!await save({ status: 'over', winner: end.winner, pending: { ...s.pending, end } }, s.day)) await reload()
    return view()
  }

  // ── step: one AI move ─────────────────────────────────────────────────
  if (body.action === 'step') {
    if (!turn || turn.isHuman) return view()
    const { data: wallet } = await svc().from('user_credits').select('balance_cents').eq('user_id', user.id).maybeSingle()
    if ((Number(wallet?.balance_cents) || 0) < 1) {
      return Response.json({ error: 'Out of credits: top up to keep the game going.', code: 'no_credits' }, { status: 402 })
    }
    const model = await getModelById(turn.modelId!)
    if (!model) {
      // The seated model was switched off mid-game: nobody can move for it.
      const end: XqEnd = { reason: 'resign', winner: turn.side === 'w' ? 'black' : 'red' }
      if (!await save({ status: 'over', winner: end.winner, pending: { ...s.pending, end } }, s.day)) await reload()
      return view()
    }
    const r = await playAiTurn(engine, pos, providerAsk(model, { userId: user.id, thinking: turn.thinking ?? null }))
    if (r.fallback) console.warn(`${LOG} ${model.display_name}: fallback ${r.uci} (rejected ${JSON.stringify(r.rejected ?? [])})`)
    await applyMove({
      uci: r.uci, wxf: r.wxf,
      ...(r.why ? { why: r.why } : {}),
      ...(r.fallback ? { fallback: true } : {}),
      ...(r.retried ? { retried: true } : {}),
      ...(r.rejected ? { rejected: r.rejected } : {}),
      ...(r.timedOut ? { timedOut: true } : {}),
      ...(r.cost ? { cost: r.cost } : {}),
      ms: r.ms,
    })
    return view()
  }

  if (body.action === 'state') return view()
  return Response.json({ error: 'unknown action' }, { status: 400 })
}
