// lib/xiangqi-engine.ts
// The 象棋 rules for XGame (Oct 20), on ffish like chess (lib/ffish-load.ts:
// Fairy-Stockfish's move generator in WebAssembly, GPL-3.0, SERVER ONLY).
// Its 'xiangqi' variant knows the palace, the river, the blocked horse leg
// and elephant eye, the flying generals and the cannon's screen.
//
// The model NEVER adjudicates: it proposes a move, this file decides whether
// it is legal and whether the game is over.
//
// The game ends when the side to move has no legal move: in 象棋 that LOSES,
// checkmate or not (困斃, unlike chess's stalemate draw). ffish also reports
// the repetition rules (perpetual check loses) and a bare board as results.

import { loadFfish, resetFfish, type Ffish, type FfBoard } from './ffish-load'
import { XQ_START_FEN, parseFen, toWxf, type Side } from './xiangqi-board'

export { XQ_START_FEN }

export type XqEndReason = 'checkmate' | 'stalemate' | 'repetition' | 'insufficient' | 'cap' | 'resign'
  // Two people (Oct 21): a clock ran out; the host closed the table before anyone sat down.
  | 'time' | 'cancel'
export type XqEnd = { reason: XqEndReason; winner: 'red' | 'black' | 'draw' }

export type XqPosition = {
  fen: string
  turn: Side
  check: boolean
  /** Same order, pairwise: legalWxf[i] is legalUci[i]. */
  legalUci: string[]
  legalWxf: string[]
  /** Every move so far, from the start. */
  history: { uci: string; wxf: string }[]
  end: XqEnd | null
}

export type ResolvedXqMove = { uci: string; wxf: string }

function withBoard<T>(ff: Ffish, startFen: string, fn: (b: FfBoard) => T): T {
  let b: FfBoard
  try { b = new ff.Board('xiangqi', startFen) } catch (e) { resetFfish(); throw e }
  try { return fn(b) } catch (e) {
    if (e instanceof WebAssembly.RuntimeError) resetFfish()
    throw e
  } finally { b.delete() }
}

const words = (s: string) => s.split(' ').filter(Boolean)

function endOf(b: FfBoard, turn: Side): XqEnd | null {
  const other = turn === 'w' ? 'black' : 'red'
  if (b.numberLegalMoves() === 0) return { reason: b.isCheck() ? 'checkmate' : 'stalemate', winner: other }
  const r = b.result(true)
  if (r === '*') return null
  const winner = r === '1-0' ? 'red' : r === '0-1' ? 'black' : 'draw'
  return { reason: winner === 'draw' && b.isInsufficientMaterial() ? 'insufficient' : 'repetition', winner }
}

export type XiangqiEngine = {
  /** The position after `moves` (coordinates, from the start, or from
   *  `startFen` in the checks). Throws on a record with an illegal move. */
  position(moves: string[], startFen?: string): XqPosition
  /** Read a move as a model writes it (h3e3, h3-e3, C2=5, 炮二平五, 炮2平5)
   *  and return the legal move it names, or why it names none. */
  resolve(pos: XqPosition, input: string): ResolvedXqMove | { error: string }
}

export async function xiangqiEngine(): Promise<XiangqiEngine> {
  const ff = await loadFfish()
  const WXF = ff.Notation.XIANGQI_WXF
  return {
    position(moves, startFen = XQ_START_FEN) {
      return withBoard(ff, startFen, b => {
        const history: { uci: string; wxf: string }[] = []
        for (const m of moves) {
          const wxf = b.sanMove(m, WXF)
          if (!b.push(m)) throw new Error(`illegal move in the game record: ${m}`)
          history.push({ uci: m, wxf })
        }
        const fen = b.fen()
        const turn = parseFen(fen).turn
        const legalUci = words(b.legalMoves())
        return {
          fen, turn, check: b.isCheck(),
          legalUci, legalWxf: legalUci.map(u => b.sanMove(u, WXF)),
          history, end: endOf(b, turn),
        }
      })
    },
    resolve: resolveMove,
  }
}

// Lenient on FORM, strict on content, the same for every model.
function resolveMove(pos: XqPosition, input: string): ResolvedXqMove | { error: string } {
  const raw = String(input ?? '').trim().slice(0, 40)
  const s = raw.replace(/^["'`*\s]+|["'`*\s.]+$/g, '').replace(/^\d+\s*\.+\s*/, '')
  if (!s) return { error: 'no move could be read from your reply' }
  const pick = (i: number): ResolvedXqMove => ({ uci: pos.legalUci[i], wxf: pos.legalWxf[i] })

  // A move copied from the legal list keeps its name in brackets ("c7c6
  // (P3+1)", Qwen 3.8 Flash on Oct 20): read the move before the bracket.
  const bare = s.replace(/\s*[(（][^)）]*[)）]\s*$/, '').trim()
  const tryForms = (t: string): ResolvedXqMove | { error: string } | null => {
    // 1. Coordinates: h3e3, h3-e3, H3E3, b10c8.
    const c = /^([a-iA-I])(10|[1-9])\s*[-x]?\s*([a-iA-I])(10|[1-9])$/.exec(t)
    if (c) {
      const uci = `${c[1].toLowerCase()}${c[2]}${c[3].toLowerCase()}${c[4]}`
      const i = pos.legalUci.indexOf(uci)
      return i >= 0 ? pick(i) : { error: `"${raw}" is not a legal move in this position` }
    }
    // 2. WXF or Chinese (炮二平五, 炮2平5, C2.5).
    const w = toWxf(t)
    if (w) {
      const i = pos.legalWxf.indexOf(w)
      return i >= 0 ? pick(i) : { error: `"${raw}" is not a legal move in this position` }
    }
    return null
  }
  return tryForms(bare) ?? tryForms(s) ?? { error: `"${raw}" is not a move; copy one coordinate move (like h3e3) from your legal moves` }
}

/** The marked fallback: a legal move picked by a hash of the position.
 *  Always legal, deterministic, no 象棋 knowledge in it. */
export function fallbackMove(pos: XqPosition): ResolvedXqMove {
  let h = 2166136261
  for (let i = 0; i < pos.fen.length; i++) { h ^= pos.fen.charCodeAt(i); h = Math.imul(h, 16777619) }
  const i = (h >>> 0) % pos.legalUci.length
  return { uci: pos.legalUci[i], wxf: pos.legalWxf[i] }
}
