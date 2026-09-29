// scripts/fetch-guanyin-qian.ts — build the two 觀音百籤 corpora.
//
// The site calls the room 觀音廟, the general name, and names the sets only as
// 觀音一百籤 ('yibai') and 元三大師 觀音百籤 ('gansan'): no real temple is claimed
// (owner, Sep 28). The temples below are named only as where each
// transcription was checked.
//
//   npx tsx scripts/fetch-guanyin-qian.ts               → content/qian/guanyin-yibai.json
//                                                         content/qian/guanyin-gansan.json
//   npx tsx scripts/fetch-guanyin-qian.ts --crosscheck  → the same, then fetches the secondary
//                                                         sources and prints every line on which
//                                                         they disagree with what was written
//
// ~200 page fetches at ~1 per second, so a run takes about four minutes (wrap it in
// `caffeinate -is` on a Mac that idles to sleep). Same shape as guandi.json / mazu.json:
//   { n, ganZhi, luck, story, poem: [4 lines], sections: {} }
//
// ── LICENCE ───────────────────────────────────────────────────────────────────
// The poems, grades and 典故 titles are centuries-old temple text (the 觀音一百籤 and
// the 元三大師 / 觀音百籤 both circulated in print long before 1900) and are in the public
// domain by age. That is ALL this script takes: the four lines, the grade and the story
// title. Every website below also carries modern writing (白話 explanations, 解籤, 聖意
// topic sheets, 詳解, translations); that is deliberately NOT parsed, because its
// copyright is unknown. `sections` stays {} for both: no pre-1950 commentary was
// reachable (see "Old edition" below).
//
// ── 1. 艋舺龍山寺 觀世音靈籤 (guanyin-yibai.json, 7-character quatrains) ────────
// The temple's own online stick pages (lungshan.org.tw/fortune_sticks/) have been gone
// (404) since 2025. What the build uses:
//   POEMS  籤詩網 chance.org.tw, 觀音一百籤, one page per stick, block 詩曰一.
//          This is, character for character, the text the temple's own site showed: the
//          five official pages still in the Wayback Machine (17, 31, 45, 73, 99) match it
//          exactly, down to 着 and 卻. (詩曰二 on the same pages is a different, mainland
//          edition and is ignored.)
//   GRADE  github.com/HunkJia/HUNK 观音签详解.md, pinned to commit 3e5f2bc (2018): a
//   STORY  transcription of the Longshan slips, headed "第N首：<典故>　<grade>". Only
//          the heading is used; its poems are noisy and its commentary is not taken.
//          It agrees with every Longshan slip image the temple published (Wayback copies
//          of lungshan.org.tw/fortune_sticks/images/017, 031, 045, 049, 068, 070, 072,
//          073, 093, 099.jpg: grade and 典故 10/10) and with the grades in the 國家文化
//          記憶庫 record titles "龍山寺觀世音靈籤第N首<grade>" (1, 25, 33, 38, 51, 55, 61,
//          73, 78, 85, 91, 93 agree; 99 there reads 平 where today's slip prints 中平,
//          and the slip wins).
//   ganZhi  "" — the Longshan slip prints no 干支 (it prints 第N首, grade, 典故).
//   luck    exactly as the slip prints it: 上上, 大吉, 中中, 中平, 中吉, … The Longshan
//          edition leaves the grade BLANK on about a quarter of its sticks (the slip
//          images for 31, 49 and 70 show the empty cell), so those carry luck "" rather
//          than an invented grade. They are listed in LONGSHAN_UNGRADED and asserted.
//          (籤詩網's own 上籤/中籤/下籤 is a coarser three-step scheme that does not
//          match the slips — 73 上上 vs 上籤, 93 中中 vs 中籤 — so it is not used.)
//   Cross-check (--crosscheck): temples.tw/stick/fs_yin100 (all 100 on one page) and the
//          HunkJia poems. Other sources consulted by hand when this was built: 解籤閣
//          fortune-poems.blogspot.com (an older copy of 籤詩網's text, so not independent),
//          temple-in-taiwan.com, the vocus「神明的小紙條」series (19 楊雄 with 木 is how
//          the slip spells it), and a 1969 Longshan slip for 第三十二首 in the 國家人權
//          博物館 collection (tcmb.culture.tw MOCCOLLECTIONS 15000004520), which reads
//          「一朝良匠分明剖」.
//
// ── 2. 淺草寺 觀音百籤 / 元三大師御籤 (guanyin-gansan.json, 5-character quatrains) ──
//   POEMS  籤詩網 chance.org.tw, 淺草金龍山觀音寺一百籤: a Traditional-character
//   GRADE  transcription of the slips bought at 淺草寺 (their note: all 100 collected in
//          2003, typed in 2007 with the rare and variant characters). The first block on
//          each page is used; its 日文漢字 block is a different edition copied from a
//          Japanese site and is ignored. The grade count it yields is exactly 淺草寺's
//          published split — 大吉 17, 吉 35, 半吉 5, 小吉 4, 末小吉 3, 末吉 6, 凶 30 — and
//          that is asserted below. Slip photos on Wikimedia Commons (Category:Omikuji at
//          Sensōji) agree for 2, 15, 47, 70 and 90 except where corrected below.
//   ganZhi, story  "" — the slip prints neither.
//   Cross-check (--crosscheck): 元三大師百籤 as published by 天台宗妙法寺 (busondera.com),
//          quoted in full at nam-students.blogspot.com/2018/03/blog-post_61.html. That is
//          another temple's edition, so a few grades (their 半吉 where 淺草寺 has 小吉) and
//          characters differ by design; the print-out is for review, not a gate.
//
// ── Old edition ──
// 國家文化記憶庫 once held the 昭和八年 Longshan slips with their 解 lines (online_metadata
// 597743–597842); the records now 404 and the Wayback Machine has none, so no pre-1950
// text could be observed and none is included.
//
// Every correction below is an explicit, documented override of what the primary source
// prints; each one asserts the text it replaces, so a change upstream fails loudly.

import fs from 'node:fs/promises'
import path from 'node:path'

const UA = 'ModelXD-build/1.0 (https://www.modelxd.com)'
const OUT_DIR = path.join(process.cwd(), 'content', 'qian')
const CROSSCHECK = process.argv.includes('--crosscheck')

type Qian = { n: number; ganZhi: string; luck: string; story: string; poem: string[]; sections: Record<string, string> }

const CHANCE = 'http://www.chance.org.tw/'
const pad3 = (n: number) => String(n).padStart(3, '0')
const LONGSHAN_URL = (n: number) => CHANCE + encodeURI(`籤詩集/觀音一百籤/籤詩網‧觀音一百籤__第${pad3(n)}籤.htm`)
const SENSOJI_URL = (n: number) => CHANCE + encodeURI(`籤詩集/淺草金龍山觀音寺一百籤/籤詩網‧淺草金龍山觀音寺一百籤__第${pad3(n)}籤.htm`)
const HUNK_URL = 'https://raw.githubusercontent.com/HunkJia/HUNK/3e5f2bc2954480aeadf94d5070dc09182e2c53a2/' + encodeURIComponent('观音签详解.md')
const TEMPLES_TW_URL = 'https://temples.tw/stick/fs_yin100'
const BUSONDERA_COPY_URL = 'http://nam-students.blogspot.com/2018/03/blog-post_61.html'

// ── Corrections (from the cross-check; see the report in the header) ─────────────

/** 艋舺龍山寺 poem: [n, line index 0-3, as 籤詩網 prints it, as the slip prints it, why]. */
const LONGSHAN_POEM_FIX: [number, number, string, string, string][] = [
  [32, 2, '一朝良臣分明剖', '一朝良匠分明剖', '1969 Longshan slip (國家人權博物館 via 國家文化記憶庫) and the HunkJia transcription both read 良匠'],
]

/** 艋舺龍山寺 典故: transcription slips in the HunkJia heading, fixed to the form 籤詩網's story list gives. */
const LONGSHAN_STORY_FIX: Record<number, [string, string]> = {
  8: ['范文公斷虀畫粥', '范文正公斷虀畫粥'],
  11: ['劉先生入贅東吳', '劉先主入贅東吳'],
  30: ['楚懷主入秦武關', '楚懷王入秦武關'],
  36: ['劉先主進葭萠關', '劉先主進葭萌關'],
  39: ['曹操遣襧衡投黃祖', '曹操遣禰衡投黃祖'],
  47: ['高遠夫五十得名', '高達夫五十得名'],
  54: ['呂仙枕黃梁未熟', '呂仙枕黃粱未熟'],
  81: ['風送籐王閣', '風送滕王閣'],
}

/** Longshan sticks whose slip prints no grade (luck ""). 31, 49, 70 are confirmed on the
 *  temple's own slip images. 41 is the one to re-check against a physical slip: a 2008
 *  survey counts 25 ungraded + one 下下, and no source reachable here shows a 下下. */
const LONGSHAN_UNGRADED = [3, 7, 10, 15, 24, 30, 31, 32, 39, 41, 49, 52, 54, 60, 63, 64, 65, 66, 70, 74, 77, 84, 88, 97, 98, 100]
const LONGSHAN_GRADES = new Set(['上上', '上吉', '上中', '上平', '上', '大吉', '中上', '中吉', '中中', '中平', '中', '平中', '平平', '平'])

/** 淺草寺 poem: [n, line index, as 籤詩網 prints it, corrected, why]. */
const SENSOJI_POEM_FIX: [number, number, string, string, string][] = [
  [7, 2, '遇碾香輪去', '欲碾香輪去', "籤詩網's own translation section on the same page reads 欲; busondera, shichihuku and the 日文漢字 edition all read 欲"],
  [47, 2, '若遇重山去', '若過重山去', 'a 淺草寺 slip photographed in 2005 (Wikimedia Commons, "Omikuji by hirotomo in Asakusa, Tokyo") prints 若過; every other edition agrees'],
]
const SENSOJI_GRADE_COUNT: Record<string, number> = { 大吉: 17, 吉: 35, 半吉: 5, 小吉: 4, 末小吉: 3, 末吉: 6, 凶: 30 }

// ── Fetch + text helpers ─────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
let lastFetch = 0
async function get(url: string, encoding: 'utf-8' | 'big5' = 'utf-8'): Promise<string> {
  const wait = lastFetch + 1100 - Date.now()
  if (wait > 0) await sleep(wait)
  lastFetch = Date.now()
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      // WHATWG big5 is Big5-HKSCS with the ETEN rows, so it also covers the cp950 裏 (F9D8).
      return new TextDecoder(encoding).decode(await res.arrayBuffer())
    } catch (e) {
      if (attempt >= 3) throw new Error(`${url}: ${(e as Error).message}`)
      await sleep(3000 * attempt)
    }
  }
}

const NAMED: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const decodeEntities = (s: string) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&([a-z]+);/gi, (m, k) => NAMED[k.toLowerCase()] ?? m)

/** Page → text with one line per block. Inline tags (the coloured rare characters) are
 *  removed without a break so a line such as 舊<font>愆</font>何日解 stays whole. */
function pageText(html: string): string {
  return decodeEntities(html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>|<\/td>|<p[^>]*>|<div[^>]*>|<tr[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ''))
}

/** A poem line with every space and punctuation mark removed. */
const bare = (s: string) => s.replace(/[\s　、，,。．.：:；;！!？?「」『』（）()]/g, '')

const CN_DIGITS = '〇一二三四五六七八九'
function cnNumber(s: string): number {
  if (s === '百' || s === '一百') return 100
  const [tens, ones] = s.includes('十') ? s.split('十') : ['', s]
  const t = s.includes('十') ? (tens ? CN_DIGITS.indexOf(tens) : 1) : 0
  const o = ones ? CN_DIGITS.indexOf(ones) : 0
  if (t < 0 || o < 0) throw new Error(`not a numeral: ${s}`)
  return t * 10 + o
}

// ── 艋舺龍山寺 ────────────────────────────────────────────────────────────────

/** 籤詩網 觀音一百籤 page → the four lines of 詩曰一. */
export function parseLongshanPoem(n: number, html: string): string[] {
  const t = pageText(html)
  const i = t.indexOf('詩曰一')
  if (i < 0) throw new Error(`龍山寺 ${n}: no 詩曰一`)
  let j = t.indexOf('詩曰二', i)
  if (j < 0) j = t.indexOf('詩意', i)
  const lines = t.slice(i + 3, j).split('\n').map(bare).filter(Boolean)
  return lines.slice(0, 4) // what follows the fourth line is 籤詩網's pronunciation notes
}

/** HunkJia 观音签详解.md → n → { story, luck, poem } from each "第N首：典故　grade" heading. */
export function parseHunk(md: string): Map<number, { story: string; luck: string; poem: string[] }> {
  const heads = [...md.matchAll(/^第(.+?)首：(.*)$/gm)]
  const out = new Map<number, { story: string; luck: string; poem: string[] }>()
  heads.forEach((m, i) => {
    const n = cnNumber(m[1])
    const [story = '', luck = ''] = m[2].split(/[\s　]+/).filter(Boolean)
    const body = md.slice(m.index! + m[0].length, heads[i + 1]?.index ?? md.length)
    const poem = body.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 2)
      .flatMap(l => l.split(/[，,]/)).map(bare).filter(Boolean)
    out.set(n, { story, luck, poem })
  })
  return out
}

async function buildLongshan(): Promise<{ qian: Qian[]; hunk: ReturnType<typeof parseHunk> }> {
  const hunk = parseHunk(await get(HUNK_URL))
  if (hunk.size !== 100) throw new Error(`HunkJia: ${hunk.size} headings, expected 100`)
  const qian: Qian[] = []
  for (let n = 1; n <= 100; n++) {
    const poem = parseLongshanPoem(n, await get(LONGSHAN_URL(n), 'big5'))
    const h = hunk.get(n)
    if (!h) throw new Error(`HunkJia: no 第${n}首`)
    let story = h.story
    const fix = LONGSHAN_STORY_FIX[n]
    if (fix) {
      if (story !== fix[0]) throw new Error(`龍山寺 ${n}: story fix expects ${fix[0]}, source has ${story}`)
      story = fix[1]
    }
    qian.push({ n, ganZhi: '', luck: h.luck, story, poem, sections: {} })
    process.stdout.write(`\r龍山寺 ${n}/100`)
  }
  process.stdout.write('\n')
  for (const [n, i, from, to] of LONGSHAN_POEM_FIX) {
    const q = qian[n - 1]
    if (q.poem[i] !== from) throw new Error(`龍山寺 ${n}: poem fix expects ${from}, source has ${q.poem[i]}`)
    q.poem[i] = to
  }
  return { qian, hunk }
}

// ── 淺草寺 ───────────────────────────────────────────────────────────────────

const SENSOJI_MARK = '日本淺草觀音寺一百籤（日本佛寺一百籤）'

/** 籤詩網 淺草 page → grade and the four lines of the first (Traditional-character) block. */
export function parseSensoji(n: number, html: string): { luck: string; poem: string[] } {
  const t = pageText(html)
  const i = t.indexOf(SENSOJI_MARK)
  const j = t.indexOf('日文漢字', i)
  if (i < 0 || j < 0) throw new Error(`淺草寺 ${n}: block not found`)
  const lines = t.slice(i + SENSOJI_MARK.length, j).split('\n').map(bare).filter(Boolean)
  const head = lines[0]?.match(/^第([〇一二三四五六七八九十百]+)籤?(.+)$/)
  if (!head) throw new Error(`淺草寺 ${n}: no heading in ${lines[0]}`)
  if (cnNumber(head[1]) !== n) throw new Error(`淺草寺 ${n}: heading says ${head[1]}`)
  return { luck: head[2], poem: lines.slice(1, 5) } // anything after is 籤詩網's gloss
}

async function buildSensoji(): Promise<Qian[]> {
  const qian: Qian[] = []
  for (let n = 1; n <= 100; n++) {
    const { luck, poem } = parseSensoji(n, await get(SENSOJI_URL(n), 'big5'))
    qian.push({ n, ganZhi: '', luck, story: '', poem, sections: {} })
    process.stdout.write(`\r淺草寺 ${n}/100`)
  }
  process.stdout.write('\n')
  for (const [n, i, from, to] of SENSOJI_POEM_FIX) {
    const q = qian[n - 1]
    if (q.poem[i] !== from) throw new Error(`淺草寺 ${n}: poem fix expects ${from}, source has ${q.poem[i]}`)
    q.poem[i] = to
  }
  return qian
}

// ── Validation ───────────────────────────────────────────────────────────────

function validate(name: string, qian: Qian[], lineLength: number, luckOk: (q: Qian) => boolean) {
  if (qian.length !== 100) throw new Error(`${name}: ${qian.length} sticks, expected 100`)
  qian.forEach((q, i) => {
    if (q.n !== i + 1) throw new Error(`${name}: stick ${i + 1} is numbered ${q.n}`)
    if (q.poem.length !== 4) throw new Error(`${name} ${q.n}: ${q.poem.length} lines: ${q.poem.join('/')}`)
    for (const l of q.poem) {
      if ([...l].length !== lineLength) throw new Error(`${name} ${q.n}: "${l}" is not ${lineLength} characters`)
      if (/[^\p{Script=Han}]/u.test(l)) throw new Error(`${name} ${q.n}: "${l}" has a non-Han character`)
    }
    if (!luckOk(q)) throw new Error(`${name} ${q.n}: bad luck "${q.luck}"`)
  })
}

const tally = (qian: Qian[]) => qian.reduce<Record<string, number>>((m, q) => ((m[q.luck || '(none)'] = (m[q.luck || '(none)'] ?? 0) + 1), m), {})

// ── Cross-check (optional) ───────────────────────────────────────────────────

/** Folds the Japanese standard forms and plain variants the editions trade, so only real
 *  textual differences are printed. Pairs are [kept, folded]. */
const FOLD = new Map<string, string>(
  ('祿禄 發発 乘乗 舊旧 應応 寶宝 變変 處処 步歩 黑黒 晚晩 勞労 戶戸 殘残 將将 歸帰 當当 來来 圖図 內内 滿満 菓果 ' +
    '滯滞 黃黄 裡裏 綠緑 爭争 鉤鈎 鄉郷 顯顕 獨独 兩両 亂乱 從従 值値 舉挙 舉擧 溪渓 惱悩 萬万 每毎 聲声 藏蔵 靜静 ' +
    '氣気 雞鶏 雞鷄 峯峰 兇凶 虛虚 悅悦 顏顔 兔兎 邊辺 歲歳 船舩 偷偸 圓円 攜携 覺覚 轉転 數数 兒児 經経 隨随 說説 ' +
    '艷艶 剝剥 雙双 斷断 藥薬 壺壷 澤沢 權権 實実 榮栄 徑径 疏疎 疏踈 騷騒 穩穏 飜翻 嚴厳 臺台 濟済 樓楼 絲糸 總総 ' +
    '真眞 闊濶 涉渉 草艸 稱称 閑閒 為爲 卻却 着著 恆恒 覓覔 礙碍 煙烟 麻蔴 鬥鬪 癡痴 汙污 啋采 矇朦 矓朧')
    .split(' ').map(p => [p[1], p[0]] as [string, string]),
)
const fold = (s: string) => [...s].map((c, i, a) => (c === '々' && i ? FOLD.get(a[i - 1]) ?? a[i - 1] : FOLD.get(c) ?? c)).join('')

function report(label: string, ours: Qian[], theirs: Map<number, string[]>) {
  let differ = 0
  for (const q of ours) {
    const p = theirs.get(q.n)
    if (!p) { console.log(`  ${label} ${q.n}: missing`); continue }
    q.poem.forEach((l, i) => {
      if (p[i] && fold(p[i]) !== fold(l)) { differ++; console.log(`  ${label} ${q.n}.${i + 1}: ours ${l} · theirs ${p[i]}`) }
    })
  }
  console.log(`  ${label}: ${theirs.size} sticks compared, ${differ} lines differ after folding variant forms`)
}

async function crosscheck(longshan: Qian[], hunk: ReturnType<typeof parseHunk>, sensoji: Qian[]) {
  console.log('\n── cross-check: 艋舺龍山寺 vs temples.tw')
  const tw = new Map<number, string[]>()
  for (const m of (await get(TEMPLES_TW_URL)).matchAll(/<div id="(\d+)" class="fs_poetry_box fs_link">[\s\S]*?fs_poetry_w_text">([\s\S]*?)<\/div>/g))
    tw.set(Number(m[1]), m[2].split(/<br\s*\/?>/).map(bare).filter(Boolean))
  report('temples.tw', longshan, tw)
  console.log('── cross-check: 艋舺龍山寺 vs HunkJia poems')
  report('HunkJia', longshan, new Map([...hunk].map(([n, h]) => [n, h.poem])))

  console.log('── cross-check: 淺草寺 vs 妙法寺 (busondera) 元三大師百籤')
  const text = pageText(await get(BUSONDERA_COPY_URL))
  const bus = new Map<number, string[]>()
  const busLuck = new Map<number, string>()
  const toAscii = (s: string) => s.replace(/[０-９]/g, d => String(d.charCodeAt(0) - 0xff10))
  for (const m of text.matchAll(/第([０-９0-9]+)番「([^」]+)」\s*([^\s　]{5})[　 ]+([^\s　]{5})[　 ]+([^\s　]{5})[　 ]+([^\s　]{5})/g)) {
    const n = Number(toAscii(m[1]))
    if (!bus.has(n)) { bus.set(n, [m[3], m[4], m[5], m[6]]); busLuck.set(n, m[2]) }
  }
  report('busondera', sensoji, bus)
  const gradeDiff = sensoji.filter(q => busLuck.has(q.n) && busLuck.get(q.n) !== q.luck).map(q => `${q.n} ${q.luck}/${busLuck.get(q.n)}`)
  console.log(`  busondera grades differ on ${gradeDiff.length}: ${gradeDiff.join(', ')}`)
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { qian: longshan, hunk } = await buildLongshan()
  validate('龍山寺', longshan, 7, q => (LONGSHAN_UNGRADED.includes(q.n) ? q.luck === '' : LONGSHAN_GRADES.has(q.luck)))
  for (const q of longshan) if (!q.story) throw new Error(`龍山寺 ${q.n}: no 典故`)

  const sensoji = await buildSensoji()
  validate('淺草寺', sensoji, 5, q => q.luck in SENSOJI_GRADE_COUNT)
  const count = tally(sensoji)
  for (const [g, k] of Object.entries(SENSOJI_GRADE_COUNT))
    if (count[g] !== k) throw new Error(`淺草寺: ${count[g] ?? 0} × ${g}, 淺草寺 publishes ${k}`)

  await fs.mkdir(OUT_DIR, { recursive: true })
  for (const [file, qian] of [['guanyin-yibai.json', longshan], ['guanyin-gansan.json', sensoji]] as const) {
    await fs.writeFile(path.join(OUT_DIR, file), JSON.stringify(qian, null, 1) + '\n')
    console.log(`wrote ${qian.length} 籤 → content/qian/${file}  ${JSON.stringify(tally(qian))}`)
  }
  for (const q of [longshan[0], longshan[49], longshan[99], sensoji[0], sensoji[49], sensoji[99]])
    console.log(`  ${q.n} ${q.luck || '—'} ${q.story} ${q.poem.join('/')}`)

  if (CROSSCHECK) await crosscheck(longshan, hunk, sensoji)
}

if (process.argv[1]?.endsWith('fetch-guanyin-qian.ts')) main().catch(e => { console.error(e); process.exit(1) })
