// lib/gomoku-match.ts — the 五子棋 harness and the two-game match (Oct 20).
// Client-safe (no providers): the table reads GOMOKU_HARNESS to publish the
// rules, the route and lib/gomoku-turn.ts play by it. See gomoku-turn.ts for
// why each setting is what it is.

export const GOMOKU_HARNESS = {
  version: 2,
  board: 'text grid + both stone lists',
  history: 'move record',
  legalList: false,
  retries: 1,
  timeoutSec: 90,
  fallback: 'the first empty point next to the last stone, marked ⚠',
  /** Plies per game before it is called a draw (60 stones each). */
  plyCap: 120,
  games: 2,
  hints: false,
  search: false,
} as const

// ── The two-game match ────────────────────────────────────────────────────
// Seats are 0 and 1 for the whole match. Game 1: seat 0 plays Black. Game 2:
// the colours swap. A win is 1 point, a draw ½ each; 1-1 or ½-½ twice is a
// drawn match.

export type GameResult = {
  /** The seat that won this game, or null for a draw. */
  winner: 0 | 1 | null
  /** The seat that played Black in it. */
  black: 0 | 1
  plies: number
  /** Why it ended: five in a row, a full board, or the move cap. */
  reason: 'five' | 'full' | 'cap'
}

export type MatchState = { game: 1 | 2; games: GameResult[]; between: boolean }

export const blackSeat = (game: 1 | 2): 0 | 1 => game === 1 ? 0 : 1

export function matchScore(games: GameResult[]): [number, number] {
  const s: [number, number] = [0, 0]
  for (const g of games) {
    if (g.winner === null) { s[0] += 0.5; s[1] += 0.5 } else s[g.winner] += 1
  }
  return s
}

/** 'seat0' / 'seat1' / 'draw' once both games are played, else null. */
export function matchWinner(games: GameResult[]): 'seat0' | 'seat1' | 'draw' | null {
  if (games.length < GOMOKU_HARNESS.games) return null
  const [a, b] = matchScore(games)
  return a > b ? 'seat0' : b > a ? 'seat1' : 'draw'
}
