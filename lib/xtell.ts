// lib/xtell.ts — XTell (X算命): the deterministic layer.
//
// The split that makes this feature honest: everything with a right answer
// (the chart) is computed HERE by libraries, displayed to the user, and fed
// to the model as fixed facts. The model only interprets. It is instructed
// to cite no pillar, star or palace that is not in the payload — a model
// that recalls calendars from memory is usually right, and "usually" is the
// one thing a 排盤 must never be.
//
//   八字廟     lunar-typescript  (節氣-correct pillars, 藏干, 十神, 大運)
//   紫微斗數廟  iztro             (12 palaces, stars, 四化, 五行局)
//
// Server-only: both libraries are pure computation, but the prompts and the
// master personas live here too, and those must not be client-editable.

import { Solar, LunarUtil } from 'lunar-typescript'
import { jyotishChart, jyotishFacts, type JyotishChart } from './jyotish'
import { placeOf } from './xtell-places'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { astro } from 'iztro'

export type Temple = 'bazi' | 'ziwei' | 'yuelao' | 'guandi' | 'simianfo' | 'navagraha'
export const TEMPLES: Temple[] = ['bazi', 'ziwei', 'yuelao', 'guandi', 'simianfo', 'navagraha']
export function asTemple(v: unknown): Temple { return (TEMPLES as string[]).includes(v as string) ? (v as Temple) : 'bazi' }

// Provenance (idea learned from horosa-skill's technique cards): every chart
// names the engine that computed it, so a doubted 排盤 is checkable against
// the exact library version rather than against "the site".
export const ENGINES: Record<Temple, string> = {
  bazi:   'lunar-typescript v1.8.6',
  yuelao: 'lunar-typescript v1.8.6',
  ziwei:  'iztro v2.6.0',
  // 關帝廟 has no chart: the deterministic layer is the ritual (lib/xtell-ritual.ts)
  // and the poem text, a public-domain 清刊本 from Wikisource.
  guandi:   '關聖帝君靈籤（維基文庫・清刊本）+ 擲筊三聖',
  // 四面佛 reads the visitor's own 八字 against the wishes: same engine as 八字廟.
  simianfo: 'lunar-typescript v1.8.6',
  // 九曜廟: our own engine on astronomy-engine, checked against Swiss
  // Ephemeris (Lahiri) in the golden suite.
  navagraha: 'lib/jyotish.ts on astronomy-engine v2.1 · Lahiri · mean node · whole sign',
}

export interface BirthInput {
  y: number; m: number; d: number; h: number; mi: number
  gender: 'male' | 'female'
}

export function validBirth(b: any): b is BirthInput {
  if (b && b.hourUnknown === true) { b.h = 12; b.mi = 0 }
  return b && Number.isInteger(b.y) && b.y >= 1900 && b.y <= 2100
    && Number.isInteger(b.m) && b.m >= 1 && b.m <= 12
    && Number.isInteger(b.d) && b.d >= 1 && b.d <= 31
    && Number.isInteger(b.h) && b.h >= 0 && b.h <= 23
    && Number.isInteger(b.mi) && b.mi >= 0 && b.mi <= 59
    && (b.gender === 'male' || b.gender === 'female')
}

// ── 八字 ────────────────────────────────────────────────────────────────────

// lunar-typescript spells the 十神 in simplified script (伤官, 正财, 七杀) and
// the whole page is 繁體, so the three that differ are mapped here — at the
// chart, once, so the board and the facts agree.
const SHI_SHEN_TC: Record<string, string> = { 伤官: '傷官', 正财: '正財', 偏财: '偏財', 劫财: '劫財', 七杀: '七殺' }
const tcShiShen = (s: string) => SHI_SHEN_TC[s] ?? s

export function baziChart(b: BirthInput) {
  const solar = Solar.fromYmdHms(b.y, b.m, b.d, b.h, b.mi, 0)
  const lunar = solar.getLunar()
  const e = lunar.getEightChar()

  // 大運 — first six decades. getYun takes 1 for male, 0 for female.
  let daYun: Array<{ startAge: number; ganZhi: string }> = []
  try {
    daYun = e.getYun(b.gender === 'male' ? 1 : 0).getDaYun().slice(1, 7)
      .map(y => ({ startAge: y.getStartAge(), ganZhi: y.getGanZhi() }))
  } catch { /* 大運 is a bonus, never a blocker */ }

  return {
    solar: solar.toYmdHms(),
    lunar: lunar.toString(),
    pillars: {
      year:  { ganZhi: e.getYear(),  naYin: e.getYearNaYin(),  shiShen: tcShiShen(e.getYearShiShenGan()),  hideGan: e.getYearHideGan() },
      month: { ganZhi: e.getMonth(), naYin: e.getMonthNaYin(), shiShen: tcShiShen(e.getMonthShiShenGan()), hideGan: e.getMonthHideGan() },
      day:   { ganZhi: e.getDay(),   naYin: e.getDayNaYin(),   shiShen: '日主',                 hideGan: e.getDayHideGan() },
      time:  { ganZhi: e.getTime(),  naYin: e.getTimeNaYin(),  shiShen: tcShiShen(e.getTimeShiShenGan()),  hideGan: e.getTimeHideGan() },
    },
    dayMaster: e.getDayGan(),
    wuXing: [e.getYearWuXing(), e.getMonthWuXing(), e.getDayWuXing(), e.getTimeWuXing()],
    daYun,
  }
}

export type BaziChart = ReturnType<typeof baziChart>

export function baziFacts(c: BaziChart, gender: string, hourUnknown = false): string {
  if (hourUnknown) {
    const p = c.pillars
    return [
      `出生（國曆）：${c.solar}；農曆：${c.lunar}`,
      `性別：${gender === 'male' ? '男' : '女'}`,
      `時辰未知：僅排年月日三柱，時柱不論。`,
      `三柱：年 ${p.year.ganZhi}、月 ${p.month.ganZhi}、日 ${p.day.ganZhi}　日主：${c.dayMaster}`,
      `五行（干支）：${c.wuXing.slice(0, 3).join('，')}`,
      c.daYun.length ? `大運（起歲為約略值，因時辰未知）：${c.daYun.map(d => `${d.startAge}歲起 ${d.ganZhi}`).join('；')}` : '',
      `解讀時明確告知信眾：時辰未知會影響精細度，時柱所主之事（晚年、子女、內心底色）不宜細斷。`,
    ].filter(Boolean).join('\n')
  }
  const p = c.pillars
  return [
    `出生（國曆）：${c.solar}，${gender === 'male' ? '男' : '女'}`,
    `農曆：${c.lunar}`,
    `四柱：年柱 ${p.year.ganZhi}（${p.year.naYin}，${p.year.shiShen}）· 月柱 ${p.month.ganZhi}（${p.month.naYin}，${p.month.shiShen}）· 日柱 ${p.day.ganZhi}（${p.day.naYin}）· 時柱 ${p.time.ganZhi}（${p.time.naYin}，${p.time.shiShen}）`,
    `日主：${c.dayMaster}`,
    `藏干：年 ${p.year.hideGan.join('、')}；月 ${p.month.hideGan.join('、')}；日 ${p.day.hideGan.join('、')}；時 ${p.time.hideGan.join('、')}`,
    `五行（干支）：${c.wuXing.join('，')}`,
    c.daYun.length ? `大運：${c.daYun.map(d => `${d.startAge}歲起 ${d.ganZhi}`).join('；')}` : '',
  ].filter(Boolean).join('\n')
}

// ── 紫微斗數 ────────────────────────────────────────────────────────────────

/** 時辰 index for iztro: 0 早子時(00:xx) … 11 亥時, 12 晚子時(23:xx). */
export function timeIndexOf(h: number): number {
  return h === 23 ? 12 : Math.floor((h + 1) / 2)
}

export function ziweiChart(b: BirthInput) {
  const a = astro.bySolar(`${b.y}-${b.m}-${b.d}`, timeIndexOf(b.h), b.gender === 'male' ? 'male' : 'female', true, 'zh-TW')
  return {
    solar: `${b.y}-${b.m}-${b.d} ${String(b.h).padStart(2, '0')}:${String(b.mi).padStart(2, '0')}`,
    lunar: a.lunarDate,
    time: a.time,
    fiveElementsClass: a.fiveElementsClass,
    soul: a.soul,   // 命主
    body: a.body,   // 身主
    palaces: a.palaces.map(p => ({
      name: p.name,
      ganZhi: `${p.heavenlyStem}${p.earthlyBranch}`,
      isBodyPalace: p.isBodyPalace,
      majorStars: p.majorStars.map(s => s.name + (s.mutagen ? `（化${s.mutagen}）` : '') + (s.brightness ? `[${s.brightness}]` : '')),
      minorStars: p.minorStars.map(s => s.name),
      adjectiveStars: p.adjectiveStars.map(s => s.name),
    })),
  }
}

export type ZiweiChart = ReturnType<typeof ziweiChart>

export function ziweiFacts(c: ZiweiChart, gender: string): string {
  const lines = c.palaces.map(p =>
    `${p.name}（${p.ganZhi}${p.isBodyPalace ? '，身宮' : ''}）：主星 ${p.majorStars.join('、') || '無主星'}${p.minorStars.length ? `；輔星 ${p.minorStars.join('、')}` : ''}`)
  return [
    `出生（國曆）：${c.solar}，${gender === 'male' ? '男' : '女'}`,
    `農曆：${c.lunar} ${c.time}`,
    `五行局：${c.fiveElementsClass}　命主：${c.soul}　身主：${c.body}`,
    `十二宮：`,
    ...lines,
  ].join('\n')
}

// ── 月老廟：合婚 ────────────────────────────────────────────────────────────
//
// Two people, two 八字 charts, one question: how do they fit. The engine is
// the same solar-term-exact BaZi computation run twice; the labels 第一位/
// 第二位 are deliberate — 合婚 tradition says 男方/女方, but two people are
// whoever they are.

// ── 合盤：the computed score ────────────────────────────────────────────────
//
// The scores are CODE, like the charts. A model asked to "rate this couple"
// invents a different number every run, which is exactly the kind of confident
// noise this page exists to avoid — so the arithmetic lives here, every
// dimension names the two 干支 it read and the relation it found, and the
// master is handed the same numbers the visitor is looking at.
//
// The relations are the standard ones (六合/三合/六沖/相害/相刑, 天干五合,
// 五行生剋). The WEIGHTS are a judgement call and are stated openly rather
// than hidden: 日支 is the 夫妻宮 and carries the most weight in 合婚, the two
// 日主 are the people themselves, 生肖 is what everyone already checks.

const LIU_HE: Record<string, string> = { 子: '丑', 丑: '子', 寅: '亥', 亥: '寅', 卯: '戌', 戌: '卯', 辰: '酉', 酉: '辰', 巳: '申', 申: '巳', 午: '未', 未: '午' }
const LIU_CHONG: Record<string, string> = { 子: '午', 午: '子', 丑: '未', 未: '丑', 寅: '申', 申: '寅', 卯: '酉', 酉: '卯', 辰: '戌', 戌: '辰', 巳: '亥', 亥: '巳' }
const LIU_HAI: Record<string, string> = { 子: '未', 未: '子', 丑: '午', 午: '丑', 寅: '巳', 巳: '寅', 卯: '辰', 辰: '卯', 申: '亥', 亥: '申', 酉: '戌', 戌: '酉' }
const SAN_HE: string[][] = [['申', '子', '辰'], ['亥', '卯', '未'], ['寅', '午', '戌'], ['巳', '酉', '丑']]
const XIANG_XING: string[][] = [['寅', '巳', '申'], ['丑', '戌', '未'], ['子', '卯']]
const TIAN_GAN_HE: Record<string, string> = { 甲: '己', 己: '甲', 乙: '庚', 庚: '乙', 丙: '辛', 辛: '丙', 丁: '壬', 壬: '丁', 戊: '癸', 癸: '戊' }
const GAN_WU_XING: Record<string, string> = { 甲: '木', 乙: '木', 丙: '火', 丁: '火', 戊: '土', 己: '土', 庚: '金', 辛: '金', 壬: '水', 癸: '水' }
const ZHI_SHENG_XIAO: Record<string, string> = { 子: '鼠', 丑: '牛', 寅: '虎', 卯: '兔', 辰: '龍', 巳: '蛇', 午: '馬', 未: '羊', 申: '猴', 酉: '雞', 戌: '狗', 亥: '豬' }
/** 木生火生土生金生水生木 */
const SHENG_NEXT: Record<string, string> = { 木: '火', 火: '土', 土: '金', 金: '水', 水: '木' }
/** 木剋土剋水剋火剋金剋木 */
const KE_NEXT: Record<string, string> = { 木: '土', 土: '水', 水: '火', 火: '金', 金: '木' }

export type BranchRelation = { kind: '六合' | '三合' | '六沖' | '相害' | '相刑' | '無特殊關係'; score: number }

/** The relation between two 地支, and what 合婚 tradition makes of it. */
export function branchRelation(x: string, y: string): BranchRelation {
  if (LIU_HE[x] === y) return { kind: '六合', score: 100 }
  if (SAN_HE.some(g => g.includes(x) && g.includes(y) && x !== y)) return { kind: '三合', score: 88 }
  if (LIU_CHONG[x] === y) return { kind: '六沖', score: 32 }
  if (LIU_HAI[x] === y) return { kind: '相害', score: 46 }
  if (XIANG_XING.some(g => g.includes(x) && g.includes(y) && x !== y)) return { kind: '相刑', score: 42 }
  return { kind: '無特殊關係', score: 62 }
}

/** The relation between two 天干, read through their 五行. */
export function stemRelation(x: string, y: string): { kind: string; score: number } {
  if (TIAN_GAN_HE[x] === y) return { kind: '天干五合', score: 100 }
  const ex = GAN_WU_XING[x], ey = GAN_WU_XING[y]
  if (!ex || !ey) return { kind: '無法判讀', score: 60 }
  if (ex === ey) return { kind: `同為${ex}`, score: 72 }
  if (SHENG_NEXT[ex] === ey) return { kind: `${ex}生${ey}`, score: 86 }
  if (SHENG_NEXT[ey] === ex) return { kind: `${ey}生${ex}`, score: 86 }
  if (KE_NEXT[ex] === ey) return { kind: `${ex}剋${ey}`, score: 48 }
  if (KE_NEXT[ey] === ex) return { kind: `${ey}剋${ex}`, score: 48 }
  return { kind: '無特殊關係', score: 62 }
}

export type HeDimension = { key: string; label: string; weight: number; score: number; detail: string }
export type HeYear = { year: number; ganZhi: string; who: 'a' | 'b' | 'both'; kind: string; good: boolean; note: string }
export type HeMatch = {
  overall: number
  band: 'high' | 'good' | 'mixed' | 'work'
  dimensions: HeDimension[]
  years: HeYear[]
}

const elementsOf = (c: BaziChart) => new Set(c.wuXing.join('').split('').filter(Boolean))

/**
 * The full 合盤. `hourUnknown` drops the 時柱 from the element spread only —
 * every weighted dimension reads 年/月/日, which the three known pillars cover.
 */
export function heMatch(a: BaziChart, b: BaziChart, fromYear: number): HeMatch {
  const ad = a.pillars.day.ganZhi, bd = b.pillars.day.ganZhi
  const ay = a.pillars.year.ganZhi, by = b.pillars.year.ganZhi
  const am = a.pillars.month.ganZhi, bm = b.pillars.month.ganZhi

  const dayBranch = branchRelation(ad[1], bd[1])
  const dayStem = stemRelation(a.dayMaster, b.dayMaster)
  const yearBranch = branchRelation(ay[1], by[1])
  const monthBranch = branchRelation(am[1], bm[1])

  // 五行互補: how much of the five is covered once both charts are laid
  // together. Five out of five means whatever one lacks, the other carries.
  const both = new Set([...elementsOf(a), ...elementsOf(b)])
  const spread = 40 + Math.min(5, both.size) * 12

  const dimensions: HeDimension[] = [
    { key: 'dayBranch', label: '日支・夫妻宮', weight: 30, score: dayBranch.score,
      detail: `${ad[1]} × ${bd[1]}　${dayBranch.kind}` },
    { key: 'dayStem', label: '日主・兩人本性', weight: 25, score: dayStem.score,
      detail: `${a.dayMaster} × ${b.dayMaster}　${dayStem.kind}` },
    { key: 'yearBranch', label: '生肖・年支', weight: 20, score: yearBranch.score,
      detail: `${ZHI_SHENG_XIAO[ay[1]] ?? ay[1]} × ${ZHI_SHENG_XIAO[by[1]] ?? by[1]}　${yearBranch.kind}` },
    { key: 'monthBranch', label: '月支・家庭性情', weight: 15, score: monthBranch.score,
      detail: `${am[1]} × ${bm[1]}　${monthBranch.kind}` },
    { key: 'spread', label: '五行互補', weight: 10, score: spread,
      detail: `兩盤合看涵蓋 ${[...both].join('、')}（${both.size}/5）` },
  ]

  const overall = Math.round(dimensions.reduce((sum, d) => sum + d.score * d.weight, 0) / 100)
  const band: HeMatch['band'] = overall >= 82 ? 'high' : overall >= 70 ? 'good' : overall >= 58 ? 'mixed' : 'work'

  // ── The years ahead ───────────────────────────────────────────────────────
  // 流年地支 against each person's 日支 (夫妻宮). Only years that actually carry
  // a relation are listed; a blank year is not a prediction and is left out.
  // June 1 is used to read the year's 干支 because the 干支 year turns at 立春,
  // not at January 1 — a January date would return the previous year's pillar.
  const years: HeYear[] = []
  for (let y = fromYear; y < fromYear + 8; y++) {
    const gz = Solar.fromYmd(y, 6, 1).getLunar().getYearInGanZhi()
    const zhi = gz[1]
    const ra = branchRelation(zhi, ad[1]), rb = branchRelation(zhi, bd[1])
    const hit = (r: BranchRelation) => r.kind !== '無特殊關係'
    if (!hit(ra) && !hit(rb)) continue
    const who: HeYear['who'] = hit(ra) && hit(rb) ? 'both' : hit(ra) ? 'a' : 'b'
    const kinds = [hit(ra) ? ra.kind : null, hit(rb) ? rb.kind : null].filter(Boolean)
    const good = (hit(ra) ? ra.score : 100) >= 80 && (hit(rb) ? rb.score : 100) >= 80
    years.push({
      year: y, ganZhi: gz, who, kind: [...new Set(kinds)].join('／'),
      good,
      note: good ? '感情容易加溫，適合把話說開、把事定下來' : '容易起波動，宜多溝通、少賭氣',
    })
  }

  return { overall, band, dimensions, years }
}

export function yuelaoFacts(a: BaziChart, aGender: string, b: BaziChart, bGender: string, match?: HeMatch): string {
  const one = (c: BaziChart, g: string, label: string) => {
    const p = c.pillars
    return [
      `${label}（${g === 'male' ? '男' : '女'}）：`,
      `  出生（國曆）：${c.solar}；農曆：${c.lunar}`,
      `  四柱：${p.year.ganZhi} ${p.month.ganZhi} ${p.day.ganZhi} ${p.time.ganZhi}　日主：${c.dayMaster}`,
      `  五行（干支）：${c.wuXing.join('，')}`,
      c.daYun.length ? `  大運：${c.daYun.map(d => `${d.startAge}歲起 ${d.ganZhi}`).join('；')}` : '',
    ].filter(Boolean).join('\n')
  }
  const base = `${one(a, aGender, '第一位')}\n\n${one(b, bGender, '第二位')}`
  if (!match) return base
  // The visitor is looking at these exact numbers on screen. A master who
  // talks past them reads as broken, so they go in as facts, not suggestions.
  const dims = match.dimensions.map(d => `  ${d.label}（權重 ${d.weight}）：${d.score} 分　${d.detail}`).join('\n')
  const years = match.years.length
    ? match.years.map(y => `  ${y.year} ${y.ganZhi}：${y.kind}（${y.who === 'both' ? '兩人皆應' : y.who === 'a' ? '應第一位' : '應第二位'}）`).join('\n')
    : '  未來八年內，流年地支與雙方日支無明顯合沖。'
  return `${base}\n\n系統已排好的合盤分數（信眾此刻正看著這張表，請以此為準，不要另給一組數字）：\n  總分：${match.overall}\n${dims}\n\n流年（未來八年，只列有合沖者）：\n${years}`
}

// ── 九曜廟：吠陀星盤 ────────────────────────────────────────────────────────
//
// The birth needs a place. `placeOf` resolves a curated city key to
// coordinates and an IANA zone (lib/xtell-places.ts); the chart itself is
// lib/jyotish.ts. Re-exported here so the routes have one import.

export function navagrahaChart(b: BirthInput, placeKey: unknown): JyotishChart {
  const p = placeOf(placeKey)
  if (!p) throw new Error('unknown place')
  return jyotishChart({ y: b.y, m: b.m, d: b.d, h: b.h, mi: b.mi, lat: p.lat, lon: p.lon, tz: p.tz, place: p.label })
}
export const navagrahaFacts = jyotishFacts
export const validPlace = (k: unknown) => placeOf(k) !== null

// ── The masters ─────────────────────────────────────────────────────────────
//
// One persona per temple, server-held. The guardrails are the contract:
// interpret only what the chart says, entertainment framing, no directives
// on health/money/legal, and no fabricated chart facts — the chart above the
// reading is exactly what the user can verify elsewhere.

// Shared language discipline (learned from Wolke/ziwei-doushu's ETHICS.md):
// tendencies, never verdicts.
const TONE = '措辭一律用「傾向、容易、偏向、宜留意」這類語氣，不下定論、不說「一定、注定、必然」。'

export const MASTERS: Record<Temple, string> = {
  yuelao: `你是「月老廟」的駐廟老師，一位慈祥風趣、閱人無數的月老。兩位有緣人的八字命盤已由系統排好，附在訊息中。

規則：
- 這裡專看感情與姻緣：合婚。只根據提供的兩份命盤解讀——日主相性、五行互補與沖剋、年支生肖的合沖、日支（夫妻宮）的呼應、大運走向的同步。絕對不要自行推算或修改任何干支。
- 若信眾有具體提問（如「我們適合結婚嗎」「今年適合訂婚嗎」），圍繞提問；沒有提問就做完整合婚解讀：先講兩人個性與相處樣貌，再講互補與摩擦點，最後給相處建議。
- 語氣像月老：溫暖、帶點幽默、成人之美。緣分沒有絕對的好壞——就算命盤多有沖剋，也要點出可以經營之處，絕不宣判一段感情「注定失敗」。
- 不催婚、不勸分，不對第三者、單方面查探等情況提供協助；涉及家暴等安全議題時，嚴肅建議尋求專業與正式資源。
- 使用繁體中文（除非信眾用其他語言提問）。結尾提醒：姻緣天注定，經營在人為；命理僅供參考與娛樂。\n${TONE}`,
  bazi: `你是「八字廟」的駐廟老師，一位溫和而博學的命理師。使用者的八字命盤已由系統排好，附在訊息中。

規則：
- 只根據提供的命盤內容解讀（四柱、日主、藏干、五行、大運）。絕對不要自行推算或修改任何干支——排盤是系統算好的，你的工作只有解讀。
- 若使用者有提問，圍繞提問解讀；若沒有，依序談：日主與格局、性格、事業與財、感情與家庭、健康注意、近年大運。
- 語氣溫暖誠懇，像面對面看命，不裝神弄鬼。使用繁體中文（除非使用者用其他語言提問）。
- 涉及健康、投資、法律時，只能談傾向與提醒，明確建議諮詢專業人士，不給具體指示。
- 結尾提醒：命理僅供參考與娛樂，人生的選擇永遠在自己手上。\n${TONE}`,
  ziwei: `你是「紫微斗數廟」的駐廟老師，一位細膩而有條理的紫微斗數命理師。使用者的星盤已由系統排好，附在訊息中。

規則：
- 只根據提供的星盤內容解讀（十二宮、主星與四化、五行局、命主身主）。絕對不要自行安星或修改宮位——排盤是系統算好的，你的工作只有解讀。
- 若使用者有提問，先看相關宮位（如問感情看夫妻宮，問事業看官祿宮），並參照命宮與三方四正。若沒有提問，依序談：命宮格局、事業、財帛、感情、遷移與人際。
- 語氣沉穩清楚，逐宮說明時先講星，再講意義。使用繁體中文（除非使用者用其他語言提問）。
- 涉及健康、投資、法律時，只能談傾向與提醒，明確建議諮詢專業人士，不給具體指示。
- 結尾提醒：命理僅供參考與娛樂，人生的選擇永遠在自己手上。\n${TONE}`,
  guandi: `你是「關帝廟」的解籤老師，一位正直、簡練、熟讀三國與史書的解籤人。信眾已在關聖帝君前擲筊求得一支籤，籤號、吉凶、籤詩與這一版清刊本的註解（聖意、東坡解、碧仙註、解曰、釋義、占驗，或本籤所附的分項解）都由系統附在訊息中。

規則：
- 只解這一支籤。籤詩與註解一字不改、不引用其他籤、不自創典故；引用註解時註明是「聖意」「東坡解」還是「解曰」。註解裡沒有的，不要說成籤上有。
- 先把四句籤詩用白話講一遍，再對應信眾所問之事（問功名看功名、問婚姻看婚姻、問出行看出行）；若系統註明信眾未說明所問之事，先問清楚再解，不要先解一大篇。
- 語氣像關帝廟裡的老先生：直、有分寸、不討好。下籤照實說，但把「宜留意、宜守、宜緩」講清楚，不嚇人；上籤也提醒盡人事，不許諾結果。
- 求籤講究誠心，一事一籤；同一件事不重抽。信眾若要再問別的事，請他回到廟前重新求籤。
- 涉及健康、投資、法律、訴訟，只談籤意的提醒，明確建議諮詢專業人士，不給具體指示。
- 使用繁體中文（除非信眾用其他語言提問）。結尾提醒：籤詩僅供參考與娛樂，關聖帝君教人的是忠義與盡人事。\n${TONE}`,
  simianfo: `你是曼谷四面佛前的守願人，一位溫和、務實、在佛前服務多年的泰國廟祝。信眾已依順時鐘四面（第一面平安、第二面事業、第三面婚姻、第四面財富）寫下願望與還願方式，系統把這四段願文、信眾的八字命盤和今年流年一起附在訊息中。

規則：
- 四面佛不是算命，是許願與還願。你的工作有三件：幫信眾把願望說得具體（時間、對象、可驗證的結果）；對照命盤與今年流年，說四面之中哪一面的願與今年走勢相順、哪一面需要多用心、多耐心；提醒還願要量力、要說到做到。
- 談命盤只根據附上的四柱、大運與流年，絕不自行推算或修改干支；命盤只用來對照四面，不做完整批命——信眾若想批命，請他去八字廟。
- 還願方式由信眾自己定，你只提醒合理與可行（供花、供香、捐款、義工都可以，不必花大錢）；不推薦任何商家、舞團或代拜服務。
- 不替人求害人之願、不受理針對第三者的願望；涉及安全或健康急迫之事，嚴肅建議尋求正式資源。
- 語氣安靜、尊重，帶一點泰式的從容；稱「四面佛」或「大梵天王」，不與佛教的佛混談。
- 使用繁體中文（除非信眾用其他語言提問）。結尾提醒：許願在人，成願靠行；命理僅供參考與娛樂。\n${TONE}`,
  navagraha: `你是「九曜廟」的駐廟占星師（Jyotishi），廟裡供奉九曜，主神是藍黑色、持杖、行步最慢的土星神 Shani。你說話從容、有耐性、講因果與紀律，偶爾引一句《宿曜經》或《薄伽梵歌》，但從不冒充神本人，也不把 Shani 說成災星——他是教人守分與長久的老師。使用者的吠陀星盤已由系統排好，附在訊息中：上升（Lagna）、九曜在 D1 命盤的星座、度數、整宮制宮位與二十七宿（Nakshatra）及其足（pada）、D9 九分盤星座、月亮所在宿、Vimshottari 大運與目前的副運。

規則：
- 只根據提供的星盤解讀。絕不自行推算行星位置、宿位、宮位或大運起迄——排盤是系統以 Lahiri 歲差算好的，你的工作只有解讀。
- 吠陀占星是恆星黃道，太陽星座通常比西洋占星早一宮；使用者若疑惑，說明這是制度差異，不是排錯。
- 若使用者有提問，先看相關宮位與宮主星，再看月亮所在宿與目前大運、副運主星；沒有提問就依序談：上升與月亮宿的性格底色、事業（十宮）、財（二宮、十一宮）、感情（七宮與 D9）、目前大運與副運的主題。
- 宿用梵文名加宿曜經的中文宿名，如「Rohini（畢宿）」；宮位用第一到第十二宮；曜名用中文並可附梵名（土星 Shani）。
- 傳統補救法（寶石、咒語、齋戒、布施）只作文化說明，不作指示；涉及健康、投資、法律，明確建議諮詢專業人士。
- 使用繁體中文（除非使用者用其他語言提問）。結尾提醒：《薄伽梵歌》說人只擁有行動的權利，不擁有結果；星盤僅供參考與娛樂。\n${TONE}`,
}

// ── 關帝廟：靈籤 ─────────────────────────────────────────────────────────────
//
// No chart here. The deterministic layer is the ritual (lib/xtell-ritual.ts:
// a numbered stick, three 聖筊 to confirm) and the TEXT: 《關聖帝君靈籤》
// 一百首 from Wikisource, a public-domain 清刊本 with its six commentaries
// (聖意, 東坡解, 碧仙註, 解曰, 釋義, 占驗). The commentaries are the classic
// the master quotes — 一籤一書 — so the classics retriever has nothing to
// add and is skipped for this temple. The stick number is the only thing
// the client sends; the poem is loaded from disk here, so the model can
// only ever see the real text.

export type Qian = {
  n: number
  ganZhi: string
  luck: string
  story: string
  poem: string[]
  sections: Record<string, string>
}

let qianCache: Qian[] | null = null
export function guandiQian(): Qian[] {
  if (!qianCache) qianCache = JSON.parse(readFileSync(join(process.cwd(), 'content', 'qian', 'guandi.json'), 'utf-8'))
  return qianCache!
}
export function qianOf(n: number): Qian | null {
  return guandiQian().find(q => q.n === n) ?? null
}
export function validQian(n: unknown): n is number {
  return Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 100
}

/** The 籤 as facts: number, luck, the poem, every commentary the edition carries. */
export function guandiFacts(q: Qian, ask: string): string {
  const sections = Object.entries(q.sections).map(([k, v]) => `${k}：${v}`).join('\n')
  return [
    ask ? `信眾所問之事：${ask}` : '信眾未說明所問之事（請先問清楚，再解籤）。',
    `籤號：第${q.n}籤${q.ganZhi ? `　${q.ganZhi}` : ''}　${q.luck}`,
    q.story ? `典故：${q.story}` : '',
    `籤詩：\n${q.poem.map(l => '  ' + l).join('\n')}`,
    sections ? `本籤註解（清刊本原文，可直接引用，標明出處）：\n${sections}` : '',
    '擲筊：三聖筊為允，此籤已由關聖帝君允准。',
  ].filter(Boolean).join('\n')
}

// ── 四面佛：四面願文 + 流年 ─────────────────────────────────────────────────
//
// The Erawan ritual has no chart either: you walk the four faces clockwise
// (平安, 事業, 婚姻, 財富), tell each the same wish, and name how you will
// repay it. What code CAN do is read the visitor's own 八字 for this year —
// the 流年's 天干 as a 十神 against the 日主, its 地支 against the 日支
// (the marriage palace) and the 年支 (太歲) — so the master can say which
// face the year favours instead of inventing a tendency. Same relation
// tables as 合婚, same 立春-correct year pillar.

export const FACES = [
  { key: 'peace',    label: '平安' },
  { key: 'career',   label: '事業' },
  { key: 'marriage', label: '婚姻' },
  { key: 'wealth',   label: '財富' },
] as const
export type FaceKey = (typeof FACES)[number]['key']
export type Wishes = Partial<Record<FaceKey, string>> & { pledge?: string }

const MAX_WISH = 400
export function validWishes(w: any): w is Wishes {
  if (!w || typeof w !== 'object') return false
  const keys: string[] = [...FACES.map(f => f.key), 'pledge']
  let any = false
  for (const k of keys) {
    const v = w[k]
    if (v === undefined || v === '') continue
    if (typeof v !== 'string' || v.length > MAX_WISH) return false
    if (k !== 'pledge' && v.trim()) any = true
  }
  return any
}

export type LiuNian = {
  year: number
  ganZhi: string
  shiShen: string           // 流年天干 vs 日主
  dayBranch: BranchRelation // 流年地支 vs 日支（夫妻宮）
  yearBranch: BranchRelation // 流年地支 vs 年支（太歲）
  taiSui: string            // 值太歲 / 沖太歲 / 刑太歲 / 害太歲 / 合太歲 / 無
  daYun: string | null      // the 大運 in force
  age: number
}

export function liuNian(c: BaziChart, birthYear: number, year: number): LiuNian {
  // June 1 reads the year's 干支 because the 干支 year turns at 立春, not Jan 1.
  const gz = Solar.fromYmd(year, 6, 1).getLunar().getYearInGanZhi()
  const gan = gz[0], zhi = gz[1]
  const dayZhi = c.pillars.day.ganZhi[1], yearZhi = c.pillars.year.ganZhi[1]
  const yearBranch = branchRelation(zhi, yearZhi)
  const taiSui = zhi === yearZhi ? '值太歲'
    : yearBranch.kind === '六沖' ? '沖太歲'
    : yearBranch.kind === '相刑' ? '刑太歲'
    : yearBranch.kind === '相害' ? '害太歲'
    : yearBranch.kind === '六合' || yearBranch.kind === '三合' ? '合太歲'
    : '無'
  const age = year - birthYear
  const daYun = c.daYun.filter(d => d.startAge <= age).slice(-1)[0]?.ganZhi ?? null
  return {
    year, ganZhi: gz,
    shiShen: tcShiShen(LunarUtil.SHI_SHEN[c.dayMaster + gan] ?? '—'),
    dayBranch: branchRelation(zhi, dayZhi),
    yearBranch, taiSui, daYun, age,
  }
}

export function liuNianFacts(l: LiuNian): string {
  return [
    `今年流年：${l.year} ${l.ganZhi}年（虛歲約 ${l.age + 1}）`,
    `  流年天干對日主：${l.shiShen}`,
    `  流年地支對日支（夫妻宮）：${l.dayBranch.kind}`,
    `  流年地支對年支：${l.yearBranch.kind}${l.taiSui !== '無' ? `（${l.taiSui}）` : ''}`,
    l.daYun ? `  目前大運：${l.daYun}` : '',
  ].filter(Boolean).join('\n')
}

export function simianfoFacts(c: BaziChart, gender: string, hourUnknown: boolean, wishes: Wishes, l: LiuNian): string {
  const faces = FACES.map((f, i) => {
    const w = (wishes[f.key] ?? '').trim()
    return `  第${i + 1}面 ${f.label}：${w || '（未許願）'}`
  }).join('\n')
  const pledge = (wishes.pledge ?? '').trim()
  return [
    '信眾的八字（供對照四面之用，不做完整批命）：',
    baziFacts(c, gender, hourUnknown),
    '',
    liuNianFacts(l),
    '',
    '四面願文（信眾順時鐘向四面所說）：',
    faces,
    `還願方式：${pledge || '（尚未說明，請提醒信眾想好再許）'}`,
  ].join('\n')
}
