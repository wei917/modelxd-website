// scripts/xiang-point-test.ts — 相學館: can a model trained to point trace
// the palm lines better (owner, Oct 6: the first drawing "is not good")?
// One palm per call, each model asked in the format it was trained on, the
// answer converted to our [x, y] in 0-1000:
//   Gemini: [{"point": [y, x], "label": ...}], [y, x] normalized to 0-1000.
//   Qwen3-VL (DashScope, called directly: not in our catalog): [x, y], 0-1000.
//   npx tsx --env-file=.env.local scripts/xiang-point-test.ts <dir with left.png right.png>
// Writes points-<model>.json in that dir; scripts/xiang-draw.py draws them.

import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { streamText } from '../lib/providers'
import { getModelByProviderName } from '../lib/models'
import { parseJson, LINE_KEYS, type LineKey, type Pt } from '../lib/xiang'

const dir = process.argv[2]
const ASK = (hand: string, fmt: string) => `This is a photo of a person's ${hand} palm, palm facing the camera.
Point along each of its main palm creases, exactly on the crease line in the skin:
- life: the curved crease around the base of the thumb
- head: the crease running across the middle of the palm
- heart: the crease below the fingers, from the little-finger edge
- fate: the crease from the wrist up the middle of the palm toward the middle finger (only if visible)
For each crease give 8 to 12 points in order from one end to the other, every point on the crease itself.
${fmt}`
const GEMINI_FMT = 'Answer in JSON only: [{"point": [y, x], "label": "life_1"}, {"point": [y, x], "label": "life_2"}, ..., {"point": [y, x], "label": "heart_1"}, ...]. The points are in [y, x] format normalized to 0-1000.'
const QWEN_FMT = 'Answer in JSON only: [{"label": "life", "points": [[x, y], ...]}, ...]. Coordinates are [x, y], relative to the image, normalized to 0-1000 (0,0 top-left; 1000,1000 bottom-right).'

type Lines = Array<{ key: LineKey; points: Pt[] }>

function fromGemini(v: unknown): Lines {
  const by = new Map<LineKey, Array<{ n: number; p: Pt }>>()
  for (const it of Array.isArray(v) ? v : []) {
    const m = /^(life|head|heart|fate|sun)_(\d+)$/.exec(String((it as any)?.label ?? ''))
    const yx = (it as any)?.point
    if (!m || !Array.isArray(yx) || yx.length < 2) continue
    const key = m[1] as LineKey
    if (!by.has(key)) by.set(key, [])
    by.get(key)!.push({ n: Number(m[2]), p: [Math.round(yx[1]), Math.round(yx[0])] })   // [y, x] → [x, y]
  }
  return [...by].map(([key, ps]) => ({ key, points: ps.sort((a, b) => a.n - b.n).map(q => q.p) })).filter(l => l.points.length >= 2)
}
function fromQwen(v: unknown): Lines {
  return (Array.isArray(v) ? v : []).map((l: any) => ({ key: l?.label as LineKey, points: (Array.isArray(l?.points) ? l.points : []).filter((p: any) => Array.isArray(p) && p.length >= 2).map((p: any) => [Math.round(p[0]), Math.round(p[1])] as Pt) }))
    .filter(l => (LINE_KEYS as readonly string[]).includes(l.key) && l.points.length >= 2)
}

async function gemini(name: string, img: Buffer, hand: string): Promise<{ lines: Lines; cost: number; ms: number; raw: string }> {
  const model = await getModelByProviderName('google', name)
  if (!model) throw new Error(name + ' not in the catalog')
  const t0 = Date.now()
  let out = '', cost = 0
  await new Promise<void>(resolve => streamText(model, [{ role: 'user', content: ASK(hand, GEMINI_FMT) }], {
    onDelta: d => { out += d }, onDone: r => { cost = r.cost ?? 0; resolve() }, onError: m => { out += `\nERROR ${m}`; resolve() },
  }, [{ buffer: img, mediaType: 'image/jpeg' }], undefined, { jsonMode: true }))
  const v = parseJson(`{"a": ${out.trim().replace(/^```json|```$/g, '')}}`)?.a ?? (() => { try { return JSON.parse(out.trim().replace(/^```json|```$/g, '')) } catch { return null } })()
  return { lines: fromGemini(v), cost, ms: Date.now() - t0, raw: out.slice(0, 400) }
}

async function qwen(name: string, img: Buffer, hand: string): Promise<{ lines: Lines; cost: number; ms: number; raw: string }> {
  const base = process.env.DASHSCOPE_BASE_URL ?? 'https://dashscope-intl.aliyuncs.com'
  const t0 = Date.now()
  const res = await fetch(`${base}/compatible-mode/v1/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}` },
    body: JSON.stringify({ model: name, messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${img.toString('base64')}` } }, { type: 'text', text: ASK(hand, QWEN_FMT) }] }] }),
  })
  const d: any = await res.json().catch(() => ({}))
  const out = d?.choices?.[0]?.message?.content ?? JSON.stringify(d?.error ?? d).slice(0, 300)
  const txt = String(out).trim().replace(/^```json\s*|```$/g, '')
  let v: any = null
  try { v = JSON.parse(txt) } catch { v = parseJson(`{"a": ${txt}}`)?.a ?? null }
  const usage = d?.usage ?? {}
  return { lines: fromQwen(v), cost: 0, ms: Date.now() - t0, raw: `${res.status} in=${usage.prompt_tokens} out=${usage.completion_tokens} ${String(out).slice(0, 300)}` }
}

/** QVQ-Max and the thinking Qwen3-VL answer only as a stream (reasoning, then the answer). */
async function qwenStream(name: string, img: Buffer, hand: string): Promise<{ lines: Lines; cost: number; ms: number; raw: string }> {
  const base = process.env.DASHSCOPE_BASE_URL ?? 'https://dashscope-intl.aliyuncs.com'
  const t0 = Date.now()
  const res = await fetch(`${base}/compatible-mode/v1/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}` },
    // Omni models answer in text only when asked to (they can speak too).
    body: JSON.stringify({ model: name, stream: true, stream_options: { include_usage: true }, ...(name.includes('omni') ? { modalities: ['text'] } : {}), messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${img.toString('base64')}` } }, { type: 'text', text: ASK(hand, QWEN_FMT) }] }] }),
  })
  if (!res.ok || !res.body) return { lines: [], cost: 0, ms: Date.now() - t0, raw: `${res.status} ${(await res.text()).slice(0, 300)}` }
  let content = '', thought = 0, usage: any = null, buf = ''
  const reader = res.body.getReader(), dec = new TextDecoder()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') continue
      try {
        const j = JSON.parse(data)
        const d = j?.choices?.[0]?.delta ?? {}
        if (typeof d.content === 'string') content += d.content
        if (typeof d.reasoning_content === 'string') thought += d.reasoning_content.length
        if (j?.usage) usage = j.usage
      } catch { /* a partial line */ }
    }
  }
  const txt = content.trim().replace(/^```json\s*|```$/g, '')
  let v: any = null
  try { v = JSON.parse(txt) } catch { v = parseJson(`{"a": ${txt}}`)?.a ?? null }
  return { lines: fromQwen(v), cost: 0, ms: Date.now() - t0, raw: `in=${usage?.prompt_tokens} out=${usage?.completion_tokens} thinking=${thought} chars ${content.slice(0, 200)}` }
}

async function main() {
  const palms: Record<'left' | 'right', Buffer> = {
    left: await sharp(fs.readFileSync(path.join(dir, 'left.png'))).resize(1280, 1280, { fit: 'inside' }).jpeg({ quality: 88 }).toBuffer(),
    right: await sharp(fs.readFileSync(path.join(dir, 'right.png'))).resize(1280, 1280, { fit: 'inside' }).jpeg({ quality: 88 }).toBuffer(),
  }
  const runs: Array<[string, (n: string, b: Buffer, h: string) => Promise<{ lines: Lines; cost: number; ms: number; raw: string }>]> = [
    ['gemini-3.8-flash', gemini], ['gemini-3.1-pro-preview', gemini], ['qwen3-vl-plus', qwen],
    // Oct 6 (owner: an article on QVQ-Max reading palms): the reasoning ones.
    ['qvq-max', qwenStream], ['qwen3-vl-235b-a22b-thinking', qwenStream],
    // The newest Qwen that sees (owner: "try the newest one").
    ['qwen3.8-omni-flash', qwenStream],
  ]
  const only = process.argv.slice(3)
  for (const [name, run] of runs.filter(([n]) => !only.length || only.includes(n))) {
    const out: any = { model: name, parsed: {}, cost: 0, ms: 0, raw: {} }
    for (const hand of ['left', 'right'] as const) {
      const r = await run(name, palms[hand], hand).catch(e => ({ lines: [] as Lines, cost: 0, ms: 0, raw: String(e?.message ?? e) }))
      out.parsed[hand] = { lines: r.lines }
      out.cost += r.cost; out.ms += r.ms; out.raw[hand] = r.raw
      console.log(`${name} ${hand}: ${r.lines.map(l => `${l.key}(${l.points.length})`).join(' ') || 'NO LINES ' + r.raw.slice(0, 200)} · ${(r.ms / 1000).toFixed(1)} s · $${r.cost.toFixed(4)}`)
    }
    fs.writeFileSync(path.join(dir, `points-${name}.json`), JSON.stringify(out, null, 2))
  }
}
main().catch(e => { console.error(e); process.exit(1) })
