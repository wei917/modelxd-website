// lib/story-digest-run.ts — SERVER-ONLY orchestration of the story digest:
// pick the models from the catalog, MAP every window of the text to a part
// summary, REDUCE the summaries into one STORY BIBLE. The pure pieces
// (chunking, prompts, parsing) live in lib/story-digest.ts; the HTTP shell
// is app/api/xdirector/digest/route.ts. Kept apart so a script can run the
// pipeline on a file directly, without auth or storage.
//
// House-paid, like the director's own turns and the song transcription: a
// whole novel on the cheapest catalog text model is well under a dollar,
// and a story brief shouldn't nickel-and-dime. Every call still goes
// through the provider router, so provider_calls logs it with the user id
// and its cost.

import * as providers from './providers'
import { HOUSE_OPENAI_MODELS } from './house-llm'
import type { ModelInfo } from './providers/types'
import {
  splitIntoWindows, mapPrompt, reducePrompt, parseBible, renderBible, type StoryBible,
} from './story-digest'

const LOG = '[xdirector:digest]'
const MAP_TIMEOUT_MS    = 150_000
const REDUCE_TIMEOUT_MS = 200_000
const CONCURRENCY       = 8   // a 21-window novel = 3 waves; well inside every provider's concurrency

export type DigestModels = {
  map: ModelInfo; reduce: ModelInfo
  /** Stand-ins on a DIFFERENT provider, used when the first pick's provider
   *  cannot serve the call at all (the Anthropic org spending limit, Aug 28).
   *  House-paid work has no reason to fail over one provider's account. */
  mapAlt?: ModelInfo; reduceAlt?: ModelInfo
}

/**
 * Map step: the cheapest enabled text model (it reads a lot and decides
 * little). Reduce step: the director's own model, Sonnet 5 — choosing the
 * ten beats that matter IS the judgment, and the only part worth paying
 * for. `XDIRECTOR_DIGEST_MODEL` ("provider/model_name" or "model_name")
 * overrides the map pick.
 */
export function pickDigestModels(rows: ModelInfo[]): DigestModels | null {
  const text = rows.filter(m =>
    m.enabled
    && (m.output_modalities ?? []).includes('text')
    && ((m.modes ?? []) as string[]).includes('text_to_text'))
  if (text.length === 0) return null
  const price = (m: ModelInfo) => {
    const v = Number((m.model_pricing as any)?.tokens?.text_input)
    return Number.isFinite(v) ? v : Number.POSITIVE_INFINITY
  }
  const sorted = [...text].sort((a, b) => price(a) - price(b))
  const want = process.env.XDIRECTOR_DIGEST_MODEL?.trim()
  const override = want ? text.find(m => `${m.provider}/${m.model_name}` === want || m.model_name === want) : undefined
  const map = override ?? sorted[0]
  const reduce = text.find(m => m.provider === 'anthropic' && m.model_name === 'claude-sonnet-5') ?? map
  // Stand-ins live on another provider by construction — a second Claude is
  // no help when the Anthropic ACCOUNT is what failed. The reduce stand-in
  // walks the house's OpenAI list in order (same list lib/house-llm.ts uses,
  // so there is one place naming them); the map stand-in is just the
  // cheapest model that isn't on the map pick's provider.
  const reduceAlt = HOUSE_OPENAI_MODELS
    .map(name => text.find(m => m.provider === 'openai' && m.model_name === name))
    .find(Boolean) ?? sorted.find(m => m.provider !== reduce.provider)
  const mapAlt = sorted.find(m => m.provider !== map.provider)
  return { map, reduce, mapAlt, reduceAlt }
}

/** One non-streamed text call: collect the deltas, resolve on done/error/timeout. */
async function runText(model: ModelInfo, prompt: string, userId: string | null, timeoutMs: number, maxTokens?: number):
  Promise<{ text: string; cost: number; ok: boolean; error?: string }> {
  let full = '', cost = 0, error: string | undefined
  let timer: ReturnType<typeof setTimeout> | null = null
  await Promise.race([
    new Promise<void>(resolve => {
      providers.streamText(model, [{ role: 'user', content: prompt }], {
        onDelta: (t: string) => { full += t },
        onDone:  (r: any) => { cost += r?.cost ?? 0; resolve() },
        onError: (m: string) => { error = m; resolve() },
      }, [], { userId, surface: 'xdirector-digest' } as any, { thinking: null, search: false, maxTokens })
        .catch((e: any) => { error = e?.message ?? String(e); resolve() })
    }),
    new Promise<void>(resolve => { timer = setTimeout(() => { error = 'timeout'; resolve() }, timeoutMs) }),
  ])
  if (timer) clearTimeout(timer)
  return { text: full.trim(), cost, ok: !error && full.trim().length > 0, error }
}

async function pool<T, R>(items: T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i) }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker))
  return out
}

export type DigestResult = {
  bible: StoryBible
  text: string       // renderBible(bible) — what the user and the director both read
  windows: number
  chars: number
  cost: number
  model: string      // display name of the reduce model (the one that chose the beats)
}

export async function digestDocument(raw: string, opts: {
  lang?: string; focus?: string; userId: string | null; models: DigestModels
}): Promise<DigestResult> {
  const windows = splitIntoWindows(raw)
  if (windows.length === 0) throw new Error('The document has no readable text.')
  const { map, reduce } = opts.models
  let cost = 0

  // MAP — every window, a few at a time.
  const parts = await pool(windows, CONCURRENCY, async w => {
    const prompt = mapPrompt(w, windows.length, opts.lang, opts.focus)
    const r = await runText(map, prompt, opts.userId, MAP_TIMEOUT_MS)
    cost += r.cost
    if (r.ok) return r.text
    console.warn(`${LOG} map ${w.index + 1}/${windows.length} failed on ${map.display_name}: ${r.error}`)
    // One retry on the other provider. Without it a provider-wide outage
    // fails every window at once and the whole digest throws, which is the
    // one failure the >50% rule below cannot absorb.
    const alt = opts.models.mapAlt
    if (!alt) return null
    const r2 = await runText(alt, prompt, opts.userId, MAP_TIMEOUT_MS)
    cost += r2.cost
    if (!r2.ok) console.warn(`${LOG} map ${w.index + 1}/${windows.length} also failed on ${alt.display_name}: ${r2.error}`)
    return r2.ok ? r2.text : null
  })
  const kept = parts.map((p, i) => p ? `[part ${i + 1}]\n${p}` : null).filter((p): p is string => !!p)
  if (kept.length === 0 || kept.length < windows.length / 2) {
    throw new Error(`Could not read the document (${windows.length - kept.length} of ${windows.length} parts failed).`)
  }

  // REDUCE — the judgment call, with one retry if the JSON doesn't parse.
  let bible: StoryBible | null = null
  let prompt = reducePrompt(kept, opts.lang, opts.focus)
  // A model that FAILED gets replaced for the next attempt; a model that
  // merely returned unparseable JSON gets the nudge below and stays — the
  // two failures want opposite responses.
  let reduceOn = reduce
  for (let attempt = 0; attempt < 2 && !bible; attempt++) {
    // 16k: the bible is ~3k tokens of JSON, but Sonnet 5 runs adaptive
    // thinking from the same budget and the provider's 4096 default cut the
    // first live 西遊記 reduce mid-array (Aug 22).
    const r = await runText(reduceOn, prompt, opts.userId, REDUCE_TIMEOUT_MS, 16_000)
    cost += r.cost
    if (!r.ok) {
      console.warn(`${LOG} reduce failed on ${reduceOn.display_name}: ${r.error}`)
      const alt = opts.models.reduceAlt
      if (alt && alt.id !== reduceOn.id) { reduceOn = alt; console.warn(`${LOG} reduce → ${alt.display_name}`) }
      continue
    }
    bible = parseBible(r.text)
    if (!bible) prompt += '\n\nYour previous reply was not a single valid JSON object. Return ONLY the JSON object described above — no prose, no code fence.'
  }
  if (!bible) throw new Error('Could not summarize the story into a bible.')

  console.log(`${LOG} ${raw.length} chars → ${windows.length} window(s) on ${map.display_name} → ${bible.beats.length} beat(s), ${bible.cast.length} cast on ${reduceOn.display_name} (house-paid $${cost.toFixed(4)})`)
  return { bible, text: renderBible(bible), windows: windows.length, chars: raw.length, cost, model: reduceOn.display_name }
}
