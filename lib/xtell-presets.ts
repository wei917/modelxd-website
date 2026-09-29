// lib/xtell-presets.ts — the three teacher choices and the pre-send estimate
// every paid XTell question uses: the temple rooms (app/xtell/client.tsx) and
// the daily fortune's follow-up (XTellDaily). One place, so both show the same
// teachers and the same price before anything is sent. Client-safe.

/** What these helpers read from an ai_models row (a PickerModel fits). */
export type PresetModel = { model_name: string; provider: string; model_pricing?: any; output_config?: any }

// Upfront estimate per master, shown under the composer (Codex QA, Sep 25:
// nothing said what a question would cost before Send). The system prompt
// measured 1.6k–2.8k chars (八字 / 紫微: persona + facts + classics), and CJK
// runs near one token per char, so 3,000 input tokens covers it, plus the
// thread and the question; 800 output tokens is a full reading with thinking
// on. Search terms mirror XCreate's estimator. A ceiling, not a quote: the
// receipt is the cost under each reply.
export const EST_PROMPT_TOKENS = 3000, EST_OUT_TOKENS = 800, EST_SEARCHES = 8, EST_READ_TOKENS = 30_000
// 易學堂 can include both hexagrams and their 文言. Its longest measured
// fixed cast prompt exceeds 4,200 characters before the language line.
export const EST_YIXUE_PROMPT_TOKENS = 5500
export function rateOf(r: any, level: string | null): number {
  if (r == null) return 0
  if (typeof r === 'number') return r
  if (level && r.by_level && typeof r.by_level[level] === 'number') return r.by_level[level]
  return typeof r.default === 'number' ? r.default : 0
}
export function estimateReadingUsd(m: PresetModel, o: { thinking: string | null; search: boolean }, chars: number, promptTokens = EST_PROMPT_TOKENS): number | null {
  const p = m.model_pricing ?? {}, tk = p.tokens ?? {}
  const tin = rateOf(tk.text_input, o.thinking), tout = rateOf(tk.text_output, o.thinking)
  if (!tin && !tout) return null
  const inTok = promptTokens + chars + (o.search ? EST_READ_TOKENS : 0)
  return (o.search ? EST_SEARCHES * (p.per_search ?? 0) : 0) + (inTok * tin + EST_OUT_TOKENS * tout) / 1_000_000
}
export const fmtUsd = (v: number) => v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(3)}`

// Three plain choices instead of a 26-row model list (audit, product): each
// names the model it will seat and its estimate, and changes the first seat
// only when pressed — never on its own, never replacing a chosen teacher
// silently (Codex review). The first enabled model in each list is used;
// the full picker stays one click away. Owner's call which models back
// each preset; this is the one place to change it.
export const PRESETS: Array<{ key: 'light' | 'balanced' | 'deep'; models: string[] }> = [
  { key: 'light', models: ['qwen3.8-flash'] },
  { key: 'balanced', models: ['qwen3.8-max', 'gemini-3.8-flash'] },
  // Owner, Sep 26: GPT-6 Astra is the deep one, and only it: if Astra is
  // not offered for XTell, the button is hidden rather than filled by
  // another model.
  { key: 'deep', models: ['gpt-6-astra'] },
]

/** A row's declared thinking levels. */
export const levelsOf = (m: PresetModel): string[] => ((m.output_config?.text?.thinking_levels ?? []) as string[])
/** The house default a seat starts with: every Qwen row thinking off (Flash
 *  too since Sep 29: with it on, a 塔羅 answer ran 9,728 tokens and 145 s),
 *  everything else the provider's own default (the reading route applies
 *  the same rule when no level is sent). */
export function defaultThinking(m: PresetModel): string | null {
  if (m.provider !== 'alibaba') return null
  return levelsOf(m).includes('thinking_false') ? 'thinking_false' : null
}
