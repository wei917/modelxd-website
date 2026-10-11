// scripts/xiang-icon.ts — 相學館's icon drafts, generated against the approved
// icons as a style reference, like 觀音's and 塔羅's (docs/XTELL-PAGE.md).
// Oct 7 (owner: the first draft "looks really bad and similar to 九曜廟's":
// a face on a navy circle, like 九曜's figure and 宿曜's moon): four new
// concepts, none on a navy circle, each matched to the icons nearest its
// kind (objects to the book, brush and brass ones; figures to the portraits).
//   npx tsx --env-file=.env.local scripts/xiang-icon.ts <outDir> [draft ...]   (~$0.22 a draft at high quality)
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { generateImage } from '../lib/providers'
import { getModelByProviderName } from '../lib/models'

const out = process.argv[2] ?? '.xiang-icon'
const only = process.argv.slice(3).filter(a => !a.startsWith('--'))
const STYLE = 'Match the reference icons exactly in style: flat screen-printed illustration, thick confident black outlines, a limited palette of deep navy, ochre gold, vermilion red and cream, no gradients, no shading beyond flat tones, the same cream paper square background, one centered emblem with generous margins, no text, no letters, no characters. Do NOT put the subject on a navy circle. These references are only for style; draw a NEW subject.'
// The first temples' icons are one sprite of 300 px tiles: 媽祖 關公 月老 四面佛 九曜 / 八字 紫微 姓名 測字 占星.
const TILE: Record<string, number> = { guandi: 1, yuelao: 2, bazi: 5, xingming: 7, cezi: 8, zhanxing: 9 }
type Draft = { prompt: string; refs: string[] }
const DRAFTS: Record<string, Draft> = {
  // Round one: four concepts.
  lamp: { refs: ['zhanxing', 'xingming', 'cookie-icon'], prompt: `${STYLE} Subject: an open hand seen palm-on, fingers together, in flat ochre gold with black outlines, its main palm lines drawn as bold vermilion strokes; a round brass magnifying glass held over the centre of the palm enlarges the lines, and a small antique brass reading lamp leans in from the upper right, its light a soft flat cream wedge. No stars.` },
  scroll: { refs: ['cezi', 'xingming', 'cookie-icon'], prompt: `${STYLE} Subject: an antique Chinese hanging scroll partly unrolled, cream paper with dark wooden rollers and a vermilion silk tassel, showing a classical physiognomy face map: a calm face drawn in black line art, small vermilion dots at the forehead, between the brows, the tip of the nose and the chin, and two thin vermilion horizontal lines dividing the face into three zones. No writing on the scroll.` },
  desk: { refs: ['xingming', 'cezi', 'bazi'], prompt: `${STYLE} Subject: a scholar's desk seen from slightly above: a sheet of cream paper with a simple ink sketch of a face whose three zones are marked by short vermilion lines, beside it a smaller sheet with an ink sketch of an open palm, an ink brush resting on a little brush rest, a round ink stone, and a small vermilion seal. Tidy, centered, compact.` },
  pair: { refs: ['guandi', 'yuelao', 'jiemeng-icon'], prompt: `${STYLE} Subject: two calm faces in profile facing each other, a man on the left and a woman on the right, close together, drawn with bold black outlines and flat cream and ochre gold tones, hair in deep navy; the space between their profiles forms a subtle vase shape; short vermilion ticks along each profile at the brow and at the base of the nose mark the three zones. No red thread, no hearts, no halo.` },
}

// Oct 7, round two (owner: "combine scroll and desk and also the hand with lines
// from lamp", "try 10 different styles"): one scene, ten styles. The desk must
// read as a desk (round one's "desk" had none: "desk is not desk").
const SCENE = 'Subject: a physiognomist\'s low wooden Chinese desk, seen from the front at a slight angle, its top and legs clearly visible. On the desk lies an unrolled paper scroll showing a classical face map: a calm face in simple line art, two thin horizontal lines dividing it into three zones, small dots at the forehead, between the brows, the nose tip and the chin. Standing on the desk beside the scroll, an open hand seen palm-on, fingers together, with its main palm lines (life, head, heart) drawn as clear red strokes. A calligraphy brush on a small brush rest. One compact, centered composition with generous margins that still reads at a small size; a plain square background; no text, no letters, no characters.'
const STYLES: Record<string, string> = {
  screenprint: 'Style: match the reference icons exactly: flat screen-printed illustration, thick confident black outlines, deep navy, ochre gold, vermilion red and cream only, flat tones, cream paper background. The references are only for style.',
  woodblock: 'Style: a traditional Chinese woodblock print (木刻版畫): bold carved lines with visible gouge marks, black and vermilion ink only, on warm cream paper.',
  inkwash: 'Style: Chinese ink-wash painting (水墨): loose expressive black brushwork with soft grey washes, the palm lines and a small seal in vermilion, on rice paper.',
  goldline: 'Style: elegant fine gold-leaf line art with even hairline strokes, a few vermilion accents, on a cream background; refined, minimal, luxurious.',
  papercut: 'Style: Chinese paper-cut art (剪紙): one piece of vermilion red paper with intricate cut-out details and outlines, on a cream background.',
  ukiyoe: 'Style: Japanese ukiyo-e woodblock print: indigo, muted ochre and soft vermilion, crisp keyline outlines, gentle flat colour, washi paper texture.',
  engraving: 'Style: vintage copperplate engraving: fine cross-hatched line work in dark sepia ink, the palm lines tinted vermilion, on aged cream paper.',
  flatline: 'Style: a modern minimal app icon: clean uniform-weight line strokes, two flat colours (charcoal and vermilion) plus one ochre fill, rounded corners on shapes, lots of white space, cream background.',
  watercolor: 'Style: a storybook watercolour illustration: soft translucent washes in warm ochre, teal and vermilion, delicate dark-brown pen outlines, cream paper.',
  cloisonne: 'Style: cloisonné enamel (景泰藍): every shape filled with glossy enamel in turquoise, deep blue, vermilion and ochre, separated by raised gold wire outlines, on a cream background.',
}
for (const [name, style] of Object.entries(STYLES)) DRAFTS[`style-${name}`] = { prompt: `${style} ${SCENE}`, refs: name === 'screenprint' ? ['xingming', 'zhanxing', 'cookie-icon'] : [] }

// Oct 7, round four (owner: "we have both, so you have to design an icon have
// both face and hand"; the market's palm and face apps each show only one).
// The set's own screenprint style (round two's #1), eight ways to put a face and
// a palm with red lines into one emblem that reads at top-bar size.
const READS_SMALL = 'Few, large, simple shapes so it still reads at 48 pixels.'
const BOTH: Record<string, string> = {
  beside: 'Subject: a calm human face seen from the front, simple and serene, two thin vermilion lines dividing it into three zones, and beside it, slightly overlapping the cheek, an open hand raised palm-on with clear vermilion palm lines (life, head, heart). No circle behind them.',
  profile: 'Subject: a calm face in side profile on the left, facing right, and an open hand raised palm-on on the right facing it, its vermilion palm lines clear; the fingertips reach toward the brow, as if the face and the hand are being read together.',
  inpalm: 'Subject: a large open hand seen palm-on, fingers together, and in the middle of the palm a small calm face drawn in simple line art, the vermilion palm lines (life, head, heart) curving around the face.',
  halves: 'Subject: one round emblem split down the middle: its left half is half of a calm face seen from the front (one eye, half the nose and mouth, a thin vermilion line marking the zones), its right half is half of an open palm with vermilion palm lines; the two halves join seamlessly along a vertical line into one shape.',
  thumb: 'Subject: a clever single-shape logo: an open hand seen palm-on with vermilion palm lines, whose thumb-side outline forms the side profile of a human face (forehead, nose, lips, chin), so the hand and a face are read at once.',
  mirror: 'Subject: an open hand palm-up, its vermilion palm lines visible, holding upright on the palm an antique round bronze mirror in ochre gold; in the mirror, a calm face in simple line art with two thin vermilion lines marking three zones.',
  cradle: 'Subject: two cupped open hands, palms up with vermilion palm lines visible, gently holding a calm serene face (seen from the front, eyes closed) as if presenting it.',
  seal: 'Subject: a square vermilion seal stamp (印章) seen face-on, its carved cream lines showing a calm face on the left and an open palm with palm lines on the right, side by side, in the bold simplified way seals are carved.',
}
// Round five (owner: "why you want to use side view of a face????", "redesign"):
// 面相 is read from the front (三停, 五官, 印堂), so the face is frontal, never a
// profile; the seal and the halves layouts again.
const FRONT = 'The face must be seen straight from the front, symmetrical, both eyes visible; never a profile or a three-quarter view.'
BOTH['seal-front'] = `Subject: a square vermilion seal stamp (印章) seen face-on, its carved cream lines showing, side by side, a calm human face seen from the front (both eyes, nose and mouth, two short lines marking the three zones) on the left and an open palm with its palm lines on the right, in the bold simplified way seals are carved. ${FRONT}`
BOTH['halves-front'] = `Subject: one round emblem split down the middle: its left half is the left half of a calm human face seen from the front, as if the face were cut down its centre line (one eye, half the nose, half the mouth, two thin vermilion lines marking the three zones), its right half is half of an open palm seen palm-on with vermilion palm lines; the two halves meet along the vertical centre line into one round shape. ${FRONT}`
for (const [name, subject] of Object.entries(BOTH)) DRAFTS[`both-${name}`] = { prompt: `${STYLE} ${READS_SMALL} ${subject}`, refs: ['yuelao', 'xingming', 'cookie-icon'] }

async function ref(name: string): Promise<{ buffer: Buffer; mediaType: string }> {
  const buffer = name in TILE
    ? await sharp('public/xtell/approved/icons.avif').extract({ left: (TILE[name] % 5) * 300, top: Math.floor(TILE[name] / 5) * 300, width: 300, height: 300 }).png().toBuffer()
    : await sharp(`public/xtell/approved/${name}.avif`).png().toBuffer()
  return { buffer, mediaType: 'image/png' }
}

// Oct 7, round three (owner: "I mean can you remove the desk and scroll?"):
// each round-two draft edited down to the hand with its red palm lines, so
// every style stays as it was. Nano Banana 2 edits in place for about a third
// of GPT Image 2's price.
//   npx tsx --env-file=.env.local scripts/xiang-icon.ts <outDir> --hand-only <dir with style-*.png>
const HAND_ONLY = 'Edit this icon: remove the desk, the scroll with the face drawing, and the brush completely. Keep only the upright open hand with its red palm lines on its small stand, move it to the centre and make it larger, about 70% of the height. Keep exactly the same art style, colours, line quality and plain background as the original. No text, no letters.'
async function handOnly(src: string) {
  fs.mkdirSync(out, { recursive: true })
  const model = await getModelByProviderName('google', 'gemini-3.1-flash-image')
  if (!model) throw new Error('gemini-3.1-flash-image not in the catalog')
  const queue = fs.readdirSync(src).filter(f => /^style-.*\.png$/.test(f))
  let total = 0
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      try {
        const r = await generateImage(model, HAND_ONLY, 'high', '1024x1024', [{ buffer: fs.readFileSync(path.join(src, f)), mediaType: 'image/png' }], null, null, { userId: undefined } as any)
        fs.writeFileSync(path.join(out, f.replace(/^style-/, 'hand-')), r.buffer)
        total += r.cost ?? 0
        console.log(`${f}: $${(r.cost ?? 0).toFixed(4)}`)
      } catch (e: any) { console.log(`${f}: FAILED ${String(e?.message ?? e).slice(0, 160)}`) }
    }
  }))
  console.log(`hands: $${total.toFixed(4)}`)
}

// Round six (owner: "C is ok but can you check 'Face Reading' app's logo? you
// need some lines on the face"; MindDeck's Face Reading App draws a frontal face
// covered in fine contour lines with a bright point at 印堂): the seal kept as
// it is, lines added on its face three ways.
//   npx tsx --env-file=.env.local scripts/xiang-icon.ts <outDir> --face-lines <seal.png>
const KEEP = 'Edit this seal icon: keep everything else exactly as it is (the red square seal, its border, the carved cream face, the palm and its lines, the colours and the carved line weight). On the face only, add'
const FACE_LINES: Record<string, string> = {
  zones: `${KEEP} carved cream guide lines: a thin vertical centre line from the hairline to the chin, three thin horizontal lines dividing the face into its three zones (hairline to brows, brows to the base of the nose, nose to chin), and a small dot between the eyebrows. No text.`,
  contour: `${KEEP} fine carved cream contour lines that follow the shape of the face like a face-mapping scan: curved lines across the forehead, around the eyes, down the cheeks and along the jaw, and a small bright dot between the eyebrows. No text.`,
  points: `${KEEP} a face-reading map: small carved dots at the key points (between the brows, both eyes, the cheekbones, the nose tip, both mouth corners, the chin) joined by thin straight carved lines into a simple network, with a thin vertical centre line. No text.`,
}
async function faceLines(src: string) {
  fs.mkdirSync(out, { recursive: true })
  const model = await getModelByProviderName('google', 'gemini-3.1-flash-image')
  if (!model) throw new Error('gemini-3.1-flash-image not in the catalog')
  let total = 0
  await Promise.all(Object.entries(FACE_LINES).map(async ([name, prompt]) => {
    try {
      const r = await generateImage(model, prompt, 'high', '1024x1024', [{ buffer: fs.readFileSync(src), mediaType: 'image/png' }], null, null, { userId: undefined } as any)
      fs.writeFileSync(path.join(out, `seal-${name}.png`), r.buffer)
      total += r.cost ?? 0
      console.log(`seal-${name}: $${(r.cost ?? 0).toFixed(4)}`)
    } catch (e: any) { console.log(`seal-${name}: FAILED ${String(e?.message ?? e).slice(0, 160)}`) }
  }))
  console.log(`face lines: $${total.toFixed(4)}`)
}

async function main() {
  const at = process.argv.indexOf('--hand-only')
  if (at > 0) return handOnly(process.argv[at + 1])
  const fl = process.argv.indexOf('--face-lines')
  if (fl > 0) return faceLines(process.argv[fl + 1])
  fs.mkdirSync(out, { recursive: true })
  const model = await getModelByProviderName('openai', 'gpt-image-2')
  if (!model) throw new Error('gpt-image-2 not in the catalog')
  let total = 0
  const runs = Object.entries(DRAFTS).filter(([name]) => !only.length || only.includes(name))
  // Four at a time: ten at once runs into the image API's rate limit.
  const queue = [...runs]
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const [name, d] = job
      try {
        const r = await generateImage(model, d.prompt, 'high', '1024x1024', await Promise.all(d.refs.map(ref)), null, null, { userId: undefined } as any)
        fs.writeFileSync(path.join(out, `${name}.png`), r.buffer)
        total += r.cost ?? 0
        console.log(`${name}: $${(r.cost ?? 0).toFixed(4)}`)
      } catch (e: any) { console.log(`${name}: FAILED ${String(e?.message ?? e).slice(0, 160)}`) }
    }
  }))
  console.log(`icons: $${total.toFixed(4)}`)
}
main().catch(e => { console.error(e); process.exit(1) })
