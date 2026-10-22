// scripts/xoracle-icon-from-png.mjs — a temple's icon files from an approved PNG
// that already has a transparent background (Oct 8: 相學館's, approved by the
// owner in Codex's session, "yes, this is it!"). Writes the three files a
// temple uses (app/components/xoracle/TempleArtwork.tsx):
//   <temple>-icon-clear.avif  300 px, transparent: the top bar, lists, www thumbs
//   <temple>-icon.avif        300 px on the set's paper: the room header, the share picture
//   <temple>-portrait.avif    640 px on the set's paper: the banner and the explorer
// The art is not redrawn: only its invisible margin is trimmed (everything
// above alpha 1 of 255 stays), then it is scaled to the temple's FILL of the
// square's width (or height, if taller) and centred; neighbours fill 0.84-1.00
// of the width (tarot 0.91, kyusei 0.84, sunzi 1.00). The clear icon keeps the
// PNG's own alpha, so scripts/xoracle-clear-icons.mjs does not touch this temple.
//
//   node scripts/xoracle-icon-from-png.mjs <temple> <approved.png> [fill]
// Without a fill, the temple's own from FILL_BY_TEMPLE (else 0.88).

import sharp from 'sharp'

const [temple, src, fillArg] = process.argv.slice(2)
if (!temple || !src) { console.error('usage: node scripts/xoracle-icon-from-png.mjs <temple> <approved.png> [fill]'); process.exit(1) }
// Each temple's chosen fill, so a rebuild comes out the same. 相學館: 0.95 (Oct 8,
// owner: "the temple icon is too small. you should make it fill the space
// more. but not too big"; 0.88 before).
const FILL_BY_TEMPLE = { guanxiang: 0.95 }
const FILL = Number(fillArg ?? FILL_BY_TEMPLE[temple] ?? 0.88)
const PAPER = { r: 251, g: 247, b: 238 }   // the set's paper (tarot's, kyusei's: #fbf7ee)
const DIR = 'public/xoracle/approved'

// The visible art: the bounding box of every pixel above alpha 1 of 255. A
// pixel at alpha 1 (0.4%) cannot be seen; 相學館's PNG has 262 such stray
// specks far outside its card, which would otherwise shrink the icon.
const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1
for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
  if (data[(y * info.width + x) * 4 + 3] > 1) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
}
const w = x1 - x0 + 1, h = y1 - y0 + 1
const art = await sharp(src).ensureAlpha().extract({ left: x0, top: y0, width: w, height: h }).png().toBuffer()
console.log(`${src}: ${info.width}×${info.height}, art ${w}×${h} at (${x0}, ${y0}), fill ${FILL}`)

async function square(size, onPaper) {
  const scale = Math.min(FILL * size / w, FILL * size / h)
  const tw = Math.round(w * scale), th = Math.round(h * scale)
  const scaled = await sharp(art).resize(tw, th, { kernel: 'lanczos3' }).png().toBuffer()
  const canvas = sharp({ create: { width: size, height: size, channels: 4, background: onPaper ? { ...PAPER, alpha: 1 } : { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: scaled, left: Math.round((size - tw) / 2), top: Math.round((size - th) / 2) }])
  const flat = onPaper ? sharp(await canvas.png().toBuffer()).flatten({ background: PAPER }) : sharp(await canvas.png().toBuffer())
  return flat.avif({ quality: onPaper ? 80 : 76, effort: 6 })
}

for (const [name, size, onPaper] of [[`${temple}-icon-clear.avif`, 300, false], [`${temple}-icon.avif`, 300, true], [`${temple}-portrait.avif`, 640, true]]) {
  await (await square(size, onPaper)).toFile(`${DIR}/${name}`)
  console.log(`${DIR}/${name}`)
}
