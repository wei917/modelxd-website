// lib/yijing.ts — 易學堂's server half. Reads content/yijing/zhouyi.json.
//
// Three rooms, one text:
//   cast   — six coin throws → 本卦, 動爻, 之卦, and 朱熹's rule for which
//            passage this cast reads (lib/yijing-core.ts decides it);
//   lookup — any of the 64, read as text;
//   ask    — no hexagram: the visitor is learning, and the teacher answers
//            from the 十翼 passages lib/classics retrieves, plus what the
//            question points at (lib/yijing-retrieval): a hexagram it names,
//            a line it quotes, or one of three indexed topics.
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
import { yixueBookPassages } from './classics'
import {
  unit, phraseIndex, phrasesIn, unfoundQuotes, conceptsIn, conceptPassages,
  type Unit, type PhraseIndex, type PhraseHit, type ConceptId,
} from './yijing-retrieval'

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

export const YIXUE_MODES = ['ask', 'lookup', 'cast'] as const
export type YixueMode = (typeof YIXUE_MODES)[number]
export const asYixueMode = (v: unknown): YixueMode => ((YIXUE_MODES as readonly string[]).includes(v as string) ? (v as YixueMode) : 'ask')

/** The coin faces are optional and only for showing the throws again; when
 *  present they must add up to the lines they claim. */
export function validCoins(coins: unknown, lines: LineValue[]): coins is Coin[][] {
  return Array.isArray(coins) && coins.length === 6 && coins.every((t, i) =>
    Array.isArray(t) && t.length === 3 && t.every(c => c === 2 || c === 3) && t.reduce((s: number, c: number) => s + c, 0) === lines[i])
}

/** Validates the room's input. Returns an error message, or null when fine. */
export function yixueInputError(body: any): string | null {
  if (body?.mode !== undefined && !(YIXUE_MODES as readonly unknown[]).includes(body.mode)) return 'unknown I Ching mode'
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
const ALIASES: Record<string, string[]> = {
  恒: ['恆'], 无妄: ['無妄'], 遯: ['遁'], 訟: ['讼'], 師: ['师'],
  謙: ['谦'], 隨: ['随'], 蠱: ['蛊'], 臨: ['临'], 觀: ['观'],
  賁: ['贲'], 剝: ['剥'], 復: ['复'], 頤: ['颐'],
  大過: ['大过'], 離: ['离'], 大壯: ['大壮'], 晉: ['晋'],
  損: ['损'], 漸: ['渐'], 歸妹: ['归妹'], 豐: ['丰'],
  兌: ['兑'], 渙: ['涣'], 節: ['节'], 小過: ['小过'], 既濟: ['既济'], 未濟: ['未济'],
}

/** Hexagrams a learner's question names: 「蒙卦」, 「水雷屯」, 「第四卦」. At most two.
 *  「解卦」 is left out on purpose: it also means "to interpret a hexagram". */
export function namedHexagrams(question: string): number[] {
  const text = question.normalize('NFKC')
  const mentions: Array<{ n: number; at: number }> = []
  const byLength = [...HEXAGRAMS].sort((a, b) => b.name.length - a.name.length)
  for (const h of byLength) {
    const names = [h.name, ...(ALIASES[h.name] ?? [])]
    const fulls = names.map(nm => h.fullName.replace(h.name, nm))
    const terms = [...names.filter(nm => nm !== '解').map(nm => `${nm}卦`), ...fulls]
    for (const term of terms) {
      const at = text.indexOf(term)
      if (at >= 0) mentions.push({ n: h.n, at })
    }
  }
  // Numeric references in the site's five languages. NFKC also accepts
  // full-width digits. Never treat a bare number (e.g. a year) as a hexagram.
  const patterns = [
    /第\s*([一二三四五六七八九十]+|\d{1,2})\s*卦/g,
    /\bhexagrams?\s*(?:no\.?\s*|number\s*|#\s*)?(\d{1,2})(?!\d)\b/gi,
    /(?<!\d)(\d{1,2})\s*番(?:目)?(?:の)?卦/g,
    /(?<!\d)(?:제\s*)?(\d{1,2})\s*(?:번(?:째)?\s*)?괘/g,
  ]
  for (const pattern of patterns) for (const match of text.matchAll(pattern)) {
    const n = /\d/.test(match[1]) ? Number(match[1]) : cnNumber(match[1])
    if (validNumber(n)) mentions.push({ n, at: match.index })
  }
  return [...new Set(mentions.sort((a, b) => a.at - b.at).map(m => m.n))].slice(0, 2)
}
function cnNumber(s: string): number {
  const d: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  if (s === '十') return 10
  const m = s.match(/^([一二三四五六七八九])?十([一二三四五六七八九])?$/)
  if (m) return (m[1] ? d[m[1]] : 1) * 10 + (m[2] ? d[m[2]] : 0)
  return d[s] ?? 0
}

// ── What a teacher question points at ──────────────────────────────────────

let phrases: PhraseIndex | null = null
/** Every quotable place in the corpus: each hexagram's 卦辭, 彖, 大象, 爻辭,
 *  小象, 用九/六 and 文言 paragraphs, then the 十翼 passages. */
function phraseIdx(): PhraseIndex {
  if (phrases) return phrases
  const units: Unit[] = []
  for (const h of load().hexagrams) {
    const at = { hex: h.n, name: h.name }, of = `${h.name}卦`
    units.push(unit({ ...at, where: `${of} 卦辭`, text: h.judgment, match: h.name + h.judgment }))
    units.push(unit({ ...at, where: `${of} 彖傳`, text: h.tuan }))
    units.push(unit({ ...at, where: `${of} 大象`, text: h.daxiang }))
    for (const y of h.yao) {
      units.push(unit({ ...at, where: `${of} ${y.label}爻辭`, text: y.text, match: y.label + y.text }))
      units.push(unit({ ...at, where: `${of} ${y.label}小象`, text: y.xiaoxiang }))
    }
    if (h.use) {
      units.push(unit({ ...at, where: `${of} ${h.use.label}`, text: h.use.text, match: h.use.label + h.use.text }))
      units.push(unit({ ...at, where: `${of} ${h.use.label}小象`, text: h.use.xiaoxiang }))
    }
    for (const para of (h.wenyan ?? '').split('\n').filter(Boolean)) units.push(unit({ ...at, where: `${of} 文言傳`, text: para }))
  }
  for (const p of yixueBookPassages()) units.push(unit({ where: p.book, text: p.text }))
  return (phrases = phraseIndex(units))
}

type Grounding = { named: number[]; phrases: PhraseHit[]; concepts: ConceptId[]; unfound: string[] }
function groundingOf(text: string): Grounding {
  const idx = phraseIdx()
  return { named: namedHexagrams(text), phrases: phrasesIn(text, idx), concepts: conceptsIn(text), unfound: unfoundQuotes(text, idx) }
}
const grounded = (g: Grounding) => g.named.length + g.phrases.length + g.concepts.length + g.unfound.length > 0

const unitLines = (units: Unit[], cap: number): string[] => [
  ...units.slice(0, cap).map(u => `- ${u.where}：「${u.text}」`),
  ...(units.length > cap ? [`- 另見：${units.slice(cap).map(u => u.where).join('、')}`] : []),
]
/** 乾卦 初九爻辭、乾卦 文言傳（2處） */
function places(units: Unit[]): string {
  const count = new Map<string, number>()
  for (const u of units) count.set(u.where, (count.get(u.where) ?? 0) + 1)
  return [...count].map(([w, k]) => (k > 1 ? `${w}（${k}處）` : w)).join('、')
}
// The visitor's words go in “ ”, so 「 」 stays reserved for corpus text.
const saidOf = (p: PhraseHit) => `“${p.said}”${p.spoken ? '（使用者以讀音寫出）' : ''}`

/** Where each quoted line lives. A line inside ONE hexagram brings that
 *  hexagram's whole text when the question is about the text (so "and the
 *  next line?" can follow); in a question about the visitor's own situation
 *  it brings only the places that contain it. A line found in several
 *  hexagrams is listed everywhere it occurs, never credited to one. */
function phraseSection(hits: PhraseHit[], recent: boolean, whole: boolean): string[] {
  const out = ['以下是使用者引用的句子在經傳中的出處（系統逐字比對，可核對）。出處不是起卦，也不代表此人得到任何一卦。']
  const shown = new Set<number>()
  for (const p of hits) {
    const inHex = p.units.filter(u => u.hex), inBooks = p.units.filter(u => !u.hex)
    const hexes = [...new Set(inHex.map(u => u.hex!))]
    if (hexes.length === 1) {
      out.push(`使用者引用的${saidOf(p)}，在本站收錄的《周易》經傳中，卦內只見於${inHex[0].name}卦：${places(inHex)}${inBooks.length ? `；傳中另見於${places(inBooks)}` : ''}。`)
      if (whole && shown.size < 2 && !shown.has(hexes[0])) {
        shown.add(hexes[0])
        out.push(textBlock(hexText(hexes[0]), recent ? '最近對話引用的句子所在的卦' : '問題引用的句子所在的卦', true))
      } else if (!shown.has(hexes[0])) out.push(...unitLines(inHex, 8))
      out.push(...unitLines(inBooks, 3))
    } else if (hexes.length > 1) {
      out.push(`使用者引用的${saidOf(p)}見於${hexes.length}個卦、共${p.units.length}處，不是某一卦獨有；除非使用者指定，不可說成出自某一卦：`)
      out.push(...unitLines(p.units, 8))
    } else {
      out.push(`使用者引用的${saidOf(p)}見於：`)
      out.push(...unitLines(inBooks, 3))
    }
  }
  return out
}

/** With a named hexagram, a quoted line only gets a note: where ELSE it
 *  occurs, or that it is not in the named hexagram at all. */
function besideNamed(named: number[], hits: PhraseHit[]): string[] {
  const out: string[] = []
  for (const p of hits) {
    const inside = p.units.filter(u => u.hex && named.includes(u.hex))
    const outside = p.units.filter(u => !(u.hex && named.includes(u.hex)))
    if (outside.length === 0) continue
    if (inside.length) out.push(`所引${saidOf(p)}不只見於所點名的卦，另見於：${places(outside)}。不可說成某一卦獨有。`)
    else out.push(`所引${saidOf(p)}不在所點名的卦中，而見於：`, ...unitLines(outside, 6))
  }
  return out
}

function conceptSection(ids: ConceptId[]): string[] {
  const units = phraseIdx().units
  return ids.flatMap(id => {
    const c = conceptPassages(id, units)
    if (c.lines.length === 0) return []
    return [
      `話題：${c.topic}。以下是常被引用的經傳段落，系統依關鍵詞從固定清單取出，出處可核對。只作閱讀材料與類比，不是起卦，也不代表此人的卦、爻或命運；切題才用，引用照錄並標出處。`,
      ...c.lines.map(l => `- ${l.where}：「${l.quote}」`),
    ]
  })
}

// Every mode: 「」 after a labelled source is corpus text; nothing else is.
const ORIGIN = `原文來源：${TEXT_SOURCE.title}（${TEXT_SOURCE.license}）。凡標明出處（卦名與部位，或篇名）之後的「」內文字都是原文，照錄，不可改字；使用者的話以“”標示，不是原文。`

export function yixueFacts(body: any, question = '', history: ReadonlyArray<{ role: string; content: string }> = []): string {
  const mode = asYixueMode(body?.mode)
  const origin = ORIGIN

  if (mode === 'ask') {
    // The question's own grounding wins: a named hexagram, a quoted line, an
    // indexed topic, or a quotation the corpus lacks. Only a turn with none
    // of these (「那它的六二呢？」「具體一點」) reuses the nearest user turn
    // that had one, and the scan stops there: a recent career question is
    // never skipped to revive an older hexagram. Assistant turns are never
    // read, since their quotations may be wrong.
    const now = groundingOf(question)
    let g = now, recent = false
    if (!grounded(now)) {
      for (const turn of history.slice(-20).reverse()) {
        if (turn.role !== 'user') continue
        const past = groundingOf(turn.content.slice(0, 8000))
        if (grounded(past)) { g = past; recent = true; break }
      }
    }
    const concepts = g.named.length ? [] : g.concepts
    const hasText = g.named.length > 0 || g.phrases.length > 0
    return [
      '來訪者正在問老師：可能是《易經》知識問題，也可能希望借經典觀點釐清具體處境。沒有起卦，也沒有為此人配定任何卦。個人背景只以使用者訊息與對話中明確提供的資料為準，不可編造；資料不足時，先給不依賴未知事實的思考框架，再問一到三個會影響分析的具體問題。',
      ...(now.named.length ? [] : ['問題沒有點名任何一卦。不可根據年資、年齡或其他背景替使用者指定本卦、動爻、之卦；引用卦例只能作為有出處的閱讀材料，不是此人的占卜結果。']),
      ...(hasText || concepts.length ? [origin] : []),
      ...(recent ? ['系統沒有在本題辨認出卦名、原句或已知話題；以下沿用最近一則有材料的使用者訊息，供追問參照，並非起卦結果。若使用者其實已換了話題，忽略這些沿用的材料。'] : []),
      ...(g.named.length ? [
        ...g.named.map(n => textBlock(hexText(n), recent ? '最近對話提到的卦' : '問題提到的卦', true)),
        ...besideNamed(g.named, g.phrases),
      ] : g.phrases.length ? phraseSection(g.phrases, recent, g.concepts.length === 0) : []),
      ...g.unfound.map(q => `使用者用引號標出的“${q}”，在本站收錄的《周易》經傳中找不到逐字相同的句子；若它是後世成語或轉述，要照實說明，不可當成經文原句。`),
      ...conceptSection(concepts),
      ...(!hasText && !concepts.length ? ['系統沒有找到與這個問題對應的經文片語或固定段落。可以講一般觀念，但不可假裝有出處；需要原文時，請使用者點名一卦或引用原句。'] : []),
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
  // Coin faces arrive only from the room's own throw. A cast made elsewhere
  // supplies six values and nothing about how they were obtained.
  const thrown = validCoins(body?.coins, values)
  return [
    `所問之事：“${String(body.ask).trim().slice(0, 300)}”`,
    thrown
      ? '起卦方式：三枚硬幣擲六次，一面記三、一面記二，三枚相加；由下往上排：'
      : '起卦方式：來訪者自行起卦後輸入的六個爻值（不是本站擲出；本站不知道所用的是硬幣、蓍草或其他方法）；由下往上排：',
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
    thrown
      ? '注意：這是三枚硬幣起卦，讀卦辭與爻辭；沒有排六爻納甲（世應、六親、納甲干支、六神），不可自行補上。'
      : '注意：六個爻值由來訪者提供，本站只依上面的讀法選讀卦辭與爻辭；沒有排六爻納甲（世應、六親、納甲干支、六神），不可自行補上。',
  ].join('\n')
}
