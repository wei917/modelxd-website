// lib/jiemeng-scan.ts — which lines of 《周公解夢》 a dream points at, read by
// a quick model (owner, Sep 27: "ask another quick AI to do a pre scan").
//
// House-paid: the lookup is free to the visitor, and nobody chose these
// models, so a failure falls over to another provider (lib/house-llm.ts's
// rule: who chose the model, not who pays). GPT-6 Luna without reasoning
// first, Gemini 3.1 Flash-Lite second. Each sees the whole book as a fixed
// system prompt (lib/jiemeng.ts scanSystem, ~11k tokens, cached by the
// provider after the first call) and the dream as the message, and answers
// with line numbers, which lib/jiemeng.ts checks against the book. Calls go
// through the provider router, so each is logged in provider_calls under the
// visitor's id with its cost.
//
// Measured Sep 27 (nine dreams in four languages): Luna 1.1-2.8s, $0.0011
// uncached and $0.00012 once the book is cached, zero to two lines each,
// none unrelated, though it missed 見嫁娶 for an ex's wedding. Flash-Lite
// 0.7-0.9s, $0.0029 / $0.0011, and found it. Qwen 3.8 Flash was the
// first fallback and was dropped: eight lines for a dream of a late
// grandmother cooking, half of them beside the point (棺殮死人, 面對官者).
//
// Server-only.

import * as providers from '@/lib/providers'
import { getModelByProviderName } from '@/lib/models'
import { scanSystem, scanIds } from '@/lib/jiemeng'

export const SCANNERS = [
  { provider: 'openai', model: 'gpt-6-luna', thinking: 'none' },
  { provider: 'google', model: 'gemini-3.1-flash-lite', thinking: null },
] as const
const TIMEOUT_MS = 25_000
const SCHEMA = {
  name: 'dream_lines',
  schema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'integer' } } }, required: ['ids'], additionalProperties: false },
  strict: true,
}

type Scanner = (typeof SCANNERS)[number]

/** One scanner's answer: the line numbers, or null (disabled, failed, timed
 *  out, or a reply that is not the JSON asked for). */
export async function scanWith(s: Scanner, dream: string, userId: string): Promise<number[] | null> {
  const model = await getModelByProviderName(s.provider, s.model).catch(() => null)
  if (!model?.enabled) return null
  let text = '', error: string | undefined
  let timer: ReturnType<typeof setTimeout> | null = null
  await Promise.race([
    new Promise<void>(resolve => {
      providers.streamText(model, [{ role: 'user', content: `夢（照錄）：\n${dream}` }], {
        onDelta: (t: string) => { text += t },
        onDone: () => resolve(),
        onError: (m: string) => { error = m; resolve() },
      }, [], { userId }, {
        thinking: s.thinking, search: false, maxTokens: 300, system: scanSystem(),
        ...(s.provider === 'openai' ? { jsonSchema: SCHEMA } : { jsonMode: true }),
      }).catch((e: any) => { error = e?.message ?? String(e); resolve() })
    }),
    new Promise<void>(resolve => { timer = setTimeout(() => { error = 'timeout'; resolve() }, TIMEOUT_MS) }),
  ])
  if (timer) clearTimeout(timer)
  const ids = error ? null : scanIds(text)
  if (!ids) console.warn(`[xtell/jiemeng] scan by ${s.model} failed: ${error ?? `unreadable reply ${JSON.stringify(text.slice(0, 200))}`}`)
  return ids
}

/** The book's line numbers for this dream, and the model that chose them;
 *  null when no scanner could answer (the page then says so). */
export async function scanDream(dream: string, userId: string): Promise<{ ids: number[]; model: string } | null> {
  for (const s of SCANNERS) {
    const ids = await scanWith(s, dream, userId)
    if (ids) return { ids, model: s.model }
  }
  return null
}
