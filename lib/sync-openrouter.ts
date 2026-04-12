// lib/sync-openrouter.ts
//
// Shared sync logic for the OpenRouter model catalog. Produces rows for the
// `ai_models` table and (optionally) upserts them into Supabase. Used by two
// callers:
//
//   1. scripts/sync-openrouter.ts  — CLI wrapper, runs from a dev terminal.
//   2. app/api/dev/sync-openrouter — POST endpoint, runs inside Next.js so
//      we don't need local shell access to the Supabase/OpenRouter hosts.
//
// All rows are stored with provider='openrouter' and model_name=<openrouter_id>
// (e.g. 'google/gemini-3-pro-image-preview').

import { createClient } from '@supabase/supabase-js'

// ---------- OpenRouter types ----------

export interface ORModel {
  id: string
  canonical_slug?: string
  name: string
  description?: string
  created?: number
  context_length?: number
  architecture?: {
    modality?: string
    input_modalities?: string[]
    output_modalities?: string[]
    tokenizer?: string
  }
  pricing?: {
    prompt?: string
    completion?: string
    image?: string
    audio?: string
    request?: string
    input_cache_read?: string
    input_cache_write?: string
    internal_reasoning?: string
    web_search?: string
  }
  top_provider?: {
    context_length?: number
    max_completion_tokens?: number | string
    is_moderated?: boolean
  }
  supported_parameters?: string[]
}

// /api/frontend/models carries structured per-image / per-megapixel pricing
// for pure image-gen models (FLUX.2, Seedream, Riverflow, ...) that
// /v1/models leaves as zeros. We only read the minimum subset we need.
interface ORFrontendPriceEntry {
  kind?: string
  price?: string
  sku_label?: string
  unitLabel?: string
}

interface ORFrontendModel {
  slug: string
  short_name?: string
  name?: string
  description?: string
  output_modalities?: string[]
  endpoint?: {
    display_pricing?: ORFrontendPriceEntry[]
    pricing?: {
      image_output?: string
      prompt?: string
      completion?: string
    }
  }
}

// Normalized "$ per one medium-sized image" figure parsed from the frontend
// endpoint's display_pricing. For per-megapixel models we assume 1 MP output.
interface ImagePriceInfo {
  perImageUsd: number
  source: 'per-image' | 'per-megapixel'
}

export interface ORVideoModel {
  id: string
  canonical_slug?: string
  name: string
  description?: string
  pricing_skus?: Record<string, string>
  supported_resolutions?: string[]
  supported_sizes?: string[]
  supported_aspect_ratios?: string[]
  supported_durations?: number[]
  allowed_passthrough_parameters?: string[]
}

// ---------- Row shape written to ai_models ----------

export interface AiModelRow {
  provider: 'openrouter'
  model_name: string
  name: string
  description: string | null
  modes: string[]
  input_modalities: string[]
  output_modalities: string[]
  input_price: number | null          // per 1M tokens
  cached_input_price: number | null   // per 1M tokens
  output_price: number | null         // per 1M tokens
  input_image_price: number | null    // per 1M image-input tokens
  output_image_price: number | null   // legacy — not used for OpenRouter
  image_pricing: Record<string, number> | null
  video_pricing: Record<string, number> | null
  image_sizes: string[] | null
  video_sizes: string[] | null
  video_durations: number[] | null
  context_window: number | null
  max_output_tokens: number | null
  tags: string[]
  enabled: boolean
  // /v1/models exposes this as Unix seconds; we persist ISO for timestamptz.
  // /v1/videos/models doesn't expose a created timestamp, so video rows are
  // always null here (picker sorts nulls last).
  released_at: string | null
}

// ---------- helpers ----------

const PER_MILLION = 1_000_000

// Typical output tokens per image on Gemini image models.
// Source: Google Gemini API docs — image output counts as 1290 tokens/image.
// Used to surface a ballpark "$ per image" in the ModelXD UI.
const TOKENS_PER_IMAGE_GEMINI = 1290
// OpenAI GPT-5 image output is more variable; 3500 is a rough midpoint.
const TOKENS_PER_IMAGE_OPENAI = 3500
// Fallback estimate for unknown image providers.
const TOKENS_PER_IMAGE_DEFAULT = 2000

function estimateTokensPerImage(orId: string): number {
  if (orId.startsWith('google/')) return TOKENS_PER_IMAGE_GEMINI
  if (orId.startsWith('openai/')) return TOKENS_PER_IMAGE_OPENAI
  return TOKENS_PER_IMAGE_DEFAULT
}

function parsePrice(raw: string | undefined | null): number | null {
  if (raw == null) return null
  const n = parseFloat(String(raw))
  if (!isFinite(n)) return null
  return n
}

// Pull a "$/medium image" figure out of an OpenRouter frontend model entry.
// Prefers "Output Image" / "Image Output" SKU entries.
function extractImagePrice(fm: ORFrontendModel): ImagePriceInfo | null {
  const entries = fm.endpoint?.display_pricing ?? []
  const output = entries.find(e => {
    const label = (e.sku_label || '').toLowerCase()
    return label === 'output image' || label === 'image output'
  })
  if (!output) return null
  const price = parsePrice(output.price)
  if (price == null || price <= 0) return null
  const unit = (output.unitLabel || '').toLowerCase()
  if (unit === 'per image') return { perImageUsd: price, source: 'per-image' }
  if (unit === 'per megapixel') return { perImageUsd: price, source: 'per-megapixel' }
  return null
}

async function fetchFrontendImagePrices(): Promise<Map<string, ImagePriceInfo>> {
  const url = 'https://openrouter.ai/api/frontend/models'
  const map = new Map<string, ImagePriceInfo>()
  try {
    const res = await fetch(url)
    if (!res.ok) return map
    const json = await res.json() as { data: ORFrontendModel[] }
    for (const fm of json.data || []) {
      if (!(fm.output_modalities || []).includes('image')) continue
      const info = extractImagePrice(fm)
      if (info) map.set(fm.slug, info)
    }
  } catch {
    // Frontend endpoint is best-effort. If it fails we fall back to token
    // pricing for hybrid chat+image models and silently skip pure image-gen
    // models.
  }
  return map
}

function displayName(m: { id: string; name?: string }): string {
  const name = m.name || m.id
  const colonIdx = name.indexOf(': ')
  if (colonIdx > 0 && colonIdx < 30) return name.slice(colonIdx + 2)
  return name
}

function isFree(m: ORModel): boolean {
  const p = parsePrice(m.pricing?.prompt)
  const c = parsePrice(m.pricing?.completion)
  return (p === 0 && c === 0) || m.id.endsWith(':free')
}

function isAutoRouter(m: ORModel): boolean {
  return m.id === 'openrouter/auto' || parsePrice(m.pricing?.prompt) === -1
}

// ---------- classification ----------

export type ModelMode = 'text' | 'image' | 'video'

function classifyTextOrImage(m: ORModel): ModelMode | null {
  const out = m.architecture?.output_modalities ?? []
  if (out.includes('image')) return 'image'
  if (out.length === 1 && out[0] === 'text') return 'text'
  // Skip audio-out or other exotic combos for now.
  return null
}

// ---------- builders ----------

function buildTextRow(m: ORModel): AiModelRow {
  const prompt = parsePrice(m.pricing?.prompt) ?? 0
  const completion = parsePrice(m.pricing?.completion) ?? 0
  const cache = parsePrice(m.pricing?.input_cache_read)
  return {
    provider: 'openrouter',
    model_name: m.id,
    name: displayName(m),
    description: m.description ?? null,
    modes: ['text'],
    input_modalities: m.architecture?.input_modalities ?? ['text'],
    output_modalities: ['text'],
    input_price: prompt * PER_MILLION,
    cached_input_price: cache != null ? cache * PER_MILLION : null,
    output_price: completion * PER_MILLION,
    input_image_price: parsePrice(m.pricing?.image) != null ? parsePrice(m.pricing?.image)! * PER_MILLION : null,
    output_image_price: null,
    image_pricing: null,
    video_pricing: null,
    image_sizes: null,
    video_sizes: null,
    video_durations: null,
    context_window: m.context_length ?? m.top_provider?.context_length ?? null,
    max_output_tokens: typeof m.top_provider?.max_completion_tokens === 'number' ? m.top_provider.max_completion_tokens : null,
    tags: m.architecture?.input_modalities?.includes('image') ? ['vision'] : [],
    enabled: true,
    released_at: m.created ? new Date(m.created * 1000).toISOString() : null,
  }
}

function buildImageRow(m: ORModel, frontendPrice: ImagePriceInfo | null): AiModelRow | null {
  const prompt = parsePrice(m.pricing?.prompt) ?? 0
  const completion = parsePrice(m.pricing?.completion) ?? 0
  const imgTokenPrice = parsePrice(m.pricing?.image)
  const tokensPerImage = estimateTokensPerImage(m.id)

  // Prefer the structured "Output Image" / "Image Output" price from the
  // frontend endpoint when present. Covers FLUX.2, Seedream, Riverflow, and
  // anything else billing per-image or per-megapixel. For hybrid chat+image
  // models (Nano Banana, GPT-5 Image) we fall back to a token approximation.
  let perImageCost: number
  if (frontendPrice) {
    perImageCost = frontendPrice.perImageUsd
  } else {
    perImageCost = (100 * prompt) + (tokensPerImage * completion)
  }

  // Skip entirely rather than writing a bogus $0 row.
  if (perImageCost <= 0) return null

  return {
    provider: 'openrouter',
    model_name: m.id,
    name: displayName(m),
    description: m.description ?? null,
    modes: ['image'],
    input_modalities: m.architecture?.input_modalities ?? ['text', 'image'],
    output_modalities: ['image'],
    input_price: prompt * PER_MILLION,
    cached_input_price: null,
    output_price: completion * PER_MILLION,
    input_image_price: imgTokenPrice != null ? imgTokenPrice * PER_MILLION : null,
    output_image_price: null,
    // ModelXD's duel reveal reads image_pricing.medium to show "$/image".
    image_pricing: { medium: roundTo(perImageCost, 6) },
    video_pricing: null,
    image_sizes: ['1024x1024'],
    video_sizes: null,
    video_durations: null,
    context_window: m.context_length ?? null,
    max_output_tokens: null,
    tags: ['vision'],
    enabled: true,
    released_at: m.created ? new Date(m.created * 1000).toISOString() : null,
  }
}

function buildVideoRow(v: ORVideoModel): AiModelRow {
  const skus = v.pricing_skus || {}
  const video_pricing: Record<string, number> = {}

  const resolutions = ['720p', '1080p', '480p', '4k', '1024p']
  for (const res of resolutions) {
    const candidates = [
      `duration_seconds_${res}`,
      `text_to_video_duration_seconds_${res}`,
      `image_to_video_duration_seconds_${res}`,
      `duration_seconds_without_audio${res === '4k' ? '_4k' : ''}`,
    ]
    for (const key of candidates) {
      const raw = skus[key]
      const n = parsePrice(raw)
      if (n != null && n > 0) {
        const tag = res === '1024p' ? '1024p' : res.toUpperCase() === '4K' ? '4K' : res
        if (!(tag in video_pricing)) video_pricing[tag] = n
        break
      }
    }
  }

  if (Object.keys(video_pricing).length === 0) {
    const raw = skus['duration_seconds']
    const n = parsePrice(raw)
    if (n != null && n > 0) video_pricing['720p'] = n
  }

  const video_sizes = (v.supported_sizes && v.supported_sizes.length > 0) ? v.supported_sizes : null
  const video_durations = (v.supported_durations && v.supported_durations.length > 0) ? v.supported_durations : null
  const usableDefault = Object.keys(video_pricing).length > 0

  return {
    provider: 'openrouter',
    model_name: v.id,
    name: displayName({ id: v.id, name: v.name }),
    description: v.description ?? null,
    modes: ['video'],
    input_modalities: ['text'],
    output_modalities: ['video'],
    input_price: null,
    cached_input_price: null,
    output_price: null,
    input_image_price: null,
    output_image_price: null,
    image_pricing: null,
    video_pricing: usableDefault ? video_pricing : null,
    image_sizes: null,
    video_sizes,
    video_durations,
    context_window: null,
    max_output_tokens: null,
    tags: ['experimental'],
    enabled: usableDefault,
    released_at: null,
  }
}

function roundTo(n: number, digits: number): number {
  const k = Math.pow(10, digits)
  return Math.round(n * k) / k
}

// ---------- public API ----------

export interface SyncOptions {
  /** When true, don't write to Supabase — just return the rows that would be written. */
  dryRun?: boolean
  /** Restrict to one mode (text | image | video). Falsy = all modes. */
  mode?: ModelMode | null
}

export interface SyncResult {
  fetched: { models: number; video: number }
  builtByMode: Record<string, number>
  skipped: {
    auto: number
    free: number
    audio: number
    textFiltered: number
    imageFiltered: number
  }
  written: number
  dryRun: boolean
  sampleRow: AiModelRow | null
}

export async function runSync(opts: SyncOptions = {}): Promise<SyncResult> {
  const dryRun = !!opts.dryRun
  const mode = opts.mode ?? null

  const modelsRes = await fetch('https://openrouter.ai/api/v1/models')
  if (!modelsRes.ok) throw new Error(`OpenRouter /api/v1/models returned ${modelsRes.status}`)
  const modelsJson = await modelsRes.json() as { data: ORModel[] }
  const allModels = modelsJson.data || []

  const frontendImagePrices = await fetchFrontendImagePrices()

  const videoRes = await fetch('https://openrouter.ai/api/v1/videos/models')
  let allVideo: ORVideoModel[] = []
  if (videoRes.ok) {
    const videoJson = await videoRes.json() as { data: ORVideoModel[] }
    allVideo = videoJson.data || []
  }

  const rows: AiModelRow[] = []
  const skipCounts = { auto: 0, free: 0, audio: 0, textFiltered: 0, imageFiltered: 0 }

  for (const m of allModels) {
    if (isAutoRouter(m)) { skipCounts.auto++; continue }
    const cls = classifyTextOrImage(m)
    if (cls === null) { skipCounts.audio++; continue }
    // isFree() only applies to text models — image-gen models legitimately
    // have prompt/completion = 0 because they bill per-image.
    if (cls === 'text' && isFree(m)) { skipCounts.free++; continue }
    if (mode && cls !== mode) {
      if (cls === 'text') skipCounts.textFiltered++
      else skipCounts.imageFiltered++
      continue
    }
    if (cls === 'text') {
      rows.push(buildTextRow(m))
    } else if (cls === 'image') {
      const row = buildImageRow(m, frontendImagePrices.get(m.id) ?? null)
      if (row) rows.push(row)
      else skipCounts.free++
    }
  }

  if (!mode || mode === 'video') {
    for (const v of allVideo) {
      rows.push(buildVideoRow(v))
    }
  }

  const builtByMode = rows.reduce<Record<string, number>>((acc, r) => {
    const k = r.output_modalities.join(',')
    acc[k] = (acc[k] || 0) + 1
    return acc
  }, {})

  if (dryRun) {
    return {
      fetched: { models: allModels.length, video: allVideo.length },
      builtByMode,
      skipped: skipCounts,
      written: 0,
      dryRun: true,
      sampleRow: rows[0] ?? null,
    }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SECRET_KEY
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY env vars.')
  }
  const sb = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })

  const BATCH = 50
  let written = 0
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    const { error } = await sb
      .from('ai_models')
      .upsert(batch, { onConflict: 'provider,model_name' })
    if (error) throw new Error(`upsert failed at batch ${i}: ${error.message}`)
    written += batch.length
  }

  return {
    fetched: { models: allModels.length, video: allVideo.length },
    builtByMode,
    skipped: skipCounts,
    written,
    dryRun: false,
    sampleRow: rows[0] ?? null,
  }
}
