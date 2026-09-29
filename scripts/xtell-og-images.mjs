// scripts/xtell-og-images.mjs — the link-preview pictures for shared XTell
// links (owner, Sep 28: 分享). One per temple (`?t=<temple>`, 1200×630) and one
// for the street itself, built from the approved art so a preview in LINE or
// Facebook looks like the site: the temple's portrait on paper, its name in
// 繁體 and English, the X先知 address. Run once on a Mac (the names are set in
// Songti TC from the system fonts), and the JPEGs are committed:
//
//   node scripts/xtell-og-images.mjs   → public/xtell/og/<temple>.jpg, street.jpg

import sharp from 'sharp'

const OUT = 'public/xtell/og'
const A = 'public/xtell/approved'
const W = 1200, H = 630
const PAPER = '#faf9f6', INK = '#292b29', SECONDARY = '#656761', RULE = '#dedfd8', VERMILION = '#a6382e'

// The approved sheets' five-by-two order (TempleArtwork.tsx TEMPLE_ART).
const SHEET = { mazu: 0, guandi: 1, yuelao: 2, simianfo: 3, navagraha: 4, bazi: 5, ziwei: 6, xingming: 7, cezi: 8, zhanxing: 9 }
const OWN = { yixue: 'yixue-school', jiemeng: 'jiemeng', guanyin: 'guanyin', tarot: 'tarot', cookie: 'cookie' }
const NAMES = {
  bazi: ['八字廟', 'BaZi Temple'], ziwei: ['紫微斗數廟', 'Zi Wei Temple'], yuelao: ['月老廟', 'Yue Lao Temple'],
  guandi: ['關帝廟', 'Guan Di Temple'], mazu: ['媽祖廟', 'Mazu Temple'], simianfo: ['四面佛', 'Four-Faced Buddha'],
  navagraha: ['九曜廟', 'Navagraha Temple'], zhanxing: ['占星塔', 'Astrology Tower'], xingming: ['姓名學', 'Name Study'],
  cezi: ['測字', 'Character Reading'], yixue: ['易學堂', 'I Ching Hall'], jiemeng: ['周公解夢', 'Dream Hall'],
  guanyin: ['觀音廟', 'Guanyin Temple'], tarot: ['塔羅館', 'Tarot Parlour'], cookie: ['幸運餅乾', 'Fortune Cookie'],
}
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

async function tile(sheet, index) {
  const meta = await sharp(`${A}/${sheet}`).metadata()
  const tw = Math.floor(meta.width / 5), th = Math.floor(meta.height / 2)
  return sharp(`${A}/${sheet}`).extract({ left: (index % 5) * tw, top: index < 5 ? 0 : th, width: tw, height: th })
}

// Square object art (塔羅's fanned cards) is fitted whole on its own paper;
// everything else fills the column.
const FIT_WHOLE = { tarot: '#fbf7ee', cookie: '#fbf7ee' }
async function portrait(key) {
  const img = key in SHEET ? await tile('portraits.avif', SHEET[key]) : sharp(`${A}/${OWN[key]}-portrait.avif`)
  return key in FIT_WHOLE
    ? img.resize({ width: 420, height: H, fit: 'contain', background: FIT_WHOLE[key] }).toBuffer()
    : img.resize({ width: 420, height: H, fit: 'cover' }).toBuffer()
}

function text(lines) {
  return Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect x="24" y="24" width="${W - 48}" height="${H - 48}" fill="none" stroke="${RULE}" stroke-width="2"/>
  ${lines.join('\n  ')}
</svg>`)
}

async function temple(key) {
  const [zh, en] = NAMES[key]
  const x = 420 + 72
  const svg = text([
    `<text x="${x}" y="250" font-family="Songti TC" font-weight="700" font-size="${zh.length > 4 ? 84 : 100}" fill="${INK}">${esc(zh)}</text>`,
    `<text x="${x + 4}" y="318" font-family="Helvetica Neue" font-size="34" letter-spacing="1" fill="${SECONDARY}">${esc(en)}</text>`,
    `<rect x="${x + 4}" y="360" width="72" height="4" fill="${VERMILION}"/>`,
    `<text x="${x + 4}" y="468" font-family="Songti TC" font-size="46" fill="${INK}">X先知</text>`,
    `<text x="${x + 4}" y="520" font-family="Helvetica Neue" font-size="28" fill="${VERMILION}">xtell.modelxd.com</text>`,
  ])
  await sharp({ create: { width: W, height: H, channels: 3, background: PAPER } })
    .composite([{ input: await portrait(key), left: 0, top: 0 }, { input: svg, left: 0, top: 0 }])
    .jpeg({ quality: 84, mozjpeg: true }).toFile(`${OUT}/${key}.jpg`)
  console.log(`${OUT}/${key}.jpg`)
}

async function street() {
  // Every temple's icon, two rows of eight, under the name.
  const order = ['bazi', 'ziwei', 'zhanxing', 'tarot', 'navagraha', 'xingming', 'cezi', 'yixue', 'jiemeng', 'cookie', 'guanyin', 'yuelao', 'guandi', 'mazu', 'simianfo']
  const S = 100, GAP = 22, left = (W - (8 * S + 7 * GAP)) / 2
  const icons = await Promise.all(order.map(async (key, i) => {
    // The clear icons (scripts/xtell-clear-icons.mjs): no paper square on paper.
    const img = key in SHEET ? await tile('icons-clear.avif', SHEET[key]) : sharp(`${A}/${OWN[key]}-icon-clear.avif`)
    return { input: await img.resize(S, S).toBuffer(), left: Math.round(left + (i % 8) * (S + GAP)), top: 270 + Math.floor(i / 8) * (S + 30) }
  }))
  const svg = text([
    `<text x="${W / 2}" y="150" text-anchor="middle" font-family="Songti TC" font-size="92" fill="${INK}">X先知</text>`,
    `<text x="${W / 2}" y="212" text-anchor="middle" font-family="Helvetica Neue" font-size="28" fill="${VERMILION}">xtell.modelxd.com</text>`,
  ])
  await sharp({ create: { width: W, height: H, channels: 3, background: PAPER } })
    .composite([{ input: svg, left: 0, top: 0 }, ...icons])
    .jpeg({ quality: 84, mozjpeg: true }).toFile(`${OUT}/street.jpg`)
  console.log(`${OUT}/street.jpg`)
}

for (const key of Object.keys(NAMES)) await temple(key)
await street()
