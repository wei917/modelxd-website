// scripts/test-yijing.ts — the 易學堂 engine and corpus.
//   npx tsx scripts/test-yijing.ts        (also run by npm run test:xtell)
//
// Three kinds of expected value, none of them recalled:
//   1. cases 朱熹 himself cites in 考變占 (the 左傳/國語 casts), with the 之卦
//      and the text he says to read;
//   2. the 前十卦/後十卦 endpoints the commentary in the same volume states
//      for 乾 and 坤;
//   3. ten cases prepared independently by Codex from the same primary
//      source (output/yixuetang-launch/independent-goldens.json, Sep 26),
//      copied here verbatim so the suite has no outside dependency.
// Plus the corpus: every hexagram's trigrams against the engine's table, and
// the texts 朱熹's cases quote against the fetched text.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  HEXAGRAMS, hexagram, hexagramOfLines, castOf, readingRule, lineLabel, valueOf,
  throwCoins, validLines, type LineValue, type Focus,
} from '../lib/yijing-core'
import { asYixueMode, namedHexagrams, yixueChart, yixueFacts, yixueInputError } from '../lib/yijing'

let fails = 0
const check = (name: string, cond: boolean, extra = '') => {
  if (!cond) { fails++; console.log('FAIL', name, extra) } else console.log('ok  ', name, extra)
}
const byName = (name: string) => HEXAGRAMS.find(h => h.name === name)!.n
/** A cast from 本卦 name and the positions that move. */
const castFrom = (name: string, moving: number[]): LineValue[] =>
  hexagram(byName(name)).lines.map((b, i) => (moving.includes(i + 1) ? (b ? 9 : 6) : (b ? 7 : 8)))

// ── The table ──────────────────────────────────────────────────────────────
check('64 hexagrams, 64 distinct patterns', HEXAGRAMS.length === 64 && new Set(HEXAGRAMS.map(h => h.lines.join(''))).size === 64)
check('full names', [1, 2, 3, 11, 12, 29, 30, 64].map(n => hexagram(n).fullName).join(' ') === '乾為天 坤為地 水雷屯 地天泰 天地否 坎為水 離為火 火水未濟')
// Codex's independent binary anchors (bottom → top).
const anchors: Array<[number, string, string]> = [[1, '乾', '111111'], [2, '坤', '000000'], [11, '泰', '111000'], [12, '否', '000111'], [29, '坎', '010010'], [30, '離', '101101'], [63, '既濟', '101010'], [64, '未濟', '010101']]
check('independent binary anchors', anchors.every(([n, name, bits]) => hexagram(n).name === name && hexagram(n).lines.join('') === bits))
check('line labels', lineLabel(1, 1) === '初九' && lineLabel(2, 0) === '六二' && lineLabel(5, 1) === '九五' && lineLabel(6, 0) === '上六')
check('coins sum to 6–9', [[2, 2, 2], [3, 2, 2], [3, 3, 2], [3, 3, 3]].map(c => valueOf(c as any)).join(',') === '6,7,8,9')
{
  let seq = 0
  const r = () => [0.1, 0.9, 0.1][seq++ % 3]
  const c = throwCoins(r)
  check('throwCoins maps rand to faces', c.join(',') === '2,3,2')
}
check('validLines', validLines([6, 7, 8, 9, 7, 8]) && !validLines([5, 7, 8, 9, 7, 8]) && !validLines([7, 7, 7]))

// ── The corpus agrees with the table ───────────────────────────────────────
const corpus = JSON.parse(readFileSync(join(process.cwd(), 'content', 'yijing', 'zhouyi.json'), 'utf-8'))
const text = new Map<string, any>(corpus.hexagrams.map((h: any) => [h.name, h]))
check('corpus has 64 in King Wen order with the same trigrams',
  corpus.hexagrams.length === 64 && corpus.hexagrams.every((h: any, i: number) =>
    h.n === i + 1 && h.name === HEXAGRAMS[i].name && h.lower === HEXAGRAMS[i].lower && h.upper === HEXAGRAMS[i].upper
    && h.lines.join('') === HEXAGRAMS[i].lines.join('')))
check('用九 only on 乾, 用六 only on 坤', corpus.hexagrams.every((h: any) => (h.n === 1) === (h.use?.label === '用九') && (h.n === 2) === (h.use?.label === '用六')))
check('every correction is recorded with a witness', corpus.source.corrections.length > 0 && corpus.source.corrections.every((c: any) => c.witness && c.reason && c.from !== c.to))

// ── 朱熹's own cases (考變占, with the 左傳/國語 casts he cites) ──────────────
const oneLine: Array<[string, number, string]> = [
  ['屯', 1, '比'],       // 畢萬遇屯之比，初九變也
  ['乾', 2, '同人'],     // 蔡墨遇乾之同人，九二變也
  ['大有', 3, '睽'],     // 晉文公遇大有之睽，九三變也
  ['觀', 4, '否'],       // 陳敬仲遇觀之否，六四變也
  ['坤', 5, '比'],       // 南蒯遇坤之比，六五變也
  ['歸妹', 6, '睽'],     // 晉獻公遇歸妹之睽，上六變也
]
for (const [ben, p, zhi] of oneLine) {
  const v = castFrom(ben, [p])
  const r = readingRule(v)
  check(`一爻變 ${ben}之${zhi}`, castOf(v).zhi.name === zhi && r.focus.length === 1 && r.focus[0].kind === 'line' && r.focus[0].role === 'ben' && r.focus[0].position === p)
}
{
  // 晉公子重耳 …遇貞屯悔豫皆八，初與四五凡三爻變 — 司空季子: 皆利建侯.
  const v = castFrom('屯', [1, 4, 5])
  const r = readingRule(v)
  check('三爻變 貞屯悔豫 (重耳)', castOf(v).zhi.name === '豫' && r.front === true
    && r.focus[0].role === 'ben' && r.focus[0].primary === true && r.focus[1].role === 'zhi' && !r.focus[1].primary)
  check('…and both 卦辭 say 利建侯, as 司空季子 read them', text.get('屯').judgment.includes('利建侯') && text.get('豫').judgment.includes('利建侯'))
}
{
  // 穆姜 …遇艮之八 … 是謂艮之隨，蓋五爻皆變，唯二得八 … 法宜以係小子失丈夫為占.
  const v = castFrom('艮', [1, 3, 4, 5, 6])
  const r = readingRule(v)
  check('五爻變 艮之隨 (穆姜): read 隨 六二', castOf(v).zhi.name === '隨' && r.focus.length === 1 && r.focus[0].role === 'zhi' && r.focus[0].position === 2)
  check('…and 隨 六二 is 「係小子，失丈夫」', text.get('隨').yao[1].text === '係小子，失丈夫。')
}
{
  // 蔡墨曰：乾之坤曰見羣龍无首吉.
  const r = readingRule([9, 9, 9, 9, 9, 9])
  check('六爻變 乾之坤 reads 用九', castOf([9, 9, 9, 9, 9, 9]).zhi.name === '坤' && r.focus[0].kind === 'use' && r.focus[0].name === '用九')
  check('…and 用九 is 「見羣龍无首，吉」', text.get('乾').use.text === '見羣龍无首，吉。')
}

// ── 前十卦 / 後十卦 endpoints (玉齋胡氏, same volume) ─────────────────────────
function threeChanges(name: string): Array<{ zhi: string; front: boolean }> {
  const out: Array<{ zhi: string; front: boolean }> = []
  for (let a = 1; a <= 6; a++) for (let b = a + 1; b <= 6; b++) for (let c = b + 1; c <= 6; c++) {
    const v = castFrom(name, [a, b, c])
    out.push({ zhi: castOf(v).zhi.name, front: readingRule(v).front === true })
  }
  return out
}
{
  const q = threeChanges('乾')
  check('乾: 自否至恒為前十卦，自益至泰為後十卦',
    q[0].zhi === '否' && q[9].zhi === '恒' && q[10].zhi === '益' && q[19].zhi === '泰'
    && q.every((x, i) => x.front === (i < 10)))
  // 坤 is read from the other end of the same chart: 自泰至益為前十卦，自恒至否為後十卦.
  const k = threeChanges('坤')
  check('坤: 自泰至益為前十卦，自恒至否為後十卦',
    k[0].zhi === '泰' && k[9].zhi === '益' && k[10].zhi === '恒' && k[19].zhi === '否'
    && k.every((x, i) => x.front === (i < 10)))
}

// ── Codex's independent cases (independent-goldens.json, verbatim) ──────────
type Golden = { label: string; lines: LineValue[]; base: number; changed: number; focus: Array<{ hex: number; kind: string; position?: number; primary?: boolean; name?: string }> }
const GOLDENS: Golden[] = [
  { label: 'No changes: Qian', lines: [7, 7, 7, 7, 7, 7], base: 1, changed: 1, focus: [{ hex: 1, kind: 'judgment' }] },
  { label: 'One change: Qian to Tongren, Cai Mo example', lines: [7, 9, 7, 7, 7, 7], base: 1, changed: 13, focus: [{ hex: 1, kind: 'line', position: 2 }] },
  { label: 'Two changes: Qian to Daguo, upper changing line primary', lines: [9, 7, 7, 7, 7, 9], base: 1, changed: 28, focus: [{ hex: 1, kind: 'line', position: 1 }, { hex: 1, kind: 'line', position: 6, primary: true }] },
  { label: 'Three changes: Qian to Pi', lines: [9, 9, 9, 7, 7, 7], base: 1, changed: 12, focus: [{ hex: 1, kind: 'judgment', primary: true }, { hex: 12, kind: 'judgment' }] },
  { label: 'Three changes: Qian to Tai', lines: [7, 7, 7, 9, 9, 9], base: 1, changed: 11, focus: [{ hex: 1, kind: 'judgment' }, { hex: 11, kind: 'judgment', primary: true }] },
  { label: 'Four changes: read unchanged positions in transformed Kan', lines: [9, 7, 9, 9, 7, 9], base: 1, changed: 29, focus: [{ hex: 29, kind: 'line', position: 2, primary: true }, { hex: 29, kind: 'line', position: 5 }] },
  { label: 'Five changes: Gen to Sui, Mu Jiang example', lines: [6, 8, 9, 6, 6, 9], base: 52, changed: 17, focus: [{ hex: 17, kind: 'line', position: 2 }] },
  { label: 'Six changes from Qian uses 用九', lines: [9, 9, 9, 9, 9, 9], base: 1, changed: 2, focus: [{ hex: 1, kind: 'use', name: '用九' }] },
  { label: 'Six changes from Kun uses 用六', lines: [6, 6, 6, 6, 6, 6], base: 2, changed: 1, focus: [{ hex: 2, kind: 'use', name: '用六' }] },
  { label: 'Six changes from Jiji reads Weiji judgment', lines: [9, 6, 9, 6, 9, 6], base: 63, changed: 64, focus: [{ hex: 64, kind: 'judgment' }] },
]
const norm = (f: Focus | Golden['focus'][number]) => JSON.stringify({ hex: f.hex, kind: f.kind, position: f.position ?? null, primary: f.primary === true, name: f.name ?? null })
for (const g of GOLDENS) {
  const c = castOf(g.lines), r = readingRule(g.lines)
  check(`Codex: ${g.label}`, c.ben.n === g.base && c.zhi.n === g.changed
    && r.focus.length === g.focus.length && r.focus.every((f, i) => norm(f) === norm(g.focus[i])),
  r.focus.map(norm).join(' '))
}

// Every cast resolves: 4096 line patterns × the rule never throws and always
// names at least one text that exists in the corpus.
{
  let ok = true
  for (let m = 0; m < 4096; m++) {
    const v = Array.from({ length: 6 }, (_, i) => [6, 7, 8, 9][(m >> (2 * i)) & 3] as LineValue)
    const r = readingRule(v)
    for (const f of r.focus) {
      const h = corpus.hexagrams[f.hex - 1]
      if (f.kind === 'judgment' && !h.judgment) ok = false
      if (f.kind === 'line' && !h.yao[(f.position ?? 0) - 1]?.text) ok = false
      if (f.kind === 'use' && !h.use?.text) ok = false
    }
    if (r.focus.length === 0 || r.focus.filter(f => f.primary).length > 1) ok = false
  }
  check('all 4096 casts resolve to texts that exist', ok)
}
check('hexagramOfLines round-trips', HEXAGRAMS.every(h => hexagramOfLines(h.lines).n === h.n))

// Grounding must follow the learner's language and conversational topic.
check('an unspecified mode opens teacher questions without assigning a hexagram',
  asYixueMode(undefined) === 'ask' && yixueChart({}).mode === 'ask' && !('ben' in yixueChart({})))
check('unknown modes cannot silently enter another workflow', yixueInputError({ mode: 'invented' }) !== null)
const situation = yixueFacts({ mode: 'ask', lines: [9, 9, 9, 9, 9, 9] }, '我工作三年，該轉職嗎？')
check('personal context and stray line values do not assign a hexagram in teacher mode',
  situation.includes('沒有起卦') && situation.includes('思考框架') && !situation.includes('第1卦 乾') && !situation.includes('本次應讀'))
for (const question of ['What does hexagram 4 mean?', 'Explain HEXAGRAM No. 4', '第四卦', '第４卦', '4番目の卦', '제4괘', '4번째 괘']) {
  check(`named reference: ${question}`, namedHexagrams(question).join(',') === '4')
}
check('two numeric references stay in question order', namedHexagrams('Compare hexagram 64 with hexagram 4.').join(',') === '64,4')
check('two Chinese references are both grounded', namedHexagrams('第六十四卦和第四卦').join(',') === '64,4')
check('Traditional and simplified names', namedHexagrams('無妄卦和随卦').join(',') === '25,17')
check('ordinary and out-of-range numbers are not hexagrams', ['I am 64', 'hexagram 164', '164番の卦', '제164괘', '第六十五卦'].every(q => namedHexagrams(q).length === 0))
const recent = [
  { role: 'user', content: '請講解乾卦' },
  { role: 'assistant', content: '談談坤卦。' },
  { role: 'user', content: '第四卦的意思呢？' },
]
const followup = yixueFacts({ mode: 'ask' }, '那它的六二呢？', recent)
check('follow-up restores canonical text of the nearest user-named hexagram', followup.includes('第4卦 蒙') && followup.includes('包蒙吉，納婦吉，子克家') && !followup.includes('第1卦 乾'))
const changedTopic = yixueFacts({ mode: 'ask' }, '現在看未濟卦。', recent)
check('explicit new topic replaces the old hexagram', changedTopic.includes('第64卦 未濟') && !changedTopic.includes('第4卦 蒙'))
check('assistant text cannot introduce a grounding target', !yixueFacts({ mode: 'ask' }, '再解釋一下', [{ role: 'assistant', content: '乾卦' }]).includes('第1卦 乾'))

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`)
process.exit(fails === 0 ? 0 : 1)
