// lib/platform-video.ts: re-encode a video to a platform's upload spec
// (server-only; ffmpeg-static, the same binary XCut renders with). The rules
// are VIDEO_SPECS in lib/platform-specs.ts.
//
// The frame is filled by scaling and cropping from the centre, never with
// bars (蝦皮 rejects black or white edges). Out comes MP4: H.264 High 4:2:0
// at 30 fps (Instagram asks for 30+), AAC when the clip has sound, the index
// at the front and no edit lists (YouTube's advice), cut to the platform's
// length cap. A clip over the byte cap is encoded once more, smaller. Each
// rule is reported as a check, a miss included; a clip under a minimum
// length (蝦皮's 10 s) is reported, never padded or looped.

import fs from 'node:fs/promises'
import { ffmpegPath, probe, run } from './xcut-render'
import type { ExportCheck, VideoSpec } from './platform-specs'

export async function exportVideoToSpec(inFile: string, outFile: string, spec: VideoSpec): Promise<{
  seconds: number; bytes: number; checks: ExportCheck[]
}> {
  const bin = ffmpegPath()
  const src = await probe(bin, inFile)
  const seconds = Math.min(src.duration || spec.maxSec, spec.maxSec)

  const encode = (crf: number) => run(bin, [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-i', inFile, '-t', seconds.toFixed(3),
    '-vf', `scale=${spec.w}:${spec.h}:force_original_aspect_ratio=increase,crop=${spec.w}:${spec.h},setsar=1,fps=30,format=yuv420p`,
    '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'veryfast', '-crf', String(crf),
    '-maxrate', '10M', '-bufsize', '20M',
    ...(src.hasAudio ? ['-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2'] : ['-an']),
    '-movflags', '+faststart', '-use_editlist', '0',
    outFile,
  ], 12 * 60_000)

  await encode(21)
  let bytes = (await fs.stat(outFile)).size
  if (bytes > spec.maxBytes) { await encode(28); bytes = (await fs.stat(outFile)).size }

  const out = await probe(bin, outFile)
  // The written frame size, read back from ffmpeg's banner (no ffprobe here).
  let banner = ''
  try { await run(bin, ['-hide_banner', '-i', outFile], 20_000) } catch (e: any) { banner = String(e?.message ?? '') }
  const dim = /Video:.*?, (\d{2,5})x(\d{2,5})[\s,\[]/.exec(banner)
  const [ow, oh] = dim ? [Number(dim[1]), Number(dim[2])] : [0, 0]
  const checks: ExportCheck[] = [
    { key: 'size', ok: ow === spec.w && oh === spec.h, value: `${ow}×${oh}` },
    { key: 'format', ok: true, value: src.hasAudio ? 'MP4 · H.264 · AAC' : 'MP4 · H.264' },
    { key: 'duration', ok: out.duration > 0 && (!spec.minSec || out.duration >= spec.minSec - 0.05) && out.duration <= spec.maxSec + 0.05, value: `${out.duration.toFixed(1)} s` },
    { key: 'bytes', ok: bytes <= spec.maxBytes, value: bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.round(bytes / 1000)} KB` },
  ]
  return { seconds: out.duration, bytes, checks }
}
