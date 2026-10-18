// lib/remake/store.ts: what 同款's make job and the 風扇變裝 template's job
// share (Oct 18): the service client, the buckets, saving and fetching files,
// signing links, a user's photo as JPEG, a media file's length, and the music
// mix. Server only (service key).

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

export const run = promisify(execFile)

export const service = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } })

export const STATUS_BUCKET = 'xcreate-user-files'
export const B = { image: 'xcreate-ai-images', video: 'xcreate-ai-videos', audio: 'xcreate-ai-audio', userImage: 'xcreate-user-images', userAudio: 'xcreate-user-files' }
export async function put(sb: SupabaseClient, bucket: string, p: string, buf: Buffer, type: string) {
  for (let attempt = 1; ; attempt++) {
    const { error } = await sb.storage.from(bucket).upload(p, buf, { contentType: type, upsert: true })
    if (!error) return p
    if (attempt >= 3) throw new Error(`upload ${p}: ${error.message}`)
    await new Promise(r => setTimeout(r, 800 * attempt))
  }
}
export async function get(sb: SupabaseClient, bucket: string, p: string): Promise<Buffer> {
  const { data, error } = await sb.storage.from(bucket).download(p)
  if (error || !data) throw new Error(`download ${p}: ${error?.message ?? 'missing'}`)
  return Buffer.from(await data.arrayBuffer())
}
/** A user's photo as the JPEG the picture models are told it is: upright
 *  (a phone's EXIF turn applied) and at most 2048 px. */
export async function userPhoto(sb: SupabaseClient, p: string): Promise<Buffer> {
  return sharp(await get(sb, B.userImage, p)).rotate().resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer()
}
export async function signed(sb: SupabaseClient, bucket: string, p: string, seconds = 3600, download?: string) {
  const { data } = await sb.storage.from(bucket).createSignedUrl(p, seconds, download ? { download } : undefined)
  if (!data?.signedUrl) throw new Error(`could not sign ${p}`)
  return data.signedUrl
}

/** A media file's length in seconds, from ffmpeg itself (ffmpeg-static ships no ffprobe). */
export async function durationOf(ff: string, file: string): Promise<number> {
  const err = await run(ff, ['-hide_banner', '-i', file]).then(() => '', (e: any) => String(e?.stderr ?? ''))
  const m = err.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0
}

/** The music at -16 LUFS over the video's own sound, which sits 14 dB under
 *  it; a short fade at the end. */
export async function mixMusic(ff: string, video: string, music: string, out: string) {
  const d = await durationOf(ff, video)
  const fade = d > 2 ? `,afade=t=out:st=${(d - 0.8).toFixed(2)}:d=0.8` : ''
  await run(ff, ['-v', 'error', '-y', '-i', video, '-i', music, '-filter_complex',
    `[1:a]atrim=0:${d.toFixed(2)},asetpts=PTS-STARTPTS,loudnorm=I=-16:TP=-1.5:LRA=11${fade},aformat=sample_rates=48000:channel_layouts=stereo[m];[0:a]volume=-14dB,aformat=sample_rates=48000:channel_layouts=stereo[r];[m][r]amix=inputs=2:normalize=0:duration=first[a]`,
    '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out], { maxBuffer: 32 * 1024 * 1024 })
}

