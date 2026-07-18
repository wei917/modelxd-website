// scripts/generate-template-previews.ts
//
// Batch-generate beautiful preview images for the XCreate template picker.
//
// For each template in app/xcreate/templates.ts we craft a cinematic,
// IP-safe prompt, generate a hero image with OpenAI gpt-image-2, then
// crop + downscale it to the card's target aspect ratio with sharp and
// write public/templates/<id>.jpg.
//
// Why a script (vs hand-running each template): it's reusable and
// idempotent — re-run any time the template set changes, and only the
// ids you pass get regenerated. Uses OPENAI_API_KEY from .env.local.
//
// Usage:
//   npx tsx scripts/generate-template-previews.ts                 # all
//   npx tsx scripts/generate-template-previews.ts titanic-bow ... # subset
//   QUALITY=high npx tsx scripts/generate-template-previews.ts    # bump quality
//
// Output: public/templates/<id>.jpg  (≈ 480×270, 270×480, or 400×400)

import fs from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import OpenAI from 'openai'
import { XCREATE_TEMPLATES } from '../app/xcreate/templates'

// Load .env.local without a dotenv dependency (project convention is
// .env.local). Only sets keys not already in the environment.
;(() => {
  try {
    for (const line of readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* fine if missing */ }
})()

const OUT_DIR = path.join(process.cwd(), 'public', 'templates')
const MODEL   = 'gpt-image-2'
const QUALITY = (process.env.QUALITY as 'low' | 'medium' | 'high') ?? 'high'

// gpt-image-2 only accepts these three sizes; we generate at the nearest
// orientation then crop to the card's exact ratio.
type Gen = { genSize: '1024x1024' | '1536x1024' | '1024x1536'; outW: number; outH: number }
function planFor(aspect: string | undefined): Gen {
  switch (aspect) {
    case '9:16': return { genSize: '1024x1536', outW: 270, outH: 480 }
    case '1:1':  return { genSize: '1024x1024', outW: 400, outH: 400 }
    default:     return { genSize: '1536x1024', outW: 480, outH: 270 } // 16:9 + fallback
  }
}

// Aspect per template: explicit aspectRatio, else infer from slotMode.
function aspectOf(t: (typeof XCREATE_TEMPLATES)[number]): string {
  if (t.aspectRatio) return t.aspectRatio
  if (t.mode === 'image' || t.mode === 'text') return '1:1'
  return '16:9'
}

// Hand-tuned visual prompts. Goal: look like a real, premium result a user
// would proudly produce — NOT an icon. No celebrities / trademarks / on-image
// text (IP-safe, matches the project's "evocative title, generic prompt"
// pattern). Generic stand-in people for the character-swap cards.
const QUALITY_SUFFIX =
  ' Photorealistic, cinematic lighting, shallow depth of field, rich color grade, ' +
  'highly detailed, professional photography, no text, no watermark, no logos, no captions.'

const STYLE_SUFFIX =
  ' Single subject, clean composition, gallery-quality, no text, no watermark, no logos.'

const PROMPTS: Record<string, string> = {
  // ── Character-swap scenes (generic stand-in people) ──
  'titanic-bow':
    'An Edwardian ocean liner at golden hour, two ordinary people standing at the bow with arms outstretched, ' +
    'warm sunset light flaring off the sea, cinematic wide shot.' + QUALITY_SUFFIX,
  'diner-dance':
    'Two people doing the twist on the black-and-white checkered floor of a vintage 1950s American diner, ' +
    'glowing neon signs and a jukebox behind them, joyful energy, cinematic medium shot.' + QUALITY_SUFFIX,
  'royal-throne':
    'A person seated on an ornate iron medieval throne in a candlelit great hall, regal furs and crown, ' +
    'dramatic shadows, slow cinematic push-in framing.' + QUALITY_SUFFIX,
  'astronaut-moon':
    'An astronaut in a white spacesuit planting a flag on the lunar surface, Earth rising on the horizon, ' +
    'golden light catching the visor, cinematic wide shot.' + QUALITY_SUFFIX,
  'concert-stage':
    'A solo performer on a concert stage lit by a single spotlight, a silhouetted crowd holding phone lights, ' +
    'dramatic haze, vertical cinematic framing.' + QUALITY_SUFFIX,

  // ── Motion templates ──
  'cinematic-transition':
    'A cinematic split scene blending a misty mountain dawn into a neon city night, ' +
    'dramatic lighting, sense of motion and transition.' + QUALITY_SUFFIX,
  'landscape-timelapse':
    'A cinematic coastal sunset time-lapse, golden hour, soft clouds streaking across an empty horizon, ' +
    'long-exposure motion in the sky.' + QUALITY_SUFFIX,

  // ── Image style cards (restyled portrait look) ──
  'style-watercolor-anime':
    'A hand-painted watercolor anime portrait of a young person, soft pastel tones, whimsical natural elements, ' +
    'dreamy storybook atmosphere, gentle lighting.' + STYLE_SUFFIX,
  'style-3d-animated':
    'A 3D animated feature-film portrait of a friendly character with expressive big eyes and smooth shading, ' +
    'polished cinematic lighting, vivid family-friendly palette.' + STYLE_SUFFIX,
  'style-anime-portrait':
    'A Japanese anime portrait of a young person, clean line work, expressive large eyes, vibrant cel-shaded ' +
    'colors, dynamic hair detail.' + STYLE_SUFFIX,
  'style-oil-painting':
    'A classical Renaissance-style oil painting portrait, rich textured brushstrokes, dramatic chiaroscuro ' +
    'lighting, deep warm earth tones, museum quality.' + STYLE_SUFFIX,
  'style-vintage-polaroid':
    'A vintage 1970s Polaroid photograph of a person, soft faded warm colors, fine film grain, slight ' +
    'chromatic vignetting, instant-film border.' + STYLE_SUFFIX,
  'style-cyberpunk-neon':
    'A cyberpunk neon portrait of a person, magenta and cyan rim lighting, rain-slicked street reflections, ' +
    'holographic signage glowing behind them, high contrast.' + STYLE_SUFFIX,

  // ── Image / text cards ──
  'concept-art':
    'High-detail concept art of a cyberpunk Taipei street at night, dense neon signage, light rain, ' +
    'anamorphic lens flares, moody atmosphere.' + QUALITY_SUFFIX,
  'reasoning-compare':
    'A clean conceptual illustration of two glowing speech bubbles facing off on a soft gradient background, ' +
    'minimal, modern, abstract representation of comparing ideas.' + STYLE_SUFFIX,
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

async function generateOne(t: (typeof XCREATE_TEMPLATES)[number]): Promise<void> {
  const prompt = PROMPTS[t.id]
  if (!prompt) { console.warn(`! no prompt for ${t.id}, skipping`); return }

  const { genSize, outW, outH } = planFor(aspectOf(t))
  process.stdout.write(`→ ${t.id.padEnd(24)} ${genSize} → ${outW}×${outH} … `)

  const resp = await client.images.generate({
    model: MODEL, prompt, size: genSize, quality: QUALITY, n: 1,
  })
  const item: any = (resp.data ?? [])[0] ?? {}
  let raw: Buffer
  if (item.b64_json) raw = Buffer.from(item.b64_json, 'base64')
  else if (item.url) raw = Buffer.from(await (await fetch(item.url)).arrayBuffer())
  else throw new Error(`no image returned for ${t.id}: ${JSON.stringify(resp).slice(0, 300)}`)

  const outPath = path.join(OUT_DIR, `${t.id}.jpg`)
  await sharp(raw)
    .resize(outW, outH, { fit: 'cover', position: 'attention' })
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(outPath)

  const { size } = await fs.stat(outPath)
  console.log(`ok (${Math.round(size / 1024)} KB)`)
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true })
  const ids = process.argv.slice(2)
  const list = ids.length
    ? XCREATE_TEMPLATES.filter(t => ids.includes(t.id))
    : XCREATE_TEMPLATES
  if (!list.length) { console.error('no matching templates'); process.exit(1) }

  console.log(`Generating ${list.length} preview(s) with ${MODEL} (quality=${QUALITY})\n`)
  for (const t of list) {
    try { await generateOne(t) }
    catch (e: any) { console.error(`✗ ${t.id}: ${e?.message ?? e}`) }
  }
  console.log(`\nDone → ${OUT_DIR}`)
}

main().catch(e => { console.error(e); process.exit(1) })
