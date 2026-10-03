// lib/xtell-thread.ts — what a master rereads with each question (owner,
// Oct 2: "continue and read all").
//
// A conversation (one saved visit, `xtell_readings.turns`) can have several
// masters seated. Each master's thread is the questions put to it, or that
// it answered after joining (追加大師), and its own answers; never another
// master's answer (Sep 24). The page builds the same thread (`threadOf` in
// app/xtell/client.tsx); the reading route now builds it here, from the
// visitor's own saved conversation, so it no longer depends on what the page
// sends. It used to keep only the last 20 messages that the page sent, and a
// master forgot how a long conversation began.
//
// The chart and the birth details are not part of this: they ride with the
// master's instructions on every question. Sizing, budgets and summaries are
// shared by every surface: lib/conversation-memory.ts.

import { MESSAGE_CHARS, type Message } from './conversation-memory'

export type SavedTurn = { role?: unknown; content?: unknown; modelId?: unknown; to?: unknown; qid?: unknown }

/**
 * One master's thread in a saved conversation, before the question `qid`.
 * A question already saved under that qid (a master joining a question the
 * others have answered) is cut there, so the master sees what came before it.
 */
export function threadFor(turns: unknown, modelId: string, qid: string | null): Message[] {
  if (!Array.isArray(turns)) return []
  return threadIndices(turns, modelId, qid).map(i => ({ role: (turns[i] as SavedTurn).role as Message['role'], content: String((turns[i] as SavedTurn).content).slice(0, MESSAGE_CHARS) }))
}

/** The same thread, as positions in `turns` (so a caller can carry each
 *  message's own fields, e.g. its seq in xtell_messages). */
export function threadIndices(turns: unknown[], modelId: string, qid: string | null): number[] {
  let end = turns.length
  if (qid) {
    const at = turns.findIndex((t: any) => t?.role === 'user' && t.qid === qid)
    if (at >= 0) end = at
  }
  const ts = turns.slice(0, end) as SavedTurn[]
  const out: number[] = []
  for (let i = 0; i < ts.length; i++) {
    const tn = ts[i]
    if (typeof tn?.content !== 'string') continue
    if (tn.role === 'assistant') { if (tn.modelId === modelId) out.push(i); continue }
    if (tn.role !== 'user') continue
    let answered = false
    for (let j = i + 1; j < ts.length && ts[j]?.role === 'assistant'; j++) if (ts[j].modelId === modelId) answered = true
    const to = Array.isArray(tn.to) ? tn.to : null
    if (!to || to.includes(modelId) || answered) out.push(i)
  }
  return out
}
