// lib/providers/openai.ts
// OpenAI provider: text (streaming), image (t2i + i2i), video (sora async poll)

import OpenAI, { toFile } from 'openai'
import type { ModelInfo, TextStreamCallbacks, ImageResult, VideoResult, Attachment } from './types'

function client() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })
}

function calcTextCost(model: ModelInfo, inputTokens: number, outputTokens: number, cachedTokens: number): number {
  const inputCost  = ((inputTokens - cachedTokens) / 1_000_000) * (model.input_price ?? 0)
  const cachedCost = (cachedTokens / 1_000_000) * (model.cached_input_price ?? model.input_price ?? 0)
  const outputCost = (outputTokens / 1_000_000) * (model.output_price ?? 0)
  return inputCost + cachedCost + outputCost
}

function calcImageCost(model: ModelInfo, quality: string): number {
  return model.image_pricing?.[quality] ?? 0
}

function calcVideoCost(model: ModelInfo, resolution: string, seconds: number): number {
  return (model.video_pricing?.[resolution] ?? 0) * seconds
}

// ── Text (streaming) ─────────────────────────────────────────────────────────
export async function streamText(
  model:     ModelInfo,
  messages:  { role: 'user' | 'assistant'; content: any }[],
  callbacks: TextStreamCallbacks
): Promise<void> {
  const ai = client()
  try {
    const stream = await ai.chat.completions.create({
      model:  model.model_name,
      stream: true,
      messages,
    })

    let inputTokens = 0, outputTokens = 0, cachedTokens = 0

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content
      if (delta) callbacks.onDelta(delta)

      if (chunk.usage) {
        inputTokens  = chunk.usage.prompt_tokens ?? 0
        outputTokens = chunk.usage.completion_tokens ?? 0
        cachedTokens = (chunk.usage as any).prompt_tokens_details?.cached_tokens ?? 0
      }
    }

    callbacks.onDone({
      inputTokens, outputTokens, cachedTokens,
      cost: calcTextCost(model, inputTokens, outputTokens, cachedTokens),
    })
  } catch (err) {
    callbacks.onError(err instanceof Error ? err.message : String(err))
  }
}

// ── Image (t2i + i2i) ────────────────────────────────────────────────────────
export async function generateImage(
  model:      ModelInfo,
  prompt:     string,
  quality:    'low' | 'medium' | 'high' = 'medium',
  size:       string = '1024x1024',
  attachment: Attachment | null = null
): Promise<ImageResult> {
  const ai = client()

  let b64: string

  if (attachment?.mediaType.startsWith('image/')) {
    // i2i via images.edit
    const file = await toFile(attachment.buffer, 'input.png', { type: attachment.mediaType })
    const res  = await ai.images.edit({
      model:   model.model_name,
      image:   file,
      prompt,
      size:    size as any,
      n:       1,
    })
    b64 = res.data?.[0]?.b64_json ?? ''
    if (!b64) throw new Error('No image returned from OpenAI edit')
  } else {
    // t2i
    const res = await ai.images.generate({
      model:           model.model_name,
      prompt,
      size:            size as any,
      quality:         quality as any,
      response_format: 'b64_json',
      n:               1,
    })
    b64 = res.data?.[0]?.b64_json ?? ''
    if (!b64) throw new Error('No image returned from OpenAI generate')
  }

  return {
    buffer:    Buffer.from(b64, 'base64'),
    mediaType: 'image/png',
    cost:      calcImageCost(model, quality),
  }
}

// ── Video (sora async poll) ───────────────────────────────────────────────────
export async function generateVideo(
  model:       ModelInfo,
  prompt:      string,
  size:        string = '1280x720',
  seconds:     number = 16,
  attachment:  Attachment | null = null,
  onProgress?: (pct: number) => void
): Promise<VideoResult> {
  const ai = client()

  const params: any = { model: model.model_name, prompt, size, n: 1 }

  if (attachment?.mediaType.startsWith('image/')) {
    params.image = `data:${attachment.mediaType};base64,${attachment.buffer.toString('base64')}`
  }

  let job: any = await (ai as any).videos.create(params)
  const jobId  = job.id as string

  const POLL_INTERVAL = 15_000
  const MAX_WAIT      = 20 * 60 * 1000
  const start         = Date.now()

  while (job.status !== 'completed' && job.status !== 'failed') {
    if (Date.now() - start > MAX_WAIT) throw new Error('Video generation timed out')
    await new Promise(r => setTimeout(r, POLL_INTERVAL))
    job = await (ai as any).videos.retrieve(jobId)
    if (onProgress && job.progress != null) onProgress(job.progress as number)
  }

  if (job.status === 'failed') throw new Error((job.error as any)?.message ?? 'Video generation failed')

  const response = await fetch(`https://api.openai.com/v1/videos/${jobId}/content`, {
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY!}` },
  })
  if (!response.ok) throw new Error(`Failed to fetch video: ${response.status}`)

  const buffer     = Buffer.from(await response.arrayBuffer())
  const parts = size.split('x').map(Number)
  const resolution = (parts[0] ?? 0) >= 1792 || (parts[1] ?? 0) >= 1792 ? '1080p' : '720p'

  return {
    buffer,
    mediaType:       'video/mp4',
    durationSeconds: seconds,
    cost:            calcVideoCost(model, resolution, seconds),
  }
}
