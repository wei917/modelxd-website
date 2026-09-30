// scripts/xtell-sunzi-art.mjs — the 孫子兵法 temple's icon and portrait,
// drawn in code (Sep 29): a bundle of bamboo slips (竹簡, the form the book
// was first written on) tied with two cords, 「孫子兵法」 down the middle slip
// and faint columns on the others. An interim picture until the owner
// decides on generated art like the other temples'.
//   node scripts/xtell-sunzi-art.mjs          (PREVIEW=/path.png for a look)
import sharp from 'sharp'

const PAPER = '#faf6ed', INK = '#2b2622', CORD = '#8a3b2e'
const BAMBOO = ['#dcbd83', '#d6b479', '#dfc28a', '#d3b075', '#dcbd83', '#d8b77e', '#e0c48c']

function svg(size, paper) {
  const n = 7, w = size * 0.088, gap = size * 0.013
  const left = (size - (n * w + (n - 1) * gap)) / 2
  const top = size * 0.13, bottom = size * 0.87, h = bottom - top
  const mid = Math.floor(n / 2)
  const cordY = [top + h * 0.16, bottom - h * 0.16]
  const slats = BAMBOO.map((fill, i) => {
    const x = left + i * (w + gap)
    const edge = `<rect x="${x}" y="${top}" width="${w}" height="${h}" rx="${w * 0.18}" fill="${fill}" stroke="#a8844a" stroke-width="${size * 0.004}"/>
      <rect x="${x + w * 0.14}" y="${top + size * 0.01}" width="${w * 0.1}" height="${h - size * 0.02}" rx="${w * 0.05}" fill="#fff" opacity="0.18"/>`
    if (i === mid) {
      const chars = ['孫', '子', '兵', '法']
      const span = cordY[1] - cordY[0], step = span / (chars.length + 0.2)
      const fs = Math.min(w * 0.82, step * 0.86)
      return edge + chars.map((c, k) => `<text x="${x + w / 2}" y="${cordY[0] + step * (k + 0.6) + fs * 0.36}" font-family="Hiragino Mincho ProN, Songti TC, STSong, serif" font-size="${fs}" font-weight="700" text-anchor="middle" fill="${INK}">${c}</text>`).join('')
    }
    // Faint columns of writing on the other slips.
    const marks = []
    for (let y = top + h * 0.06; y < bottom - h * 0.06; y += size * 0.034) {
      if (cordY.some(cy => Math.abs(y - cy) < size * 0.03)) continue
      marks.push(`<rect x="${x + w * 0.34}" y="${y}" width="${w * 0.32}" height="${size * 0.016}" rx="${size * 0.004}" fill="${INK}" opacity="0.22"/>`)
    }
    return edge + marks.join('')
  }).join('\n')
  const x0 = left - size * 0.02, x1 = left + n * w + (n - 1) * gap + size * 0.02
  const cords = cordY.map(y => `<path d="M ${x0} ${y} L ${x1} ${y}" stroke="${CORD}" stroke-width="${size * 0.014}" stroke-linecap="round"/>
    <path d="M ${x1} ${y} q ${size * 0.03} ${size * 0.02} ${size * 0.02} ${size * 0.06}" stroke="${CORD}" stroke-width="${size * 0.01}" fill="none" stroke-linecap="round"/>`).join('\n')
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    ${paper ? `<rect width="100%" height="100%" fill="${PAPER}"/>` : ''}
    ${slats}
    ${cords}
  </svg>`)
}

const out = 'public/xtell/approved/'
await sharp(svg(300, true)).avif({ quality: 60 }).toFile(out + 'sunzi-icon.avif')
await sharp(svg(300, false)).avif({ quality: 60 }).toFile(out + 'sunzi-icon-clear.avif')
await sharp(svg(640, true)).avif({ quality: 60 }).toFile(out + 'sunzi-portrait.avif')
if (process.env.PREVIEW) await sharp(svg(640, true)).png().toFile(process.env.PREVIEW)
console.log('sunzi art written')
