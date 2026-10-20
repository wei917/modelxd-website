// lib/gomoku-turn.ts
// One AI move in XGame 五子棋, and the two-game match (Oct 20 rebuild; owner:
// "go ahead on this plan"). The route (app/api/xgame/gomoku) calls
// playAiTurn() for every AI move of a match game; scripts/gomoku-check.ts
// runs the same function with a scripted model.
//
// FAIRNESS: every model gets this exact harness, published on the table
// (GOMOKU_HARNESS): the same text, the board as a grid plus both stone
// lists, the record, one retry, the same fallback. Only the seat's thinking
// level differs, and it is shown next to the name. Change anything here and
// old games stop being comparable: bump GOMOKU_HARNESS.version.
//
// What changed from version 1 (Aug 6), each from a live game on Oct 20:
//   • No "lines" field. Asking the model to list every line of 3+ on the
//     board made replies grow with the game: Qwen 3.8 Flash wrote 800-1,500
//     tokens and took 33-54 s a move by move 12. The model still reads the
//     board itself; the reply is a reason and a move.
//   • No worked example. Its "E5" was a coordinate a cheap model could copy
//     (chess saw exactly that with "Nf3"); the shape uses placeholders.
//   • Strict replies: a JSON schema goes to the provider (native schema or
//     JSON mode by provider, as lib/inference.ts does), and the tolerant
//     reader stays as a backstop. Two Qwen replies in that game were
//     unreadable JSON and lost their reason.
//   • 90 s per reply, as chess and poker (was 60).
//   • A match is two games with the colours swapped: free-style 五子棋
//     favours Black, so one game says as much about the colour as the model.

import * as providers from './providers'
import { adaptSchema, strictIsSafe } from './schema-adapt'
import { GOMOKU_HARNESS } from './gomoku-match'
import {
  SIZE, COLS, boardText, cellAt, parseCoord, coordName, fallbackMove,
  type Board, type Stone,
} from './gomoku-engine'


const LOG = '[xgame:gomoku]'
const MODEL_TIMEOUT_MS = GOMOKU_HARNESS.timeoutSec * 1000

export type PromptMove = { stone: Stone; coord: string }

function stoneList(board: Board, stone: Stone): string {
  const out: string[] = []
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    if (cellAt(board, r, c) === stone) out.push(coordName(r, c))
  }
  return out.join(', ') || '(none)'
}

const name = (s: Stone) => s === 'B' ? 'Black (B)' : 'White (W)'

export function gomokuPrompt(board: Board, stone: Stone, moves: PromptMove[], objection: string | null): string {
  const other: Stone = stone === 'B' ? 'W' : 'B'
  const last = moves.length ? moves[moves.length - 1] : null
  const record = moves.map((m, i) => `${i + 1}. ${m.stone} ${m.coord}`).join('  ')
  return [
    `You are playing gomoku (five in a row) on a 15x15 board as ${name(stone)}. It is your move.`,
    'Free-style rules: five or more of your stones in a straight line (row, column or diagonal) wins. Black moves first. You may only play on an empty point.',
    `Columns are letters ${COLS[0]}-${COLS[SIZE - 1]} (left to right), rows are numbers 1-${SIZE} (row 1 at the TOP). A move is a letter then a number.`,
    '',
    'Board ("." is empty):',
    boardText(board),
    '',
    `Black stones: ${stoneList(board, 'B')}`,
    `White stones: ${stoneList(board, 'W')}`,
    `Moves so far: ${record || '(none: you open the game)'}`,
    ...(last ? [`${name(other)} just played ${last.coord}.`] : []),
    ...(objection ? ['', `Your previous answer was rejected: ${objection}.`] : []),
    '',
    'Check IN THIS ORDER before answering:',
    '1. Can you make five right now? Play there and win.',
    `2. Can ${name(other)} make five on their next move (four in a line with one empty point, including split shapes like XX.XX and XXX.X)? Block that point.`,
    `3. Does ${name(other)} have an open three (three in a line, both ends empty)? Block one end now, or it becomes a four you cannot stop.`,
    '4. Otherwise build your own line, prefer a point that makes two threats at once, and stay near the fighting.',
    'Look in all four directions around the last few stones; diagonal threats are the ones most often missed.',
    '',
    'Reply with ONLY this JSON, in this field order:',
    '{"why": "<one short sentence: the threat you see and your plan>", "move": "<one empty point: a column letter then a row number>"}',
  ].join('\n')
}

/** The schema sent with every ask. Reason first, so a model that writes in
 *  order thinks before it commits. */
export const GOMOKU_REPLY_SCHEMA = {
  type: 'object',
  properties: {
    why: { type: 'string', description: 'One short sentence: the threat you see and your plan.' },
    move: { type: 'string', description: 'One empty point: a column letter A-O then a row number 1-15.' },
  },
  required: ['why', 'move'],
  additionalProperties: false,
} as const

/** The move and reason of a reply, or null. Tolerant of prose around the
 *  JSON, of code fences and of a reply cut off after the move. */
export function readReply(text: string): { move: string | null; why?: string } {
  let move: string | null = null, why: string | undefined
  const blocks = text.match(/\{[\s\S]*?\}/g) ?? []
  for (const b of [...blocks].reverse()) {
    try {
      const o = JSON.parse(b)
      if (typeof o.move === 'string') { move = o.move; if (typeof o.why === 'string') why = o.why; break }
    } catch { /* try the next block */ }
  }
  if (!move) {
    const m = /["']move["']\s*:\s*["']\s*([A-Oa-o]\s*\d{1,2})\s*["']/.exec(text)
    if (m) move = m[1]
    const w = /["']why["']\s*:\s*["']([^"]{1,400})/.exec(text)
    if (w) why = w[1]
  }
  return { move: move?.trim() ?? null, why: why?.trim().slice(0, 240) || undefined }
}

export type AskResult = { text: string; cost: number; timedOut: boolean }
/** One call to the model: the prompt in, its whole reply out. Injectable so
 *  a check can run the turn logic without a provider. */
export type AskFn = (prompt: string) => Promise<AskResult>

export function providerAsk(model: any, opts: { userId: string | null; thinking: string | null }): AskFn {
  const jsonSchema = {
    name: 'gomoku_move',
    schema: adaptSchema(GOMOKU_REPLY_SCHEMA, model.provider),
    strict: strictIsSafe(GOMOKU_REPLY_SCHEMA),
  }
  return async (prompt: string) => {
    let text = '', cost = 0, timedOut = false
    let timer: ReturnType<typeof setTimeout> | null = null
    await Promise.race([
      new Promise<void>(resolve => {
        providers.streamText(model, [{ role: 'user', content: prompt }], {
          onDelta: (t: string) => { text += t },
          onDone: (r: any) => { cost += Number(r.cost) || 0; resolve() },
          onError: (m: string) => { console.warn(`${LOG} ${model.display_name}:`, m); resolve() },
        }, [], { userId: opts.userId, surface: 'xgame-gomoku' } as any, { thinking: opts.thinking, search: false, jsonSchema }).catch(() => resolve())
      }),
      new Promise<void>(resolve => { timer = setTimeout(() => { timedOut = true; console.warn(`${LOG} ${model.display_name}: timeout`); resolve() }, MODEL_TIMEOUT_MS) }),
    ])
    if (timer) clearTimeout(timer)
    return { text, cost, timedOut }
  }
}

export type AiTurn = {
  at: [number, number]
  coord: string
  why?: string
  /** The move was the marked fallback, not the model's. */
  fallback: boolean
  /** The first reply was rejected and the model was asked again. */
  retried: boolean
  /** What the model wrote when it was rejected. */
  rejected?: string[]
  timedOut?: boolean
  cost: number
  ms: number
}

/** One AI move. Never throws for a model's failure: an illegal or unreadable
 *  reply gets ONE retry carrying the reason; a second failure or a timeout
 *  (no retry: a 90 s silence would just repeat) is the marked fallback. */
export async function playAiTurn(
  board: Board, stone: Stone, moves: PromptMove[], last: [number, number] | null, ask: AskFn,
): Promise<AiTurn> {
  const t0 = Date.now()
  let cost = 0, why: string | undefined, objection: string | null = null
  const rejected: string[] = []
  let timedOut = false, asks = 0
  for (let attempt = 0; attempt < 1 + GOMOKU_HARNESS.retries; attempt++) {
    asks++
    const r = await ask(gomokuPrompt(board, stone, moves, objection))
    cost += r.cost
    if (r.timedOut && !r.text.trim()) { timedOut = true; break }
    const { move, why: w } = readReply(r.text)
    if (w) why = w
    if (move) {
      const at = parseCoord(move)
      if (at && cellAt(board, at[0], at[1]) === '.') {
        return { at, coord: coordName(at[0], at[1]), why, fallback: false, retried: attempt > 0, ...(rejected.length ? { rejected } : {}), cost, ms: Date.now() - t0 }
      }
      objection = at
        ? `"${move}" is already taken; pick an EMPTY point, shown as "." on the board`
        : `"${move.slice(0, 12)}" is not a point on this board; give a column letter A-O then a row number 1-15`
      rejected.push(move.slice(0, 12))
    } else {
      objection = r.timedOut ? 'your reply was cut off by the time limit' : 'no move could be read from your reply; reply with ONLY the JSON'
      rejected.push(r.text.trim() ? '(unreadable)' : '(empty)')
    }
  }
  const at = fallbackMove(board, last)
  return { at, coord: coordName(at[0], at[1]), fallback: true, retried: asks > 1, ...(rejected.length ? { rejected } : {}), ...(timedOut ? { timedOut } : {}), cost, ms: Date.now() - t0 }
}

export { GOMOKU_HARNESS }
export { blackSeat, matchScore, matchWinner, type GameResult, type MatchState } from './gomoku-match'
