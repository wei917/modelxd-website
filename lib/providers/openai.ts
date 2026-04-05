// lib/providers/openai.ts

import OpenAI, { toFile } from 'openai'
import type { ModelInfo, TextStreamCallbacks, ImageResult, VideoResult, Attachment } from './types'
import { logResponse } from './log'

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

// ── Text (streaming via Responses API) ───────────────────────────────────────
export async function streamText(
  model:     ModelInfo,
  messages:  { role: 'user' | 'assistant'; content: any }[],
  callbacks: TextStreamCallbacks
): Promise<void> {
  const ai = client()
  const TAG = `[openai/${model.model_name}]`
  console.log(`${TAG} streamText start messages=${messages.length}`)
  try {
    const stream = await (ai as any).responses.create({
      model:  model.model_name,
      stream: true,
      input:  messages,
    })

    let inputTokens = 0, outputTokens = 0, cachedTokens = 0

    for await (const event of stream) {
      if (event.type === 'response.output_text.delta') {
        callbacks.onDelta(event.delta ?? '')
      } else if (event.type === 'response.completed') {
        const usage = event.response?.usage
        if (usage) {
          inputTokens  = usage.input_tokens ?? 0
          outputTokens = usage.output_tokens ?? 0
          cachedTokens = usage.input_tokens_details?.cached_tokens ?? 0
          logResponse(TAG, 'response.completed', event.response)
        }
      }
    }

    const cost = calcTextCost(model, inputTokens, outputTokens, cachedTokens)
    console.log(`${TAG} streamText cost=$${cost.toFixed(6)} input=${inputTokens} output=${outputTokens} cached=${cachedTokens}`)
    callbacks.onDone({ inputTokens, outputTokens, cachedTokens, cost })
  } catch (err) {
    console.error(`${TAG} streamText error:`, err)
    callbacks.onError(err instanceof Error ? err.message : String(err))
  }
}

// ── Image ────────────────────────────────────────────────────────────────────
export async function generateImage(
  model:      ModelInfo,
  prompt:     string,
  quality:    'low' | 'medium' | 'high' = 'medium',
  size:       string = '1024x1024',
  attachment: Attachment | null = null
): Promise<ImageResult> {
  const ai = client()
  const TAG = `[openai/${model.model_name}]`
  console.log(`${TAG} generateImage quality=${quality} size=${size} i2i=${!!attachment}`)

  let b64: string
  let res: any

  if (attachment?.mediaType.startsWith('image/')) {
    const file = await toFile(attachment.buffer, 'input.png', { type: attachment.mediaType })
    res = await ai.images.edit({ model: model.model_name, image: file, prompt, size: size as any, n: 1 } as any)
    logResponse(TAG, 'images.edit response', res)
    b64 = res.data?.[0]?.b64_json ?? ''
    if (!b64) throw new Error('No image returned from OpenAI edit')
  } else {
    res = await ai.images.generate({ model: model.model_name, prompt, size: size as any, quality: quality as any, n: 1 } as any)
    logResponse(TAG, 'images.generate response', res)
    b64 = res.data?.[0]?.b64_json ?? ''
    if (!b64) throw new Error('No image returned from OpenAI generate')
  }

  const cost = calcImageCost(model, quality)
  console.log(`${TAG} generateImage cost=$${cost.toFixed(6)}`)

  return { buffer: Buffer.from(b64, 'base64'), mediaType: 'image/png', cost }
}

// ── Video ────────────────────────────────────────────────────────────────────
export async function generateVideo(
  model:       ModelInfo,
  prompt:      string,
  size:        string = '1280x720',
  seconds:     number = 16,
  attachment:  Attachment | null = null,
  onProgress?: (pct: number) => void
): Promise<VideoResult> {
  const ai = client()
  const TAG = `[openai/${model.model_name}]`
  console.log(`${TAG} generateVideo size=${size} seconds=${seconds} i2v=${!!attachment}`)

  const params: any = { model: model.model_name, prompt, size, n: 1 }
  if (attachment?.mediaType.startsWith('image/')) {
    params.image = `data:${attachment.mediaType};base64,${attachment.buffer.toString('base64')}`
  }

  let job: any = await (ai as any).videos.create(params)
  logResponse(TAG, 'videos.create response', job)

  const POLL_INTERVAL = 15_000
  const MAX_WAIT      = 20 * 60 * 1000
  const start         = Date.now()

  while (job.status !== 'completed' && job.status !== 'failed') {
    if (Date.now() - start > MAX_WAIT) throw new Error('Video generation timed out')
    await new Promise(r => setTimeout(r, POLL_INTERVAL))
    job = await (ai as any).videos.retrieve(job.id)
    logResponse(TAG, 'videos.retrieve poll', job)
    if (onProgress && job.progress != null) onProgress(job.progress as number)
  }

  if (job.status === 'failed') throw new Error((job.error as any)?.message ?? 'Video generation failed')

  const parts      = size.split('x').map(Number)
  const resolution = (parts[0] ?? 0) >= 1792 || (parts[1] ?? 0) >= 1792 ? '1080p' : '720p'
  const cost       = calcVideoCost(model, resolution, seconds)
  console.log(`${TAG} generateVideo done resolution=${resolution} cost=$${cost.toFixed(4)}`)

  const response = await fetch(`https://api.openai.com/v1/videos/${job.id}/content`, {
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY!}` },
  })
  if (!response.ok) throw new Error(`Failed to fetch video: ${response.status}`)

  return { buffer: Buffer.from(await response.arrayBuffer()), mediaType: 'video/mp4', durationSeconds: seconds, cost }
}
