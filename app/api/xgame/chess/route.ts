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
//
// Two people (Oct 21, docs/XGAME-MULTIPLAYER-PLAN.md step 1): the host takes
// one seat and invites a friend to the other (`create` with { invite: true });
// the table waits in pending.lobby with a link token until someone opens the
// link and sits down (`join`, lib/xgame-duo.ts). Then each person moves only
// for their own seat, both play on Fischer clocks (pending.clock,
// lib/xgame-clock.ts: 10 min + 5 s, a side out of time loses on the next
// request), and every save pings the table's Realtime channel so the other
// page refreshes. No model sits at such a table, so nothing is charged.

export const runtime = 'nodejs'
// Two asks of up to 90 s each, plus the reads and the write.
export const maxDuration = 200

import { createClient } from '@supabase/supabase-js'
import { debitCredits, accrueFraction, InsufficientCreditsError } from '@/lib/credits'
import { chessEngine, type ChessEnd, type ChessEngine, type ChessPosition } from '@/lib/chess-engine'
import { playAiTurn, providerAsk, CHESS_HARNESS } from '@/lib/chess-turn'
import { seatLevel } from '@/lib/xgame-speed'
import { afterMove, flagged, newClock, startClock, type Clock } from '@/lib/xgame-clock'
import {
  claimSeat, faceOf, isDuo, newToken, pingTable, publicSeats, releaseSeat, seatOf, tokenOk, type Lobby,
} from '@/lib/xgame-duo'

const LOG = '[xgame:chess]'

const svc = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false } },
)

type Color = 'w' | 'b'
type Player = {
  color: Color; modelId: string | null; name: string; isHuman: boolean; thinking?: string | null
  // A person's seat (lib/xgame-duo.ts DuoSeat).
  userId?: string | null; handle?: string | null; avatar?: string | null; invited?: boolean
}
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
    // A friend by link: the other seat must be the host's own.
    const invite = seats.white?.invite ? 0 : seats.black?.invite ? 1 : -1
    if (invite >= 0 && !(invite === 0 ? seats.black : seats.white)?.human) {
      return Response.json({ error: 'Take the other seat yourself to invite a friend.' }, { status: 400 })
    }
    const face = invite >= 0 ? await faceOf(user) : null
    // Only the models, and thinking levels, that passed this table's speed
    // test may sit (lib/xgame-speed.ts); the picker offers no others.
    let refused: string | null = null
    const mk = async (color: Color, cfg: any): Promise<Player | null> => {
      if (cfg?.invite) return { color, modelId: null, name: '', isHuman: true, invited: true, userId: null }
      if (cfg?.human) {
        return face
          ? { color, modelId: null, name: face.name, handle: face.handle, avatar: face.avatar, isHuman: true, userId: user.id }
          : { color, modelId: null, name: String(body.playerName ?? '').slice(0, 40) || 'You', isHuman: true, userId: user.id }
      }
      const m = cfg?.modelId ? await getModelById(cfg.modelId) : null
      const lv = m ? seatLevel('chess', m, cfg?.thinking) : null
      if (m && lv && !lv.ok) { refused = `${m.display_name}: ${lv.reason}`; return null }
      return m && lv?.ok ? {
        color, modelId: m.id, name: m.display_name, isHuman: false,
        thinking: lv.level,
      } : null
    }
    const white = await mk('w', seats.white), black = await mk('b', seats.black)
    if (refused) return Response.json({ error: refused }, { status: 400 })
    if (!white || !black) return Response.json({ error: 'both seats need a model or a human' }, { status: 400 })
    if (invite < 0 && white.isHuman && black.isHuman) return Response.json({ error: 'at most one human seat' }, { status: 400 })
    // The thinking level is part of a player's identity, as in 五子棋.
    const label = (p: Player) => p.invited ? '…' : `${p.name}${p.thinking ? ` (${p.thinking})` : ''}`
    const hostSeat = invite >= 0 ? 1 - invite : (white.isHuman ? 0 : (black.isHuman ? 1 : null))
    const { data, error } = await svc().from('xtalk_sessions').insert({
      user_id: user.id, game: 'chess', status: 'active',
      human_seat: hostSeat,
      players: [white, black], phase: 'w', day: 0, turn_order: [],
      transcript: [],
      pending: {
        moves: [], end: null, harness: CHESS_HARNESS.version,
        ...(invite >= 0 ? { lobby: { token: newToken(), open: [invite] } satisfies Lobby, clock: newClock('chess') } : {}),
      },
      title: `${label(white)} vs ${label(black)}`,
    }).select('id').single()
    if (error || !data) {
      console.warn(`${LOG} create failed:`, error?.message)
      return Response.json({ error: 'Could not create the game.' }, { status: 503 })
    }
    if (invite >= 0 && await claimSeat(data.id, user.id, hostSeat!) !== 'ok') {
      console.warn(`${LOG} ${data.id}: the host's seat was not recorded`)
    }
    body.id = data.id; body.action = 'state'
  }

  // ── load + who is asking ──────────────────────────────────────────────
  const { data: row } = await svc().from('xtalk_sessions')
    .select('*').eq('id', body.id).maybeSingle()
  if (!row || row.game !== 'chess') return Response.json({ error: 'Not found' }, { status: 404 })
  const s = row as any
  let players: Player[] = s.players
  const isHost = s.user_id === user.id
  let me = seatOf(s, user.id)
  const lobby = (): Lobby | null => s.pending?.lobby ?? null
  // Someone holding the table's link may look while a seat is open.
  const linkOk = () => !!lobby()?.open.length && tokenOk(lobby(), body.join)
  if (!isHost && me < 0 && !linkOk()) return Response.json({ error: 'Not found' }, { status: 404 })
  const duo = isDuo(players)

  let pos: ChessPosition
  try { pos = engine.position(s.pending?.moves ?? []) } catch (e) {
    console.error(`${LOG} ${s.id}: the record does not replay:`, e)
    return Response.json({ error: 'This game record is damaged.' }, { status: 500 })
  }
  const toMove = (): 0 | 1 | null => s.status === 'over' ? null : (pos.turn === 'w' ? 0 : 1)
  const turnOf = (): Player | null => { const i = toMove(); return i == null ? null : players[i] }
  // Your move: your seat is the side to move, and the game has begun.
  const myTurn = () => me >= 0 && toMove() === me && !lobby()

  // view() reads `s` and `pos` LIVE: after a move, the response shows it.
  const view = () => {
    const tp = turnOf(), lb = lobby()
    return Response.json({
      id: s.id, status: s.status, winner: s.winner ?? null,
      end: (s.pending?.end ?? null) as ChessEnd | null,
      fen: pos.fen, turn: tp ? tp.color : null, check: pos.check,
      // The human's legal moves (UCI) let the table highlight targets and
      // pick a promotion without any rules code in the browser.
      legal: myTurn() ? pos.legalUci : [],
      moves: s.transcript as Move[],
      players: publicSeats(s.players as Player[]),
      humanTurn: myTurn(),
      // A model is to move: the page steps the game (people never do).
      aiTurn: !!tp && !tp.isHuman,
      me: me >= 0 ? me : null,
      isHost,
      // The link (`token`) is only the host's to share.
      lobby: lb ? { open: lb.open, ...(isHost ? { token: lb.token } : {}) } : null,
      canJoin: !isHost && me < 0 && linkOk(),
      clock: duo ? { ...(s.pending?.clock as Clock), now: Date.now() } : null,
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
    if (patch.players) players = s.players
    // The other person's page refreshes now, not at its next fallback poll.
    if (duo) await pingTable(s.id)
    return true
  }
  const reload = async () => {
    const { data } = await svc().from('xtalk_sessions').select('*').eq('id', s.id).maybeSingle()
    if (data) { Object.assign(s, data); players = s.players; me = seatOf(s, user.id); pos = engine.position(s.pending?.moves ?? []) }
  }

  // ── a person out of time loses (applied by whichever request comes next)
  if (duo && s.status === 'active' && !lobby() && s.pending?.clock && flagged(s.pending.clock, toMove(), Date.now())) {
    const loser = toMove()!
    const end: ChessEnd = { reason: 'time', winner: loser === 0 ? 'black' : 'white' }
    if (!await save({ status: 'over', winner: end.winner, pending: { ...s.pending, end } }, s.day)) await reload()
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
    const clock: Clock | undefined = s.pending?.clock
    const ok = await save({
      pending: { ...s.pending, moves, end, ...(duo && clock ? { clock: afterMove(clock, color === 'w' ? 0 : 1, Date.now()) } : {}) },
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

  // ── join: sit at an invited seat (the table's link) ───────────────────
  if (body.action === 'join') {
    const lb = lobby()
    if (!lb || isHost || me >= 0 || !linkOk()) return view()
    const seat = lb.open.includes(Number(body.seat)) ? Number(body.seat) : lb.open[0]
    if (await claimSeat(s.id, user.id, seat) !== 'ok') {
      await reload()
      return Response.json({ error: 'That seat was just taken.', code: 'taken' }, { status: 409 })
    }
    const face = await faceOf(user)
    const next = players.map((p, i) => i === seat
      ? { ...p, name: face.name, handle: face.handle, avatar: face.avatar, userId: user.id, invited: false }
      : p)
    const open = lb.open.filter(x => x !== seat)
    // The last seat taken: the game begins, and White's clock with it.
    const started = open.length === 0
    const ok = await save({
      players: next,
      pending: {
        ...s.pending,
        lobby: started ? null : { ...lb, open },
        ...(started && s.pending?.clock ? { clock: startClock(s.pending.clock, Date.now()) } : {}),
      },
      title: `${next[0].name || '…'} vs ${next[1].name || '…'}`,
    }, s.day)
    if (!ok) { await releaseSeat(s.id, user.id); await reload(); return view() }
    me = seat
    return view()
  }

  // ── leave: a guest gives the seat back before the game begins ─────────
  if (body.action === 'leave') {
    const lb = lobby()
    if (!lb || isHost || me < 0) return view()
    const seat = me
    const next = players.map((p, i) => i === seat
      ? { color: p.color, modelId: null, name: '', isHuman: true, invited: true, userId: null }
      : p)
    if (await save({ players: next, pending: { ...s.pending, lobby: { ...lb, open: [...lb.open, seat].sort() } } }, s.day)) {
      await releaseSeat(s.id, user.id)
      me = -1
    } else await reload()
    return Response.json({ ok: true, left: true })
  }

  // ── a person's move (their own seat, on their turn) ───────────────────
  if (body.action === 'move') {
    if (!myTurn()) return view()
    const uci = String(body.uci ?? '').toLowerCase()
    if (!pos.legalUci.includes(uci)) return Response.json({ error: 'illegal move' }, { status: 400 })
    const san = pos.legalSan[pos.legalUci.indexOf(uci)]
    // Think time = since the previous move was saved (when this turn began).
    const ms = Math.max(0, Date.now() - new Date(s.updated_at).getTime())
    await applyMove({ uci, san, ms })
    return view()
  }

  // ── resign (a person, for their own seat) ─────────────────────────────
  if (body.action === 'resign') {
    if (me < 0 || s.status !== 'active') return view()
    const end: ChessEnd = { reason: 'resign', winner: me === 0 ? 'black' : 'white' }
    // Before anyone joined there is nobody to win: the table just closes.
    const patch = lobby() && duo
      ? { status: 'over', winner: 'draw', pending: { ...s.pending, lobby: null, end: { reason: 'cancel', winner: 'draw' } } }
      : { status: 'over', winner: end.winner, pending: { ...s.pending, end } }
    if (!await save(patch, s.day)) await reload()
    return view()
  }

  // ── step: one AI move (the host's table; the host pays) ───────────────
  if (body.action === 'step') {
    const turn = turnOf()
    if (!turn || turn.isHuman || !isHost) return view()
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
