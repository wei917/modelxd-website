// lib/chess-turn.ts
// One AI move in XGame chess (Oct 19): the prompt, the call, the reading and
// the retry. The route (app/api/xgame/chess) calls playAiTurn() for every AI
// move; scripts/chess-ai-game.ts calls the same function, so a test game is
// played by the route's own code.
//
// FAIRNESS: every model gets this exact harness, published on the table
// (CHESS_HARNESS, lib/chess-board.ts): the same text, the same board formats, the same legal
// list, one retry, the same fallback. Only the seat's thinking level differs,
// and it is shown next to the name. Change anything here and old games stop
// being comparable with new ones: bump CHESS_HARNESS.version.
//
// Prompt shape (docs/research-gomoku-llm.md): the whole state every turn
// (FEN, a text board, both piece lists, the SAN record, the legal moves),
// reasoning BEFORE the move in the reply. No worked example: in the first
// test games (Oct 19) cheap models copied the example's move verbatim
// ("Nf3" on move 1, then "Bxe5" where no bishop could take), so the reply
// shape is given with placeholders instead.

import * as providers from './providers'
import { boardText, pieceList, sanLine, CHESS_HARNESS } from './chess-board'
import { fallbackMove, type ChessEngine, type ChessPosition, type ResolvedMove } from './chess-engine'

export { CHESS_HARNESS }

const LOG = '[xgame:chess]'
const MODEL_TIMEOUT_MS = CHESS_HARNESS.timeoutSec * 1000

export type AskResult = { text: string; cost: number; timedOut: boolean }
/** One call to the model: the prompt in, its whole reply out. Injectable so
 *  a check can run the turn logic without a provider. */
export type AskFn = (prompt: string) => Promise<AskResult>

export function chessPrompt(pos: ChessPosition, objection: string | null): string {
  const side = pos.turn === 'w' ? 'White' : 'Black'
  const other = pos.turn === 'w' ? 'Black' : 'White'
  const last = pos.sanHistory.length ? pos.sanHistory[pos.sanHistory.length - 1] : null
  return [
    `You are playing chess as ${side}. It is your move.`,
    'Standard rules. You win by checkmate. Stalemate, threefold repetition, the 50-move rule and too little material are draws; the game is also called a draw after 100 moves each.',
    '',
    `Position (FEN): ${pos.fen}`,
    '',
    'Board (White is UPPERCASE, Black is lowercase, "." is empty; rank 8 is at the top, file a on the left):',
    boardText(pos.fen),
    '',
    `White pieces: ${pieceList(pos.fen, 'w')}`,
    `Black pieces: ${pieceList(pos.fen, 'b')}`,
    `Moves so far: ${pos.sanHistory.length ? sanLine(pos.sanHistory) : '(none: you open the game)'}`,
    ...(last ? [`${other} just played ${last}.`] : []),
    ...(pos.check ? [`You are in CHECK. Only moves that get out of check are legal.`] : []),
    '',
    `Your legal moves (all of them): ${pos.legalSan.join(' ')}`,
    ...(objection ? ['', `Your previous answer was rejected: ${objection}.`] : []),
    '',
    'Check IN THIS ORDER before answering:',
    '1. Does one of your legal moves give checkmate? Play it.',
    `2. What does ${other} threaten right now (a check, a capture of an undefended piece, a mate)? Deal with it.`,
    '3. Can you win material safely (a capture they cannot answer by taking back more)?',
    '4. Otherwise develop your pieces, keep your king safe and improve your worst piece.',
    '',
    'Reply with ONLY this JSON, in this field order:',
    '{"why": "<one or two short sentences: the threat you see and your plan>", "move": "<one move, copied exactly from your legal moves>"}',
  ].join('\n')
}

/** The move field of a reply, or null. Tolerant of prose around the JSON. */
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
    const m = /["']move["']\s*:\s*["']([^"']{1,20})["']/.exec(text)
    if (m) move = m[1]
    const w = /["']why["']\s*:\s*["']([^"']{1,400})/.exec(text)
    if (w) why = w[1]
  }
  return { move, why: why?.trim().slice(0, 240) || undefined }
}

export function providerAsk(model: any, opts: { userId: string | null; thinking: string | null }): AskFn {
  return async (prompt: string) => {
    let text = '', cost = 0, timedOut = false
    let timer: ReturnType<typeof setTimeout> | null = null
    await Promise.race([
      new Promise<void>(resolve => {
        providers.streamText(model, [{ role: 'user', content: prompt }], {
          onDelta: (t: string) => { text += t },
          onDone: (r: any) => { cost += Number(r.cost) || 0; resolve() },
          onError: (m: string) => { console.warn(`${LOG} ${model.display_name}:`, m); resolve() },
        }, [], { userId: opts.userId, surface: 'xgame-chess' } as any, { thinking: opts.thinking, search: false }).catch(() => resolve())
      }),
      new Promise<void>(resolve => { timer = setTimeout(() => { timedOut = true; console.warn(`${LOG} ${model.display_name}: timeout`); resolve() }, MODEL_TIMEOUT_MS) }),
    ])
    if (timer) clearTimeout(timer)
    return { text, cost, timedOut }
  }
}

export type AiTurn = ResolvedMove & {
  why?: string
  /** The move was the marked fallback, not the model's. */
  fallback: boolean
  /** The first reply was rejected and the model was asked again. */
  retried: boolean
  /** What the model wrote when it was rejected (first and, on a fallback, second). */
  rejected?: string[]
  timedOut?: boolean
  cost: number
  ms: number
}

/** One AI move on `pos`. Never throws for a model's failure: an illegal or
 *  unreadable reply gets ONE retry carrying the reason; a second failure or
 *  a timeout (no retry: a 90 s silence would just repeat) is the fallback. */
export async function playAiTurn(engine: ChessEngine, pos: ChessPosition, ask: AskFn): Promise<AiTurn> {
  const t0 = Date.now()
  let cost = 0, why: string | undefined, objection: string | null = null
  const rejected: string[] = []
  let timedOut = false, asks = 0
  for (let attempt = 0; attempt < 1 + CHESS_HARNESS.retries; attempt++) {
    asks++
    const r = await ask(chessPrompt(pos, objection))
    cost += r.cost
    if (r.timedOut && !r.text.trim()) { timedOut = true; break }
    const { move, why: w } = readReply(r.text)
    if (w) why = w
    if (move) {
      const got = engine.resolve(pos, move)
      if (!('error' in got)) {
        return { ...got, why, fallback: false, retried: attempt > 0, ...(rejected.length ? { rejected } : {}), cost, ms: Date.now() - t0 }
      }
      objection = got.error
      rejected.push(move.slice(0, 20))
    } else {
      objection = r.timedOut ? 'your reply was cut off by the time limit' : 'no move could be read from your reply; reply with ONLY the JSON'
      rejected.push(r.text.trim() ? '(unreadable)' : '(empty)')
    }
  }
  const fb = fallbackMove(pos)
  return { ...fb, fallback: true, retried: asks > 1, ...(rejected.length ? { rejected } : {}), ...(timedOut ? { timedOut } : {}), cost, ms: Date.now() - t0 }
}
