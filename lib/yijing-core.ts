// lib/yijing-core.ts — the 易學堂 engine that needs no text. Client-safe.
//
// Trigrams, the 64 hexagrams in King Wen order, the three-coin cast, 本卦 →
// 之卦, and 朱熹's rule for WHICH text a cast reads. The texts themselves live
// in content/yijing/zhouyi.json and are served by lib/yijing.ts; nothing here
// touches the file system, so the room can draw a hexagram line by line while
// the coins fall.
//
// What this is NOT: 六爻納甲 (京房/火珠林 — 世應, 六親, 納甲干支, 六神 read
// against the day and month). The three-coin throw is only a way to get six
// lines; reading them by 納甲 is a different system and is not computed here.
//
// Line order is bottom → top everywhere: index 0 is 初爻, index 5 is 上爻.

export type Bit = 0 | 1
export type LineValue = 6 | 7 | 8 | 9            // 老陰 少陽 少陰 老陽
export type Coin = 2 | 3                           // one face counts 2, the other 3
export type TrigramName = '乾' | '兌' | '離' | '震' | '巽' | '坎' | '艮' | '坤'

export const TRIGRAMS: Record<TrigramName, { lines: [Bit, Bit, Bit]; image: string; virtue: string }> = {
  // lines bottom → top. image = 說卦 象; virtue = 說卦 「乾，健也 …」.
  乾: { lines: [1, 1, 1], image: '天', virtue: '健' },
  兌: { lines: [1, 1, 0], image: '澤', virtue: '說' },
  離: { lines: [1, 0, 1], image: '火', virtue: '麗' },
  震: { lines: [1, 0, 0], image: '雷', virtue: '動' },
  巽: { lines: [0, 1, 1], image: '風', virtue: '入' },
  坎: { lines: [0, 1, 0], image: '水', virtue: '陷' },
  艮: { lines: [0, 0, 1], image: '山', virtue: '止' },
  坤: { lines: [0, 0, 0], image: '地', virtue: '順' },
}

// King Wen order: [name, lower, upper]. The corpus build checks every entry
// against the text's own 「X下Y上」 line and its 爻 labels (scripts/fetch-zhouyi.ts),
// and scripts/test-yijing.ts checks this table against the corpus.
const KING_WEN: Array<[string, TrigramName, TrigramName]> = [
  ['乾', '乾', '乾'], ['坤', '坤', '坤'], ['屯', '震', '坎'], ['蒙', '坎', '艮'],
  ['需', '乾', '坎'], ['訟', '坎', '乾'], ['師', '坎', '坤'], ['比', '坤', '坎'],
  ['小畜', '乾', '巽'], ['履', '兌', '乾'], ['泰', '乾', '坤'], ['否', '坤', '乾'],
  ['同人', '離', '乾'], ['大有', '乾', '離'], ['謙', '艮', '坤'], ['豫', '坤', '震'],
  ['隨', '震', '兌'], ['蠱', '巽', '艮'], ['臨', '兌', '坤'], ['觀', '坤', '巽'],
  ['噬嗑', '震', '離'], ['賁', '離', '艮'], ['剝', '坤', '艮'], ['復', '震', '坤'],
  ['无妄', '震', '乾'], ['大畜', '乾', '艮'], ['頤', '震', '艮'], ['大過', '巽', '兌'],
  ['坎', '坎', '坎'], ['離', '離', '離'], ['咸', '艮', '兌'], ['恒', '巽', '震'],
  ['遯', '艮', '乾'], ['大壯', '乾', '震'], ['晉', '坤', '離'], ['明夷', '離', '坤'],
  ['家人', '離', '巽'], ['睽', '兌', '離'], ['蹇', '艮', '坎'], ['解', '坎', '震'],
  ['損', '兌', '艮'], ['益', '震', '巽'], ['夬', '乾', '兌'], ['姤', '巽', '乾'],
  ['萃', '坤', '兌'], ['升', '巽', '坤'], ['困', '坎', '兌'], ['井', '巽', '坎'],
  ['革', '離', '兌'], ['鼎', '巽', '離'], ['震', '震', '震'], ['艮', '艮', '艮'],
  ['漸', '艮', '巽'], ['歸妹', '兌', '震'], ['豐', '離', '震'], ['旅', '艮', '離'],
  ['巽', '巽', '巽'], ['兌', '兌', '兌'], ['渙', '坎', '巽'], ['節', '兌', '坎'],
  ['中孚', '兌', '巽'], ['小過', '艮', '震'], ['既濟', '離', '坎'], ['未濟', '坎', '離'],
]

export type HexagramInfo = {
  n: number
  name: string
  lower: TrigramName
  upper: TrigramName
  lines: Bit[]           // bottom → top
  fullName: string       // 乾為天, 水雷屯 …
}

/** 上卦的象 + 下卦的象 + 卦名; a doubled trigram reads 「乾為天」. */
function fullNameOf(name: string, lower: TrigramName, upper: TrigramName): string {
  return lower === upper ? `${name}為${TRIGRAMS[upper].image}` : `${TRIGRAMS[upper].image}${TRIGRAMS[lower].image}${name}`
}

export const HEXAGRAMS: HexagramInfo[] = KING_WEN.map(([name, lower, upper], i) => ({
  n: i + 1, name, lower, upper,
  lines: [...TRIGRAMS[lower].lines, ...TRIGRAMS[upper].lines],
  fullName: fullNameOf(name, lower, upper),
}))

const BY_BITS = new Map(HEXAGRAMS.map(h => [h.lines.join(''), h]))

export function hexagram(n: number): HexagramInfo {
  const h = HEXAGRAMS[n - 1]
  if (!h) throw new Error(`no hexagram ${n}`)
  return h
}

export function hexagramOfLines(lines: Bit[]): HexagramInfo {
  const h = BY_BITS.get(lines.join(''))
  if (!h) throw new Error(`not six lines: ${lines.join('')}`)
  return h
}

export const validNumber = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 64

// ── The cast ────────────────────────────────────────────────────────────────

export const LINE_KIND: Record<LineValue, string> = { 6: '老陰', 7: '少陽', 8: '少陰', 9: '老陽' }
export const isMoving = (v: LineValue) => v === 6 || v === 9
export const bitOf = (v: LineValue): Bit => (v === 7 || v === 9 ? 1 : 0)
/** The line after the change: 老陽 becomes yin, 老陰 becomes yang, the young stay. */
export const changedBitOf = (v: LineValue): Bit => (v === 9 ? 0 : v === 6 ? 1 : bitOf(v))

export function validLines(v: unknown): v is LineValue[] {
  return Array.isArray(v) && v.length === 6 && v.every(x => x === 6 || x === 7 || x === 8 || x === 9)
}

/** Three coins, each face 2 or 3; the sum is the line (6 老陰, 7 少陽, 8 少陰, 9 老陽).
 *  Which face counts 3 is a convention that varies by teacher; the room says so. */
export function throwCoins(rand: () => number): [Coin, Coin, Coin] {
  const c = (): Coin => (rand() < 0.5 ? 2 : 3)
  return [c(), c(), c()]
}
export const valueOf = (coins: Coin[]): LineValue => coins.reduce<number>((s, c) => s + c, 0) as LineValue

const POSITIONS = ['初', '二', '三', '四', '五', '上']
/** 初九, 六二 … 上六 — the name a line has in the text (九 yang, 六 yin). */
export function lineLabel(position: number, bit: Bit): string {
  const p = POSITIONS[position - 1]
  const num = bit ? '九' : '六'
  return position === 1 || position === 6 ? `${p}${num}` : `${num}${p}`
}

export type Cast = {
  values: LineValue[]
  ben: HexagramInfo
  zhi: HexagramInfo        // the same as ben when no line moves
  moving: number[]         // positions 1–6
}

export function castOf(values: LineValue[]): Cast {
  if (!validLines(values)) throw new Error('six line values of 6, 7, 8 or 9 are required')
  return {
    values,
    ben: hexagramOfLines(values.map(bitOf)),
    zhi: hexagramOfLines(values.map(changedBitOf)),
    moving: values.flatMap((v, i) => (isMoving(v) ? [i + 1] : [])),
  }
}

// ── Which text to read: 朱熹《易學啟蒙·考變占第四》 ─────────────────────────
//
// Primary source: 《性理大全書》卷十七 (四庫全書本), which prints 考變占 with
// its commentary, https://zh.wikisource.org/wiki/性理大全書_(四庫全書本)/卷17.
// 朱熹 calls the 卦辭 「彖辭」 (「彖辭為卦下之辭」), so 「占本卦彖辭」 means the
// 卦辭, not the 彖傳 commentary.
//
// Three changing lines: both 卦辭 are read, 本卦 as 貞 and 之卦 as 悔, and
// 「前十卦主貞，後十卦主悔」. The ten and ten are positions in 朱熹's 卦變圖,
// where each hexagram's twenty three-line changes run in position order
// (初二三, 初二四 … 四五上). The commentary in the same volume (玉齋胡氏)
// names the endpoints for 乾 — 「自否至恒為前十卦，自益至泰為後十卦」 — and
// for 坤 read backwards, 「自泰至益為前十卦，自恒至否為後十卦」. In that order
// the first ten are exactly the changes that include 初爻. For 乾 and 坤 this
// is the source's own statement; for the other 62 it is derived from the
// same chart construction (every chart is built the same way), not quoted.
// scripts/test-yijing.ts checks both endpoint lists.

export const RULE_SOURCE = {
  title: '朱熹《易學啟蒙·考變占第四》',
  edition: '《性理大全書》卷十七（四庫全書本）',
  url: 'https://zh.wikisource.org/wiki/%E6%80%A7%E7%90%86%E5%A4%A7%E5%85%A8%E6%9B%B8_(%E5%9B%9B%E5%BA%AB%E5%85%A8%E6%9B%B8%E6%9C%AC)/%E5%8D%B717',
}

// The rule sentences as the source prints them; punctuation added.
export const RULE_TEXT: Record<number, string> = {
  0: '凡卦六爻皆不變，則占本卦彖辭，而以內卦為貞，外卦為悔。',
  1: '一爻變，則以本卦變爻辭占。',
  2: '二爻變，則以本卦二變爻辭占，仍以上爻為主。',
  3: '三爻變，則占本卦及之卦之彖辭，而以本卦為貞，之卦為悔。前十卦主貞，後十卦主悔。',
  4: '四爻變，則以之卦二不變爻占，仍以下爻為主。',
  5: '五爻變，則以之卦不變爻占。',
  6: '六爻變，則乾坤占二用，餘卦占之卦彖辭。',
}
// 二爻 and 四爻 carry 朱熹's own caveat, 「經傳無文，今以例推之，當如此」:
// no classical case exists and the rule is his inference.
export const RULE_INFERRED = new Set([2, 4])

export type Focus = {
  hex: number
  role: 'ben' | 'zhi'
  kind: 'judgment' | 'line' | 'use'
  position?: number        // for 'line'
  name?: string            // for 'use': 用九 / 用六
  primary?: boolean        // set only when two texts are read and one leads
}

export type ReadingRule = {
  count: number            // how many lines move
  moving: number[]
  focus: Focus[]
  text: string             // the source sentence for this case
  inferred: boolean        // 朱熹: 經傳無文，今以例推之
  /** Three moving lines only: whether this cast is in the 前十卦 (本卦 leads). */
  front?: boolean
}

export function readingRule(values: LineValue[]): ReadingRule {
  const { ben, zhi, moving } = castOf(values)
  const still = [1, 2, 3, 4, 5, 6].filter(p => !moving.includes(p))
  const count = moving.length
  const line = (role: 'ben' | 'zhi', position: number, primary?: boolean): Focus =>
    ({ hex: role === 'ben' ? ben.n : zhi.n, role, kind: 'line', position, ...(primary ? { primary: true } : {}) })
  const judgment = (role: 'ben' | 'zhi', primary?: boolean): Focus =>
    ({ hex: role === 'ben' ? ben.n : zhi.n, role, kind: 'judgment', ...(primary ? { primary: true } : {}) })

  let focus: Focus[]
  let front: boolean | undefined
  switch (count) {
    case 0: focus = [judgment('ben')]; break
    case 1: focus = [line('ben', moving[0])]; break
    case 2: focus = [line('ben', moving[0]), line('ben', moving[1], true)]; break          // 以上爻為主
    case 3:
      front = moving.includes(1)                                                         // 前十卦 ⇔ 初爻 moves
      focus = [judgment('ben', front), judgment('zhi', !front)]
      break
    case 4: focus = [line('zhi', still[0], true), line('zhi', still[1])]; break           // 以下爻為主
    case 5: focus = [line('zhi', still[0])]; break
    default:
      focus = ben.n === 1 ? [{ hex: 1, role: 'ben', kind: 'use', name: '用九' }]
        : ben.n === 2 ? [{ hex: 2, role: 'ben', kind: 'use', name: '用六' }]
        : [judgment('zhi')]
  }
  return { count, moving, focus, text: RULE_TEXT[count], inferred: RULE_INFERRED.has(count), ...(front === undefined ? {} : { front }) }
}
