// scripts/xtell-sunzi-art.mjs — the 孫子兵法 temple's icon and portrait,
// drawn in code (Sep 29). Owner, over three rounds: the whole title, large,
// with a war scene behind it, in 行楷 (style C of six), and 弓箭 too. So:
// 「孫子／兵法」 in two lines of running-script brush over ink-wash mountains,
// a banner at each edge, a volley of arrows across the sky, a drawn bow and
// a row of spears. No red sun: behind a war scene it reads as a Japanese
// military flag in Taiwan and Korea. Earlier drafts are in git.
//
// The title is drawn from the glyph outlines of macOS's 行楷 (STXingkaiTC-
// Bold, a downloadable system font the SVG renderer cannot see), read with
// fontkit, so only the picture is committed, never the font. Run on a Mac:
//   npm i --no-save fontkit@2 && node scripts/xtell-sunzi-art.mjs
//   (or NODE_PATH=<dir with fontkit>; PREVIEW=/path.png for a look)
import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const fontkit = createRequire(path.join(process.cwd(), 'package.json'))('fontkit')
const PAPER = '#faf6ed', INK = '#2b2622', RED = '#b8433a', WASH = '#8c877d'

/** macOS keeps its downloadable fonts under hashed asset folders. */
function findFont(file) {
  const roots = ['/System/Library/AssetsV2', '/Library/Fonts', path.join(process.env.HOME ?? '', 'Library/Fonts')]
  const walk = (dir, depth) => {
    if (depth > 5) return null
    let entries = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return null }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isFile() && e.name === file) return p
      if (e.isDirectory()) { const hit = walk(p, depth + 1); if (hit) return hit }
    }
    return null
  }
  for (const r of roots) { const hit = walk(r, 0); if (hit) return hit }
  throw new Error(`${file} not found: install 行楷 (Xingkai) in Font Book first`)
}
const face = fontkit.openSync(findFont('Xingkai.ttc'), 'STXingkaiTC-Bold')

/** A character as an SVG path, centred on x, sitting on baseline y. */
function glyph(c, x, y, size, attrs) {
  const g = face.layout(c).glyphs[0], k = size / face.unitsPerEm
  return `<path transform="translate(${(x - g.advanceWidth * k / 2).toFixed(1)} ${y.toFixed(1)}) scale(${k} ${-k})" d="${g.path.toSVG()}" ${attrs}/>`
}

function svg(size, paper) {
  const S = v => (v * size).toFixed(1)
  const far = `<path d="M0 ${S(.62)} L${S(.16)} ${S(.5)} L${S(.3)} ${S(.58)} L${S(.5)} ${S(.44)} L${S(.66)} ${S(.56)} L${S(.8)} ${S(.47)} L${S(1)} ${S(.6)} L${S(1)} ${S(1)} L0 ${S(1)} Z" fill="${WASH}" opacity="0.18"/>`
  const near = `<path d="M0 ${S(.78)} L${S(.22)} ${S(.66)} L${S(.4)} ${S(.75)} L${S(.6)} ${S(.65)} L${S(.8)} ${S(.76)} L${S(1)} ${S(.68)} L${S(1)} ${S(1)} L0 ${S(1)} Z" fill="${WASH}" opacity="0.3"/>`
  const banner = (x, dir, fill) => `<line x1="${S(x)}" y1="${S(.05)}" x2="${S(x)}" y2="${S(.97)}" stroke="${INK}" stroke-width="${S(.012)}"/>
    <path d="M${S(x)} ${S(.06)} L${S(x + dir * .14)} ${S(.075)} L${S(x + dir * .1)} ${S(.12)} L${S(x + dir * .14)} ${S(.165)} L${S(x)} ${S(.175)} Z" fill="${fill}"/>`
  // An arrow: shaft, head and fletching, flying along angle a (radians).
  const arrow = (x, y, len, a) => {
    const c = Math.cos(a), s = Math.sin(a), hx = x + c * len, hy = y + s * len
    const pt = (u, v) => `${S(hx - c * u - s * v)} ${S(hy - s * u + c * v)}`
    const ft = (u, v) => `${S(x + c * u - s * v)} ${S(y + s * u + c * v)}`
    return `<line x1="${S(x)}" y1="${S(y)}" x2="${S(hx)}" y2="${S(hy)}" stroke="${INK}" stroke-width="${S(.007)}"/>
      <path d="M${pt(-.012, 0)} L${pt(.018, .011)} L${pt(.018, -.011)} Z" fill="${INK}"/>
      <path d="M${ft(0, 0)} L${ft(-.012, .012)} L${ft(.026, .012)} L${ft(.03, 0)} Z M${ft(0, 0)} L${ft(-.012, -.012)} L${ft(.026, -.012)} L${ft(.03, 0)} Z" fill="${RED}" opacity="0.9"/>`
  }
  // A volley across the sky between the banners, falling to the right.
  const volley = [[.22, .07], [.36, .1], [.5, .065], [.3, .165], [.45, .15], [.6, .12]]
    .map(([x, y]) => arrow(x, y, .15, 0.22)).join('')
  // A drawn bow below the title at the lower right, tilted to shoot up into
  // the sky after the volley: drawn upright (limb left, string pulled right,
  // arrow pointing left), then turned 40° about its grip.
  const [bx, by, bh] = [.8, .9, .095]
  const bow = `<g transform="rotate(40 ${S(bx)} ${S(by)})">
      <path d="M${S(bx)} ${S(by - bh)} Q${S(bx - .09)} ${S(by)} ${S(bx)} ${S(by + bh)}" fill="none" stroke="${INK}" stroke-width="${S(.014)}" stroke-linecap="round"/>
      <path d="M${S(bx)} ${S(by - bh)} L${S(bx + .05)} ${S(by)} L${S(bx)} ${S(by + bh)}" fill="none" stroke="${INK}" stroke-width="${S(.004)}"/>
      ${arrow(bx + .05, by, .15, Math.PI)}
    </g>`
  const spears = Array.from({ length: 6 }, (_, i) => {
    const x = .18 + i * .065, top = .88 + (i % 2) * .02
    return `<line x1="${S(x)}" y1="${S(top)}" x2="${S(x)}" y2="${S(1)}" stroke="${INK}" stroke-width="${S(.008)}" opacity="0.7"/>
      <path d="M${S(x)} ${S(top - .04)} L${S(x + .011)} ${S(top - .005)} L${S(x)} ${S(top + .008)} L${S(x - .011)} ${S(top - .005)} Z" fill="${INK}" opacity="0.7"/>`
  }).join('')
  // The title with a paper-coloured edge, so it stays whole over the scene.
  const fs_ = size * 0.33, halo = .03 * size / (fs_ / face.unitsPerEm)
  const title = [['孫', .33, .47], ['子', .67, .47], ['兵', .33, .8], ['法', .67, .8]]
    .map(([c, x, y]) => glyph(c, x * size, y * size, fs_, `fill="none" stroke="${PAPER}" stroke-width="${halo}" stroke-linejoin="round"`) + glyph(c, x * size, y * size, fs_, `fill="${INK}"`)).join('')
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    ${paper ? `<rect width="100%" height="100%" fill="${PAPER}"/>` : ''}
    ${far}${near}${banner(.07, 1, RED)}${banner(.93, -1, INK)}${volley}${bow}${spears}
    ${title}
  </svg>`)
}

const out = 'public/xtell/approved/'
await sharp(svg(300, true)).avif({ quality: 60 }).toFile(out + 'sunzi-icon.avif')
await sharp(svg(300, false)).avif({ quality: 60 }).toFile(out + 'sunzi-icon-clear.avif')
await sharp(svg(640, true)).avif({ quality: 60 }).toFile(out + 'sunzi-portrait.avif')
if (process.env.PREVIEW) await sharp(svg(640, true)).png().toFile(process.env.PREVIEW)
console.log('sunzi art written')
