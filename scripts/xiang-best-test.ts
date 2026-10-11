// scripts/xiang-best-test.ts — 相學館's palm lines with each model at a stated
// thinking level (owner, Oct 6: "try their best"; the house rule is each
// model's lowest and highest setting, never its default). One palm per call;
// Gemini in its own [y, x] format, the others [x, y]; all 0-1000.
//   npx tsx --env-file=.env.local scripts/xiang-best-test.ts <dir> <left|right> <provider/model@level> …
// Writes best-<model>@<level>-<palm>.json in <dir>.

import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { streamText } from '../lib/providers'
import { getModelByProviderName } from '../lib/models'
import { parseJson, LINE_KEYS, type LineKey, type Pt } from '../lib/xiang'

const [dir, palm, ...specs] = process.argv.slice(2)
const ASK = (hand: string, fmt: string) => `This is a photo of a person's ${hand} palm, palm facing the camera.
Point along each of its main palm creases, exactly on the crease line in the skin:
- life: the curved crease around the base of the thumb
- head: the crease running across the middle of the palm
- heart: the crease below the fingers, from the little-finger edge
- fate: the crease from the wrist up the middle of the palm toward the middle finger (only if visible)
For each crease give 8 to 12 points in order from one end to the other, every point on the crease itself.
${fmt}`
const YX = 'Answer in JSON only: [{"point": [y, x], "label": "life_1"}, {"point": [y, x], "label": "life_2"}, ..., {"point": [y, x], "label": "heart_1"}, ...]. The points are in [y, x] format normalized to 0-1000.'
const XY = 'Answer in JSON only: [{"label": "life", "points": [[x, y], ...]}, ...]. Coordinates are [x, y], relative to the image, normalized to 0-1000 (0,0 top-left; 1000,1000 bottom-right).'

type Lines = Array<{ key: LineKey; points: Pt[] }>
function fromYX(v: unknown): Lines {
  const by = new Map<LineKey, Array<{ n: number; p: Pt }>>()
  for (const it of Array.isArray(v) ? v : []) {
    const m = /^(life|head|heart|fate|sun)_(\d+)$/.exec(String((it as any)?.label ?? ''))
    const yx = (it as any)?.point
    if (!m || !Array.isArray(yx) || yx.length < 2) continue
    if (!by.has(m[1] as LineKey)) by.set(m[1] as LineKey, [])
    by.get(m[1] as LineKey)!.push({ n: Number(m[2]), p: [Math.round(yx[1]), Math.round(yx[0])] })
  }
  return [...by].map(([key, ps]) => ({ key, points: ps.sort((a, b) => a.n - b.n).map(q => q.p) })).filter(l => l.points.length >= 2)
}
function fromXY(v: unknown): Lines {
  return (Array.isArray(v) ? v : []).map((l: any) => ({ key: l?.label as LineKey, points: (Array.isArray(l?.points) ? l.points : []).filter((p: any) => Array.isArray(p) && p.length >= 2).map((p: any) => [Math.round(p[0]), Math.round(p[1])] as Pt) }))
    .filter(l => (LINE_KEYS as readonly string[]).includes(l.key) && l.points.length >= 2)
}
const arrayOf = (text: string) => {
  const t = text.trim().replace(/^```json\s*|```$/g, '')
  try { return JSON.parse(t) } catch { return parseJson(`{"a": ${t}}`)?.a ?? parseJson(text)?.a ?? null }
}

async function one(spec: string, img: Buffer) {
  const [pm, level] = spec.split('@')
  const [provider, name] = pm.split('/')
  const model = await getModelByProviderName(provider, name)
  if (!model) return { spec, error: 'not in the catalog' }
  const gemini = provider === 'google'
  const t0 = Date.now()
  let out = '', cost = 0, error: string | null = null
  await new Promise<void>(resolve => streamText(model, [{ role: 'user', content: ASK(palm, gemini ? YX : XY) }], {
    onDelta: d => { out += d }, onDone: r => { cost = r.cost ?? 0; resolve() }, onError: m => { error = m; resolve() },
  }, [{ buffer: img, mediaType: 'image/jpeg' }], undefined, { thinking: level, ...(gemini ? { jsonMode: true } : {}) }).catch(e => { error = String(e?.message ?? e); resolve() }))
  const v = arrayOf(out)
  const lines = gemini ? fromYX(v) : fromXY(v)
  const res = { model: name, level, palm, ms: Date.now() - t0, cost, error, parsed: { [palm]: { lines } }, raw: lines.length ? undefined : out.slice(0, 600) }
  fs.writeFileSync(path.join(dir, `best-${name}@${level}-${palm}.json`), JSON.stringify(res, null, 2))
  return res
}

async function main() {
  const img = await sharp(fs.readFileSync(path.join(dir, `${palm}.png`))).resize(1280, 1280, { fit: 'inside' }).jpeg({ quality: 88 }).toBuffer()
  const results = await Promise.all(specs.map(s => one(s, img)))
  let total = 0
  for (const r of results as any[]) {
    total += r.cost ?? 0
    console.log(`${r.model ?? r.spec}@${r.level ?? ''} ${palm}: ${r.error ? 'ERROR ' + String(r.error).slice(0, 120) : (r.parsed?.[palm]?.lines ?? []).map((l: any) => `${l.key}(${l.points.length})`).join(' ') || 'NO LINES'} · ${((r.ms ?? 0) / 1000).toFixed(0)} s · $${(r.cost ?? 0).toFixed(4)}`)
  }
  console.log(`total: $${total.toFixed(4)}`)
}
main().catch(e => { console.error(e); process.exit(1) })
