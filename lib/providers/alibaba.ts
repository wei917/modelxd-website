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

// ── text (streaming, native DashScope protocol) ────────────────────────────
//
// This used to go through /compatible-mode/v1/chat/completions, which
// impersonates OpenAI's API so an OpenAI SDK works unchanged. That saves
// human labour and costs fidelity: the shim can only carry fields OpenAI's
// schema has a slot for, so DashScope-specific things fall out silently in
// translation. `usage.plugins.search.count` — how many searches we owe money
// for — has no OpenAI equivalent and simply never arrived. Same for
// search_info. So: native everywhere, one path. (CC, Aug 2)
//
// Envelope differences from the shim, all of them load-bearing here:
//   request   input.messages + parameters{}   (not top-level messages)
//   deltas    output.choices[0].message.content with incremental_output
//   usage     input_tokens / output_tokens    (not prompt_ / completion_)
//   streaming X-DashScope-SSE: enable header  (not "stream": true)
const NATIVE_TEXT_ENDPOINT = '/api/v1/services/aigc/text-generation/generation'
// Qwen's VL path. Same endpoint the image models use, different direction:
// here media goes IN and text comes out.
const MULTIMODAL_ENDPOINT = IMAGE_ENDPOINT

export async function streamText(
  model: ModelInfo,
  messages: { role: 'user' | 'assistant'; content: any }[],
  callbacks: TextStreamCallbacks,
  attachments: Attachment[] = [],
  search: boolean = false,
  thinking: string | null = null,
): Promise<void> {
  const TAG = `[alibaba/${model.model_name}]`

  // Which endpoint is a property of the MODEL, not of this request. A
  // VL/omni model lives on multimodal-generation and is rejected outright by
  // text-generation ("url error, please check url") even for a plain text
  // prompt — verified live against qwen3.6-plus, Aug 2. A text-only Qwen is
  // the other way round. So route on declared capability, not on whether
  // this particular call happens to carry a file.
  const media = attachments.filter(
    a => a.mediaType.startsWith('image/') || a.mediaType.startsWith('video/'),
  )
  const multimodal = (model.modes ?? []).some(m => m === 'image_to_text' || m === 'video_to_text')
                     || media.length > 0
  const endpoint = multimodal ? MULTIMODAL_ENDPOINT : NATIVE_TEXT_ENDPOINT

  // Search works on BOTH native endpoints, multimodal included — verified
  // live Aug 2: qwen3.6-plus returned same-day headlines with
  // search_info.search_results populated and usage.plugins.search.count = 1.
  //
  // It does NOT work in non-streaming mode ("Non-streaming mode does not
  // support Web Search in thinking mode"), which is fine because this path
  // always streams. That error is the tell if search ever silently stops.
  const searchOn = search

  console.log(`${TAG} streamText start messages=${messages.length} attachments=${attachments.length} multimodal=${multimodal} search=${searchOn} thinking=${thinking ?? 'default'}`)

  const nativeMessages = messages.map((m, i) => ({
    role: m.role,
    content: i === messages.length - 1 && m.role === 'user' && multimodal
      ? mediaParts(String(m.content), media)
      : multimodal
      ? [{ text: String(m.content) }]
      : String(m.content),
  }))

  const parameters: any = {
    result_format:      'message',
    incremental_output: true,
    max_tokens:         4096,
  }
  if (searchOn) {
    parameters.enable_search = true
    // 'agent' is the strategy that lets the model decide when to search.
    // enable_source is what makes search_info come back at all.
    parameters.search_options = { search_strategy: 'agent', enable_source: true }
  }
  // The catalog declares Qwen's levels as thinking_true / thinking_false;
  // DashScope takes a boolean. Anything unrecognised leaves the model on its
  // own default rather than guessing.
  if (thinking === 'thinking_true')  parameters.enable_thinking = true
  if (thinking === 'thinking_false') parameters.enable_thinking = false

  let res: Response
  try {
    res = await fetch(`${BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: { ...defaultHeaders(), 'X-DashScope-SSE': 'enable' },
      body: JSON.stringify({ model: model.model_name, input: { messages: nativeMessages }, parameters }),
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

  const reader  = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let inputTokens = 0
  let outputTokens = 0
  let cachedTokens = 0
  let searchCount = 0

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

          // Native errors arrive as a payload with a code and no output,
          // not as an HTTP status — the stream has already started 200.
          if (json?.code && !json?.output) {
            callbacks.onError(`DashScope: ${json.message ?? json.code}`)
            return
          }

          const delta = textOf(json?.output?.choices?.[0]?.message?.content)
          if (delta) callbacks.onDelta(delta)

          const u = json?.usage
          if (u) {
            inputTokens  = u.input_tokens  ?? inputTokens
            outputTokens = u.output_tokens ?? outputTokens
            cachedTokens = u.input_tokens_details?.cached_tokens
                        ?? u.prompt_tokens_details?.cached_tokens
                        ?? cachedTokens
            const c = u.plugins?.search?.count
            if (typeof c === 'number') searchCount = Math.max(searchCount, c)
          }
        }
      }
    }
  } catch (err: any) {
    callbacks.onError(`Stream read failed: ${err?.message ?? err}`)
    return
  }

  const cost = calcTextCost(model, inputTokens, outputTokens, cachedTokens, { searchCount })
  console.log(`${TAG} done in=${inputTokens} out=${outputTokens} cached=${cachedTokens} searches=${searchCount} cost=$${cost.toFixed(6)}`)
  callbacks.onDone({ inputTokens, outputTokens, cachedTokens, cost, searchCount })
}

/**
 * Message content for the multimodal endpoint: typed parts, media first.
 *
 * `url` is preferred over inline base64 — the router fills it with a signed
 * URL of the RESIZED copy, so an oversized upload never goes up raw. Video
 * has no base64 fallback worth using; a clip inlined as a data URL blows
 * past the request limit long before it reaches the model.
 */
function mediaParts(text: string, media: Attachment[]): any[] {
  const parts: any[] = []
  for (const a of media) {
    const src = a.url ?? `data:${a.mediaType};base64,${a.buffer.toString('base64')}`
    parts.push(a.mediaType.startsWith('video/') ? { video: src } : { image: src })
  }
  parts.push({ text })
  return parts
}

/**
 * Pull the assistant's words out of a native content field.
 *
 * The text endpoint answers with a string; the multimodal endpoint answers
 * with an array of parts. `reasoning_content` is deliberately NOT read here:
 * with enable_thinking on, the chain of thought streams alongside the answer
 * and must not end up in the duel transcript.
 */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map(p => (p && typeof p === 'object' && typeof (p as any).text === 'string' ? (p as any).text : '')).join('')
  }
  return ''
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
  options?: { watermark?: boolean | null; aspect_ratio?: string | null; mode?: string | null },
): Promise<VideoResult> {
  const TAG = `[alibaba/${model.model_name}]`

  // Parse size to resolution string: "1280x720" → "720P", "1920x1080" → "1080P"
  const height = parseInt(size.split('x')[1] || '720', 10)
  const resolution = height >= 1080 ? '1080P' : '720P'

  console.log(`${TAG} generateVideo resolution=${resolution} duration=${seconds}s aspect=${options?.aspect_ratio ?? 'default'} attachments=${attachments.length} watermark=${options?.watermark ?? 'default'}`)

  // Build request body — differs by model family:
  //   • R2V  (HappyHorse 1.0 R2V, reference_frames mode) → input.media
  //     entries are typed as 'reference_image'. 1-N images supported,
  //     each acts as a character/scene reference. Used by our Titanic /
  //     Diner Dance / Royal Throne / Astronaut / Concert templates.
  //   • kf2v (start_end_frames) → input.media is [first_frame, last_frame]
  //     for two-image temporal interpolation. Wan 2.7 / cinematic-transition.
  //   • I2V  (image_to_video) → input.media is [first_frame] with the
  //     single uploaded image as the start frame.
  //   • T2V  → no media, prompt-only.
  const imageAtts = attachments.filter(a => a.mediaType.startsWith('image/'))
  const videoAtts = attachments.filter(a => a.mediaType.startsWith('video/'))
  const imageAtt  = imageAtts[0]
  // Extend (wan2.7 `first_clip` continuation) is keyed off the RECIPE, not
  // the model name — it rides the same wan2.7-i2v model as image_to_video.
  const isExtend  = options?.mode === 'extend_video'
  const isVideoEdit = !isExtend && /-video-edit$/i.test(model.model_name)
  const isR2V     = !isExtend && !isVideoEdit && /-r2v$/i.test(model.model_name)
  const isKf2v    = !isExtend && !isVideoEdit && !isR2V && (imageAtts.length >= 2 || /-kf2v/i.test(model.model_name))
  const isI2V     = !isExtend && !isVideoEdit && !isR2V && !isKf2v && (!!imageAtt || /-i2v$/i.test(model.model_name))

  const input: any = { prompt }
  if (isExtend) {
    // Video continuation: the source clip goes in as `first_clip` (input
    // 2-10s per the DashScope i2v reference); `duration` below is the
    // TOTAL output including the input portion, capped at 15s.
    const videoAtt = videoAtts[0]
    if (!videoAtt) throw new Error('Extend a Video needs a video attachment (MP4, 2–10s).')
    if (!videoAtt.url) throw new Error('Video attachment has no signed URL — cannot send to DashScope.')
    input.media = [{ type: 'first_clip', url: videoAtt.url }]
    console.log(`${TAG} extend: first_clip continuation`)
  } else if (isVideoEdit) {
    // Video editing (happyhorse-1.0-video-edit): exactly 1 video +
    // 0–5 reference_image elements. "Change the sofa to the one in the
    // image" / clothes-swap style edits (CC, July 19). The video MUST be
    // an HTTP(S) URL — the route signs video attachments for this.
    const videoAtt = videoAtts[0]
    if (!videoAtt) throw new Error('This model edits an existing video — attach a video (MP4/MOV, 3–60s) plus up to 5 reference images.')
    if (!videoAtt.url) throw new Error('Video attachment has no signed URL — cannot send to DashScope video-edit.')
    input.media = [
      { type: 'video', url: videoAtt.url },
      ...imageAtts.slice(0, 5).map(a => ({
        type: 'reference_image',
        url:  a.url ?? `data:${a.mediaType};base64,${a.buffer.toString('base64')}`,
      })),
    ]
    console.log(`${TAG} video-edit: 1 video + ${Math.min(imageAtts.length, 5)} reference_image(s)`)
  } else if (isR2V && imageAtts.length > 0) {
    // Reference-to-Video: every image is a reference, all typed
    // 'reference_image'. HappyHorse R2V supports up to 14 references —
    // we just forward whatever the user uploaded, in slot order.
    input.media = imageAtts.map(a => ({
      type: 'reference_image',
      url:  a.url ?? `data:${a.mediaType};base64,${a.buffer.toString('base64')}`,
    }))
    const signedCount = imageAtts.filter(a => !!a.url).length
    console.log(`${TAG} R2V: ${imageAtts.length} reference_image(s) (${signedCount} signed)`)
  } else if (imageAtt) {
    // I2V / kf2v path: first image = start frame, optional second = end frame.
    // URL must be HTTP/HTTPS — prefer a signed Supabase Storage URL populated
    // by the route handler. Fall back to base64 for local/dev paths where
    // signing wasn't possible (the API may reject base64 in production).
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
  // Video-edit accepts only resolution/watermark/seed — duration and
  // ratio come from the input video (output capped at 15s by the API).
  const parameters: Record<string, unknown> = isVideoEdit
    ? { resolution }
    : isExtend
    ? {
        resolution,
        // TOTAL output length (input + continuation). We can't measure the
        // input clip server-side, so always ask for the 15s maximum — a 5s
        // clip gets a 10s continuation, an 8s clip gets 7s. Billing is by
        // output seconds, so the cost is honest either way.
        duration: 15,
        prompt_extend: true,
      }
    : {
        resolution,
        duration: seconds,
        prompt_extend: true,
      }
  if (options?.watermark === true)  parameters.watermark = true
  if (options?.watermark === false) parameters.watermark = false
  // ratio is T2V-only on HappyHorse. The I2V variant doesn't accept it —
  // output aspect always matches the first frame. Skip the param for I2V
  // and video-edit.
  if (!isI2V && !isVideoEdit && !isExtend && options?.aspect_ratio) parameters.ratio = options.aspect_ratio

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

// ── speech (Qwen-TTS, sync HTTP) ───────────────────────────────────────────
//
// Stage 2 of character voice (owner, Aug 8). Two model families, one shape:
//   qwen3-tts-flash            speaks the PRESET voices (Cherry, Momo, …)
//   qwen3-tts-vd-2026-01-26    speaks voices minted by qwen-voice-design
// Same endpoint as image/VL (multimodal-generation). Response carries
// output.audio.url (WAV, 24h expiry) and usage.characters — verified against
// the live API Aug 8. The URL arrives as http:// but OSS serves the same
// signature over https, and a https page can't play mixed content, so we
// rewrite the scheme before anyone sees it.

export const QWEN_TTS_PRESET_MODEL = 'qwen3-tts-flash'
export const QWEN_TTS_DESIGN_MODEL = 'qwen3-tts-vd-2026-01-26'
const VOICE_DESIGN_ENDPOINT = '/api/v1/services/audio/tts/customization'

// ~$0.13 per 10K characters (flash synthesis, intl). Not in ai_models —
// voice isn't a competing surface, it's plumbing; one flat rate.
const TTS_USD_PER_CHAR = 0.13 / 10_000
export const VOICE_DESIGN_USD = 0.20   // per minted voice, flat (provider list price)

const httpsUrl = (u: string) => u.replace(/^http:\/\//, 'https://')

export async function synthesizeSpeech(
  text: string,
  voice: string,
  opts?: { designed?: boolean; languageType?: string | null },
): Promise<{ url: string; cost: number; characters: number }> {
  const TAG = '[alibaba/qwen-tts]'
  const body: any = {
    model: opts?.designed ? QWEN_TTS_DESIGN_MODEL : QWEN_TTS_PRESET_MODEL,
    input: { text, voice },
  }
  if (opts?.languageType) body.input.language_type = opts.languageType

  const res = await fetch(BASE_URL + IMAGE_ENDPOINT, {
    method: 'POST', headers: defaultHeaders(), body: JSON.stringify(body),
  })
  const d = await res.json().catch(() => null)
  if (!res.ok) {
    console.warn(`${TAG} tts failed: ${res.status} ${d?.message ?? ''}`)
    throw new Error(d?.message ?? `DashScope TTS HTTP ${res.status}`)
  }
  const url = d?.output?.audio?.url
  if (!url || typeof url !== 'string') throw new Error('DashScope TTS returned no audio')
  const characters = (typeof d?.usage?.characters === 'number' && d.usage.characters > 0)
    ? d.usage.characters : text.length
  const cost = characters * TTS_USD_PER_CHAR
  console.log(`${TAG} tts ok chars=${characters} cost=$${cost.toFixed(5)}`)
  return { url: httpsUrl(url), cost, characters }
}

/** Mint a novel voice from a text description (qwen-voice-design). The
 *  result is a voice id usable with QWEN_TTS_DESIGN_MODEL forever after.
 *  Deliberately NOT the cloning API: no human sample ever goes in. */
export async function designVoice(
  description: string,
  opts?: { name?: string; previewText?: string },
): Promise<{ voice: string; previewUrl: string | null }> {
  const TAG = '[alibaba/qwen-voice-design]'
  const body: any = {
    model: 'qwen-voice-design',
    input: {
      action: 'create',
      target_model: QWEN_TTS_DESIGN_MODEL,
      voice_prompt: description,
    },
  }
  if (opts?.name) body.input.preferred_name = opts.name.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 16) || undefined
  if (opts?.previewText) body.input.preview_text = opts.previewText

  const res = await fetch(BASE_URL + VOICE_DESIGN_ENDPOINT, {
    method: 'POST', headers: defaultHeaders(), body: JSON.stringify(body),
  })
  const d = await res.json().catch(() => null)
  if (!res.ok) {
    console.warn(`${TAG} voice design failed: ${res.status} ${d?.message ?? ''}`)
    throw new Error(d?.message ?? `DashScope voice design HTTP ${res.status}`)
  }
  const voice = d?.output?.voice ?? d?.output?.voice_id
  if (!voice || typeof voice !== 'string') throw new Error('Voice design returned no voice id')
  const previewUrl = d?.output?.audio?.url ?? d?.output?.preview_audio?.url ?? null
  console.log(`${TAG} voice designed id=${voice}`)
  return { voice, previewUrl: previewUrl ? httpsUrl(previewUrl) : null }
}
