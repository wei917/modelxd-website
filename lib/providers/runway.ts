// lib/providers/runway.ts
//
// Runway dev API — video generation (gen4.5 text/image-to-video,
// gen4_turbo image-to-video). Task-create + poll pattern:
//   POST https://api.dev.runwayml.com/v1/text_to_video   → { id }
//   POST https://api.dev.runwayml.com/v1/image_to_video  → { id }
//   GET  https://api.dev.runwayml.com/v1/tasks/{id}      → { status, output: [url] }
// Docs: docs.dev.runwayml.com. Credits are $0.01 each; per-second rates
// live in the DB row's model_pricing.per_video_second.
//
// Requires RUNWAYML_API_SECRET.

import type { ModelInfo, Attachment, VideoResult } from './types'

const BASE = 'https://api.dev.runwayml.com/v1'
// Dated API version header required by Runway; bump deliberately.
const API_VERSION = '2024-11-06'

function apiKey(): string {
  const k = process.env.RUNWAYML_API_SECRET
  if (!k) throw new Error('RUNWAYML_API_SECRET is not set')
  return k
}

function headers() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey()}`,
    'X-Runway-Version': API_VERSION,
  }
}

// Runway ratios are exact pixel pairs like '1280:720'. Map our size
// strings (WxH or '720p' style) onto the nearest supported landscape/
// portrait/square ratio.
function ratioForSize(size: string, aspect?: string | null): string {
  const s = String(size)
  const m = s.match(/(\d+)\s*[x×*]\s*(\d+)/i)
  const w = m ? parseInt(m[1], 10) : 1280
  const h = m ? parseInt(m[2], 10) : 720
  // Probed live July 22: gen4.5 accepts exactly 1280:720 | 720:1280.
  const portrait = aspect === '9:16' || (m ? h > w : false)
  return portrait ? '720:1280' : '1280:720'
}

export async function generateVideo(
  model:       ModelInfo,
  prompt:      string,
  size:        string = '1280x720',
  seconds:     number = 5,
  attachments: Attachment[] = [],
  onProgress?: (pct: number) => void,
  options?:    { aspect_ratio?: string | null; mode?: string | null },
): Promise<VideoResult> {
  const TAG = `[runway/${model.model_name}]`
  const imageAtts = attachments.filter(a => a.mediaType.startsWith('image/'))
  const ratio = ratioForSize(size, options?.aspect_ratio)
  // Runway durations are 5 or 10 seconds.
  const duration = seconds > 7 ? 10 : 5

  const i2v = imageAtts.length > 0
  const body: any = { model: model.model_name, ratio, duration }
  if (i2v) {
    const a = imageAtts[0]
    body.promptImage = a.url ?? `data:${a.mediaType};base64,${a.buffer.toString('base64')}`
    if (prompt) body.promptText = prompt
  } else {
    body.promptText = prompt
  }
  const endpoint = i2v ? `${BASE}/image_to_video` : `${BASE}/text_to_video`
  console.log(`${TAG} create ${i2v ? 'i2v' : 't2v'} ratio=${ratio} duration=${duration}s`)
  if (onProgress) onProgress(3)

  const res = await fetch(endpoint, { method: 'POST', headers: headers(), body: JSON.stringify(body) })
  if (!res.ok) {
    throw new Error(`Runway request failed (${res.status}): ${(await res.text()).slice(0, 400)}`)
  }
  const { id } = await res.json() as { id: string }
  console.log(`${TAG} task ${id}`)

  // Poll (5s interval per Runway's guidance; ~5 min budget).
  let output: string | null = null
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 5000))
    const tr = await fetch(`${BASE}/tasks/${id}`, { headers: headers() })
    if (!tr.ok) continue
    const task: any = await tr.json()
    if (onProgress) onProgress(Math.min(90, 10 + i * 3))
    if (task.status === 'SUCCEEDED') {
      output = Array.isArray(task.output) ? task.output[0] : task.output?.[0] ?? task.output
      break
    }
    if (task.status === 'FAILED' || task.status === 'CANCELED') {
      throw new Error(`Runway task ${task.status}: ${String(task.failure ?? task.failureCode ?? 'unknown').slice(0, 300)}`)
    }
  }
  if (!output) throw new Error('Runway task timed out after 5 minutes')

  const vr = await fetch(output)
  if (!vr.ok) throw new Error(`Runway video download failed (${vr.status})`)
  const buffer = Buffer.from(await vr.arrayBuffer())
  if (onProgress) onProgress(95)

  // Cost: seconds × per-second rate (resolution-keyed with a default).
  const per = (model.model_pricing?.per_video_second ?? {}) as Record<string, number>
  const rate = per['720p'] ?? per.default ?? Object.values(per)[0] ?? 0
  const cost = duration * rate
  console.log(`${TAG} done bytes=${buffer.length} cost=$${cost.toFixed(3)}`)
  return { buffer, mediaType: 'video/mp4', cost, durationSeconds: duration }
}
