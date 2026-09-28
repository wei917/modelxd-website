// lib/xtell-daily-model.ts — who writes 今日運勢's free daily reading.
//
// Qwen 3.8 Flash, thinking off (owner, Sep 28: it was Claude Sonnet 5). It
// is house-paid and nobody chose it, so when it cannot answer, or answers
// with something the reading parser rejects, the old writer stands in
// (house-llm: Claude, then OpenAI). Qwen goes through the provider router,
// so each reading is logged in provider_calls under the visitor's id with
// its cost; nothing is debited.
//
// Server-only.

import * as providers from '@/lib/providers'
import { getModelByProviderName } from '@/lib/models'
import { houseCall } from '@/lib/house-llm'

const PRIMARY = { provider: 'alibaba', model: 'qwen3.8-flash', thinking: 'thinking_false' } as const
/** The stand-ins: XTELL_DAILY_MODEL, then the site agent's Claude models
 *  (house-llm falls over to OpenAI when Anthropic cannot serve). */
const FALLBACK = [process.env.XTELL_DAILY_MODEL, process.env.SITE_AGENT_MODEL, 'claude-sonnet-5', 'claude-haiku-4-5'].filter(Boolean) as string[]
const TIMEOUT_MS = 45_000
const MAX_TOKENS = 700

async function viaQwen(system: string, content: string, userId: string): Promise<string | null> {
  const model = await getModelByProviderName(PRIMARY.provider, PRIMARY.model).catch(() => null)
  if (!model?.enabled) return null
  let text = '', failed = false
  let timer: ReturnType<typeof setTimeout> | null = null
  await Promise.race([
    new Promise<void>(resolve => {
      providers.streamText(model, [{ role: 'user', content }], {
        onDelta: (t: string) => { text += t },
        onDone: () => resolve(),
        onError: () => { failed = true; resolve() },
      }, [], { userId }, { thinking: PRIMARY.thinking, search: false, maxTokens: MAX_TOKENS, system, jsonMode: true })
        .catch(() => { failed = true; resolve() })
    }),
    new Promise<void>(resolve => { timer = setTimeout(() => { failed = true; resolve() }, TIMEOUT_MS) }),
  ])
  if (timer) clearTimeout(timer)
  return failed ? null : text
}

/** The day's reading text, from Qwen or, when its reply is missing or not
 *  `accept`ed, from the stand-in; null when neither could answer. Errors
 *  are logged generically: a provider error can quote the request, and the
 *  request holds the visitor's chart. */
export async function dailyText(o: { system: string; content: string; userId: string; accept: (text: string) => boolean }): Promise<string | null> {
  const first = await viaQwen(o.system, o.content, o.userId).catch(() => null)
  if (first && o.accept(first)) return first
  console.warn(`[xtell/daily] ${PRIMARY.model} ${first ? 'unreadable' : 'unavailable'}; using the stand-in`)
  try {
    const resp = await houseCall({
      tag: '[xtell/daily]', models: FALLBACK, maxTokens: MAX_TOKENS, disableThinking: true,
      system: o.system, messages: [{ role: 'user', content: o.content }],
    })
    const text = (resp?.content ?? []).filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('')
    return text && o.accept(text) ? text : null
  } catch {
    return null
  }
}
