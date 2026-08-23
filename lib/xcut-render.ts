// lib/xcut-render.ts — the ffmpeg side of XCut's export, kept out of the
// route so scripts/test-xcut-render.ts can run it on local files with the
// local ffmpeg: stream probing (ffmpeg-static ships no ffprobe), the filter
// graph (normalise → trim → concat / xfade → clip sound or silence → music
// with fades → burned subtitles), and the bundled-font lookup.

import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import type { RenderPlan } from './xcut-timeline'

export const FONT_DIR = path.join(process.cwd(), 'public', 'fonts')

export function ffmpegPath(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const p = require('ffmpeg-static') as string | null
  if (!p) throw new Error('ffmpeg binary not available')
  return p
}

export function run(bin: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${err.message}\n${String(stderr).slice(-1500)}`))
      else resolve({ stdout: String(stdout), stderr: String(stderr) })
    })
  })
}

/** Stream facts from ffmpeg's own banner (no ffprobe in ffmpeg-static). */
export async function probe(bin: string, file: string): Promise<{ hasAudio: boolean; duration: number }> {
  let text = ''
  try { await run(bin, ['-hide_banner', '-i', file], 20_000) } catch (e: any) { text = String(e?.message ?? '') }
  const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text)
  const duration = d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0
  return { hasAudio: /Stream #\d+:\d+.*Audio:/.test(text), duration }
}

// ── The ffmpeg graph ───────────────────────────────────────────────────────
export type Local = { seg: RenderPlan['segments'][number]; file: string; hasAudio: boolean }

export function buildFfmpegArgs(plan: RenderPlan, locals: Local[], music: Array<{ a: RenderPlan['audio'][number]; file: string }>, srt: string | null, fontName: string | null, out: string): string[] {
  const { width: W, height: H, fps } = plan
  const args: string[] = ['-hide_banner', '-loglevel', 'error', '-nostdin']
  const f: string[] = []
  let idx = 0
  const vLabels: string[] = [], aLabels: string[] = []

  locals.forEach(({ seg, file, hasAudio }, i) => {
    if (seg.kind === 'video') args.push('-ss', seg.in.toFixed(3), '-t', seg.length.toFixed(3), '-i', file)
    else args.push('-loop', '1', '-framerate', String(fps), '-t', seg.length.toFixed(3), '-i', file)
    const vi = idx++
    f.push(`[${vi}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps},format=yuv420p,setpts=PTS-STARTPTS,trim=0:${seg.length.toFixed(3)}[v${i}]`)
    if (seg.kind === 'video' && hasAudio && !seg.mute) {
      f.push(`[${vi}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${seg.gain.toFixed(3)},asetpts=PTS-STARTPTS,apad,atrim=0:${seg.length.toFixed(3)}[a${i}]`)
    } else {
      args.push('-f', 'lavfi', '-t', seg.length.toFixed(3), '-i', 'anullsrc=r=48000:cl=stereo')
      const ai = idx++
      f.push(`[${ai}:a]atrim=0:${seg.length.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`)
    }
    vLabels.push(`[v${i}]`); aLabels.push(`[a${i}]`)
  })

  // Runs of hard-cut segments → concat; runs joined by dissolves → xfade.
  const runs: Array<{ members: number[]; length: number; dissolveIn: number }> = []
  locals.forEach(({ seg }, i) => {
    if (i === 0 || seg.dissolveIn <= 0) {
      if (i === 0) runs.push({ members: [i], length: seg.length, dissolveIn: 0 })
      else { const r = runs[runs.length - 1]; r.members.push(i); r.length += seg.length }
    } else runs.push({ members: [i], length: seg.length, dissolveIn: seg.dissolveIn })
  })
  // xfade / acrossfade insist on matching timebases and formats; a concat
  // output and a lone clip differ (1/1000000 vs 1/fps) — normalise every run.
  runs.forEach((r, j) => {
    if (r.members.length === 1) { f.push(`${vLabels[r.members[0]]}settb=AVTB,fps=${fps}[rv${j}]`); f.push(`${aLabels[r.members[0]]}aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[ra${j}]`) }
    else {
      const ins = r.members.map(i => `${vLabels[i]}${aLabels[i]}`).join('')
      f.push(`${ins}concat=n=${r.members.length}:v=1:a=1[cv${j}][ca${j}]`)
      f.push(`[cv${j}]settb=AVTB,fps=${fps}[rv${j}]`)
      f.push(`[ca${j}]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[ra${j}]`)
    }
  })
  let vCur = '[rv0]', aCur = '[ra0]', elapsed = runs[0].length
  for (let j = 1; j < runs.length; j++) {
    const d = runs[j].dissolveIn
    const offset = Math.max(0, elapsed - d)
    f.push(`${vCur}[rv${j}]xfade=transition=fade:duration=${d.toFixed(3)}:offset=${offset.toFixed(3)}[xv${j}]`)
    f.push(`${aCur}[ra${j}]acrossfade=d=${d.toFixed(3)}:c1=tri:c2=tri[xa${j}]`)
    vCur = `[xv${j}]`; aCur = `[xa${j}]`
    elapsed = elapsed - d + runs[j].length
  }
  const videoLen = elapsed

  // Music track over the film's own sound.
  const mLabels: string[] = []
  music.forEach(({ a, file }, j) => {
    const len = a.out - a.in
    args.push('-ss', a.in.toFixed(3), '-t', len.toFixed(3), '-i', file)
    const mi = idx++
    const chain = [`aresample=48000`, `aformat=sample_fmts=fltp:channel_layouts=stereo`, `volume=${a.gain.toFixed(3)}`]
    if (a.fadeIn > 0) chain.push(`afade=t=in:st=0:d=${a.fadeIn.toFixed(3)}`)
    if (a.fadeOut > 0) chain.push(`afade=t=out:st=${Math.max(0, len - a.fadeOut).toFixed(3)}:d=${a.fadeOut.toFixed(3)}`)
    const ms = Math.round(a.start * 1000)
    chain.push(`adelay=${ms}|${ms}`)
    f.push(`[${mi}:a]${chain.join(',')}[m${j}]`)
    mLabels.push(`[m${j}]`)
  })
  let aFinal = aCur
  if (mLabels.length > 0) {
    f.push(`${aCur}${mLabels.join('')}amix=inputs=${mLabels.length + 1}:duration=first:dropout_transition=0:normalize=0[amix]`)
    aFinal = '[amix]'
  }

  // Subtitles, burned in from a pre-wrapped ASS file (only with a bundled
  // font — see FONT_DIR and lib/xcut-timeline.ts toAss()).
  let vFinal = vCur
  if (srt && fontName) {
    f.push(`${vCur}subtitles='${srt.replace(/'/g, "\\'")}':fontsdir='${FONT_DIR}'[vsub]`)
    vFinal = '[vsub]'
  }

  args.push('-filter_complex', f.join(';'), '-map', vFinal, '-map', aFinal,
    // crf 22 + a rate ceiling keeps a 1080p minute around 35-45 MB (the ai-videos bucket allows 500 MB).
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-maxrate', H >= 1080 ? '6M' : '3M', '-bufsize', H >= 1080 ? '12M' : '6M', '-pix_fmt', 'yuv420p', '-r', String(fps),
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', '-t', videoLen.toFixed(3), '-y', out)
  return args
}

export async function bundledFont(): Promise<string | null> {
  try {
    const files = (await fs.readdir(FONT_DIR)).filter(n => /\.(ttf|otf)$/i.test(n))
    // The family name ffmpeg/libass resolves: we ship Noto Sans TC first.
    if (files.some(n => /NotoSansTC|NotoSansCJK/i.test(n))) return 'Noto Sans TC'
    return files.length > 0 ? files[0].replace(/\.(ttf|otf)$/i, '').replace(/[-_]/g, ' ') : null
  } catch { return null }
}

