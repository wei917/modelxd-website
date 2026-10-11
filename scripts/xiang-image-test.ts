// scripts/xiang-image-test.ts — 相學館: image models drawing the palm lines
// onto the photo themselves (owner, Oct 6: GPT Image 2 "is very good at
// this"; "try couple image models"). Same instruction for every model.
//   npx tsx --env-file=.env.local scripts/xiang-image-test.ts <dir> <left|right> <provider/model@quality> …
// Writes img-<model>-<palm>.png in <dir>.

import fs from 'node:fs'
import path from 'node:path'
import { generateImage } from '../lib/providers'
import { getModelByProviderName } from '../lib/models'

const [dir, palm, ...specs] = process.argv.slice(2)
const PROMPT = (hand: string) => `This is a photo of a person's ${hand} palm. Keep the photo exactly as it is (same hand, same pose, same light, same background) and only draw on top of it: trace the main palm creases precisely along the real lines in the skin. Life line (the curve around the base of the thumb) in red, head line (across the middle of the palm) in blue, heart line (below the fingers, from the little-finger edge) in magenta, fate line (from the wrist up toward the middle finger, only if visible) in green. Thin smooth strokes with a soft white outline. Next to each line a small white rounded label in Traditional Chinese: 生命線, 智慧線, 感情線, 事業線. Nothing else added.`

async function one(spec: string, photo: Buffer) {
  const [pm, quality] = spec.split('@')
  const [provider, name] = pm.split('/')
  const model = await getModelByProviderName(provider, name)
  if (!model) return { spec, error: 'not in the catalog' }
  const t0 = Date.now()
  try {
    const r = await generateImage(model, PROMPT(palm), (quality || 'high') as any, '1024x1536', [{ buffer: photo, mediaType: 'image/png' }], null, null, { userId: undefined } as any)
    fs.writeFileSync(path.join(dir, `img-${name}-${palm}.png`), r.buffer)
    return { spec, ms: Date.now() - t0, cost: r.cost ?? 0 }
  } catch (e: any) {
    return { spec, ms: Date.now() - t0, error: String(e?.message ?? e).slice(0, 200) }
  }
}

async function main() {
  const photo = fs.readFileSync(path.join(dir, `${palm}.png`))
  const results = await Promise.all(specs.map(s => one(s, photo)))
  let total = 0
  for (const r of results as any[]) {
    total += r.cost ?? 0
    console.log(`${r.spec} ${palm}: ${r.error ? 'ERROR ' + r.error : 'ok'} · ${((r.ms ?? 0) / 1000).toFixed(0)} s · $${(r.cost ?? 0).toFixed(4)}`)
  }
  console.log(`total: $${total.toFixed(4)}`)
}
main().catch(e => { console.error(e); process.exit(1) })
