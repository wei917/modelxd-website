// lib/providers/minimax.ts
//
// MiniMax open platform (Global endpoint) — video generation, starting
// with MiniMax-H3 / Hailuo 3.0 (owner, Aug 13: "let's add MiniMax H3").
// Async task pattern, per the official docs at
// platform.minimax.io/docs/guides/video-generation:
//   POST https://api.minimax.io/v2/video_generation                → task_id
//   GET  https://api.minimax.io/v2/query/video_generation/{id}    → status,
//        content.url on success (statuses: queued|succeeded|failed|cancelled)
// Auth: Bearer MINIMAX_API_KEY.
//
// Requests use the v2 multimodal content[] shape: a text item carries the
// prompt; image attachments ride as first_frame / reference_image items.
// duration is an INTEGER 4-15s; resolution is '768P' | '2K'; ratio is a
// named aspect for text-to-video and 'adaptive' when a first frame leads.
//
// UNVERIFIED-LIVE (no MINIMAX_API_KEY yet): the request body follows the
// official doc's field names, and any 400 is surfaced verbatim so the
// first real run either works or tells us exactly what to fix.

import type { ModelInfo, Attachment, VideoResult, SpeechResult } from './types'
import { calcSpeechCost } from './pricing'

const BASE = 'https://api.minimax.io/v2'

function apiKey(): string {
  const k = process.env.MINIMAX_API_KEY
  if (!k) throw new Error('MINIMAX_API_KEY is not set')
  return k
}

const headers = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${apiKey()}`,
})

/** '2560x1440' / '2k' → '2K'; everything smaller → '768P'. */
function resolutionForSize(size: string): '768P' | '2K' {
  const s = String(size).toLowerCase()
  if (s.includes('2k') || s.includes('1440') || s.includes('2560')) return '2K'
  return '768P'
}

const RATIOS = new Set(['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'])

export async function generateVideo(
  model:       ModelInfo,
  prompt:      string,
  size:        string = '1280x720',
  seconds:     number = 6,
  attachments: Attachment[] = [],
  onProgress?: (pct: number) => void,
  options?:    { aspect_ratio?: string | null; mode?: string | null },
): Promise<VideoResult> {
  const TAG = `[minimax/${model.model_name}]`
  const imageAtts = attachments.filter(a => a.mediaType.startsWith('image/'))
  // H3 is omni-modal: reference audio drives lip-sync and rhythm (free as
  // input per the official pricing page). ≤3 clips, 2-15s each.
  const audioAtts = attachments.filter(a => a.mediaType.startsWith('audio/')).slice(0, 3)
  const duration = Math.min(15, Math.max(4, Math.round(seconds)))
  const resolution = resolutionForSize(size)

  const asUrl = (a: Attachment) =>
    a.url ?? `data:${a.mediaType};base64,${a.buffer.toString('base64')}`

  // H3's modes are EXCLUSIVE (probed live, Aug 14: "reference mode cannot
  // be mixed with first_frame/middle_frame/last_frame; choose one").
  // Roles come from the caller's typed ports (lib/ports.ts) when present —
  // the port assigner enforces the exclusivity, so this file no longer
  // decides. Un-ported callers keep the old inference: audio present ⇒
  // reference mode for every image (the price of lip-sync); otherwise the
  // first image pins the frame.
  // H3 rejects an empty text part outright ("content[0].text is empty",
  // code 2013, seen live Aug 26 on an audio-only run) — fail with the fix
  // instead of the upstream 400.
  if (!prompt || !prompt.trim()) {
    throw new Error('USERMSG: MiniMax H3 needs a prompt — the audio drives rhythm and lip-sync, but the prompt says what happens on screen.')
  }

  const H3_IMAGE_ROLES = new Set(['first_frame', 'last_frame', 'middle_frame', 'reference_image'])
  const inferredRefMode = audioAtts.length > 0
  const roles = imageAtts.map((a, i) =>
    (a.port && H3_IMAGE_ROLES.has(a.port))
      ? a.port
      : (inferredRefMode || i > 0) ? 'reference_image' : 'first_frame')
  const content: any[] = [{ type: 'text', text: prompt }]
  imageAtts.forEach((a, i) => {
    content.push({ type: 'image_url', image_url: { url: asUrl(a) }, role: roles[i] })
  })
  const referenceMode = !roles.some(r => r.endsWith('_frame'))
  for (const a of audioAtts) {
    // role IS required for audio too — probed live, Aug 14: omitting it is
    // "content[2].role must not be empty (2013)".
    content.push({ type: 'audio_url', audio_url: { url: asUrl(a) }, role: 'reference_audio' })
  }

  // 'adaptive' follows the FIRST FRAME's orientation — correct when a frame
  // is pinned, an accident in reference mode (Aug 14: a portrait reference
  // photo produced a portrait MV shot that pillarboxed the 16:9 edit).
  // Reference mode pins nothing, so the requested aspect governs.
  const wantRatio = options?.aspect_ratio && RATIOS.has(options.aspect_ratio) ? options.aspect_ratio : '16:9'
  const ratio = (imageAtts.length > 0 && !referenceMode) ? 'adaptive' : wantRatio

  const body = { model: model.model_name, content, duration, resolution, ratio }
  console.log(`${TAG} create ${imageAtts.length > 0 ? 'i2v' : 't2v'} duration=${duration}s resolution=${resolution} ratio=${ratio} images=${imageAtts.length} audio=${audioAtts.length}`)
  if (onProgress) onProgress(3)

  const res = await fetch(`${BASE}/video_generation`, {
    method: 'POST', headers: headers(), body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`MiniMax request failed (${res.status}): ${(await res.text()).slice(0, 400)}`)
  }
  const created: any = await res.json()
  const taskId = created?.task_id ?? created?.task?.task_id
  if (!taskId) {
    // Their errors can arrive 200-wrapped in base_resp.
    const msg = created?.base_resp?.status_msg ?? JSON.stringify(created).slice(0, 300)
    throw new Error(`MiniMax did not return a task_id: ${msg}`)
  }
  console.log(`${TAG} task ${taskId}`)

  // Poll — H3 clips run minutes; 10s interval, ~12 min budget.
  let url: string | null = null
  for (let i = 0; i < 72; i++) {
    await new Promise(r => setTimeout(r, 10_000))
    const tr = await fetch(`${BASE}/query/video_generation/${encodeURIComponent(taskId)}`, { headers: headers() })
    if (!tr.ok) continue
    const q: any = await tr.json()
    const task = q?.task ?? q
    const status = String(task?.status ?? '').toLowerCase()
    if (onProgress) onProgress(Math.min(90, 8 + i * 2))
    if (status === 'succeeded') {
      url = task?.content?.url ?? task?.content?.[0]?.url ?? null
      break
    }
    if (status === 'failed' || status === 'cancelled') {
      // task.error arrives as an OBJECT — String() printed "[object
      // Object]" and hid a real failure reason (probed Aug 15).
      const raw = task?.error ?? q?.base_resp?.status_msg ?? 'unknown'
      const msg = typeof raw === 'string' ? raw : JSON.stringify(raw)
      throw new Error(`MiniMax task ${status}: ${msg.slice(0, 300)}`)
    }
  }
  if (!url) throw new Error('MiniMax task timed out after 12 minutes')

  const vr = await fetch(url)
  if (!vr.ok) throw new Error(`MiniMax video download failed (${vr.status})`)
  const buffer = Buffer.from(await vr.arrayBuffer())
  if (onProgress) onProgress(95)

  // Resolution-keyed per-second rate from the catalog row.
  const per = (model.model_pricing?.per_video_second ?? {}) as Record<string, number>
  const rate = per[resolution] ?? per.default ?? Object.values(per)[0] ?? 0
  const cost = duration * rate
  console.log(`${TAG} done bytes=${buffer.length} billed=${duration}s @${rate}/s cost=$${cost.toFixed(3)}`)
  return { buffer, mediaType: 'video/mp4', cost, durationSeconds: duration }
}

// ── text to speech (T2A v2) ─────────────────────────────────────────────────
//
// POST https://api.minimax.io/v1/t2a_v2 — note the **v1** prefix: the video
// endpoints above are v2, and reusing BASE here sends TTS to a 404.
//
// Three things this endpoint does differently from every other provider we
// talk to (docs read 2026-09-25):
//   * audio comes back HEX-encoded, not base64 (`output_format: 'hex'`),
//   * errors arrive inside a 200 at `base_resp.status_code` (0 = ok),
//   * it reports its own billable character count in
//     `extra_info.usage_characters` — that is what we bill, not our own
//     count of the prompt, the same rule as Tripo's consumed_credit.
// `output_format: 'url'` exists and is deliberately unused: that URL dies in
// 24h and we persist nothing that expires (Common Pitfall #11).

export async function generateSpeech(
  model: ModelInfo,
  text: string,
  options?: { voice?: string | null; format?: string | null; speed?: number | null; language?: string | null },
): Promise<SpeechResult> {
  const TAG = `[minimax/${model.model_name}]`
  const cfg = model.output_config?.audio ?? {}
  const format = (options?.format ?? (cfg.formats ?? [])[0] ?? 'mp3').toLowerCase()
  const voice = options?.voice ?? (cfg.voices ?? [])[0]?.id ?? 'English_expressive_narrator'
  const body: Record<string, unknown> = {
    model: model.model_name,
    text,
    stream: false,
    output_format: 'hex',
    language_boost: options?.language ?? 'auto',
    voice_setting: { voice_id: voice, speed: options?.speed ?? 1, vol: 1, pitch: 0 },
    audio_setting: { sample_rate: 32000, bitrate: 128000, format, channel: 1 },
  }
  console.log(`${TAG} t2a chars=${text.length} voice=${voice} format=${format}`)

  const res = await fetch('https://api.minimax.io/v1/t2a_v2', { method: 'POST', headers: headers(), body: JSON.stringify(body) })
  const json: any = await res.json().catch(() => ({}))
  // A MiniMax failure is a 200 with a non-zero status_code; only a transport
  // or auth problem reaches us as an HTTP error.
  const br = json?.base_resp ?? {}
  if (!res.ok || (br.status_code !== undefined && br.status_code !== 0)) {
    throw new Error(`MiniMax TTS ${res.status} ${br.status_code ?? ''}: ${br.status_msg ?? JSON.stringify(json).slice(0, 300)}`)
  }
  const hex = json?.data?.audio
  if (typeof hex !== 'string' || !hex) throw new Error('MiniMax TTS returned no audio.')
  const buffer = Buffer.from(hex, 'hex')

  const info = json?.extra_info ?? {}
  const characters = Number(info.usage_characters ?? text.length)
  const durationSeconds = Number(info.audio_length ?? 0) / 1000 || undefined
  const cost = calcSpeechCost(model, { characters })
  console.log(`${TAG} t2a ok bytes=${buffer.length} chars=${characters} dur=${durationSeconds ?? '?'}s cost=$${cost.toFixed(6)}`)
  return {
    buffer,
    mediaType: format === 'wav' ? 'audio/wav' : format === 'flac' ? 'audio/flac' : format === 'opus' ? 'audio/opus' : 'audio/mpeg',
    durationSeconds, cost, characters, usageMetadata: info,
  }
}
