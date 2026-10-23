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
import { isMp3Format, isWavFormat, wavFits } from '@/lib/music-options'

const BASE = 'https://api.elevenlabs.io/v1'

/** Their own bounds on music_length_ms: 3s to 10 minutes. */
const MIN_SECONDS = 3
const MAX_SECONDS = 600

function key(): string {
  const k = process.env.ELEVENLABS_API_KEY
  if (!k) throw new Error('ELEVENLABS_API_KEY is not set')
  return k
}

/** `pcm_<rate>` is bare 16-bit little-endian samples with no header
 *  (probed Oct 22: 5 s at pcm_48000 = 960,000 bytes = stereo), so a WAV is
 *  the 44-byte header in front of them. The channel count comes from the
 *  length we asked for, which v2.5 always keeps. */
function wavFromPcm(pcm: Buffer, rate: number, seconds: number): Buffer {
  const channels = Math.round(pcm.length / (seconds * rate * 2)) === 1 ? 1 : 2
  const h = Buffer.alloc(44)
  h.write('RIFF', 0, 'ascii'); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8, 'ascii')
  h.write('fmt ', 12, 'ascii'); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20)
  h.writeUInt16LE(channels, 22); h.writeUInt32LE(rate, 24)
  h.writeUInt32LE(rate * channels * 2, 28); h.writeUInt16LE(channels * 2, 32); h.writeUInt16LE(16, 34)
  h.write('data', 36, 'ascii'); h.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([h, pcm])
}

/**
 * Compose a song.
 *
 * The length is ALWAYS sent. `music_length_ms` is optional and the model
 * picks a length when it is omitted — but ElevenLabs bills per minute of
 * output and the response is raw bytes with no usage of any kind, so an
 * unasked length would mean billing a duration we never measured. Asking
 * for it makes the charge exact before the call.
 *
 * The rest are the ⚙ panel's settings (lib/music-options.ts): the format
 * (one the row lists, else its first: XDuel's plain 'mp3' lands there),
 * no vocals (`force_instrumental`, which guarantees it) and Content
 * Credentials (`sign_with_c2pa`, MP3 only; the manifest names Eleven Labs
 * Inc. as the maker and the file as AI-made, nothing of ours).
 */
export async function generateMusic(
  model: ModelInfo,
  prompt: string,
  options?: { seconds?: number | null; instrumental?: boolean | null; format?: string | null; c2pa?: boolean | null },
): Promise<SpeechResult> {
  const TAG = `[elevenlabs/${model.model_name}]`
  const cfg = model.output_config?.audio ?? {}
  const seconds = Math.min(MAX_SECONDS, Math.max(MIN_SECONDS,
    Math.round(options?.seconds ?? (cfg.durations ?? [])[0] ?? 60)))
  const formats: string[] = cfg.formats ?? []
  const format = options?.format && formats.includes(options.format) ? options.format : (formats[0] ?? 'mp3_48000_192')
  const wav = isWavFormat(format)
  // Checked before the call: a song that cannot be stored would still be billed.
  if (wav && !wavFits(seconds)) throw new Error('USERMSG: A WAV song can be at most 4 minutes. Pick MP3 for a longer one.')

  const body: Record<string, unknown> = {
    prompt,
    model_id: model.model_name,
    music_length_ms: seconds * 1000,
  }
  if (options?.instrumental != null) body.force_instrumental = !!options.instrumental
  if (options?.c2pa && cfg.c2pa && isMp3Format(format)) body.sign_with_c2pa = true
  console.log(`${TAG} music chars=${prompt.length} seconds=${seconds} format=${format}${body.force_instrumental ? ' instrumental' : ''}${body.sign_with_c2pa ? ' c2pa' : ''}`)

  const res = await fetch(`${BASE}/music?output_format=${encodeURIComponent(format)}`, {
    method: 'POST',
    headers: { 'xi-api-key': key(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`ElevenLabs Music ${res.status}: ${detail.slice(0, 300)}`)
  }
  const raw = Buffer.from(await res.arrayBuffer())
  if (raw.length === 0) throw new Error('ElevenLabs Music returned no audio.')
  const buffer = wav ? wavFromPcm(raw, Number(format.split('_')[1]) || 48_000, seconds) : raw

  // Billed on the length we ASKED for, which is the length they charge for.
  const cost = calcSpeechCost(model, { durationSeconds: seconds })
  console.log(`${TAG} music ok bytes=${buffer.length} dur=${seconds}s cost=$${cost.toFixed(4)} song=${res.headers.get('song-id') ?? '?'}`)
  return {
    buffer,
    mediaType: isMp3Format(format) ? 'audio/mpeg' : format.startsWith('opus') ? 'audio/opus' : 'audio/wav',
    durationSeconds: seconds,
    cost,
    characters: null,
  }
}
