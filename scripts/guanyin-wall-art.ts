// scripts/guanyin-wall-art.ts — the pictures for 觀音廟's 廟外 (the rope rack,
// a tied slip, a wish plaque and its back), generated against the approved
// 觀音 art as a style reference, like the temple icons (docs/XORACLE-PAGE.md;
// owner: icons are generated, never drawn in code). Code only lays text over
// them (components/xoracle/TempleWall.tsx). docs/GUANYIN-HANGING-PLAN.md.
//
//   npx tsx --env-file=.env.local scripts/guanyin-wall-art.ts <outDir> [draft ...]
//   npx tsx --env-file=.env.local scripts/guanyin-wall-art.ts <outDir> --back <front.png>
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { generateImage } from '../lib/providers'
import { getModelByProviderName } from '../lib/models'

const out = process.argv[2] ?? '.guanyin-wall-art'
const only = process.argv.slice(3).filter(a => !a.startsWith('--') && !a.endsWith('.png'))
const STYLE = 'Match the reference images exactly in style: flat screen-printed illustration, confident outlines in warm gold and dark brown, a limited palette of cream, ochre gold, vermilion red, sage green and soft lotus pink, flat tones, no gradients, no photographic texture, a plain warm cream paper background. No text, no letters, no characters, no numbers, no logos. The references are only for style; draw a NEW subject.'
const REFS = ['guanyin-icon', 'cookie-icon', 'tarot-icon']

type Draft = { prompt: string; size: string }
const DRAFTS: Record<string, Draft> = {
  // The rack: the place itself. The ropes stay EMPTY: real tied sticks are laid
  // over them by the page, so the picture never shows activity that is not there.
  'rack-rope': { size: '1536x1024', prompt: `${STYLE} Subject: outside a Guanyin temple, a long traditional rack for tying fortune slips, seen straight from the front: two dark vermilion lacquered wooden posts at the far left and far right, each with a tiny grey-tiled roof cap, and between them two long, perfectly straight, perfectly horizontal red cords spanning the whole width, one at about 42% of the picture's height and one at about 68%. The cords are completely empty: nothing is tied on them. Behind, a plain low cream wall; a few pink lotus flowers and small gold clouds only in the bottom corners. Wide, flat, symmetric composition with lots of calm empty space along the cords.` },
  'rack-beam': { size: '1536x1024', prompt: `${STYLE} Subject: outside a Guanyin temple, a wide wooden frame for tying fortune slips, seen straight from the front: two upright posts at the far left and right joined by two long, perfectly straight horizontal wooden rails in warm natural wood, one at about 42% of the picture's height and one at about 68%, with a small gently curved grey-tiled roof running along the top. The rails are completely empty: nothing is tied on them. A few pink lotus flowers and gold clouds only at the bottom corners, the rest calm empty cream. Wide, flat, symmetric composition.` },
  'rack-eave': { size: '1536x1024', prompt: `${STYLE} Subject: the outside wall of a Guanyin temple seen straight from the front: a strip of curved temple eave with grey roof tiles and a gold trim across the very top, and beneath it two long, perfectly straight, perfectly horizontal red cords stretched across the whole width between two small vermilion posts at the edges, one cord at about 45% of the picture's height and one at about 70%. The cords are completely empty: nothing is tied on them. A sage-green circle glow faintly behind the centre, pink lotus at the bottom corners. Wide, flat, symmetric, calm.` },
  // One tied slip: the page prints the stick's number and grade on it.
  'slip-knot': { size: '1024x1536', prompt: `${STYLE} Subject: one Chinese temple fortune slip hanging straight down, seen from the front: a long narrow strip of cream paper with a thin vermilion printed border line, its top end folded over and tied once around a short horizontal red cord in a simple knot. Below the knot the paper hangs flat and completely blank, facing the viewer, occupying the middle 60% of the height. Centered, narrow, generous margins, plain cream background.` },
  'slip-folded': { size: '1024x1536', prompt: `${STYLE} Subject: one paper fortune slip folded into a long narrow strip and tied in a neat knot around a red cord, hanging straight down from the knot, seen from the front; below the knot a flat blank panel of cream paper with a thin vermilion border, ready to be written on, about half the image height. Centered, generous margins, plain cream background.` },
  'slip-tag': { size: '1024x1536', prompt: `${STYLE} Subject: a single tall narrow paper slip of a temple oracle, cream paper with a double thin vermilion border and a small pink lotus printed at its very top, hanging from a tiny red cord knot, seen straight from the front, flat and completely blank in its middle for writing. Centered, generous margins, plain cream background.` },
  // The wish plaque: the page writes the wish on its face.
  'plaque-pentagon': { size: '1024x1024', prompt: `${STYLE} Subject: one blank wooden wish plaque seen straight from the front: a light natural-wood board with a pentagonal top like a little roof, a thin gold border line inset from its edge, a red silk cord threaded through a small hole at the top and tied in a loop. The board's face is completely blank and flat, with no drawing and no writing, filling about 75% of the frame. Centered, plain cream background.` },
  'plaque-roof': { size: '1024x1024', prompt: `${STYLE} Subject: one blank wooden prayer plaque seen straight from the front: a light wood board with a gently curved temple-roof-shaped top edge painted vermilion, a thin gold inner border, hanging from a red cord loop with a small tassel. The board's face is completely blank and flat, filling about 75% of the frame. Centered, plain cream background.` },
  'plaque-round': { size: '1024x1024', prompt: `${STYLE} Subject: one blank round-cornered rectangular wooden wish plaque seen straight from the front, light natural wood with a soft gold border and two small pink lotus petals painted at its top corners, hanging from a red silk cord loop. The board's face is completely blank and flat in the middle, filling about 75% of the frame. Centered, plain cream background.` },
}

async function ref(name: string): Promise<{ buffer: Buffer; mediaType: string }> {
  return { buffer: await sharp(`public/xoracle/approved/${name}.avif`).png().toBuffer(), mediaType: 'image/png' }
}

/** The plaque's back, edited from the chosen front so it is the same board. */
const BACK = 'Edit this wooden wish plaque into its BACK side: keep exactly the same board shape, wood colour, border, cord and art style, but the face now shows one simple emblem in the upper half: a white lotus flower on a small sage-green circle, flat screen-print style like the reference. The lower half of the board stays completely blank. No text, no letters.'

/** The paper around a picture made transparent: a flood fill from the edge
 *  through pixels near the paper's colour, the rim given partial alpha with
 *  the paper taken back out (scripts/xoracle-clear-icons.mjs, whole image as
 *  one tile), then trimmed to the art. */
async function cleared(src: string): Promise<sharp.Sharp> {
  const FILL = 26, EDGE_LO = 10, EDGE_HI = 110
  const { data, info } = await sharp(src).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H } = info
  const rgba = Buffer.alloc(W * H * 4)
  for (let i = 0; i < W * H; i++) { rgba[i * 4] = data[i * 3]; rgba[i * 4 + 1] = data[i * 3 + 1]; rgba[i * 4 + 2] = data[i * 3 + 2]; rgba[i * 4 + 3] = 255 }
  const border: [number, number][] = []
  for (let x = 0; x < W; x++) border.push([x, 0], [x, H - 1])
  for (let y = 0; y < H; y++) border.push([0, y], [W - 1, y])
  const med = (c: number) => { const v = border.map(([x, y]) => data[(y * W + x) * 3 + c]).sort((a, b) => a - b); return v[v.length >> 1] }
  const bg = [med(0), med(1), med(2)]
  const dist = (x: number, y: number) => { const i = (y * W + x) * 3; return Math.hypot(data[i] - bg[0], data[i + 1] - bg[1], data[i + 2] - bg[2]) }
  const paper = new Uint8Array(W * H)
  const stack = border.filter(([x, y]) => dist(x, y) < FILL)
  for (const [x, y] of stack) paper[y * W + x] = 1
  while (stack.length) {
    const [x, y] = stack.pop()!
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || paper[ny * W + nx]) continue
      if (dist(nx, ny) < FILL) { paper[ny * W + nx] = 1; stack.push([nx, ny]) }
    }
  }
  const near = (x: number, y: number, r: number) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < H && paper[ny * W + nx]) return true } return false }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x
    if (paper[p]) { rgba[p * 4 + 3] = 0; continue }
    if (!near(x, y, 2)) continue
    const a = Math.min(1, Math.max(0, (dist(x, y) - EDGE_LO) / (EDGE_HI - EDGE_LO)))
    if (a >= 1) continue
    const alpha = Math.max(a, 0.02)
    for (let c = 0; c < 3; c++) rgba[p * 4 + c] = Math.round(Math.min(255, Math.max(0, (data[p * 3 + c] - (1 - alpha) * bg[c]) / alpha)))
    rgba[p * 4 + 3] = Math.round(a * 255)
  }
  const trimmed = await sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).trim({ threshold: 1 }).png().toBuffer()
  return sharp(trimmed)
}

/** The chosen drafts (Oct 22: rack-rope, slip-knot, plaque-roof and its back)
 *  into public/xoracle/wall/. The rack keeps its paper: it is the scene.
 *    npx tsx scripts/guanyin-wall-art.ts <draftDir> --finish */
async function finish(dir: string) {
  const to = 'public/xoracle/wall'
  fs.mkdirSync(to, { recursive: true })
  await sharp(path.join(dir, 'rack-rope.png')).resize({ width: 1200 }).avif({ quality: 62, effort: 6 }).toFile(`${to}/rack.avif`)
  await (await cleared(path.join(dir, 'slip-knot.png'))).resize({ height: 360 }).avif({ quality: 70, effort: 6 }).toFile(`${to}/slip.avif`)
  await (await cleared(path.join(dir, 'plaque-roof.png'))).resize({ width: 480 }).avif({ quality: 70, effort: 6 }).toFile(`${to}/plaque.avif`)
  await (await cleared(path.join(dir, 'back-plaque-roof.png'))).resize({ width: 480 }).avif({ quality: 70, effort: 6 }).toFile(`${to}/plaque-back.avif`)
  for (const f of fs.readdirSync(to)) { const m = await sharp(`${to}/${f}`).metadata(); console.log(`${to}/${f} ${m.width}x${m.height} ${fs.statSync(`${to}/${f}`).size} B`) }
}

async function main() {
  if (process.argv.includes('--finish')) return finish(out)
  fs.mkdirSync(out, { recursive: true })
  const model = await getModelByProviderName('openai', 'gpt-image-2.5-sunburst')
  if (!model) throw new Error('gpt-image-2.5-sunburst not in the catalog')
  const backAt = process.argv.indexOf('--back')
  if (backAt > 0) {
    const src = process.argv[backAt + 1]
    const r = await generateImage(model, BACK, 'medium', '1024x1024', [{ buffer: fs.readFileSync(src), mediaType: 'image/png' }, await ref('guanyin-icon')], null, null, { userId: undefined } as any)
    fs.writeFileSync(path.join(out, `back-${path.basename(src)}`), r.buffer)
    console.log(`back: $${(r.cost ?? 0).toFixed(4)}`)
    return
  }
  const refs = await Promise.all(REFS.map(ref))
  const queue = Object.entries(DRAFTS).filter(([name]) => !only.length || only.includes(name))
  let total = 0
  // Three at a time: the image API rate-limits bursts.
  await Promise.all(Array.from({ length: 3 }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const [name, d] = job
      try {
        const r = await generateImage(model, d.prompt, 'medium', d.size, refs, null, null, { userId: undefined } as any)
        fs.writeFileSync(path.join(out, `${name}.png`), r.buffer)
        total += r.cost ?? 0
        console.log(`${name}: $${(r.cost ?? 0).toFixed(4)}`)
      } catch (e: any) { console.log(`${name}: FAILED ${String(e?.message ?? e).slice(0, 200)}`) }
    }
  }))
  console.log(`total: $${total.toFixed(4)}`)
}
main().catch(e => { console.error(e); process.exit(1) })
