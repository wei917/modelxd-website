// lib/providers/pricing.ts
//
// Cost-calculation helpers that read the unified `model_pricing` jsonb.
// Shape is documented in lib/providers/types.ts and docs/ai_models-schema.md.
//
// Three runtime helpers + two presentation helpers. All read from the
// single `model_pricing` field.

import type { ModelInfo, ModelPricing, TokenRate } from './types'

function pricing(m: ModelInfo): ModelPricing {
  return m.model_pricing ?? {}
}

/**
 * Resolve a polymorphic `TokenRate` into a concrete number.
 *  - flat number  → returned as-is
 *  - object       → tries `by_level[thinkingLevel]` first, falls back to `default`
 *  - undefined    → 0
 */
export function resolveTokenRate(rate: TokenRate | undefined, thinkingLevel?: string | null): number {
  if (rate == null) return 0
  if (typeof rate === 'number') return rate
  if (thinkingLevel && rate.by_level && typeof rate.by_level[thinkingLevel] === 'number') {
    return rate.by_level[thinkingLevel] as number
  }
  return rate.default ?? 0
}

/** First defined value in `rates` for any of the keys (in order), with a
 *  final fallback to any defined entry. Returns 0 if the map is empty. */
function pickRate(rates: Record<string, number> | undefined, ...keys: string[]): number {
  if (!rates) return 0
  for (const k of keys) {
    const v = rates[k]
    if (typeof v === 'number') return v
  }
  for (const v of Object.values(rates)) {
    if (typeof v === 'number') return v
  }
  return 0
}

// ── text completions ────────────────────────────────────────────────────────

/**
 * Total $ cost for a text completion. Multimodal text models can charge
 * different rates for text input vs. image input vs. cached input — pass
 * the appropriate token counts in `details` and we'll use rate-specific
 * pricing where available, falling back to the text input rate for any
 * missing modality rate.
 */
export function calcTextCost(
  model:        ModelInfo,
  inputTokens:  number,
  outputTokens: number,
  cachedTokens: number = 0,
  details: {
    imageInputTokens?: number
    videoInputTokens?: number
    audioInputTokens?: number
    /** Selected thinking level (e.g. 'minimal' / 'low' / 'high'). Used to
     *  resolve any per-level rates declared on the model. */
    thinkingLevel?:    string | null
  } = {},
): number {
  const t = pricing(model).tokens ?? {}
  const lvl = details.thinkingLevel ?? null
  const textInputRate    = resolveTokenRate(t.text_input,    lvl)
  const cachedInputRate  = resolveTokenRate(t.cached_input,  lvl) || textInputRate
  const imageInputRate   = resolveTokenRate(t.image_input,   lvl) || textInputRate
  const videoInputRate   = resolveTokenRate(t.video_input,   lvl) || textInputRate
  const audioInputRate   = resolveTokenRate(t.audio_input,   lvl) || textInputRate
  const textOutputRate   = resolveTokenRate(t.text_output,   lvl)
  const imageInputTokens = details.imageInputTokens ?? 0
  const videoInputTokens = details.videoInputTokens ?? 0
  const audioInputTokens = details.audioInputTokens ?? 0
  const uncachedText     = Math.max(0, inputTokens - cachedTokens - imageInputTokens - videoInputTokens - audioInputTokens)
  return (
    (uncachedText     / 1_000_000) * textInputRate   +
    (cachedTokens     / 1_000_000) * cachedInputRate +
    (imageInputTokens / 1_000_000) * imageInputRate  +
    (videoInputTokens / 1_000_000) * videoInputRate  +
    (audioInputTokens / 1_000_000) * audioInputRate  +
    (outputTokens     / 1_000_000) * textOutputRate
  )
}

// ── image generations ───────────────────────────────────────────────────────

/**
 * $ cost for one image generation.
 *
 *  - Token-based (Gemini 2.5/3.x Flash Image, etc.): when `usage` is provided
 *    AND any token output rate is set on `model_pricing.tokens`, cost is
 *    `tokens × rate / 1M` summed per modality (text input, image input,
 *    image output, plus any text-output tokens that come along for the ride).
 *  - Per-image flat: falls back to `model_pricing.per_image`, looked up by
 *    `size` first (e.g. "1024x1024"), then `quality` (low/medium/high), then
 *    'medium' / 'default'. Models that price per size (gpt-image-2.0, etc.)
 *    declare `per_image: { "1024x1024": 0.02, "1792x1024": 0.034, ... }`.
 *    Quality-tiered models keep `per_image: { medium: 0.02, high: 0.05, ... }`.
 *
 * Both branches return 0 if the corresponding rates are absent.
 */
export function calcImageCost(
  model:    ModelInfo,
  quality:  string = 'medium',
  size?:    string,
  usage?:   {
    inputTextTokens?:   number
    inputImageTokens?:  number
    outputTextTokens?:  number
    outputImageTokens?: number
  },
): number {
  const p = pricing(model)
  const t = p.tokens ?? {}

  // For models like gpt-image-2 the per-token rate is constant; quality
  // affects how many output tokens the model emits, not the rate. We still
  // pass `quality` so the polymorphic TokenRate resolver works if any future
  // model prices per-quality, but for current models it's just a flat number.
  const imageOutputRate = resolveTokenRate(t.image_output, quality)
  const textOutputRate  = resolveTokenRate(t.text_output)
  const hasOutputTokenRate = imageOutputRate > 0 || textOutputRate > 0

  if (usage && hasOutputTokenRate) {
    const textInputBase  = resolveTokenRate(t.text_input)
    const textInputRate  = textInputBase
    const imageInputRate = resolveTokenRate(t.image_input) || textInputBase
    return (
      ((usage.inputTextTokens   ?? 0) / 1_000_000) * textInputRate   +
      ((usage.inputImageTokens  ?? 0) / 1_000_000) * imageInputRate  +
      ((usage.outputTextTokens  ?? 0) / 1_000_000) * textOutputRate  +
      ((usage.outputImageTokens ?? 0) / 1_000_000) * imageOutputRate
    )
  }

  // Try size key first (e.g. "1024x1024"), then quality tier, then fallbacks.
  return pickRate(p.per_image, size ?? '', quality, 'medium', 'default')
}

// ── video generations ───────────────────────────────────────────────────────

/**
 * Total $ cost for a video. Currently always $/sec by resolution — Veo 3
 * has token-level metadata pending but until we get a confirmed shape from
 * the API, per-second flat is the source of truth.
 */
export function calcVideoCost(
  model:      ModelInfo,
  resolution: string,
  seconds:    number = 1,
): number {
  const perSec = pickRate(pricing(model).per_video_second, resolution.toLowerCase(), '720p', 'default')
  return perSec * seconds
}

// ── presentation helpers ────────────────────────────────────────────────────

/**
 * Mode-specific user-facing price label (e.g. "$12.00 / 1M tokens",
 * "$0.034 / image", "$0.10 / sec"). Returned alongside the canonical
 * rate as a number for downstream calculations.
 */
export function modePriceLabel(
  model: ModelInfo,
  mode:  'text' | 'image' | 'video',
): { label: string; rate: number } {
  const p = pricing(model)
  if (mode === 'image') {
    const cost = calcImageCost(model)
    return cost > 0
      ? { label: `$${parseFloat(cost.toFixed(4))} / image`, rate: cost }
      : { label: '—', rate: 0 }
  }
  if (mode === 'video') {
    const perSec = calcVideoCost(model, '720p', 1)
    return perSec > 0
      ? { label: `$${parseFloat(perSec.toFixed(4))} / sec`, rate: perSec }
      : { label: '—', rate: 0 }
  }
  // text — output rate per 1M tokens (uses default rate when text_output is polymorphic)
  const out = resolveTokenRate(p.tokens?.text_output)
  if (out > 0) {
    return { label: `$${out.toFixed(2)} / 1M tokens`, rate: out }
  }
  return { label: '—', rate: 0 }
}

// ── pre-call estimates ──────────────────────────────────────────────────────

/**
 * Predict the dollar cost of a call BEFORE we make it. Used to record an
 * estimated cost on the start telemetry event, so we can compare estimate
 * vs. real after the call returns.
 *
 * Inputs are heuristic: text uses prompt-character / 4 ≈ tokens (and
 * assumes ~500 output tokens), image uses ~1290 output-image tokens for
 * token-billed models or `quality` rate for flat-billed, video uses
 * resolution × duration. Returns 0 when no rates are known.
 */
export function estimateCost(
  model:  ModelInfo,
  mode:   'text' | 'image' | 'video',
  opts: {
    promptChars?:  number     // text/image: prompt length in characters
    quality?:      string     // image: quality tier
    size?:         string     // image: selected size ("1024", "1024x1024", …)
    resolution?:   string     // video: resolution key
    seconds?:      number     // video: duration
  } = {},
): number {
  const p = pricing(model)
  const t = p.tokens ?? {}
  const promptChars = opts.promptChars ?? 0

  if (mode === 'text') {
    const tin  = resolveTokenRate(t.text_input)
    const tout = resolveTokenRate(t.text_output)
    if (tin === 0 && tout === 0) return 0
    const inputTokens  = Math.max(1, Math.ceil(promptChars / 4))
    const outputTokens = 500                   // heuristic — most chats land here
    return (
      (inputTokens  / 1_000_000) * tin +
      (outputTokens / 1_000_000) * tout
    )
  }

  if (mode === 'image') {
    // Official per-image rates FIRST — most specific key wins:
    // "quality:size" (gpt-image-2's measured matrix) → size tier
    // ("1024" for Gemini) → quality → medium → default.
    const q = opts.quality ?? 'medium'
    const s = opts.size ?? ''
    const flat = pickRate(p.per_image, `${q}:${s}`, s, q, 'medium', 'default')
    if (flat > 0) return flat
    // Token-billed with no per-image table (e.g. gpt-image-2): rough
    // heuristic — ~1400 output image tokens (1372 measured on a real
    // gpt-image-2 response). Quality moves the real number a lot; treat
    // this as order-of-magnitude only.
    const imgOut = resolveTokenRate(t.image_output, opts.quality)
    if (imgOut > 0) {
      const inputTokens     = Math.max(1, Math.ceil(promptChars / 4))
      const outputImageTok  = 1400
      const tin             = resolveTokenRate(t.text_input)
      return (
        (inputTokens     / 1_000_000) * tin +
        (outputImageTok  / 1_000_000) * imgOut
      )
    }
    return 0
  }

  if (mode === 'video') {
    return calcVideoCost(model, opts.resolution ?? '720p', opts.seconds ?? 1)
  }

  return 0
}

/**
 * Headline price for the leaderboard / catalog row. Returns the dollar
 * amount, the unit it's billed in, and the variant key picked. Null for
 * models with no pricing on file.
 */
export function headlinePrice(
  model: ModelInfo,
): { amount: number; unit: 'tokens' | 'image' | 'sec'; variant: string } | null {
  const p = pricing(model)

  // Text headline: text_output per 1M tokens
  const textOut = p.tokens?.text_output
  if (typeof textOut === 'number') return { amount: textOut, unit: 'tokens', variant: 'text_output' }

  // Image-output token-based headline
  const imageOut = p.tokens?.image_output
  if (typeof imageOut === 'number') return { amount: imageOut, unit: 'tokens', variant: 'image_output' }

  if (p.per_image) {
    const r = p.per_image
    if (typeof r.medium  === 'number') return { amount: r.medium,  unit: 'image', variant: 'medium' }
    if (typeof r.default === 'number') return { amount: r.default, unit: 'image', variant: 'default' }
    const [k, v] = Object.entries(r)[0] ?? []
    if (typeof v === 'number') return { amount: v, unit: 'image', variant: k }
  }

  if (p.per_video_second) {
    const r = p.per_video_second
    if (typeof r['720p'] === 'number') return { amount: r['720p'], unit: 'sec', variant: '720p' }
    if (typeof r.default === 'number') return { amount: r.default, unit: 'sec', variant: 'default' }
    const [k, v] = Object.entries(r)[0] ?? []
    if (typeof v === 'number') return { amount: v, unit: 'sec', variant: k }
  }

  return null
}
