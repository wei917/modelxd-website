// lib/xiang-scan.ts — 相學館's two model steps (Oct 6), house-paid like
// 解夢's and 孫子兵法's lookups: nobody chose these models, so a failure
// falls over to another provider. Calls go through the provider router, so
// each is logged in provider_calls under the visitor's id with its cost.
//
// 1. The photo check, one photo at a time, on a cheap model, lenient
//    (owner: "don't be too harsh"): only a photo that is clearly not a face
//    or a palm, or far too dark or blurred, is sent back with a tip. Gemini
//    3.1 Flash-Lite got all three test photos right in about a second for
//    $0.0004 each; GPT-6 Luna too, in 3 s; Qwen 3.6-Plus called the left
//    palm a right one.
// 2. The 相盤 reader, all photos at once (both people's in a two-person
//    reading), on a qualified vision model. Picked by
//    scripts/xiang-model-test.ts on made-up photos (Oct 6): Claude Opus 5.5
//    placed the face points as well as GPT-6 Astra and Claude Fable 5.1, in
//    52 s for $0.11 (Astra 136 s, $0.25; Fable 72 s, $0.25); GPT-6.1 Sol was
//    cheapest ($0.05, 77 s) and stands in. Claude Sonnet 5 and Gemini 3.1
//    Pro misplaced points; Grok 4.7 took 405 s.
//
// The palm lines are described, not drawn: no model placed them on the
// creases well enough (owner, Oct 6: "still not accurate, I would rather
// not showing those lines"; the trials are in docs/XORACLE-PAGE.md).
//
// Server-only. The photos pass through; nothing here stores them.

import * as providers from '@/lib/providers'
import { getModelByProviderName } from '@/lib/models'
import { checkSystem, checkPrompt, asCheck, readerSystem, readerPrompt, parseJson, cleanChart, type PhotoCheck, type XiangChart, type XiangWho, type Photo } from '@/lib/xiang'

type Runner = { provider: string; model: string; thinking: string | null }
export const CHECKERS: Runner[] = [
  { provider: 'google', model: 'gemini-3.1-flash-lite', thinking: null },
  { provider: 'openai', model: 'gpt-6-luna', thinking: null },
]
export const READERS: Runner[] = [
  { provider: 'anthropic', model: 'claude-opus-5-5', thinking: null },
  { provider: 'openai', model: 'gpt-6.1-sol', thinking: null },
]
const CHECK_TIMEOUT_MS = 25_000
const READ_TIMEOUT_MS = 150_000

export type { Photo } from '@/lib/xiang'
export { photosOf } from '@/lib/xiang'


async function run(r: Runner, system: string, text: string, photos: Photo[], userId: string, timeoutMs: number, maxTokens: number): Promise<string | null> {
  const model = await getModelByProviderName(r.provider, r.model).catch(() => null)
  if (!model?.enabled) return null
  let out = '', error: string | undefined
  let timer: ReturnType<typeof setTimeout> | null = null
  await Promise.race([
    new Promise<void>(resolve => {
      providers.streamText(model, [{ role: 'user', content: text }], {
        onDelta: (t: string) => { out += t },
        onDone: () => resolve(),
        onError: (m: string) => { error = m; resolve() },
      }, photos.map(p => ({ buffer: p.buffer, mediaType: p.mediaType })), { userId }, {
        thinking: r.thinking, search: false, maxTokens, system,
        ...(r.provider === 'google' || r.provider === 'alibaba' ? { jsonMode: true } : {}),
      }).catch((e: any) => { error = e?.message ?? String(e); resolve() })
    }),
    new Promise<void>(resolve => { timer = setTimeout(() => { error = 'timeout'; resolve() }, timeoutMs) }),
  ])
  if (timer) clearTimeout(timer)
  if (error) { console.warn(`[xoracle/xiang] ${r.model} failed: ${error}`); return null }
  return out
}

/** Each photo's check. A photo no checker could look at counts as fine:
 *  the reader still sees it, and the check is a courtesy, not a gate. */
export async function checkPhotos(photos: Photo[], lang: string, userId: string): Promise<Record<string, PhotoCheck>> {
  const entries = await Promise.all(photos.map(async p => {
    for (const r of CHECKERS) {
      const text = await run(r, checkSystem(lang), checkPrompt(p.key, lang), [p], userId, CHECK_TIMEOUT_MS, 200)
      const c = text ? asCheck(parseJson(text)) : null
      if (c) return [p.key, c] as const
    }
    return [p.key, { ok: true, is: p.key === 'face' ? 'face' : 'palm', tip: '' } as PhotoCheck] as const
  }))
  return Object.fromEntries(entries)
}

/** The 相盤, and the model that wrote it; null when no reader could. With
 *  the other person's photos, one call reads both (theirs after the
 *  visitor's), so the two are described the same way. */
export async function readPhotos(photos: Photo[], who: XiangWho, lang: string, userId: string, partner?: { who: XiangWho; photos: Photo[] }): Promise<XiangChart | null> {
  const have = photos.map(p => p.key), partnerHave = partner?.photos.map(p => p.key) ?? []
  const all = [...photos, ...(partner?.photos ?? [])]
  const prompt = readerPrompt(have, who, lang, partner ? { ...partner.who, have: partnerHave } : undefined)
  for (const r of READERS) {
    const text = await run(r, readerSystem(lang), prompt, all, userId, READ_TIMEOUT_MS, partner ? 10_000 : 6000)
    const chart = text ? cleanChart(parseJson(text), have, r.model, lang, partnerHave) : null
    if (chart) return chart
    if (text) console.warn(`[xoracle/xiang] ${r.model}: unreadable reply ${JSON.stringify(text.slice(0, 200))}`)
  }
  return null
}
