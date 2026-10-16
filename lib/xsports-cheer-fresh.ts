// lib/xsports-cheer-fresh.ts — what an admin asks 晴晴 for, made fresh each
// time (owner, Oct 16: "fresh each time"): a selfie, a dance clip, a cheer
// clip, or a comic picture of her shouting 「<name> 加油！」. Made after the
// tap (app/api/xsports/cheer, in `after`) into her folder's fresh/, shown to
// the admin, and posted only if that admin chooses to: nothing made here
// reaches a room unseen. A picture is GPT Image 2 with one of her reviewed
// photos as the face reference (Dodger blue in Dodgers games), about a
// minute; a clip is such a picture moved by HappyHorse 1.1 (watermark off;
// it makes the sound too: owner, Oct 16, "please use models with audio
// support") and re-encoded small with that sound, about three. ModelXD pays, about $0.05 a picture and
// $0.95 a clip, each counted toward the day's XSports total.
// A job is files, not rows: <id>.jpg or <id>.mp4 once done, <id>.failed if
// not (and <id>-frame.jpg, a clip's first frame); the id starts with when
// the job began. Server-only.

import { randomUUID } from 'crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as providers from './providers'
import { getModelByProviderName } from './models'
import { xsportsAdmin } from './xsports-store'
import { addSpend } from './xsports-ai-spend'
import { gameFor } from './xsports-room-ai'
import { ffmpegPath, run } from './xcut-render'
import { CHEER_MEDIA, CHEER_MEDIA_DIR, type CheerAction, type CheerMediaKind } from './xsports-cheer-media'
import { mediaUrl, publicBase, teamSide, usable } from './xsports-cheer'
import type { RoomKey } from './xsports-room'

const DIR = `${CHEER_MEDIA_DIR}/fresh`
/** A job not done by then has failed (the route's 800 s, and a little). */
export const FRESH_MAX_MS = 14 * 60_000

export type FreshStatus = { status: 'working' } | { status: 'failed' } | { status: 'done'; url: string; kind: CheerMediaKind }

/** A new job's id: when it began (ms, base 36), then a random uuid. */
export const newFreshId = () => `${Date.now().toString(36)}-${randomUUID()}`
export const isFreshId = (s: unknown): s is string =>
  typeof s === 'string' && /^[0-9a-z]{8,10}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s)
const startedAt = (id: string) => parseInt(id.split('-')[0], 36)

type Look = 'xd' | 'dodgers'

// Her look, as in the reviewed set: her red XD uniform, or Dodger blue with
// no team marks at all (never MLB's or the team's).
const LOOK: Record<Look, string> = {
  xd: 'The same woman as in the reference photo: keep her face, hair, red ribbon and uniform exactly. An original fictional character, not based on any real person: a Taiwanese woman in her early twenties, a professional baseball cheerleader, in her original red-and-white cheer uniform with a small red "XD" emblem on the chest, red-and-white pom-poms; a baseball stadium.',
  dodgers: 'The same young woman as in the reference photo: keep her face, hair, ribbon and uniform exactly. An original fictional character, not based on any real person: a Taiwanese woman in her early twenties, a baseball cheerleader, in a royal-blue and white cheer uniform (a sleeveless white top with royal-blue trim and a plain royal-blue chevron, a royal-blue pleated skirt over matching shorts), a royal-blue ribbon in her hair, royal-blue and white pom-poms; a Southern California ballpark with blue seats and palm trees.',
}
const RULES: Record<Look, string> = {
  xd: 'No real team names, logos, sponsors or stadium signs anywhere.',
  dodgers: 'Absolutely no logos, letters, numbers, team names or emblems anywhere on her or in the scene; no signs, ads or text.',
}
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

/** The 加油 picture: a comic panel, not a photo. */
export function shoutPrompt(name: string, l: Look): string {
  const colors = l === 'dodgers' ? 'royal blue and white' : 'red and white'
  return `A bright comic-book panel, clean manga-style line art with flat colors: the same young woman as in the reference photo (keep her face, hair, ribbon and outfit), an original fictional Taiwanese baseball cheerleader, waist-up, both pom-poms raised, shouting with joy. A big white comic speech bubble from her mouth holds bold hand-lettered text, exactly this and nothing else: 「${name} 加油！」 Behind her, speed lines and a starburst in ${colors}. Wholesome and tasteful. No team names or logos, no numbers, signs or any other text anywhere.`
}

/** A picture: GPT Image 2 with one of her reviewed photos as the reference,
 *  as 720 by 1080 JPEG like the set. */
async function picture(prompt: string, refFile: string): Promise<Buffer> {
  const ref = CHEER_MEDIA.find(m => m.file === refFile)
  if (!ref) throw new Error(`no reference photo ${refFile}`)
  const res = await fetch(mediaUrl(ref))
  if (!res.ok) throw new Error(`reference photo: ${res.status}`)
  const model = await getModelByProviderName('openai', 'gpt-image-2')
  if (!model || !usable(model)) throw new Error('gpt-image-2 is not available')
  const r = await providers.generateImage(model, prompt, 'medium', '1024x1536',
    [{ buffer: Buffer.from(await res.arrayBuffer()), mediaType: 'image/jpeg', port: 'reference_image' }], null, null, { userId: null })
  if (Number(r.cost) > 0) await addSpend(Number(r.cost)).catch(() => {})
  const sharp = (await import('sharp')).default
  return sharp(r.buffer).resize(720, 1080, { fit: 'cover' }).jpeg({ quality: 84, mozjpeg: true }).toBuffer()
}

/** A clip from a picture: HappyHorse 1.1, five seconds with its own sound,
 *  watermark off; then small for phones (720 wide, H.264 and AAC, plays as
 *  it loads). */
async function clip(frame: Buffer, frameUrl: string, move: string): Promise<Buffer> {
  const model = await getModelByProviderName('alibaba', 'happyhorse-1.1-i2v')
  if (!model || !usable(model)) throw new Error('happyhorse-1.1-i2v is not available')
  const v = await providers.generateVideo(model, move, '720x1080', 5,
    [{ buffer: frame, mediaType: 'image/jpeg', url: frameUrl, port: 'first_frame' }], undefined, { userId: null }, { watermark: false })
  if (Number(v.cost) > 0) await addSpend(Number(v.cost)).catch(() => {})
  const dir = await mkdtemp(join(tmpdir(), 'cheer-'))
  try {
    const raw = join(dir, 'raw.mp4'), out = join(dir, 'out.mp4')
    await writeFile(raw, v.buffer)
    await run(ffmpegPath(), ['-y', '-loglevel', 'error', '-i', raw, '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p', '-vf', 'scale=720:-2', '-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-movflags', '+faststart', out], 120_000)
    return await readFile(out)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/** Make one for an admin's ask in this room (her team's blue in its games).
 *  Never throws: a failure leaves <id>.failed. */
export async function makeFresh(k: RoomKey, id: string, action: CheerAction, name = '', rand: () => number = Math.random): Promise<void> {
  const store = xsportsAdmin().storage.from('x-characters')
  const put = async (file: string, body: Buffer, type: string) => {
    const { error } = await store.upload(`${DIR}/${file}`, body, { contentType: type, upsert: true })
    if (error) throw new Error(`upload ${file}: ${error.message}`)
  }
  try {
    const g = await gameFor(k.league, Number(k.game))
    const look: Look = teamSide(g) ? 'dodgers' : 'xd'
    if (action === 'shout') {
      await put(`${id}.jpg`, await picture(shoutPrompt(name, look), look === 'dodgers' ? 'blue-cheer.jpg' : 'cheer.jpg'), 'image/jpeg')
      return
    }
    const list = SCENES[action]
    const scene = list[Math.floor(rand() * list.length)]
    const still = await picture(`${LOOK[look]} ${scene.still(look)} ${lightNow()} ${RULES[look]} ${TAIL}`, scene.ref[look])
    if (!scene.move) { await put(`${id}.jpg`, still, 'image/jpeg'); return }
    // HappyHorse reads its first frame from a link.
    await put(`${id}-frame.jpg`, still, 'image/jpeg')
    await put(`${id}.mp4`, await clip(still, `${publicBase()}/${DIR}/${id}-frame.jpg`, scene.move(look)), 'video/mp4')
  } catch (e: any) {
    console.warn('[xsports/cheer] fresh', action, id, e?.message ?? e)
    await put(`${id}.failed`, Buffer.from(String(e?.message ?? 'failed').slice(0, 300)), 'text/plain').catch(() => {})
  }
}

/** Where a job is: done (its link and kind), failed (or past FRESH_MAX_MS),
 *  or still working. */
export async function freshStatus(id: string, now = Date.now()): Promise<FreshStatus> {
  const { data, error } = await xsportsAdmin().storage.from('x-characters').list(DIR, { search: id, limit: 10 })
  if (error) throw new Error(error.message)
  const names = new Set(((data ?? []) as { name: string }[]).map(f => f.name))
  if (names.has(`${id}.mp4`)) return { status: 'done', url: `${publicBase()}/${DIR}/${id}.mp4`, kind: 'video' }
  if (names.has(`${id}.jpg`)) return { status: 'done', url: `${publicBase()}/${DIR}/${id}.jpg`, kind: 'image' }
  if (names.has(`${id}.failed`) || now - startedAt(id) > FRESH_MAX_MS) return { status: 'failed' }
  return { status: 'working' }
}
