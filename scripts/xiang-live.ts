// scripts/xiang-live.ts — one real run of 相學館's server steps (lib/xiang-scan.ts)
// on made-up test photos: the check, then the reading. ~$0.12 for one person;
// with `pair`, the other person's photos too (partner-face.png,
// partner-left.png, partner-right.png in the same dir), ~$0.2.
//   npx tsx --env-file=.env.local scripts/xiang-live.ts <dir with face.png left.png right.png> [lang] [pair]
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { checkPhotos, readPhotos } from '../lib/xiang-scan'
import type { Photo, XiangPerson } from '../lib/xiang'

async function load(dir: string, who: 'me' | 'partner', only?: string[]): Promise<Photo[]> {
  const out: Photo[] = []
  for (const key of ['face', 'left', 'right'] as const) {
    const f = path.join(dir, `${who === 'partner' ? 'partner-' : ''}${key}.png`)
    if (fs.existsSync(f) && (!only || only.includes(key))) out.push({ key, who, buffer: await sharp(fs.readFileSync(f)).resize(1280, 1280, { fit: 'inside' }).jpeg({ quality: 85 }).toBuffer(), mediaType: 'image/jpeg' })
  }
  return out
}

async function main() {
  const dir = process.argv[2], lang = process.argv[3] ?? 'zh-Hant', pair = process.argv[4] === 'pair'
  // A pair run keeps the visitor to a face and a palm, so it costs about what one person's full set does.
  const photos = await load(dir, 'me', pair ? ['face', 'left'] : undefined), theirs = pair ? await load(dir, 'partner') : []
  let t0 = Date.now()
  const [checks, partnerChecks] = await Promise.all([checkPhotos(photos, lang, 'xiang-live-test'), checkPhotos(theirs, lang, 'xiang-live-test')])
  console.log('checks', JSON.stringify(checks), pair ? `partner ${JSON.stringify(partnerChecks)}` : '', `${Date.now() - t0} ms`)
  t0 = Date.now()
  const chart = await readPhotos(photos, { gender: 'male', dominant: 'right' }, lang, 'xiang-live-test', pair ? { who: { gender: 'female', dominant: 'right' }, photos: theirs } : undefined)
  const parts = (p?: XiangPerson | null) => (p ? (['face', 'left', 'right'] as const).filter(k => p[k]).map(k => (k === 'face' ? k : `${k}(${p[k]!.lines.length} lines)`)).join(' ') || 'none' : 'none')
  console.log('read', chart ? `${chart.model}; you: ${parts(chart)}${pair ? `; them: ${parts(chart.partner)}` : ''}` : 'FAILED', `${Date.now() - t0} ms`)
  if (chart) fs.writeFileSync(path.join(dir, `live-${lang}${pair ? '-pair' : ''}.json`), JSON.stringify(chart, null, 2))
}
main().catch(e => { console.error(e); process.exit(1) })
