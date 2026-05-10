// lib/providers/alibaba.ts
// Alibaba DashScope provider for image and video generation.
//
// Image: Sync endpoint (multimodal-generation)
// Video: Async task pattern (create → poll → download)
//   POST /api/v1/services/aigc/video-generation/video-synthesis
//   with X-DashScope-Async: enable
//
// Base URL: https://dashscope-intl.aliyuncs.com (Singapore International)
// Auth: Bearer token via DASHSCOPE_API_KEY env var
// Full API guide: docs/DASHSCOPE-API-GUIDE.md

import type { ModelInfo, TextStreamCallbacks, ImageResult, VideoResult, Attachment } from './types'
import { calcTextCost, calcImageCost, calcVideoCost } from './pricing'

// Singapore international endpoint. Override via DASHSCOPE_BASE_URL for other regions:
//   dashscope-us (Virginia), dashscope (China)
const BASE_URL = process.env.DASHSCOPE_BASE_URL
  ?? 'https://dashscope-intl.aliyuncs.com'

const IMAGE_ENDPOINT = '/api/v1/services/aigc/multimodal-generation/generation'
const VIDEO_ENDPOINT = '/api/v1/services/aigc/video-generation/video-synthesis'
const TASK_ENDPOINT  = '/api/v1/tasks'

function apiKey(): string {
  const key = process.env.DASHSCOPE_API_KEY
  if (!key) throw new Error('DASHSCOPE_API_KEY is not set')
  return key
}

function defaultHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey()}`,
  }
}

// ── cost helpers ───────────────────────────────────────────────────────────

// ── text (streaming via OpenAI-compatible Chat Completions) ────────────────

const CHAT_ENDPOINT = '/compatible-mode/v1/chat/completions'

export async function streamText(
  model: ModelInfo,
  messages: { role: 'user' | 'assistant'; content: any }[],
  callbacks: TextStreamCallbacks,
  attachments: Attachment[] = [],
): Promise<void> {
  const TAG = `[alibaba/${model.model_name}]`
  console.log(`${TAG} streamText start messages=${messages.length} attachments=${attachments.length}`)

  // Build messages array
  const chatMessages = messages.map((m, i) => {
    if (i === messages.length - 1 && m.role === 'user' && attachments.length > 0) {
      return buildMultimodalMessage(String(m.content), attachments)
    }
    return { role: m.role, content: String(m.content) }
  })

  let res: Response
  try {
    res = await fetch(`${BASE_URL}${CHAT_ENDPOINT}`, {
      method: 'POST',
      headers: defaultHeaders(),
      body: JSON.stringify({
        model: model.model_name,
        stream: true,
        messages: chatMessages,
        max_tokens: 4096,
        stream_options: { include_usage: true },
      }),
    })
  } catch (err: any) {
    callbacks.onError(`DashScope request failed: ${err?.message ?? err}`)
    return
  }

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => '')
    callbacks.onError(`DashScope ${res.status}: ${errText.slice(0, 500)}`)
    return
  }

  // SSE stream
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let inputTokens = 0
  let outputTokens = 0
  let cachedTokens = 0

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

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

          if (json?.error) {
            const msg = typeof json.error === 'string'
              ? json.error
              : (json.error.message ?? JSON.stringify(json.error))
            callbacks.onError(`DashScope: ${msg}`)
            return
          }

          const delta = json?.choices?.[0]?.delta?.content
          if (delta) callbacks.onDelta(String(delta))

          if (json?.usage) {
            inputTokens  = json.usage.prompt_tokens ?? inputTokens
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

  const cost = calcTextCost(model, inputTokens, outputTokens, cachedTokens)
  console.log(`${TAG} done in=${inputTokens} out=${outputTokens} cached=${cachedTokens} cost=$${cost.toFixed(6)}`)
  callbacks.onDone({ inputTokens, outputTokens, cachedTokens, cost })
}

function buildMultimodalMessage(text: string, attachments: Attachment[]) {
  const images = attachments.filter(a => a.mediaType.startsWith('image/'))

  if (images.length > 0) {
    const content: any[] = images.map(img => ({
      type: 'image_url',
      image_url: {
        url: `data:${img.mediaType};base64,${img.buffer.toString('base64')}`,
      },
    }))
    content.push({ type: 'text', text })
    return { role: 'user' as const, content }
  }

  return { role: 'user' as const, content: text }
}

// ── async task polling ──────────────────────────────────────────────────────

async function pollTask(
  taskId: string,
  TAG: string,
  onProgress?: (pct: number) => void,
  intervalMs = 15000,
  maxAttempts = 40, // ~10 minutes
): Promise<any> {
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(`${BASE_URL}${TASK_ENDPOINT}/${taskId}`, {
      headers: { 'Authorization': `Bearer ${apiKey()}` },
    })
    if (!res.ok) {
      throw new Error(`DashScope task poll ${res.status}: ${await res.text().catch(() => '')}`)
    }

    const data = await res.json()
    const status = data.output?.task_status

    if (status === 'SUCCEEDED') {
      console.log(`${TAG} task ${taskId} succeeded`)
      return data
    }
    if (status === 'FAILED') {
      throw new Error(
        `DashScope task failed: ${data.output?.message || data.output?.code || 'unknown error'}`
      )
    }

    // Report progress estimate based on attempt count
    const pct = Math.min(90, Math.round((i / maxAttempts) * 100))
    if (onProgress) onProgress(pct)
    console.log(`${TAG} task ${taskId} status=${status} (poll ${i + 1}/${maxAttempts})`)

    await new Promise(r => setTimeout(r, intervalMs))
  }
  throw new Error(`DashScope task ${taskId} timed out after ${maxAttempts} polls`)
}

// ── image generation ────────────────────────────────────────────────────────

export async function generateImage(
  model: ModelInfo,
  prompt: string,
  _quality: 'low' | 'medium' | 'high' = 'medium',
  size: string = '1024x1024',
  attachments: Attachment[] = [],
  options?: { watermark?: boolean | null; count?: number | null; aspect_ratio?: string | null },
): Promise<ImageResult> {
  const TAG = `[alibaba/${model.model_name}]`
  // DashScope native API uses asterisk separator: 1024*1024
  const dashSize = size.replace('x', '*')
  const imageAtts = attachments.filter(a => a.mediaType.startsWith('image/'))
  console.log(`${TAG} generateImage size=${dashSize} attachments=${imageAtts.length}`)

  // qwen-image-plus uses the async text2image endpoint (different API shape)
  const isAsyncModel = model.model_name === 'qwen-image-plus' || model.model_name === 'qwen-image'

  // Wan image models (wan2.6-image, wan2.7-image-pro) require at least 1 image input.
  // If no image is attached, they can't do pure text-to-image — throw a clear error.
  const isWanImage = model.model_name.includes('wan') && model.model_name.includes('image')
  if (isWanImage && imageAtts.length === 0) {
    throw new Error(`${model.model_name} requires an image attachment for editing/interleaving. For text-to-image, use a qwen-image model instead.`)
  }

  let res: Response

  if (isAsyncModel) {
    // Async text2image endpoint for qwen-image-plus
    const asyncUrl = `${BASE_URL}/api/v1/services/aigc/text2image/image-synthesis`
    console.log(`${TAG} POST ${asyncUrl} (async)`)

    const createRes = await fetch(asyncUrl, {
      method: 'POST',
      headers: {
        ...defaultHeaders(),
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify({
        model: model.model_name,
        input: { prompt },
        parameters: (() => {
          // Async qwen-image / qwen-image-plus accept n only as 1.
          const p: Record<string, unknown> = { size: dashSize, n: 1 }
          // watermark default is false on Qwen; only send if user explicitly picked
          if (options?.watermark === true)  p.watermark = true
          if (options?.watermark === false) p.watermark = false
          return p
        })(),
      }),
    })

    if (!createRes.ok) {
      const errText = await createRes.text().catch(() => '')
      throw new Error(`DashScope image ${createRes.status}: ${errText.slice(0, 500)}`)
    }

    const createData = await createRes.json()
    const taskId = createData.output?.task_id
    if (!taskId) {
      throw new Error(`DashScope returned no task_id: ${JSON.stringify(createData).slice(0, 500)}`)
    }

    console.log(`${TAG} async task created: ${taskId}`)

    // Poll for result
    const result = await pollTask(taskId, TAG)
    const imageUrl = result.output?.results?.[0]?.url
    if (!imageUrl) {
      throw new Error(`DashScope task completed but no image URL: ${JSON.stringify(result).slice(0, 500)}`)
    }

    const imgRes = await fetch(imageUrl)
    if (!imgRes.ok) throw new Error(`Failed to download DashScope image: ${imgRes.status}`)

    const arrayBuffer = await imgRes.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const contentType = imgRes.headers.get('content-type') ?? 'image/png'
    const cost = calcImageCost(model)

    console.log(`${TAG} image ok bytes=${buffer.length} cost=$${cost.toFixed(6)}`)
    return { buffer, mediaType: contentType, cost }
  }

  // Sync multimodal-generation endpoint (qwen-image-2.0-pro, qwen-image-2.0, qwen-image-max, wan*-image)
  const content: any[] = []

  for (const att of imageAtts) {
    const b64 = att.buffer.toString('base64')
    content.push({ image: `data:${att.mediaType};base64,${b64}` })
  }

  content.push({ text: prompt })

  // Sync endpoint accepts:
  //   - watermark (bool, default false)
  //   - n (image count, qwen-image-2.0 series 1..6 only; max/plus fixed at 1)
  //   - prompt_extend (default true)
  // Only set n when the model declares max_count > 1 — otherwise the API
  // rejects values other than 1.
  const syncParams: Record<string, unknown> = { size: dashSize }
  if (options?.watermark === true)  syncParams.watermark = true
  if (options?.watermark === false) syncParams.watermark = false
  const maxCount = model.output_config?.image?.max_count ?? 1
  if (maxCount > 1 && typeof options?.count === 'number' && options.count >= 1) {
    syncParams.n = Math.min(options.count, maxCount)
  }

  const body: any = {
    model: model.model_name,
    input: {
      messages: [
        { role: 'user', content },
      ],
    },
    parameters: syncParams,
  }

  const url = `${BASE_URL}${IMAGE_ENDPOINT}`
  console.log(`${TAG} POST ${url} parameters=${JSON.stringify(syncParams)} options received=${JSON.stringify(options)}`)

  res = await fetch(url, {
    method: 'POST',
    headers: defaultHeaders(),
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`DashScope image ${res.status}: ${errText.slice(0, 500)}`)
  }

  const json = await res.json()

  // Response format:
  // { output: { choices: [{ message: { content: [{ image: "https://..." }] } }] },
  //   usage: { image_count: 1 } }
  const choices = json?.output?.choices
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error(`DashScope returned no choices. Response: ${JSON.stringify(json).slice(0, 500)}`)
  }

  const msgContent = choices[0]?.message?.content
  if (!Array.isArray(msgContent)) {
    throw new Error(`DashScope message content missing. Response: ${JSON.stringify(json).slice(0, 500)}`)
  }

  // Collect every image entry. Qwen Image 2.0 series returns N images in
  // the same content array when n > 1.
  // Some API quirks observed: even when n > 1, if all entries point to the
  // same OSS URL, the model effectively only rendered one image. Log the
  // URLs so we can spot it.
  const imageEntries = (msgContent as any[]).filter((c: any) => typeof c?.image === 'string')
  if (imageEntries.length === 0) {
    const textEntry = (msgContent as any[]).find((c: any) => c.text)
    throw new Error(
      `DashScope returned no image.${textEntry ? ` Text: ${(textEntry.text as string).slice(0, 200)}` : ''} Response: ${JSON.stringify(json).slice(0, 300)}`
    )
  }

  const urls = imageEntries.map(e => (e.image as string))
  const uniqueUrls = Array.from(new Set(urls))
  console.log(`${TAG} response has ${urls.length} image entries (${uniqueUrls.length} unique URL${uniqueUrls.length === 1 ? '' : 's'})`)
  for (const u of uniqueUrls) console.log(`${TAG}   url=${u.slice(0, 110)}…`)
  if (uniqueUrls.length < urls.length) {
    console.warn(`${TAG} API returned duplicate URLs — likely produced ${uniqueUrls.length} unique image(s) for n=${urls.length}. Falling back to ${uniqueUrls.length} download(s).`)
  }

  console.log(`${TAG} downloading ${uniqueUrls.length} image(s)...`)

  // Download UNIQUE images in parallel — there's no point downloading the
  // same OSS URL N times when the API duplicated entries.
  const downloads = await Promise.all(uniqueUrls.map(async (u) => {
    const imgRes = await fetch(u)
    if (!imgRes.ok) {
      throw new Error(`Failed to download DashScope image: ${imgRes.status}`)
    }
    const ab = await imgRes.arrayBuffer()
    return {
      buffer:    Buffer.from(ab),
      mediaType: imgRes.headers.get('content-type') ?? 'image/png',
    }
  }))

  // Total cost: per-image rate × image_count.
  const cost = calcImageCost(model) * downloads.length

  console.log(`${TAG} image ok count=${downloads.length} bytes=[${downloads.map(d => d.buffer.length).join(',')}] cost=$${cost.toFixed(6)}`)
  return {
    buffer:    downloads[0].buffer,
    mediaType: downloads[0].mediaType,
    cost,
    extras:    downloads.slice(1),
  }
}

// ── video generation ────────────────────────────────────────────────────────

export async function generateVideo(
  model: ModelInfo,
  prompt: string,
  size: string = '1280x720',
  seconds: number = 5,
  attachments: Attachment[] = [],
  onProgress?: (pct: number) => void,
  options?: { watermark?: boolean | null; aspect_ratio?: string | null },
): Promise<VideoResult> {
  const TAG = `[alibaba/${model.model_name}]`

  // Parse size to resolution string: "1280x720" → "720P", "1920x1080" → "1080P"
  const height = parseInt(size.split('x')[1] || '720', 10)
  const resolution = height >= 1080 ? '1080P' : '720P'

  console.log(`${TAG} generateVideo resolution=${resolution} duration=${seconds}s aspect=${options?.aspect_ratio ?? 'default'} attachments=${attachments.length} watermark=${options?.watermark ?? 'default'}`)

  // Build request body — differs for T2V vs I2V vs kf2v (start+end).
  // I2V detection: any image-typed attachment, OR model name ending in '-i2v'.
  const imageAtts = attachments.filter(a => a.mediaType.startsWith('image/'))
  const imageAtt  = imageAtts[0] // kept for the existing first-frame path
  const isI2V     = !!imageAtt || /-i2v$/i.test(model.model_name)
  const isKf2v    = imageAtts.length >= 2 || /-kf2v/i.test(model.model_name)

  const input: any = { prompt }
  if (imageAtt) {
    // HappyHorse / Wan kf2v expects input.media as an array of frame objects.
    // Single image → just first_frame. Two images → first_frame + last_frame
    // (start+end interpolation). The URL must be HTTP/HTTPS — prefer a
    // signed Supabase Storage URL populated by the route handler. Fall back
    // to a base64 data URL for local/dev paths where signing wasn't
    // possible (the API may reject base64 in production; a warning is
    // logged in that case).
    const firstUrl = imageAtt.url ?? `data:${imageAtt.mediaType};base64,${imageAtt.buffer.toString('base64')}`
    const media: any[] = [{ type: 'first_frame', url: firstUrl }]
    if (isKf2v && imageAtts.length >= 2) {
      const second = imageAtts[1]
      const lastUrl = second.url ?? `data:${second.mediaType};base64,${second.buffer.toString('base64')}`
      media.push({ type: 'last_frame', url: lastUrl })
      console.log(`${TAG} kf2v: using image[1] as last_frame (signed=${!!second.url})`)
    }
    input.media = media
    if (!imageAtt.url) {
      console.warn(`${TAG} I2V: no signed URL — falling back to base64 (${imageAtt.mediaType}, ${imageAtt.buffer.length}b). API may reject.`)
    } else {
      console.log(`${TAG} I2V: using signed URL for first frame`)
    }
  }

  // parameters object — only set optional fields when explicitly provided
  // by the caller. null = use provider default (don't send).
  const parameters: Record<string, unknown> = {
    resolution,
    duration: seconds,
    prompt_extend: true,
  }
  if (options?.watermark === true)  parameters.watermark = true
  if (options?.watermark === false) parameters.watermark = false
  // ratio is T2V-only on HappyHorse. The I2V variant doesn't accept it —
  // output aspect always matches the first frame. Skip the param for I2V.
  if (!isI2V && options?.aspect_ratio) parameters.ratio = options.aspect_ratio

  const body = {
    model: model.model_name,
    input,
    parameters,
  }

  const url = `${BASE_URL}${VIDEO_ENDPOINT}`
  // Full body dump so we can confirm what reaches the wire. Image bytes
  // (input.media[].url) are too long to print verbatim, so swap them out
  // with a marker before JSON.stringify.
  const dumpBody = (() => {
    const clone: any = { ...body, input: { ...body.input } }
    if (Array.isArray(clone.input?.media)) {
      clone.input.media = clone.input.media.map((m: any) => ({
        ...m,
        url: typeof m?.url === 'string' && m.url.startsWith('data:')
          ? `<base64 ${m.url.length}b>`
          : m?.url,
      }))
    }
    return clone
  })()
  console.log(`${TAG} POST ${url}`)
  console.log(`${TAG} request body=${JSON.stringify(dumpBody).slice(0, 1200)}`)
  console.log(`${TAG} parameters resolved: ${JSON.stringify(parameters)}`)
  console.log(`${TAG} options received: watermark=${JSON.stringify(options?.watermark)} aspect_ratio=${JSON.stringify(options?.aspect_ratio)}`)

  const createRes = await fetch(url, {
    method: 'POST',
    headers: {
      ...defaultHeaders(),
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify(body),
  })

  if (!createRes.ok) {
    const errText = await createRes.text().catch(() => '')
    throw new Error(`DashScope video submit ${createRes.status}: ${errText.slice(0, 500)}`)
  }

  const createData = await createRes.json()
  console.log(`${TAG} create response: ${JSON.stringify(createData).slice(0, 400)}`)
  const taskId = createData.output?.task_id
  if (!taskId) {
    throw new Error(`DashScope returned no task_id: ${JSON.stringify(createData).slice(0, 500)}`)
  }

  console.log(`${TAG} task created: ${taskId}`)
  if (onProgress) onProgress(5)

  // Poll until completion
  const result = await pollTask(taskId, TAG, onProgress)

  // Strip the long video_url from the dump so the log stays readable.
  console.log(`${TAG} final task result: ${JSON.stringify({
    ...result,
    output: result.output ? { ...result.output, video_url: '<...>' } : result.output,
  }).slice(0, 1500)}`)

  // Extract video URL from result
  const videoUrl = result.output?.video_url
  if (!videoUrl) {
    throw new Error(`DashScope task completed but no video_url: ${JSON.stringify(result).slice(0, 500)}`)
  }

  console.log(`${TAG} downloading video from ${videoUrl.slice(0, 80)}...`)
  if (onProgress) onProgress(95)

  const vidRes = await fetch(videoUrl)
  if (!vidRes.ok) {
    throw new Error(`Failed to download DashScope video: ${vidRes.status}`)
  }

  const arrayBuffer = await vidRes.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  const contentType = vidRes.headers.get('content-type') ?? 'video/mp4'

  // Real billed duration from the API's `usage` block. Per the HappyHorse
  // / Wan video docs, `usage.duration` is the total billed seconds. Fall
  // back to the user-requested seconds if the field is missing (defensive).
  const usage = result.usage ?? null
  const billedSeconds: number = (typeof usage?.duration === 'number' && usage.duration > 0)
    ? usage.duration
    : seconds
  // Resolution for cost lookup: prefer `usage.SR` (e.g. 720, 1080) when the
  // API returns it, otherwise the requested resolution string.
  const billedResolution = usage?.SR
    ? (usage.SR >= 2160 ? '4k' : usage.SR >= 1080 ? '1080p' : '720p')
    : resolution.toLowerCase()

  const cost = calcVideoCost(model, billedResolution, billedSeconds)

  console.log(`${TAG} video ok bytes=${buffer.length} billed_duration=${billedSeconds}s billed_res=${billedResolution} cost=$${cost.toFixed(4)}`)
  if (onProgress) onProgress(100)

  return {
    buffer,
    mediaType:       contentType,
    durationSeconds: billedSeconds,
    cost,
    usageMetadata:   usage,
  }
}
