// lib/providers/xai.ts
//
// xAI Grok Imagine — video generation via the Imagine API.
//
// Flow (docs.x.ai → Model capabilities → Video generation):
//   POST https://api.x.ai/v1/videos/generations  → { request_id }
//   GET  https://api.x.ai/v1/videos/{request_id} → { status, video: { url, duration } }
//   status: pending | done | expired | failed
//
// Modes ("only one mode can be active per request"):
//   • text_to_video   — prompt only
//   • image_to_video  — `image` (signed URL preferred, data URI fallback)
//   • reference_frames— `reference_images` (HTTP URLs required)
//   • video_to_video  — editing/extension; not wired yet (needs video upload)
//
// Pricing (docs.x.ai/developers/models/grok-imagine-video):
//   output 480p $0.05/s · 720p $0.07/s; inputs: image $0.002, video $0.01/s.
//   per_video_second lives in the DB row; input surcharges are read from
//   the row's extra keys so pricing stays data-driven.

import type { ModelInfo, Attachment, VideoResult } from './types'

const BASE = 'https://api.x.ai/v1'

function apiKey(): string {
  const k = process.env.XAI_API_KEY
  if (!k) throw new Error('XAI_API_KEY is not set')
  return k
}

export async function generateVideo(
  model:       ModelInfo,
  prompt:      string,
  size:        string = '720p',
  seconds:     number = 8,
  attachments: Attachment[] = [],
  onProgress?: (pct: number) => void,
  options?:    { mode?: string | null; aspect_ratio?: string | null },
): Promise<VideoResult> {
  const TAG = `[xai/${model.model_name}]`

  // Resolution key from either 'WxH' or bare '720p' size strings.
  const s = String(size)
  const resolution = /1080/.test(s) ? '1080p' : /720/.test(s) ? '720p' : '480p'
  const duration = Math.max(1, Math.min(15, Math.round(seconds)))
  const recipe = options?.mode ?? null
  const imageAtts = attachments.filter(a => a.mediaType.startsWith('image/'))

  const body: any = { model: model.model_name, prompt, duration, resolution }
  if (options?.aspect_ratio) body.aspect_ratio = options.aspect_ratio

  if (recipe === 'reference_frames' && imageAtts.length > 0) {
    // Reference-to-video needs HTTP(S) URLs — the route provides signed
    // storage links on att.url when available.
    const urls = imageAtts.map(a => a.url).filter((u): u is string => !!u)
    if (urls.length === 0) {
      throw new Error('Grok reference-to-video needs attachment URLs (signed storage links missing)')
    }
    body.reference_images = urls
    console.log(`${TAG} reference_images=${urls.length}`)
  } else if (imageAtts.length > 0) {
    const a = imageAtts[0]
    body.image = a.url ?? `data:${a.mediaType};base64,${a.buffer.toString('base64')}`
    console.log(`${TAG} image-to-video via ${a.url ? 'signed url' : 'data URI'} (${a.buffer.length}b)`)
  }

  console.log(`${TAG} generate start resolution=${resolution} duration=${duration}s mode=${recipe ?? 'auto'}`)
  if (onProgress) onProgress(2)

  const res = await fetch(`${BASE}/videos/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey()}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`Grok video request failed (${res.status}): ${(await res.text()).slice(0, 400)}`)
  }
  const { request_id } = await res.json()
  if (!request_id) throw new Error('Grok video response missing request_id')
  console.log(`${TAG} request_id=${request_id}`)

  // Poll. Grok Imagine is fast (usually well under a minute); cap at 10 min.
  const POLL_MS = 5_000
  const MAX_POLLS = 120
  let final: any = null
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise(r => setTimeout(r, POLL_MS))
    const p = await fetch(`${BASE}/videos/${request_id}`, {
      headers: { Authorization: `Bearer ${apiKey()}` },
    })
    if (!p.ok) throw new Error(`Grok video poll failed (${p.status}): ${(await p.text()).slice(0, 300)}`)
    const data = await p.json()
    if (data.status === 'done') { final = data; break }
    if (data.status === 'failed') {
      throw new Error(`Grok video failed: ${data.error?.message ?? data.error?.code ?? 'unknown error'}`)
    }
    if (data.status === 'expired') throw new Error('Grok video request expired')
    if (onProgress) onProgress(Math.min(90, 5 + Math.round((i / 24) * 85)))
    console.log(`${TAG} status=${data.status} (poll ${i + 1}/${MAX_POLLS})`)
  }
  if (!final) throw new Error(`Grok video timed out after ${(POLL_MS * MAX_POLLS) / 1000}s`)

  const url = final.video?.url
  if (!url) throw new Error(`Grok video done but no url: ${JSON.stringify(final).slice(0, 300)}`)
  const vres = await fetch(url)
  if (!vres.ok) throw new Error(`Grok video download failed (${vres.status})`)
  const buffer = Buffer.from(await vres.arrayBuffer())

  // Cost: billed output seconds × per-resolution rate, + input surcharges.
  const billedSeconds = Number(final.video?.duration) || duration
  const pricing: any = model.model_pricing ?? {}
  const rate = Number(pricing.per_video_second?.[resolution] ?? 0)
  const inputImageCost = imageAtts.length * Number(pricing.input_per_image ?? 0)
  const cost = billedSeconds * rate + inputImageCost
  console.log(`${TAG} video ok bytes=${buffer.length} duration=${billedSeconds}s cost=$${cost.toFixed(4)}`)
  if (onProgress) onProgress(100)

  return { buffer, mediaType: 'video/mp4', durationSeconds: billedSeconds, cost }
}
