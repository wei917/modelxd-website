// lib/providers/google.ts
// Google provider: text (streaming), image (Gemini native), video (Veo async poll)

import { GoogleGenAI } from '@google/genai'
import type { ModelInfo, TextStreamCallbacks, ImageResult, VideoResult, Attachment } from './types'

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
  // Google charges per output image token
  return (outputTokens / 1_000_000) * (model.output_image_price ?? 0)
}

function calcVideoCost(model: ModelInfo, seconds: number): number {
  // Use first available rate (Google Veo is flat per second regardless of resolution)
  const rate = model.video_pricing ? Object.values(model.video_pricing)[0] : 0
  return (rate ?? 0) * seconds
}

function buildContents(
  messages: { role: 'user' | 'assistant'; content: any }[],
  attachment: Attachment | null
): any[] {
  return messages.map((msg, i) => {
    const isLast = i === messages.length - 1
    const parts: any[] = []

    // Add attachment to last user message
    if (isLast && msg.role === 'user' && attachment) {
      if (attachment.mediaType.startsWith('image/')) {
        parts.push({ inlineData: { mimeType: attachment.mediaType, data: attachment.buffer.toString('base64') } })
      } else if (attachment.mediaType === 'application/pdf' || attachment.mediaType === 'text/plain') {
        parts.push({ inlineData: { mimeType: attachment.mediaType, data: attachment.buffer.toString('base64') } })
      } else if (attachment.mediaType.startsWith('video/')) {
        parts.push({ inlineData: { mimeType: attachment.mediaType, data: attachment.buffer.toString('base64') } })
      }
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
  try {
    const contents = buildContents(messages, attachment)
    const result   = await ai.models.generateContentStream({
      model:    model.model_name,
      contents,
    })

    let inputTokens = 0, outputTokens = 0, cachedTokens = 0

    for await (const chunk of result) {
      const text = chunk.text()
      if (text) callbacks.onDelta(text)

      if (chunk.usageMetadata) {
        inputTokens  = chunk.usageMetadata.promptTokenCount      ?? inputTokens
        outputTokens = chunk.usageMetadata.candidatesTokenCount   ?? outputTokens
        cachedTokens = chunk.usageMetadata.cachedContentTokenCount ?? cachedTokens
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

// ── Image (Gemini native image generation) ───────────────────────────────────
export async function generateImage(
  model:      ModelInfo,
  prompt:     string,
  size:       string = '1024x1024',
  attachment: Attachment | null = null
): Promise<ImageResult> {
  const ai = client()

  const parts: any[] = []

  // i2i — include reference image
  if (attachment?.mediaType.startsWith('image/')) {
    parts.push({ inlineData: { mimeType: attachment.mediaType, data: attachment.buffer.toString('base64') } })
  }
  parts.push({ text: prompt })

  const result = await ai.models.generateContent({
    model:    model.model_name,
    contents: [{ role: 'user', parts }],
    config:   { responseModalities: ['IMAGE', 'TEXT'] },
  })

  // Find image part in response
  const candidate = result.candidates?.[0]
  const imagePart = candidate?.content?.parts?.find((p: any) => p.inlineData?.mimeType?.startsWith('image/'))

  if (!imagePart?.inlineData) throw new Error('No image returned from Gemini')

  const outputTokens = result.usageMetadata?.candidatesTokenCount ?? 0
  const cost = calcImageCost(model, outputTokens)

  return {
    buffer:    Buffer.from(imagePart.inlineData.data, 'base64'),
    mediaType: imagePart.inlineData.mimeType,
    cost,
  }
}

// ── Video (Veo async poll) ────────────────────────────────────────────────────
export async function generateVideo(
  model:      ModelInfo,
  prompt:     string,
  aspectRatio: string = '16:9',
  durationSeconds: number = 8,
  attachment: Attachment | null = null,
  onProgress?: (pct: number) => void
): Promise<VideoResult> {
  const ai = client()

  const config: any = { aspectRatio, durationSeconds }

  // i2v — pass image as reference
  let imageObj: any = null
  if (attachment?.mediaType.startsWith('image/')) {
    imageObj = {
      imageBytes:    attachment.buffer.toString('base64'),
      mimeType:      attachment.mediaType,
    }
  }

  // Start generation
  let operation = await ai.models.generateVideos({
    model: model.model_name,
    prompt,
    image: imageObj,
    config,
  })

  // Poll until done
  const POLL_INTERVAL = 15_000
  const MAX_WAIT      = 20 * 60 * 1000
  const start         = Date.now()
  let   progress      = 0

  while (!operation.done) {
    if (Date.now() - start > MAX_WAIT) throw new Error('Video generation timed out')
    await new Promise(r => setTimeout(r, POLL_INTERVAL))
    operation = await ai.operations.get(operation)
    progress  = Math.min(progress + 10, 90) // approximate
    onProgress?.(progress)
  }

  const videos = operation.response?.generatedVideos
  if (!videos?.length) throw new Error('No video returned from Veo')

  // Fetch video bytes
  const videoUri = videos[0].video?.uri
  if (!videoUri) throw new Error('No video URI in response')

  const response = await fetch(`${videoUri}&key=${process.env.GOOGLE_AI_API_KEY}`)
  if (!response.ok) throw new Error(`Failed to fetch video: ${response.status}`)

  const buffer = Buffer.from(await response.arrayBuffer())

  return {
    buffer,
    mediaType: 'video/mp4',
    durationSeconds,
    cost: calcVideoCost(model, durationSeconds),
  }
}
