// scripts/xtell-kyusei-art.mjs — the 九星気学 temple's icon and portrait,
// drawn in code (Sep 29): the 洛書 square as a Japanese 九星 board is drawn
// (南 at the top, 東 on the left: 4 9 2 / 3 5 7 / 8 1 6), each cell a disc
// in its star's colour with its kanji numeral. An interim picture until the
// owner decides on generated art like the other temples'.
//   node scripts/xtell-kyusei-art.mjs
import sharp from 'sharp'

const PAPER = '#faf6ed', INK = '#2b2622', RULE = '#d9cfbf'
// 一白 二黒 三碧 四緑 五黄 六白 七赤 八白 九紫
const COLOR = ['', '#f4f1ea', '#2b2622', '#3f7f8f', '#4f8a4a', '#d8a93b', '#ece7dc', '#b8433a', '#f1ece2', '#6b4a8c']
const LIGHT = [false, true, false, false, false, false, true, false, true, false]
const NUM = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']
const GRID = [[4, 9, 2], [3, 5, 7], [8, 1, 6]]

function svg(size, paper) {
  const pad = size * 0.12, cell = (size - 2 * pad) / 3, r = cell * 0.34
  const cells = GRID.flatMap((row, i) => row.map((n, j) => {
    const cx = pad + cell * (j + 0.5), cy = pad + cell * (i + 0.5)
    const stroke = LIGHT[n] ? `stroke="${INK}" stroke-width="${size * 0.006}"` : ''
    return `<rect x="${pad + cell * j + size * 0.008}" y="${pad + cell * i + size * 0.008}" width="${cell - size * 0.016}" height="${cell - size * 0.016}" rx="${size * 0.02}" fill="none" stroke="${RULE}" stroke-width="${size * 0.006}"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="${COLOR[n]}" ${stroke}/>
      <text x="${cx}" y="${cy + r * 0.36}" font-family="Hiragino Mincho ProN, Songti TC, serif" font-size="${r * 1.05}" font-weight="700" text-anchor="middle" fill="${LIGHT[n] || n === 5 ? INK : '#faf6ed'}">${NUM[n]}</text>`
  })).join('\n')
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    ${paper ? `<rect width="100%" height="100%" fill="${PAPER}"/>` : ''}
    ${cells}
  </svg>`)
}

const out = 'public/xtell/approved/'
await sharp(svg(300, true)).avif({ quality: 60 }).toFile(out + 'kyusei-icon.avif')
await sharp(svg(300, false)).avif({ quality: 60 }).toFile(out + 'kyusei-icon-clear.avif')
await sharp(svg(640, true)).avif({ quality: 60 }).toFile(out + 'kyusei-portrait.avif')
await sharp(svg(640, true)).png().toFile(process.env.PREVIEW ?? '/dev/null')
console.log('kyusei art written')
