// lib/xsports-cheer-models.ts — which models make 晴晴's fresh photos and
// clips (owner, Oct 16: "we should always have a list and randomly use one
// to generate image or video ... so we know which models are better"; "you
// should use a different way to fetch the list so we don't have to push
// changes anytime. maybe just a json on a public bucket"). The lists are a
// JSON file in her folder of the public x-characters bucket, read at most
// once a minute, so they change without a deploy:
//
//   { "photo": ["google/gemini-3.1-flash-image", ...],
//     "clip":  ["alibaba/happyhorse-1.1-i2v", ...] }
//
// Each entry is provider/model_name in ai_models. Only rows that can do the
// job are used: enabled and not blocked for xsports; a photo model takes a
// reference photo (her face); a clip model is image to video WITH SOUND
// (owner, Oct 16: "please use models with audio support") and takes the
// asked length. A missing or broken file falls back to DEFAULT_MODELS. Each
// ask shuffles its list and the next one tries when one fails
// (lib/xsports-cheer-fresh). Server-only.

import { getModelByProviderName } from './models'
import { CHEER_MEDIA_DIR } from './xsports-cheer-media'
import { publicBase, usable } from './xsports-cheer'

export const MODELS_FILE = `${CHEER_MEDIA_DIR}/models.json`

/** The lists when the file cannot be read (and the file's first content). */
export const DEFAULT_MODELS = {
  photo: [
    'google/gemini-3.1-flash-image',
    'openai/gpt-image-2.5-flare',
    'xai/grok-imagine-image-2.0',
    'alibaba/qwen-image-2.0-pro',
    'openai/gpt-image-2',
  ],
  clip: [
    'alibaba/happyhorse-1.1-i2v',
    'google/gemini-omni-1.1-flash',
    'alibaba/wan3.0-video',
    'minimax/MiniMax-H3',
  ],
}

type Lists = { photo: string[]; clip: string[] }
const ENTRY = /^[a-z0-9-]+\/[A-Za-z0-9._-]+$/
const clean = (v: unknown): string[] | null => (Array.isArray(v) && v.length && v.every(x => typeof x === 'string' && ENTRY.test(x)) ? [...new Set(v as string[])] : null)

let held: { at: number; lists: Lists } | null = null
/** The lists, from the file (a minute's cache), else DEFAULT_MODELS. */
export async function cheerLists(now = Date.now()): Promise<Lists> {
  if (held && now - held.at < 60_000) return held.lists
  let lists: Lists = DEFAULT_MODELS
  try {
    const res = await fetch(`${publicBase()}/${MODELS_FILE}`, { cache: 'no-store' })
    if (res.ok) {
      const j = await res.json()
      lists = { photo: clean(j?.photo) ?? DEFAULT_MODELS.photo, clip: clean(j?.clip) ?? DEFAULT_MODELS.clip }
    }
  } catch { /* the defaults */ }
  held = { at: now, lists }
  return lists
}

/** The shape her pictures and a clip's first frame take. */
export type FrameRatio = '2:3' | '3:4' | '9:16'
export const FRAME_PX: Record<FrameRatio, [number, number]> = { '2:3': [720, 1080], '3:4': [720, 960], '9:16': [720, 1280] }
const ratioOf = (r: string) => { const [w, h] = r.split(':').map(Number); return w / h }
const PORTRAIT: FrameRatio[] = ['2:3', '3:4', '9:16']
const nearest = <T,>(xs: T[], value: (x: T) => number, want: number): T => xs.reduce((a, b) => (Math.abs(value(b) - want) < Math.abs(value(a) - want) ? b : a))

/** How a photo model is asked for a picture of this shape: a size tier and
 *  a ratio where it takes ratios, else its nearest portrait size. */
export function photoParams(m: any, ratio: FrameRatio): { size: string; aspect_ratio?: string } {
  const img = m?.output_config?.image ?? {}
  const sizes: string[] = Array.isArray(img.sizes) ? img.sizes : []
  const ratios: string[] = Array.isArray(img.aspect_ratios) ? img.aspect_ratios : []
  const tier = sizes.find(s => /^(1024|1k)$/i.test(s)) ?? sizes.find(s => /^\d+k?$/i.test(s))
  if (tier && ratios.includes(ratio)) return { size: tier, aspect_ratio: ratio }
  const dims = sizes.filter(s => /^\d+x\d+$/.test(s)).map(s => { const [w, h] = s.split('x').map(Number); return { s, r: w / h } }).filter(d => d.r < 1)
  if (dims.length) return { size: nearest(dims, d => d.r, ratioOf(ratio)).s }
  const portrait = ratios.filter(r => ratioOf(r) < 1)
  if (portrait.length) return { size: tier ?? '1024', aspect_ratio: nearest(portrait, ratioOf, ratioOf(ratio)) }
  return { size: '1024x1536' }
}

/** How a clip model is asked: its 720p-ish size, the frame shape it takes
 *  (the portrait nearest 2:3 it offers), and whether it takes `seconds`. */
export function clipParams(m: any, seconds: number): { size: string; ratio: FrameRatio; fits: boolean } {
  const v = m?.output_config?.video ?? {}
  const sizes: string[] = Array.isArray(v.sizes) ? v.sizes : []
  const size = sizes.find(s => /^720p$/i.test(s)) ?? sizes.find(s => parseInt(s, 10) >= 720) ?? '720p'
  const offered = (Array.isArray(v.aspect_ratios) ? v.aspect_ratios : []).filter((r: string) => (PORTRAIT as string[]).includes(r)) as FrameRatio[]
  const ratio: FrameRatio = offered.length ? nearest(offered, ratioOf, ratioOf('2:3')) : '2:3'
  const byRes = v.durations_by_resolution ?? {}
  const key = Object.keys(byRes).find(k => k.toLowerCase() === size.toLowerCase())
  const d = key ? byRes[key] : null
  const fits = !d ? true : Array.isArray(d) ? d.includes(seconds) : (seconds >= (d.min ?? 0) && seconds <= (d.max ?? 99))
  return { size, ratio, fits }
}

const rows = new Map<string, { at: number; m: any }>()
async function row(entry: string): Promise<any> {
  const hit = rows.get(entry)
  if (hit && Date.now() - hit.at < 300_000) return hit.m
  const [provider, ...rest] = entry.split('/')
  const m = await getModelByProviderName(provider, rest.join('/')).catch(() => null)
  rows.set(entry, { at: Date.now(), m })
  return m
}

const shuffle = <T,>(xs: T[], rand: () => number): T[] => {
  const out = [...xs]
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]] }
  return out
}

/** This ask's photo models, in the order to try. */
export async function drawPhotoModels(rand: () => number = Math.random): Promise<any[]> {
  const ms = await Promise.all((await cheerLists()).photo.map(row))
  return shuffle(ms.filter(m => usable(m) && (m.output_modalities ?? []).includes('image')
    && (m.modes ?? []).some((x: string) => x === 'image_edit' || x === 'reference_frames')), rand)
}

/** This ask's clip models, in the order to try: image to video with sound
 *  that take `seconds`. */
export async function drawClipModels(seconds: number, rand: () => number = Math.random): Promise<any[]> {
  const ms = await Promise.all((await cheerLists()).clip.map(row))
  return shuffle(ms.filter(m => usable(m) && (m.output_modalities ?? []).includes('video')
    && (m.modes ?? []).includes('image_to_video') && m.output_config?.video?.audio === true
    && clipParams(m, seconds).fits), rand)
}

/** provider/model_name, as the lists and the jobs name a model. */
export const modelKey = (m: any) => `${m.provider}/${m.model_name}`

/** A model's name as people read it (its display name), by its key. */
export async function modelLabel(key: string | null): Promise<string | null> {
  if (!key || !ENTRY.test(key)) return null
  const m = await row(key)
  return m?.display_name ?? key.split('/').slice(1).join('/')
}
