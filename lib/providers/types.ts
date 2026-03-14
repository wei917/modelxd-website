// lib/providers/types.ts
// Shared types for all provider implementations

export interface ModelInfo {
  id:         string
  provider:   string
  model_name: string
  name:       string
  input_price:        number | null
  cached_input_price: number | null
  output_price:       number | null
  input_image_price:  number | null
  output_image_price: number | null
  image_pricing:      Record<string, number> | null  // { low, medium, high }
  video_pricing:      Record<string, number> | null  // { "720p", "1080p" }
  image_sizes:        string[] | null
  video_sizes:        string[] | null
  video_durations:    number[] | null
}

export interface TextResult {
  text:         string
  inputTokens:  number
  outputTokens: number
  cachedTokens: number
  cost:         number
}

export interface ImageResult {
  buffer:    Buffer
  mediaType: string
  cost:      number
}

export interface VideoResult {
  buffer:    Buffer
  mediaType: string
  durationSeconds: number
  cost:      number
}

export interface Attachment {
  buffer:    Buffer
  mediaType: string
}

export interface TextStreamCallbacks {
  onDelta: (text: string) => void
  onDone:  (result: { inputTokens: number; outputTokens: number; cachedTokens: number; cost: number }) => void
  onError: (message: string) => void
}
