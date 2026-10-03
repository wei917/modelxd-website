// lib/conversation-memory.ts — what a model keeps of a long conversation,
// shared by every surface that holds one (XTell first; XTalk next). Owner,
// Oct 3: "this problem exists for all subdomain not just XTell", "we should
// modularize now". The idea is compacting a chat, as Claude Code does: the
// model rereads the whole conversation until it nears its limit, then its
// own model summarizes the older part and rereads the summary plus the
// recent messages word for word.
//
// Shared here, all from the catalog row (ai_models), like prices:
//   - the model's limit (`context_window`: max input tokens per request)
//     and its price jump (`model_pricing.long_context.threshold_input_tokens`,
//     where the provider charges more for a longer request);
//   - what a reply actually read (`tokensRead`);
//   - fitting messages to the room left (`rawBudget`, `fitBudget`);
//   - when to summarize (`summaryPointOf`) and the summarize step itself
//     (`maybeSummarize`).
// Each surface keeps its own storage, who sees which message, and what its
// summary must keep: it passes them in. Pure: safe in the browser too.

export type Message = { role: 'user' | 'assistant'; content: string }
/** A stored message with its place in the conversation (any increasing number). */
export type Numbered<T = Message> = T & { seq: number }

/** Used while a model's row has no limit. */
export const DEFAULT_WINDOW = 100_000
/** Summarize once a reply read more than this share of the limit... */
export const SUMMARIZE_AT = 0.7
/** ...or of the price jump, if that comes first. */
export const BEFORE_JUMP = 0.9
/** At the summary point, this share of the limit stays word for word. */
export const KEEP_RAW = 0.4
/** Room left for the reply. */
export const ANSWER_ROOM = 8_000
/** One message, at most: far above any answer or question. */
export const MESSAGE_CHARS = 16_000
/** The default budget for `fitBudget`. */
export const HISTORY_TOKENS = DEFAULT_WINDOW

/** Tokens, roughly: a CJK character, kana or hangul is about one token; other
 *  text about four characters a token. The provider's own count comes back
 *  with each reply; this only sizes what is sent. */
export function approxTokens(s: string): number {
  let n = 0
  for (const ch of s) n += /[⺀-鿿぀-ヿ가-힯豈-﫿＀-￯]/.test(ch) ? 1 : 0.25
  return Math.ceil(n)
}

/** The model's limit in tokens: the catalog's, else 100k. */
export const windowOf = (model: any): number =>
  typeof model?.context_window === 'number' && model.context_window > 0 ? model.context_window : DEFAULT_WINDOW

/** Where the provider's price per token goes up for a longer request, or
 *  null (e.g. OpenAI above 272k input, xAI above 200k). */
export const priceJumpOf = (model: any): number | null => {
  const n = model?.model_pricing?.long_context?.threshold_input_tokens
  return typeof n === 'number' && n > 0 ? n : null
}

/** The most one request should carry: the limit, or the price jump if it
 *  comes first. */
export const maxInputOf = (model: any): number => Math.min(windowOf(model), priceJumpOf(model) ?? Infinity)

/** Summarize after a reply that read more than this: 70% of the limit, or
 *  just before the price jump if that comes first. */
export const summaryPointOf = (model: any): number => {
  const w = windowOf(model) * SUMMARIZE_AT, jump = priceJumpOf(model)
  return Math.floor(jump ? Math.min(w, jump * BEFORE_JUMP) : w)
}

/** How much stays word for word when summarizing (40% of the limit, in
 *  proportion when the price jump sets the summary point). */
export const keepRawOf = (model: any): number => Math.floor(summaryPointOf(model) * KEEP_RAW / SUMMARIZE_AT)

/** How many tokens of raw messages fit beside the instructions (and any
 *  summary), leaving room for the reply. */
export const rawBudget = (model: any, fixedTokens: number): number =>
  Math.max(4_000, Math.floor(Math.min(windowOf(model) * 0.9, priceJumpOf(model) ?? Infinity)) - fixedTokens - ANSWER_ROOM)

/** What a model read for one reply, in tokens: the provider's input count,
 *  cache hits included, the same on every provider. Anthropic reports its
 *  cache reads apart, and lib/providers/anthropic.ts folds them back in
 *  (Oct 3, 7688e02), with its cache writes at 1.25x, so a turn that writes
 *  the cache reads a little high, never low. */
export const tokensRead = (r: { inputTokens?: number | null; cachedTokens?: number | null }): number | null =>
  typeof r.inputTokens === 'number' && r.inputTokens > 0 ? r.inputTokens : null

/** The most recent messages that fit the budget, oldest first; how many
 *  older ones did not. The latest message is always kept. */
export function fitBudget<T extends Message>(history: T[], budget = HISTORY_TOKENS): { kept: T[]; dropped: number } {
  let used = 0, from = history.length
  while (from > 0) {
    const t = approxTokens(history[from - 1].content)
    if (used + t > budget && from < history.length) break
    used += t; from--
  }
  return { kept: history.slice(from), dropped: from }
}

/** A token count as people read it: 800, 28k, 922k, 1M, 1.05M. */
export const formatTokens = (n: number): string =>
  n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(2)}M` : n >= 1_000 ? `${Math.round(n / 1_000)}k` : String(Math.round(n))

export type SummaryRun = { text: string; inputTokens: number | null; outputTokens: number | null; cost: number | null }

/**
 * After a reply: if it read more than the summary point, the model folds the
 * older part of its thread, with its previous summary, into a new summary,
 * keeping the newest messages word for word. With `now` (a person pressed
 * "summarize now"; owner, Oct 3) the point is skipped and the whole
 * conversation so far goes into the summary, like compacting a chat (the
 * owner, testing it: a summary that left out the latest question "is
 * bad"). Returns what was saved, or why not. Never throws. The surface
 * supplies:
 *   load    its previous summary and the thread after it (null: no storage);
 *   prompt  the summary instructions and the text to summarize;
 *   run     the model call (its own model, billed through the surface);
 *   save    'saved', 'duplicate', or an error message;
 *   charge  the visitor's bill for the summary, when it has a cost.
 */
export async function maybeSummarize<T extends Numbered>(o: {
  model: any
  inputTokens: number | null
  /** Summarize now, whatever the size: the whole conversation so far. */
  now?: boolean
  load: () => Promise<{ summary: { text: string; through_seq: number } | null; thread: T[] } | null>
  prompt: (p: { oldSummary: string | null; fold: T[] }) => { system: string; content: string }
  run: (system: string, content: string) => Promise<SummaryRun | null>
  save: (s: SummaryRun & { through_seq: number }) => Promise<string>
  charge: (usd: number) => Promise<void>
}): Promise<{ saved: boolean; reason: string; through_seq?: number; text?: string }> {
  try {
    if (!o.now && (!o.inputTokens || o.inputTokens <= summaryPointOf(o.model))) return { saved: false, reason: 'under the threshold' }
    const loaded = await o.load()
    if (!loaded) return { saved: false, reason: 'messages table missing' }
    const { summary, thread } = loaded
    // The newest messages within the keep share stay word for word;
    // everything before them is folded. On a press, everything is.
    let keep = 0
    if (!o.now) {
      const room = keepRawOf(o.model)
      let used = 0
      for (let i = thread.length - 1; i >= 0; i--) {
        const t = approxTokens(thread[i].content)
        if (used + t > room) break
        used += t; keep++
      }
    }
    const fold = thread.slice(0, thread.length - keep)
    if (fold.length === 0) return { saved: false, reason: 'nothing old enough to fold' }
    const p = o.prompt({ oldSummary: summary?.text ?? null, fold })
    const out = await o.run(p.system, p.content)
    if (!out?.text?.trim()) return { saved: false, reason: 'the model wrote nothing' }
    const through = fold[fold.length - 1].seq
    const saved = await o.save({ ...out, text: out.text.trim(), through_seq: through })
    if (saved === 'duplicate') return { saved: false, reason: 'already summarized to that point' }
    if (saved !== 'saved') return { saved: false, reason: `save failed: ${saved}` }
    if (out.cost && out.cost > 0) await o.charge(out.cost)
    return { saved: true, reason: 'saved', through_seq: through, text: out.text.trim() }
  } catch (e) {
    return { saved: false, reason: `failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}
