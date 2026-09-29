// lib/names.ts — 姓名亭 and 測字亭: the deterministic layer.
//
// 姓名學 (五格剖象法): every number here is arithmetic on 康熙筆畫, and the
// stroke table is built from Unicode's own Unihan data
// (scripts/build-kangxi-strokes.ts), so a doubted count is checkable against
// the 康熙字典 rather than against "the site". The 81 數理 table is the
// 熊崎式 convention every Taiwanese 姓名學 book prints; it is a CONVENTION and
// the master is told to call it one.
//
// 測字: code supplies what is factual about a character — its 康熙 radical,
// stroke count, the radical's 五行 — and the classic 《測字秘牒》 rides along
// through lib/classics. The 拆字 itself is the master's art; the prompt makes
// it spell the decomposition out so the visitor can judge it.
//
// Server-only (reads content/names/*.json).

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

type StrokeTable = Record<string, [number, number]>          // char → [strokes, radical number]
type RadicalTable = Record<string, [string, number]>         // radical number → [char, strokes]

let strokeTable: StrokeTable | null = null
let radicalTable: RadicalTable | null = null
function tables() {
  if (!strokeTable) {
    strokeTable = JSON.parse(readFileSync(join(process.cwd(), 'content', 'names', 'kangxi.json'), 'utf-8'))
    radicalTable = JSON.parse(readFileSync(join(process.cwd(), 'content', 'names', 'radicals.json'), 'utf-8'))
  }
  return { strokes: strokeTable!, radicals: radicalTable! }
}

export type CharInfo = { ch: string; strokes: number; radical: string; radicalNo: number; radicalStrokes: number; kana?: true }

// ── かな (Sep 29, a reviewer: many Japanese given names are kana) ──────────
// Kana counts differ by school; this is the table of the modern stroke
// order most Japanese naming sites print (e.g. 吉元式's 「正しいひらがな表・
// カタカナ表」: な 4, そ 1, ほ 4; the older order gives な 5, ほ 5). A
// voiced mark 「゛」 adds 2, 「゜」 adds 1; small kana count as full size;
// the long mark ー is 1. The master and the page both say it is a convention.
const KANA_STROKES: Record<string, number> = Object.fromEntries([
  ...'あ3い2う2え2お3か3き4く1け3こ2さ3し1す2せ3そ1た4ち2つ1て1と2な4に3ぬ2ね2の1は3ひ1ふ4へ1ほ4ま3み2む3め2も3や3ゆ2よ2ら2り2る1れ2ろ1わ2を3ん1'.match(/\D\d/g)!,
  ...'ア2イ2ウ3エ3オ3カ2キ3ク2ケ3コ2サ3シ3ス2セ2ソ2タ3チ3ツ3テ3ト2ナ2ニ2ヌ2ネ4ノ1ハ2ヒ2フ1ヘ1ホ4マ2ミ3ム2メ2モ3ヤ2ユ2ヨ3ラ2リ2ル2レ1ロ3ワ2ヲ3ン2ー1'.match(/\D\d/g)!,
].map(p => [p[0], Number(p[1])]))
const SMALL: Record<string, string> = { ぁ: 'あ', ぃ: 'い', ぅ: 'う', ぇ: 'え', ぉ: 'お', っ: 'つ', ゃ: 'や', ゅ: 'ゆ', ょ: 'よ', ゎ: 'わ', ァ: 'ア', ィ: 'イ', ゥ: 'ウ', ェ: 'エ', ォ: 'オ', ッ: 'ツ', ャ: 'ヤ', ュ: 'ユ', ョ: 'ヨ', ヮ: 'ワ' }
/** A kana's strokes by that table, or null for anything else. */
export function kanaInfo(ch: string): CharInfo | null {
  const [base, mark] = [...ch.normalize('NFD')]
  const plain = SMALL[base] ?? base
  const n = KANA_STROKES[plain]
  if (n == null) return null
  const extra = mark === '\u3099' ? 2 : mark === '\u309A' ? 1 : 0
  return { ch, strokes: n + extra, radical: '', radicalNo: 0, radicalStrokes: 0, kana: true }
}

export function charInfo(ch: string): CharInfo | null {
  const { strokes, radicals } = tables()
  const e = strokes[ch]
  if (!e) return null
  const r = radicals[String(e[1])]
  return { ch, strokes: e[0], radicalNo: e[1], radical: r?.[0] ?? '?', radicalStrokes: r?.[1] ?? 0 }
}

// ── 五行 ──────────────────────────────────────────────────────────────────

export const WUXING_OF_DIGIT = ['水', '木', '木', '火', '火', '土', '土', '金', '金', '水'] // by last digit 0..9
export const wuxingOfNumber = (n: number) => WUXING_OF_DIGIT[n % 10]
const SHENG: Record<string, string> = { 木: '火', 火: '土', 土: '金', 金: '水', 水: '木' }
const KE: Record<string, string> = { 木: '土', 土: '水', 水: '火', 火: '金', 金: '木' }
/** Relation of a to b, read as "a → b". */
export function relation(a: string, b: string): '相生' | '被生' | '相剋' | '被剋' | '比和' {
  if (a === b) return '比和'
  if (SHENG[a] === b) return '相生'
  if (SHENG[b] === a) return '被生'
  if (KE[a] === b) return '相剋'
  return '被剋'
}

// 五行 by radical, for 測字: the common radicals only, each a stated
// decision (石 is 土, 斤 is 金, 心 is 火 as 南方; anything not listed is
// left unassigned rather than guessed).
const RADICAL_WUXING: Record<number, string> = {
  167: '金', 18: '金', 69: '金',                                   // 金 刀 斤
  75: '木', 140: '木', 118: '木', 115: '木',                        // 木 艸 竹 禾
  85: '水', 15: '水', 173: '水', 195: '水', 47: '水', 84: '水',     // 水 冫 雨 魚 巛 气
  86: '火', 72: '火', 61: '火',                                     // 火 日 心
  32: '土', 46: '土', 102: '土', 96: '土', 170: '土', 112: '土',    // 土 山 田 玉 阜 石
}
export const radicalWuxing = (no: number): string | null => RADICAL_WUXING[no] ?? null

// ── 81 數理 (熊崎式) ────────────────────────────────────────────────────────
// [name, luck]. luck: 吉 / 凶 / 半吉. Numbers above 81 wrap by subtracting 80.

const SHULI: Array<[string, '吉' | '凶' | '半吉']> = [
  ['太極之數', '吉'], ['兩儀之數', '凶'], ['三才之數', '吉'], ['四象之數', '凶'], ['五行之數', '吉'],
  ['六爻之數', '吉'], ['七政之數', '吉'], ['八卦之數', '吉'], ['大成之數', '凶'], ['終結之數', '凶'],
  ['旱苗逢雨', '吉'], ['掘井無泉', '凶'], ['春日牡丹', '吉'], ['破兆', '凶'], ['福壽', '吉'],
  ['厚重', '吉'], ['剛強', '吉'], ['鐵鏡重磨', '吉'], ['多難', '凶'], ['屋下藏金', '凶'],
  ['明月中天', '吉'], ['秋草逢霜', '凶'], ['壯麗', '吉'], ['掘藏得金', '吉'], ['榮俊', '吉'],
  ['變怪', '凶'], ['增長', '半吉'], ['闊水浮萍', '凶'], ['智謀', '吉'], ['非運', '半吉'],
  ['春日花開', '吉'], ['寶馬金鞍', '吉'], ['旭日昇天', '吉'], ['破家', '凶'], ['高樓望月', '吉'],
  ['波瀾', '凶'], ['猛虎出林', '吉'], ['磨鐵成針', '半吉'], ['富貴', '吉'], ['退安', '凶'],
  ['有德', '吉'], ['寒蟬在柳', '半吉'], ['散財', '凶'], ['煩悶', '凶'], ['順風', '吉'],
  ['浪裡淘金', '凶'], ['點石成金', '吉'], ['古松立鶴', '吉'], ['轉變', '凶'], ['小舟入海', '凶'],
  ['沉浮', '半吉'], ['達眼', '吉'], ['曲卷難星', '半吉'], ['石上栽花', '凶'], ['善惡', '半吉'],
  ['浪裡行舟', '凶'], ['日照春松', '吉'], ['晚行遇月', '半吉'], ['寒蟬悲風', '凶'], ['無謀', '凶'],
  ['牡丹芙蓉', '吉'], ['衰敗', '凶'], ['舟歸平海', '吉'], ['骨肉分離', '凶'], ['巨流歸海', '吉'],
  ['岩頭步馬', '凶'], ['通達', '吉'], ['順風吹帆', '吉'], ['非業', '凶'], ['殘菊經霜', '凶'],
  ['石上金花', '半吉'], ['勞苦', '半吉'], ['志高力微', '半吉'], ['殘花經霜', '凶'], ['退守', '半吉'],
  ['離散', '凶'], ['家庭有悅', '半吉'], ['晚苦', '半吉'], ['雲頭望月', '凶'], ['遁世', '凶'],
  ['還元', '吉'],
]
export function shuli(n: number): { n: number; name: string; luck: '吉' | '凶' | '半吉' } {
  let k = n
  while (k > 81) k -= 80
  if (k < 1) k = 1
  const [name, luck] = SHULI[k - 1]
  return { n: k, name, luck }
}

// ── 五格 ──────────────────────────────────────────────────────────────────

export type Ge = { key: string; label: string; n: number; wuxing: string; shuli: ReturnType<typeof shuli> }
export type NameChart = {
  surname: CharInfo[]
  given: CharInfo[]
  ge: { tian: Ge; ren: Ge; di: Ge; wai: Ge; zong: Ge }
  sancai: { tian: string; ren: string; di: string; tianRen: string; renDi: string; label: string }
}

/** One to four characters (owner, Sep 28: Japan and Korea; Sep 29: four-kanji
 *  surnames like 勅使河原 and kana given names like さくら): Chinese names,
 *  Japanese kanji or kana, Korean names in 漢字. 々 and ー follow a character,
 *  so neither can come first. Hangul is not read. */
export const NAME_RX = /^[㐀-䶿一-鿿ぁ-ゖァ-ヺ][㐀-䶿一-鿿々ぁ-ゖァ-ヺー]{0,3}$/
export function validName(s: unknown): s is string {
  return typeof s === 'string' && NAME_RX.test(s)
}

/** Each character's info; 々 takes the strokes of the character it repeats
 *  (佐々木 is 佐 佐 木), as 熊崎式 counts it, and keeps its own face. */
function namePart(s: string): Array<CharInfo | null> {
  const out: Array<CharInfo | null> = []
  for (const ch of s) {
    const prev = out[out.length - 1]
    out.push(ch === '々' ? (prev ? { ...prev, ch: '々' } : null) : charInfo(ch) ?? kanaInfo(ch))
  }
  return out
}

export function nameChart(surname: string, given: string): NameChart {
  const sn = namePart(surname), gv = namePart(given)
  const missing = [...sn, ...gv].findIndex(c => !c)
  if (missing >= 0) throw new Error(`no stroke data for ${[...surname, ...given][missing]}`)
  const S = sn.map(c => c!.strokes), G = gv.map(c => c!.strokes)
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  const singleSurname = S.length === 1, singleGiven = G.length === 1
  // 熊崎式 with any length: 天格 the whole surname, 地格 the whole given
  // name (a single character adds 1), 人格 where the two meet.
  const tian = singleSurname ? S[0] + 1 : sum(S)
  const ren = S[S.length - 1] + G[0]
  const di = singleGiven ? G[0] + 1 : sum(G)
  const zong = [...S, ...G].reduce((a, b) => a + b, 0)
  const wai = zong - ren + (singleSurname ? 1 : 0) + (singleGiven ? 1 : 0)
  const mk = (key: string, label: string, n: number): Ge => ({ key, label, n, wuxing: wuxingOfNumber(n), shuli: shuli(n) })
  const ge = { tian: mk('tian', '天格', tian), ren: mk('ren', '人格', ren), di: mk('di', '地格', di), wai: mk('wai', '外格', wai), zong: mk('zong', '總格', zong) }
  const tianRen = relation(ge.tian.wuxing, ge.ren.wuxing), renDi = relation(ge.ren.wuxing, ge.di.wuxing)
  const bad = (r: string) => r === '相剋' || r === '被剋'
  const label = !bad(tianRen) && !bad(renDi) ? '三才相生或比和，配置順' : bad(tianRen) && bad(renDi) ? '三才兩處相剋，配置逆' : '三才一處相剋，配置半順'
  return {
    surname: sn as CharInfo[], given: gv as CharInfo[], ge,
    sancai: { tian: ge.tian.wuxing, ren: ge.ren.wuxing, di: ge.di.wuxing, tianRen, renDi, label },
  }
}

export function nameFacts(c: NameChart, gender: string): string {
  const chars = [...c.surname, ...c.given].map(x => `${x.ch}（${x.strokes}畫，${x.kana ? '假名' : `${x.radical}部`}）`).join(' ')
  const ge = Object.values(c.ge).map(g => `  ${g.label} ${g.n}：${g.wuxing}　${g.shuli.n}數「${g.shuli.name}」${g.shuli.luck}${g.n !== g.shuli.n ? `（${g.n} 減 80 取 ${g.shuli.n}）` : ''}`).join('\n')
  return [
    `姓名：${c.surname.map(x => x.ch).join('')}${c.given.map(x => x.ch).join('')}${gender ? `（${gender === 'male' ? '男' : '女'}）` : ''}`,
    `康熙筆畫：${chars}`,
    ...([...c.surname, ...c.given].some(x => x.ch === '々') ? ['「々」依所重複之字計畫。'] : []),
    ...([...c.surname, ...c.given].some(x => x.kana) ? ['日文假名依現行筆順的通行表計畫（濁點加 2、半濁點加 1、小寫同大寫、長音符 1）；假名筆畫各流派算法不一，這是慣例不是定律。'] : []),
    `筆畫依所寫字形計（日本新字體如沢、桜照寫法計，不換回舊字體；三字姓或三字名依熊崎式加總）。`,
    `五格（五格剖象法，筆畫依康熙字典部首原形，數字一至十以數值計）：`,
    ge,
    `三才：天${c.sancai.tian} 人${c.sancai.ren} 地${c.sancai.di}　天→人 ${c.sancai.tianRen}，人→地 ${c.sancai.renDi}　${c.sancai.label}`,
    `說明：81 數理吉凶為熊崎式姓名學的通行慣例，不是定律；人格主本人、地格主前運與基礎、天格主祖蔭（不可改）、外格主人際與外緣、總格主後運。`,
  ].join('\n')
}

// ── 測字 ──────────────────────────────────────────────────────────────────

export function validChar(s: unknown): s is string {
  return typeof s === 'string' && /^[㐀-䶿一-鿿]$/.test(s)
}

export function ceziFacts(info: CharInfo, ask: string): string {
  const wx = radicalWuxing(info.radicalNo)
  return [
    ask ? `所問之事：${ask}` : '所問之事：未說明（請先問清楚再測）。',
    `所書之字：「${info.ch}」`,
    `康熙部首：${info.radical}部（第 ${info.radicalNo} 部，部首 ${info.radicalStrokes} 畫）${wx ? `，部首五行屬${wx}` : ''}`,
    `康熙筆畫：${info.strokes} 畫（含部首原形）`,
    `以上為系統查表所得；字的拆解、加減筆與觸機由老師為之，拆解時請把拆出的部件一一寫明。`,
  ].join('\n')
}
