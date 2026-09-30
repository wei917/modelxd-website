// scripts/xtell-sunzi-art.mjs — the 孫子兵法 temple's icon and portrait,
// drawn in code (Sep 29). The owner asked for the whole title, large, and a
// war scene behind it: 「孫子／兵法」 in two lines of ink over ink-wash
// mountains, two war banners and a row of spears. Earlier drafts (bamboo
// slips, then one large 孫) are in git. An interim picture until the owner
// decides on generated art like the other temples'.
//   node scripts/xtell-sunzi-art.mjs          (PREVIEW=/path.png for a look)
import sharp from 'sharp'

const PAPER = '#faf6ed', INK = '#2b2622', RED = '#b8433a', WASH = '#8c877d'

function svg(size, paper) {
  const S = v => (v * size).toFixed(1)
  // Ink-wash mountains, far (light) and near (darker), in the lower half. No
  // sun: a red disc behind a war scene reads as a Japanese military flag in
  // Taiwan and Korea.
  const far = `<path d="M0 ${S(.62)} L${S(.16)} ${S(.5)} L${S(.3)} ${S(.58)} L${S(.5)} ${S(.44)} L${S(.66)} ${S(.56)} L${S(.8)} ${S(.47)} L${S(1)} ${S(.6)} L${S(1)} ${S(1)} L0 ${S(1)} Z" fill="${WASH}" opacity="0.18"/>`
  const near = `<path d="M0 ${S(.78)} L${S(.22)} ${S(.66)} L${S(.4)} ${S(.75)} L${S(.6)} ${S(.65)} L${S(.8)} ${S(.76)} L${S(1)} ${S(.68)} L${S(1)} ${S(1)} L0 ${S(1)} Z" fill="${WASH}" opacity="0.3"/>`
  // One war banner at each edge: a pole and a swallow-tailed flag, clear of the title.
  const banner = (x, dir, fill) => `<line x1="${S(x)}" y1="${S(.05)}" x2="${S(x)}" y2="${S(.97)}" stroke="${INK}" stroke-width="${S(.012)}"/>
    <path d="M${S(x)} ${S(.06)} L${S(x + dir * .14)} ${S(.075)} L${S(x + dir * .1)} ${S(.12)} L${S(x + dir * .14)} ${S(.165)} L${S(x)} ${S(.175)} Z" fill="${fill}"/>`
  const banners = banner(.07, 1, RED) + banner(.93, -1, INK)
  // A row of spears below the title: shafts and leaf-shaped heads.
  const spears = Array.from({ length: 9 }, (_, i) => {
    const x = .22 + i * .07, top = .88 + (i % 2) * .02
    return `<line x1="${S(x)}" y1="${S(top)}" x2="${S(x)}" y2="${S(1)}" stroke="${INK}" stroke-width="${S(.008)}" opacity="0.7"/>
      <path d="M${S(x)} ${S(top - .04)} L${S(x + .011)} ${S(top - .005)} L${S(x)} ${S(top + .008)} L${S(x - .011)} ${S(top - .005)} Z" fill="${INK}" opacity="0.7"/>`
  }).join('')
  // The title, two lines of two, with a paper-coloured edge so it stays
  // whole over the scene.
  const fs = size * 0.31
  const ch = (x, y) => `<text x="${S(x)}" y="${S(y)}" font-family="Hiragino Mincho ProN, Songti TC, STSong, serif" font-size="${fs}" font-weight="700" text-anchor="middle"`
  const title = [['孫', .33, .47], ['子', .67, .47], ['兵', .33, .8], ['法', .67, .8]]
    .map(([c, x, y]) => `${ch(x, y)} fill="none" stroke="${PAPER}" stroke-width="${S(.03)}" stroke-linejoin="round">${c}</text>${ch(x, y)} fill="${INK}">${c}</text>`).join('')
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    ${paper ? `<rect width="100%" height="100%" fill="${PAPER}"/>` : ''}
    ${far}${near}${banners}${spears}
    ${title}
  </svg>`)
}

const out = 'public/xtell/approved/'
await sharp(svg(300, true)).avif({ quality: 60 }).toFile(out + 'sunzi-icon.avif')
await sharp(svg(300, false)).avif({ quality: 60 }).toFile(out + 'sunzi-icon-clear.avif')
await sharp(svg(640, true)).avif({ quality: 60 }).toFile(out + 'sunzi-portrait.avif')
if (process.env.PREVIEW) await sharp(svg(640, true)).png().toFile(process.env.PREVIEW)
console.log('sunzi art written')
