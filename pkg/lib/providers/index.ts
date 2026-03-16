// lib/providers/index.ts
// Routes to correct provider based on model.provider field

import * as openai  from './openai'
import * as google  from './google'
import type { ModelInfo, TextStreamCallbacks, ImageResult, VideoResult, Attachment } from './types'

export type { ModelInfo, TextStreamCallbacks, ImageResult, VideoResult, Attachment }

function getProvider(model: ModelInfo) {
  switch (model.provider) {
    case 'openai': return openai
    case 'google': return google
    default: throw new Error(`Unknown provider: ${model.provider}`)
  }
}

export async function streamText(
  model:      ModelInfo,
  messages:   { role: 'user' | 'assistant'; content: any }[],
  callbacks:  TextStreamCallbacks,
  attachment: Attachment | null = null
): Promise<void> {
  const p = getProvider(model)
  // Google streamText accepts attachment, OpenAI builds it into messages
  if (model.provider === 'google') {
    return (p as typeof google).streamText(model, messages, callbacks, attachment)
  }
  // For OpenAI, inject attachment into last user message content
  if (attachment && model.provider === 'openai') {
    const msgs = [...messages]
    const last  = msgs[msgs.length - 1]
    if (last.role === 'user') {
      const parts: any[] = []
      if (attachment.mediaType.startsWith('image/')) {
        parts.push({ type: 'image_url', image_url: { url: `data:${attachment.mediaType};base64,${attachment.buffer.toString('base64')}` } })
      } else if (attachment.mediaType === 'application/pdf' || attachment.mediaType === 'text/plain') {
        const text = attachment.buffer.toString('utf-8')
        parts.push({ type: 'text', text: `File content:\n${text}\n\n${last.content}` })
        msgs[msgs.length - 1] = { ...last, content: parts[0].text }
        return p.streamText(model, msgs, callbacks)
      }
      parts.push({ type: 'text', text: last.content })
      msgs[msgs.length - 1] = { ...last, content: parts }
    }
    return p.streamText(model, msgs, callbacks)
  }
  return p.streamText(model, messages, callbacks)
}

export async function generateImage(
  model:      ModelInfo,
  prompt:     string,
  quality:    'low' | 'medium' | 'high' = 'medium',
  size:       string = '1024x1024',
  attachment: Attachment | null = null
): Promise<ImageResult> {
  if (model.provider === 'openai') {
    return openai.generateImage(model, prompt, quality, size, attachment)
  }
  if (model.provider === 'google') {
    return google.generateImage(model, prompt, size, attachment)
  }
  throw new Error(`Provider ${model.provider} does not support image generation`)
}

export async function generateVideo(
  model:      ModelInfo,
  prompt:     string,
  size:       string = '1280x720',
  seconds:    number = 16,
  attachment: Attachment | null = null,
  onProgress?: (pct: number) => void
): Promise<VideoResult> {
  if (model.provider === 'openai') {
    return openai.generateVideo(model, prompt, size, seconds, attachment, onProgress)
  }
  if (model.provider === 'google') {
    // Convert size to aspectRatio for Google
    const aspectRatio = size.includes('x') ? (
      parseInt(size.split('x')[0]) > parseInt(size.split('x')[1]) ? '16:9' : '9:16'
    ) : '16:9'
    const dur = Math.min(seconds, 8) // Veo max is 8s
    return google.generateVideo(model, prompt, aspectRatio, dur, attachment, onProgress)
  }
  throw new Error(`Provider ${model.provider} does not support video generation`)
}
