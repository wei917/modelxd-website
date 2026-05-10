// lib/providers/google.ts
//
// Direct Google Gemini provider using the official @google/genai SDK.
//   - Text:  generateContentStream for streaming text
//   - Image: generateContent with responseModalities=['IMAGE','TEXT']
//            Multi-turn supported by passing full conversation history
//   - Video: Veo via models.generateVideos (async operation + polling)

import { GoogleGenAI, type Content, type Part } from '@google/genai'
import type {
  ModelInfo,
  TextStreamCallbacks,
  ImageResult,
  VideoResult,
  Attachment,
} from './types'
import { calcTextCost, calcImageCost, calcVideoCost } from './pricing'

let _ai: GoogleGenAI | null = null
function ai(): GoogleGenAI {
  if (!_ai) {
    const key = process.env.GOOGLE_AI_API_KEY
    if (!key) throw new Error('GOOGLE_AI_API_KEY is not set')
    _ai = new GoogleGenAI({ apiKey: key })
  }
  return _ai
}

// ── text (streaming) ──────────────────────────────────────────────────────────

export async function streamText(
  model: ModelInfo,
  messages: { role: 'user' | 'assistant'; content: any }[],
  callbacks: TextStreamCallbacks,
  attachments: Attachment[] = [],
): Promise<void> {
  const TAG = `[google/${model.model_name}]`
  console.log(`${TAG} streamText start messages=${messages.length} attachments=${attachments.length}`)

  // Convert to Gemini format
  const contents: Content[] = messages.map((m, i) => {
    const parts: Part[] = []

    // Add attachments to last user message
    if (i === messages.length - 1 && m.role === 'user' && attachments.length > 0) {
      for (const att of attachments) {
        if (att.mediaType.startsWith('image/')) {
          parts.push({
            inlineData: {
              mimeType: att.mediaType,
              data: att.buffer.toString('base64'),
            },
          })
        }
      }
    }

    parts.push({ text: String(m.content) })

    return {
      role: m.role === 'assistant' ? 'model' : 'user',
      parts,
    }
  })

  try {
    const stream = await ai().models.generateContentStream({
      model: model.model_name,
      contents,
    })

    let inputTokens = 0
    let outputTokens = 0

    for await (const chunk of stream) {
      const text = chunk.text
      if (text) {
        callbacks.onDelta(text)
      }

      // Usage metadata on the last chunk
      if (chunk.usageMetadata) {
        inputTokens  = chunk.usageMetadata.promptTokenCount ?? 0
        outputTokens = chunk.usageMetadata.candidatesTokenCount ?? 0
      }
    }

    const cost = calcTextCost(model, inputTokens, outputTokens, 0)
    console.log(`${TAG} done in=${inputTokens} out=${outputTokens} cost=$${cost.toFixed(6)}`)
    callbacks.onDone({ inputTokens, outputTokens, cachedTokens: 0, cost })
  } catch (err: any) {
    callbacks.onError(`Google: ${err?.message ?? err}`)
  }
}

// ── image generation ──────────────────────────────────────────────────────────
//
// Gemini image generation uses generateContent with
// responseModalities: ['IMAGE', 'TEXT']. Multi-turn editing is achieved by
// passing the full conversation history including previous image parts.

export async function generateImage(
  model: ModelInfo,
  prompt: string,
  quality: 'low' | 'medium' | 'high' = 'medium',
  size: string = '1024x1024',
  attachments: Attachment[] = [],
  conversationHistory: Array<{ role: string; parts: any[] }> | null = null,
): Promise<ImageResult & { conversationHistory?: any[] }> {
  const TAG = `[google/${model.model_name}]`
  console.log(`${TAG} generateImage size=${size} attachments=${attachments.length} historyLen=${conversationHistory?.length ?? 0}`)

  let contents: Content[]

  if (conversationHistory && conversationHistory.length > 0) {
    // Multi-turn: use provided history + new user prompt
    contents = [
      ...conversationHistory.map(h => ({
        role: h.role === 'assistant' ? 'model' : h.role,
        parts: h.parts,
      } as Content)),
      { role: 'user', parts: [{ text: prompt }] },
    ]
  } else {
    // First turn — include all image attachments
    const parts: Part[] = []
    for (const att of attachments) {
      if (att.mediaType.startsWith('image/')) {
        parts.push({
          inlineData: {
            mimeType: att.mediaType,
            data: att.buffer.toString('base64'),
          },
        })
      }
    }
    parts.push({ text: prompt })
    contents = [{ role: 'user', parts }]
  }

  const response = await ai().models.generateContent({
    model: model.model_name,
    contents,
    config: {
      responseModalities: ['IMAGE', 'TEXT'],
    },
  })

  // ── debug: dump everything Google sent back so we can map usage → cost ──
  try {
    console.log(`${TAG} response.keys=${JSON.stringify(Object.keys(response ?? {}))}`)
  } catch { /* ignore */ }
  try {
    console.log(`${TAG} response.usageMetadata=${JSON.stringify((response as any)?.usageMetadata)}`)
  } catch { /* ignore */ }
  try {
    // Strip the actual image bytes from candidates so the log isn't 5MB.
    const lite = JSON.parse(JSON.stringify(response, (k, v) => k === 'data' ? '<bytes>' : v))
    console.log(`${TAG} response=${JSON.stringify(lite).slice(0, 1500)}`)
  } catch (e) {
    console.log(`${TAG} response (stringify failed): ${(e as Error).message}`)
  }

  // Extract image from response
  let imageBuffer: Buffer | null = null
  let mimeType = 'image/png'
  const responseParts: Part[] = []

  const candidates = response.candidates
  if (candidates && candidates.length > 0) {
    const parts = candidates[0].content?.parts ?? []
    for (const part of parts) {
      responseParts.push(part as Part)
      if ((part as any).inlineData) {
        const data = (part as any).inlineData
        imageBuffer = Buffer.from(data.data, 'base64')
        mimeType = data.mimeType ?? 'image/png'
      }
    }
  }

  if (!imageBuffer) {
    throw new Error(`Gemini returned no image. Response: ${JSON.stringify(response).slice(0, 500)}`)
  }

  // Build updated conversation history for multi-turn
  const updatedHistory = [
    ...(conversationHistory ?? contents.map(c => ({
      role: c.role === 'model' ? 'assistant' : c.role,
      parts: c.parts,
    }))),
    // If we used the first-turn path, history was built from contents above.
    // Only add the assistant response if we had existing history.
    ...(conversationHistory ? [{
      role: 'user',
      parts: [{ text: prompt }],
    }] : []),
    {
      role: 'assistant',
      parts: responseParts,
    },
  ]

  // Cost — split out per-modality token counts from Gemini's usageMetadata
  // so calcImageCost can apply per-modality rates if the model is token-billed.
  const usage = response.usageMetadata as any
  const promptTokensDetails:    Array<{ modality?: string; tokenCount?: number }> = usage?.promptTokensDetails    ?? []
  const candidatesTokensDetails: Array<{ modality?: string; tokenCount?: number }> = usage?.candidatesTokensDetails ?? []

  const findTokens = (arr: typeof promptTokensDetails, mod: string): number =>
    arr.find(d => d.modality === mod)?.tokenCount ?? 0

  const inputTextTokens   = findTokens(promptTokensDetails, 'TEXT')
  const inputImageTokens  = findTokens(promptTokensDetails, 'IMAGE')
  const outputImageTokens = findTokens(candidatesTokensDetails, 'IMAGE')
  const outputTextTokens  = findTokens(candidatesTokensDetails, 'TEXT')

  // Token-based cost via calcImageCost (uses model_pricing.tokens.{text_input,
  // image_input, text_output, image_output}); falls back to per-image flat
  // (model_pricing.per_image[quality]) when no token rates are configured.
  // We pass outputTextTokens too so any "Okay, here's…" preamble in the
  // response gets billed at text_output rate.
  const cost = calcImageCost(model, quality, undefined, {
    inputTextTokens,
    inputImageTokens,
    outputTextTokens,
    outputImageTokens,
  })

  console.log(`${TAG} image ok bytes=${imageBuffer.length} historyLen=${updatedHistory.length} cost=$${cost.toFixed(6)} tokens(in_text=${inputTextTokens}, in_image=${inputImageTokens}, out_image=${outputImageTokens}, out_text=${outputTextTokens})`)
  return {
    buffer:             imageBuffer,
    mediaType:          mimeType,
    cost,
    conversationHistory: updatedHistory,
    inputTextTokens,
    inputImageTokens,
    outputTextTokens,
    outputImageTokens,
    usageMetadata:      usage ?? null,
  }
}

// ── video (Veo, async operation) ─────────────────────────────────────────────
//
// Veo follows a long-running-operation pattern:
//   1. ai.models.generateVideos({ model, prompt, image?, config }) → operation
//   2. while (!operation.done) operation = ai.operations.getVideosOperation({ operation })
//   3. operation.response.generatedVideos[0].video has a `.uri` we can fetch
//      with the API key appended.
//
// Image attachments map to image-to-video. The first image attachment is
// used as the conditioning frame. Multi-image (referenceImages) support
// could be added later for veo-3.1's reference_frames mode.

export async function generateVideo(
  model:       ModelInfo,
  prompt:      string,
  size:        string = '1280x720',
  seconds:     number = 8,
  attachments: Attachment[] = [],
  onProgress?: (pct: number) => void,
): Promise<VideoResult> {
  const TAG = `[google/${model.model_name}]`

  // Map our flat size string → Veo's resolution + aspect ratio inputs.
  // Veo currently accepts '720p' / '1080p' / '4k' for resolution and a small
  // set of aspectRatio strings ('16:9', '9:16', etc.).
  const [wStr, hStr] = size.includes('x') ? size.split('x') : ['1280', '720']
  const w = parseInt(wStr, 10) || 1280
  const h = parseInt(hStr, 10) || 720
  const minDim = Math.min(w, h)
  const resolution = minDim >= 2160 ? '4k' : minDim >= 1080 ? '1080p' : '720p'
  const aspectRatio = w === h ? '1:1' : (w >= h ? '16:9' : '9:16')

  console.log(`${TAG} generateVideos start aspect=${aspectRatio} resolution=${resolution} duration=${seconds}s attachments=${attachments.length}`)

  // Build the request. Cast to `any` because the SDK's TS surface for
  // generateVideos is still in flux and several fields (durationSeconds,
  // image) aren't guaranteed to be in the published types.
  const request: any = {
    model:  model.model_name,
    prompt,
    config: {
      aspectRatio,
      resolution,
      numberOfVideos:  1,
      durationSeconds: seconds,
    },
  }

  const imageAtts = attachments.filter(a => a.mediaType.startsWith('image/'))
  if (imageAtts.length >= 1) {
    request.image = {
      imageBytes: imageAtts[0].buffer.toString('base64'),
      mimeType:   imageAtts[0].mediaType,
    }
    console.log(`${TAG} using image[0] as conditioning frame (mime=${imageAtts[0].mediaType}, ${imageAtts[0].buffer.length}b)`)
  }
  // Veo 3.1 supports start+end frame interpolation via `config.lastFrame`.
  // When the user attaches a second image, treat it as the end frame so
  // start_end_frames mode actually consumes both. Older Veo versions ignore
  // the field — that's fine, they just fall back to start-frame-only.
  //
  // Veo 3.1's lastFrame ONLY works with durationSeconds=8 — any other value
  // returns a generic 400 "use case not supported". Force-override the
  // duration here so the request actually succeeds. (This is documented in
  // a Google AI Forum thread, not the official docs.)
  if (imageAtts.length >= 2) {
    request.config.lastFrame = {
      imageBytes: imageAtts[1].buffer.toString('base64'),
      mimeType:   imageAtts[1].mediaType,
    }
    if (request.config.durationSeconds !== 8) {
      console.log(`${TAG} lastFrame requires durationSeconds=8 (was ${request.config.durationSeconds}); overriding`)
      request.config.durationSeconds = 8
    }
    console.log(`${TAG} using image[1] as lastFrame (mime=${imageAtts[1].mediaType}, ${imageAtts[1].buffer.length}b)`)
  }

  if (onProgress) onProgress(2)

  let operation: any = await (ai().models as any).generateVideos(request)
  console.log(`${TAG} operation submitted name=${operation?.name ?? '(unknown)'}`)

  // Poll. Veo typically takes 1–3 minutes; we cap at 10 minutes total.
  const POLL_INTERVAL_MS  = 10_000
  const MAX_POLLS         = 60        // 10 min
  let polls = 0
  while (!operation?.done) {
    if (polls >= MAX_POLLS) {
      throw new Error(`Veo operation timed out after ${MAX_POLLS * POLL_INTERVAL_MS / 1000}s`)
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
    operation = await (ai().operations as any).getVideosOperation({ operation })
    polls++
    if (onProgress) onProgress(Math.min(90, 5 + polls * 5))
  }

  if (operation.error) {
    throw new Error(`Veo operation failed: ${operation.error.message ?? JSON.stringify(operation.error).slice(0, 500)}`)
  }

  // Drill into response. Shape: response.generatedVideos[0].video.{uri,mimeType}
  const resp: any = operation?.response ?? {}

  // Veo's RAI (Responsible AI) filter rejects inputs that violate policy
  // (celebrity likeness, sexual content, violence, etc.) by returning
  // `raiMediaFilteredCount > 0` with `raiMediaFilteredReasons` instead of
  // generated videos. Surface that cleanly so the UI can show the real
  // reason instead of "missing video URI".
  if (resp.raiMediaFilteredCount > 0 || (Array.isArray(resp.raiMediaFilteredReasons) && resp.raiMediaFilteredReasons.length > 0)) {
    const reason = (resp.raiMediaFilteredReasons ?? []).join(' | ') || 'Content blocked by safety filter'
    throw new Error(`Veo blocked: ${reason}`)
  }

  const video = resp?.generatedVideos?.[0]?.video
  if (!video?.uri) {
    throw new Error(`Veo response missing video URI: ${JSON.stringify(resp).slice(0, 500)}`)
  }

  // Real billed duration — Veo returns the actual generated clip length on
  // operation.metadata (the long-running-operation pattern uses
  // `metadata` for service-specific info, separate from `response`).
  // Common keys observed: usageMetadata.videoDurationSeconds, totalBilledSeconds,
  // videoDuration (string like "8s"). We probe several and fall back to the
  // user-requested duration if none are present.
  const meta: any = operation?.metadata ?? {}
  const um:   any = meta?.usageMetadata ?? meta?.usage_metadata ?? {}
  const billedSeconds: number = (() => {
    const candidates = [
      um?.videoDurationSeconds,
      um?.video_duration_seconds,
      um?.videoSecondsBilled,
      meta?.videoDurationSeconds,
      meta?.video_duration_seconds,
      meta?.totalBilledSeconds,
      // 'videoDuration' in protobuf duration form e.g. "8s" or "8.0s"
      typeof meta?.videoDuration === 'string' ? parseFloat(meta.videoDuration) : undefined,
      typeof meta?.video_duration === 'string' ? parseFloat(meta.video_duration) : undefined,
    ]
    for (const v of candidates) {
      const n = typeof v === 'number' ? v : (typeof v === 'string' ? parseFloat(v) : NaN)
      if (Number.isFinite(n) && n > 0) return n
    }
    return seconds
  })()
  if (billedSeconds !== seconds) {
    console.log(`${TAG} billed duration ${billedSeconds}s differs from requested ${seconds}s (using billed for cost)`)
  } else {
    console.log(`${TAG} billed duration metadata not surfaced; using requested ${seconds}s for cost`)
  }

  // Dump everything Google sent back so we can refine the candidate-key
  // list. We log:
  //   - top-level keys of the operation (so we know what fields exist)
  //   - the metadata object (often {} but worth confirming)
  //   - the full response object (sometimes carries usageMetadata even though
  //     the typed schema doesn't show it)
  //   - sdkHttpResponse if the SDK populated it
  try {
    console.log(`${TAG} operation.keys=${JSON.stringify(Object.keys(operation ?? {}))}`)
  } catch { /* ignore */ }
  console.log(`${TAG} operation.metadata=${JSON.stringify(meta).slice(0, 800)}`)
  try {
    console.log(`${TAG} operation.response=${JSON.stringify(operation?.response).slice(0, 1500)}`)
  } catch { /* ignore */ }
  const sdkHttp: any = (operation as any)?.sdkHttpResponse
  if (sdkHttp) {
    let bodyStr = ''
    try {
      const body = sdkHttp.body ?? sdkHttp
      bodyStr = typeof body === 'string' ? body : JSON.stringify(body)
    } catch { /* ignore */ }
    console.log(`${TAG} operation.sdkHttpResponse=${bodyStr.slice(0, 1500)}`)
  } else {
    console.log(`${TAG} operation.sdkHttpResponse=null (not populated by SDK)`)
  }

  // Download the file. Generative-language file URIs require the API key
  // appended as a query parameter (not a Bearer header).
  const apiKey = process.env.GOOGLE_AI_API_KEY!
  const sep = video.uri.includes('?') ? '&' : '?'
  const dlUrl = `${video.uri}${sep}key=${apiKey}`

  const dlRes = await fetch(dlUrl)
  if (!dlRes.ok) {
    throw new Error(`Failed to download Veo video: ${dlRes.status} ${dlRes.statusText}`)
  }
  const buffer    = Buffer.from(await dlRes.arrayBuffer())
  const mediaType = dlRes.headers.get('content-type') ?? video.mimeType ?? 'video/mp4'

  // Cost: video_pricing.rates[resolution] × billed seconds.
  const cost = calcVideoCost(model, resolution, billedSeconds)

  if (onProgress) onProgress(100)
  console.log(`${TAG} video ok bytes=${buffer.length} duration=${billedSeconds}s cost=$${cost.toFixed(4)}`)

  return {
    buffer,
    mediaType,
    durationSeconds: billedSeconds,
    cost,
    usageMetadata:   meta && Object.keys(meta).length > 0 ? meta : null,
  }
}
