// lib/fan-template/cut.ts: the 風扇變裝 template's finish (Oct 18; t4's
// finish, made automatic). The opening is the roll until she has settled and
// the remote clip joined; a model looks at the frames to find when the person
// presses the remote (the fan starts there) and where they lie (the hub goes
// over them); then the fan is drawn over the takes (fan.ts), and each take's own
// sound goes under it. No words on the video (owner, Oct 18).

import { promises as fs } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { streamText } from '@/lib/providers'
import type { ModelInfo } from '@/lib/providers/types'
import { run } from '@/lib/remake/store'
import { TIMING } from './recipe'

/** A text model's JSON answer about some pictures (a model's job: no vision
 *  library here; owner, Oct 6). */
async function askPictures(model: ModelInfo, prompt: string, pictures: Buffer[], userId: string | null): Promise<{ json: any; cost: number }> {
  let text = '', cost = 0
  await new Promise<void>((resolve, reject) => {
    streamText(model, [{ role: 'user', content: prompt }],
      { onDelta: d => { text += d }, onDone: r => { cost = r.cost; resolve() }, onError: m => reject(new Error(m)) },
      pictures.map(b => ({ buffer: b, mediaType: 'image/jpeg' }) as any), { userId, surface: 'xcreate-fan' } as any)
  })
  try { return { json: JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)), cost } }
  catch { return { json: null, cost } }
}

/** Frames of a clip at the given seconds, as JPEGs. */
export async function framesAt(ff: string, clip: string, seconds: number[]): Promise<Buffer[]> {
  const dir = await fs.mkdtemp(path.join(path.dirname(clip), 'frames-'))
  try {
    const out: Buffer[] = []
    for (const [i, t] of seconds.entries()) {
      const f = path.join(dir, `f${i}.jpg`)
      await run(ff, ['-v', 'error', '-y', '-ss', t.toFixed(2), '-i', clip, '-frames:v', '1', '-vf', 'scale=360:-2', '-q:v', '4', f])
      out.push(await fs.readFile(f))
    }
    return out
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
}

/** When her thumb presses the remote, in the remote clip's seconds. */
export async function pressTime(model: ModelInfo, ff: string, clip: string, userId: string | null, fallback: number): Promise<{ t: number; cost: number }> {
  const times = Array.from({ length: 13 }, (_, i) => Math.round((0.5 + i * 0.3) * 10) / 10)
  const frames = await framesAt(ff, clip, times)
  const { json, cost } = await askPictures(model, `These ${frames.length} pictures are frames of one top-down clip of a person lying on a mat, taken at these seconds, in order: ${times.join(', ')}. The person picks up a small remote and presses its button once with their thumb while holding it up toward the camera. At which of these seconds is the button pressed (the remote raised highest, thumb on the button)? Return JSON only: {"t": number}`, frames, userId)
  const t = Number(json?.t)
  return { t: Number.isFinite(t) && t >= 0.5 && t <= 4.5 ? t : fallback, cost }
}

/** Whether the fall rolls over (owner, Oct 18: "why she didn't roll over her
 *  body?"; a take pinned to the same pictures slid off on its side instead).
 *  Asked as whether the face is hidden in some frame, face down with only the
 *  back of the head showing: asked whether her back faces the camera, the
 *  model also said yes for a body lying on its side (tested on four takes:
 *  only the one that slid kept its face in view in all nine frames). A check
 *  that cannot read the answer passes, so a hiccup never costs a take. */
export async function rolledOver(model: ModelInfo, ff: string, clip: string, userId: string | null): Promise<{ ok: boolean; cost: number }> {
  const times = [0.6, 0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0, 2.2]
  const frames = await framesAt(ff, clip, times)
  const { json, cost } = await askPictures(model, `These ${frames.length} pictures are frames of one top-down clip, in order, at these seconds: ${times.join(', ')}. A person rolls off a sofa onto the rug. For EACH frame: can you see any part of the person's FACE (eyes, nose, mouth; a side profile counts as visible), or is the face hidden because they are face down and you see only the back of the head and hair? Return JSON only: {"face_visible": [true or false, ...]}`, frames, userId)
  const seen: unknown[] = Array.isArray(json?.face_visible) ? json.face_visible : []
  return { ok: seen.length !== frames.length || seen.some(v => v === false), cost }
}

/** Whether a maker drew a ceiling fan into a picture. The fan is ours, drawn
 *  over the video later, so a drawn one shows under it (Oct 21: Qwen put part
 *  of a fan in a corner of a 2D outfit picture though the words said no fan).
 *  A check that cannot read the answer passes. */
export async function fanDrawn(model: ModelInfo, picture: Buffer, userId: string | null): Promise<{ fan: boolean; cost: number }> {
  const small = await sharp(picture).resize(576, 1024, { fit: 'inside' }).jpeg({ quality: 85 }).toBuffer()
  const { json, cost } = await askPictures(model, 'This is a top-down picture of a floor: a sofa, a rug or mat, perhaps a person lying down and a small remote control. Is any part of a CEILING FAN drawn anywhere in it, the corners and edges included: a fan blade, a fan hub or motor, a fan mount or rod? The remote control, furniture, carvings, rug patterns and shadows are not a fan. Return JSON only: {"fan": true or false}', [small], userId)
  return { fan: json?.fan === true, cost }
}

/** When the fall has settled, in the roll's seconds: the first moment from
 *  which every frame stays within a few grey levels of the last one (the
 *  remote clip starts from that last frame, so the join is clean), never
 *  before `from`. A take that settled late was cut mid-move at a fixed 3.0 s
 *  and the join jumped (Oct 18: that take settled at 3.4 s, v6's at 2.8 s).
 *  Plain sums over a 72x128 grey copy, no vision library. */
export async function settledAt(ff: string, clip: string, from: number): Promise<number> {
  const w = 72, h = 128, n = w * h, fps = 10, still = 4
  const { stdout } = await run(ff, ['-v', 'error', '-ss', from.toFixed(2), '-i', clip, '-vf', `fps=${fps},scale=${w}:${h},format=gray`, '-f', 'rawvideo', '-'],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }) as unknown as { stdout: Buffer }
  const frames = Math.floor(stdout.length / n)
  if (frames < 2) return from
  const last = stdout.subarray((frames - 1) * n, frames * n)
  let settled = frames - 1
  for (let k = frames - 2; k >= 0; k--) {
    let sum = 0
    for (let i = 0, o = k * n; i < n; i++) sum += Math.abs(stdout[o + i] - last[i])
    if (sum / n > still) break
    settled = k
  }
  return Math.round((from + settled / fps) * 10) / 10
}

/** How far across the frame she lies, left to right (0-1), over the
 *  outfit pictures: the hub goes above the middle and the blade just wider.
 *  An arm stretched away from her body is left out (test run, Oct 18: the
 *  creator's last pose made the blade 58% of the frame, wider than t4's 47%
 *  the owner liked; the change line is the blade's middle, so a narrower
 *  blade never shows it). */
export async function personSpan(model: ModelInfo, pictures: Buffer[], userId: string | null): Promise<{ x0: number; x1: number; cost: number }> {
  if (!pictures.length) return { x0: 0.3, x1: 0.7, cost: 0 }
  const { json, cost } = await askPictures(model, `These ${pictures.length} pictures are the same top-down shot of one person lying down, in different clothes. For each picture give the box around their body: head, hair, torso, legs and shoes, and arms that lie along the body; leave out an arm or hand stretched away from the body. [ymin, xmin, ymax, xmax] on a 0-1000 scale. Return JSON only: {"boxes": [[ymin, xmin, ymax, xmax], ...]}`, pictures, userId)
  const boxes: number[][] = (json?.boxes ?? []).filter((b: any) => Array.isArray(b) && b.length === 4 && b.every((x: any) => Number.isFinite(Number(x))))
  if (!boxes.length) return { x0: 0.3, x1: 0.7, cost }
  return { x0: Math.min(...boxes.map(b => Number(b[1]))) / 1000, x1: Math.max(...boxes.map(b => Number(b[3]))) / 1000, cost }
}

/** The opening: the roll until she has settled (settledAt), then the remote
 *  clip from just before her hand moves (t4's cut), faded into each other
 *  over TIMING.blend while she lies still: the remote clip's first frames
 *  drift in tone from the picture they start on, and a hard cut showed it
 *  (Oct 18). The remote clip starts at rollEnd - blend in the opening. */
export async function joinOpening(ff: string, roll: string, remote: string, out: string, rollEnd: number) {
  const { remoteFrom, blend } = TIMING
  const v = 'fps=30,scale=720:1280,setsar=1,format=yuv420p'
  const a = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo'
  await run(ff, ['-v', 'error', '-y', '-i', roll, '-i', remote, '-filter_complex',
    `[0:v]trim=0:${rollEnd},setpts=PTS-STARTPTS,${v}[v0];[1:v]trim=${remoteFrom},setpts=PTS-STARTPTS,${v}[v1];` +
    `[0:a]atrim=0:${rollEnd},asetpts=PTS-STARTPTS,${a}[a0];[1:a]atrim=${remoteFrom},asetpts=PTS-STARTPTS,${a}[a1];` +
    `[v0][v1]xfade=transition=fade:duration=${blend}:offset=${(rollEnd - blend).toFixed(3)}[v];[a0][a1]acrossfade=d=${blend}[a]`,
    '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', '-c:a', 'aac', out], { maxBuffer: 32 * 1024 * 1024 })
}

/** Each take's own room sound while its outfit is on screen, joined at the
 *  changes, under the drawn fan. No captions (owner, Oct 18: "we don't add
 *  captions. users can use their own app to do that"), so the picture is
 *  copied as it is. */
export async function finishOverlay(ff: string, video: string, clips: string[], bounds: number[], takeStart: number[], out: string) {
  const dir = path.dirname(out)
  const inputs: string[] = []
  const parts: string[] = []
  for (let k = 0; k < clips.length; k++) {
    inputs.push('-i', clips[k])
    const len = bounds[k + 1] - bounds[k] + (k < clips.length - 1 ? TIMING.overlap : 0)
    const from = bounds[k] - takeStart[k]
    parts.push(`[${k}:a]atrim=${from.toFixed(2)}:${(from + len).toFixed(2)},asetpts=PTS-STARTPTS,apad=whole_dur=${len.toFixed(2)},aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a${k}]`)
  }
  let acc = 'a0'
  for (let k = 1; k < clips.length; k++) { parts.push(`[${acc}][a${k}]acrossfade=d=${TIMING.overlap}[x${k}]`); acc = `x${k}` }
  const sound = path.join(dir, 'sound.m4a')
  await run(ff, ['-v', 'error', '-y', ...inputs, '-filter_complex', parts.join(';'), '-map', `[${acc}]`, '-c:a', 'aac', '-b:a', '160k', sound], { maxBuffer: 32 * 1024 * 1024 })
  await run(ff, ['-v', 'error', '-y', '-i', video, '-i', sound, '-map', '0:v', '-map', '1:a', '-c', 'copy', '-movflags', '+faststart', out], { maxBuffer: 32 * 1024 * 1024 })
}
