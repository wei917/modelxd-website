// lib/chess-board.ts
// Chess helpers that are safe in the BROWSER (our own code, no GPL): read a
// FEN into a grid, name squares, and write the board as the model reads it.
// The rules themselves (legal moves, mate, repetition) live in
// lib/chess-engine.ts, which wraps the GPL ffish build and runs on the
// server only. The table never needs the rules: the server sends the legal
// moves with every view.
//
// Grid convention, shared with app/xgame/GridBoard.tsx: grid[y][x], x = 0 is
// file a, y = 0 is rank 8 (the top row as White sees the board).

export const FILES = 'abcdefgh'
export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

/** The harness every model plays under, published on the table. Lives here
 *  (client-safe) so the setup screen can show it before a game exists; the
 *  turn code is lib/chess-turn.ts. Bump `version` on any change. */
export const CHESS_HARNESS = {
  version: 2,
  board: 'FEN + text board + piece lists',
  history: 'SAN record',
  /** v2 (Oct 20): the legal moves only on the retry after an illegal or unreadable answer. */
  legalList: 'retry',
  retries: 1,
  timeoutSec: 90,
  fallback: 'a legal move picked by a hash of the position, marked ⚠',
  plyCap: 200,
  search: false,
} as const

export type Color = 'w' | 'b'
/** 'wK', 'bN', ... : colour then the piece letter, uppercase. */
export type PieceCode = string

export type FenInfo = {
  grid: (PieceCode | null)[][]
  turn: Color
  castling: string
  ep: string
  halfmove: number
  fullmove: number
}

export function parseFen(fen: string): FenInfo {
  const [place = '', turn = 'w', castling = '-', ep = '-', half = '0', full = '1'] = fen.trim().split(/\s+/)
  const grid: (PieceCode | null)[][] = []
  for (const row of place.split('/').slice(0, 8)) {
    const out: (PieceCode | null)[] = []
    for (const ch of row) {
      if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) out.push(null)
      else out.push((ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase())
    }
    while (out.length < 8) out.push(null)
    grid.push(out.slice(0, 8))
  }
  while (grid.length < 8) grid.push(Array(8).fill(null))
  return { grid, turn: turn === 'b' ? 'b' : 'w', castling, ep, halfmove: Number(half) || 0, fullmove: Number(full) || 1 }
}

export const squareName = (x: number, y: number) => `${FILES[x]}${8 - y}`

/** 'e4' → [4, 4] (x, y in the grid convention above), or null. */
export function squareXY(sq: string): [number, number] | null {
  const m = /^([a-h])([1-8])$/.exec(sq)
  if (!m) return null
  return [FILES.indexOf(m[1]), 8 - Number(m[2])]
}

export function kingSquare(fen: string, color: Color): [number, number] | null {
  const { grid } = parseFen(fen)
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (grid[y][x] === `${color}K`) return [x, y]
  return null
}

/** The board as the model reads it: rank 8 at the top, file a on the left,
 *  White UPPERCASE, Black lowercase, '.' empty. Sent WHOLE every turn, with
 *  the FEN and the piece lists, because the call is stateless. */
export function boardText(fen: string): string {
  const { grid } = parseFen(fen)
  const rows = grid.map((row, y) => `${8 - y} | ` + row.map(p => p ? (p[0] === 'w' ? p[1] : p[1].toLowerCase()) : '.').join(' ') + ' |')
  return ['  +-----------------+', ...rows, '  +-----------------+', '    a b c d e f g h'].join('\n')
}

const ORDER = 'KQRBNP'
/** "K e1; Q d1; R a1, h1; ..." for one side: a list is read, a grid must be
 *  counted (docs/research-gomoku-llm.md, the strongest single result). */
export function pieceList(fen: string, color: Color): string {
  const { grid } = parseFen(fen)
  const by: Record<string, string[]> = {}
  for (let y = 7; y >= 0; y--) for (let x = 0; x < 8; x++) {
    const p = grid[y][x]
    if (p && p[0] === color) (by[p[1]] ??= []).push(squareName(x, y))
  }
  return ORDER.split('').filter(k => by[k]).map(k => `${k} ${by[k].join(', ')}`).join('; ') || '(none)'
}

/** "1. e4 e5 2. Nf3" from a SAN list that starts at move 1 with White. */
export function sanLine(sans: string[]): string {
  const out: string[] = []
  sans.forEach((s, i) => out.push(i % 2 === 0 ? `${i / 2 + 1}. ${s}` : s))
  return out.join(' ')
}
