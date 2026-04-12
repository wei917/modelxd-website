// lib/providers/index.ts
// Routes to the OpenRouter provider. ModelXD uses OpenRouter for all
// text, image, and video generation — one API key, one wire format.

import * as openrouter from './openrouter'
import type {
  ModelInfo,
  TextStreamCallbacks,
  ImageResult,
  VideoResult,
  Attachment,
} from './types'

export type { ModelInfo, TextStreamCallbacks, ImageResult, VideoResult, Attachment }

function assertOpenRouter(model: ModelInfo): void {
  if (model.provider !== 'openrouter') {
    throw new Error(
      `Unsupported provider "${model.provider}". ModelXD now routes everything through OpenRouter — `
      + `make sure ai_models rows have provider='openrouter' (run scripts/sync-openrouter.ts).`
    )
  }
}

export async function streamText(
  model:      ModelInfo,
  messages:   { role: 'user' | 'assistant'; content: any }[],
  callbacks:  TextStreamCallbacks,
  attachment: Attachment | null = null
): Promise<void> {
  assertOpenRouter(model)
  return openrouter.streamText(model, messages, callbacks, attachment)
}

export async function generateImage(
  model:      ModelInfo,
  prompt:     string,
  quality:    'low' | 'medium' | 'high' = 'medium',
  size:       string = '1024x1024',
  attachment: Attachment | null = null
): Promise<ImageResult> {
  assertOpenRouter(model)
  return openrouter.generateImage(model, prompt, quality, size, attachment)
}

export async function generateVideo(
  model:      ModelInfo,
  prompt:     string,
  size:       string = '1280x720',
  seconds:    number = 16,
  attachment: Attachment | null = null,
  onProgress?: (pct: number) => void
): Promise<VideoResult> {
  assertOpenRouter(model)
  return openrouter.generateVideo(model, prompt, size, seconds, attachment, onProgress)
}
