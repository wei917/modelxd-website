// scripts/generate-tarot-back.ts — the back of XTell's tarot cards (owner,
// Oct 1: "can your cards have ModelXD logo at the back", "not just put logo
// there. need to merge fuse with tarot style").
//
//   npx tsx scripts/generate-tarot-back.ts <out-dir> a b c d
//
// gpt-image-2 edits, with public/logo.png as the reference, quality high,
// 1024x1536: ~$0.25 a draft. Drafts land in <out-dir> for the owner to pick;
// the chosen one is cropped to the card and saved as
// public/xtell/tarot-back.webp by hand.
//
// A tarot back must read the same upside down, or the back would tell which
// cards are reversed: every prompt asks for 180-degree symmetry.

import fs from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import OpenAI, { toFile } from 'openai'

;(() => {
  try {
    for (const line of readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* fine */ }
})()

const BASE = 'Design the BACK of a tarot card, seen flat and straight on, filling the whole image: no table, no hands, ' +
  'no perspective, no shadow around it. Vintage tarot card-back style of the early 1900s, fine engraved gold linework ' +
  'on deep night blue, printed-card feel. Fuse the attached ModelXD logo into the design as its central emblem, ' +
  'redrawn in the same engraved tarot style (not pasted on): keep its silver four-pointed star at the very centre, ' +
  'its two crossed blades (one vermilion red, one cobalt blue) and its curved crescent arcs, so the logo is still ' +
  'recognisable. The whole card must look identical when turned upside down (180-degree rotational symmetry), so ' +
  'arrange the red and blue elements symmetrically for that. A gold double border runs around the card edge. ' +
  'No text, no letters, no numbers, no words, no watermark.'

const PROMPTS: Record<string, string> = {
  a: BASE + ' Concept: celestial. The emblem sits inside a gold ring with a waxing crescent moon above and a waning ' +
    'crescent below it; a field of tiny gold stars and fine constellation lines fills the night blue around it.',
  b: BASE + ' Concept: Art Nouveau, like the era of the 1909 deck. A fine repeating lattice of tiny four-pointed stars ' +
    'covers the background; the emblem sits in an oval medallion framed by flowing vines and sun rays that mirror at ' +
    'the top and the bottom.',
  c: BASE + ' Concept: swords. The two blades of the logo become two long crossed swords running corner to corner ' +
    'behind the central star, a vermilion hilt and a cobalt hilt at opposite corners, with laurel ornaments in the ' +
    'other two corners.',
  d: BASE + ' Concept: compass and zodiac. The emblem sits at the centre of an eight-point gold compass rose, ringed by ' +
    'a thin band of twelve small zodiac glyph-like ornaments (abstract marks, not readable text), with small suns in ' +
    'two opposite corners and small moons in the other two.',
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

async function main() {
  const [outDir, ...ids] = process.argv.slice(2)
  const want = ids.filter(id => PROMPTS[id])
  if (!outDir || !want.length) { console.error('usage: <out-dir> ' + Object.keys(PROMPTS).join(' ')); process.exit(1) }
  await fs.mkdir(outDir, { recursive: true })
  const logo = await fs.readFile(path.join(process.cwd(), 'public', 'logo.png'))
  for (const id of want) {
    process.stdout.write(`→ ${id} … `)
    const resp = await client.images.edit({ model: 'gpt-image-2', image: await toFile(logo, 'logo.png', { type: 'image/png' }), prompt: PROMPTS[id], size: '1024x1536', quality: 'high', n: 1 })
    const item: any = (resp.data ?? [])[0] ?? {}
    const raw = item.b64_json ? Buffer.from(item.b64_json, 'base64') : item.url ? Buffer.from(await (await fetch(item.url)).arrayBuffer()) : null
    if (!raw) throw new Error(`no image for ${id}`)
    const out = path.join(outDir, `tarot-back-${id}.png`)
    await fs.writeFile(out, raw)
    const u: any = (resp as any).usage
    console.log(`ok (${Math.round(raw.length / 1024)} KB${u ? `, tokens in ${u.input_tokens} out ${u.output_tokens}` : ''})`)
  }
}
main().catch(e => { console.error(e?.message ?? e); process.exit(1) })
