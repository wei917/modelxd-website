// lib/providers/google.ts

import { GoogleGenAI } from '@google/genai'
import type { ModelInfo, TextStreamCallbacks, ImageResult, VideoResult, Attachment } from './types'
import { logResponse } from './log'

function client() {
  return new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY! })
}

function calcTextCost(model: ModelInfo, inputTokens: number, outputTokens: number, cachedTokens: number): number {
  const inputCost  = ((inputTokens - cachedTokens) / 1_000_000) * (model.input_price ?? 0)
  const cachedCost = (cachedTokens / 1_000_000) * (model.cached_input_price ?? model.input_price ?? 0)
  const outputCost = (outputTokens / 1_000_000) * (model.output_price ?? 0)
  return inputCost + cachedCost + outputCost
}

function calcImageCost(model: ModelInfo, outputTokens: number): number {
  return (outputTokens / 1_000_000) * (model.output_image_price ?? 0)
}

function calcVideoCost(model: ModelInfo, seconds: number): number {
  const rate = model.video_pricing ? Object.values(model.video_pricing)[0] : 0
  return (rate ?? 0) * seconds
}

function buildContents(
  messages:   { role: 'user' | 'assistant'; content: any }[],
  attachment: Attachment | null
): any[] {
  return messages.map((msg, i) => {
    const isLast = i === messages.length - 1
    const parts: any[] = []
    if (isLast && msg.role === 'user' && attachment) {
      parts.push({ inlineData: { mimeType: attachment.mediaType, data: attachment.buffer.toString('base64') } })
    }
    if (typeof msg.content === 'string') {
      parts.push({ text: msg.content })
    } else if (Array.isArray(msg.content)) {
      for (const p of msg.content) {
        if (p.type === 'text') parts.push({ text: p.text })
      }
    }
    return { role: msg.role === 'assistant' ? 'model' : 'user', parts }
  })
}

// ── Text (streaming) ─────────────────────────────────────────────────────────
export async function streamText(
  model:      ModelInfo,
  messages:   { role: 'user' | 'assistant'; content: any }[],
  callbacks:  TextStreamCallbacks,
  attachment: Attachment | null = null
): Promise<void> {
  const ai = client()
  const TAG = `[google/${model.model_name}]`
  console.log(`${TAG} streamText start messages=${messages.length} hasAttachment=${!!attachment}`)
  try {
    const contents = buildContents(messages, attachment)
    console.log(`${TAG} calling generateContentStream...`)
    const result   = await ai.models.generateContentStream({ model: model.model_name, contents })
    console.log(`${TAG} stream created, reading chunks...`)

    let inputTokens = 0, outputTokens = 0, cachedTokens = 0
    let lastChunk: any = null
    let chunkCount = 0

    for await (const chunk of result) {
      chunkCount++
      const text = chunk.text as string | undefined
      if (chunkCount === 1) console.log(`${TAG} first chunk received, text=${!!text}`)
      if (text) callbacks.onDelta(text)
      if (chunk.usageMetadata) {
        inputTokens  = chunk.usageMetadata.promptTokenCount       ?? inputTokens
        outputTokens = chunk.usageMetadata.candidatesTokenCount   ?? outputTokens
        cachedTokens = chunk.usageMetadata.cachedContentTokenCount ?? cachedTokens
        lastChunk = chunk
      }
      // Log finish reason if present
      const finishReason = chunk.candidates?.[0]?.finishReason
      if (finishReason) console.log(`${TAG} chunk finishReason=${finishReason}`)
    }

    console.log(`${TAG} stream ended, totalChunks=${chunkCount}`)
    if (lastChunk) logResponse(TAG, 'final stream chunk', lastChunk)

    const cost = calcTextCost(model, inputTokens, outputTokens, cachedTokens)
    console.log(`${TAG} streamText cost=$${cost.toFixed(6)} input=${inputTokens} output=${outputTokens} cached=${cachedTokens}`)
    callbacks.onDone({ inputTokens, outputTokens, cachedTokens, cost })
  } catch (err) {
    console.error(`${TAG} streamText error:`, err)
    callbacks.onError(err instanceof Error ? err.message : String(err))
  }
}

// ── Image ─────────────────────────────────────────────────────────────────────
export async function generateImage(
  model:      ModelInfo,
  prompt:     string,
  size:       string = '1024x1024',
  attachment: Attachment | null = null
): Promise<ImageResult> {
  const ai = client()
  const TAG = `[google/${model.model_name}]`
  console.log(`${TAG} generateImage size=${size} i2i=${!!attachment}`)

  const parts: any[] = []
  if (attachment?.mediaType.startsWith('image/')) {
    parts.push({ inlineData: { mimeType: attachment.mediaType, data: attachment.buffer.toString('base64') } })
  }
  parts.push({ text: prompt })

  const result = await ai.models.generateContent({
    model:    model.model_name,
    contents: [{ role: 'user', parts }],
    config:   { responseModalities: ['IMAGE', 'TEXT'] },
  })

  logResponse(TAG, 'generateContent response', result)

  const outputTokens = result.usageMetadata?.candidatesTokenCount ?? 0
  const cost = calcImageCost(model, outputTokens)
  console.log(`${TAG} generateImage cost=$${cost.toFixed(6)} outputTokens=${outputTokens}`)

  const candidate = result.candidates?.[0]
  const imagePart = candidate?.content?.parts?.find((p: any) => p.inlineData?.mimeType?.startsWith('image/'))
  if (!imagePart?.inlineData?.data) throw new Error('No image returned from Gemini')

  return {
    buffer:    Buffer.from(imagePart.inlineData.data as string, 'base64'),
    mediaType: (imagePart.inlineData.mimeType as string) ?? 'image/png',
    cost,
  }
}

// ── Video ─────────────────────────────────────────────────────────────────────
export async function generateVideo(
  model:           ModelInfo,
  prompt:          string,
  aspectRatio:     string = '16:9',
  durationSeconds: number = 8,
  attachment:      Attachment | null = null,
  onProgress?:     (pct: number) => void
): Promise<VideoResult> {
  const ai = client()
  const TAG = `[google/${model.model_name}]`
  console.log(`${TAG} generateVideo aspectRatio=${aspectRatio} duration=${durationSeconds}s i2v=${!!attachment}`)

  const config: any = { aspectRatio, durationSeconds }
  let imageObj: any = null
  if (attachment?.mediaType.startsWith('image/')) {
    imageObj = { imageBytes: attachment.buffer.toString('base64'), mimeType: attachment.mediaType }
  }

  let operation: any = await ai.models.generateVideos({ model: model.model_name, prompt, image: imageObj, config })
  logResponse(TAG, 'generateVideos initial response', operation)

  const POLL_INTERVAL = 15_000
  const MAX_WAIT      = 20 * 60 * 1000
  const start         = Date.now()
  let   progress      = 0

  while (!operation.done) {
    if (Date.now() - start > MAX_WAIT) throw new Error('Video generation timed out')
    await new Promise(r => setTimeout(r, POLL_INTERVAL))
    operation = await (ai.operations as any).get({ operation: operation.name ?? operation })
    logResponse(TAG, 'operations.get poll', operation)
    progress = Math.min(progress + 10, 90)
    onProgress?.(progress)
  }

  const cost = calcVideoCost(model, durationSeconds)
  console.log(`${TAG} generateVideo done cost=$${cost.toFixed(4)}`)

  const videos = operation.response?.generatedVideos
  if (!videos?.length) throw new Error('No video returned from Veo')

  const videoUri = videos[0].video?.uri as string | undefined
  if (!videoUri) throw new Error('No video URI in response')

  const response = await fetch(`${videoUri}&key=${process.env.GOOGLE_AI_API_KEY}`)
  if (!response.ok) throw new Error(`Failed to fetch video: ${response.status}`)

  return { buffer: Buffer.from(await response.arrayBuffer()), mediaType: 'video/mp4', durationSeconds, cost }
}
