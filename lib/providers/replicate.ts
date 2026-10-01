// lib/providers/replicate.ts
//
// Replicate (replicate.com, Cloudflare since Dec 2025): models published by
// their makers' official accounts and sold at the maker's own list price.
// First use (owner, Oct 1): ByteDance's Seedance 2.5, which BytePlus will not
// sell to a US company and Runway resells at about twice the price.
//
//   POST /v1/models/{owner}/{name}/predictions  { input }  -> prediction
//   GET  /v1/predictions/{id}                               -> status
//        starting | processing | succeeded | failed | canceled
//
// Seedance 2.5 here (schema read with our token Oct 1, version ca38262bae09):
// resolution 480p | 720p only (no 1080p); duration 4-30 (-1 = the model
// decides); aspect 16:9 4:3 1:1 3:4 9:16 21:9 adaptive; image (first frame),
// last_frame_image, reference_images / reference_videos / reference_audios
// as URIs; generate_audio (default true); watermark (default false); seed.
// A request carrying a reference VIDEO bills at another rate on input plus
// output seconds; nothing here sends one (video extension and video
// references had no runs at all on Runway), so the per-second rate on the
// catalog row is the whole bill.
//
// Outputs made through the API are deleted after an hour, so the file is
// downloaded here, at once. Requires REPLICATE_API_TOKEN.

import type { ModelInfo, Attachment, VideoResult } from './types'

const BASE = 'https://api.replicate.com/v1'
const POLL_MS = 5_000
const MAX_POLLS = 120   // ~10 minutes, like the other video providers

/** Our catalog model_name -> the maker's model on Replicate. */
const SLUGS: Record<string, string> = {
  seedance2_5: 'bytedance/seedance-2.5',
}

const ASPECTS = new Set(['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'])

function apiKey(): string {
  const k = process.env.REPLICATE_API_TOKEN
  if (!k) throw new Error('REPLICATE_API_TOKEN is not set')
  return k
}

function headers() {
  return { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' }
}

/** Our size ('480p', '720p', '854x480', …) -> Replicate's resolution. */
function resolutionFor(size: string): '480p' | '720p' {
  const s = String(size).toLowerCase()
  if (s.includes('1080') || s.includes('1920')) {
    throw new Error('USERMSG: Seedance 2.5 goes up to 720p here. Pick 480p or 720p.')
  }
  if (s.includes('480') || s.includes('854')) return '480p'
  const m = s.match(/(\d+)\s*[x×*]\s*(\d+)/i)
  if (m && Math.min(parseInt(m[1], 10), parseInt(m[2], 10)) < 700) return '480p'
  return '720p'
}

const asUri = (a: Attachment) => a.url ?? `data:${a.mediaType};base64,${a.buffer.toString('base64')}`

export async function generateVideo(
  model:       ModelInfo,
  prompt:      string,
  size:        string = '720p',
  seconds:     number = 5,
  attachments: Attachment[] = [],
  onProgress?: (pct: number) => void,
  options?:    { aspect_ratio?: string | null; mode?: string | null; generate_audio?: boolean | null; seed?: number | null },
): Promise<VideoResult> {
  const TAG = `[replicate/${model.model_name}]`
  const slug = SLUGS[model.model_name]
  if (!slug) throw new Error(`${model.model_name} has no Replicate model mapped`)
  if (options?.mode === 'extend_video' || attachments.some(a => a.mediaType.startsWith('video/'))) {
    throw new Error('USERMSG: Extending or referencing a video is not available for this model right now. Nothing was charged.')
  }

  const resolution = resolutionFor(size)
  const duration = Math.max(4, Math.min(30, Math.round(seconds)))
  const images = attachments.filter(a => a.mediaType.startsWith('image/'))
  const audios = attachments.filter(a => a.mediaType.startsWith('audio/'))
  // Typed ports (lib/ports.ts) say what each picture is for; an un-ported
  // single image is a first frame, as on the other providers.
  const ported = images.some(a => a.port)
  const first = images.find(a => a.port === 'first_frame') ?? (ported ? null : images[0] ?? null)
  const last = images.find(a => a.port === 'last_frame') ?? null
  const refs = images.filter(a => a.port === 'reference_image')
  const audioRefs = audios.filter(a => a.port === 'reference_audio')

  const input: Record<string, unknown> = {
    prompt,
    duration,
    resolution,
    // A first frame decides the shape unless the user picked one.
    aspect_ratio: options?.aspect_ratio && ASPECTS.has(options.aspect_ratio) ? options.aspect_ratio : (first ? 'adaptive' : '16:9'),
    generate_audio: options?.generate_audio ?? true,
    watermark: false,
  }
  if (first) input.image = asUri(first)
  if (last) input.last_frame_image = asUri(last)
  if (refs.length) input.reference_images = refs.slice(0, 30).map(asUri)
  if (audioRefs.length) input.reference_audios = audioRefs.slice(0, 10).map(asUri)
  if (typeof options?.seed === 'number' && Number.isFinite(options.seed)) input.seed = Math.round(options.seed)

  console.log(`${TAG} create ${resolution} ${duration}s aspect=${input.aspect_ratio} first=${!!first} last=${!!last} refs=${refs.length} audio=${audioRefs.length}`)
  if (onProgress) onProgress(3)
  const submittedAt = Date.now()
  const res = await fetch(`${BASE}/models/${slug}/predictions`, { method: 'POST', headers: headers(), body: JSON.stringify({ input }) })
  const created: any = await res.json().catch(() => null)
  if (!res.ok) {
    const why = created?.detail ?? created?.title ?? JSON.stringify(created ?? {})
    throw new Error(`Replicate request failed (${res.status}): ${String(why).slice(0, 400)}`)
  }
  const id: string = created.id
  console.log(`${TAG} prediction ${id}`)

  let p: any = created
  let doneAt = 0
  for (let i = 0; i < MAX_POLLS && !['succeeded', 'failed', 'canceled'].includes(p?.status); i++) {
    await new Promise(r => setTimeout(r, POLL_MS))
    const r = await fetch(`${BASE}/predictions/${id}`, { headers: headers() })
    if (!r.ok) continue
    p = await r.json()
    if (onProgress) onProgress(Math.min(90, 8 + i * 2))
  }
  if (p?.status === 'succeeded') doneAt = Date.now()
  if (p?.status !== 'succeeded') {
    if (!['failed', 'canceled'].includes(p?.status)) {
      // Abandoned: cancel it, or Replicate renders and bills a video nobody collects.
      try { await fetch(`${BASE}/predictions/${id}/cancel`, { method: 'POST', headers: headers() }) } catch { /* best effort */ }
      throw new Error(`Replicate prediction timed out after 10 minutes (${id}, canceled)`)
    }
    throw new Error(`Replicate prediction ${p.status}: ${String(p?.error ?? 'unknown').slice(0, 300)}`)
  }

  const out = Array.isArray(p.output) ? p.output[0] : p.output
  if (typeof out !== 'string') throw new Error(`Replicate prediction ${id} succeeded with no video URL`)
  const vr = await fetch(out)
  if (!vr.ok) throw new Error(`Replicate video download failed (${vr.status})`)
  const buffer = Buffer.from(await vr.arrayBuffer())
  if (onProgress) onProgress(95)

  // The model's own time from Replicate's timestamps (created -> completed);
  // our request -> the poll that saw it done when they are missing.
  const stamped = Date.parse(p.completed_at) - Date.parse(p.created_at)
  const generationMs = Number.isFinite(stamped) && stamped >= 0 ? stamped : doneAt - submittedAt

  // Per second of output at the requested tier, from the catalog row: the
  // maker's list price, which is what Replicate charges for this model.
  const per = (model.model_pricing?.per_video_second ?? {}) as Record<string, number>
  const rate = per[resolution] ?? per.default ?? 0
  const cost = duration * rate
  console.log(`${TAG} done bytes=${buffer.length} ${resolution} ${duration}s cost=$${cost.toFixed(3)} model time=${(generationMs / 1000).toFixed(0)}s`)
  return { buffer, mediaType: vr.headers.get('content-type')?.startsWith('video/') ? vr.headers.get('content-type')! : 'video/mp4', durationSeconds: duration, cost, generationMs }
}
