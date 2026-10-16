// lib/xsports-cheer-media.ts — 晴晴's pictures and clips for the public rooms
// (owner, Oct 15: "can she take selfie or someone take photo of her 喊加油? or
// dancing?" → "and post the photos in the public chat room"). A fixed set,
// each one looked at before it was added (GPT Image 2 with her portrait as
// the face reference; HappyHorse 1.1 clips made from those photos, with the
// model's own sound since Oct 16), never a picture made on the spot: one made
// live would reach a public room unseen.
// The files sit in her character's folder of the public x-characters bucket.
// What an admin asks her for is made fresh each time instead, and posted
// only after that admin has seen it (lib/xsports-cheer-fresh). Plain data
// and text: the server picks, and the page reads the admin's actions and
// the name rule from here.

import { cleanName, nameLength } from './face'

export type CheerMediaKind = 'image' | 'video'

/** One picture or clip: its file, kind, what it suits, what it shows (told
 *  to her, so her words fit it), and its set: her own red XD uniform, or
 *  Dodger blue for her team's games (Oct 16; no team marks in either). */
export interface CheerMedia { file: string; kind: CheerMediaKind; tags: readonly string[]; shows: string; set?: 'xd' | 'dodgers' }

/** Her folder in x-characters (founder@modelxd.com's, where her character is). */
export const CHEER_MEDIA_DIR = 'c9a73e58-b5b4-48bf-a794-0b8bb347af89/cheer'

export const CHEER_MEDIA: readonly CheerMedia[] = [
  { file: 'selfie.jpg', kind: 'image', tags: ['selfie'], shows: 'a selfie of you in the stands, making a peace sign' },
  { file: 'selfie2.jpg', kind: 'image', tags: ['selfie'], shows: 'a selfie of you winking under the night-game lights, a pom-pom by your cheek' },
  { file: 'ball.jpg', kind: 'image', tags: ['selfie'], shows: 'you holding a baseball by your cheek with a wink' },
  { file: 'megaphone.jpg', kind: 'image', tags: ['cheer'], shows: 'you leading a chant with a red megaphone' },
  { file: 'cheer.jpg', kind: 'image', tags: ['cheer'], shows: 'you cheering with both pom-poms up high' },
  { file: 'point.jpg', kind: 'image', tags: ['cheer'], shows: 'you pointing at the camera: you can do it!' },
  { file: 'heart.jpg', kind: 'image', tags: ['cheer'], shows: 'you making a big heart with your arms' },
  { file: 'wave.jpg', kind: 'image', tags: ['hello'], shows: 'you waving hello to the fans' },
  { file: 'dance.jpg', kind: 'image', tags: ['dance'], shows: 'you mid-dance with the pom-poms, winking' },
  { file: 'homerun.jpg', kind: 'image', tags: ['homerun'], shows: 'you holding up a 「全壘打！」 sign' },
  { file: 'win.jpg', kind: 'image', tags: ['win'], shows: 'you jumping for joy in falling confetti' },
  { file: 'night.jpg', kind: 'image', tags: ['win'], shows: 'you waving to the fans in confetti under the lights' },
  { file: 'clip-1.mp4', kind: 'video', tags: ['dance', 'homerun'], shows: 'a short clip of you dancing with the pom-poms' },
  { file: 'clip-2.mp4', kind: 'video', tags: ['dance', 'homerun'], shows: 'a short clip of you dancing with the pom-poms' },
  // Dodger blue, for her team's games (Oct 16): no logos, letters or team names.
  { file: 'blue-selfie.jpg', kind: 'image', set: 'dodgers', tags: ['selfie'], shows: 'a selfie of you in your blue uniform, making a peace sign, palm trees behind you' },
  { file: 'blue-megaphone.jpg', kind: 'image', set: 'dodgers', tags: ['cheer'], shows: 'you leading a chant with a blue megaphone' },
  { file: 'blue-cheer.jpg', kind: 'image', set: 'dodgers', tags: ['cheer'], shows: 'you cheering with both blue pom-poms up high' },
  { file: 'blue-heart.jpg', kind: 'image', set: 'dodgers', tags: ['cheer'], shows: 'you making a big heart with your arms' },
  { file: 'blue-hello.jpg', kind: 'image', set: 'dodgers', tags: ['hello'], shows: 'you waving hello in your blue uniform' },
  { file: 'blue-dance.jpg', kind: 'image', set: 'dodgers', tags: ['dance'], shows: 'you mid-dance with the blue pom-poms, winking' },
  { file: 'blue-homerun.jpg', kind: 'image', set: 'dodgers', tags: ['homerun'], shows: 'you holding up a 「全壘打！」 sign' },
  { file: 'blue-win.jpg', kind: 'image', set: 'dodgers', tags: ['win'], shows: 'you jumping for joy in blue and white confetti' },
  { file: 'blue-night.jpg', kind: 'image', set: 'dodgers', tags: ['win'], shows: 'you waving to the fans in confetti under the lights' },
  { file: 'blue-clip-1.mp4', kind: 'video', set: 'dodgers', tags: ['dance', 'homerun'], shows: 'a short clip of you dancing with the blue pom-poms' },
  { file: 'blue-clip-2.mp4', kind: 'video', set: 'dodgers', tags: ['dance', 'homerun'], shows: 'a short clip of you dancing with the blue pom-poms' },
]

/** At most one picture or clip per room every ten minutes. */
export const MEDIA_GAP_MS = 10 * 60_000

/** What a fan's message asks her to show: a selfie, a dance, or any photo. */
export function askedMedia(text: string): 'selfie' | 'dance' | 'any' | null {
  const t = text.normalize('NFKC').toLowerCase()
  if (/自拍|selfie|自撮り|셀카/.test(t)) return 'selfie'
  if (/跳舞|跳支舞|跳一段|舞蹈|dance|ダンス|踊って|춤/.test(t)) return 'dance'
  if (/拍.{0,2}照|照片|相片|來張|来张|photo|picture|\bpics?\b|写真|사진/.test(t)) return 'any'
  return null
}

/** The picture for a moment or a request: one of the set with the tag, not
 *  among the room's recent ones, chosen at random (`rand` for the checks). */
export function pickMedia(tag: string, recent: readonly string[], rand: () => number = Math.random, set: 'xd' | 'dodgers' = 'xd'): CheerMedia | null {
  const fits = (m: CheerMedia) => (tag === 'any' ? m.kind === 'image' : m.tags.includes(tag))
  // From the set; her red XD set for anything the set has none of.
  const inSet = CHEER_MEDIA.filter(m => (m.set ?? 'xd') === set && fits(m))
  const all = inSet.length ? inSet : CHEER_MEDIA.filter(m => (m.set ?? 'xd') === 'xd' && fits(m))
  const fresh = all.filter(m => !recent.includes(m.file))
  const from = fresh.length ? fresh : all
  return from.length ? from[Math.floor(rand() * from.length)] : null
}

/** What an admin can ask her for in her card (owner, Oct 16: "admins can tap
 *  her profile and ask her do something? the action can have dance(post
 *  dance selfie), 幫某人加油(with comic like picture with dialog +name text),
 *  or cheer video...etc"; "fresh each time"): a selfie, a dance clip, a cheer
 *  clip, or a comic picture of her shouting 「<name> 加油！」, each made new
 *  (lib/xsports-cheer-fresh). */
export const CHEER_ACTIONS = ['selfie', 'dance', 'cheer', 'shout'] as const
export type CheerAction = typeof CHEER_ACTIONS[number]

/** Made fresh for an admin: a picture (about a minute) or a clip (about
 *  three: a picture, then moved). */
export const freshKind = (a: CheerAction): CheerMediaKind => (a === 'dance' || a === 'cheer' ? 'video' : 'image')

/** What the fresh one shows, told to her so her words fit it. */
export function freshShows(a: CheerAction, name?: string): string {
  switch (a) {
    case 'selfie': return 'a selfie you just took at the game'
    case 'dance': return 'a short clip of you dancing with the pom-poms, just filmed'
    case 'cheer': return 'a short clip of you leading a cheer, just filmed'
    case 'shout': return `a comic picture of you shouting 「${name ?? ''} 加油！」 in a big speech bubble`
  }
}

/** The longest name in a 加油 bubble, as a person counts characters. */
export const SHOUT_NAME_MAX = 16

/** The name for a 加油 picture: cleaned like a website name (lib/face),
 *  without corner brackets or quotes (the bubble has its own), at most
 *  SHOUT_NAME_MAX characters; '' when nothing is left or it is too long. */
export function shoutName(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const s = cleanName(raw.replace(/[「」『』"“”]/g, ''))
  return s && nameLength(s) <= SHOUT_NAME_MAX ? s : ''
}
