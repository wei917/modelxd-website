// lib/xiangqi-turn.ts
// One AI move in XGame 象棋 (Oct 20): the prompt, the call, the reading and
// the retry. The route (app/api/xgame/xiangqi) calls playAiTurn() for every
// AI move; scripts/xiangqi-check.ts runs it with a scripted model.
//
// FAIRNESS: every model gets this exact harness, published on the table
// (XIANGQI_HARNESS): the same text, the board as text plus both piece lists,
// the record, one retry with every legal move, the same fallback. Only the seat's
// thinking level differs, shown next to the name. Change anything here and
// bump XIANGQI_HARNESS.version.
//
// As chess (lib/chess-turn.ts), with what 五子棋 learned on Oct 20: no worked
// example a model could copy (the reply shape has placeholders), and a JSON
// schema sent with the ask (native schema or JSON mode by provider) with the
// tolerant reader kept as a backstop. Moves are coordinates, each in the
// record (and in the retry's legal list) with its WXF name too, so a model
// may think in either; a Chinese name (炮二平五) is also read.
//
// Harness v2 (Oct 20, as chess; owner: "you make the call"): the legal
// moves are NOT on the first ask, only on the retry after an illegal or
// unreadable answer, and the reply shape has no sample coordinate.

import * as providers from './providers'
import { adaptSchema, strictIsSafe } from './schema-adapt'
import { boardText, pieceList, XIANGQI_HARNESS } from './xiangqi-board'
import { fallbackMove, type XiangqiEngine, type XqPosition, type ResolvedXqMove } from './xiangqi-engine'

export { XIANGQI_HARNESS }

const LOG = '[xgame:xiangqi]'
const MODEL_TIMEOUT_MS = XIANGQI_HARNESS.timeoutSec * 1000

export type AskResult = { text: string; cost: number; timedOut: boolean }
export type AskFn = (prompt: string) => Promise<AskResult>

const sideName = (s: 'w' | 'b') => s === 'w' ? 'Red' : 'Black'

export function xiangqiPrompt(pos: XqPosition, objection: string | null): string {
  const me = sideName(pos.turn), other = sideName(pos.turn === 'w' ? 'b' : 'w')
  const record: string[] = []
  pos.history.forEach((m, i) => {
    const n = Math.floor(i / 2) + 1
    record.push(`${i % 2 === 0 ? `${n}.` : ''}${m.uci} (${m.wxf})`)
  })
  const last = pos.history.length ? pos.history[pos.history.length - 1] : null
  return [
    `You are playing xiangqi (Chinese chess) as ${me}. It is your move.`,
    'Standard xiangqi rules: you win by checkmating the enemy general, or when the side to move has no legal move at all (that side loses). Perpetual check loses. The game is a draw after 100 moves each.',
    'Coordinates: files a-i from Red\'s left, ranks 1-10 from Red\'s side (Red starts on ranks 1-4, Black on 7-10). A move is written as the from-square followed by the to-square (file letter and rank number, twice). In brackets each move in the record also has its WXF name (C2=5 is 炮二平五).',
    '',
    'Board (Red is UPPERCASE, Black is lowercase, "." is empty; rank 10 is at the top). K general, A advisor, B elephant, N horse, R chariot, C cannon, P soldier:',
    boardText(pos.fen),
    '',
    `Red pieces: ${pieceList(pos.fen, 'w')}`,
    `Black pieces: ${pieceList(pos.fen, 'b')}`,
    `Moves so far: ${record.length ? record.join(' ') : '(none: you open the game)'}`,
    ...(last ? [`${other} just played ${last.uci} (${last.wxf}).`] : []),
    ...(pos.check ? ['Your general is in CHECK. Only moves that get out of check are legal.'] : []),
    '',
    // The legal list only on the retry (see the header).
    ...(objection ? [`Your legal moves (all of them): ${pos.legalUci.map((u, i) => `${u} (${pos.legalWxf[i]})`).join(', ')}`, '', `Your previous answer was rejected: ${objection}. Choose one of the legal moves above.`, ''] : []),
    'Check IN THIS ORDER before answering:',
    '1. Is there a move that checkmates, or leaves the enemy with no legal move? Play it.',
    `2. What does ${other} threaten right now (a check, a capture of an undefended piece, a mate)? Deal with it.`,
    '3. Can you win material safely (a capture they cannot answer by taking back more)? A chariot is worth about two horses or cannons.',
    '4. Otherwise develop: chariots to open files, horses forward, cannons where they have a screen, and keep your general covered.',
    '',
    'Reply with ONLY this JSON, in this field order:',
    objection
      ? '{"why": "<one or two short sentences: the threat you see and your plan>", "move": "<one coordinate move, copied exactly from your legal moves>"}'
      : '{"why": "<one or two short sentences: the threat you see and your plan>", "move": "<your move: from-square then to-square>"}',
  ].join('\n')
}

export const XIANGQI_REPLY_SCHEMA = {
  type: 'object',
  properties: {
    why: { type: 'string', description: 'One or two short sentences: the threat you see and your plan.' },
    move: { type: 'string', description: 'One move: the from-square then the to-square.' },
  },
  required: ['why', 'move'],
  additionalProperties: false,
} as const

/** The move and reason of a reply. Tolerant of prose around the JSON, code
 *  fences and a reply cut off after the move. */
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
    const w = /["']why["']\s*:\s*["']([^"]{1,400})/.exec(text)
    if (w) why = w[1]
  }
  return { move: move?.trim() ?? null, why: why?.trim().slice(0, 240) || undefined }
}

export function providerAsk(model: any, opts: { userId: string | null; thinking: string | null }): AskFn {
  const jsonSchema = {
    name: 'xiangqi_move',
    schema: adaptSchema(XIANGQI_REPLY_SCHEMA, model.provider),
    strict: strictIsSafe(XIANGQI_REPLY_SCHEMA),
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
        }, [], { userId: opts.userId, surface: 'xgame-xiangqi' } as any, { thinking: opts.thinking, search: false, jsonSchema }).catch(() => resolve())
      }),
      new Promise<void>(resolve => { timer = setTimeout(() => { timedOut = true; console.warn(`${LOG} ${model.display_name}: timeout`); resolve() }, MODEL_TIMEOUT_MS) }),
    ])
    if (timer) clearTimeout(timer)
    return { text, cost, timedOut }
  }
}

export type AiTurn = ResolvedXqMove & {
  why?: string
  fallback: boolean
  retried: boolean
  rejected?: string[]
  timedOut?: boolean
  cost: number
  ms: number
}

/** One AI move. Never throws for a model's failure: an illegal or unreadable
 *  reply gets ONE retry carrying the reason; a second failure or a timeout
 *  (no retry) is the marked fallback. */
export async function playAiTurn(engine: XiangqiEngine, pos: XqPosition, ask: AskFn): Promise<AiTurn> {
  const t0 = Date.now()
  let cost = 0, why: string | undefined, objection: string | null = null
  const rejected: string[] = []
  let timedOut = false, asks = 0
  for (let attempt = 0; attempt < 1 + XIANGQI_HARNESS.retries; attempt++) {
    asks++
    const r = await ask(xiangqiPrompt(pos, objection))
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
