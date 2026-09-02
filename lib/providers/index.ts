// lib/providers/index.ts
// Routes to the correct provider based on model.provider.
//   - 'openai'      → Direct OpenAI API (Responses API for text + image + video)
//   - 'google'      → Direct Google Gemini API (text + image + video)
//   - 'alibaba'     → Alibaba DashScope API (text via compatible-mode, image, video)
//
// Every call is wrapped with provider-call telemetry. Two rows are
// inserted into `provider_calls` per request, both fire-and-forget via
// the log-provider-call Edge Function: a 'start' event when the call
// goes out, and a separate 'end' event when it returns. Logging never
// blocks or fails the user-facing request.

import * as openai     from './openai'
import * as google     from './google'
import * as alibaba    from './alibaba'
import * as xai        from './xai'
import * as anthropic  from './anthropic'
import * as runway     from './runway'
import * as minimax    from './minimax'
import * as moonshot   from './moonshot'
import { startCall, endCall, logMediaUrl } from './call-log'
import { estimateCost, supportsWebSearch } from './pricing'
import { historyHasMarkers, rehydrateHistory } from './history-storage'
import { extractPdfText, estimatePdfTokens } from '../pdf-extract'

// Native-PDF context guard: a PDF whose estimated tokens exceed the
// provider's context window fails fast with a clear message instead of a
// wasted upstream 400 (lenient bounds; borderline cases still get a clean
// mapped error from lib/provider-errors.ts).
const NATIVE_PDF_TOKEN_LIMITS: Record<string, number> = {
  openai: 400_000,
  google: 1_000_000,
}
import type {
  ModelInfo,
  TextStreamCallbacks,
  ImageResult,
  VideoResult,
  Attachment,
  TextGenExtras,
  JsonSchemaSpec,
} from './types'

export type { ModelInfo, TextStreamCallbacks, ImageResult, VideoResult, Attachment, TextGenExtras, JsonSchemaSpec }
export { logMediaUrl }
export { dehydrateHistory, rehydrateHistory, historyHasMarkers, historyHasInlineData } from './history-storage'
export type { HistoryImageCandidate, StorageImageRef, DehydrateFallback } from './history-storage'

/**
 * Optional per-call context. Pass from route handlers so the log row
 * can be attributed to a user. If omitted, user_id is logged as null.
 */
export interface CallContext {
  userId?: string | null
}

const SUPPORTED_PROVIDERS = ['openai', 'google', 'alibaba', 'xai', 'anthropic', 'runway', 'moonshot', 'minimax']

// Providers whose text path can ingest a raw PDF natively (full fidelity:
// text + page images). A model only takes the native path when it ALSO
// declares `pdf_to_text` in its `modes` (set per-model in /admin/models).
// Anything else falls back to server-side text extraction, so every text
// model handles PDFs regardless — native is purely a fidelity upgrade.
const PROVIDERS_WITH_NATIVE_PDF = new Set(['openai', 'google'])

function modelSupportsNativePdf(model: ModelInfo): boolean {
  return (
    PROVIDERS_WITH_NATIVE_PDF.has(model.provider) &&
    (model.modes ?? []).includes('pdf_to_text')
  )
}

const isPdf = (a: Attachment) => a.mediaType === 'application/pdf'
const isText = (a: Attachment) => a.mediaType.startsWith('text/')

/**
 * Resolve document attachments (PDF / plain-text) for the text path.
 *
 * - Plain-text files are always folded into the prompt (no provider gains
 *   anything from receiving them as a separate part — it's just text).
 * - PDFs are kept as-is ONLY when the model can read them natively
 *   (provider in PROVIDERS_WITH_NATIVE_PDF *and* model declares
 *   `pdf_to_text`). Otherwise the PDF's text layer is extracted server-side
 *   and folded into the prompt, and the raw PDF is dropped so the provider
 *   never sees binary it can't handle.
 *
 * Returns possibly-rewritten messages + attachments. Image/video
 * attachments (not used by the text path today) pass through untouched.
 */
async function resolveDocAttachments(
  model: ModelInfo,
  messages: { role: 'user' | 'assistant'; content: any }[],
  attachments: Attachment[],
): Promise<{ messages: typeof messages; attachments: Attachment[] }> {
  const docs = attachments.filter(a => isPdf(a) || isText(a))
  if (docs.length === 0) return { messages, attachments }

  const native = modelSupportsNativePdf(model)
  const kept: Attachment[] = []
  const foldedTexts: string[] = []

  for (const a of attachments) {
    if (isText(a)) {
      // Same guardrail as PDF extraction (lib/pdf-extract.ts MAX_CHARS):
      // never fold more than ~50k tokens of a text file into the prompt.
      const raw = a.buffer.toString('utf-8')
      foldedTexts.push(raw.length > 200_000 ? raw.slice(0, 200_000) + '\n\n[…truncated]' : raw)
      continue
    }
    if (isPdf(a)) {
      if (native) {
        // Provider embeds it natively. Fail fast if the PDF clearly cannot
        // fit the model's context window.
        const limit = NATIVE_PDF_TOKEN_LIMITS[model.provider]
        if (limit) {
          const est = await estimatePdfTokens(a.buffer).catch(() => 0)
          if (est > limit) {
            throw new Error(
              `Input too large: the attached PDF is roughly ${Math.round(est / 1000)}k tokens, ` +
              `which exceeds the context window of this model.`,
            )
          }
        }
        kept.push(a)
        continue
      }
      try {
        const text = await extractPdfText(a.buffer)
        foldedTexts.push(text || '[PDF contained no extractable text — it may be scanned/image-only.]')
      } catch (err) {
        console.warn('[providers] PDF text extraction failed:', err instanceof Error ? err.message : err)
        foldedTexts.push('[PDF could not be read.]')
      }
      continue
    }
    kept.push(a) // image/video — untouched
  }

  if (foldedTexts.length === 0) return { messages, attachments: kept }

  // Prepend the document text to the last user message so the model sees
  // the document as context ahead of the user's actual prompt.
  const docBlock = `Attached document(s):\n\n${foldedTexts.join('\n\n---\n\n')}`
  const rewritten = messages.map((m, i) =>
    i === messages.length - 1 && m.role === 'user'
      ? { ...m, content: `${docBlock}\n\n---\n\n${String(m.content)}` }
      : m,
  )
  return { messages: rewritten, attachments: kept }
}

/**
 * Every router below names its providers explicitly and ends here. The
 * routers used to end in a bare `else` pointing at Alibaba — correct when
 * Alibaba was the only implementation, and silently wrong from the moment
 * the second provider was added in front of it. A misrouted call does not
 * fail cleanly: it reaches the wrong vendor with the wrong API key and
 * reports an error naming a company the model has nothing to do with.
 */
function noImplementation(model: ModelInfo, kind: 'text' | 'image' | 'video', implemented: string[]): never {
  throw new Error(
    `Provider "${model.provider}" has no ${kind} implementation. ` +
    `${kind[0].toUpperCase()}${kind.slice(1)} is implemented for: ${implemented.join(', ')}. ` +
    `Model "${model.model_name}" declares ${kind} output but cannot be run — ` +
    `disable the row in /admin/models or add a ${kind} path for this provider.`,
  )
}

function assertSupported(model: ModelInfo): void {
  if (!SUPPORTED_PROVIDERS.includes(model.provider)) {
    throw new Error(
      `Unsupported provider "${model.provider}". Supported: ${SUPPORTED_PROVIDERS.join(', ')}.`
    )
  }
}

function descriptor(
  model: ModelInfo,
  mode: 'text' | 'image' | 'video',
  context?: CallContext,
  thinkingLevel?: string | null,
) {
  return {
    provider:   model.provider,
    model_name: model.model_name,
    model_id:   model.id ?? null,
    mode,
    user_id:    context?.userId ?? null,
    // Migration 88: latency without the effort it ran at is an average
    // over settings, not a measurement.
    thinking_level: thinkingLevel ?? null,
  }
}

export async function streamText(
  model:       ModelInfo,
  messages:    { role: 'user' | 'assistant'; content: any }[],
  callbacks:   TextStreamCallbacks,
  attachments: Attachment[] = [],
  context?:    CallContext,
  genOptions?: {
    thinking?: string | null
    search?: boolean
    maxTokens?: number
    /** Operator instruction. Goes to each provider's native system slot —
     *  never into `messages`, which has no system role here. */
    system?: string | null
    jsonMode?: boolean
    jsonSchema?: JsonSchemaSpec | null
  },
): Promise<{ requestId: string | null }> {
  assertSupported(model)
  const thinking = genOptions?.thinking ?? null

  // Web search is opt-in per call AND gated on the model declaring the
  // capability. Asking a model that cannot search to search is a hard
  // upstream 400 on some providers, so the guard lives here rather than
  // trusting every call site to have filtered its model list.
  const search = !!genOptions?.search && supportsWebSearch(model)
  if (genOptions?.search && !search) {
    console.warn(`[providers] search requested but ${model.provider}/${model.model_name} is not search-capable — running without it`)
  }

  // Resolve document attachments (PDF / txt): natively-capable models keep
  // the PDF; everyone else gets the extracted text folded into the prompt.
  ;({ messages, attachments } = await resolveDocAttachments(model, messages, attachments))

  // Estimate cost from prompt length so we can compare estimate-vs-real
  // in analytics. Only the last user message matters for typical chat —
  // approximate by summing all text content lengths.
  const promptChars = messages.reduce((acc, m) => acc + String(m.content ?? '').length, 0)
  const desc      = descriptor(model, 'text', context, thinking)
  const requestId = startCall(desc, { estimated_cost_usd: estimateCost(model, 'text', { promptChars, thinkingLevel: thinking }) })
  const t0        = Date.now()

  // Hook the user's onDone so we capture usage when the stream finishes
  // successfully. We track each metric as a separate variable so TS
  // doesn't narrow a struct literal back to `null` on read.
  let inTok:    number | null = null
  let outTok:   number | null = null
  let cached:   number | null = null
  let imgInTok: number | null = null
  let cost:     number | null = null
  let searches: number | null = null
  let usage:    any            = null
  const wrappedCallbacks: TextStreamCallbacks = {
    onDelta: callbacks.onDelta,
    onDone: (result) => {
      inTok    = result.inputTokens
      outTok   = result.outputTokens
      cached   = result.cachedTokens
      cost     = result.cost
      imgInTok = result.inputImageTokens ?? null
      searches = result.searchCount      ?? null
      usage    = result.usageMetadata    ?? null
      callbacks.onDone(result)
    },
    onError: (message) => callbacks.onError(message),
  }

  const extras: TextGenExtras = {
    system:     genOptions?.system ?? null,
    jsonMode:   genOptions?.jsonMode ?? false,
    jsonSchema: genOptions?.jsonSchema ?? null,
  }

  try {
    if (model.provider === 'openai') {
      await openai.streamText(model, messages, wrappedCallbacks, attachments, thinking, search, extras)
    } else if (model.provider === 'google') {
      await google.streamText(model, messages, wrappedCallbacks, attachments, thinking, search, extras)
    } else if (model.provider === 'anthropic') {
      await anthropic.streamText(model, messages, wrappedCallbacks, attachments, thinking, search, genOptions?.maxTokens, extras)
    } else if (model.provider === 'moonshot') {
      await moonshot.streamText(model, messages, wrappedCallbacks, attachments, thinking, extras)
    } else if (model.provider === 'alibaba') {
      await alibaba.streamText(model, messages, wrappedCallbacks, attachments, search, thinking, extras)
    } else if (model.provider === 'xai') {
      await xai.streamText(model, messages, wrappedCallbacks, attachments, thinking, extras)
    } else {
      noImplementation(model, 'text', ['openai', 'google', 'anthropic', 'moonshot', 'alibaba', 'xai'])
    }
    endCall(requestId, desc, {
      status:               'success',
      latency_ms:           Date.now() - t0,
      input_tokens:         inTok,
      output_tokens:        outTok,
      cached_input_tokens:  cached,
      input_image_tokens:   imgInTok,
      cost_usd:             cost,
      usage_metadata:       searches != null ? { ...(usage ?? {}), web_search_requests: searches } : usage,
    })
    return { requestId }
  } catch (err) {
    endCall(requestId, desc, {
      status:        'failed',
      latency_ms:    Date.now() - t0,
      error_message: (err as Error).message?.slice(0, 1000) ?? 'unknown error',
    })
    // Tag the error with the provider_calls request id so routes can
    // surface a report/debug reference to the user (CC, July 20).
    if (err instanceof Error) (err as any).requestId = requestId
    throw err
  }
}

export async function generateImage(
  model:       ModelInfo,
  prompt:      string,
  quality:     'low' | 'medium' | 'high' = 'medium',
  size:        string = '1024x1024',
  attachments: Attachment[] = [],
  // Multi-turn context (provider-specific)
  previousResponseId?: string | null,       // OpenAI
  conversationHistory?: any[] | null,       // Google
  context?:    CallContext,
  options?:    ImageOptions,
): Promise<ImageResult & { requestId: string | null }> {
  assertSupported(model)

  const desc      = descriptor(model, 'image', context)
  const requestId = startCall(desc, {
    estimated_cost_usd: estimateCost(model, 'image', { promptChars: prompt.length, quality, size }),
  })
  const t0        = Date.now()

  try {
    let result: ImageResult
    if (model.provider === 'openai') {
      result = await openai.generateImage(model, prompt, quality, size, attachments, previousResponseId ?? null, options)
    } else if (model.provider === 'google') {
      // Persisted histories carry storage markers instead of inline base64
      // (lib/providers/history-storage.ts). Rehydrate for the API call, then
      // splice the caller's marker entries back over the echoed prefix so
      // the dehydrated form is what flows onward to whoever persists it.
      const givenHistory = conversationHistory ?? null
      const liveHistory  = givenHistory && historyHasMarkers(givenHistory)
        ? await rehydrateHistory(givenHistory)
        : givenHistory
      result = await google.generateImage(model, prompt, quality, size, attachments, liveHistory, options)
      if (givenHistory && Array.isArray(result.conversationHistory) && result.conversationHistory.length >= givenHistory.length) {
        result.conversationHistory = [...givenHistory, ...result.conversationHistory.slice(givenHistory.length)]
      }
    } else if (model.provider === 'xai') {
      result = await xai.generateImage(model, prompt, quality, size, attachments, options)
    } else if (model.provider === 'alibaba') {
      result = await alibaba.generateImage(model, prompt, quality, size, attachments, options)
    } else {
      noImplementation(model, 'image', ['openai', 'google', 'xai', 'alibaba'])
    }
    endCall(requestId, desc, {
      status:               'success',
      latency_ms:           Date.now() - t0,
      cost_usd:             result.cost ?? null,
      input_tokens:         (result.inputTextTokens ?? 0) + (result.inputImageTokens ?? 0) || null,
      output_tokens:        (result.outputTextTokens ?? 0) + (result.outputImageTokens ?? 0) || null,
      input_image_tokens:   result.inputImageTokens   ?? null,
      cached_input_tokens:  result.cachedTokens       ?? null,
      usage_metadata:       result.usageMetadata      ?? null,
    })
    return { ...result, requestId }
  } catch (err) {
    endCall(requestId, desc, {
      status:        'failed',
      latency_ms:    Date.now() - t0,
      error_message: (err as Error).message?.slice(0, 1000) ?? 'unknown error',
    })
    // Tag the error with the provider_calls request id so routes can
    // surface a report/debug reference to the user (CC, July 20).
    if (err instanceof Error) (err as any).requestId = requestId
    throw err
  }
}

/** Optional generation-time parameters that vary by provider. */
export interface VideoOptions {
  /** Alibaba-only: tri-state. null = use provider default (don't send).
   *  true = watermark on, false = off. Other providers ignore. */
  watermark?: boolean | null
  /** Aspect ratio string (e.g. '16:9'). Passed as `ratio` to Alibaba. */
  aspect_ratio?: string | null
  /** The slot's recipe (reference_frames / start_end_frames /
   *  image_to_video ...). Google/Veo needs it to decide whether image
   *  attachments are referenceImages or start/end interpolation frames. */
  mode?: string | null
  /** Veo extension (mode 'extend_video'): the source video's
   *  providerVideoRef from a prior Veo generation. Veo cannot extend
   *  arbitrary videos — only its own outputs, within ~2 days. */
  extend_video_ref?: string | null
  /** Wan 3.0 generates its own audio track (`audio`, default true upstream).
   *  false asks for a silent clip — the right call whenever the sound is
   *  going to be replaced anyway, which on this product is every music video:
   *  XCut mutes the clips and lays the real track over them, so the model's
   *  invented ambience was only ever throwaway. null = provider default. */
  generate_audio?: boolean | null
  /** Wan 3.0 `seed`, [0, 2147483647]. Same seed + same inputs reproduces a
   *  take — the only way to change ONE thing about a shot and see just that
   *  change, instead of a whole new roll of the dice. */
  seed?: number | null
}

/** Optional generation-time parameters for image models. */
export interface ImageOptions {
  /** Alibaba Qwen Image: adds the "Qwen-Image" watermark when true. */
  watermark?: boolean | null
  /** Aspect ratio (rarely used for image — most providers infer from size). */
  aspect_ratio?: string | null
  /** Number of images to generate. Qwen Image 2.0 series supports 1-6;
   *  qwen-image / qwen-image-plus / qwen-image-max are fixed at 1. */
  count?: number | null
}

export async function generateVideo(
  model:       ModelInfo,
  prompt:      string,
  size:        string = '1280x720',
  seconds:     number = 16,
  attachments: Attachment[] = [],
  onProgress?: (pct: number) => void,
  context?:    CallContext,
  options?:    VideoOptions,
): Promise<VideoResult & { requestId: string | null }> {
  assertSupported(model)

  // Alibaba/DashScope, Google/Veo, xAI/Grok Imagine and Runway support native video.
  if (model.provider !== 'alibaba' && model.provider !== 'google' && model.provider !== 'xai' && model.provider !== 'runway' && model.provider !== 'minimax') {
    throw new Error(`Video generation not supported for provider: ${model.provider}`)
  }

  // Resolution key inferred from min(width,height) of the size string.
  const sizeMatch = size.match(/(\d+)\s*[x×*]\s*(\d+)/i)
  const minDim = sizeMatch ? Math.min(parseInt(sizeMatch[1], 10), parseInt(sizeMatch[2], 10)) : 720
  const resolution = minDim >= 2160 ? '4k' : minDim >= 1080 ? '1080p' : minDim >= 720 ? '720p' : '480p'

  const desc      = descriptor(model, 'video', context)
  const requestId = startCall(desc, {
    estimated_cost_usd: estimateCost(model, 'video', { resolution, seconds }),
  })
  const t0        = Date.now()

  try {
    const result =
      model.provider === 'google'  ? await google.generateVideo(model, prompt, size, seconds, attachments, onProgress, options)
    : model.provider === 'xai'     ? await xai.generateVideo(model, prompt, size, seconds, attachments, onProgress, options)
    : model.provider === 'runway'  ? await runway.generateVideo(model, prompt, size, seconds, attachments, onProgress, options)
    : model.provider === 'minimax' ? await minimax.generateVideo(model, prompt, size, seconds, attachments, onProgress, options)
    : model.provider === 'alibaba' ? await alibaba.generateVideo(model, prompt, size, seconds, attachments, onProgress, options)
    : noImplementation(model, 'video', ['google', 'xai', 'runway', 'alibaba', 'minimax'])
    endCall(requestId, desc, {
      status:         'success',
      latency_ms:     Date.now() - t0,
      cost_usd:       result.cost ?? null,
      usage_metadata: result.usageMetadata ?? null,
    })
    return { ...result, requestId }
  } catch (err) {
    endCall(requestId, desc, {
      status:        'failed',
      latency_ms:    Date.now() - t0,
      error_message: (err as Error).message?.slice(0, 1000) ?? 'unknown error',
    })
    // Tag the error with the provider_calls request id so routes can
    // surface a report/debug reference to the user (CC, July 20).
    if (err instanceof Error) (err as any).requestId = requestId
    throw err
  }
}

// ── audio → text (transcription) ─────────────────────────────────────────────
// OpenAI-only today (whisper-1). Same start/end call-log discipline as every
// other invocation; cost is per audio minute from model_pricing.

export type { TranscriptionResult } from './openai'

export async function transcribeAudio(
  model:      ModelInfo,
  audio:      Attachment,
  biasPrompt: string | null,
  context?:   CallContext,
): Promise<openai.TranscriptionResult | alibaba.TranscriptionResult> {
  assertSupported(model)
  const desc = descriptor(model, 'text', context)
  const t0 = Date.now()
  const requestId = startCall(desc, {})
  try {
    const r = model.provider === 'alibaba'
      ? await alibaba.transcribeAudio(model, audio, biasPrompt)
      : model.provider === 'openai'
        ? await openai.transcribeAudio(model, audio, biasPrompt)
        : noImplementation(model, 'text', ['openai', 'alibaba'])
    endCall(requestId, desc, {
      status:     'success',
      latency_ms: Date.now() - t0,
      cost_usd:   r.cost,
      usage_metadata: { audio_seconds: r.durationSeconds },
    })
    return r
  } catch (err) {
    endCall(requestId, desc, {
      status:        'failed',
      latency_ms:    Date.now() - t0,
      error_message: (err as Error).message?.slice(0, 1000) ?? 'unknown error',
    })
    if (err instanceof Error) (err as any).requestId = requestId
    throw err
  }
}
