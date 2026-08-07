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

type Player = { stone: Stone; modelId: string | null; name: string; isHuman: boolean; thinking?: string | null }
type Move = { n: number; stone: Stone; coord: string; why?: string; fallback?: boolean; cost?: number; ms?: number }

async function getModelById(id: string) {
  const { data } = await svc().from('ai_models')
    .select('id, provider, model_name, display_name, modes, model_pricing, input_config, output_config')
    .eq('id', id).eq('enabled', true).maybeSingle()
  return data
}

const MODEL_TIMEOUT_MS = 60_000

// Blind game duels are on the house (no per-move debit), so cap them.
// Enforced by counting today's duel rows — a soft floor that needs no
// quota-table migration; the duel_quotas columns are per-prompt-mode.
const GAME_DUELS_PER_DAY = 3
// A duel that meanders past this many moves is adjudicated a draw —
// unbounded AI-vs-AI games are unbounded house spend.
const DUEL_MOVE_CAP = 60

/** One ask: full state out, a coordinate back. Never throws. */
async function askMove(model: any, stone: Stone, board: Board, moves: Move[], objection: string | null, userId: string, thinking: string | null) {
  const history = moves.map(m => `${m.n}. ${m.stone} ${m.coord}`).join('  ') || '(none — you open)'
  const prompt = [
    `You are playing gomoku (five in a row) on a 15x15 board as ${stone === 'B' ? 'B (black)' : 'W (white)'}.`,
    'Win by making 5 or more of your stones in a row: horizontal, vertical or diagonal. Columns are letters A-O, rows are numbers 1-15; a move is a letter+number like H8. You may only play on an EMPTY cell (shown as ".").',
    '',
    'Check IN THIS ORDER before answering:',
    '1. Can you complete 5 in a row right now? Play that cell and win.',
    "2. Can the opponent complete 5 on their next move (they have four in a line with an empty cell — including split patterns like XX.XX or XXX.X)? You MUST block that cell.",
    '3. Does the opponent have an open three (three in a row with BOTH ends empty)? Block one end now — next turn it becomes an unstoppable four.',
    '4. Otherwise extend your own strongest line, prefer moves that create TWO threats at once, and stay near the action.',
    'Scan all four directions (row, column, both diagonals) around the last few moves — diagonal threats are the ones most often missed.',
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
      }, [], { userId, surface: 'xgame-gomoku' } as any, { thinking, search: false }).catch(() => resolve())
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
    let black: Player | null = null, white: Player | null = null
    let title = ''
    let isDuelGame = false
    if (body.duel === true) {
      // GAME DUEL (owner, Aug 6): the HOUSE seats two anonymous models —
      // the client sends no seats, so the matchup can't be steered. The
      // masking lives in view(): the client never receives the names.
      isDuelGame = true
      const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0)
      const { count } = await svc().from('xtalk_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id).eq('game', 'gomoku')
        .gte('created_at', dayStart.toISOString())
        .not('pending->duel', 'is', null)
      if ((count ?? 0) >= GAME_DUELS_PER_DAY) {
        return Response.json({ error: 'No free blind matches left today — come back tomorrow.' }, { status: 429 })
      }
      const { data: pool } = await svc().from('ai_models')
        .select('id, display_name, model_pricing, blocked_features, output_config')
        .eq('enabled', true).contains('output_modalities', ['text'])
      // Same block key as prompt duels, then prefer the cheap end of the
      // catalog — 40 moves on a frontier model is real house money. Fall
      // back to the full pool only if the cheap one can't seat a pair.
      // text_output is a number or { default, by_level } (see admin rows).
      const outPrice = (m: any) => {
        const o = m.model_pricing?.tokens?.text_output
        return typeof o === 'number' ? o : typeof o?.default === 'number' ? o.default : null
      }
      const eligible = (pool ?? []).filter((m: any) => !(m.blocked_features ?? []).includes('xduel'))
      const cheap = eligible.filter((m: any) => { const p = outPrice(m); return p != null && p > 0 && p <= 8 })
      const from = (cheap.length >= 2 ? cheap : eligible).sort(() => Math.random() - 0.5)
      // Duel seats get a modest thinking level when the model has one:
      // cheap models with thinking OFF play blind-drunk gomoku (verified
      // on a live game — it "blocked" a four at the wrong cell), and the
      // house is paying pennies either way. Lowest declared level wins.
      const pickThinking = (m: any): string | null => {
        const lv = m.output_config?.text?.thinking_levels
        if (!Array.isArray(lv) || lv.length === 0) return null
        return lv.includes('low') ? 'low' : lv[0]
      }
      const play = body.play === true
      if (from.length < (play ? 1 : 2)) return Response.json({ error: 'Not enough models available for a blind match' }, { status: 503 })
      if (play) {
        // PLAY mode (owner, Aug 6): the user sits down against ONE mystery
        // model — random color, so models get judged from both sides of
        // the board. The reveal is the payoff either way: "you just beat
        // GPT-5.6 Luna" or "you lost to a $0.03 model".
        const humanStone: Stone = Math.random() < 0.5 ? 'B' : 'W'
        const human: Player = { stone: humanStone, modelId: null, name: 'You', isHuman: true }
        const rival: Player = { stone: humanStone === 'B' ? 'W' : 'B', modelId: from[0].id, name: from[0].display_name, isHuman: false, thinking: pickThinking(from[0]) }
        black = humanStone === 'B' ? human : rival
        white = humanStone === 'B' ? rival : human
      } else {
        black = { stone: 'B', modelId: from[0].id, name: from[0].display_name, isHuman: false, thinking: pickThinking(from[0]) }
        white = { stone: 'W', modelId: from[1].id, name: from[1].display_name, isHuman: false, thinking: pickThinking(from[1]) }
      }
      title = 'Gomoku — blind duel'
    } else {
      const seats = body.seats ?? {}
      const mk = async (stone: Stone, cfg: any): Promise<Player | null> => {
        if (cfg?.human) return { stone, modelId: null, name: body.playerName?.slice(0, 40) || 'You', isHuman: true }
        const m = cfg?.modelId ? await getModelById(cfg.modelId) : null
        return m ? {
          stone, modelId: m.id, name: m.display_name, isHuman: false,
          thinking: typeof cfg?.thinking === 'string' ? cfg.thinking : null,
        } : null
      }
      black = await mk('B', seats.black); white = await mk('W', seats.white)
      if (!black || !white) return Response.json({ error: 'both seats need a model or a human' }, { status: 400 })
      if (black.isHuman && white.isHuman) return Response.json({ error: 'at most one human seat' }, { status: 400 })
      // The thinking level is part of a player's identity — it changes the
      // player. "Terra (high)" and "Terra (low)" are different opponents.
      title = `${black.name}${black.thinking ? ` (${black.thinking})` : ''} ⚫ vs ⚪ ${white.name}${white.thinking ? ` (${white.thinking})` : ''}`
    }
    const { data, error } = await svc().from('xtalk_sessions').insert({
      user_id: user.id, game: 'gomoku', status: 'active',
      human_seat: black.isHuman ? 0 : (white.isHuman ? 1 : null),
      players: [black, white], phase: 'B', day: 0, turn_order: [],
      transcript: [], pending: { board: emptyBoard(), last: null, ...(isDuelGame ? { duel: { anon: true } } : {}) },
      title,
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

  // view() reads from `s` LIVE, not from the load-time consts — after an
  // applyMove/save the response must show the move it just applied. (The
  // load-time consts above are the pre-action state, which is exactly what
  // the action handlers should reason about.)
  // Blind duels mask here, server-side: names, per-move cost and the total
  // never leave the server while the duel is anonymous — a client can't
  // leak what it never received.
  const view = () => {
    const d = s.pending.duel ?? null
    const anon = !!d && !d.revealed
    const pl: Player[] = s.players
    const tp: Player | null = s.status === 'over' ? null : pl[s.phase === 'B' ? 0 : 1]
    return Response.json({
      id: s.id, status: s.status, winner: s.winner ?? null,
      board: s.pending.board,
      moves: anon ? (s.transcript as Move[]).map(m => { const r: any = { ...m }; delete r.cost; return r }) : s.transcript,
      // Play mode masks only the AI seat (the human knows who they are);
      // watch mode masks both, A/B by stone so the banner stays unambiguous.
      players: anon ? pl.map((p, i) => p.isHuman
        ? { stone: p.stone, name: p.name, isHuman: true }
        : { stone: p.stone, name: pl.some(q => q.isHuman) ? 'Mystery model' : (i === 0 ? 'Player A' : 'Player B'), isHuman: false })
        : pl,
      turn: tp ? tp.stone : null, humanTurn: !!tp?.isHuman,
      winLine: s.pending.winLine ?? null,
      costUsd: anon ? null : Number(s.cost_usd) || 0,
      duel: d ? { anon, revealed: !!d.revealed, thumbs: d.thumbs ?? {} } : null,
    })
  }

  const save = async (patch: Record<string, any>) => {
    Object.assign(s, patch)
    await svc().from('xtalk_sessions').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', s.id)
  }

  const applyMove = async (r: number, c: number, why: string | undefined, fallback: boolean, cost: number, ms?: number) => {
    const stone = turn!.stone
    const isDuel = !!s.pending.duel
    const nextBoard = place(board, r, c, stone)
    const mv: Move = { n: s.day + 1, stone, coord: coordName(r, c), ...(why ? { why } : {}), ...(fallback ? { fallback: true } : {}), ...(cost ? { cost } : {}), ...(ms != null ? { ms: Math.max(0, Math.round(ms)) } : {}) }
    const line = winAt(nextBoard, r, c)
    const over = !!line || isFull(nextBoard) || (isDuel && s.day + 1 >= DUEL_MOVE_CAP)
    await save({
      // Spread the old pending: the duel marker (and anything future) must
      // survive every move, not just the board fields.
      pending: {
        ...s.pending, board: nextBoard, last: [r, c], winLine: line ?? null,
        // The reveal is the ENDGAME, not a button (owner, Aug 6): the
        // moment the engine calls it, identities and prices unmask.
        ...(over && isDuel ? { duel: { ...s.pending.duel, revealed: true } } : {}),
      },
      transcript: [...moves, mv], day: s.day + 1,
      phase: stone === 'B' ? 'W' : 'B',
      ...(over ? { status: 'over', winner: line ? (stone === 'B' ? 'black' : 'white') : 'draw' } : {}),
      ...(over && isDuel ? { title: `${players[0].name} ⚫ vs ⚪ ${players[1].name}` } : {}),
      cost_usd: Number(s.cost_usd) + cost,
    })
    // Blind duels are on the house — cost_usd still accumulates (it's
    // shown at the reveal), but the user's wallet is never touched.
    if (cost > 0 && !isDuel) {
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
    // Think time = since the previous move was saved (that save is the
    // moment this player's turn began). Good to within network jitter.
    const humanMs = Date.now() - new Date(s.updated_at).getTime()
    await applyMove(pc[0], pc[1], undefined, false, 0, humanMs)
    return view()
  }

  // ── step: one AI move ─────────────────────────────────────────────────
  if (body.action === 'step') {
    if (!turn || turn.isHuman) return view()
    const model = await getModelById(turn.modelId!)
    if (!model) { await save({ status: 'over', winner: 'draw' }); return view() }

    const t0 = Date.now()
    let totalCost = 0
    let placed: [number, number] | null = null
    let why: string | undefined, usedFallback = false
    let objection: string | null = null
    for (let attempt = 0; attempt < 2 && !placed; attempt++) {
      const r = await askMove(model, turn.stone, board, moves, objection, user.id, turn.thinking ?? null)
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
    await applyMove(placed[0], placed[1], why, usedFallback, totalCost, Date.now() - t0)
    return view()
  }

  // ── duel: thumbs + the reveal ─────────────────────────────────────────
  // The arc of a blind duel: the engine decides, you judge the play, THEN
  // the unmasking. Both act only on finished duel games.
  if (body.action === 'duel_thumb') {
    const d = s.pending.duel
    if (!d || s.status !== 'over') return view()
    const seat = body.seat === 1 ? 1 : 0
    const up = body.up === true ? true : body.up === false ? false : null
    const thumbs = { ...(d.thumbs ?? {}) }
    // `blind` records whether the judgment was made before the unmasking —
    // a pre-reveal thumb is a cleaner signal and the flag keeps them apart.
    if (up === null) delete thumbs[seat]
    else thumbs[seat] = { up, blind: !d.revealed }
    await save({ pending: { ...s.pending, duel: { ...d, thumbs } } })
    return view()
  }
  if (body.action === 'duel_reveal') {
    const d = s.pending.duel
    if (!d || s.status !== 'over') return view()
    if (!d.revealed) {
      await save({
        pending: { ...s.pending, duel: { ...d, revealed: true } },
        // The nav-history row gets the real matchup once it's public.
        title: `${players[0].name} ⚫ vs ⚪ ${players[1].name}`,
      })
    }
    return view()
  }

  if (body.action === 'state') return view()
  return Response.json({ error: 'unknown action' }, { status: 400 })
}
