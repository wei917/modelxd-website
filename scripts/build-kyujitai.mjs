// scripts/build-kyujitai.mjs — Japanese new-form kanji and their old forms
// (続 → 續, 沢 → 澤, 広 → 廣), as content/names/kyujitai.json (Sep 29).
//
// 姓名判断 in Japan has two schools: count the name as it is written, or
// count the 旧字体 (the orthodox 熊崎式 way). The site counts what is written
// (lib/names.ts), so on Japanese pages it also shows the old form and its
// strokes for any new-form character, and either school can be followed.
// The pairs are OpenCC's Japanese table (jp → t), kept only where both
// characters are in the site's 康熙 stroke table and their strokes differ.
// OpenCC is used here only, at build time.
//
//   NODE_PATH=<dir with opencc-js@1> node scripts/build-kyujitai.mjs
import fs from 'node:fs'
import { createRequire } from 'node:module'

const OpenCC = createRequire(import.meta.url)('opencc-js')
const toOld = OpenCC.Converter({ from: 'jp', to: 't' })
const strokes = JSON.parse(fs.readFileSync('content/names/kangxi.json', 'utf8'))

const out = {}
for (const ch of Object.keys(strokes)) {
  const old = toOld(ch)
  if (old === ch || [...old].length !== 1 || !strokes[old]) continue
  if (strokes[old][0] === strokes[ch][0]) continue
  out[ch] = old
}
fs.writeFileSync('content/names/kyujitai.json', JSON.stringify(out) + '\n')
console.log(`${Object.keys(out).length} pairs`, ['続', '沢', '広', '竜', '桜', '国', '売', '斉'].map(c => `${c}→${out[c] ?? '-'}`).join(' '))
