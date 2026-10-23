// lib/xoracle-wall-check.ts — whether a wish may hang where everyone reads it.
//
// Three gates before any money moves (docs/GUANYIN-HANGING-PLAN.md):
//   1. wishProblem (lib/xoracle-wall.ts): contact details and addresses, by
//      pattern, on every plaque.
//   2. OpenAI's moderation (free, lib/moderation.ts) on every plaque.
//   3. Open plaques only: a quick house model asks whether the wish names or
//      points at a person, curses someone, sells something, or carries
//      personal facts. Japanese shrines learned this the hard way: plaques are
//      photographed and posted, and some carried a stranger's full name and
//      address with a curse. Family words (媽媽, my son) pass; a name does not.
// House-paid and nobody chose the model, so a failure falls over to another
// provider (lib/house-llm.ts's rule). GPT-6 Luna without reasoning, ~300
// tokens in: $0.000037 a wish (measured Oct 22: 10 of 10 sample wishes in
// four languages judged right: names, a title, curses, an ad, ordinary ones). Each call is logged in provider_calls under
// the writer's id. Server-only.

import * as providers from '@/lib/providers'
import { getModelByProviderName } from '@/lib/models'
import { moderate } from '@/lib/moderation'

const CHECKERS = [
  { provider: 'openai', model: 'gpt-6-luna', thinking: 'none' },
  { provider: 'google', model: 'gemini-3.1-flash-lite', thinking: null },
] as const
const TIMEOUT_MS = 15_000
const VERDICTS = ['ok', 'names_person', 'personal_info', 'harm', 'ad'] as const
export type WishVerdict = (typeof VERDICTS)[number]
const SCHEMA = {
  name: 'wish_check',
  schema: { type: 'object', properties: { verdict: { type: 'string', enum: [...VERDICTS] } }, required: ['verdict'], additionalProperties: false },
  strict: true,
}
const SYSTEM = `You check short wishes that people hang on a public wall outside a temple, where anyone can read and photograph them. Reply with JSON {"verdict": ...} and nothing else.
- "names_person": the wish contains the name of a private person: a full name, a surname with a title (王先生, 田中さん), a given name, a nickname or an @handle, even of the writer. Family and relationship words without a name are fine (媽媽, my son, おばあちゃん, 엄마, 男朋友, my boss). Deities, well-known public figures, sports teams, schools, companies and places are fine.
- "personal_info": contact details, an address, an ID or account number, or details that would identify a private person (a school class with a name, a workplace with a name).
- "harm": it wishes harm, illness, bad luck, death or a break-up on anyone, curses someone, or wants revenge.
- "ad": it advertises or sells something, or promotes a link, account or business.
- "ok": everything else, including sad, worried, romantic or ordinary wishes in any language.`

async function checkWith(c: (typeof CHECKERS)[number], text: string, userId: string): Promise<WishVerdict | null> {
  const model = await getModelByProviderName(c.provider, c.model).catch(() => null)
  if (!model?.enabled) return null
  let reply = '', error: string | undefined
  let timer: ReturnType<typeof setTimeout> | null = null
  await Promise.race([
    new Promise<void>(resolve => {
      providers.streamText(model, [{ role: 'user', content: `Wish:\n${text}` }], {
        onDelta: (t: string) => { reply += t },
        onDone: () => resolve(),
        onError: (m: string) => { error = m; resolve() },
      }, [], { userId }, {
        thinking: c.thinking, search: false, maxTokens: 60, system: SYSTEM,
        ...(c.provider === 'openai' ? { jsonSchema: SCHEMA } : { jsonMode: true }),
      }).catch((e: any) => { error = e?.message ?? String(e); resolve() })
    }),
    new Promise<void>(resolve => { timer = setTimeout(() => { error = 'timeout'; resolve() }, TIMEOUT_MS) }),
  ])
  if (timer) clearTimeout(timer)
  if (error) { console.warn(`[xoracle/wall] check by ${c.model} failed: ${error}`); return null }
  try {
    const v = JSON.parse(reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1))?.verdict
    return (VERDICTS as readonly string[]).includes(v) ? v : null
  } catch { return null }
}

/** The quick model's verdict, or null when no checker could answer. */
export async function checkWishWords(text: string, userId: string): Promise<WishVerdict | null> {
  for (const c of CHECKERS) {
    const v = await checkWith(c, text, userId)
    if (v) return v
  }
  return null
}

/** Gates 2 and 3. `open`: the plaque will show its words (not sealed).
 *  'unavailable' means a check could not run: an open plaque is refused (the
 *  visitor may seal it instead); a sealed one only needs moderation's 'ok'
 *  or 'unavailable', since nobody else reads it. */
export type WishCheck = 'ok' | 'refused' | 'unavailable' | Exclude<WishVerdict, 'ok'>
export async function checkWish(text: string, userId: string, open: boolean): Promise<WishCheck> {
  const mod = await moderate({ text })
  if (mod === 'refused') return 'refused'
  if (!open) return 'ok'
  if (mod === 'unavailable') return 'unavailable'
  const v = await checkWishWords(text, userId)
  return v ?? 'unavailable'
}
