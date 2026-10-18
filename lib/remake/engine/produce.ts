// lib/remake/engine/produce.ts: 同款 phase 2, stage B. The pictures, clips and
// voices of a remake plan, through the normal provider router (billed and
// logged like any other call). The consistency rule from the boxing test
// (docs/FILM-V2-PLAN.md): one reference sheet per character, every keyframe
// an EDIT of the sheets (two people share one input image), a continuing
// shot starts from the previous clip's last frame, and every clip prompt
// asks to keep faces and builds as in the first frame.

import sharp from 'sharp'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { generateImage, generateVideo, generateSpeech } from '../../providers'
import type { ModelInfo } from '../../providers/types'
import { SAFETY } from '../../provider-errors'
import type { PlanCharacter, PlanShot, PlanVoice, RemakePlan } from './plan'

const run = promisify(execFile)
const NO_TEXT = 'No text, no letters, no logos.'

export type Aspect = '16:9' | '9:16' | '4:3' | '3:4' | '1:1'
/** The input canvas for picture edits: the edit's output takes the input's shape. */
const CANVAS: Record<Aspect, [number, number]> = { '16:9': [1920, 1080], '9:16': [1080, 1920], '4:3': [1440, 1080], '3:4': [1080, 1440], '1:1': [1440, 1440] }

/** The nearest shape both the picture and the video model make. */
export function toAspect(raw: string): Aspect {
  const m = raw.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/)
  const r = m ? Number(m[1]) / Number(m[2]) : 16 / 9
  const options: [Aspect, number][] = [['16:9', 16 / 9], ['4:3', 4 / 3], ['1:1', 1], ['3:4', 3 / 4], ['9:16', 9 / 16]]
  return options.reduce((best, o) => Math.abs(Math.log(o[1] / r)) < Math.abs(Math.log(best[1] / r)) ? o : best)[0]
}

export type ProduceContext = {
  userId: string | null
  surface: string
  imageModel: ModelInfo
  videoModel: ModelInfo
  speechModel: ModelInfo
  /** Store a picture and return a link the video model can fetch. */
  sign: (buffer: Buffer, name: string) => Promise<string>
  /** Other makers' models for a picture or clip the first one refuses. */
  imageBackups?: ModelInfo[]
  editBackups?: ModelInfo[]
  videoBackup?: ModelInfo
}
type Made = { buffer: Buffer; cost: number }

/** A refusal on safety grounds: the maker's verdict on its own filter, not
 *  the picture's (XDuel's rule, Sep 16; Oct 18: OpenAI refused a short dress
 *  on a woman lying down and the whole remake stopped). */
const refused = (e: unknown) => SAFETY.test(String((e as Error)?.message ?? e))
/** Said once every maker refused a picture: the same picture, toned down. */
const MODEST = ' An elegant, modest fashion photo: the outfit covers the body well, nothing see-through or revealing.'

/** A picture model's size for a shape: the nearest of its pixel sizes, or its
 *  largest square size with the shape as an option (Grok, Gemini). */
export function sizeFor(model: ModelInfo, aspect: Aspect): { size: string; options: Record<string, unknown> } {
  const sizes: string[] = (model as any).output_config?.image?.sizes ?? []
  const [aw, ah] = aspect.split(':').map(Number)
  const pixels = sizes.map(sz => sz.match(/^(\d+)x(\d+)$/)).filter(Boolean).map(m => ({ size: m![0], r: Number(m![1]) / Number(m![2]), a: Number(m![1]) * Number(m![2]) }))
  if (pixels.length) {
    const best = pixels.sort((x, y) => Math.abs(Math.log(x.r * ah / aw)) - Math.abs(Math.log(y.r * ah / aw)) || y.a - x.a)[0]
    return { size: best.size, options: {} }
  }
  return { size: sizes.includes('2048') ? '2048' : sizes[0] ?? '1024', options: { aspect_ratio: aspect } }
}

/** One picture on the first model that does not refuse it: the next maker
 *  gets the same words, and once all of them have refused, the last one
 *  gets the picture toned down. Any other error stops at once. */
export async function picture(models: ModelInfo[], prompt: string, attachments: any[], aspect: Aspect, ctx: ProduceContext, quality: 'medium' | 'high', gen: typeof generateImage = generateImage): Promise<Made> {
  const tries: [ModelInfo, string][] = [...models.map(m => [m, prompt] as [ModelInfo, string]), [models[models.length - 1], prompt + MODEST]]
  let last: unknown
  for (const [i, [model, words]] of tries.entries()) {
    const { size, options } = sizeFor(model, aspect)
    try {
      const r: any = await gen(model, words, quality as any, size, attachments, null, null, { userId: ctx.userId, surface: ctx.surface } as any, options)
      if (i > 0) console.log(`[remake:produce] picture made by ${model.model_name}${words !== prompt ? ', toned down' : ''} after a refusal`)
      return { buffer: r.buffer, cost: r.cost ?? 0 }
    } catch (e) {
      if (!refused(e)) throw e
      console.warn(`[remake:produce] ${model.model_name} refused a picture: ${String((e as Error)?.message ?? e).slice(0, 160)}`)
      last = e
    }
  }
  throw last
}

export async function makeSheet(ctx: ProduceContext, look: string, ch: PlanCharacter, photo?: Buffer): Promise<Made> {
  const views = 'Character reference sheet on a plain mid-gray backdrop with even light. Four full-body views side by side, the same character each time: front, three-quarter, side profile, back; plus one large head-and-shoulders close-up of the face at the right. Same proportions in every view.'
  const prompt = photo
    ? `${look} Use the person in this photo: exactly the same face, hair and build, drawn in this film's style. ${views} ${ch.canon} ${NO_TEXT}`
    : `${look} ${views} ${ch.canon} ${NO_TEXT}`
  const atts = photo ? [{ buffer: photo, mediaType: 'image/jpeg' } as any] : []
  return picture([ctx.imageModel, ...(ctx.imageBackups ?? [])], prompt, atts, '16:9', ctx, 'medium')
}

/** One input picture for an edit: the sheets (and product) side by side on a
 *  gray canvas of the remake's shape, so the keyframe comes back in it. */
export async function compose(aspect: Aspect, images: Buffer[]): Promise<Buffer> {
  const [W, H] = CANVAS[aspect]
  const cellW = Math.floor(W / images.length)
  const parts = await Promise.all(images.map(async (img, i) => {
    const fitted = await sharp(img).resize(cellW, H, { fit: 'inside' }).toBuffer()
    const meta = await sharp(fitted).metadata()
    return { input: fitted, left: i * cellW + Math.floor((cellW - (meta.width ?? cellW)) / 2), top: Math.floor((H - (meta.height ?? H)) / 2) }
  }))
  return sharp({ create: { width: W, height: H, channels: 3, background: '#808080' } }).composite(parts).jpeg({ quality: 92 }).toBuffer()
}

/** `place`: the user's photo of the setting (a place swapped for a photo),
 *  last in the row; the frame is set there. */
export async function makeKeyframe(ctx: ProduceContext, plan: RemakePlan, shot: PlanShot, sheets: Map<string, Buffer>, product: Buffer | null, aspect: Aspect, place: Buffer | null = null): Promise<Made> {
  const refs = shot.refs.filter(id => sheets.has(id))
  const images = refs.map(id => sheets.get(id)!)
  const withProduct = shot.product && !!product
  if (withProduct) images.push(product!)
  if (place) images.push(place)
  const who = refs.map(id => { const c = plan.characters.find(x => x.id === id)!; return `${c.name}: ${c.canon}` })
  const uses = [
    refs.length > 1 ? 'the characters from these reference sheets, left to right' : refs.length ? 'the character from this reference sheet' : '',
    withProduct ? `the product in the photo ${place ? 'after the sheets' : 'at the right'}, exactly as it looks` : '',
    place ? 'the place in the photo at the right as the setting: its room or location, its materials and its light' : '',
  ].filter(Boolean)
  const lead = images.length
    ? `Use ${uses.join(' and ')}${refs.length ? `, keeping faces, builds and clothes exactly${who.length ? ` (${who.join('; ')})` : ''}` : ''}. Make a completely new picture: one single full-frame ${aspect} film frame, not a reference sheet, no gray backdrop.`
    : `One single full-frame ${aspect} film frame.`
  const prompt = `${plan.look} ${lead} ${plan.world ?? ''} ${shot.keyframe} ${NO_TEXT}`
  const atts = images.length ? [{ buffer: await compose(aspect, images), mediaType: 'image/jpeg' } as any] : []
  return picture([ctx.imageModel, ...(ctx.imageBackups ?? [])], prompt, atts, aspect, ctx, 'medium')
}

/** The first frame of a shot on the same set as an earlier one (plan.ts
 *  `sameSet`): an EDIT of that shot's first frame, changing only what the
 *  plan's `change` says, so the room, the camera and the light stay exactly
 *  where they were (a picture made from words alone re-imagines the room; the
 *  fan test, Oct 17, came out as five different rooms). The character sheets
 *  ride along so faces stay theirs. Needs an edit model that takes several
 *  pictures (`ctx.editModel`, else the picture model). */
export async function makeSetKeyframe(ctx: ProduceContext & { editModel?: ModelInfo }, plan: RemakePlan, shot: PlanShot, base: Buffer, sheets: Map<string, Buffer>, aspect: Aspect): Promise<Made> {
  const refs = shot.refs.filter(id => sheets.has(id))
  const who = refs.map(id => { const c = plan.characters.find(x => x.id === id)!; return `${c.name}: ${c.canon}` })
  const change = (shot.change ?? '').trim() || shot.keyframe
  const sheetNote = refs.length
    ? ` The ${refs.length > 1 ? 'people are the characters on the reference sheets that follow' : 'person is the character on the reference sheet that follows'}: keep face, hair and build exactly (${who.join('; ')}). A sheet is only a reference; the result is one single full-frame picture like the first one.`
    : ''
  const prompt = `Edit the first picture. Keep everything in it exactly as it is: the room, the floor, every object and where it is, the camera position and angle, the framing, the light and shadows, and the photo's look. Change only this: ${change}${sheetNote} ${NO_TEXT}`
  const atts = [base, ...refs.map(id => sheets.get(id)!)].map(b => ({ buffer: b, mediaType: 'image/jpeg' }) as any)
  return picture([ctx.editModel ?? ctx.imageModel, ...(ctx.editBackups ?? [])], prompt, atts, aspect, ctx, 'high')
}

/** A shot's clip from its first frame. `opts.lastFrame` pins the end as well
 *  (a model with start_end_frames, e.g. Wan 3.0): a still shot given the same
 *  picture at both ends cannot move its camera, which image-to-video alone
 *  does (Oct 16-17: Wan drifted up to 40 px in 4 s with "camera fixed" in
 *  the prompt; the first + last frame clips did not move). */
export async function makeClip(ctx: ProduceContext, shot: PlanShot, firstFrame: Buffer, aspect: Aspect,
  opts: { lastFrame?: Buffer; videoModel?: ModelInfo; audio?: boolean } = {}): Promise<Made> {
  const url = await ctx.sign(firstFrame, `shot-${shot.n}-${Date.now()}.jpg`)
  const base = shot.clip.trim()
  const sound = shot.sound?.trim() ? ` Sound: ${shot.sound.trim()}` : ''
  const prompt = `${base}${/no cuts\.?$/i.test(base) ? '' : ' No cuts.'}${sound} Keep every face, body and outfit exactly as in the first frame, and keep its look.`
  const atts: any[] = [{ buffer: firstFrame, mediaType: 'image/jpeg', url, port: 'first_frame' }]
  if (opts.lastFrame) atts.push({ buffer: opts.lastFrame, mediaType: 'image/jpeg', url: await ctx.sign(opts.lastFrame, `shot-${shot.n}-last-${Date.now()}.jpg`), port: 'last_frame' })
  const call = { userId: ctx.userId, surface: ctx.surface } as any
  try {
    const r: any = await generateVideo(opts.videoModel ?? ctx.videoModel, prompt, '720p', shot.clip_seconds, atts, undefined, call,
      { ...(opts.lastFrame ? { mode: 'start_end_frames' } : { aspect_ratio: aspect, mode: 'image_to_video' }), generate_audio: opts.audio ?? true, prompt_extend: false, watermark: false } as any)
    return { buffer: r.buffer, cost: r.cost ?? 0 }
  } catch (e) {
    // Another maker's image-to-video model from the first frame alone (its
    // shortest clip may be longer; the cut trims it).
    const backup = ctx.videoBackup
    if (!refused(e) || !backup) throw e
    console.warn(`[remake:produce] shot ${shot.n} clip refused, trying ${backup.model_name}: ${String((e as Error)?.message ?? e).slice(0, 160)}`)
    const min = Number((backup as any).output_config?.video?.durations_by_resolution?.['720p']?.min ?? 3)
    const r: any = await generateVideo(backup, prompt, '720p', Math.max(min, shot.clip_seconds), [atts[0]], undefined, call,
      { aspect_ratio: aspect, mode: 'image_to_video', generate_audio: opts.audio ?? true, watermark: false } as any)
    return { buffer: r.buffer, cost: r.cost ?? 0 }
  }
}

export async function makeVoice(ctx: ProduceContext, v: PlanVoice): Promise<Made> {
  const r: any = await generateSpeech(ctx.speechModel, v.text, { voice: v.voice, style: v.style.slice(0, 300), format: 'mp3' } as any, { userId: ctx.userId, surface: ctx.surface } as any)
  return { buffer: r.buffer, cost: r.cost ?? 0 }
}

/** A clip's last frame, for the shot that continues it. */
export async function lastFrame(ffmpeg: string, clip: Buffer): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'remake-lf-'))
  try {
    await fs.writeFile(path.join(dir, 'in.mp4'), clip)
    await run(ffmpeg, ['-v', 'error', '-y', '-sseof', '-0.1', '-i', path.join(dir, 'in.mp4'), '-frames:v', '1', '-q:v', '2', path.join(dir, 'last.jpg')])
    return await fs.readFile(path.join(dir, 'last.jpg'))
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}
