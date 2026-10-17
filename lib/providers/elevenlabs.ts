// lib/providers/elevenlabs.ts
//
// ElevenLabs, music only for now. Their TTS is the other half of this API
// and is deliberately not wired: the Audio tab already has four voices, and
// nothing here would be reused by it beyond the auth header.
//
// Bought DIRECT, not through Replicate. Replicate resells the same model at
// $0.498 a minute against ElevenLabs' own $0.15 — the one family where
// Replicate marks up instead of matching (see docs/price-audit.md, Oct 17).

import type { ModelInfo, SpeechResult } from './types'
import { calcSpeechCost } from './pricing'

const BASE = 'https://api.elevenlabs.io/v1'

/** Their own bounds on music_length_ms: 3s to 10 minutes. */
const MIN_SECONDS = 3
const MAX_SECONDS = 600

function key(): string {
  const k = process.env.ELEVENLABS_API_KEY
  if (!k) throw new Error('ELEVENLABS_API_KEY is not set')
  return k
}

/**
 * Compose a song.
 *
 * The length is ALWAYS sent. `music_length_ms` is optional and the model
 * picks a length when it is omitted — but ElevenLabs bills per minute of
 * output and the response is raw bytes with no usage of any kind, so an
 * unasked length would mean billing a duration we never measured. Asking
 * for it makes the charge exact before the call.
 */
export async function generateMusic(
  model: ModelInfo,
  prompt: string,
  options?: { seconds?: number | null; instrumental?: boolean | null },
): Promise<SpeechResult> {
  const TAG = `[elevenlabs/${model.model_name}]`
  const cfg = model.output_config?.audio ?? {}
  const seconds = Math.min(MAX_SECONDS, Math.max(MIN_SECONDS,
    Math.round(options?.seconds ?? (cfg.durations ?? [])[0] ?? 60)))
  const format = (cfg.formats ?? [])[0] ?? 'mp3_44100_128'

  const body: Record<string, unknown> = {
    prompt,
    model_id: model.model_name,
    music_length_ms: seconds * 1000,
  }
  if (options?.instrumental != null) body.force_instrumental = !!options.instrumental
  console.log(`${TAG} music chars=${prompt.length} seconds=${seconds} format=${format}`)

  const res = await fetch(`${BASE}/music?output_format=${encodeURIComponent(format)}`, {
    method: 'POST',
    headers: { 'xi-api-key': key(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`ElevenLabs Music ${res.status}: ${detail.slice(0, 300)}`)
  }
  const buffer = Buffer.from(await res.arrayBuffer())
  if (buffer.length === 0) throw new Error('ElevenLabs Music returned no audio.')

  // Billed on the length we ASKED for, which is the length they charge for.
  const cost = calcSpeechCost(model, { durationSeconds: seconds })
  console.log(`${TAG} music ok bytes=${buffer.length} dur=${seconds}s cost=$${cost.toFixed(4)} song=${res.headers.get('song-id') ?? '?'}`)
  return {
    buffer,
    mediaType: format.startsWith('mp3') ? 'audio/mpeg' : format.startsWith('opus') ? 'audio/opus' : 'audio/wav',
    durationSeconds: seconds,
    cost,
    characters: null,
  }
}
