// scripts/xtell-sukuyo-art.mjs — the 宿曜占星術 temple's icon and portrait,
// drawn in code (Sep 29): the twenty-seven mansions as a ring of stars
// around a crescent moon, 昴 marked in vermilion at the top. Interim, like
// 九星's, until the owner decides on generated art.
//   node scripts/xtell-sukuyo-art.mjs
import sharp from 'sharp'

const PAPER = '#faf6ed', INK = '#2b2622', GOLD = '#d8a93b', VERMILION = '#b8433a', NIGHT = '#243552'

function svg(size, paper) {
  const c = size / 2, R = size * 0.36, r = size * 0.028
  const dots = Array.from({ length: 27 }, (_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 27
    const x = c + R * Math.cos(a), y = c + R * Math.sin(a)
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(i === 0 ? r * 1.35 : r).toFixed(1)}" fill="${i === 0 ? VERMILION : i % 9 === 0 ? GOLD : INK}"/>`
  }).join('')
  // A crescent: a gold disc with a night disc cut across it.
  const m = size * 0.2
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    ${paper ? `<rect width="100%" height="100%" fill="${PAPER}"/>` : ''}
    <circle cx="${c}" cy="${c}" r="${R}" fill="none" stroke="#d9cfbf" stroke-width="${size * 0.006}"/>
    ${dots}
    <circle cx="${c}" cy="${c}" r="${m * 1.15}" fill="${NIGHT}"/>
    <circle cx="${c}" cy="${c}" r="${m * 0.78}" fill="${GOLD}"/>
    <circle cx="${c + m * 0.34}" cy="${c - m * 0.2}" r="${m * 0.7}" fill="${NIGHT}"/>
  </svg>`)
}

const out = 'public/xtell/approved/'
await sharp(svg(300, true)).avif({ quality: 60 }).toFile(out + 'sukuyo-icon.avif')
await sharp(svg(300, false)).avif({ quality: 60 }).toFile(out + 'sukuyo-icon-clear.avif')
await sharp(svg(640, true)).avif({ quality: 60 }).toFile(out + 'sukuyo-portrait.avif')
if (process.env.PREVIEW) await sharp(svg(640, true)).png().toFile(process.env.PREVIEW)
console.log('sukuyo art written')
