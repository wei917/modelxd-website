// lib/chess-engine.ts
// The chess rules for XGame (Oct 19), wrapped around ffish: Fairy-Stockfish's
// move generator compiled to WebAssembly (npm `ffish`, GPL-3.0). Chosen over
// chess.js because the same library also plays 象棋 and 將棋, which come next.
//
// SERVER ONLY. ffish is GPL: it runs inside our API routes and never enters
// the browser bundle, so nothing GPL is distributed to visitors. The table
// gets what it needs (FEN, legal moves, the result) from the route's view;
// the client-safe pieces (FEN reading, the text board) are lib/chess-board.ts.
// next.config.js keeps the package external and traces ffish.wasm into the
// chess route.
//
// The model NEVER adjudicates: it proposes a move, this file decides whether
// it is legal and whether the game is over (the arena's founding rule, as in
// lib/gomoku-engine.ts).

import { START_FEN, parseFen, squareXY } from './chess-board'
import { loadFfish as load, resetFfish as reset, type Ffish, type FfBoard } from './ffish-load'

export { START_FEN }

export type ChessEndReason =
  | 'checkmate' | 'stalemate' | 'insufficient' | 'fifty' | 'threefold'
  | 'cap' | 'resign'
  // Two people (Oct 21): a clock ran out; the host closed the table before anyone sat down.
  | 'time' | 'cancel'
export type ChessEnd = { reason: ChessEndReason; winner: 'white' | 'black' | 'draw' }

export type ChessPosition = {
  fen: string
  turn: 'w' | 'b'
  check: boolean
  /** Same order, pairwise: legalSan[i] is legalUci[i]. */
  legalUci: string[]
  legalSan: string[]
  /** Every move so far in SAN, from the start. */
  sanHistory: string[]
  /** Set when the rules end the game here (mate, stalemate, a draw). */
  end: ChessEnd | null
}

export type ResolvedMove = { uci: string; san: string }

// ── the engine ──────────────────────────────────────────────────────────────

function withBoard<T>(ff: Ffish, moves: string[], startFen: string, fn: (b: FfBoard) => T): T {
  let b: FfBoard
  try { b = new ff.Board('chess', startFen) } catch (e) { reset(); throw e }
  try {
    for (const m of moves) {
      if (!b.push(m)) throw new Error(`illegal move in the game record: ${m}`)
    }
    return fn(b)
  } catch (e) {
    if (e instanceof WebAssembly.RuntimeError) reset()
    throw e
  } finally {
    b.delete()
  }
}

const words = (s: string) => s.split(' ').filter(Boolean)

function endOf(b: FfBoard, turn: 'w' | 'b'): ChessEnd | null {
  if (b.numberLegalMoves() === 0) {
    return b.isCheck()
      ? { reason: 'checkmate', winner: turn === 'w' ? 'black' : 'white' }
      : { reason: 'stalemate', winner: 'draw' }
  }
  if (b.isInsufficientMaterial()) return { reason: 'insufficient', winner: 'draw' }
  // Threefold repetition and the 50-move rule are CLAIMED draws in FIDE
  // rules; an unattended AI game claims them automatically, as engine
  // matches do. result(true) reports either; the halfmove clock tells which.
  if (b.result(true) !== '*') return { reason: b.halfmoveClock() >= 100 ? 'fifty' : 'threefold', winner: 'draw' }
  return null
}

export type ChessEngine = {
  /** The position after `moves` (UCI, from the start). Throws on a record
   *  that contains an illegal move. */
  position(moves: string[], startFen?: string): ChessPosition
  /** Read a move the way a model writes it (SAN, UCI, "0-0", "Nf3+", "e8Q")
   *  and return the legal move it names, or why it names none. */
  resolve(pos: ChessPosition, input: string): ResolvedMove | { error: string }
  info(): string
}

export async function chessEngine(): Promise<ChessEngine> {
  const ff = await load()
  return {
    position(moves, startFen = START_FEN) {
      return withBoard(ff, [], startFen, b => {
        const sanHistory: string[] = []
        for (const m of moves) {
          sanHistory.push(b.sanMove(m))
          if (!b.push(m)) throw new Error(`illegal move in the game record: ${m}`)
        }
        const fen = b.fen()
        const turn = parseFen(fen).turn
        return {
          fen, turn, check: b.isCheck(),
          legalUci: words(b.legalMoves()),
          legalSan: words(b.legalMovesSan()),
          sanHistory,
          end: endOf(b, turn),
        }
      })
    },
    resolve: resolveMove,
    info: () => ff.info(),
  }
}

// ── reading a model's move ──────────────────────────────────────────────────
// Lenient on FORM, strict on content: the same reading for every model, so
// the harness stays fair. Check marks, annotations, "0-0", a missing or extra
// "x", over-disambiguation, UCI and a missing promotion piece (= queen) are
// accepted; a move that is not legal, or that names two legal moves, is not.

const strip = (s: string) => s.replace(/[+#!?]/g, '')

function normalize(raw: string): string {
  let s = String(raw ?? '').trim()
  s = s.replace(/^["'`*\s]+|["'`*\s.]+$/g, '')
  s = s.replace(/^\d+\s*\.+\s*/, '')                 // "12. Nf3", "12... Nf3"
  s = s.replace(/\s*e\.?p\.?$/i, '')                 // "exd6 e.p."
  s = strip(s).replace(/\s+/g, '')
  if (/^[0oO]-[0oO](-[0oO])?$/.test(s)) s = s.toUpperCase().replace(/0/g, 'O')
  return s
}

function resolveMove(pos: ChessPosition, input: string): ResolvedMove | { error: string } {
  const raw = String(input ?? '').trim().slice(0, 40)
  const s = normalize(raw)
  if (!s) return { error: 'no move could be read from your reply' }
  const pick = (i: number): ResolvedMove => ({ uci: pos.legalUci[i], san: pos.legalSan[i] })

  // 1. Exactly a legal SAN (ignoring check marks).
  const exact = pos.legalSan.findIndex(m => strip(m) === s)
  if (exact >= 0) return pick(exact)

  // 2. UCI or long algebraic: e2e4, e2-e4, e7e8q, e7-e8=Q.
  const u = /^([a-h][1-8])[-x]?([a-h][1-8])=?([qrbnQRBN])?$/.exec(s)
  if (u) {
    const base = u[1] + u[2]
    const want = base + (u[3] ? u[3].toLowerCase() : '')
    let i = pos.legalUci.indexOf(want)
    if (i < 0 && !u[3]) i = pos.legalUci.indexOf(base + 'q')
    if (i >= 0) return pick(i)
    return { error: `"${raw}" is not a legal move in this position` }
  }

  // 3. Loose SAN: filter the legal moves by piece, destination, promotion and
  //    any disambiguation hint. A lowercase piece letter is tried as written
  //    first (bxc3 is a pawn capture), then as a piece.
  const { grid } = parseFen(pos.fen)
  const facts = pos.legalUci.map(m => {
    const from = squareXY(m.slice(0, 2)), to = m.slice(2, 4)
    const piece = from ? (grid[from[1]][from[0]]?.[1] ?? '') : ''
    return { from: m.slice(0, 2), to, piece, promo: m[4]?.toUpperCase() ?? '' }
  })
  const tryParse = (t: string): number[] | null => {
    const m = /^([KQRBN])?([a-h])?([1-8])?x?([a-h][1-8])=?([QRBN])?$/.exec(t)
    if (!m) return null
    const [, pc = 'P', ff, fr, to, promo = ''] = m
    const hits: number[] = []
    facts.forEach((f, i) => {
      if (f.piece !== pc || f.to !== to) return
      if (ff && f.from[0] !== ff) return
      if (fr && f.from[1] !== fr) return
      if (pc === 'P' && f.promo && (promo || 'Q') !== f.promo) return
      if (!f.promo && promo) return
      hits.push(i)
    })
    return hits
  }
  const variants = [s]
  if (/^[kqrbn]/.test(s)) variants.push(s[0].toUpperCase() + s.slice(1))
  for (const v of variants) {
    const hits = tryParse(v)
    if (!hits) continue
    if (hits.length === 1) return pick(hits[0])
    if (hits.length > 1) {
      return { error: `"${raw}" could mean ${hits.map(i => pos.legalSan[i]).join(' or ')}; write the move exactly as it appears in the legal list` }
    }
  }
  return { error: `"${raw}" is not a legal move in this position` }
}

/** The marked fallback when a model cannot produce a legal move in two
 *  tries: a legal move picked by a hash of the position. Always legal,
 *  deterministic (the same position always gets the same move), no chess
 *  knowledge in it, and badged on the board by the caller. */
export function fallbackMove(pos: ChessPosition): ResolvedMove {
  let h = 2166136261
  for (let i = 0; i < pos.fen.length; i++) { h ^= pos.fen.charCodeAt(i); h = Math.imul(h, 16777619) }
  const i = (h >>> 0) % pos.legalUci.length
  return { uci: pos.legalUci[i], san: pos.legalSan[i] }
}
