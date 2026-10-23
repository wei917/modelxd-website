// lib/music-options.ts
//
// The 音樂 settings (Oct 22; owner: "add all config options"), shared by
// X創作's ⚙ panel and the music providers. Client-safe: no server imports.
//
// A music row declares what it takes in output_config.audio:
//   durations     song lengths in seconds. The FIRST is the default (the
//                 panel shows them shortest first), so a deployment that
//                 reads only [0] still opens on the right length.
//   formats       file formats, the first being the default.
//   instrumental  true = can be asked for no vocals.
//   c2pa          true = can sign its MP3 with Content Credentials.
//
// ElevenLabs takes all four as API fields. Lyria 3.5 has no field for the
// length or the vocals: it reads both from the words (lib/providers/google.ts),
// and WAV is one of its response formats.

/** The xcreate-ai-audio bucket's size limit (migration 106). */
export const AUDIO_BUCKET_BYTES = 52_428_800

/** WAV as both providers send it: 48 kHz, 16-bit, stereo. */
const WAV_BYTES_PER_SECOND = 48_000 * 2 * 2

/** ElevenLabs sends WAV as raw PCM (`pcm_48000`), which we wrap. */
export function isWavFormat(f: string | null | undefined): boolean {
  return !!f && (f === 'wav' || f.startsWith('pcm_'))
}

export function isMp3Format(f: string | null | undefined): boolean {
  return !!f && f.startsWith('mp3')
}

/** A WAV song has to fit the bucket: 4 minutes do (46 MB), 5 do not (58 MB). */
export function wavFits(seconds: number): boolean {
  return seconds * WAV_BYTES_PER_SECOND + 44 <= AUDIO_BUCKET_BYTES
}

/** 'mp3_48000_320' → 'MP3 320k', 'pcm_48000' → 'WAV' (it reaches the
 *  person as one), anything else as written ('mp3' → 'MP3'). */
export function audioFormatLabel(f: string): string {
  if (f.startsWith('pcm_')) return 'WAV'
  const m = f.match(/^(mp3|opus)_\d+_(\d+)$/)
  return m ? `${m[1].toUpperCase()} ${m[2]}k` : f.toUpperCase()
}
