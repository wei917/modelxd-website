// lib/xsports-cheer-fresh.ts — what an admin asks 晴晴 for, made fresh each
// time (owner, Oct 16: "fresh each time"): a selfie, a dance clip, a cheer
// clip, or a picture of her cheering someone on by name (幫某人加油).
// Made after the tap (app/api/xsports/cheer, in `after`) into her folder's
// fresh/, shown to the admin, and posted only if that admin chooses to:
// nothing made here reaches a room unseen.
// A picture is a real photo, never a drawing (Oct 16: "why it's cartoon
// style"), with one of her reviewed photos for who she is (Dodger blue in
// Dodgers games), in a pose picked at random (Oct 16: "why the cheerleader
// pose is the same?"); a 加油 one has a comic speech bubble with the name,
// and can be a clip too. A clip is such a picture moved for 3 or 5 seconds
// (Oct 16: "3 or 5 seconds"), with the model's own sound (Oct 16: "please
// use models with audio support"), re-encoded small. The models are drawn at
// random from lists kept in a JSON file (lib/xsports-cheer-models; Oct 16:
// "we should always have a list and randomly use one ... so we know which
// models are better"); when one fails the next one tries. A clip's first
// frame is drawn in the shape its video model takes. ModelXD pays; each call
// counts toward the day's XSports total.
// A job is a row of xsports_cheer_jobs (supabase/137: what was asked, every
// model tried, the one that made it, the time and the cost, the message it
// became); its files are in her folder's fresh/. Server-only.

import { randomUUID } from 'crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as providers from './providers'
import { xsportsAdmin } from './xsports-store'
import { addSpend } from './xsports-ai-spend'
import { gameFor } from './xsports-room-ai'
import { ffmpegPath, run } from './xcut-render'
import { CHEER_MEDIA, CHEER_MEDIA_DIR, freshKind, type CheerAction, type CheerMediaKind, type ClipSeconds } from './xsports-cheer-media'
import { mediaUrl, publicBase, teamSide } from './xsports-cheer'
import { clipParams, drawClipModels, drawPhotoModels, FRAME_PX, modelKey, photoParams, type FrameRatio } from './xsports-cheer-models'
import type { RoomKey } from './xsports-room'

const DIR = `${CHEER_MEDIA_DIR}/fresh`
const JOBS = 'xsports_cheer_jobs'
/** A job not done by then has failed (the route's 800 s, and a little). */
export const FRESH_MAX_MS = 14 * 60_000
/** Models tried for one picture or one clip before it gives up. */
const TRIES = 3

export type FreshStatus =
  | { status: 'working' }
  | { status: 'failed' }
  | { status: 'done'; url: string; kind: CheerMediaKind; model: string | null; ms: number | null; usd: number | null }

/** A new job's id: when it began (ms, base 36), then a random uuid. */
export const newFreshId = () => `${Date.now().toString(36)}-${randomUUID()}`
export const isFreshId = (s: unknown): s is string =>
  typeof s === 'string' && /^[0-9a-z]{8,10}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s)

type Look = 'xd' | 'dodgers'

// Her look, as in the reviewed set: her red XD uniform, or Dodger blue with
// no team marks at all (never MLB's or the team's).
const LOOK: Record<Look, string> = {
  xd: 'A realistic photograph of the same woman as in the reference photo: keep her face, hair, red ribbon and uniform exactly. An original fictional character, not based on any real person: a Taiwanese woman in her early twenties, a professional baseball cheerleader, in her original red-and-white cheer uniform with a small red "XD" emblem on the chest, red-and-white pom-poms; a baseball stadium.',
  dodgers: 'A realistic photograph of the same young woman as in the reference photo: keep her face, hair, ribbon and uniform exactly. An original fictional character, not based on any real person: a Taiwanese woman in her early twenties, a baseball cheerleader, in a royal-blue and white cheer uniform (a sleeveless white top with royal-blue trim and a plain royal-blue chevron, a royal-blue pleated skirt over matching shorts), a royal-blue ribbon in her hair, royal-blue and white pom-poms; a Southern California ballpark with blue seats and palm trees.',
}
// The reference is for who she is; the photo is new (an edit keeps the
// reference's pose unless told not to).
const IDENTITY = "Use the reference photo only for who she is (her face, hair, ribbon and uniform): a new photo with its own pose, framing and background, not the reference's."
const RULES: Record<Look, string> = {
  xd: 'No real team names, logos, sponsors or stadium signs anywhere.',
  dodgers: 'Absolutely no logos, letters, numbers, team names or emblems anywhere on her or in the scene; no signs, ads or text.',
}
const pick = <T,>(xs: readonly T[], rand: () => number) => xs[Math.floor(rand() * xs.length)]
const TAIL = 'Realistic photograph, natural skin texture, sporty, wholesome and tasteful; camera at eye or chest height, never from below.'
const MOVE_TAIL = 'The camera stays still at the same framing; the background stays soft. Sporty, wholesome, natural motion; her face and uniform stay the same. Sound: an upbeat cheer beat and a cheering stadium crowd; she does not speak or sing.'
const poms = (l: Look) => (l === 'dodgers' ? 'blue-and-white' : 'red-and-white')

/** Night-game lights or afternoon sun, by the hour in the US East. */
export function lightNow(now = new Date()): string {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(now))
  return h >= 18 || h < 6 ? 'Under bright night-game floodlights.' : 'On a bright, sunny afternoon.'
}

/** One way to make it: the reviewed photo her face comes from, the picture,
 *  and for a clip how she moves. One is picked at random each time. */
type Scene = { ref: Record<Look, string>; still: (l: Look) => string; move?: (l: Look) => string }
export const SCENES: Record<Exclude<CheerAction, 'shout'>, Scene[]> = {
  selfie: [
    { ref: { xd: 'selfie.jpg', dodgers: 'blue-selfie.jpg' }, still: () => "A selfie she takes herself at arm's length, camera at eye level: face and shoulders, a peace sign and a big smile; the stands behind her, slightly blurred." },
    { ref: { xd: 'selfie2.jpg', dodgers: 'blue-selfie.jpg' }, still: () => "A selfie at arm's length, camera at eye level: a playful wink, a pom-pom held by her cheek; the crowd behind her, slightly blurred." },
    { ref: { xd: 'selfie.jpg', dodgers: 'blue-hello.jpg' }, still: () => "A selfie at arm's length, camera at eye level: a finger heart and a sweet smile; the field behind her, slightly blurred." },
    { ref: { xd: 'ball.jpg', dodgers: 'blue-selfie.jpg' }, still: () => "A selfie at arm's length, camera at eye level: mid-cheer, mouth open in a happy shout, one pom-pom raised; the crowd behind her, slightly blurred." },
    { ref: { xd: 'selfie2.jpg', dodgers: 'blue-hello.jpg' }, still: () => "A selfie at arm's length, camera at eye level: puffing her cheeks playfully with a pom-pom beside her face; fans cheering behind her, slightly blurred." },
    { ref: { xd: 'selfie.jpg', dodgers: 'blue-selfie.jpg' }, still: () => "A selfie at arm's length, camera just above eye level: a big laugh, her ponytail swinging; the bright field behind her, slightly blurred." },
  ],
  dance: [
    { ref: { xd: 'dance.jpg', dodgers: 'blue-dance.jpg' }, still: () => 'Waist-up: a dance move with both pom-poms making a V above her head, a playful wink.', move: l => `She dances a short, cheerful cheerleading routine in place: swinging the ${poms(l)} pom-poms side to side and up overhead, small shoulder bounces and a little sway, a big smile and a wink at the end. ${MOVE_TAIL}` },
    { ref: { xd: 'dance.jpg', dodgers: 'blue-dance.jpg' }, still: () => 'Waist-up: mid-dance, one pom-pom up high and one at her hip, a big smile.', move: l => `She dances a quick, bouncy cheer routine in place: alternating the ${poms(l)} pom-poms up and down to the beat, a little spin of her shoulders, smiling at the camera. ${MOVE_TAIL}` },
    { ref: { xd: 'cheer.jpg', dodgers: 'blue-cheer.jpg' }, still: () => 'Waist-up: mid-dance with both pom-poms out to the sides, laughing.', move: l => `She dances in place: sweeping the ${poms(l)} pom-poms out and in, then up overhead with a small hop, laughing. ${MOVE_TAIL}` },
  ],
  cheer: [
    { ref: { xd: 'megaphone.jpg', dodgers: 'blue-megaphone.jpg' }, still: l => `Waist-up: leading the crowd in a chant through a ${l === 'dodgers' ? 'royal-blue' : 'red'} megaphone, her other hand raised in a fist, mouth open in a shout.`, move: () => `She leads the crowd in a chant through the megaphone, then pumps her free fist up in rhythm with small bounces, a big smile between shouts. ${MOVE_TAIL}` },
    { ref: { xd: 'cheer.jpg', dodgers: 'blue-cheer.jpg' }, still: () => 'Knees up, camera at chest height: cheering with both pom-poms raised high, mouth open in a happy shout.', move: l => `She cheers in place: pumping both ${poms(l)} pom-poms up in rhythm, shouting a chant with a big smile, small bounces on her toes. ${MOVE_TAIL}` },
  ],
}

/** The 加油 picture's poses, one picked each time. */
export const SHOUT_POSES = [
  'Waist-up: pointing at the camera with one hand, the other pom-pom on her hip, shouting with a big grin.',
  'Waist-up: cupping one hand beside her mouth as she shouts, the other pom-pom raised.',
  'Waist-up: leaning toward the camera with a fist pump and a pom-pom, mouth open in a cheer.',
  'Waist-up: shouting through a megaphone held in one hand, the other pom-pom raised.',
  'Knees up, camera at chest height: jumping with one fist and pom-pom in the air, cheering.',
  'Waist-up: both pom-poms held together at her chest, leaning in and shouting happily.',
] as const

/** How she moves in a 加油 clip: the bubble stays as it is. */
export const SHOUT_MOVE = `She cheers in place for the name in the speech bubble: a big smile, pumping her fist or pom-pom in rhythm, small bounces. The speech bubble and its words stay exactly as they are, fixed in place, unchanged. ${MOVE_TAIL}`

/** The 加油 picture: a real photo of her cheering, with a comic speech
 *  bubble holding the name. */
export function shoutPrompt(name: string, l: Look, pose: string): string {
  return `${LOOK[l]} ${IDENTITY} ${pose} Over the photo, a big white comic-style speech bubble with a black outline comes from her mouth, holding bold black hand-lettered text, exactly this and nothing else, without quotation marks: ${name} 加油！ ${lightNow()} ${RULES[l]} The speech bubble's words are the only text in the picture. ${TAIL}`
}

/** A job's row, before anything is made (the route). Throws before 137. */
export async function startFresh(k: RoomKey, id: string, a: { action: CheerAction; name?: string; video?: boolean; seconds: ClipSeconds; adminId: string | null }): Promise<void> {
  const kind = freshKind(a.action, a.video)
  const { error } = await xsportsAdmin().from(JOBS).insert({
    id, admin_id: a.adminId, league: k.league, game_id: k.game, lang: k.lang,
    action: a.action, name: a.name ?? null, kind, seconds: kind === 'video' ? a.seconds : null,
  })
  if (error) throw new Error(error.message)
}

const jpeg = async (buf: Buffer, ratio: FrameRatio) => {
  const sharp = (await import('sharp')).default
  const [w, h] = FRAME_PX[ratio]
  return sharp(buf).resize(w, h, { fit: 'cover' }).jpeg({ quality: 84, mozjpeg: true }).toBuffer()
}

/** A photo in `ratio` from the first of `models` that makes one, with her
 *  reviewed photo as the reference; each model tried goes on `tried`. */
async function photo(models: any[], prompt: string, refFile: string, ratio: FrameRatio, tried: string[]): Promise<{ jpg: Buffer; model: any; usd: number }> {
  const ref = CHEER_MEDIA.find(m => m.file === refFile)
  if (!ref) throw new Error(`no reference photo ${refFile}`)
  const res = await fetch(mediaUrl(ref))
  if (!res.ok) throw new Error(`reference photo: ${res.status}`)
  const refBuf = Buffer.from(await res.arrayBuffer())
  let last: unknown = null
  for (const m of models.slice(0, TRIES)) {
    tried.push(modelKey(m))
    try {
      const p = photoParams(m, ratio)
      const r = await providers.generateImage(m, prompt, 'medium', p.size,
        [{ buffer: refBuf, mediaType: 'image/jpeg', port: 'reference_image' }], null, null, { userId: null }, p.aspect_ratio ? { aspect_ratio: p.aspect_ratio } : undefined)
      const usd = Number(r.cost) || 0
      if (usd > 0) await addSpend(usd).catch(() => {})
      return { jpg: await jpeg(r.buffer, ratio), model: m, usd }
    } catch (e: any) {
      last = e
      console.warn('[xsports/cheer] photo', modelKey(m), e?.message ?? e)
    }
  }
  throw last ?? new Error('no photo model could make it')
}

/** A clip from `frame` (made in the first model's shape) by the first of
 *  `models` that makes one: `seconds` long with its own sound, watermark
 *  off; then small for phones (720 wide, H.264 and AAC, plays as it loads).
 *  Each model reads its first frame, in its own shape, from a link. */
async function film(models: any[], frame: { jpg: Buffer; ratio: FrameRatio }, link: (name: string, jpg: Buffer) => Promise<string>, move: string, seconds: ClipSeconds, tried: string[]): Promise<{ mp4: Buffer; model: any; usd: number }> {
  let last: unknown = null
  for (const m of models.slice(0, TRIES)) {
    tried.push(modelKey(m))
    try {
      const p = clipParams(m, seconds)
      const jpg = p.ratio === frame.ratio ? frame.jpg : await jpeg(frame.jpg, p.ratio)
      const url = await link(`frame-${p.ratio.replace(':', 'x')}`, jpg)
      const v = await providers.generateVideo(m, move, p.size, seconds,
        [{ buffer: jpg, mediaType: 'image/jpeg', url, port: 'first_frame' }], undefined, { userId: null },
        { watermark: false, aspect_ratio: p.ratio, mode: 'image_to_video', generate_audio: true })
      const usd = Number(v.cost) || 0
      if (usd > 0) await addSpend(usd).catch(() => {})
      const dir = await mkdtemp(join(tmpdir(), 'cheer-'))
      try {
        const raw = join(dir, 'raw.mp4'), out = join(dir, 'out.mp4')
        await writeFile(raw, v.buffer)
        await run(ffmpegPath(), ['-y', '-loglevel', 'error', '-i', raw, '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p', '-vf', 'scale=720:-2', '-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-movflags', '+faststart', out], 120_000)
        return { mp4: await readFile(out), model: m, usd }
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => {})
      }
    } catch (e: any) {
      last = e
      console.warn('[xsports/cheer] clip', modelKey(m), e?.message ?? e)
    }
  }
  throw last ?? new Error('no clip model could make it')
}

/** Make one for an admin's ask in this room (her team's blue in its games):
 *  a photo, or a clip of `seconds` for a dance, a cheer, or a 加油 asked as
 *  `video`. Its row says how it went. Never throws. */
export async function makeFresh(k: RoomKey, id: string, action: CheerAction, name = '', o: { seconds?: ClipSeconds; video?: boolean } = {}, rand: () => number = Math.random): Promise<void> {
  const t0 = Date.now()
  const seconds: ClipSeconds = o.seconds === 3 ? 3 : 5
  const tried: string[] = []
  const store = xsportsAdmin().storage.from('x-characters')
  const put = async (file: string, body: Buffer, type: string) => {
    const { error } = await store.upload(`${DIR}/${file}`, body, { contentType: type, upsert: true })
    if (error) throw new Error(`upload ${file}: ${error.message}`)
    return `${publicBase()}/${DIR}/${file}`
  }
  const finish = async (patch: Record<string, unknown>) => {
    const { error } = await xsportsAdmin().from(JOBS).update({ ...patch, tried, ms: Date.now() - t0, finished_at: new Date().toISOString() }).eq('id', id)
    if (error) console.warn('[xsports/cheer] job', id, error.message)
  }
  try {
    const g = await gameFor(k.league, Number(k.game))
    const look: Look = teamSide(g) ? 'dodgers' : 'xd'
    // What she does in it, which of her photos says who she is, and how she
    // moves in a clip.
    let prompt: string, ref: string, move: string | null
    if (action === 'shout') {
      prompt = shoutPrompt(name, look, pick(SHOUT_POSES, rand))
      ref = look === 'dodgers' ? 'blue-selfie.jpg' : 'selfie.jpg'
      move = SHOUT_MOVE
    } else {
      const scene = pick(SCENES[action], rand)
      prompt = `${LOOK[look]} ${IDENTITY} ${scene.still(look)} ${lightNow()} ${RULES[look]} ${TAIL}`
      ref = scene.ref[look]
      move = scene.move?.(look) ?? null
    }
    const photos = await drawPhotoModels(rand)
    if (!photos.length) throw new Error('no photo model in the list can make her photo')
    if (freshKind(action, o.video) === 'image' || !move) {
      const p = await photo(photos, prompt, ref, '2:3', tried)
      await finish({ status: 'done', model: modelKey(p.model), url: await put(`${id}.jpg`, p.jpg, 'image/jpeg'), usd: p.usd })
      return
    }
    const clips = await drawClipModels(seconds, rand)
    if (!clips.length) throw new Error(`no clip model in the list makes ${seconds}-second clips with sound`)
    const ratio = clipParams(clips[0], seconds).ratio
    const f = await photo(photos, prompt, ref, ratio, tried)
    const c = await film(clips, { jpg: f.jpg, ratio }, (n, jpg) => put(`${id}-${n}.jpg`, jpg, 'image/jpeg'), move, seconds, tried)
    await finish({ status: 'done', model: modelKey(c.model), frame_model: modelKey(f.model), url: await put(`${id}.mp4`, c.mp4, 'video/mp4'), usd: Math.round((f.usd + c.usd) * 10_000) / 10_000 })
  } catch (e: any) {
    console.warn('[xsports/cheer] fresh', action, id, e?.message ?? e)
    await finish({ status: 'failed', error: String(e?.message ?? e).slice(0, 500) }).catch(() => {})
  }
}

/** Where a job is: done (its link, kind, model, time and cost), failed (or
 *  past FRESH_MAX_MS), or still working. */
export async function freshStatus(id: string, now = Date.now()): Promise<FreshStatus> {
  const { data, error } = await xsportsAdmin().from(JOBS).select('status, kind, url, model, ms, usd, created_at').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return { status: 'failed' }
  if (data.status === 'done' && data.url) return { status: 'done', url: data.url, kind: data.kind === 'video' ? 'video' : 'image', model: data.model ?? null, ms: data.ms ?? null, usd: data.usd == null ? null : Number(data.usd) }
  if (data.status === 'failed' || now - Date.parse(data.created_at) > FRESH_MAX_MS) return { status: 'failed' }
  return { status: 'working' }
}

/** The job became this message (its votes and reports are the model's). */
export async function freshPosted(id: string, messageId: number): Promise<void> {
  const { error } = await xsportsAdmin().from(JOBS).update({ posted_message_id: messageId }).eq('id', id)
  if (error) console.warn('[xsports/cheer] posted', id, error.message)
}
