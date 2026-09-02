// scripts/generate-xtell-covers.ts — temple covers for the XTell street.
//
//   npx tsx scripts/generate-xtell-covers.ts guandi simianfo
//
// Same rig as generate-template-previews.ts (gpt-image-2 → sharp → jpg),
// in the house art language for this page: ink-wash, painterly, no robots,
// no text. Each cover is ~$0.25 at quality=high. Only the ids passed are
// regenerated; the three original covers were made the same way by hand.

import fs from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import OpenAI from 'openai'

;(() => {
  try {
    for (const line of readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* fine */ }
})()

const OUT_DIR = path.join(process.cwd(), 'public', 'xtell')
const STYLE = ' Traditional Chinese ink-wash painting (水墨), loose expressive brushwork on aged rice paper, ' +
  'a single restrained accent of vermilion, generous negative space, painterly, atmospheric, ' +
  'no text, no calligraphy characters, no watermark, no logos, no robots, no digital look.'

const PROMPTS: Record<string, string> = {
  guandi:
    'The inner hall of a Guan Di temple in Taiwan seen from the worshipper\'s side: a tall bronze incense ' +
    'burner in the foreground with thin smoke rising, a bamboo cylinder of fortune sticks (籤筒) and a pair of ' +
    'crescent divination blocks (筊杯) resting on the altar table, red lanterns dissolving into ink at the top, ' +
    'the seated statue suggested only as a dark red-robed silhouette in the mist behind the altar, long beard, ' +
    'no face detail.' + STYLE,
  simianfo:
    'The Erawan shrine at dusk: a small golden four-faced Brahma statue under an ornate Thai spired pavilion, ' +
    'surrounded by heaps of yellow marigold garlands, jasmine strings, lit candles and incense, a few ' +
    'worshippers as soft ink silhouettes with hands pressed together, warm gold light melting into ink wash, ' +
    'traditional Thai dancers faintly suggested at the edge.' + STYLE,
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

async function main() {
  const ids = process.argv.slice(2).filter(id => PROMPTS[id])
  if (!ids.length) { console.error('pass ids: ' + Object.keys(PROMPTS).join(' ')); process.exit(1) }
  await fs.mkdir(OUT_DIR, { recursive: true })
  for (const id of ids) {
    process.stdout.write(`→ ${id} … `)
    const resp = await client.images.generate({ model: 'gpt-image-2', prompt: PROMPTS[id], size: '1536x1024', quality: 'high', n: 1 })
    const item: any = (resp.data ?? [])[0] ?? {}
    const raw = item.b64_json ? Buffer.from(item.b64_json, 'base64')
      : item.url ? Buffer.from(await (await fetch(item.url)).arrayBuffer())
      : null
    if (!raw) throw new Error(`no image for ${id}`)
    const out = path.join(OUT_DIR, `${id}.jpg`)
    await sharp(raw).resize(1200, 675, { fit: 'cover', position: 'attention' }).jpeg({ quality: 84, mozjpeg: true }).toFile(out)
    console.log(`ok (${Math.round((await fs.stat(out)).size / 1024)} KB)`)
  }
}
main().catch(e => { console.error(e?.message ?? e); process.exit(1) })
