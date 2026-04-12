// lib/providers/openrouter.ts
//
// Unified provider that routes text, image, and video generation through
// OpenRouter. All three modes share one API key (OPENROUTER_API_KEY).
//
// - Text:  POST /api/v1/chat/completions (stream=true, SSE)
// - Image: POST /api/v1/chat/completions (modalities=['image','text'])
//          image comes back inside message.images[].image_url.url as a
//          data:image/png;base64,... URL
// - Video: POST /api/alpha/videos (async, job-based)
//          then GET /api/alpha/videos/:jobId until status='completed'
//          then GET /api/alpha/videos/:jobId/content for raw bytes

import type {
  ModelInfo,
  TextStreamCallbacks,
  ImageResult,
  VideoResult,
  Attachment,
} from './types'

const BASE_URL = 'https://openrouter.ai/api/v1'
const VIDEO_BASE_URL = 'https://openrouter.ai/api/alpha'

function apiKey(): string {
  const k = process.env.OPENROUTER_API_KEY
  if (!k) throw new Error('OPENROUTER_API_KEY is not set')
  return k
}

function defaultHeaders(): Record<string, string> {
  return {
    'Authorization': `Bearer ${apiKey()}`,
    'Content-Type': 'application/json',
    // Optional but recommended by OpenRouter — used for attribution &
    // rate-limit allowances.
    'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://modelxd.com',
    'X-Title': 'ModelXD',
  }
}

// ── cost helpers ─────────────────────────────────────────────────────────────

function calcTextCost(
  model: ModelInfo,
  inputTokens: number,
  outputTokens: number,
  cachedTokens: number,
): number {
  const uncachedInput = Math.max(0, inputTokens - cachedTokens)
  const inputCost = (uncachedInput / 1_000_000) * (model.input_price ?? 0)
  const cachedCost = (cachedTokens / 1_000_000) * (model.cached_input_price ?? model.input_price ?? 0)
  const outputCost = (outputTokens / 1_000_000) * (model.output_price ?? 0)
  return inputCost + cachedCost + outputCost
}

// ── text (streaming) ─────────────────────────────────────────────────────────

// Model-name patterns that are known to be unstreamable through OpenRouter's
// chat/completions endpoint. Today that's OpenAI's GPT-5 *-pro models, which
// are "protected" on the OpenAI side and require org verification before
// streaming is allowed — unverified callers either get an error or a 200
// with no content deltas. For these we skip streaming entirely and buffer
// the full completion instead. This is keyed off the OpenRouter slug, which
// is `openai/gpt-5-pro`, `openai/gpt-5.4-pro`, etc.
const NON_STREAMING_PATTERNS: RegExp[] = [
  /\/gpt-5(?:\.\d+)?-pro(?:\b|$)/i,
]

function requiresNonStreaming(modelName: string): boolean {
  return NON_STREAMING_PATTERNS.some((re) => re.test(modelName))
}

export async function streamText(
  model: ModelInfo,
  messages: { role: 'user' | 'assistant'; content: any }[],
  callbacks: TextStreamCallbacks,
  attachment: Attachment | null = null,
): Promise<void> {
  const TAG = `[openrouter/${model.model_name}]`
  console.log(`${TAG} streamText start messages=${messages.length}`)

  // Convert messages to OpenRouter's OpenAI-compatible shape. If an
  // attachment is present on the last user message, inject it as a multimodal
  // content part.
  const openAiMessages = messages.map((m, i) => {
    if (i === messages.length - 1 && m.role === 'user' && attachment) {
      return buildMultimodalUserMessage(String(m.content), attachment)
    }
    return { role: m.role, content: m.content }
  })

  // Fast path: models we know can't stream. Skip the SSE machinery entirely
  // and just buffer the whole completion. We still emit one onDelta with the
  // full text so the UI updates exactly once — same contract as streaming.
  if (requiresNonStreaming(model.model_name)) {
    console.log(`${TAG} forced non-streaming (protected/reasoning model)`)
    await runNonStreaming(model, openAiMessages, callbacks, TAG)
    return
  }

  let res: Response
  try {
    res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: defaultHeaders(),
      body: JSON.stringify({
        model: model.model_name,
        stream: true,
        messages: openAiMessages,
        // Cap output to keep credit usage predictable. Without this,
        // OpenRouter reserves the model's full context window (e.g. 65k
        // tokens) up-front for the request, which can fail with 402 on
        // smaller credit balances.
        max_tokens: 4096,
        // Ask for usage stats on the final chunk (OpenRouter won't emit
        // usage by default when streaming unless this is set).
        stream_options: { include_usage: true },
      }),
    })
  } catch (err: any) {
    callbacks.onError(`OpenRouter request failed: ${err?.message ?? err}`)
    return
  }

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => '')
    callbacks.onError(`OpenRouter ${res.status}: ${errText.slice(0, 500)}`)
    return
  }

  // ── SSE loop ──────────────────────────────────────────────────────────────
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let inputTokens = 0
  let outputTokens = 0
  let cachedTokens = 0
  let contentChars = 0
  let streamErrorMsg: string | null = null

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // OpenRouter uses standard SSE framing (\n\n between events). We
      // split and process each complete event; anything after the last
      // \n\n stays in the buffer for the next read.
      let sep
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, sep)
        buffer = buffer.slice(sep + 2)
        for (const line of rawEvent.split('\n')) {
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (data === '[DONE]' || data === '') continue
          let json: any
          try { json = JSON.parse(data) } catch { continue }

          // OpenRouter occasionally returns a 200 with an error payload
          // embedded mid-stream (e.g. when a downstream provider rejects
          // the request). Capture it so we can surface a real error below.
          if (json?.error) {
            streamErrorMsg = typeof json.error === 'string'
              ? json.error
              : (json.error.message ?? JSON.stringify(json.error))
            continue
          }

          const choice = json?.choices?.[0]
          const delta  = choice?.delta
          if (delta?.content) {
            const s = String(delta.content)
            contentChars += s.length
            callbacks.onDelta(s)
          }
          // Some providers emit a single non-delta chunk with the full
          // message on the `message` field instead of streaming. Handle
          // that shape too so we don't silently drop the response.
          else if (choice?.message?.content) {
            const s = String(choice.message.content)
            contentChars += s.length
            callbacks.onDelta(s)
          }

          // Usage arrives on the final chunk. OpenRouter follows OpenAI's
          // shape: { prompt_tokens, completion_tokens, total_tokens,
          // prompt_tokens_details?: { cached_tokens } }.
          if (json?.usage) {
            inputTokens = json.usage.prompt_tokens ?? inputTokens
            outputTokens = json.usage.completion_tokens ?? outputTokens
            cachedTokens = json.usage.prompt_tokens_details?.cached_tokens ?? cachedTokens
          }
        }
      }
    }
  } catch (err: any) {
    callbacks.onError(`Stream read failed: ${err?.message ?? err}`)
    return
  }

  if (streamErrorMsg) {
    callbacks.onError(`OpenRouter: ${streamErrorMsg}`)
    return
  }

  // Empty stream — the model accepted the request but emitted no visible
  // content (common with protected/reasoning models when streaming is
  // disabled at the provider layer). Fall back to a single non-streaming
  // request so the user still gets a response.
  if (contentChars === 0) {
    console.warn(`${TAG} stream returned no content; retrying non-streaming`)
    await runNonStreaming(model, openAiMessages, callbacks, TAG)
    return
  }

  const cost = calcTextCost(model, inputTokens, outputTokens, cachedTokens)
  console.log(`${TAG} done in=${inputTokens} out=${outputTokens} cached=${cachedTokens} cost=$${cost.toFixed(6)}`)
  callbacks.onDone({ inputTokens, outputTokens, cachedTokens, cost })
}

// Single-shot non-streaming completion used as the fast path for protected
// models and as the fallback when a streaming request yields no content.
// Emits the full response through a single onDelta followed by onDone, so
// the caller's contract is unchanged.
async function runNonStreaming(
  model:    ModelInfo,
  messages: any[],
  callbacks: TextStreamCallbacks,
  TAG:      string,
): Promise<void> {
  let res: Response
  try {
    res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: defaultHeaders(),
      body: JSON.stringify({
        model: model.model_name,
        stream: false,
        messages,
        max_tokens: 4096,
      }),
    })
  } catch (err: any) {
    callbacks.onError(`OpenRouter request failed: ${err?.message ?? err}`)
    return
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    callbacks.onError(`OpenRouter ${res.status}: ${errText.slice(0, 500)}`)
    return
  }

  let json: any
  try {
    json = await res.json()
  } catch (err: any) {
    callbacks.onError(`OpenRouter returned invalid JSON: ${err?.message ?? err}`)
    return
  }

  if (json?.error) {
    const msg = typeof json.error === 'string' ? json.error : (json.error.message ?? JSON.stringify(json.error))
    callbacks.onError(`OpenRouter: ${msg}`)
    return
  }

  const text: string = json?.choices?.[0]?.message?.content ?? ''
  if (!text) {
    callbacks.onError('OpenRouter returned an empty response')
    return
  }

  callbacks.onDelta(text)

  const usage = json?.usage ?? {}
  const inputTokens  = usage.prompt_tokens ?? 0
  const outputTokens = usage.completion_tokens ?? 0
  const cachedTokens = usage.prompt_tokens_details?.cached_tokens ?? 0
  const cost = calcTextCost(model, inputTokens, outputTokens, cachedTokens)
  console.log(`${TAG} non-stream done in=${inputTokens} out=${outputTokens} cached=${cachedTokens} cost=$${cost.toFixed(6)}`)
  callbacks.onDone({ inputTokens, outputTokens, cachedTokens, cost })
}

function buildMultimodalUserMessage(text: string, attachment: Attachment) {
  if (attachment.mediaType.startsWith('image/')) {
    return {
      role: 'user' as const,
      content: [
        {
          type: 'image_url',
          image_url: { url: `data:${attachment.mediaType};base64,${attachment.buffer.toString('base64')}` },
        },
        { type: 'text', text },
      ],
    }
  }
  if (attachment.mediaType === 'application/pdf' || attachment.mediaType.startsWith('text/')) {
    const content = attachment.buffer.toString('utf-8')
    return {
      role: 'user' as const,
      content: `File content:\n${content}\n\n${text}`,
    }
  }
  return { role: 'user' as const, content: text }
}

// ── image generation ─────────────────────────────────────────────────────────

export async function generateImage(
  model: ModelInfo,
  prompt: string,
  _quality: 'low' | 'medium' | 'high' = 'medium',
  size: string = '1024x1024',
  attachment: Attachment | null = null,
): Promise<ImageResult> {
  const TAG = `[openrouter/${model.model_name}]`
  console.log(`${TAG} generateImage size=${size}`)

  const userMessage = attachment
    ? buildMultimodalUserMessage(prompt, attachment)
    : { role: 'user' as const, content: prompt }

  // OpenRouter supports an optional image_config for aspect_ratio / size on
  // models that accept it. Passing it as a passthrough is harmless — unknown
  // keys are ignored by models that don't support them.
  const aspectRatio = (() => {
    if (!size.includes('x')) return undefined
    const [w, h] = size.split('x').map(Number)
    if (!w || !h) return undefined
    if (w === h) return '1:1'
    if (w > h) return '16:9'
    return '9:16'
  })()

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: defaultHeaders(),
    body: JSON.stringify({
      model: model.model_name,
      modalities: ['image', 'text'],
      messages: [userMessage],
      image_config: aspectRatio ? { aspect_ratio: aspectRatio } : undefined,
    }),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`OpenRouter image ${res.status}: ${errText.slice(0, 500)}`)
  }

  const json = await res.json()
  const choice = json?.choices?.[0]
  const images = choice?.message?.images
  if (!Array.isArray(images) || images.length === 0) {
    throw new Error(`OpenRouter returned no image. Response: ${JSON.stringify(json).slice(0, 500)}`)
  }
  const firstUrl: string | undefined = images[0]?.image_url?.url
  if (!firstUrl) throw new Error('OpenRouter image response missing image_url.url')

  // Expected format: data:image/png;base64,AAAA...
  const { buffer, mediaType } = dataUrlToBuffer(firstUrl)

  // Cost: use actual usage if present, else fall back to image_pricing.medium.
  let cost = model.image_pricing?.medium ?? 0
  const usage = json?.usage
  if (usage) {
    const inputTokens = usage.prompt_tokens ?? 0
    const outputTokens = usage.completion_tokens ?? 0
    const cachedTokens = usage.prompt_tokens_details?.cached_tokens ?? 0
    const tokenCost = calcTextCost(model, inputTokens, outputTokens, cachedTokens)
    if (tokenCost > 0) cost = tokenCost
  }

  console.log(`${TAG} image ok bytes=${buffer.length} cost=$${cost.toFixed(6)}`)
  return { buffer, mediaType, cost }
}

function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; mediaType: string } {
  // data:image/png;base64,XXXX
  const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/)
  if (!match) {
    // Some providers may return a plain https:// URL. We don't support that
    // path yet — surface a clear error so we can add it if needed.
    throw new Error(`Unexpected image_url format (expected data URL): ${dataUrl.slice(0, 80)}`)
  }
  const mediaType = match[1]
  const buffer = Buffer.from(match[2], 'base64')
  return { buffer, mediaType }
}

// ── video generation (async job) ─────────────────────────────────────────────

interface VideoJobResponse {
  id: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'expired'
  error?: { message?: string; code?: string }
  unsigned_urls?: string[]
  usage?: any
  progress?: number
}

export async function generateVideo(
  model: ModelInfo,
  prompt: string,
  size: string = '1280x720',
  seconds: number = 8,
  attachment: Attachment | null = null,
  onProgress?: (pct: number) => void,
): Promise<VideoResult> {
  const TAG = `[openrouter/${model.model_name}]`
  console.log(`${TAG} generateVideo size=${size} seconds=${seconds}`)

  // Resolution + aspect_ratio take priority in the API; size is the escape
  // hatch. We pass size for maximum precision (e.g. "1920x1080"), which
  // conflicts with resolution+aspect_ratio if both are set. The Alpha API
  // docs say to use one or the other.
  const body: Record<string, any> = {
    model: model.model_name,
    prompt,
    size,
    duration: seconds,
  }

  if (attachment && attachment.mediaType.startsWith('image/')) {
    body.input_references = [
      {
        type: 'image_url',
        image_url: { url: `data:${attachment.mediaType};base64,${attachment.buffer.toString('base64')}` },
      },
    ]
  }

  console.log(`${TAG} submit body=${JSON.stringify(body).slice(0, 300)}`)

  // Submit the job.
  const submitRes = await fetch(`${VIDEO_BASE_URL}/videos`, {
    method: 'POST',
    headers: defaultHeaders(),
    body: JSON.stringify(body),
  })
  if (!submitRes.ok) {
    const errText = await submitRes.text().catch(() => '')
    console.error(`${TAG} submit failed status=${submitRes.status} body=${errText.slice(0, 500)}`)
    throw new Error(`OpenRouter video submit ${submitRes.status}: ${errText.slice(0, 500)}`)
  }

  const submitJson = await submitRes.json() as VideoJobResponse
  const jobId = submitJson.id
  if (!jobId) throw new Error(`OpenRouter video response missing id: ${JSON.stringify(submitJson).slice(0, 300)}`)
  console.log(`${TAG} job created id=${jobId} status=${submitJson.status} fullResponse=${JSON.stringify(submitJson).slice(0, 400)}`)

  // Poll. Docs recommend every 30s; we use 10s to feel more responsive
  // with an overall timeout of ~20 minutes.
  const POLL_INTERVAL_MS = 10_000
  const MAX_POLL_ATTEMPTS = 120 // ~20 min

  let job: VideoJobResponse = submitJson
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    if (job.status === 'completed') break
    if (job.status === 'failed' || job.status === 'cancelled' || job.status === 'expired') {
      console.error(`${TAG} terminal status=${job.status} fullJob=${JSON.stringify(job).slice(0, 800)}`)
      const msg = job.error?.message
        ?? (job as any).error?.code
        ?? `terminal status "${job.status}" with no error message (full=${JSON.stringify(job).slice(0, 300)})`
      throw new Error(`OpenRouter video ${job.status}: ${msg}`)
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))

    const pollRes = await fetch(`${VIDEO_BASE_URL}/videos/${encodeURIComponent(jobId)}`, {
      method: 'GET',
      headers: defaultHeaders(),
    })
    if (!pollRes.ok) {
      const errText = await pollRes.text().catch(() => '')
      throw new Error(`OpenRouter video poll ${pollRes.status}: ${errText.slice(0, 500)}`)
    }
    job = await pollRes.json() as VideoJobResponse
    console.log(`${TAG} poll attempt=${attempt} status=${job.status} progress=${job.progress ?? '-'}`)
    if (typeof job.progress === 'number' && onProgress) onProgress(job.progress)
  }

  if (job.status !== 'completed') {
    throw new Error(`OpenRouter video did not complete in time (last status=${job.status})`)
  }

  // Download the raw MP4 bytes.
  const contentRes = await fetch(`${VIDEO_BASE_URL}/videos/${encodeURIComponent(jobId)}/content`, {
    method: 'GET',
    headers: defaultHeaders(),
  })
  if (!contentRes.ok) {
    const errText = await contentRes.text().catch(() => '')
    throw new Error(`OpenRouter video download ${contentRes.status}: ${errText.slice(0, 500)}`)
  }
  const arrayBuffer = await contentRes.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  const mediaType = contentRes.headers.get('content-type') || 'video/mp4'

  // Cost: use the resolution tag matching the requested size, then multiply
  // by seconds. This is a best-effort estimate; OpenRouter bills the actual
  // amount separately via their credit ledger.
  const resolutionKey = resolutionKeyForSize(size)
  const perSecond = (resolutionKey && model.video_pricing?.[resolutionKey])
    || model.video_pricing?.['720p']
    || Object.values(model.video_pricing ?? {})[0]
    || 0
  const cost = perSecond * seconds

  console.log(`${TAG} video ok bytes=${buffer.length} duration=${seconds}s cost=$${cost.toFixed(6)}`)
  return { buffer, mediaType, durationSeconds: seconds, cost }
}

function resolutionKeyForSize(size: string): string | null {
  if (!size.includes('x')) return null
  const [w, h] = size.split('x').map(Number)
  if (!w || !h) return null
  const shortSide = Math.min(w, h)
  if (shortSide >= 2000) return '4K'
  if (shortSide >= 1000) return '1080p'
  if (shortSide >= 700) return '720p'
  return '480p'
}
