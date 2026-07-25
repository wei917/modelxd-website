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
//   • video_to_video  — `POST /v1/videos/edits`, body `video: { url }`.
//     Edits ignore duration / resolution / aspect_ratio: the output matches
//     the input and is capped at 720p, and the input itself is capped at
//     8.7s. /videos/generations rejects video input, hence the endpoint
//     switch below. (docs.x.ai → Model capabilities → Video → Editing)
//
// Pricing (docs.x.ai/developers/models/grok-imagine-video):
//   output 480p $0.05/s · 720p $0.07/s; inputs: image $0.002, video $0.01/s.
//   per_video_second lives in the DB row; input surcharges are read from
//   the row's extra keys so pricing stays data-driven.

import type { ModelInfo, Attachment, VideoResult, ImageResult } from './types'

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
  const videoAtts = attachments.filter(a => a.mediaType.startsWith('video/'))
  // A video upload switches endpoints entirely — /videos/generations refuses
  // video input, so an edit has to go to /videos/edits instead.
  const isEdit = videoAtts.length > 0

  const body: any = { model: model.model_name, prompt }
  if (!isEdit) {
    // Edits derive all three from the input clip; sending them is at best
    // ignored and at worst a deserialization error.
    body.duration = duration
    body.resolution = resolution
    if (options?.aspect_ratio) body.aspect_ratio = options.aspect_ratio
  }

  if (isEdit) {
    const v = videoAtts[0]
    // `video` takes a public URL or a base64 data URL. The route signs
    // storage links onto att.url; the data-URI fallback keeps parity with
    // the image path, which needs the same object (not bare string) form.
    body.video = { url: v.url ?? `data:${v.mediaType};base64,${v.buffer.toString('base64')}` }
    if (imageAtts.length > 0) {
      console.log(`${TAG} video-edit ignoring ${imageAtts.length} image attachment(s) — /videos/edits takes one video`)
    }
    console.log(`${TAG} video-edit via ${v.url ? 'signed url' : 'data URI'} (${v.buffer.length}b)`)
  } else if (recipe === 'reference_frames' && imageAtts.length > 0) {
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
    // The API requires the OBJECT form here - a bare URL/data-URI string is
    // rejected at deserialization (verified live July 20, v1 and v1.5).
    body.image = { type: 'image_url', url: a.url ?? `data:${a.mediaType};base64,${a.buffer.toString('base64')}` }
    console.log(`${TAG} image-to-video via ${a.url ? 'signed url' : 'data URI'} (${a.buffer.length}b)`)
  }

  const endpoint = isEdit ? 'videos/edits' : 'videos/generations'
  console.log(`${TAG} ${isEdit ? 'edit' : 'generate'} start ` +
    `resolution=${isEdit ? 'from input (<=720p)' : resolution} ` +
    `duration=${isEdit ? 'from input' : duration + 's'} mode=${recipe ?? 'auto'}`)
  if (onProgress) onProgress(2)

  const res = await fetch(`${BASE}/${endpoint}`, {
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
  // An edit matches the input resolution and ignores the UI picker, so the
  // requested key would misprice it. Bill at the documented 720p cap rather
  // than quietly under-report our own spend.
  const rate = Number(pricing.per_video_second?.[isEdit ? '720p' : resolution] ?? 0)
  const inputImageCost = imageAtts.length * Number(pricing.input_per_image ?? 0)
  // Input video is charged per second on top of output. For an edit the
  // output duration equals the input duration, so billedSeconds doubles as
  // the input length.
  const inputVideoCost = isEdit
    ? billedSeconds * Number(pricing.input_per_video_second ?? 0)
    : 0
  const cost = billedSeconds * rate + inputImageCost + inputVideoCost
  console.log(`${TAG} video ok bytes=${buffer.length} duration=${billedSeconds}s cost=$${cost.toFixed(4)}`)
  if (onProgress) onProgress(100)

  return { buffer, mediaType: 'video/mp4', durationSeconds: billedSeconds, cost }
}


// ── Grok Imagine Image ───────────────────────────────────────────────────────
//
// Text-to-image: POST /v1/images/generations
// Image editing: POST /v1/images/edits (JSON body, image as URL / data URI)
// Docs: docs.x.ai/developers/models/grok-imagine-image
// Pricing: $0.02 per output image (1k & 2k), $0.002 per input image —
// read from model_pricing.per_image so it stays data-driven.
export async function generateImage(
  model:       ModelInfo,
  prompt:      string,
  _quality:    'low' | 'medium' | 'high' = 'medium',
  size:        string = '1024x1024',
  attachments: Attachment[] = [],
  options?:    { count?: number | null; aspect_ratio?: string | null },
): Promise<ImageResult> {
  const TAG = `[xai/${model.model_name}]`
  const resolution = /2048|2k/i.test(String(size)) ? '2k' : '1k'
  const imageAtts = attachments.filter(a => a.mediaType.startsWith('image/'))
  const editing = imageAtts.length > 0
  const n = Math.max(1, Math.min(4, options?.count ?? 1))

  const body: any = { model: model.model_name, prompt, response_format: 'b64_json' }
  if (editing) {
    const a = imageAtts[0]
    body.image = { type: 'image_url', url: a.url ?? `data:${a.mediaType};base64,${a.buffer.toString('base64')}` }
  } else {
    body.resolution = resolution
    if (options?.aspect_ratio) body.aspect_ratio = options.aspect_ratio
    if (n > 1) body.n = n
  }

  const endpoint = `${BASE}/images/${editing ? 'edits' : 'generations'}`
  console.log(`${TAG} generateImage ${editing ? 'edit' : 'generate'} resolution=${resolution} n=${n}`)
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey()}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`Grok image request failed (${res.status}): ${(await res.text()).slice(0, 400)}`)
  }
  const json: any = await res.json()
  const items: any[] = json.data ?? []
  if (items.length === 0) throw new Error('Grok returned no image')

  const decode = async (item: any): Promise<Buffer> => {
    if (item.b64_json) return Buffer.from(item.b64_json, 'base64')
    if (item.url) {
      const r = await fetch(item.url)
      if (!r.ok) throw new Error(`Grok image download failed (${r.status})`)
      return Buffer.from(await r.arrayBuffer())
    }
    throw new Error('Grok image item missing b64_json/url')
  }
  const buffers = await Promise.all(items.map(decode))

  const per = (model.model_pricing?.per_image ?? {}) as Record<string, number>
  const outRate   = per[resolution] ?? per['1k'] ?? per.default ?? 0.02
  const inputRate = per.input_image ?? 0.002
  const cost = buffers.length * outRate + (editing ? imageAtts.length * inputRate : 0)
  console.log(`${TAG} done images=${buffers.length} cost=$${cost.toFixed(4)}`)

  return {
    buffer:    buffers[0],
    mediaType: 'image/png',
    cost,
    extras:    buffers.slice(1).map(b => ({ buffer: b, mediaType: 'image/png' })),
  }
}
