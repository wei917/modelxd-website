// lib/remake/engine/edit.ts: 同款 phase 2, the cut. Every clip is cut to its
// shot's length and joined with the original's transitions; the on-screen
// text is drawn in code (bundled Noto Sans TC, so Chinese and Japanese show);
// the voices are laid in at their times over the clips' own sound; loudness
// is one static gain to -16 LUFS plus a limiter (one-pass loudnorm flattens
// quiet scenes: the boxing test's lesson).

import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { Aspect } from './produce'
import type { PlanShot } from './plan'

const run = promisify(execFile)
const SIZE: Record<Aspect, [number, number]> = { '16:9': [1280, 720], '9:16': [720, 1280], '4:3': [960, 720], '3:4': [720, 960], '1:1': [720, 720] }
const AF = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo'

/** xfade's name and length for a transition word from the breakdown. */
function transition(word: string, a: number, b: number): { name: string; d: number } | null {
  const w = word.toLowerCase()
  const cap = Math.max(0.1, Math.min(0.3, a / 2, b / 2))
  if (w.includes('dissolve')) return { name: 'fade', d: cap }
  if (w.includes('black')) return { name: 'fadeblack', d: cap }
  if (w.includes('white') || w.includes('flash')) return { name: 'fadewhite', d: Math.min(cap, 0.2) }
  if (w.includes('wipe')) return { name: 'wipeleft', d: cap }
  if (w.includes('whip')) return { name: 'slideleft', d: Math.min(cap, 0.2) }
  return null
}

async function hasAudio(ffmpeg: string, file: string): Promise<boolean> {
  try { await run(ffmpeg, ['-hide_banner', '-i', file]) } catch (e: any) { return /Audio:/.test(String(e?.stderr ?? '')) }
  return false
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\u2019").replace(/:/g, '\\:').replace(/%/g, '\\%')

export async function assemble(opts: {
  ffmpeg: string
  font: string
  aspect: Aspect
  shots: PlanShot[]
  /** One clip file per shot, in order. */
  clips: string[]
  voices: { path: string; t: number }[]
  out: string
}): Promise<{ seconds: number }> {
  const { ffmpeg, font, aspect, shots, clips, voices, out } = opts
  const [W, H] = SIZE[aspect]
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'remake-edit-'))
  try {
    const L: string[] = []
    const inputs: string[] = []
    // Shot segments.
    for (let i = 0; i < shots.length; i++) {
      const s = shots[i], len = Math.max(0.1, s.t1 - s.t0)
      inputs.push('-i', clips[i])
      let v = `[${i}:v]trim=0:${len.toFixed(3)},setpts=PTS-STARTPTS,fps=30,scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,format=yuv420p`
      if (s.text.trim()) {
        const tf = path.join(dir, `t${i}.txt`)
        await fs.writeFile(tf, s.text.trim().slice(0, 60))
        v += `,drawtext=fontfile='${esc(font)}':textfile='${esc(tf)}':x=(w-tw)/2:y=h-th-${Math.round(H * 0.08)}:fontsize=${Math.round(H * 0.055)}:fontcolor=white:borderw=${Math.max(2, Math.round(H * 0.005))}:bordercolor=black@0.85`
      }
      L.push(`${v}[v${i}]`)
      L.push(await hasAudio(ffmpeg, clips[i])
        ? `[${i}:a]atrim=0:${len.toFixed(3)},asetpts=PTS-STARTPTS,${AF},volume=0.7[a${i}]`
        : `anullsrc=r=48000:cl=stereo,atrim=0:${len.toFixed(3)},${AF}[a${i}]`)
    }
    // Join, shot by shot: a cut is a concat, anything else an xfade.
    let accV = 'v0', accA = 'a0', accLen = Math.max(0.1, shots[0].t1 - shots[0].t0)
    for (let i = 1; i < shots.length; i++) {
      const len = Math.max(0.1, shots[i].t1 - shots[i].t0)
      const tr = transition(shots[i].transition_in, accLen, len)
      if (tr) {
        L.push(`[${accV}][v${i}]xfade=transition=${tr.name}:duration=${tr.d.toFixed(3)}:offset=${(accLen - tr.d).toFixed(3)}[jv${i}]`)
        L.push(`[${accA}][a${i}]acrossfade=d=${tr.d.toFixed(3)}[ja${i}]`)
        accLen += len - tr.d
      } else {
        L.push(`[${accV}][${accA}][v${i}][a${i}]concat=n=2:v=1:a=1[jv${i}][ja${i}]`)
        accLen += len
      }
      accV = `jv${i}`; accA = `ja${i}`
    }
    // Voices over the clips' own sound.
    const mix = [`[${accA}]`]
    voices.forEach((vo, k) => {
      const n = shots.length + k
      inputs.push('-i', vo.path)
      const ms = Math.max(0, Math.round(vo.t * 1000))
      L.push(`[${n}:a]${AF},adelay=${ms}|${ms},apad[vo${k}]`)
      mix.push(`[vo${k}]`)
    })
    L.push(`${mix.join('')}amix=inputs=${mix.length}:normalize=0:duration=first,${AF}[amix]`)
    const graph = path.join(dir, 'graph.txt')
    await fs.writeFile(graph, L.join(';\n'))
    const raw = path.join(dir, 'raw.mov')
    await run(ffmpeg, ['-v', 'error', '-y', ...inputs, '-filter_complex_script', graph, '-map', `[${accV}]`, '-map', '[amix]',
      '-c:v', 'libx264', '-crf', '19', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'pcm_s16le', raw], { maxBuffer: 64 * 1024 * 1024 })
    // One static gain to -16 LUFS.
    let report = ''
    try { report = String((await run(ffmpeg, ['-hide_banner', '-i', raw, '-vn', '-af', 'ebur128', '-f', 'null', '-'], { maxBuffer: 64 * 1024 * 1024 })).stderr) }
    catch (e: any) { report = String(e?.stderr ?? '') }
    const m = report.match(/Integrated loudness:\s*\n\s*I:\s*(-?[\d.]+) LUFS/)
    const gain = m ? Math.max(-20, Math.min(20, -16 - Number(m[1]))) : 0
    await run(ffmpeg, ['-v', 'error', '-y', '-i', raw, '-c:v', 'copy', '-af', `volume=${gain.toFixed(2)}dB,alimiter=limit=0.84:level=false,${AF}`,
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out])
    return { seconds: Math.round(accLen * 10) / 10 }
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}
