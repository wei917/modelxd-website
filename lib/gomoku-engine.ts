// lib/gomoku-engine.ts
// Free-style gomoku on a 15x15 board. Pure functions, no I/O — the API
// route holds the session; this file holds the rules. The model NEVER
// adjudicates: it proposes a coordinate, these functions decide legality
// and victory (docs/TODO.md, the arena's founding rule).

export const SIZE = 15
export type Stone = 'B' | 'W'
/** Row-major strings, '.' empty. Kept as strings so the whole board is a
 *  225-char jsonb payload and a trivially diffable transcript artifact. */
export type Board = string[]

export const emptyBoard = (): Board => Array.from({ length: SIZE }, () => '.'.repeat(SIZE))

export const COLS = 'ABCDEFGHIJKLMNO'   // A..O left→right; rows 1..15 top→bottom

/** "H8" → [row,col] or null. Case/whitespace tolerant; rejects out of range. */
export function parseCoord(raw: string): [number, number] | null {
  const m = /^\s*([A-Oa-o])\s*(\d{1,2})\s*$/.exec(raw ?? '')
  if (!m) return null
  const col = COLS.indexOf(m[1].toUpperCase())
  const row = parseInt(m[2], 10) - 1
  if (col < 0 || row < 0 || row >= SIZE) return null
  return [row, col]
}

export const coordName = (row: number, col: number) => `${COLS[col]}${row + 1}`

export const cellAt = (b: Board, row: number, col: number): string => b[row]?.[col] ?? '.'

export function place(b: Board, row: number, col: number, stone: Stone): Board {
  const next = b.slice()
  next[row] = next[row].slice(0, col) + stone + next[row].slice(col + 1)
  return next
}

/** Five or more through the placed stone? Returns the winning line or null. */
export function winAt(b: Board, row: number, col: number): Array<[number, number]> | null {
  const stone = cellAt(b, row, col)
  if (stone === '.') return null
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]] as const) {
    const line: Array<[number, number]> = [[row, col]]
    for (const sign of [1, -1]) {
      let r = row + dr * sign, c = col + dc * sign
      while (r >= 0 && r < SIZE && c >= 0 && c < SIZE && cellAt(b, r, c) === stone) {
        sign === 1 ? line.push([r, c]) : line.unshift([r, c])
        r += dr * sign; c += dc * sign
      }
    }
    if (line.length >= 5) return line
  }
  return null
}

export const isFull = (b: Board): boolean => b.every(r => !r.includes('.'))

/** The board as the model reads it: column letters, row numbers, one char
 *  per cell. Sent WHOLE every turn — the API is stateless and 225 cells is
 *  nothing; re-describing beats trusting a model's memory of 30 moves. */
export function boardText(b: Board): string {
  const head = '   ' + COLS.split('').join(' ')
  const rows = b.map((r, i) => `${String(i + 1).padStart(2)} ` + r.split('').join(' '))
  return [head, ...rows].join('\n')
}

/** Fallback when a model cannot produce a legal move in two tries: the
 *  first empty cell adjacent to the last stone played (fights on), else
 *  nearest-to-center. Deterministic, always legal, visibly marked by the
 *  caller — a bad move beats a wedged game. */
export function fallbackMove(b: Board, lastMove: [number, number] | null): [number, number] {
  if (lastMove) {
    for (const [dr, dc] of [[0,1],[1,0],[1,1],[1,-1],[0,-1],[-1,0],[-1,-1],[-1,1]]) {
      const r = lastMove[0] + dr, c = lastMove[1] + dc
      if (r >= 0 && r < SIZE && c >= 0 && c < SIZE && cellAt(b, r, c) === '.') return [r, c]
    }
  }
  const mid = Math.floor(SIZE / 2)
  let best: [number, number] = [mid, mid], bestD = Infinity
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    if (cellAt(b, r, c) === '.') {
      const d = Math.abs(r - mid) + Math.abs(c - mid)
      if (d < bestD) { bestD = d; best = [r, c] }
    }
  }
  return best
}
