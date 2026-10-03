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
// master's instructions on every question.

export type SavedTurn = { role?: unknown; content?: unknown; modelId?: unknown; to?: unknown; qid?: unknown }
export type Message = { role: 'user' | 'assistant'; content: string }

/** About 100 full rounds, inside every model's window with room for the
 *  chart and the answer. A conversation longer than this keeps its most
 *  recent part. */
export const HISTORY_TOKENS = 100_000
/** One message, at most: far above any answer (1,000 字) or question. */
export const MESSAGE_CHARS = 16_000

/** Tokens, roughly: a CJK character, kana or hangul is about one token; other
 *  text about four characters a token. The provider's own count comes back
 *  with the answer; this only sizes what is sent. */
export function approxTokens(s: string): number {
  let n = 0
  for (const ch of s) n += /[⺀-鿿぀-ヿ가-힯豈-﫿＀-￯]/.test(ch) ? 1 : 0.25
  return Math.ceil(n)
}

/**
 * One master's thread in a saved conversation, before the question `qid`.
 * A question already saved under that qid (a master joining a question the
 * others have answered) is cut there, so the master sees what came before it.
 */
export function threadFor(turns: unknown, modelId: string, qid: string | null): Message[] {
  if (!Array.isArray(turns)) return []
  let end = turns.length
  if (qid) {
    const at = turns.findIndex((t: SavedTurn) => t?.role === 'user' && t.qid === qid)
    if (at >= 0) end = at
  }
  const ts = turns.slice(0, end) as SavedTurn[]
  const out: Message[] = []
  for (let i = 0; i < ts.length; i++) {
    const tn = ts[i]
    if (typeof tn?.content !== 'string') continue
    if (tn.role === 'assistant') { if (tn.modelId === modelId) out.push({ role: 'assistant', content: tn.content.slice(0, MESSAGE_CHARS) }); continue }
    if (tn.role !== 'user') continue
    let answered = false
    for (let j = i + 1; j < ts.length && ts[j]?.role === 'assistant'; j++) if (ts[j].modelId === modelId) answered = true
    const to = Array.isArray(tn.to) ? tn.to : null
    if (!to || to.includes(modelId) || answered) out.push({ role: 'user', content: tn.content.slice(0, MESSAGE_CHARS) })
  }
  return out
}

/** The most recent messages that fit the budget, oldest first; how many
 *  older ones did not. */
export function fitBudget(history: Message[], budget = HISTORY_TOKENS): { kept: Message[]; dropped: number } {
  let used = 0, from = history.length
  while (from > 0) {
    const t = approxTokens(history[from - 1].content)
    if (used + t > budget && from < history.length) break
    used += t; from--
  }
  return { kept: history.slice(from), dropped: from }
}
