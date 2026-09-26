// lib/yijing.ts — 易學堂's server half. Reads content/yijing/zhouyi.json.
//
// Three rooms, one text:
//   cast   — six coin throws → 本卦, 動爻, 之卦, and 朱熹's rule for which
//            passage this cast reads (lib/yijing-core.ts decides it);
//   lookup — any of the 64, read as text;
//   ask    — no hexagram: the visitor is learning, and the teacher answers
//            from the 十翼 passages lib/classics retrieves, plus the text of
//            any hexagram the question names.
//
// The board payload and the facts carry the text VERBATIM from the corpus
// (with its recorded corrections) and label it as original text; everything
// the teacher adds is interpretation and the prompt makes it say so.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  castOf, readingRule, hexagram, lineLabel, LINE_KIND, validLines, validNumber, bitOf, isMoving,
  RULE_SOURCE, HEXAGRAMS, type LineValue, type Coin, type ReadingRule, type HexagramInfo,
} from './yijing-core'

type Yao = { label: string; text: string; xiaoxiang: string }
type Correction = { where: string; part: string; from: string; to: string; witness: string; reason: string }
type HexText = HexagramInfo & {
  label: string; judgment: string; tuan: string; daxiang: string
  yao: Yao[]; use?: Yao; wenyan?: string; page: string; revid: number
}

let corpus: { source: { corrections: Correction[] }; hexagrams: Array<Omit<HexText, 'fullName'>> } | null = null
function load() {
  if (!corpus) corpus = JSON.parse(readFileSync(join(process.cwd(), 'content', 'yijing', 'zhouyi.json'), 'utf-8'))
  return corpus!
}

export const TEXT_SOURCE = {
  title: '維基文庫《周易》',
  url: 'https://zh.wikisource.org/wiki/%E5%91%A8%E6%98%93',
  license: '公有領域',
}
export const pageUrl = (page: string) => `https://zh.wikisource.org/wiki/${page.split('/').map(encodeURIComponent).join('/')}`

export function hexText(n: number): HexText {
  const h = load().hexagrams[n - 1]
  if (!h || h.n !== n) throw new Error(`no text for hexagram ${n}`)
  return { ...h, fullName: hexagram(n).fullName }
}

// ── Inputs ─────────────────────────────────────────────────────────────────

export const YIXUE_MODES = ['cast', 'lookup', 'ask'] as const
export type YixueMode = (typeof YIXUE_MODES)[number]
export const asYixueMode = (v: unknown): YixueMode => ((YIXUE_MODES as readonly string[]).includes(v as string) ? (v as YixueMode) : 'cast')

/** The coin faces are optional and only for showing the throws again; when
 *  present they must add up to the lines they claim. */
export function validCoins(coins: unknown, lines: LineValue[]): coins is Coin[][] {
  return Array.isArray(coins) && coins.length === 6 && coins.every((t, i) =>
    Array.isArray(t) && t.length === 3 && t.every(c => c === 2 || c === 3) && t.reduce((s: number, c: number) => s + c, 0) === lines[i])
}

/** Validates the room's input. Returns an error message, or null when fine. */
export function yixueInputError(body: any): string | null {
  const mode = asYixueMode(body?.mode)
  if (mode === 'cast') {
    if (!validLines(body?.lines)) return 'six line values (6–9) are required'
    if (body?.coins !== undefined && !validCoins(body.coins, body.lines)) return 'coins do not match the lines'
    if (typeof body?.ask !== 'string' || !body.ask.trim()) return 'write the one matter you are asking about'
  }
  if (mode === 'lookup' && !validNumber(body?.n)) return 'pick one of the 64 hexagrams'
  return null
}

// ── The board ──────────────────────────────────────────────────────────────

export type HexBoard = HexText & { url: string; corrections: Array<Pick<Correction, 'part' | 'from' | 'to' | 'witness'>> }

function board(n: number): HexBoard {
  const h = hexText(n)
  const corrections = load().source.corrections
    .filter(c => c.where === h.name)
    .map(({ part, from, to, witness }) => ({ part, from, to, witness }))
  return { ...h, url: pageUrl(h.page), corrections }
}

export type YixueChart =
  | { mode: 'cast'; ask: string; values: LineValue[]; coins?: Coin[][]; moving: number[]; ben: HexBoard; zhi: HexBoard | null; rule: ReadingRule & { source: typeof RULE_SOURCE }; text: typeof TEXT_SOURCE }
  | { mode: 'lookup'; hex: HexBoard; text: typeof TEXT_SOURCE }
  | { mode: 'ask'; text: typeof TEXT_SOURCE }

export function yixueChart(body: any): YixueChart {
  const mode = asYixueMode(body?.mode)
  if (mode === 'lookup') return { mode, hex: board(body.n), text: TEXT_SOURCE }
  if (mode === 'ask') return { mode, text: TEXT_SOURCE }
  const values = body.lines as LineValue[]
  const c = castOf(values)
  return {
    mode, ask: String(body.ask).trim().slice(0, 300), values,
    ...(validCoins(body?.coins, values) ? { coins: body.coins } : {}),
    moving: c.moving,
    ben: board(c.ben.n),
    zhi: c.moving.length ? board(c.zhi.n) : null,
    rule: { ...readingRule(values), source: RULE_SOURCE },
    text: TEXT_SOURCE,
  }
}

// ── The facts the teacher reads ────────────────────────────────────────────

const POS = ['初', '二', '三', '四', '五', '上']

/** One hexagram's text, every part labelled with where it comes from. */
function textBlock(h: HexText, heading: string, withWenyan: boolean): string {
  const lines = [
    `【${heading}】第${h.n}卦 ${h.name}（${h.fullName}），下卦${h.lower}、上卦${h.upper}`,
    `卦辭：「${h.judgment}」`,
    `彖傳：「${h.tuan}」`,
    `大象：「${h.daxiang}」`,
    ...h.yao.map(y => `${y.label}（爻辭）：「${y.text}」　小象：「${y.xiaoxiang}」`),
    ...(h.use ? [`${h.use.label}：「${h.use.text}」　小象：「${h.use.xiaoxiang}」`] : []),
  ]
  if (withWenyan && h.wenyan) lines.push(`文言傳：「${h.wenyan.replace(/\n/g, ' ')}」`)
  return lines.join('\n')
}

function focusLine(rule: ReadingRule, ben: HexText, zhi: HexText): string {
  return rule.focus.map(f => {
    const h = f.role === 'ben' ? ben : zhi
    const where = f.role === 'ben' ? '本卦' : '之卦'
    const what = f.kind === 'judgment' ? `${h.name}的卦辭`
      : f.kind === 'use' ? `${h.name}的${f.name}`
      : `${h.name}的${h.yao[f.position! - 1].label}爻辭`
    return `${where}${what}${f.primary ? '（主）' : ''}`
  }).join('、')
}

// 朱熹 on 貞 and 悔, from the same volume (性理大全書 卷十七, 玉齋胡氏引朱子).
const ZHEN_HUI = '朱子云：「貞是事之始，悔是事之終；貞是事之主，悔是事之客；貞是事在我底，悔是應人底。」'

// The corpus keeps Wikisource's forms (恒, 无妄, 遯); people in Taiwan type
// 恆, 無妄 and 遁. Aliases for recognising a name only; the text is untouched.
const ALIASES: Record<string, string[]> = { 恒: ['恆'], 无妄: ['無妄'], 遯: ['遁'] }

/** Hexagrams a learner's question names: 「蒙卦」, 「水雷屯」, 「第四卦」. At most two.
 *  「解卦」 is left out on purpose: it also means "to interpret a hexagram". */
export function namedHexagrams(question: string): number[] {
  const found: number[] = []
  const byLength = [...HEXAGRAMS].sort((a, b) => b.name.length - a.name.length)
  for (const h of byLength) {
    if (found.length >= 2) break
    const names = [h.name, ...(ALIASES[h.name] ?? [])]
    const fulls = names.map(nm => h.fullName.replace(h.name, nm))
    const named = names.some(nm => nm !== '解' && question.includes(`${nm}卦`)) || fulls.some(f => question.includes(f))
    if (named && !found.includes(h.n)) found.push(h.n)
  }
  const cn = question.match(/第([一二三四五六七八九十]+|\d{1,2})卦/)
  if (cn && found.length < 2) {
    const n = /\d/.test(cn[1]) ? Number(cn[1]) : cnNumber(cn[1])
    if (validNumber(n) && !found.includes(n)) found.push(n)
  }
  return found
}
function cnNumber(s: string): number {
  const d: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  if (s === '十') return 10
  const m = s.match(/^([一二三四五六七八九])?十([一二三四五六七八九])?$/)
  if (m) return (m[1] ? d[m[1]] : 1) * 10 + (m[2] ? d[m[2]] : 0)
  return d[s] ?? 0
}

export function yixueFacts(body: any, question = ''): string {
  const mode = asYixueMode(body?.mode)
  const origin = `原文來源：${TEXT_SOURCE.title}（${TEXT_SOURCE.license}）。以下「」內一律是原文，照錄，不可改字。`

  if (mode === 'ask') {
    const named = namedHexagrams(question)
    return [
      '來訪者沒有起卦，只是來學《易經》。',
      ...(named.length ? [origin, ...named.map(n => textBlock(hexText(n), '問題提到的卦', true))] : ['問題沒有點名任何一卦。']),
    ].join('\n')
  }

  if (mode === 'lookup') {
    const h = hexText(body.n)
    return ['來訪者在查閱這一卦（沒有起卦）。', origin, textBlock(h, '查閱的卦', true)].join('\n')
  }

  const values = body.lines as LineValue[]
  const c = castOf(values)
  const rule = readingRule(values)
  const ben = hexText(c.ben.n), zhi = hexText(c.zhi.n)
  const throws = values.map((v, i) =>
    `  ${POS[i]}爻：${v}，${LINE_KIND[v]}（${bitOf(v) ? '陽' : '陰'}爻${isMoving(v) ? '，會變' : ''}）`)
  const movingLabels = c.moving.map(p => lineLabel(p, bitOf(values[p - 1])))
  return [
    `所問之事：「${String(body.ask).trim().slice(0, 300)}」`,
    '起卦方式：三枚硬幣擲六次，一面記三、一面記二，三枚相加；由下往上排：',
    ...throws,
    `本卦：第${ben.n}卦 ${ben.name}（${ben.fullName}）`,
    `動爻：${movingLabels.length ? movingLabels.join('、') : '無（六爻皆不變）'}`,
    `之卦：${c.moving.length ? `第${zhi.n}卦 ${zhi.name}（${zhi.fullName}）` : '無（不變）'}`,
    `讀法（${RULE_SOURCE.title}，${RULE_SOURCE.edition}）：「${rule.text}」`,
    `本次應讀：${focusLine(rule, ben, zhi)}。`,
    ...(rule.inferred ? ['朱熹於此條自註：「經傳無文，今以例推之，當如此。」（沒有古例，是他的推論）'] : []),
    ...(rule.count === 3 ? [`此次三爻變${rule.front ? '含' : '不含'}初爻，屬${rule.front ? '前十卦，以本卦（貞）為主' : '後十卦，以之卦（悔）為主'}。前十、後十依《易學啟蒙》卦變圖的排列：原文為乾、坤二卦明列起訖，其餘各卦依同一排列推得。`, ZHEN_HUI] : []),
    ...(rule.count === 0 ? ['六爻皆不變：以內卦（下卦）為貞，外卦（上卦）為悔。', ZHEN_HUI] : []),
    origin,
    textBlock(ben, '本卦', ben.n <= 2),
    ...(c.moving.length ? [textBlock(zhi, '之卦', zhi.n <= 2)] : []),
    '注意：這是三枚硬幣起卦，讀卦辭與爻辭；沒有排六爻納甲（世應、六親、納甲干支、六神），不可自行補上。',
  ].join('\n')
}
