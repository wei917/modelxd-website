// lib/fan-template/cut.ts: the 風扇變裝 template's finish (Oct 18; t4's
// finish, made automatic). The opening is the roll's first seconds and the
// remote clip joined; a model looks at the frames to find when she presses
// the remote (the fan starts there) and how wide she lies (the blade is just
// wider); then the fan is drawn over the takes (fan.ts), and each take's own
// sound and the captions go on top.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { streamText } from '@/lib/providers'
import type { ModelInfo } from '@/lib/providers/types'
import { captionFilters, fitCaption } from '@/lib/caption-text'
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

/** The opening: the roll until she has landed, then the remote clip from
 *  just before her hand moves (t4's cut). */
export async function joinOpening(ff: string, roll: string, remote: string, out: string) {
  const { rollEnd, remoteFrom } = TIMING
  await run(ff, ['-v', 'error', '-y', '-i', roll, '-i', remote, '-filter_complex',
    `[0:v]trim=0:${rollEnd},setpts=PTS-STARTPTS,fps=30,scale=720:1280,setsar=1[v0];[1:v]trim=${remoteFrom},setpts=PTS-STARTPTS,fps=30,scale=720:1280,setsar=1[v1];` +
    `[0:a]atrim=0:${rollEnd},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo[a0];[1:a]atrim=${remoteFrom},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo[a1];` +
    '[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]',
    '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', '-c:a', 'aac', out], { maxBuffer: 32 * 1024 * 1024 })
}

/** Each take's own room sound while its outfit is on screen, joined at the
 *  changes; the captions on top (the title at the top, the outfit at the
 *  bottom), switching under the blade with half-open windows so two
 *  captions never share a frame. A caption takes the font that has its
 *  letters and wraps to fit the 720 px frame (lib/caption-text.ts). */
export async function finishOverlay(ff: string, video: string, clips: string[], bounds: number[], takeStart: number[], texts: string[], lang: string, out: string) {
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
  const draws: string[] = []
  for (let k = 0; k < texts.length; k++) {
    const lines = String(texts[k] ?? '').split('\n').map(x => x.trim()).filter(Boolean)
    const style = `fontcolor=white:borderw=3:bordercolor=black@0.7:enable='gte(t,${bounds[k].toFixed(3)})*lt(t,${bounds[k + 1].toFixed(3)})'`
    const [top, bottom] = lines.length > 1 ? lines : [null, lines[0]]
    // The title's first line starts 150 px down; the outfit's last line ends
    // about 110 px above the bottom, its first lines stacked above it.
    const t = top ? fitCaption(top.slice(0, 60), lang, 648, 40, 26) : null
    if (t) draws.push(...await captionFilters(t, dir, `cap-${k}-t`, 150 + Math.round(t.size * 0.88), 'top', style))
    const b = bottom ? fitCaption(bottom.slice(0, 60), lang, 648, 44, 28) : null
    if (b) draws.push(...await captionFilters(b, dir, `cap-${k}-b`, 1169, 'bottom', style))
  }
  await run(ff, ['-v', 'error', '-y', '-i', video, '-i', sound, ...(draws.length ? ['-vf', draws.join(',')] : []), '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', out], { maxBuffer: 32 * 1024 * 1024 })
}
