// app/api/xgame/gomoku/route.ts
// 五子棋 for the XGame arena. Werewolf's architecture, second tenant (Aug 6):
// the server holds the game, one act per request, the client loops.
//
// Rebuilt Oct 20 (owner: "go ahead on this plan"), on chess's pattern:
//   • A table is a MATCH of two games with the colours swapped
//     (lib/gomoku-turn.ts): free-style 五子棋 favours Black. Between the
//     games the row waits (`match.between`); 'next' starts game 2.
//   • Every AI move goes through playAiTurn(): a short prompt, a strict
//     reply schema, 90 s, one retry, a marked fallback (GOMOKU_HARNESS,
//     published on the table).
//   • Saves are compare-and-set on the ply count, so a watchdog retry or a
//     second tab can never play two moves for one side.
//   • Billing as chess: the wallet is checked before an AI move, each move
//     is debited at list price, sub-cent charges carried by accrueFraction.
//
// Rows from before the rebuild (no `pending.match`) still open and finish as
// the single game they were, and blind-duel rows keep their masking, thumbs
// and reveal. XDuel stopped starting blind 五子棋 duels in its redesign; the
// 'create' with `duel: true` is kept so nothing that still sends it breaks.

export const runtime = 'nodejs'
export const maxDuration = 200

import { createClient } from '@supabase/supabase-js'
import { debitCredits, accrueFraction, InsufficientCreditsError } from '@/lib/credits'
import { seatThinking } from '@/lib/game-thinking'
import {
  emptyBoard, place, winAt, isFull, parseCoord, coordName, cellAt,
  type Board, type Stone,
} from '@/lib/gomoku-engine'
import {
  GOMOKU_HARNESS, playAiTurn, providerAsk, blackSeat, matchScore, matchWinner,
  type GameResult, type MatchState, type PromptMove,
} from '@/lib/gomoku-turn'

const LOG = '[xgame:gomoku]'

const svc = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false } },
)

type Player = { stone: Stone; modelId: string | null; name: string; isHuman: boolean; thinking?: string | null }
type Move = {
  n: number; stone: Stone; coord: string
  /** The match game this move belongs to (rows from Oct 20 on). */
  g?: 1 | 2
  why?: string; fallback?: boolean; retried?: boolean; rejected?: string[]; timedOut?: boolean
  cost?: number; ms?: number
}

async function getModelById(id: string) {
  const { data } = await svc().from('ai_models')
    .select('id, provider, model_name, display_name, modes, model_pricing, input_config, output_config')
    .eq('id', id).eq('enabled', true).maybeSingle()
  return data
}

// Blind game duels are on the house (no per-move debit), so cap them.
// Enforced by counting today's duel rows — a soft floor that needs no
// quota-table migration; the duel_quotas columns are per-prompt-mode.
const GAME_DUELS_PER_DAY = 3
// A duel that meanders past this many moves is adjudicated a draw —
// unbounded AI-vs-AI games are unbounded house spend.
const DUEL_MOVE_CAP = 60

export async function POST(req: Request) {
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
      // catalog. text_output is a number or { default, by_level }.
      const outPrice = (m: any) => {
        const o = m.model_pricing?.tokens?.text_output
        return typeof o === 'number' ? o : typeof o?.default === 'number' ? o.default : null
      }
      const eligible = (pool ?? []).filter((m: any) => !(m.blocked_features ?? []).includes('xduel'))
      const cheap = eligible.filter((m: any) => { const p = outPrice(m); return p != null && p > 0 && p <= 8 })
      const from = (cheap.length >= 2 ? cheap : eligible).sort(() => Math.random() - 0.5)
      // Duel seats get a modest thinking level when the model has one:
      // cheap models with thinking OFF play blind-drunk gomoku (Aug 6).
      const pickThinking = (m: any): string | null => {
        const lv = m.output_config?.text?.thinking_levels
        if (!Array.isArray(lv) || lv.length === 0) return null
        return lv.includes('low') ? 'low' : lv[0]
      }
      const play = body.play === true
      if (from.length < (play ? 1 : 2)) return Response.json({ error: 'Not enough models available for a blind match' }, { status: 503 })
      if (play) {
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
        if (cfg?.human) return { stone, modelId: null, name: String(body.playerName ?? '').slice(0, 40) || 'You', isHuman: true }
        const m = cfg?.modelId ? await getModelById(cfg.modelId) : null
        return m ? {
          stone, modelId: m.id, name: m.display_name, isHuman: false,
          thinking: seatThinking(m, cfg?.thinking),
        } : null
      }
      // Seat 0 plays Black in game 1, seat 1 in game 2.
      black = await mk('B', seats.black); white = await mk('W', seats.white)
      if (!black || !white) return Response.json({ error: 'both seats need a model or a human' }, { status: 400 })
      if (black.isHuman && white.isHuman) return Response.json({ error: 'at most one human seat' }, { status: 400 })
      // The thinking level is part of a player's identity: "Terra (high)"
      // and "Terra (low)" are different opponents.
      const label = (p: Player) => `${p.name}${p.thinking ? ` (${p.thinking})` : ''}`
      title = `${label(black)} vs ${label(white)}`
    }
    const match: MatchState | null = isDuelGame ? null : { game: 1, games: [], between: false }
    const { data, error } = await svc().from('xtalk_sessions').insert({
      user_id: user.id, game: 'gomoku', status: 'active',
      human_seat: black.isHuman ? 0 : (white.isHuman ? 1 : null),
      players: [black, white], phase: 'B', day: 0, turn_order: [],
      transcript: [],
      pending: {
        board: emptyBoard(), last: null,
        ...(isDuelGame ? { duel: { anon: true } } : {}),
        ...(match ? { match, harness: GOMOKU_HARNESS.version } : {}),
      },
      title,
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
  if (!row || row.user_id !== user.id || row.game !== 'gomoku') {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }
  const s = row as any

  const matchOf = (): MatchState | null => s.pending?.match ?? null
  /** Whose move it is, or null when the game (or the gap between games) has nobody to move. */
  const turnOf = (): Player | null => {
    if (s.status === 'over' || matchOf()?.between) return null
    return (s.players as Player[]).find(p => p.stone === s.phase) ?? null
  }

  // view() reads `s` LIVE: after an action, the response shows it. Blind
  // duels mask here, server-side: names, per-move cost and the total never
  // leave the server while the duel is anonymous.
  const view = () => {
    const d = s.pending.duel ?? null
    const anon = !!d && !d.revealed
    const pl: Player[] = s.players
    const tp = turnOf()
    const m = matchOf()
    return Response.json({
      id: s.id, status: s.status, winner: s.winner ?? null,
      board: s.pending.board,
      moves: anon ? (s.transcript as Move[]).map(mv => { const r: any = { ...mv }; delete r.cost; return r }) : s.transcript,
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
      match: m ? { ...m, score: matchScore(m.games) } : null,
      harness: m ? GOMOKU_HARNESS : null,
    })
  }

  /** Compare-and-set on the ply count: a second request racing the same
   *  turn finds the row moved on and changes nothing. `between` guards the
   *  step from game 1 to game 2 the same way. */
  const save = async (patch: Record<string, any>, expect: { day: number; between?: boolean }): Promise<boolean> => {
    let q = svc().from('xtalk_sessions')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', s.id).eq('day', expect.day)
    if (expect.between !== undefined) q = q.filter('pending->match->>between', 'eq', String(expect.between))
    const { data } = await q.select('id')
    if (!data?.length) return false
    Object.assign(s, patch)
    return true
  }
  const reload = async () => {
    const { data } = await svc().from('xtalk_sessions').select('*').eq('id', s.id).maybeSingle()
    if (data) Object.assign(s, data)
  }

  /** The moves of the game being played, for the prompt and the move number. */
  const gameMoves = (): Move[] => {
    const m = matchOf()
    const all: Move[] = s.transcript ?? []
    return m ? all.filter(mv => (mv.g ?? 1) === m.game) : all
  }

  const applyMove = async (r: number, c: number, extra: Omit<Move, 'n' | 'stone' | 'coord' | 'g'>): Promise<boolean> => {
    const turn = turnOf()
    if (!turn) return false
    const stone = turn.stone
    const m = matchOf()
    const isDuel = !!s.pending.duel
    const board: Board = s.pending.board
    const nextBoard = place(board, r, c, stone)
    const inGame = gameMoves().length + 1
    const mv: Move = { n: inGame, stone, coord: coordName(r, c), ...(m ? { g: m.game } : {}), ...extra }
    const line = winAt(nextBoard, r, c)
    const full = isFull(nextBoard)
    const cap = m ? inGame >= GOMOKU_HARNESS.plyCap : (isDuel && s.day + 1 >= DUEL_MOVE_CAP)
    const gameOver = !!line || full || cap
    const cost = extra.cost ?? 0
    const pending: any = { ...s.pending, board: nextBoard, last: [r, c], winLine: line ?? null }
    const patch: Record<string, any> = {
      transcript: [...(s.transcript ?? []), mv], day: s.day + 1,
      phase: stone === 'B' ? 'W' : 'B',
      cost_usd: Number(s.cost_usd) + cost,
    }
    if (gameOver && m) {
      const players: Player[] = s.players
      const res: GameResult = {
        winner: line ? (players.findIndex(p => p.stone === stone) as 0 | 1) : null,
        black: blackSeat(m.game), plies: inGame,
        reason: line ? 'five' : full ? 'full' : 'cap',
      }
      const games = [...m.games, res]
      const done = games.length >= GOMOKU_HARNESS.games
      pending.match = { ...m, games, between: !done }
      if (done) { patch.status = 'over'; patch.winner = matchWinner(games) }
    } else if (gameOver) {
      // A row from before the match format: one game, as it always was.
      patch.status = 'over'
      patch.winner = line ? (stone === 'B' ? 'black' : 'white') : 'draw'
      if (isDuel) {
        // The reveal is the ENDGAME, not a button (owner, Aug 6).
        pending.duel = { ...s.pending.duel, revealed: true }
        const pl: Player[] = s.players
        patch.title = `${pl[0].name} ⚫ vs ⚪ ${pl[1].name}`
      }
    }
    patch.pending = pending
    const ok = await save(patch, { day: s.day })
    if (!ok) { await reload(); return false }
    // Blind duels are on the house: cost_usd still accumulates (shown at the
    // reveal) but the wallet is never touched.
    if (cost > 0 && !isDuel) {
      const carried = await accrueFraction(user.id, cost * 1e6)
      const cents = carried ?? Math.round(cost * 100)
      if (cents > 0) debitCredits({
        userId: user.id, amountCents: cents, referenceType: 'xgame_gomoku',
        referenceId: s.id, description: 'XGame gomoku move', metadata: { ply: s.day },
      }).catch(err => {
        if (!(err instanceof InsufficientCreditsError)) console.warn(`${LOG} debit failed:`, err)
      })
    }
    return true
  }

  // ── human move ────────────────────────────────────────────────────────
  if (body.action === 'move') {
    const turn = turnOf()
    if (!turn?.isHuman) return view()
    const pc = parseCoord(String(body.coord ?? ''))
    if (!pc || cellAt(s.pending.board, pc[0], pc[1]) !== '.') {
      return Response.json({ error: 'illegal move' }, { status: 400 })
    }
    // Think time = since the previous move was saved (when this turn began).
    const ms = Math.max(0, Date.now() - new Date(s.updated_at).getTime())
    await applyMove(pc[0], pc[1], { ms })
    return view()
  }

  // ── next: game 2 of the match, colours swapped ────────────────────────
  if (body.action === 'next') {
    const m = matchOf()
    if (!m || !m.between || s.status !== 'active') return view()
    const players = (s.players as Player[]).map(p => ({ ...p, stone: (p.stone === 'B' ? 'W' : 'B') as Stone }))
    const ok = await save({
      players, phase: 'B',
      pending: { ...s.pending, board: emptyBoard(), last: null, winLine: null, match: { ...m, game: 2, between: false } },
    }, { day: s.day, between: true })
    if (!ok) await reload()
    return view()
  }

  // ── step: one AI move ─────────────────────────────────────────────────
  if (body.action === 'step') {
    const turn = turnOf()
    if (!turn || turn.isHuman) return view()
    if (!s.pending.duel) {
      const { data: wallet } = await svc().from('user_credits').select('balance_cents').eq('user_id', user.id).maybeSingle()
      if ((Number(wallet?.balance_cents) || 0) < 1) {
        return Response.json({ error: 'Out of credits: top up to keep the game going.', code: 'no_credits' }, { status: 402 })
      }
    }
    const model = await getModelById(turn.modelId!)
    if (!model) {
      // The seated model was switched off mid-game: nobody can move for it.
      if (!await save({ status: 'over', winner: 'draw' }, { day: s.day })) await reload()
      return view()
    }
    const record: PromptMove[] = gameMoves().map(mv => ({ stone: mv.stone, coord: mv.coord }))
    const r = await playAiTurn(s.pending.board, turn.stone, record, s.pending.last ?? null,
      providerAsk(model, { userId: user.id, thinking: turn.thinking ?? null }))
    if (r.fallback) console.warn(`${LOG} ${model.display_name}: fallback ${r.coord} (rejected ${JSON.stringify(r.rejected ?? [])})`)
    await applyMove(r.at[0], r.at[1], {
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

  // ── duel: thumbs + the reveal ─────────────────────────────────────────
  // The arc of a blind duel: the engine decides, you judge the play, THEN
  // the unmasking. Both act only on finished duel games.
  if (body.action === 'duel_thumb') {
    const d = s.pending.duel
    if (!d || s.status !== 'over') return view()
    const seat = body.seat === 1 ? 1 : 0
    const up = body.up === true ? true : body.up === false ? false : null
    const thumbs = { ...(d.thumbs ?? {}) }
    // `blind` records whether the judgment was made before the unmasking.
    if (up === null) delete thumbs[seat]
    else thumbs[seat] = { up, blind: !d.revealed }
    if (!await save({ pending: { ...s.pending, duel: { ...d, thumbs } } }, { day: s.day })) await reload()
    return view()
  }
  if (body.action === 'duel_reveal') {
    const d = s.pending.duel
    if (!d || s.status !== 'over') return view()
    if (!d.revealed) {
      const pl: Player[] = s.players
      if (!await save({
        pending: { ...s.pending, duel: { ...d, revealed: true } },
        // The nav-history row gets the real matchup once it's public.
        title: `${pl[0].name} ⚫ vs ⚪ ${pl[1].name}`,
      }, { day: s.day })) await reload()
    }
    return view()
  }

  if (body.action === 'state') return view()
  return Response.json({ error: 'unknown action' }, { status: 400 })
}
