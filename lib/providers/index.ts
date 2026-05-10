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
import { startCall, endCall, logMediaUrl } from './call-log'
import { estimateCost } from './pricing'
import type {
  ModelInfo,
  TextStreamCallbacks,
  ImageResult,
  VideoResult,
  Attachment,
} from './types'

export type { ModelInfo, TextStreamCallbacks, ImageResult, VideoResult, Attachment }
export { logMediaUrl }

/**
 * Optional per-call context. Pass from route handlers so the log row
 * can be attributed to a user. If omitted, user_id is logged as null.
 */
export interface CallContext {
  userId?: string | null
}

const SUPPORTED_PROVIDERS = ['openai', 'google', 'alibaba']

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
) {
  return {
    provider:   model.provider,
    model_name: model.model_name,
    model_id:   model.id ?? null,
    mode,
    user_id:    context?.userId ?? null,
  }
}

export async function streamText(
  model:       ModelInfo,
  messages:    { role: 'user' | 'assistant'; content: any }[],
  callbacks:   TextStreamCallbacks,
  attachments: Attachment[] = [],
  context?:    CallContext,
): Promise<{ requestId: string | null }> {
  assertSupported(model)

  // Estimate cost from prompt length so we can compare estimate-vs-real
  // in analytics. Only the last user message matters for typical chat —
  // approximate by summing all text content lengths.
  const promptChars = messages.reduce((acc, m) => acc + String(m.content ?? '').length, 0)
  const desc      = descriptor(model, 'text', context)
  const requestId = startCall(desc, { estimated_cost_usd: estimateCost(model, 'text', { promptChars }) })
  const t0        = Date.now()

  // Hook the user's onDone so we capture usage when the stream finishes
  // successfully. We track each metric as a separate variable so TS
  // doesn't narrow a struct literal back to `null` on read.
  let inTok:    number | null = null
  let outTok:   number | null = null
  let cached:   number | null = null
  let imgInTok: number | null = null
  let cost:     number | null = null
  let usage:    any            = null
  const wrappedCallbacks: TextStreamCallbacks = {
    onDelta: callbacks.onDelta,
    onDone: (result) => {
      inTok    = result.inputTokens
      outTok   = result.outputTokens
      cached   = result.cachedTokens
      cost     = result.cost
      imgInTok = result.inputImageTokens ?? null
      usage    = result.usageMetadata    ?? null
      callbacks.onDone(result)
    },
    onError: (message) => callbacks.onError(message),
  }

  try {
    if (model.provider === 'openai') {
      await openai.streamText(model, messages, wrappedCallbacks, attachments)
    } else if (model.provider === 'google') {
      await google.streamText(model, messages, wrappedCallbacks, attachments)
    } else {
      await alibaba.streamText(model, messages, wrappedCallbacks, attachments)
    }
    endCall(requestId, desc, {
      status:               'success',
      latency_ms:           Date.now() - t0,
      input_tokens:         inTok,
      output_tokens:        outTok,
      cached_input_tokens:  cached,
      input_image_tokens:   imgInTok,
      cost_usd:             cost,
      usage_metadata:       usage,
    })
    return { requestId }
  } catch (err) {
    endCall(requestId, desc, {
      status:        'failed',
      latency_ms:    Date.now() - t0,
      error_message: (err as Error).message?.slice(0, 1000) ?? 'unknown error',
    })
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
    estimated_cost_usd: estimateCost(model, 'image', { promptChars: prompt.length, quality }),
  })
  const t0        = Date.now()

  try {
    let result: ImageResult
    if (model.provider === 'openai') {
      result = await openai.generateImage(model, prompt, quality, size, attachments, previousResponseId ?? null)
    } else if (model.provider === 'google') {
      result = await google.generateImage(model, prompt, quality, size, attachments, conversationHistory ?? null)
    } else {
      result = await alibaba.generateImage(model, prompt, quality, size, attachments, options)
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

  // Alibaba/DashScope and Google/Veo both support native video generation.
  if (model.provider !== 'alibaba' && model.provider !== 'google') {
    throw new Error(`Video generation not supported for provider: ${model.provider}`)
  }

  // Resolution key inferred from min(width,height) of the size string.
  const sizeMatch = size.match(/(\d+)\s*[x×*]\s*(\d+)/i)
  const minDim = sizeMatch ? Math.min(parseInt(sizeMatch[1], 10), parseInt(sizeMatch[2], 10)) : 720
  const resolution = minDim >= 2160 ? '4k' : minDim >= 1080 ? '1080p' : '720p'

  const desc      = descriptor(model, 'video', context)
  const requestId = startCall(desc, {
    estimated_cost_usd: estimateCost(model, 'video', { resolution, seconds }),
  })
  const t0        = Date.now()

  try {
    const result = model.provider === 'google'
      ? await google.generateVideo(model, prompt, size, seconds, attachments, onProgress)
      : await alibaba.generateVideo(model, prompt, size, seconds, attachments, onProgress, options)
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
    throw err
  }
}
