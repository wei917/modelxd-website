// scripts/build-kangxi-strokes.ts — 姓名學 stroke counts from Unihan.
//
//   npx tsx scripts/build-kangxi-strokes.ts /path/to/Unihan_IRGSources.txt /path/to/CJKRadicals.txt
//   → content/names/kangxi.json   { "陳": [16, 170], ... }   (strokes, radical number)
//   → content/names/radicals.json { "170": ["阜", 8], ... }
//
// 姓名學 counts strokes the 康熙字典 way: the radical at its FULL form (氵
// is 水 = 4, 艹 is 艸 = 6, 阝 on the left is 阜 = 8, on the right 邑 = 7, 月
// meaning 肉 = 6, 礻 is 示 = 5, 辶 is 辵 = 7) plus the residual strokes. That
// is exactly what Unihan's kRSUnicode encodes (radical number . residual;
// a negative residual marks a radical written in a reduced form, so 王 =
// 玉 5 − 1 = 4, matching every 姓名學 table). The 214 radicals' own stroke
// counts come from their unified-ideograph forms via kTotalStrokes, with
// CJKRadicals.txt as the bridge. Unicode data, free to use.
//
// The numerals are the one convention Unihan cannot know: 姓名學 counts
// 一二三四五六七八九十 as their VALUE (四 = 4, not 5; 十 = 10, not 2), so
// they are overridden here. Scope: URO + Extension A (the characters a
// Taiwanese name can realistically contain).

import fs from 'node:fs'
import path from 'node:path'

const [irg, radicalsFile] = process.argv.slice(2)
if (!irg || !radicalsFile) { console.error('usage: build-kangxi-strokes.ts <Unihan_IRGSources.txt> <CJKRadicals.txt>'); process.exit(1) }

const total = new Map<number, number>()   // codepoint → kTotalStrokes (first value)
const rs = new Map<number, string>()       // codepoint → kRSUnicode (first value)
for (const line of fs.readFileSync(irg, 'utf-8').split('\n')) {
  if (!line || line[0] === '#') continue
  const [cp, field, value] = line.split('\t')
  const n = parseInt(cp.slice(2), 16)
  if (field === 'kTotalStrokes') total.set(n, parseInt(value.split(' ')[0], 10))
  else if (field === 'kRSUnicode') rs.set(n, value.split(' ')[0])
}

// radical number → strokes of the radical's full form
const radStrokes = new Map<number, number>()
for (const line of fs.readFileSync(radicalsFile, 'utf-8').split('\n')) {
  if (!line || line[0] === '#') continue
  const [num, , ideo] = line.split(';').map(s => s.trim())
  if (num.includes("'")) continue                       // simplified variants — 姓名學 is traditional
  const cp = parseInt(ideo, 16)
  const s = total.get(cp)
  if (s) radStrokes.set(parseInt(num, 10), s)
}
if (radStrokes.size !== 214) throw new Error(`expected 214 radicals, got ${radStrokes.size}`)

const NUMERALS: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
const out: Record<string, [number, number]> = {}
const radOut: Record<string, [string, number]> = {}
for (const line of fs.readFileSync(radicalsFile, 'utf-8').split('\n')) {
  if (!line || line[0] === '#') continue
  const [num, , ideo] = line.split(';').map(s => s.trim())
  if (num.includes("'")) continue
  const strokes = radStrokes.get(parseInt(num, 10))
  if (strokes) radOut[num] = [String.fromCodePoint(parseInt(ideo, 16)), strokes]
}
fs.writeFileSync(path.join(process.cwd(), 'content', 'names', 'radicals.json'), JSON.stringify(radOut))
const inScope = (n: number) => (n >= 0x4e00 && n <= 0x9fff) || (n >= 0x3400 && n <= 0x4dbf)
for (const [cp, v] of rs) {
  if (!inScope(cp)) continue
  const m = v.match(/^(\d+)('*)\.(-?\d+)$/)
  if (!m) continue
  const rad = radStrokes.get(parseInt(m[1], 10))
  if (!rad) continue
  const ch = String.fromCodePoint(cp)
  out[ch] = [NUMERALS[ch] ?? rad + parseInt(m[3], 10), parseInt(m[1], 10)]
}
const file = path.join(process.cwd(), 'content', 'names', 'kangxi.json')
fs.writeFileSync(file, JSON.stringify(out))
console.log(`${Object.keys(out).length} characters → ${path.relative(process.cwd(), file)} (${Math.round(fs.statSync(file).size / 1024)} KB)`)
// Spot checks against the surname tables every 姓名學 book prints.
const expect: Record<string, number> = { 王: 4, 陳: 16, 林: 8, 張: 11, 李: 7, 黃: 12, 蔡: 17, 許: 11, 鄭: 19, 謝: 17, 洪: 10, 郭: 15, 周: 8, 吳: 7, 楊: 13, 劉: 15, 曾: 12, 廖: 14, 賴: 16, 徐: 10, 葉: 15, 蘇: 22, 莊: 13, 呂: 7, 江: 7, 何: 7, 蕭: 18, 羅: 20, 高: 10, 潘: 16, 簡: 18, 朱: 6, 鍾: 17, 游: 13, 彭: 12, 邱: 12, 四: 4, 十: 10, 玉: 5, 淑: 12, 芬: 10, 志: 7, 明: 8, 美: 9, 雅: 12, 婷: 12, 豪: 14, 偉: 11 }
let bad = 0
for (const [ch, want] of Object.entries(expect)) if (out[ch]?.[0] !== want) { bad++; console.log(`  ✗ ${ch}: got ${out[ch]?.[0]}, expected ${want}`) }
console.log(bad ? `${bad} mismatch(es)` : `all ${Object.keys(expect).length} spot checks hold`)
