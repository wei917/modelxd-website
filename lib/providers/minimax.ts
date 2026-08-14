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

import type { ModelInfo, Attachment, VideoResult } from './types'

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
  // be mixed with first_frame/middle_frame/last_frame; choose one"). With
  // audio present we must be in reference mode, so every image rides as a
  // reference — likeness carries, the exact opening frame does not. That
  // is the price of lip-sync, and the UI's partial-frame ⚠ language
  // already describes it. Without audio, the first image pins the frame.
  const content: any[] = [{ type: 'text', text: prompt }]
  const referenceMode = audioAtts.length > 0
  imageAtts.forEach((a, i) => {
    content.push({
      type: 'image_url',
      image_url: { url: asUrl(a) },
      role: (referenceMode || i > 0) ? 'reference_image' : 'first_frame',
    })
  })
  for (const a of audioAtts) {
    // role IS required for audio too — probed live, Aug 14: omitting it is
    // "content[2].role must not be empty (2013)".
    content.push({ type: 'audio_url', audio_url: { url: asUrl(a) }, role: 'reference_audio' })
  }

  const ratio = imageAtts.length > 0
    ? 'adaptive'
    : (options?.aspect_ratio && RATIOS.has(options.aspect_ratio) ? options.aspect_ratio : '16:9')

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
      throw new Error(`MiniMax task ${status}: ${String(task?.error ?? q?.base_resp?.status_msg ?? 'unknown').slice(0, 300)}`)
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
