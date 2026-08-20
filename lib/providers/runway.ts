// lib/providers/runway.ts
//
// Runway dev API — video generation (gen4.5 text/image-to-video,
// gen4_turbo image-to-video, and hosted seedance2_5 video EXTENSION).
// Task-create + poll pattern:
//   POST https://api.dev.runwayml.com/v1/text_to_video   → { id }
//   POST https://api.dev.runwayml.com/v1/image_to_video  → { id }
//   POST https://api.dev.runwayml.com/v1/video_to_video  → { id }   (extend)
// Docs: docs.dev.runwayml.com. Credits are $0.01 each; per-second rates
// live in the DB row's model_pricing.per_video_second.
//
// EXTEND (verified against the Aug 7 2026 API changelog): body is
// { model, mode: 'extend', promptVideo, promptText } — promptText is
// REQUIRED, and `ratio`/`duration` are omitted because the output matches
// the input clip's duration and orientation. Billing at 720p is 30
// credits/s of output PLUS 15 credits/s of input; with output ≈ input
// that's ~$0.45 per input second, which is the combined rate stored on
// the seedance2_5 catalog row.
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

/** Duration in seconds from an MP4's mvhd atom; null if unparseable.
 *  Needed because extend-mode output length follows the INPUT clip, so
 *  the requested `seconds` is not what we should bill. */
function mp4DurationSeconds(buf: Buffer): number | null {
  const i = buf.indexOf('mvhd')
  if (i < 0 || i + 40 > buf.length) return null
  const version = buf[i + 4]
  try {
    if (version === 1) {
      const timescale = buf.readUInt32BE(i + 28)
      const duration = Number(buf.readBigUInt64BE(i + 32))
      return timescale > 0 ? duration / timescale : null
    }
    const timescale = buf.readUInt32BE(i + 16)
    const duration = buf.readUInt32BE(i + 20)
    return timescale > 0 ? duration / timescale : null
  } catch { return null }
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
  const videoAtts = attachments.filter(a => a.mediaType.startsWith('video/'))
  const ratio = ratioForSize(size, options?.aspect_ratio)
  // Runway durations are 5 or 10 seconds.
  const duration = seconds > 7 ? 10 : 5

  const extend = options?.mode === 'extend_video'
  const i2v = !extend && imageAtts.length > 0
  let body: any
  let endpoint: string
  if (extend) {
    const v = videoAtts[0]
    if (!v) throw new Error('Extend a Video needs a video attachment')
    if (!prompt) throw new Error('Extend a Video needs a prompt describing what happens next')
    // No ratio/duration: extend output matches the input clip.
    body = {
      model: model.model_name, mode: 'extend', promptText: prompt,
      promptVideo: v.url ?? `data:${v.mediaType};base64,${v.buffer.toString('base64')}`,
    }
    endpoint = `${BASE}/video_to_video`
  } else {
    body = { model: model.model_name, ratio, duration }
    if (i2v) {
      const asUri = (a: typeof imageAtts[0]) =>
        a.url ?? `data:${a.mediaType};base64,${a.buffer.toString('base64')}`
      // Typed ports (Aug 18, verified against runwayml/sdk-node types):
      // seedance / hailuo / veo3.1 on Runway take promptImage as an ARRAY —
      // position 'first'/'last' for keyframe mode, position omitted for
      // reference images; the two modes cannot be mixed (the port
      // assigner's conflict groups enforce that upstream). Ported callers
      // get the array; the legacy single-string path stays for un-ported
      // ones and for first-only models (gen4, happyhorse).
      const ported = imageAtts.filter(a => a.port)
      if (ported.some(a => a.port === 'last_frame' || a.port === 'reference_image')) {
        body.promptImage = ported.map(a =>
          a.port === 'first_frame' ? { uri: asUri(a), position: 'first' }
          : a.port === 'last_frame' ? { uri: asUri(a), position: 'last' }
          : { uri: asUri(a) })
      } else {
        body.promptImage = asUri(imageAtts[0])
      }
      if (prompt) body.promptText = prompt
    } else {
      body.promptText = prompt
    }
    // Reference audio (seedance2_5 per the SDK types) — rides only when the
    // caller declared the port, so audio can never leak to models whose
    // schema (catalog modes) doesn't grant an audio port.
    const audioRefs = attachments.filter(a => a.mediaType.startsWith('audio/') && a.port === 'reference_audio')
    if (!extend && audioRefs.length > 0) {
      body.referenceAudio = audioRefs.map(a => ({ uri: a.url ?? `data:${a.mediaType};base64,${a.buffer.toString('base64')}` }))
    }
    endpoint = i2v ? `${BASE}/image_to_video` : `${BASE}/text_to_video`
  }
  console.log(`${TAG} create ${extend ? 'extend' : i2v ? 'i2v' : 't2v'}${extend ? '' : ` ratio=${ratio} duration=${duration}s`}`)
  if (onProgress) onProgress(3)

  const res = await fetch(endpoint, { method: 'POST', headers: headers(), body: JSON.stringify(body) })
  if (!res.ok) {
    throw new Error(`Runway request failed (${res.status}): ${(await res.text()).slice(0, 400)}`)
  }
  const { id } = await res.json() as { id: string }
  console.log(`${TAG} task ${id}`)

  // Poll (5s interval per Runway's guidance; ~10 min budget). The old 5-min
  // budget fit gen4-class tasks but killed Seedance 2.5 keyframe runs, which
  // routinely need longer (owner's run died at 5:07, Aug 20). The xcreate
  // route allows maxDuration=800s, so 600s of polling leaves headroom for
  // task creation and the video download.
  let output: string | null = null
  for (let i = 0; i < 120; i++) {
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
      // Keep BOTH the prose failure and the machine failureCode. Runway's
      // prose alone can be uselessly generic ("Invalid input" — owner,
      // Aug 20, with no way to tell WHAT was invalid); the code names the
      // failing stage. The sanitizer strips the bracket for users.
      const code = task.failureCode && task.failureCode !== task.failure ? ` [${task.failureCode}]` : ''
      throw new Error(`Runway task ${task.status}: ${String(task.failure ?? task.failureCode ?? 'unknown').slice(0, 300)}${code}`)
    }
  }
  if (!output) {
    // Cancel the abandoned task. Without this, Runway keeps rendering a
    // video nobody will collect — and bills for it if it succeeds. Best
    // effort: a failed cancel changes nothing about the user-facing outcome.
    try { await fetch(`${BASE}/tasks/${id}`, { method: 'DELETE', headers: headers() }) } catch { /* best effort */ }
    // The task id lands in provider_calls.error_message so a timeout Ref is
    // traceable to a concrete Runway task; the sanitizer never shows it.
    throw new Error(`Runway task timed out after 10 minutes (task ${id}, canceled)`)
  }

  const vr = await fetch(output)
  if (!vr.ok) throw new Error(`Runway video download failed (${vr.status})`)
  const buffer = Buffer.from(await vr.arrayBuffer())
  if (onProgress) onProgress(95)

  // Cost: seconds × per-second rate (resolution-keyed with a default).
  // Extend bills by the MEASURED output length (which tracks the input
  // clip) — the row's rate is the combined input+output per-second price.
  const per = (model.model_pricing?.per_video_second ?? {}) as Record<string, number>
  const rate = per['720p'] ?? per.default ?? Object.values(per)[0] ?? 0
  const billedSeconds = extend ? (mp4DurationSeconds(buffer) ?? duration) : duration
  const cost = billedSeconds * rate
  console.log(`${TAG} done bytes=${buffer.length} billed=${billedSeconds.toFixed(1)}s cost=$${cost.toFixed(3)}`)
  return { buffer, mediaType: 'video/mp4', cost, durationSeconds: billedSeconds }
}
