// lib/remake/previews.ts: 同款 materials, their pictures (Oct 13). A small
// picture of each person, thing and place, cut from the original at the
// moment the read named, so the swap cards show what is being replaced.
// X and uploads only: the route holds their file during the read, while
// YouTube is never downloaded. Sent back inline and never stored, since the
// source is not kept (docs/REMAKE-PLAN.md).

import sharp from 'sharp'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Box, Breakdown } from './config'

const run = promisify(execFile)

type Job = { id: string; t: number; box?: Box; shape: 'face' | 'thing' | 'place' }
type Region = { left: number; top: number; width: number; height: number }

/** The frame at `t` seconds of the file, as JPEG bytes. */
async function frameAt(ffmpeg: string, file: string, t: number): Promise<Buffer | null> {
  try {
    const { stdout } = await run(ffmpeg, ['-v', 'error', '-ss', t.toFixed(2), '-i', file, '-frames:v', '1', '-q:v', '3', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'],
      { encoding: 'buffer', maxBuffer: 20 * 1024 * 1024, timeout: 20_000 })
    return stdout.length ? stdout : null
  } catch { return null }
}

/** What to show of the frame: the box grown a little and made square (a
 *  person's head and shoulders, a thing), or the middle of the frame for a
 *  place or when there is no box. */
function region(W: number, H: number, job: Job): Region {
  if (job.shape === 'place' || !job.box) {
    const ratio = job.shape === 'place' ? 3 / 2 : 1
    let w = W, h = Math.round(W / ratio)
    if (h > H) { h = H; w = Math.round(H * ratio) }
    return { left: Math.round((W - w) / 2), top: Math.round((H - h) / 2), width: w, height: h }
  }
  const [y0, x0, y1, x1] = job.box
  const bx = (x0 / 1000) * W, by = (y0 / 1000) * H, bw = ((x1 - x0) / 1000) * W
  let bh = ((y1 - y0) / 1000) * H
  // A box around a whole person: keep its top, where the face is.
  if (job.shape === 'face' && bh > bw * 1.3) bh = bw * 1.3
  const side = Math.floor(Math.min(Math.max(bw, bh) * 1.25, W, H))
  const left = Math.round(Math.max(0, Math.min(W - side, bx + bw / 2 - side / 2)))
  const top = Math.round(Math.max(0, Math.min(H - side, by + bh / 2 - side / 2)))
  return { left, top, width: Math.min(side, W - left), height: Math.min(side, H - top) }
}

/** id → JPEG data URL. `offset`: where the read started in the file. A
 *  picture that fails leaves its card without one; this never throws. */
export async function makePreviews(ffmpeg: string, file: string, offset: number, b: Breakdown): Promise<Record<string, string>> {
  const all: (Omit<Job, 't'> & { t?: number })[] = [
    ...b.characters.map(c => ({ id: c.id, t: c.best, box: c.box, shape: 'face' as const })),
    ...(b.things ?? []).map(x => ({ id: x.id, t: x.best, box: x.box, shape: 'thing' as const })),
    ...(b.places ?? []).map(x => ({ id: x.id, t: x.best, shape: 'place' as const })),
  ]
  const jobs = all.filter((j): j is Job => j.t != null)
  const frames = new Map<string, Promise<Buffer | null>>()
  const out: Record<string, string> = {}
  for (const job of jobs) {
    const at = offset + job.t
    const key = at.toFixed(1)
    if (!frames.has(key)) frames.set(key, frameAt(ffmpeg, file, at))
    const frame = await frames.get(key)!
    if (!frame) continue
    try {
      const { width: W = 0, height: H = 0 } = await sharp(frame).metadata()
      if (!W || !H) continue
      const size = job.shape === 'place' ? { width: 240, height: 160 } : { width: 160, height: 160 }
      const jpg = await sharp(frame).extract(region(W, H, job)).resize({ ...size, fit: 'cover' }).jpeg({ quality: 72 }).toBuffer()
      out[job.id] = `data:image/jpeg;base64,${jpg.toString('base64')}`
    } catch { /* this card goes without a picture */ }
  }
  return out
}
