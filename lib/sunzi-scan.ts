// lib/sunzi-scan.ts — which lines of 《孫子兵法》 a situation calls for, read
// by a quick model, with a plain translation of each (Sep 29). The same
// scanners and rules as 解夢's (lib/jiemeng-scan.ts): house-paid, nobody
// chose these models, so a failure falls over to another provider. Each sees
// the whole book as a fixed system prompt (lib/sunzi.ts scanSystem, cached by
// the provider after the first call) and the situation as the message, and
// answers with line numbers and translations, which lib/sunzi.ts checks
// against the book. Calls go through the provider router, so each is logged
// in provider_calls under the visitor's id with its cost.
//
// Server-only.

import * as providers from '@/lib/providers'
import { getModelByProviderName } from '@/lib/models'
import { scanSystem, scanMessage, scanPicks, type Pick } from '@/lib/sunzi'
import { SCANNERS } from '@/lib/jiemeng-scan'

const TIMEOUT_MS = 30_000
const SCHEMA = {
  name: 'sunzi_lines',
  schema: {
    type: 'object',
    properties: { picks: { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' }, gloss: { type: 'string' } }, required: ['id', 'gloss'], additionalProperties: false } } },
    required: ['picks'], additionalProperties: false,
  },
  strict: true,
}

type Scanner = (typeof SCANNERS)[number]

/** One scanner's answer: the picks, or null (disabled, failed, timed out, or
 *  a reply that is not the JSON asked for). */
export async function scanWith(s: Scanner, message: string, userId: string): Promise<Pick[] | null> {
  const model = await getModelByProviderName(s.provider, s.model).catch(() => null)
  if (!model?.enabled) return null
  let text = '', error: string | undefined
  let timer: ReturnType<typeof setTimeout> | null = null
  await Promise.race([
    new Promise<void>(resolve => {
      providers.streamText(model, [{ role: 'user', content: message }], {
        onDelta: (t: string) => { text += t },
        onDone: () => resolve(),
        onError: (m: string) => { error = m; resolve() },
      }, [], { userId }, {
        thinking: s.thinking, search: false, maxTokens: 900, system: scanSystem(),
        ...(s.provider === 'openai' ? { jsonSchema: SCHEMA } : { jsonMode: true }),
      }).catch((e: any) => { error = e?.message ?? String(e); resolve() })
    }),
    new Promise<void>(resolve => { timer = setTimeout(() => { error = 'timeout'; resolve() }, TIMEOUT_MS) }),
  ])
  if (timer) clearTimeout(timer)
  const picks = error ? null : scanPicks(text)
  if (!picks) console.warn(`[xtell/sunzi] scan by ${s.model} failed: ${error ?? `unreadable reply ${JSON.stringify(text.slice(0, 200))}`}`)
  return picks
}

/** The book's lines for this situation, and the model that chose them; null
 *  when no scanner could answer (the page then says so). */
export async function scanSituation(situation: string, ask: string, lang: string, userId: string): Promise<{ picks: Pick[]; model: string } | null> {
  const message = scanMessage(situation, ask, lang)
  for (const s of SCANNERS) {
    const picks = await scanWith(s, message, userId)
    if (picks) return { picks, model: s.model }
  }
  return null
}
