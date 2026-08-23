// scripts/test-xcut-render.ts — render a small timeline from LOCAL files with
// the local ffmpeg, then verify the output. No network, no DB.
//   npx tsx scripts/test-xcut-render.ts <video.mp4> <image.png> [music.m4a]
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { emptyTimeline, renderPlan, toAss } from '../lib/xcut-timeline'
import { ffmpegPath, run, probe, buildFfmpegArgs, bundledFont, type Local } from '../lib/xcut-render'

async function main() {
  const [video, image, music] = process.argv.slice(2)
  if (!video || !image) throw new Error('usage: <video.mp4> <image.png> [music]')
  const bin = ffmpegPath()
  const src = (p: string, mt: string) => ({ bucket: 'local', path: p, mediaType: mt })
  const tl = emptyTimeline('16:9')
  tl.settings = { resolution: '720p', muteClips: false, dissolve: 0.5, burnSubtitles: true }
  tl.video = [
    { id: 'c1', kind: 'video', src: src(video, 'video/mp4'), in: 0, out: 4, transition: 'cut', label: 'S1 open' },
    { id: 'c2', kind: 'image', src: src(image, 'image/png'), in: 0, out: 3, transition: 'dissolve', label: 'still' },
    { id: 'c3', kind: 'video', src: src(video, 'video/mp4'), in: 2, out: 6, transition: 'cut', label: 'S1 tail', gain: 0.8 },
  ]
  if (music) tl.audio = [{ id: 'm1', src: src(music, 'audio/mp4'), start: 1, in: 0, out: 5, gain: 0.6, fadeIn: 0.5, fadeOut: 1 }]
  tl.subtitles = [{ id: 's1', start: 0.5, end: 3.5, text: '石猴悟空稱王，習得長生變化之術，最終大鬧天宮，自稱齊天大聖，驚動了凌霄寶殿上的玉皇大帝。' }]
  const plan = renderPlan(tl)
  const expected = 4 + 3 + 4 - 0.5
  console.log(`plan: ${plan.segments.length} segments, ${plan.width}x${plan.height}@${plan.fps}, duration ${plan.duration} (expected ${expected})`)

  const locals: Local[] = []
  for (const seg of plan.segments) {
    const file = seg.kind === 'video' ? video : image
    const p = seg.kind === 'video' ? await probe(bin, file) : { hasAudio: false, duration: 0 }
    locals.push({ seg, file, hasAudio: p.hasAudio })
  }
  console.log('probe: clip has audio =', locals[0].hasAudio)
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'xcut-test-'))
  const font = await bundledFont()
  let srt: string | null = null
  if (font) { srt = path.join(work, 'subs.ass'); await fs.writeFile(srt, toAss(plan.subtitles, plan.width, plan.height, font)) }
  console.log('font:', font ?? '(none — subtitles skipped)')
  const out = path.join(work, 'film.mp4')
  const args = buildFfmpegArgs(plan, locals, music ? [{ a: plan.audio[0], file: music }] : [], srt, font, out)
  const t0 = Date.now()
  await run(bin, args, 120_000)
  const secs = ((Date.now() - t0) / 1000).toFixed(1)
  const info = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height:format=duration,size', '-of', 'json', out]).toString()
  const j = JSON.parse(info)
  const dur = Number(j.format.duration)
  const v = j.streams.find((s: any) => s.codec_type === 'video'), a = j.streams.find((s: any) => s.codec_type === 'audio')
  console.log(`output: ${v?.codec_name} ${v?.width}x${v?.height}, audio ${a?.codec_name ?? 'NONE'}, ${dur.toFixed(2)}s, ${(Number(j.format.size) / 1e6).toFixed(2)} MB, rendered in ${secs}s → ${out}`)
  const ok = v && a && Math.abs(dur - expected) < 0.35
  console.log(ok ? 'RENDER OK' : 'RENDER MISMATCH')
  process.exit(ok ? 0 : 1)
}
main().catch(e => { console.error('FAILED:', e?.message ?? e); process.exit(1) })
