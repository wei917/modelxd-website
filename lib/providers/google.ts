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
  try {
    const contents = buildContents(messages, attachment)
    const result   = await ai.models.generateContentStream({
      model:    model.model_name,
      contents,
    })

    let inputTokens = 0, outputTokens = 0, cachedTokens = 0

    for await (const chunk of result) {
      // chunk.text is a getter that returns string in @google/genai
      const text = chunk.text as string | undefined
      if (text) callbacks.onDelta(text)

      if (chunk.usageMetadata) {
        inputTokens  = chunk.usageMetadata.promptTokenCount       ?? inputTokens
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

// ── Image ─────────────────────────────────────────────────────────────────────
export async function generateImage(
  model:      ModelInfo,
  prompt:     string,
  size:       string = '1024x1024',
  attachment: Attachment | null = null
): Promise<ImageResult> {
  const ai = client()

  const parts: any[] = []
  if (attachment?.mediaType.startsWith('image/')) {
    parts.push({ inlineData: { mimeType: attachment.mediaType, data: attachment.buffer.toString('base64') } })
  }
  parts.push({ text: prompt })

  const result = await ai.models.generateContent({
    model:    model.model_name,
    contents: [{ role: 'user', parts }],
    config:   { responseModalities: ['IMAGE', 'TEXT'] } as any,
  })

  const candidate = result.candidates?.[0]
  const imagePart = candidate?.content?.parts?.find((p: any) => p.inlineData?.mimeType?.startsWith('image/'))
  if (!imagePart?.inlineData?.data) throw new Error('No image returned from Gemini')

  const outputTokens = result.usageMetadata?.candidatesTokenCount ?? 0

  return {
    buffer:    Buffer.from(imagePart.inlineData.data as string, 'base64'),
    mediaType: (imagePart.inlineData.mimeType as string) ?? 'image/png',
    cost:      calcImageCost(model, outputTokens),
  }
}

// ── Video (Veo async poll) ────────────────────────────────────────────────────
export async function generateVideo(
  model:           ModelInfo,
  prompt:          string,
  aspectRatio:     string = '16:9',
  durationSeconds: number = 8,
  attachment:      Attachment | null = null,
  onProgress?:     (pct: number) => void
): Promise<VideoResult> {
  const ai = client()

  const config: any = { aspectRatio, durationSeconds }

  let imageObj: any = null
  if (attachment?.mediaType.startsWith('image/')) {
    imageObj = {
      imageBytes: attachment.buffer.toString('base64'),
      mimeType:   attachment.mediaType,
    }
  }

  let operation: any = await ai.models.generateVideos({
    model:  model.model_name,
    prompt,
    image:  imageObj,
    config,
  })

  const POLL_INTERVAL = 15_000
  const MAX_WAIT      = 20 * 60 * 1000
  const start         = Date.now()
  let   progress      = 0

  while (!operation.done) {
    if (Date.now() - start > MAX_WAIT) throw new Error('Video generation timed out')
    await new Promise(r => setTimeout(r, POLL_INTERVAL))
    // Pass operation name string for polling
    operation = await (ai.operations as any).get({ operation: operation.name ?? operation })
    progress  = Math.min(progress + 10, 90)
    onProgress?.(progress)
  }

  const videos = operation.response?.generatedVideos
  if (!videos?.length) throw new Error('No video returned from Veo')

  const videoUri = videos[0].video?.uri as string | undefined
  if (!videoUri) throw new Error('No video URI in response')

  const response = await fetch(`${videoUri}&key=${process.env.GOOGLE_AI_API_KEY}`)
  if (!response.ok) throw new Error(`Failed to fetch video: ${response.status}`)

  const buffer = Buffer.from(await response.arrayBuffer())

  return {
    buffer,
    mediaType:       'video/mp4',
    durationSeconds,
    cost:            calcVideoCost(model, durationSeconds),
  }
}
