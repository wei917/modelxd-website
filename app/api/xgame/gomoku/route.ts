// app/api/xgame/gomoku/route.ts
// Gomoku for the XGame arena (CC, Aug 6). Werewolf's architecture, second
// tenant: the server holds the game, one act per request, the client loops.
//
// HOW A MODEL TAKES A TURN — the design question answered concretely:
//   The ENTIRE state goes out on every ask (rules, the full 15x15 board as
//   text, the move list) because model calls are stateless and 225 cells is
//   ~300 tokens — re-describing beats trusting a model's memory of move 30.
//   The model replies {"move":"H8","why":"..."} and proposes ONLY; the
//   engine adjudicates. An illegal proposal gets ONE retry carrying the
//   engine's objection; a second failure or a timeout becomes a marked
//   fallback move (first empty cell adjacent to the last stone) — a weak
//   move beats a wedged game, and the badge keeps it honest on the board.

export const runtime = 'nodejs'
export const maxDuration = 120

import { createClient } from '@supabase/supabase-js'
import { assertFeature } from '@/lib/features'
import { debitCredits } from '@/lib/credits'
import * as providers from '@/lib/providers'
import {
  emptyBoard, place, winAt, isFull, parseCoord, coordName, boardText,
  fallbackMove, cellAt, type Board, type Stone,
} from '@/lib/gomoku-engine'

const LOG = '[xgame:gomoku]'

const svc = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false } },
)

type Player = { stone: Stone; modelId: string | null; name: string; isHuman: boolean }
type Move = { n: number; stone: Stone; coord: string; why?: string; fallback?: boolean; cost?: number }

async function getModelById(id: string) {
  const { data } = await svc().from('ai_models')
    .select('id, provider, model_name, display_name, modes, model_pricing, input_config, output_config')
    .eq('id', id).eq('enabled', true).maybeSingle()
  return data
}

const MODEL_TIMEOUT_MS = 60_000

/** One ask: full state out, a coordinate back. Never throws. */
async function askMove(model: any, stone: Stone, board: Board, moves: Move[], objection: string | null, userId: string) {
  const history = moves.map(m => `${m.n}. ${m.stone} ${m.coord}`).join('  ') || '(none — you open)'
  const prompt = [
    `You are playing gomoku (five in a row) on a 15x15 board as ${stone === 'B' ? 'B (black)' : 'W (white)'}.`,
    'Win by making 5 or more of your stones in a row: horizontal, vertical or diagonal. Columns are letters A-O, rows are numbers 1-15; a move is a letter+number like H8. You may only play on an EMPTY cell (shown as ".").',
    '', 'Board now:', boardText(board),
    '', `Moves so far: ${history}`,
    ...(objection ? ['', `Your previous answer was rejected: ${objection}`] : []),
    '', 'Reply with ONLY this JSON, nothing else: {"move":"H8","why":"one short sentence of intent"}',
  ].join('\n')

  let full = '', cost = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  await Promise.race([
    new Promise<void>(resolve => {
      providers.streamText(model, [{ role: 'user', content: prompt }], {
        onDelta: (t: string) => { full += t },
        onDone:  (r: any) => { cost += r.cost ?? 0; resolve() },
        onError: (m: string) => { console.warn(`${LOG} ${model.display_name}:`, m); resolve() },
      }, [], { userId, surface: 'xgame-gomoku' } as any).catch(() => resolve())
    }),
    new Promise<void>(resolve => { timer = setTimeout(() => { console.warn(`${LOG} timeout`); resolve() }, MODEL_TIMEOUT_MS) }),
  ])
  if (timer) clearTimeout(timer)

  let move: string | undefined, why: string | undefined
  try {
    const o = JSON.parse((/\{[\s\S]*\}/.exec(full) ?? ['{}'])[0])
    if (typeof o.move === 'string') move = o.move
    if (typeof o.why  === 'string') why  = o.why.slice(0, 200)
  } catch {
    const m = /["']move["']\s*:\s*["']([A-Oa-o]\s*\d{1,2})["']/.exec(full) ?? /\b([A-Oa-o]\d{1,2})\b/.exec(full)
    if (m) move = m[1]
  }
  return { move, why, cost }
}

export async function POST(req: Request) {
  const gate = await assertFeature('xtalk')
  if (gate) return gate
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return Response.json({ error: 'Bad JSON' }, { status: 400 }) }

  // ── create ────────────────────────────────────────────────────────────
  if (body.action === 'create') {
    const seats = body.seats ?? {}
    const mk = async (stone: Stone, cfg: any): Promise<Player | null> => {
      if (cfg?.human) return { stone, modelId: null, name: body.playerName?.slice(0, 40) || 'You', isHuman: true }
      const m = cfg?.modelId ? await getModelById(cfg.modelId) : null
      return m ? { stone, modelId: m.id, name: m.display_name, isHuman: false } : null
    }
    const black = await mk('B', seats.black), white = await mk('W', seats.white)
    if (!black || !white) return Response.json({ error: 'both seats need a model or a human' }, { status: 400 })
    if (black.isHuman && white.isHuman) return Response.json({ error: 'at most one human seat' }, { status: 400 })
    const { data, error } = await svc().from('xtalk_sessions').insert({
      user_id: user.id, game: 'gomoku', status: 'active',
      human_seat: black.isHuman ? 0 : (white.isHuman ? 1 : null),
      players: [black, white], phase: 'B', day: 0, turn_order: [],
      transcript: [], pending: { board: emptyBoard(), last: null },
      title: `${black.name} ⚫ vs ⚪ ${white.name}`,
    }).select('id').single()
    if (error || !data) {
      console.warn(`${LOG} create failed:`, error?.message)
      // The likeliest cause is migration 72 not applied (no `game` column).
      return Response.json({ error: 'Could not create the game — is migration 72 applied?' }, { status: 503 })
    }
    body.id = data.id; body.action = 'state'
  }

  // ── load + owner check ────────────────────────────────────────────────
  const { data: row } = await svc().from('xtalk_sessions')
    .select('*').eq('id', body.id).maybeSingle()
  if (!row || row.user_id !== user.id || row.game !== 'gomoku') {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }
  const s = row as any
  const board: Board = s.pending.board
  const moves: Move[] = s.transcript
  const players: Player[] = s.players
  const turn: Player | null = s.status === 'over' ? null : players[s.phase === 'B' ? 0 : 1]

  const view = () => Response.json({
    id: s.id, status: s.status, winner: s.winner ?? null, board, moves,
    players, turn: turn ? turn.stone : null, humanTurn: !!turn?.isHuman,
    winLine: s.pending.winLine ?? null, costUsd: Number(s.cost_usd) || 0,
  })

  const save = async (patch: Record<string, any>) => {
    Object.assign(s, patch)
    await svc().from('xtalk_sessions').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', s.id)
  }

  const applyMove = async (r: number, c: number, why: string | undefined, fallback: boolean, cost: number) => {
    const stone = turn!.stone
    const nextBoard = place(board, r, c, stone)
    const mv: Move = { n: s.day + 1, stone, coord: coordName(r, c), ...(why ? { why } : {}), ...(fallback ? { fallback: true } : {}), ...(cost ? { cost } : {}) }
    const line = winAt(nextBoard, r, c)
    const over = !!line || isFull(nextBoard)
    await save({
      pending: { board: nextBoard, last: [r, c], winLine: line ?? null },
      transcript: [...moves, mv], day: s.day + 1,
      phase: stone === 'B' ? 'W' : 'B',
      ...(over ? { status: 'over', winner: line ? (stone === 'B' ? 'black' : 'white') : 'draw' } : {}),
      cost_usd: Number(s.cost_usd) + cost,
    })
    if (cost > 0) {
      const cents = Math.round(cost * 100)
      if (cents > 0) debitCredits({
        userId: user.id, amountCents: cents, referenceType: 'xgame_gomoku',
        referenceId: s.id, description: 'XGame gomoku move', metadata: {},
      }).catch(() => {})
    }
  }

  // ── human move ────────────────────────────────────────────────────────
  if (body.action === 'move') {
    if (!turn?.isHuman) return view()
    const pc = parseCoord(String(body.coord ?? ''))
    if (!pc || cellAt(board, pc[0], pc[1]) !== '.') {
      return Response.json({ error: 'illegal move' }, { status: 400 })
    }
    await applyMove(pc[0], pc[1], undefined, false, 0)
    return view()
  }

  // ── step: one AI move ─────────────────────────────────────────────────
  if (body.action === 'step') {
    if (!turn || turn.isHuman) return view()
    const model = await getModelById(turn.modelId!)
    if (!model) { await save({ status: 'over', winner: 'draw' }); return view() }

    let totalCost = 0
    let placed: [number, number] | null = null
    let why: string | undefined, usedFallback = false
    let objection: string | null = null
    for (let attempt = 0; attempt < 2 && !placed; attempt++) {
      const r = await askMove(model, turn.stone, board, moves, objection, user.id)
      totalCost += r.cost
      why = r.why ?? why
      const pc = r.move ? parseCoord(r.move) : null
      if (pc && cellAt(board, pc[0], pc[1]) === '.') placed = pc
      else objection = r.move
        ? `"${r.move}" is ${parseCoord(r.move) ? 'already occupied' : 'not a valid coordinate'}. Pick an EMPTY cell shown as "." on the board.`
        : 'no move could be read from your reply. Reply with ONLY the JSON.'
    }
    if (!placed) {
      placed = fallbackMove(board, s.pending.last)
      usedFallback = true
      console.warn(`${LOG} ${model.display_name}: fallback move ${coordName(placed[0], placed[1])}`)
    }
    await applyMove(placed[0], placed[1], why, usedFallback, totalCost)
    return view()
  }

  if (body.action === 'state') return view()
  return Response.json({ error: 'unknown action' }, { status: 400 })
}
