// scripts/xiang-model-test.ts — 相學館 model test (Oct 6, owner: "we need to
// test first"; "use AI generated face and palms photos").
//
//   npx tsx --env-file=.env.local scripts/xiang-model-test.ts --photos   # three test photos (GPT Image 2, ~$0.25)
//   npx tsx --env-file=.env.local scripts/xiang-model-test.ts [models…]  # each model reads them (~$0.05-0.20 each)
//
// The photos are made up (no real person). Each candidate reads all three
// into the 相盤 JSON the room uses (lib/xiang.ts): the features in words and
// points along each palm line. Results land in OUT as <model>.json with the
// cost and the time; scripts/xiang-draw.py draws the lines for a look.

import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { streamText, generateImage } from '../lib/providers'
import { getModelByProviderName } from '../lib/models'
import { readerSystem, readerPrompt, checkSystem, checkPrompt, parseJson, type XiangPhotoKey } from '../lib/xiang'

const OUT = process.env.XIANG_OUT ?? path.join(process.cwd(), '.xiang-test')
fs.mkdirSync(OUT, { recursive: true })

const PHOTOS: Record<XiangPhotoKey, string> = {
  face: 'Photorealistic head-and-shoulders portrait photo of a fictional Taiwanese man in his thirties (not a real person), looking straight into the camera, neutral relaxed expression, short hair kept off the forehead so the hairline, both eyebrows and both ears are visible, no glasses, even soft daylight from the front, plain light grey background, sharp focus, natural skin, no retouching, centered.',
  // Seen palm-on with the fingers up, a hand's thumb is on its own side (a left palm's on the
  // left). Until Oct 8 these two said the opposite, so the Oct 6 test photos named left.png and
  // right.png show the other hand.
  left: 'Photorealistic close-up photo of an adult\'s LEFT hand held up to the camera with the PALM facing the camera, five fingers straight and slightly apart, the thumb on the LEFT side of the picture, the whole hand from fingertips to wrist inside the frame, the palm creases clearly visible (life line curving around the thumb mound, head line across the middle, heart line under the fingers, a faint fate line up the centre), even soft daylight, plain light background, sharp focus, natural skin.',
  right: 'Photorealistic close-up photo of an adult\'s RIGHT hand held up to the camera with the PALM facing the camera, five fingers straight and slightly apart, the thumb on the RIGHT side of the picture, the whole hand from fingertips to wrist inside the frame, the palm creases clearly visible (life line curving around the thumb mound, head line across the middle, heart line under the fingers, a faint fate line up the centre), even soft daylight, plain light background, sharp focus, natural skin.',
}

const READERS: Array<[string, string]> = [
  ['openai', 'gpt-6-astra'], ['openai', 'gpt-6.1-sol'],
  ['anthropic', 'claude-fable-5-1'], ['anthropic', 'claude-opus-5-5'], ['anthropic', 'claude-sonnet-5'],
  ['google', 'gemini-3.1-pro-preview'], ['google', 'gemini-3.8-flash'],
  ['xai', 'grok-4.7'], ['alibaba', 'qwen3.6-plus'],
]
const CHECKERS: Array<[string, string]> = [['google', 'gemini-3.1-flash-lite'], ['openai', 'gpt-6-luna'], ['alibaba', 'qwen3.6-plus']]

async function photos() {
  const model = await getModelByProviderName('openai', 'gpt-image-2')
  if (!model) throw new Error('gpt-image-2 not in the catalog')
  let total = 0
  for (const [key, prompt] of Object.entries(PHOTOS) as Array<[XiangPhotoKey, string]>) {
    const r = await generateImage(model, prompt, 'high', '1024x1536', [], null, null, { userId: undefined } as any)
    fs.writeFileSync(path.join(OUT, `${key}.png`), r.buffer)
    total += r.cost ?? 0
    console.log(`${key}: ${(r.buffer.length / 1024).toFixed(0)} KB, $${(r.cost ?? 0).toFixed(4)}`)
  }
  console.log(`photos: $${total.toFixed(4)}`)
}

/** What the browser sends: the longest side at 1280 px, JPEG. */
async function jpeg(key: XiangPhotoKey) {
  const file = path.join(OUT, `${key}.png`)
  if (!fs.existsSync(file)) return null
  return sharp(fs.readFileSync(file)).resize(1280, 1280, { fit: 'inside' }).jpeg({ quality: 85 }).toBuffer()
}

function call(model: any, system: string, text: string, images: Buffer[], thinking: string | null): Promise<{ text: string; cost: number; ms: number; error?: string }> {
  const t0 = Date.now()
  let out = ''
  return new Promise(resolve => {
    streamText(model, [{ role: 'user', content: text }], {
      onDelta: d => { out += d },
      onDone: r => resolve({ text: out, cost: r.cost ?? 0, ms: Date.now() - t0 }),
      onError: m => resolve({ text: out, cost: 0, ms: Date.now() - t0, error: m }),
    }, images.map(buffer => ({ buffer, mediaType: 'image/jpeg' })), undefined, { system, thinking }).catch(e => resolve({ text: out, cost: 0, ms: Date.now() - t0, error: String(e?.message ?? e) }))
  })
}

async function read(only: string[]) {
  const keys: XiangPhotoKey[] = ['face', 'left', 'right']
  const imgs = (await Promise.all(keys.map(jpeg))).map((b, i) => [keys[i], b] as const).filter((x): x is readonly [XiangPhotoKey, Buffer] => !!x[1])
  if (!imgs.length) throw new Error(`no photos in ${OUT}; run --photos first`)
  const have = imgs.map(([k]) => k)
  let total = 0
  const list = only.length ? [...READERS, ...CHECKERS].filter(([, n]) => only.includes(n)) : READERS
  for (const [provider, name] of list) {
    const model = await getModelByProviderName(provider, name)
    if (!model) { console.log(`${name}: not in the catalog`); continue }
    const levels: string[] = (model as any).output_config?.text?.thinking_levels ?? []
    const thinking = provider === 'alibaba' ? 'thinking_false' : null
    const r = await call(model, readerSystem('zh-Hant'), readerPrompt(have, { gender: 'male', dominant: 'right' }, 'zh-Hant'), imgs.map(([, b]) => b), thinking)
    total += r.cost
    const parsed = parseJson(r.text)
    fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ model: name, ms: r.ms, cost: r.cost, error: r.error ?? null, levels, parsed, raw: parsed ? undefined : r.text }, null, 2))
    console.log(`${name}: ${r.error ? 'ERROR ' + r.error.slice(0, 120) : parsed ? 'json ok' : 'NO JSON: ' + r.text.slice(0, 160).replace(/\s+/g, ' ')} · ${(r.ms / 1000).toFixed(1)} s · $${r.cost.toFixed(4)}`)
  }
  // The quick check, per photo, on the cheap models.
  if (!only.length || CHECKERS.some(([, n]) => only.includes(n))) {
    for (const [provider, name] of CHECKERS.filter(([, n]) => !only.length || only.includes(n))) {
      const model = await getModelByProviderName(provider, name)
      if (!model) { console.log(`${name}: not in the catalog`); continue }
      for (const [key, buf] of imgs) {
        const r = await call(model, checkSystem('zh-Hant'), checkPrompt(key, 'zh-Hant'), [buf], provider === 'alibaba' ? 'thinking_false' : null)
        total += r.cost
        console.log(`check ${name} ${key}: ${r.error ? 'ERROR ' + r.error.slice(0, 100) : r.text.replace(/\s+/g, ' ').slice(0, 200)} · ${(r.ms / 1000).toFixed(1)} s · $${r.cost.toFixed(5)}`)
      }
    }
  }
  console.log(`total: $${total.toFixed(4)}`)
}

const args = process.argv.slice(2)
;(args.includes('--photos') ? photos() : read(args.filter(a => !a.startsWith('--')))).catch(e => { console.error(e); process.exit(1) })
