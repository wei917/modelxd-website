// scripts/xiang-ui-art.ts — 相學館's page design by GPT Image 2 (Oct 8, owner:
// "why you use green? and so many ugly drawings. if you can't draw you should
// call gpt image. ask it for a good layout and implement it").
//   mockups: phone layouts of the form, the approved temple icon as a reference
//   guides:  the photo cards' guide pictures (a face, a right palm; the left palm is its mirror)
//   learn:   the teaching palm in 怎麼看面相、手相 (the face there is the guide face)
//   npx tsx --env-file=.env.local scripts/xiang-ui-art.ts <outDir> mockups <approved-icon.png> [name ...]
//   npx tsx --env-file=.env.local scripts/xiang-ui-art.ts <outDir> guides|learn [name ...]
// About $0.22-0.30 an image at high quality.

import fs from 'node:fs'
import path from 'node:path'
import { generateImage } from '../lib/providers'
import { getModelByProviderName } from '../lib/models'

const [out, mode, ...rest] = process.argv.slice(2)

// The site's own palette (app/globals.css, the XTell tokens): no green.
const LOOK = 'Visual style: warm ivory paper background (#faf9f6) with a faint paper grain, soft ink-black text (#292b29), warm grey secondary text (#656761), hairline warm-grey borders (#dedfd8), and ONE accent colour, a deep vermilion red (#a6382e), used only for the primary button, selected states and small highlights; a pale blush tint (#f1e8e2) for selected backgrounds. Absolutely no green and no blue. Refined serif headings in the Songti style, clean sans-serif body text, generous whitespace, soft rounded corners, very light shadows. Calm, premium and trustworthy, like a top product designer\'s app screen for an elegant Chinese fortune-telling site.'
const PAGE = 'The page, top to bottom: (1) a header: the attached temple icon (a framed card with a young woman\'s face and an open palm) on the left at a modest size, the title 相學館 in a large serif and one short line under it; (2) a slim three-step progress line: 放上照片 · 核對相盤 · 大師解讀, the first step active; (3) a two-option choice: 看自己 and 看我們兩個; (4) the photo section titled 照片 with the note 至少一張: upload places for 正臉, 左手掌 and 右手掌, each with a soft, beautiful painted illustration placeholder (a face, a left palm, a right palm), a camera action 拍照 and an upload action 選照片; (5) two small segmented selectors, 性別 (男 / 女) and 慣用手 (左手 / 右手); (6) a collapsed tips row 怎麼看面相、手相; (7) at the bottom a privacy line with a small lock icon and a wide vermilion primary button 開始觀相.'
const MOCKUPS: Record<string, string> = {
  rows: `A high-fidelity mobile web UI mockup, one full phone screen in portrait, flat front view, no device frame, no hands. ${LOOK} ${PAGE} Lay the three photo places out as three stacked horizontal cards, each a picture on the left and its name, a one-line tip and the two actions on the right. Crisp, legible Traditional Chinese labels exactly as given.`,
  tiles: `A high-fidelity mobile web UI mockup, one full phone screen in portrait, flat front view, no device frame, no hands. ${LOOK} ${PAGE} Lay the three photo places out as a row of three tall rounded tiles side by side, the face tile first, each with its illustration on top and small actions under it. Crisp, legible Traditional Chinese labels exactly as given.`,
}
// The guide pictures: black-and-white ink line drawings, a Chinese woman's or man's face and
// hands by the gender chosen for each person (owner, Oct 9: "像印度人... 改掉。畫中國人。要有男性
// 女性 根據性別"). Before: painted in colour, then (Oct 8, "black and white 中性") of no gender,
// then (Oct 9, "female, young lady") one young woman.
const GUIDE = 'A refined black-and-white ink line illustration: fine black pen lines with soft light grey shading only, absolutely no colour, on a plain white background filling the whole square, centred with generous margins, no text, no frame. No jewellery.'
// Both faces framed alike: the tiles swap them, and the lesson's numbers sit on the woman's.
const FACE = 'seen straight from the front, symmetrical, head and shoulders framed the same way: the face centred, the eyes at about 38% of the height, the chin at about 68%; the forehead and both ears showing; three very faint dotted grey guide lines across the face (at the hairline, the brows and the base of the nose) and a tiny dot between the brows.'
const LINES = 'the main palm lines (the life line curving around the base of the thumb, the head line across the middle, the heart line under the fingers) drawn a little darker than the rest.'
const GUIDES: Record<string, string> = {
  // The woman too, Oct 10 (owner: "女生也改掉"), in the man's woodblock manner; the lesson's
  // face is hers. Tries: a big, densely hatched, helmet-like mass of hair ("the hair looks
  // bad"); then hair in a few fine lines with no fill, which read as white ("why is it white
  // hair???"); now black hair in close smooth lines, like the man's, close to the head, a small
  // bun on the crown (a solid black fill, drawn beside it, was heavier).
  'face-female': `A black-and-white ink line illustration in the manner of an old Chinese woodblock print from a classical face-reading book, flat and schematic, deliberately not a portrait of any real person: a generic, idealised young woman's head and shoulders, simplified stylised features drawn with even ink lines, no realistic shading and no individual likeness, a calm neutral expression, dark black hair drawn with smooth parallel black lines close together so it reads clearly as black, parted in the middle and combed smoothly back close to the head (not puffy, no volume), gathered into a small neat bun on the crown, the crossed collar of a plain robe, on a plain white background filling the whole square, centred with generous margins, no text, no characters, no seal, no frame, ${FACE}`,
  // The man, fifth try (owner, Oct 10: "make the male placeholder more less human? 像古代那種
  // 或者中醫那種經絡圖？ 盡量不要太像某些人"): schematic, like an old 相書 woodblock print or a
  // 經絡圖, no likeness of anyone. (Before: K-pop hair, a buzz cut, bald "像犯人", a round face.)
  // A 經絡圖 version was drawn beside it, Oct 10; this woodblock one was cleaner at tile size.
  'face-male': `A black-and-white ink line illustration in the manner of an old Chinese woodblock print from a classical face-reading book, flat and schematic, deliberately not a portrait of any real person: a generic, idealised man's head and shoulders, simplified stylised features drawn with even ink lines, no realistic shading and no individual likeness, a calm neutral expression, hair gathered into a small topknot on the crown, the crossed collar of a plain robe, on a plain white background filling the whole square, centred with generous margins, no text, no characters, no seal, no frame, ${FACE}`,
  // Seen palm-on with the fingers up, a hand's thumb is on its own side: a right palm's on the
  // right of the picture. (The first prompt said LEFT hand, thumb on the RIGHT: backwards; the
  // owner caught the swapped slots, Oct 8.)
  // The woman's palm (owner, Oct 10: "太黑 fingers太粗"): light, slender. A third try drew it
  // thinner still ("你懂不懂什麼叫修長纖細的手啊"); its spindly pointed fingers were worse ("are you
  // kidding me?"), and the owner chose this one back ("your previous previous versions are good,
  // just need to be smaller"), installed at 78% of the tile like the man's.
  'palm-female': `${GUIDE} Mostly clean fine outlines with only very light, sparse grey shading, much lighter than a pencil study. Subject: a young woman's small, slender open RIGHT hand seen palm-on, held upright, long thin delicate fingers straight and slightly apart, a narrow palm, the thumb on the RIGHT side of the picture, a slim wrist at the bottom edge; ${LINES}`,
  // Second man's palm (owner, Oct 10: "for man, the palm is too real, make it more flat"): flat line
  // art as light as the woman's, a broader hand. (A bold-outlined woodblock version, drawn beside
  // it, was heavier than hers.) Both palms are installed at 78% of the tile, near the top, the
  // wrist fading out ("palms are too big…", "稍微大一點", then "just need to be smaller").
  'palm-male': `${GUIDE} Flat line art: clean fine outlines with only a few very light grey strokes, no realistic shading, no skin texture, much lighter than a pencil study. Subject: a man's open RIGHT hand seen palm-on, held upright, a broader palm and sturdier fingers than a woman's, fingers straight and slightly apart, the thumb on the RIGHT side of the picture, the wrist at the bottom edge; ${LINES}`,
}

// The teaching picture in 怎麼看面相、手相 (owner, Oct 9: "draw the image to teach users which
// line means what on palm"): the guides' ink, the five lines the reader knows (LINE_KEYS in
// lib/xiang.ts) drawn bold. The page sets the numbers on it, so the picture has no text.
const LEARN: Record<string, string> = {
  palm: `${GUIDE} No numbers or letters anywhere. Subject: a young woman's open RIGHT hand seen palm-on, held upright and large in the frame, slender graceful fingers straight and slightly apart, the thumb on the RIGHT side of the picture (so the little finger is on the left), a slim wrist at the bottom edge. Exactly five palm lines, each drawn as one clean, unbroken, bold black ink line, clearly darker than everything else, with no other strong creases: the heart line across the top of the palm just under the fingers, from the little-finger edge on the left to between the index and middle fingers; the head line starting between the thumb and the index finger and running across the middle of the palm towards the left edge; the life line starting at the same point and curving down around the base of the thumb to the wrist; the fate line running straight up from the middle of the wrist to the base of the middle finger; the sun line, a short straight line rising in the upper palm towards the base of the ring finger.`,
}

async function main() {
  fs.mkdirSync(out, { recursive: true })
  const model = await getModelByProviderName('openai', 'gpt-image-2')
  if (!model) throw new Error('gpt-image-2 not in the catalog')
  let total = 0
  if (mode === 'mockups') {
    const [icon, ...only] = rest
    const ref = { buffer: fs.readFileSync(icon), mediaType: 'image/png' }
    await Promise.all(Object.entries(MOCKUPS).filter(([n]) => !only.length || only.includes(n)).map(async ([name, prompt]) => {
      const r = await generateImage(model, prompt, 'high', '1024x1536', [ref], null, null, { userId: undefined } as any)
      fs.writeFileSync(path.join(out, `mockup-${name}.png`), r.buffer)
      total += r.cost ?? 0
      console.log(`mockup-${name}: $${(r.cost ?? 0).toFixed(4)}`)
    }))
  } else if (mode === 'guides' || mode === 'learn') {
    const set = mode === 'guides' ? GUIDES : LEARN
    await Promise.all(Object.entries(set).filter(([n]) => !rest.length || rest.includes(n)).map(async ([name, prompt]) => {
      const r = await generateImage(model, prompt, 'high', '1024x1024', [], null, null, { userId: undefined } as any)
      fs.writeFileSync(path.join(out, `${mode === 'guides' ? 'guide' : 'learn'}-${name}.png`), r.buffer)
      total += r.cost ?? 0
      console.log(`${mode}-${name}: $${(r.cost ?? 0).toFixed(4)}`)
    }))
  } else throw new Error('mode: mockups | guides | learn')
  console.log(`total: $${total.toFixed(4)}`)
}
main().catch(e => { console.error(e); process.exit(1) })
