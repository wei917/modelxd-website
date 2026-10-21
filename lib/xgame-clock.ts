// lib/xgame-clock.ts — the clocks of a table where two people play
// (Oct 21; docs/XGAME-MULTIPLAYER-PLAN.md, step 1). Client-safe and pure:
// the server applies them, the page only draws them.
//
// Fischer clocks: each side has its own time, which runs only on its turn;
// a move adds the increment. The time of the side to move is never stored
// as it runs: `left` is what each side had when its turn began and
// `turnStart` is when the current turn began, so any request (and any page)
// can work out the time from the server's clock alone. A side whose time
// is used up loses ("loses on time"), applied on the next request after the
// moment, whoever sends it.

export type Clock = {
  /** Each side's starting time and the increment, in ms. */
  base: number
  inc: number
  /** Each side's time when its current or last turn began. */
  left: [number, number]
  /** When the side to move began its turn; null until the game starts. */
  turnStart: string | null
}

export type ClockGame = 'chess' | 'xiangqi'

/** 10 minutes each plus 5 s a move (plan: "Proposed clock for people"). */
export const CLOCK_RULES: Record<ClockGame, { base: number; inc: number }> = {
  chess: { base: 10 * 60_000, inc: 5_000 },
  xiangqi: { base: 10 * 60_000, inc: 5_000 },
}

export function newClock(game: ClockGame): Clock {
  const { base, inc } = CLOCK_RULES[game]
  return { base, inc, left: [base, base], turnStart: null }
}

/** The clock started: the first side to move starts using its time now. */
export const startClock = (c: Clock, now: number): Clock => ({ ...c, turnStart: new Date(now).toISOString() })

/** What `side` has left at `now`; only the side to move is losing time. */
export function remaining(c: Clock, side: 0 | 1, toMove: 0 | 1 | null, now: number): number {
  const base = c.left[side]
  if (toMove !== side || !c.turnStart) return base
  return base - Math.max(0, now - new Date(c.turnStart).getTime())
}

/** `side` moved at `now`: its time is what was left plus the increment, and
 *  the other side's turn begins. */
export function afterMove(c: Clock, side: 0 | 1, now: number): Clock {
  const left: [number, number] = [c.left[0], c.left[1]]
  left[side] = Math.max(0, remaining(c, side, side, now)) + c.inc
  return { ...c, left, turnStart: new Date(now).toISOString() }
}

/** The side to move has used up its time. */
export const flagged = (c: Clock, toMove: 0 | 1 | null, now: number) =>
  toMove != null && !!c.turnStart && remaining(c, toMove, toMove, now) <= 0

/** "9:58", or "0:07.3" under ten seconds, as chess clocks show it. */
export function fmtClock(ms: number): string {
  const t = Math.max(0, ms)
  if (t < 10_000) return `0:0${(t / 1000).toFixed(1)}`
  const s = Math.floor(t / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
