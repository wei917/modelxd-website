// lib/audio-normalize.ts
//
// Browser-side audio normalization for audio-driven VIDEO generation
// (owner, Aug 26: "I cannot attach audio file. m4a or mp4 files").
//
// Wan 3.0's reference_audio accepts ONLY wav/mp3 and at most 15 seconds —
// both hard upstream rejections, probed live. Users' libraries are m4a.
// Rather than bounce the file at the picker, decode ANYTHING the browser
// can read (m4a/aac/mp4/ogg/…) with WebAudio and re-encode a 16-bit PCM
// WAV, trimming to the cap. An mp3/wav already inside the limit passes
// through untouched (mp3 stays small; no pointless transcode).
//
// This is deliberately the same primitive the XDirect SYNC plan needs
// ("client WebAudio slicing") — scene slicing later reuses it with
// explicit from/to instead of 0..max.
//
// Client-only: uses AudioContext. Callers live in 'use client' components.

export interface NormalizedAudio {
  file: File
  /** True when the source was longer than maxSeconds and got cut. */
  trimmed: boolean
  durationSeconds: number
}

/** Decode + (re)encode `file` so video models accept it. Returns null when
 *  the browser can't decode the file at all — caller keeps the original
 *  and lets the provider report. */
export async function normalizeAudioForVideo(file: File, maxSeconds = 15): Promise<NormalizedAudio | null> {
  let buf: AudioBuffer
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
  try {
    buf = await ctx.decodeAudioData(await file.arrayBuffer())
  } catch {
    return null
  } finally {
    ctx.close().catch(() => {})
  }

  const duration = buf.duration
  const type = (file.type || '').toLowerCase()
  const ext  = (file.name.split('.').pop() ?? '').toLowerCase()
  const alreadyAccepted = type === 'audio/mpeg' || type === 'audio/wav' || ext === 'mp3' || ext === 'wav'
  if (alreadyAccepted && duration <= maxSeconds + 0.05) {
    return { file, trimmed: false, durationSeconds: duration }
  }

  const channels = Math.min(2, buf.numberOfChannels)
  const frames   = Math.min(buf.length, Math.floor(maxSeconds * buf.sampleRate))
  const wav      = encodeWavPcm16(buf, channels, frames)
  const base     = file.name.replace(/\.[^.]+$/, '')
  return {
    file: new File([wav], `${base}.wav`, { type: 'audio/wav' }),
    trimmed: frames < buf.length,
    durationSeconds: frames / buf.sampleRate,
  }
}

function encodeWavPcm16(buf: AudioBuffer, channels: number, frames: number): ArrayBuffer {
  const sampleRate = buf.sampleRate
  const bytesPerFrame = channels * 2
  const dataSize = frames * bytesPerFrame
  const out = new ArrayBuffer(44 + dataSize)
  const v = new DataView(out)
  const writeStr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)) }

  writeStr(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true); writeStr(8, 'WAVE')
  writeStr(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true)
  v.setUint16(22, channels, true); v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * bytesPerFrame, true); v.setUint16(32, bytesPerFrame, true)
  v.setUint16(34, 16, true); writeStr(36, 'data'); v.setUint32(40, dataSize, true)

  const chans: Float32Array[] = []
  for (let c = 0; c < channels; c++) chans.push(buf.getChannelData(c))
  let off = 44
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]))
      v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      off += 2
    }
  }
  return out
}
