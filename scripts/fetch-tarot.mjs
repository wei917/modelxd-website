// scripts/fetch-tarot.mjs — the tarot deck: the 78 cards of the Waite–Smith
// deck of 1909, with A. E. Waite's own divinatory meanings, as
// content/tarot/cards.json, and a scan of each ORIGINAL 1909 card as
// public/xtell/tarot/<id>.webp.
//
// Name it "the Waite–Smith 1909 deck". "Rider-Waite" is a registered
// trademark (U.S. Games Systems) and must not be used as the deck's name.
//
// TEXT. Arthur Edward Waite, *The Pictorial Key to the Tarot* (William Rider &
// Son, London; first ed. dated 1911), Part III "The Outer Method of the
// Oracles", from English Wikisource's fully validated transcription (all
// pages at proofread level 4) of the Rider scan the index dates "1910/1922":
//   https://en.wikisource.org/wiki/The_Pictorial_Key_to_the_Tarot/Part_3
// Public domain: Waite died 1942 (PD in the US and in life+70 countries;
// Wikisource tags the work {{PD-US|1951}}). sacred-texts.com has the same
// book but sits behind a Cloudflare bot challenge, so it is not used.
//   - Greater Arcana: §3 "The Greater Arcana and their Divinatory Meanings",
//     one line per trump: "N. Name.—<upright> Reversed: <reversed>". Waite's
//     own numbering (8 = Fortitude/Strength, 11 = Justice, Zero = the Fool).
//   - Lesser Arcana: §2, the "Divinatory Meanings:" and "Reversed:" parts of
//     each card's paragraph (the picture description before them is dropped).
//   - The Two of Cups has NO "Reversed:" in §2. Its reversed meaning is taken
//     from §4 "Some Additional Meanings of the Lesser Arcana" (Cups, Two:
//     "Reversed: Passion."), the only reversed reading Waite gives the card.
//     No other card uses §4. (The Four of Pentacles' label is printed
//     "Reversed;" with a semicolon; it is read as the label.)
// Verbatim: Waite's wording, spelling and punctuation are kept, including his
// slips, checked against the page scans ("hope and bright prospects," before
// Reversed in the Star; "total loss though lawsuit" in the Last Judgment).
// Only whitespace is normalised, and two invisible transcription artefacts are
// dropped: U+200B zero-width spaces that Wikisource inserts at page breaks
// (inside "for​tune" in the Wheel) and U+00AD soft hyphens ("abun­dance" in the
// Ace of Cups). One visible artefact is corrected (CORRECTIONS below): the
// transcription keeps a compositor's line-end hyphen in "how-ever" (Three of
// Pentacles; the scan breaks "how-/ever" across lines, sacred-texts reads
// "however"). "over-kindness" (Hierophant) also falls at a line end and is left
// as transcribed: a compound, so the hyphen may be Waite's.
//
// IMAGES. Commons "Category:Rider-Waite tarot deck (Roses & Lilies)", files
// "RWS1909 - 00 Fool.jpeg" … "RWS1909 - Pentacles 14.jpeg": an original 1909
// "Roses & Lilies" printing scanned by Saskia Jansen from her own collection,
// each tagged {{PD-old-70-expired}}. Pamela Colman Smith died in 1951, so the
// 1909 artwork is public domain in the US (published before 1931) and in the
// UK and every life+70 country since 1 Jan 2022; a faithful scan of a 2-D
// public-domain work adds no new copyright (US: Bridgeman v. Corel; UK: CDPA
// s.32A, since 2021). Later recoloured editions (U.S. Games 1971 onwards) are
// NOT used. The script refuses a file whose page lacks a {{PD-…}} template, whose
// extmetadata licence is not "pd", or whose description does not say 1909, and
// checks each download against the Commons SHA-1. File pages:
//   https://commons.wikimedia.org/wiki/File:RWS1909_-_<name>.jpeg
// Commons 01…10 = Ace…Ten, 11 Page, 12 Knight, 13 Queen, 14 King, which is also
// our id scheme. Each image is resized to 360 px wide (aspect kept), WebP q78.
//
// NAMES (verified against live tarot sites per market, Sep 28 2026; see the
// build notes for the tallies): en = the captions printed on the 1909 cards
// (Waite's text calls VIII "Strength, or Fortitude" and XX "The Last
// Judgment"); zh-Hant = Taiwan usage, Aces as 一 (權杖一), courts 侍者 騎士 皇后
// 國王, suit 錢幣; zh-Hans = mainland usage, suit 星币, courts 侍从 骑士 王后 国王,
// Aces as 一; ja = ワンドのエース / カップの2 / ソードのペイジ, 法王 for V; ko =
// 완드 에이스 / 컵 2 / 소드 페이지 / 펜타클 나이트 / 퀸 / 킹.
//
// Run (from the repo root; sharp is already a dependency):
//   node scripts/fetch-tarot.mjs            # text + images
//   node scripts/fetch-tarot.mjs --text-only
//   node scripts/fetch-tarot.mjs --revid=15274510   # pin the Part 3 page
// Note: pinning the Part 3 revision pins its layout, but Part 3 transcludes
// the Page: namespace, whose own revisions can still move. All of it is
// validated text, so a rebuild is expected to be byte-identical; the script
// prints what it fetched. It makes ~1 request per second with a descriptive
// User-Agent, and uses the MediaWiki API (parse / categorymembers / imageinfo)
// rather than scraping HTML pages.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import sharp from 'sharp'

const UA = 'ModelXD-build/1.0 (https://www.modelxd.com)'
const WIKISOURCE = 'https://en.wikisource.org/w/api.php'
const COMMONS = 'https://commons.wikimedia.org/w/api.php'
const PKT_PAGE = 'The Pictorial Key to the Tarot/Part 3'
const PKT_REVID = 15274510 // the revision this deck was built from (2025-08-14)
const CATEGORY = 'Category:Rider-Waite tarot deck (Roses & Lilies)'
const OUT_JSON = 'content/tarot/cards.json'
const OUT_IMG = 'public/xtell/tarot'
const WIDTH = 360
const QUALITY = 78

const argv = process.argv.slice(2)
const textOnly = argv.includes('--text-only')
const revid = Number((argv.find(a => a.startsWith('--revid=')) || '').split('=')[1]) || PKT_REVID

// ---------------------------------------------------------------- fetching

let lastRequest = 0
async function get(url, kind = 'json') {
  for (let attempt = 1; ; attempt++) {
    const wait = lastRequest + 1000 - Date.now() // ~1 request per second
    if (wait > 0) await new Promise(r => setTimeout(r, wait))
    lastRequest = Date.now()
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA } })
    if (res.ok) return kind === 'json' ? res.json() : Buffer.from(await res.arrayBuffer())
    if (attempt < 4 && (res.status === 429 || res.status >= 500)) {
      await new Promise(r => setTimeout(r, 5000 * attempt))
      continue
    }
    throw new Error(`${res.status} ${res.statusText} for ${url}`)
  }
}
const api = (base, params) => get(`${base}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`)

// ---------------------------------------------------------------- the deck

const SUITS = ['wands', 'cups', 'swords', 'pentacles']
const SUIT_NAMES = {
  wands:     { en: 'Wands',     'zh-Hant': '權杖', 'zh-Hans': '权杖', ja: 'ワンド',     ko: '완드' },
  cups:      { en: 'Cups',      'zh-Hant': '聖杯', 'zh-Hans': '圣杯', ja: 'カップ',     ko: '컵' },
  swords:    { en: 'Swords',    'zh-Hant': '寶劍', 'zh-Hans': '宝剑', ja: 'ソード',     ko: '소드' },
  pentacles: { en: 'Pentacles', 'zh-Hant': '錢幣', 'zh-Hans': '星币', ja: 'ペンタクル', ko: '펜타클' },
}
// rank 1…14 as Waite's headings name them in Part III §2 and §4
const PKT_RANKS = ['Ace', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Page', 'Knight', 'Queen', 'King']
const HAN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
const COURT = {
  'zh-Hant': ['侍者', '騎士', '皇后', '國王'],
  'zh-Hans': ['侍从', '骑士', '王后', '国王'],
  ja: ['ペイジ', 'ナイト', 'クイーン', 'キング'],
  ko: ['페이지', '나이트', '퀸', '킹'],
}
function minorNames(suit, rank) {
  const s = SUIT_NAMES[suit]
  const court = rank - 11 // 0 Page … 3 King, negative for pips
  return {
    en: `${PKT_RANKS[rank - 1]} of ${s.en}`,
    'zh-Hant': s['zh-Hant'] + (court >= 0 ? COURT['zh-Hant'][court] : HAN[rank - 1]),
    'zh-Hans': s['zh-Hans'] + (court >= 0 ? COURT['zh-Hans'][court] : HAN[rank - 1]),
    ja: `${s.ja}の${court >= 0 ? COURT.ja[court] : rank === 1 ? 'エース' : rank}`,
    ko: `${s.ko} ${court >= 0 ? COURT.ko[court] : rank === 1 ? '에이스' : rank}`,
  }
}
//            en                     zh-Hant     zh-Hans     ja              ko
const MAJORS = [
  ['The Fool',            '愚者',     '愚人',     '愚者',         '바보'],
  ['The Magician',        '魔術師',   '魔术师',   '魔術師',       '마법사'],
  ['The High Priestess',  '女祭司',   '女祭司',   '女教皇',       '여사제'],
  ['The Empress',         '皇后',     '皇后',     '女帝',         '여황제'],
  ['The Emperor',         '皇帝',     '皇帝',     '皇帝',         '황제'],
  ['The Hierophant',      '教皇',     '教皇',     '法王',         '교황'],
  ['The Lovers',          '戀人',     '恋人',     '恋人',         '연인'],
  ['The Chariot',         '戰車',     '战车',     '戦車',         '전차'],
  ['Strength',            '力量',     '力量',     '力',           '힘'],
  ['The Hermit',          '隱者',     '隐士',     '隠者',         '은둔자'],
  ['Wheel of Fortune',    '命運之輪', '命运之轮', '運命の輪',     '운명의 수레바퀴'],
  ['Justice',             '正義',     '正义',     '正義',         '정의'],
  ['The Hanged Man',      '倒吊人',   '倒吊人',   '吊るされた男', '매달린 사람'],
  ['Death',               '死神',     '死神',     '死神',         '죽음'],
  ['Temperance',          '節制',     '节制',     '節制',         '절제'],
  ['The Devil',           '惡魔',     '恶魔',     '悪魔',         '악마'],
  ['The Tower',           '高塔',     '高塔',     '塔',           '탑'],
  ['The Star',            '星星',     '星星',     '星',           '별'],
  ['The Moon',            '月亮',     '月亮',     '月',           '달'],
  ['The Sun',             '太陽',     '太阳',     '太陽',         '태양'],
  ['Judgement',           '審判',     '审判',     '審判',         '심판'],
  ['The World',           '世界',     '世界',     '世界',         '세계'],
]
const pad = n => String(n).padStart(2, '0')

// ---------------------------------------------------------------- the text

const clean = s => s.replace(/[​­]/g, '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim()

function htmlToLines(html) {
  const text = html
    .replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/g, '')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<\/(p|div|h\d|li|tr|dd|dt)>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, n) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[n])
  const other = text.match(/&[a-z]+;/gi)
  if (other) throw new Error(`undecoded HTML entities: ${[...new Set(other)].join(' ')}`)
  return text.split('\n').map(clean).filter(Boolean)
}

function between(lines, startRe, endRe) {
  const a = lines.findIndex(l => startRe.test(l))
  const b = lines.findIndex((l, i) => i > a && endRe.test(l))
  if (a < 0 || b < 0) throw new Error(`section not found: ${startRe} … ${endRe}`)
  return lines.slice(a + 1, b)
}

function parseMajors(lines) {
  const out = new Map()
  for (const line of lines) {
    const m = line.match(/^(Zero|\d+)\. (.+?)\.—(.+?) Reversed: (.+)$/)
    if (!m) throw new Error(`§3 line not understood: ${line}`)
    const n = m[1] === 'Zero' ? 0 : Number(m[1])
    if (out.has(n)) throw new Error(`§3 trump ${n} twice`)
    out.set(n, { pktName: m[2], upright: m[3].trim(), reversed: m[4].trim() })
  }
  return out
}

function parseLesser(lines) {
  const out = new Map()
  const HEAD = /^(?:THE SUIT OF )?(WANDS|CUPS|SWORDS|PENTACLES)$/
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(HEAD)
    if (!h) continue
    const rank = PKT_RANKS.indexOf(lines[i + 1]) + 1
    if (!rank) throw new Error(`§2 heading ${h[1]} not followed by a rank: ${lines[i + 1]}`)
    const body = []
    for (let j = i + 2; j < lines.length && !HEAD.test(lines[j]); j++) body.push(lines[j])
    const key = `${h[1].toLowerCase()}-${pad(rank)}`
    const meaning = body.filter(p => p.includes('Divinatory Meanings:'))
    if (meaning.length !== 1 || body.length !== 1) throw new Error(`${key}: expected one paragraph with "Divinatory Meanings:", got ${body.length}`)
    const after = meaning[0].split('Divinatory Meanings:')
    if (after.length !== 2) throw new Error(`${key}: "Divinatory Meanings:" not exactly once`)
    // the label is "Reversed:" everywhere but the Four of Pentacles, where the
    // book prints "Reversed;" (italic label, validated against the scan)
    const parts = after[1].split(/Reversed[:;]/)
    if (parts.length > 2) throw new Error(`${key}: "Reversed:" more than once`)
    if (out.has(key)) throw new Error(`§2 card ${key} twice`)
    out.set(key, { upright: parts[0].trim(), reversed: parts.length === 2 ? parts[1].trim() : null })
  }
  return out
}

// §4: "Wands. King.—… Reversed: …", then "Queen.—…" for the same suit.
function parseAdditional(lines) {
  const out = new Map()
  let suit = null
  for (const line of lines) {
    const m = line.match(/^(?:(Wands|Cups|Swords|Pentacles)\. )?(\w+)\.—(.+?)(?: Reversed: (.+))?$/)
    if (!m || !PKT_RANKS.includes(m[2])) throw new Error(`§4 line not understood: ${line}`)
    if (m[1]) suit = m[1].toLowerCase()
    out.set(`${suit}-${pad(PKT_RANKS.indexOf(m[2]) + 1)}`, { upright: m[3].trim(), reversed: m[4] ? m[4].trim() : null })
  }
  return out
}

console.log(`Wikisource: ${PKT_PAGE} @ revision ${revid}`)
const parsed = (await api(WIKISOURCE, { action: 'parse', oldid: String(revid), prop: 'text|revid', disablelimitreport: '1' })).parse
if (parsed.title !== PKT_PAGE) throw new Error(`revision ${revid} is "${parsed.title}", not ${PKT_PAGE}`)
const lines = htmlToLines(parsed.text)

const greater = parseMajors(between(lines, /^THE GREATER ARCANA AND THEIR DIVINATORY MEANINGS$/, /^It will be seen that, except/))
const lesser = parseLesser(between(lines, /^will now be described according to their respective classes/, /^Such are the intimations of the Lesser Arcana/))
const additional = parseAdditional(between(lines, /^SOME ADDITIONAL MEANINGS OF THE LESSER ARCANA$/, /^It will be observed \(1\)/))
console.log(`parsed §3 ${greater.size} trumps, §2 ${lesser.size} lesser cards, §4 ${additional.size} additional meanings`)

const cards = []
MAJORS.forEach(([en, zhHant, zhHans, ja, ko], n) => {
  const g = greater.get(n)
  if (!g) throw new Error(`§3 has no trump ${n}`)
  cards.push({
    id: `major-${pad(n)}`, arcana: 'major', suit: null, rank: n,
    names: { en, 'zh-Hant': zhHant, 'zh-Hans': zhHans, ja, ko },
    upright: g.upright, reversed: g.reversed, image: `/xtell/tarot/major-${pad(n)}.webp`,
  })
})
const fromAdditional = []
for (const suit of SUITS) for (let rank = 1; rank <= 14; rank++) {
  const id = `${suit}-${pad(rank)}`
  const l = lesser.get(id)
  if (!l) throw new Error(`§2 has no ${id}`)
  let reversed = l.reversed
  if (reversed === null) { // only the Two of Cups, see the header
    reversed = additional.get(id)?.reversed ?? null
    fromAdditional.push(`${id} (§4: "${reversed}")`)
  }
  cards.push({
    id, arcana: 'minor', suit, rank, names: minorNames(suit, rank),
    upright: l.upright, reversed, image: `/xtell/tarot/${id}.webp`,
  })
}
// Transcription fixes, each checked against the page scan. A fix whose text
// is no longer in the source (Wikisource corrected it) is skipped, not forced.
const CORRECTIONS = [
  // printed p. 276 (PDF p. 289) breaks "how-/ever" at a line end
  { id: 'pentacles-03', field: 'upright', from: 'usually, how-ever, regarded', to: 'usually, however, regarded' },
]
for (const fix of CORRECTIONS) {
  const card = cards.find(c => c.id === fix.id)
  if (card[fix.field].includes(fix.from)) {
    card[fix.field] = card[fix.field].replace(fix.from, fix.to)
    console.log(`corrected ${fix.id} ${fix.field}: "${fix.from}" → "${fix.to}"`)
  } else console.log(`correction no longer needed: ${fix.id} "${fix.from}"`)
}

console.log(`reversed taken from §4 (no "Reversed:" in §2): ${fromAdditional.join(', ')}`)
if (fromAdditional.length !== 1 || !fromAdditional[0].startsWith('cups-02 ')) {
  throw new Error('expected exactly one §2 card without "Reversed:" (the Two of Cups): the text has changed, re-check the parse')
}

// ---------------------------------------------------------------- validate

const problems = []
if (cards.length !== 78) problems.push(`${cards.length} cards, not 78`)
if (new Set(cards.map(c => c.id)).size !== cards.length) problems.push('duplicate ids')
for (const c of cards) {
  if (!c.upright) problems.push(`${c.id}: empty upright`)
  if (!c.reversed) problems.push(`${c.id}: empty reversed`)
  for (const [lang, v] of Object.entries(c.names)) if (!v) problems.push(`${c.id}: no ${lang} name`)
  if (/[​­]|\s{2}|^\s|\s$/.test(c.upright + '|' + c.reversed)) problems.push(`${c.id}: stray whitespace`)
  if (/Reversed[:;]|Divinatory Meanings:/.test(c.upright + c.reversed)) problems.push(`${c.id}: a label leaked into a meaning`)
}
for (const lang of ['en', 'zh-Hant', 'zh-Hans', 'ja', 'ko']) {
  if (new Set(cards.map(c => c.names[lang])).size !== 78) problems.push(`${lang} names are not unique`)
}
if (problems.length) throw new Error(`validation failed:\n  ${problems.join('\n  ')}`)

fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true })
fs.writeFileSync(OUT_JSON, JSON.stringify(cards, null, 2) + '\n')
console.log(`wrote ${OUT_JSON}: ${cards.length} cards (text from revision ${parsed.revid})`)

// ---------------------------------------------------------------- images

if (!textOnly) {
  const members = []
  let cont = {}
  do {
    const r = await api(COMMONS, { action: 'query', list: 'categorymembers', cmtitle: CATEGORY, cmtype: 'file', cmlimit: '500', ...cont })
    members.push(...r.query.categorymembers.map(m => m.title))
    cont = r.continue || null
  } while (cont)

  const fileFor = new Map()
  for (const t of members) {
    let m = t.match(/^File:RWS1909 - (\d\d) [^/]+\.jpeg$/)
    if (m) { fileFor.set(`major-${m[1]}`, t); continue }
    m = t.match(/^File:RWS1909 - (Wands|Cups|Swords|Pentacles) (\d\d)\.jpeg$/)
    if (m) fileFor.set(`${m[1].toLowerCase()}-${m[2]}`, t)
  }
  const missing = cards.filter(c => !fileFor.has(c.id)).map(c => c.id)
  if (missing.length) throw new Error(`no Commons file in ${CATEGORY} for: ${missing.join(', ')}`)

  const info = new Map()
  const titles = cards.map(c => fileFor.get(c.id))
  for (let i = 0; i < titles.length; i += 50) {
    const r = await api(COMMONS, {
      action: 'query', titles: titles.slice(i, i + 50).join('|'),
      prop: 'imageinfo|revisions', iiprop: 'url|size|sha1|mime|extmetadata', rvprop: 'content', rvslots: 'main',
    })
    for (const p of r.query.pages) info.set(p.title, p)
  }

  fs.mkdirSync(OUT_IMG, { recursive: true })
  const licences = {}
  let total = 0
  for (const c of cards) {
    const title = fileFor.get(c.id)
    const p = info.get(title)
    const ii = p?.imageinfo?.[0]
    const wikitext = p?.revisions?.[0]?.slots?.main?.content || ''
    const pd = wikitext.match(/\{\{\s*(PD-[^}|]+)/i)
    const licence = ii?.extmetadata?.License?.value || ''
    if (!ii || !pd || !/^pd/i.test(licence)) throw new Error(`${title}: not tagged public domain (template ${pd?.[1]}, licence "${licence}")`)
    if (!/1909/.test(wikitext)) throw new Error(`${title}: description does not say 1909`)
    if (ii.mime !== 'image/jpeg') throw new Error(`${title}: ${ii.mime}`)
    licences[pd[1].trim()] = (licences[pd[1].trim()] || 0) + 1

    const original = await get(ii.url.split('?')[0], 'buffer')
    const sha1 = crypto.createHash('sha1').update(original).digest('hex')
    if (sha1 !== ii.sha1) throw new Error(`${title}: SHA-1 ${sha1} does not match Commons ${ii.sha1}`)
    const out = path.join(OUT_IMG, `${c.id}.webp`)
    await sharp(original).resize({ width: WIDTH }).webp({ quality: QUALITY }).toFile(out)
    const meta = await sharp(out).metadata()
    if (meta.width !== WIDTH || meta.format !== 'webp') throw new Error(`${out}: ${meta.format} ${meta.width}px`)
    const bytes = fs.statSync(out).size
    total += bytes
    console.log(`${c.id}  ${ii.width}x${ii.height} → ${meta.width}x${meta.height}  ${(bytes / 1024).toFixed(1)} KB  ${pd[1].trim()}  https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_')).replace(/%3A/, ':')}`)
  }
  console.log(`licence templates: ${JSON.stringify(licences)}`)
  console.log(`wrote ${cards.length} images to ${OUT_IMG}/, ${(total / 1024).toFixed(0)} KB in all`)
}

// every card's image must exist, whether or not this run fetched it
const absent = cards.filter(c => !fs.existsSync(path.join('public', c.image)) || fs.statSync(path.join('public', c.image)).size === 0)
if (absent.length) throw new Error(`images missing: ${absent.map(c => c.image).join(', ')}`)
console.log('ok: 78 cards, unique ids, every upright and reversed non-empty, every image present')
