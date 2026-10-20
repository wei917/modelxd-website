// app/api/xgame/chess/route.ts
// Chess for the XGame arena (Oct 19). The 五子棋 table's architecture, third
// tenant: the server holds the game, one act per request (create / state /
// move / step / resign), the client loops. Rows live in xtalk_sessions with
// game 'chess' (no migration: `game` has no CHECK, winner's was dropped in 72).
//
// The record is the list of UCI moves in pending.moves; every request
// rebuilds the position from it with lib/chess-engine.ts (ffish, GPL, server
// only), which is what makes threefold repetition exact and costs ~2 ms for
// 200 plies. An AI move is lib/chess-turn.ts: the same prompt, one retry and
// the same marked fallback for every model (CHESS_HARNESS, sent with the view
// so the table can publish it).
//
// Billing: each AI move is debited at list price as it is played
// (referenceType xgame_chess, sub-cent charges carried by accrueFraction).

export const runtime = 'nodejs'
// Two asks of up to 90 s each, plus the reads and the write.
export const maxDuration = 200

import { createClient } from '@supabase/supabase-js'
import { debitCredits, accrueFraction, InsufficientCreditsError } from '@/lib/credits'
import { chessEngine, type ChessEnd, type ChessEngine, type ChessPosition } from '@/lib/chess-engine'
import { playAiTurn, providerAsk, CHESS_HARNESS } from '@/lib/chess-turn'

const LOG = '[xgame:chess]'

const svc = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false } },
)

type Color = 'w' | 'b'
type Player = { color: Color; modelId: string | null; name: string; isHuman: boolean; thinking?: string | null }
type Move = {
  n: number; color: Color; san: string; uci: string
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

  let engine: ChessEngine
  try { engine = await chessEngine() } catch (e) {
    console.error(`${LOG} engine failed to load:`, e)
    return Response.json({ error: 'The chess engine is unavailable right now.' }, { status: 503 })
  }

  // ── create ────────────────────────────────────────────────────────────
  if (body.action === 'create') {
    const seats = body.seats ?? {}
    const mk = async (color: Color, cfg: any): Promise<Player | null> => {
      if (cfg?.human) return { color, modelId: null, name: String(body.playerName ?? '').slice(0, 40) || 'You', isHuman: true }
      const m = cfg?.modelId ? await getModelById(cfg.modelId) : null
      return m ? {
        color, modelId: m.id, name: m.display_name, isHuman: false,
        thinking: typeof cfg?.thinking === 'string' ? cfg.thinking : null,
      } : null
    }
    const white = await mk('w', seats.white), black = await mk('b', seats.black)
    if (!white || !black) return Response.json({ error: 'both seats need a model or a human' }, { status: 400 })
    if (white.isHuman && black.isHuman) return Response.json({ error: 'at most one human seat' }, { status: 400 })
    // The thinking level is part of a player's identity, as in 五子棋.
    const label = (p: Player) => `${p.name}${p.thinking ? ` (${p.thinking})` : ''}`
    const { data, error } = await svc().from('xtalk_sessions').insert({
      user_id: user.id, game: 'chess', status: 'active',
      human_seat: white.isHuman ? 0 : (black.isHuman ? 1 : null),
      players: [white, black], phase: 'w', day: 0, turn_order: [],
      transcript: [], pending: { moves: [], end: null, harness: CHESS_HARNESS.version },
      title: `${label(white)} vs ${label(black)}`,
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
  if (!row || row.user_id !== user.id || row.game !== 'chess') {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }
  const s = row as any
  const players: Player[] = s.players
  let pos: ChessPosition
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
      end: (s.pending?.end ?? null) as ChessEnd | null,
      fen: pos.fen, turn: tp ? tp.color : null, check: pos.check,
      // The human's legal moves (UCI) let the table highlight targets and
      // pick a promotion without any rules code in the browser.
      legal: tp?.isHuman ? pos.legalUci : [],
      moves: s.transcript as Move[],
      players: s.players,
      humanTurn: !!tp?.isHuman,
      costUsd: Number(s.cost_usd) || 0,
      harness: CHESS_HARNESS,
    })
  }

  /** Compare-and-set on the move count: a second request racing the same
   *  turn (a watchdog retry, two tabs) finds the row moved on and changes
   *  nothing, instead of playing a second move for the same side. */
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

  const applyMove = async (mv: Omit<Move, 'n' | 'color'>): Promise<boolean> => {
    const color = pos.turn
    const moves: string[] = [...(s.pending?.moves ?? []), mv.uci]
    const next = engine.position(moves)
    // A move cap ends a meandering game as a draw: 200 plies of AI moves is
    // real money, and two models that cannot mate would otherwise never stop.
    const end: ChessEnd | null = next.end ?? (moves.length >= CHESS_HARNESS.plyCap ? { reason: 'cap', winner: 'draw' } : null)
    const entry: Move = { n: moves.length, color, ...mv }
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
        userId: user.id, amountCents: cents, referenceType: 'xgame_chess',
        referenceId: s.id, description: 'XGame chess move', metadata: { ply: moves.length },
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
    if (!pos.legalUci.includes(uci)) return Response.json({ error: 'illegal move' }, { status: 400 })
    const san = pos.legalSan[pos.legalUci.indexOf(uci)]
    // Think time = since the previous move was saved (when this turn began).
    const ms = Math.max(0, Date.now() - new Date(s.updated_at).getTime())
    await applyMove({ uci, san, ms })
    return view()
  }

  // ── resign (the human seat only) ──────────────────────────────────────
  if (body.action === 'resign') {
    const me = players.findIndex(p => p.isHuman)
    if (me < 0 || s.status !== 'active') return view()
    const end: ChessEnd = { reason: 'resign', winner: me === 0 ? 'black' : 'white' }
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
      const end: ChessEnd = { reason: 'resign', winner: turn.color === 'w' ? 'black' : 'white' }
      if (!await save({ status: 'over', winner: end.winner, pending: { ...s.pending, end } }, s.day)) await reload()
      return view()
    }
    const r = await playAiTurn(engine, pos, providerAsk(model, { userId: user.id, thinking: turn.thinking ?? null }))
    if (r.fallback) console.warn(`${LOG} ${model.display_name}: fallback ${r.san} (rejected ${JSON.stringify(r.rejected ?? [])})`)
    await applyMove({
      uci: r.uci, san: r.san,
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
