// lib/providers/types.ts
// Shared types for all provider implementations.

// ── Pricing ──────────────────────────────────────────────────────────────────
//
// Pricing is purely about $ rates now. Sizes / durations / aspect ratios
// / capabilities live on output_config. See docs/ai_models-schema.md.

/**
 * Unified pricing for any model. One field holds every billing flavour:
 *
 *   tokens?            : token-based rates ($/1M tokens), keyed by modality.
 *                        Used when the provider surfaces token usage.
 *   per_image?         : flat per-image rates (e.g. Imagen). Used when the
 *                        provider bills a flat $/image, not per token.
 *   per_video_second?  : flat per-second rates by resolution (Veo, Wan).
 *   per_search?        : flat $ per web-search call, billed by the provider
 *                        SEPARATELY from tokens. Anthropic $10/1k, Gemini
 *                        $14/1k, xAI ~$5/1k as of Aug 2026. Its presence
 *                        does NOT mean the model can search — that is
 *                        declared by output_config.text.capabilities.
 *
 * `calcImageCost` / `calcTextCost` / `calcVideoCost` pick the appropriate
 * branch based on what's set + what usage the provider returns.
 */
/**
 * Polymorphic rate. Either a flat `number` ($/1M tokens), or an object
 * with a `default` rate and optional per-thinking-level overrides:
 *
 *   12                                              // flat: same rate at any level
 *   { default: 12, by_level: { high: 30, low: 8 } } // overrides for specific levels
 *
 * `resolveTokenRate(rate, thinking_level)` in pricing.ts picks the right
 * one at cost-calc time.
 */
export type TokenRate = number | { default: number; by_level?: Record<string, number> }

export interface ModelPricing {
  tokens?: {
    text_input?:    TokenRate
    cached_input?:  TokenRate
    image_input?:   TokenRate
    video_input?:   TokenRate
    audio_input?:   TokenRate
    text_output?:   TokenRate
    image_output?:  TokenRate
    audio_output?:  TokenRate
  }
  per_image?:        Record<string, number>
  per_video_second?: Record<string, number>
  /** $ per web-search call. See the note above. */
  per_search?:       number
}

// ── Capabilities: input + output config ──────────────────────────────────────

/**
 * Per-modality input details. The shape of "what the model takes" is
 * captured by `ModelInfo.mode` (a row-level enum); `input_config` only
 * holds the bits the mode doesn't imply — count override and capability
 * flags. Most rows have `input_config = null`.
 */
export interface InputModalityConfig {
  /** Slot count override. Only meaningful when mode is `reference_frames`. */
  count?:         number
  /** Free-form capability flags specific to this input modality (e.g. `veo_video_only`). */
  capabilities?:  string[]
}

/** Input-shape patterns. A model declares the SET of modes it supports
 * via `modes: ModelMode[]`; the user picks one at generation time. */
export type ModelMode =
  // text-output
  | 'text_to_text'
  | 'image_to_text'     // image → text (caption, vision)
  | 'video_to_text'     // video → text (summarize, caption, transcript+context)
  | 'audio_to_text'     // audio → text (transcription, summarization)
  | 'pdf_to_text'       // pdf  → text (analyze / extract)
  // image-output
  | 'text_to_image'
  | 'image_edit'
  // video-output
  | 'text_to_video'
  | 'image_to_video'
  | 'video_to_video'
  | 'video_edit'        // video + reference images → edited video (HappyHorse Video Edit)
  | 'audio_to_video'    // song/audio drives the performance (Wan 3.0 reference_audio; mp3/wav ≤15s)
  | 'start_end_frames'
  // shared (image / video)
  | 'reference_frames'

export interface InputConfig {
  text?:  InputModalityConfig
  image?: InputModalityConfig
  video?: InputModalityConfig
  audio?: InputModalityConfig
}

/**
 * Per-resolution duration spec. Either a fixed list of integer seconds
 * (e.g. Veo 3 returning 8s clips) or an inclusive integer range (e.g.
 * Wan 2.6 supporting any integer 3..15).
 */
export type DurationSpec = number[] | { min: number; max: number }

export interface OutputModalityConfig {
  /** Available pixel dimensions, e.g. ['1024x1024', '2048x2048']. */
  sizes?:         string[]
  /** Available aspect ratios, e.g. ['16:9', '9:16', '1:1']. */
  aspect_ratios?: string[]
  /**
   * Available durations in integer seconds, keyed by resolution (video only).
   * Each entry is either a `number[]` of discrete picks or `{ min, max }`
   * for continuous integer ranges. Resolution keys mirror those in
   * `model_pricing.per_video_second` (e.g. '720p', '1080p', '4k').
   */
  durations_by_resolution?: Record<string, DurationSpec>
  /**
   * Available thinking / reasoning levels (e.g. Gemini: ['minimal', 'low',
   * 'high']; OpenAI o-series: ['low', 'medium', 'high']). Models that
   * don't support thinking leave this unset.
   */
  thinking_levels?: string[]
  /**
   * Maximum number of outputs the model can produce in a single request.
   * Mostly applies to image models that can generate N images at once.
   * Default `undefined` = single output, no count picker shown in the UI.
   */
  max_count?: number
  /** Free-form capability flags, e.g. ['extension', 'frame_specific']. */
  capabilities?:  string[]
  /**
   * Set when the model accepts ARBITRARY WxH sizes beyond `sizes` (image
   * only today; gpt-image-2: multiples of 16, max edge 3840, aspect ≤3:1,
   * 655,360–8,294,400 total pixels). Presence of the object is the feature
   * flag — the UI shows a free WxH input and validates against these
   * bounds; unset fields fall back to gpt-image-2's published limits.
   */
  custom_size?: {
    multiple?:   number
    max_edge?:   number
    max_ratio?:  number
    min_pixels?: number
    max_pixels?: number
  }
}

export interface OutputConfig {
  text?:  OutputModalityConfig
  image?: OutputModalityConfig
  video?: OutputModalityConfig
  audio?: OutputModalityConfig
}

// ── Models ───────────────────────────────────────────────────────────────────

export interface ModelInfo {
  id:                string
  provider:          string
  model_name:        string
  display_name:      string
  /** Set of input-shape patterns the model supports. Empty = no canonical patterns declared. */
  modes:             ModelMode[]
  input_modalities:  string[]     // ['text','image','video','audio'] — coarse "does it touch X?"
  output_modalities: string[]     // ['text'] | ['image'] | ['video']
  tags:              string[]
  is_popular:        boolean
  enabled:           boolean
  released_at:       string | null
  model_pricing:     ModelPricing | null
  input_config:      InputConfig  | null
  output_config:     OutputConfig | null
}

export interface TextResult {
  text:              string
  inputTokens:       number
  outputTokens:      number
  cachedTokens:      number
  cost:              number
  /** Web searches the provider performed for this call. Billed per call on
   *  top of tokens, so it is carried separately all the way to the UI. */
  searchCount?:      number
  /** Image-input tokens (multimodal text models with vision). */
  inputImageTokens?: number
  /** Raw provider usage object — JSON-safe. Logged verbatim. */
  usageMetadata?:    any
}

export interface ImageResult {
  buffer:    Buffer
  mediaType: string
  cost:      number
  /**
   * Additional images when the model returns more than one (Qwen Image
   * 2.0 series with `n > 1`, etc.). Empty when the response is single-image.
   * The primary `buffer` / `mediaType` is the first image.
   */
  extras?:   Array<{ buffer: Buffer; mediaType: string }>
  /** Per-modality token breakdown for token-billed image models. */
  inputTextTokens?:   number
  inputImageTokens?:  number
  outputTextTokens?:  number
  outputImageTokens?: number
  cachedTokens?:      number
  usageMetadata?:     any
  // OpenAI: Responses API id for multi-turn editing via previous_response_id
  responseId?:           string
  // Google: full conversation history for multi-turn image editing
  conversationHistory?:  any[]
}

export interface VideoResult {
  buffer:          Buffer
  mediaType:       string
  durationSeconds: number
  cost:            number
  usageMetadata?:  any
  /** Provider-side handle for the generated video (Veo: the file URI).
   *  Required to extend the video later — Veo extension only accepts its
   *  own prior outputs, referenced by URI, for ~2 days after generation. */
  providerVideoRef?: string | null
}

export interface Attachment {
  buffer:    Buffer
  mediaType: string
  /**
   * Optional public/signed URL for the attachment. Some provider APIs
   * (e.g. Alibaba HappyHorse I2V) require a HTTP(S) URL for the input
   * image rather than inline base64. Route handlers populate this with
   * a signed Supabase Storage URL when available; providers may prefer
   * `url` when present and fall back to base64 from `buffer` otherwise.
   */
  url?: string
  /**
   * Typed-port role for this input (lib/ports.ts): first_frame,
   * reference_image, reference_audio, source_image, … Assigned by the
   * route from the model's port schema; providers map it to their API
   * field instead of inferring from order. Absent on legacy callers —
   * providers keep their old inference as the fallback.
   */
  port?: string
  /**
   * Where this input came from — a board row's output or an uploaded
   * file. Persisted to xcreates.input_ports (migration 81) as the
   * canonical wiring record; never sent to providers.
   */
  wireSource?:
    | { kind: 'row'; row_id: string; slot?: number }
    | { kind: 'file'; bucket: string; path: string; name?: string }
  /**
   * Storage object holding a byte-identical copy of `buffer` (uploads point
   * at their resized copy, parent outputs at the output object). Lets the
   * route persist Google conversation history as storage markers instead of
   * inline base64 — see lib/providers/history-storage.ts. Never sent to
   * providers.
   */
  storageRef?: { bucket: string; path: string }
}

export interface TextStreamCallbacks {
  onDelta: (text: string) => void
  onDone:  (result: {
    inputTokens:       number
    outputTokens:      number
    cachedTokens:      number
    cost:              number
    inputImageTokens?: number
    searchCount?:      number
    usageMetadata?:    any
  }) => void
  onError: (message: string) => void
}

/** Concrete per-sample scene directives for multi-output image runs.
 *  Same-prompt parallel samples come out near-identical (low sample
 *  variance); a generic "make it different" hint barely helps. Naming a
 *  concretely different camera/lighting/setting per index is what
 *  ChatGPT's per-image prompt rewriting effectively does. Subject-neutral
 *  on purpose — works for products, portraits, scenes alike. Shared by
 *  openai.ts and google.ts. */
export const VARIATION_DIRECTIVES = [
  'a different camera angle — three-quarter or profile view',
  'an overhead or top-down perspective',
  'a close-up composition emphasizing texture and detail',
  'an outdoor setting with natural daylight',
  'a dark, moody backdrop with dramatic lighting',
  'a bright minimalist backdrop with soft shadows',
  'a wide composition with generous negative space',
  'a real-life environment where the subject would naturally appear',
  'warm golden-hour lighting from the side',
  'a low camera angle looking slightly upward',
]
