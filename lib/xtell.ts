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

import { chengguTheme } from './xtell-chenggu-reading'
import { Solar, LunarUtil } from 'lunar-typescript'
import { jyotishChart, jyotishFacts, type JyotishChart } from './jyotish'
import {
  natalChart, transits, retrogrades, progressions, solarReturn, synastry, longitude,
  natalFacts, transitFacts, synastryFacts, returnFacts,
  type NatalChart, type BirthPlace,
} from './astrology'
import { placeOf } from './xtell-places'
import { birthProblem } from './xtell-birth'
import { needsJiao, type QianEdition } from './xtell-ritual'
export { asQianEdition, type QianEdition } from './xtell-ritual'
import { resolveWallTime, inUtc8 } from './xtell-time'
export { birthProblem, type BirthProblem } from './xtell-birth'
import { weigh, zhiOfHour, weightText, lunarDateZh, monthZh, dayZh, CHENGGU_TABLE, type Chenggu, type ChengguLunar } from './xtell-chenggu'
export { CHENGGU_VERSION, type Chenggu } from './xtell-chenggu'
export { nameChart, nameFacts, validName, charInfo, ceziFacts, validChar } from './names'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { astro } from 'iztro'

export type Temple = 'bazi' | 'ziwei' | 'yuelao' | 'guandi' | 'mazu' | 'simianfo' | 'navagraha' | 'zhanxing' | 'xingming' | 'cezi' | 'yixue' | 'jiemeng' | 'guanyin' | 'tarot' | 'cookie' | 'kyusei' | 'sukuyo' | 'sunzi'
export const TEMPLES: Temple[] = ['bazi', 'ziwei', 'yuelao', 'guandi', 'mazu', 'simianfo', 'navagraha', 'zhanxing', 'xingming', 'cezi', 'yixue', 'jiemeng', 'guanyin', 'tarot', 'cookie', 'kyusei', 'sukuyo', 'sunzi']
/** The 求籤 temples: no birth, a stick number (and, but for 元三大師's set, a 聖筊). */
export const QIAN_TEMPLES = ['guandi', 'mazu', 'guanyin'] as const
export type QianTemple = (typeof QIAN_TEMPLES)[number]
export const isQianTemple = (t: Temple): t is QianTemple => (QIAN_TEMPLES as readonly string[]).includes(t)
export function asTemple(v: unknown): Temple { return (TEMPLES as string[]).includes(v as string) ? (v as Temple) : 'bazi' }

// Provenance (idea learned from horosa-skill's technique cards): every chart
// names the engine that computed it, so a doubted 排盤 is checkable against
// the exact library version rather than against "the site".
export const ENGINES: Record<Temple, string> = {
  bazi:   'lunar-typescript v1.8.6 · 稱骨 通行本 v1',
  yuelao: 'lunar-typescript v1.8.6',
  ziwei:  'iztro v2.6.0',
  // 關帝廟 has no chart: the deterministic layer is the ritual (lib/xtell-ritual.ts)
  // and the poem text, a public-domain 清刊本 from Wikisource.
  guandi:   '關聖帝君靈籤（維基文庫・清刊本）+ 擲筊聖筊',
  // 媽祖廟: the 六十甲子籤 set used at 鎮瀾宮/朝天宮, also from Wikisource.
  mazu:     '天上聖母六十甲子籤（維基文庫）+ 擲筊聖筊',
  // 觀音廟 (Sep 28): two hundred-stick sets, poems and grades only, checked
  // across sources (scripts/fetch-guanyin-qian.ts); the edition follows the
  // page's language.
  guanyin:  '觀音靈籤（觀音一百籤／元三大師觀音百籤）+ 擲筊聖筊（元三大師百籤不擲筊）',
  // 塔羅 (Sep 28): the 1909 Waite–Smith deck and Waite's own meanings from
  // The Pictorial Key to the Tarot (1911), both public domain (lib/tarot.ts).
  // 幸運餅乾 (Sep 28): the meal, 時辰 and day 干支 by code, the taste's 五行 by
  // the classical table; a quick model names the taste and writes the slip.
  cookie:   '幸運餅乾：餐別、時辰與日干支由程式計算 · 五味對五行 · 籤語由快速 AI 撰寫',
  tarot:    'Waite–Smith 塔羅（1909）· 韋特《The Pictorial Key to the Tarot》（1911）牌義照錄 · 洗牌由瀏覽器亂數',
  // 九星気学 (Sep 29): 本命星 by the 立春 year, 月命星 by the 節月, the 洛書
  // boards and the school's direction rules, by code (lib/kyusei.ts).
  // 宿曜占星術 (Sep 29): the 宿曜經 calendar (each lunar month's first day a
  // fixed 宿, one a day) and 三九祕法, by code (lib/sukuyo.ts).
  sukuyo:   '宿曜占星術：本命宿與日宿依宿曜經曆法（農曆每月初一固定宿，一日一宿，不用牛宿）· 三九祕法 · 農曆用 lunar-typescript v1.8.6',
  kyusei:   '九星氣學：本命星（立春為界）· 月命星（節入為界）· 洛書年盤月盤 · 凶方位與吉方位依園田流慣例 · 節氣用 lunar-typescript v1.8.6',
  // 姓名亭: strokes from Unicode's Unihan (kRSUnicode → 康熙部首原形), the
  // 81 數理 is the 熊崎式 convention. 測字亭: the same table for radical and
  // strokes; the 拆字 is the master's.
  xingming: '康熙筆畫（Unihan，Unicode 17）· 五格剖象 · 熊崎式 81 數理',
  cezi:     '康熙部首與筆畫（Unihan）· 拆解由老師為之',
  // 解夢 (Sep 27): a quick model picks the lines of 《周公解夢》 (Wikisource,
  // public domain) the dream points at, checked against the book
  // (lib/jiemeng.ts, lib/jiemeng-scan.ts); the reading is the master's.
  jiemeng:  '《周公解夢》（維基文庫）· 條目由 AI 從原書挑出、照錄原文 · 解讀由老師為之',
  // 孫子兵法 (Sep 29): built like 解夢. A quick model picks the lines of the
  // thirteen chapters the situation calls for, checked against the book, with
  // a plain translation of each (lib/sunzi.ts, lib/sunzi-scan.ts); the next
  // steps are the 軍師's.
  sunzi:    '《孫子兵法》十三篇（維基文庫）· 原文由 AI 從書中挑出、照錄 · 白話翻譯由 AI 撰寫 · 下一步由軍師為之',
  // 四面佛 reads the visitor's own 八字 against the wishes: same engine as 八字廟.
  simianfo: 'lunar-typescript v1.8.6',
  // 九曜廟: our own engine on astronomy-engine, checked against Swiss
  // Ephemeris (Lahiri) in the golden suite.
  navagraha: 'astronomy-engine v2.1 · Lahiri 歲差 · 平均交點 · 整宮制',
  // 占星塔: the tropical sibling of the same engine. The house system is
  // named because it is the one thing a visitor comparing against another
  // site will see differ, and above 66° there is no Placidus answer at all.
  zhanxing: 'astronomy-engine v2.1 · 回歸黃道 · Placidus 分宮 · 平均交點',
  // 易學堂: no library. Three coins, the King Wen table checked against the
  // text itself, and 朱熹's rule for which passage to read (lib/yijing-core).
  yixue: '問老師與經文查閱 · 維基文庫《周易》原文 · 選修三枚硬幣起卦練習',
}

export interface BirthInput {
  y: number; m: number; d: number; h: number; mi: number
  gender: 'male' | 'female'
  /** validBirth() sets h/mi to noon when this is true, only so the engines
   *  have an instant to compute from. The noon is never shown or handed to
   *  a master as the birth time: 八字 drops the 時柱 and anything the hour
   *  decides, 占星塔 reads the flag, and the rest do not offer it. */
  hourUnknown?: boolean
}

/** A real, supported birth (lib/xtell-birth.ts: a Gregorian date that exists,
 *  1900 to today, a clock time unless the hour is unknown). Normalises an
 *  unknown hour to noon, see BirthInput. */
export function validBirth(b: any): b is BirthInput {
  if (b && typeof b === 'object' && b.hourUnknown === true) { b.h = 12; b.mi = 0 }
  return birthProblem(b) === null
}

// ── 八字 ────────────────────────────────────────────────────────────────────

// lunar-typescript spells the 十神 in simplified script (伤官, 正财, 七杀) and
// the whole page is 繁體, so the three that differ are mapped here — at the
// chart, once, so the board and the facts agree.
const SHI_SHEN_TC: Record<string, string> = { 伤官: '傷官', 正财: '正財', 偏财: '偏財', 劫财: '劫財', 七杀: '七殺' }
const tcShiShen = (s: string) => SHI_SHEN_TC[s] ?? s
// The same for 納音, the lunar month and the 節 names (audit, Sep 26:
// 「炉中火」「涧下水」 on a 繁體 page). Only these twelve of the thirty 納音
// differ between the scripts.
const NAYIN_TC: Record<string, string> = {
  炉中火: '爐中火', 剑锋金: '劍鋒金', 山头火: '山頭火', 覆灯火: '覆燈火', 涧下水: '澗下水', 城头土: '城頭土',
  大驿土: '大驛土', 白蜡金: '白蠟金', 钗钏金: '釵釧金', 杨柳木: '楊柳木', 霹雳火: '霹靂火', 长流水: '長流水',
}
const tcNaYin = (s: string) => NAYIN_TC[s] ?? s
const tcLunar = (s: string) => s.replace(/腊/g, '臘').replace(/闰/g, '閏')
/** The twelve 節 that begin a 月柱. getJieQiTable() keys the neighbouring
 *  years' entries in pinyin, so those spellings are listed too. */
const JIE_TC: Record<string, string> = {
  立春: '立春', LI_CHUN: '立春', 惊蛰: '驚蟄', JING_ZHE: '驚蟄', 清明: '清明', 立夏: '立夏', 芒种: '芒種', 小暑: '小暑',
  立秋: '立秋', 白露: '白露', 寒露: '寒露', 立冬: '立冬', 大雪: '大雪', DA_XUE: '大雪', 小寒: '小寒', XIAO_HAN: '小寒',
}

/** One value an undecided pillar can take. */
export type PillarChoice = { ganZhi: string; naYin: string; wuXing: string }
/**
 * An unknown hour on a day a 節 begins (audit F02): the 月柱, and on 立春 the
 * 年柱 too, change at that moment, so the date alone does not decide them.
 * Both values are kept, [before the 節, after it], with the 節 and its
 * moment (lunar-typescript's clock). The 日柱 follows the calendar date in
 * this library's default (sect 2: 23:00–24:00 keeps the day), so it is
 * never in doubt; checked in scripts/test-xtell-birth.ts.
 */
export type BaziDoubt = { term: { name: string; time: string }; year?: [PillarChoice, PillarChoice]; month?: [PillarChoice, PillarChoice] }

function doubtOf(b: BirthInput): BaziDoubt | undefined {
  const at = (h: number, mi: number) => Solar.fromYmdHms(b.y, b.m, b.d, h, mi, 0).getLunar().getEightChar()
  const early = at(0, 0), late = at(23, 59)
  const yearMoves = early.getYear() !== late.getYear()
  const monthMoves = early.getMonth() !== late.getMonth()
  if (!yearMoves && !monthMoves) return undefined
  const choice = (e: typeof early, which: 'year' | 'month'): PillarChoice => which === 'year'
    ? { ganZhi: e.getYear(), naYin: tcNaYin(e.getYearNaYin()), wuXing: e.getYearWuXing() }
    : { ganZhi: e.getMonth(), naYin: tcNaYin(e.getMonthNaYin()), wuXing: e.getMonthWuXing() }
  const ymd = `${b.y}-${String(b.m).padStart(2, '0')}-${String(b.d).padStart(2, '0')}`
  const table = Solar.fromYmd(b.y, b.m, b.d).getLunar().getJieQiTable() as Record<string, Solar>
  const hit = Object.entries(table).find(([k, s]) => JIE_TC[k] && s.toYmd() === ymd)
  return {
    // To the second: 20:40:24, so 20:40 is not read as the side it is not on.
    term: hit ? { name: JIE_TC[hit[0]], time: hit[1].toYmdHms().slice(11, 19) } : { name: '節', time: '' },
    ...(yearMoves ? { year: [choice(early, 'year'), choice(late, 'year')] as [PillarChoice, PillarChoice] } : {}),
    ...(monthMoves ? { month: [choice(early, 'month'), choice(late, 'month')] as [PillarChoice, PillarChoice] } : {}),
  }
}

export function baziChart(b: BirthInput) {
  // An unknown hour is computed at noon only to have an instant. Nothing the
  // hour decides leaves this function: no clock time, no 時柱, no 時柱 五行,
  // and when a 節 falls that day, both readings of the pillars it moves.
  const unknown = b.hourUnknown === true
  const solar = Solar.fromYmdHms(b.y, b.m, b.d, unknown ? 12 : b.h, unknown ? 0 : b.mi, 0)
  const lunar = solar.getLunar()
  const e = lunar.getEightChar()
  const doubt = unknown ? doubtOf(b) : undefined

  // 大運 — first six decades. getYun takes 1 for male, 0 for female. Its
  // sequence starts from the 月柱 and runs by the 年干, so an undecided
  // month leaves no sequence to show; with the hour merely unknown the start
  // ages are approximate (the facts and the board say so).
  let daYun: Array<{ startAge: number; ganZhi: string }> = []
  if (!doubt) {
    try {
      daYun = e.getYun(b.gender === 'male' ? 1 : 0).getDaYun().slice(1, 7)
        .map(y => ({ startAge: y.getStartAge(), ganZhi: y.getGanZhi() }))
    } catch { /* 大運 is a bonus, never a blocker */ }
  }

  return {
    solar: unknown ? solar.toYmd() : solar.toYmdHms(),
    lunar: tcLunar(lunar.toString()),
    ...(unknown ? { hourUnknown: true as const } : {}),
    pillars: {
      year:  { ganZhi: e.getYear(),  naYin: tcNaYin(e.getYearNaYin()),  shiShen: tcShiShen(e.getYearShiShenGan()),  hideGan: e.getYearHideGan() },
      month: { ganZhi: e.getMonth(), naYin: tcNaYin(e.getMonthNaYin()), shiShen: tcShiShen(e.getMonthShiShenGan()), hideGan: e.getMonthHideGan() },
      day:   { ganZhi: e.getDay(),   naYin: tcNaYin(e.getDayNaYin()),   shiShen: '日主',                 hideGan: e.getDayHideGan() },
      time:  unknown ? null : { ganZhi: e.getTime(), naYin: tcNaYin(e.getTimeNaYin()), shiShen: tcShiShen(e.getTimeShiShenGan()), hideGan: e.getTimeHideGan() },
    },
    dayMaster: e.getDayGan(),
    wuXing: unknown ? [e.getYearWuXing(), e.getMonthWuXing(), e.getDayWuXing()] : [e.getYearWuXing(), e.getMonthWuXing(), e.getDayWuXing(), e.getTimeWuXing()],
    daYun,
    ...(doubt ? { doubt } : {}),
  }
}

export type BaziChart = ReturnType<typeof baziChart>

/** 己卯或庚辰（未定） when the day does not decide the pillar. */
function pillarOrChoices(c: BaziChart, k: 'year' | 'month'): string {
  const d = c.doubt?.[k]
  return d ? `${d[0].ganZhi}或${d[1].ganZhi}（未定）` : c.pillars[k].ganZhi
}
/** The 節 line the master needs when a pillar is undecided. */
function doubtFacts(c: BaziChart): string {
  const d = c.doubt
  if (!d) return ''
  const side = (i: 0 | 1) => [d.year ? `年柱 ${d.year[i].ganZhi}` : '', d.month ? `月柱 ${d.month[i].ganZhi}` : ''].filter(Boolean).join('、')
  return `節氣交界：出生當天${d.term.time ? ` ${d.term.time} ` : ''}交${d.term.name}，時辰未知，無法判斷生在交節之前或之後。交節前為${side(0)}；交節後為${side(1)}。兩種可能都要照實說出，不可擇一斷言。只有信眾能確認出生時間在交節這一刻之前或之後，才可補上時間重新排盤；只是大約記得，仍屬未定。`
}

export function baziFacts(c: BaziChart, gender: string, hourUnknown = false): string {
  const p = c.pillars
  if (hourUnknown || c.hourUnknown || !p.time) {
    const wx = [
      c.doubt?.year ? `${c.doubt.year[0].wuXing}或${c.doubt.year[1].wuXing}` : c.wuXing[0],
      c.doubt?.month ? `${c.doubt.month[0].wuXing}或${c.doubt.month[1].wuXing}` : c.wuXing[1],
      c.wuXing[2],
    ]
    return [
      `出生（國曆）：${String(c.solar).slice(0, 10)}（時辰未知）；農曆：${c.lunar}`,
      `性別：${gender === 'male' ? '男' : '女'}`,
      `時辰未知：只排年月日三柱，時柱及一切由時辰決定的判斷都不論。`,
      `三柱：年 ${pillarOrChoices(c, 'year')}、月 ${pillarOrChoices(c, 'month')}、日 ${p.day.ganZhi}　日主：${c.dayMaster}`,
      `五行（干支，不含時柱）：${wx.join('，')}`,
      doubtFacts(c),
      c.daYun.length ? `大運（起運歲數以正午推算，時辰未知，為約略值）：${c.daYun.map(d => `約${d.startAge}歲起 ${d.ganZhi}`).join('；')}`
        : c.doubt ? `大運：月柱未定，大運的干支順序無法確定，系統不列，不可自行推算。` : '',
      `解讀時明確告知信眾：時辰未知會影響精細度，時柱所主之事（晚年、子女、內心底色）不宜細斷。`,
    ].filter(Boolean).join('\n')
  }
  const t = p.time
  return [
    `出生（國曆）：${c.solar}，${gender === 'male' ? '男' : '女'}`,
    `農曆：${c.lunar}`,
    `四柱：年柱 ${p.year.ganZhi}（${p.year.naYin}，${p.year.shiShen}）· 月柱 ${p.month.ganZhi}（${p.month.naYin}，${p.month.shiShen}）· 日柱 ${p.day.ganZhi}（${p.day.naYin}）· 時柱 ${t.ganZhi}（${t.naYin}，${t.shiShen}）`,
    `日主：${c.dayMaster}`,
    `藏干：年 ${p.year.hideGan.join('、')}；月 ${p.month.hideGan.join('、')}；日 ${p.day.hideGan.join('、')}；時 ${t.hideGan.join('、')}`,
    `五行（干支）：${c.wuXing.join('，')}`,
    c.daYun.length ? `大運：${c.daYun.map(d => `${d.startAge}歲起 ${d.ganZhi}`).join('；')}` : '',
  ].filter(Boolean).join('\n')
}

// ── 稱骨 ────────────────────────────────────────────────────────────────────
// The table and the rules are in lib/xtell-chenggu.ts; this is the one step
// that needs the calendar. Year, month and day come from the calendar DATE
// (the day turns at 00:00), so the hour never moves them; it picks only the
// 時辰.

/** The lunar date 稱骨 reads: the year by 正月初一 (not 立春, unlike the 年柱),
 *  the calendar month (a leap month keeps its number, flagged), the day. */
function chengguLunar(s: Solar): ChengguLunar {
  const l = s.getLunar()
  return { yearGanZhi: l.getYearInGanZhi(), month: Math.abs(l.getMonth()), leap: l.getMonth() < 0, day: l.getDay() }
}

/** 稱骨 for a birth validBirth() accepted. An unknown hour has no 時辰 and so
 *  no total, never the noon placeholder's; a birth at 23:xx also carries the
 *  total by the school that turns the day at 23:00. */
export function chengGu(b: BirthInput): Chenggu {
  const problem = birthProblem(b)
  if (problem) throw new RangeError(`chengGu: ${problem}`)
  const date = Solar.fromYmd(b.y, b.m, b.d)
  const unknown = b.hourUnknown === true
  const out = weigh(chengguLunar(date), unknown ? null : zhiOfHour(b.h))
  if (unknown || b.h !== 23) return out
  const next = weigh(chengguLunar(date.next(1)), '子')
  return { ...out, lateZi: { lunar: next.lunar, weights: next.weights, total: next.total as number } }
}

/**
 * The 稱骨 lines for the 八字 master: the weights and the sum as the card
 * shows them, the rules they follow, and the limits. There is no verse text
 * here to quote (no edition is verified), so the master is told not to
 * supply one; the method is a folk tradition, not a tested prediction; and
 * it waits until the visitor asks, so a reading of the pillars is not
 * steered by it.
 */
export function chengguFacts(c: Chenggu): string {
  const w = (q: number) => weightText(q)
  const parts = (l: ChengguLunar, x: { year: number; month: number; day: number }) =>
    `年 ${l.yearGanZhi} ${w(x.year)}＋月 ${l.leap ? `閏${monthZh(l.month)}（按${monthZh(l.month)}計）` : monthZh(l.month)} ${w(x.month)}＋日 ${dayZh(l.day)} ${w(x.day)}`
  return [
    `稱骨（八字幾兩幾錢）：重量表 ${CHENGGU_TABLE}，男女同表。算法：年以農曆正月初一換年（不是四柱所用的立春），月用農曆月份（不是節氣月），閏月按所閏的月份計，00:00 換日（23:00–23:59 仍算當天子時），依所填鐘錶時間，不做真太陽時校正。`,
    c.total !== null && c.zhi
      ? `  農曆 ${lunarDateZh(c.lunar)} ${c.zhi}時：${parts(c.lunar, c.weights)}＋時 ${c.zhi} ${w(c.weights.hour as number)}＝${w(c.total)}`
      : `  農曆 ${lunarDateZh(c.lunar)}，時辰未知：${parts(c.lunar, c.weights)}，小計 ${w(c.fixed)}。時辰未定，總重只能是以下其中之一：${(c.options ?? []).map(o => `${w(o.total)}（${o.zhi.join('、')}時）`).join('；')}。不可給出單一總重，也不可把中午當作出生時辰。`,
    c.lateZi ? `  晚子時另一說：以 23:00 換日的算法會算作次日 ${lunarDateZh(c.lateZi.lunar)} 子時：${parts(c.lateZi.lunar, c.lateZi.weights)}＋時 子 ${w(c.lateZi.weights.hour as number)}＝${w(c.lateZi.total)}。本站採 00:00 換日；兩種算法都要照實說明，不可只講一種。` : '',
    // Each alternative changes only its own entry: a table that differs on
    // both (hankwu61) is not what either line describes (Codex review).
    ...(c.variants ?? []).map(v => `  版本差異：${v.entry === 'guihai' ? '癸亥年' : '農曆二十日'}在本表為 ${w(v.v1)}，另有流通版本記為 ${w(v.other)}${v.total !== null ? `；只把這一項改為 ${w(v.other)}、其他各項不變時，總重是 ${w(v.total)}` : ''}。`),
    `  頁面白話主題（傳統意象，不是個人預測）：${(c.total !== null ? [c.total] : (c.options ?? []).map(o => o.total)).map(q => `${w(q)}：${chengguTheme(q) ?? '未收錄，不可杜撰'}`).join('；')}。`,
    `  稱骨是民間傳統算法，不是經過驗證的預測，不可說成定論，重量不代表人生好壞。只依上列白話主題解釋傳統意象；不要引述、補寫或改寫任何稱骨歌句，不可預言壽命、生育、財富或地位，也不要從歌訣要求改名、搬家或改信宗教。時辰未知時逐項說明，不可選定單一結果。信眾問到稱骨或幾兩幾錢時再談；一般解讀不必提。`,
  ].filter(Boolean).join('\n')
}

// ── 每日運勢：八字流日 ─────────────────────────────────────────────────────────
// The free daily fortune (app/api/xtell/daily) reads today's day pillar
// against a SAVED birth profile, which, unlike the 八字廟 form, has a birth
// place and so a zone. The pillars follow two clocks (Codex review):
//  - year and month change at a 節, an instant; the calendar library keeps
//    its 節 on UTC+8, so the birth instant is expressed on that clock for
//    them. 2026 立春 is 04:02 in Taipei and 05:02 in Seoul: a Seoul 04:30
//    birth is still 乙巳 year, a Taipei 04:30 birth is 丙午.
//  - day and hour follow the local civil date and time, the site's
//    convention everywhere (23:00 keeps the date).
// Every 十神 is read against the LOCAL day master, never against the UTC+8
// chart's own day, which differs near midnight. No 大運 here (not needed
// for a day, and its start age would need its own review).

export type DailyPillar = string | [string, string]
export type DailyNatal = {
  /** 日主: the local day's stem. */
  dayMaster: string
  pillars: { year: DailyPillar; month: DailyPillar; day: string; time: string | null }
  hourUnknown: boolean
}

/** The instants a civil date spans in a zone: [its first instant, the next
 *  date's first instant). A day may be 23 or 25 hours, and a zone that
 *  skipped midnight starts the day at the first time that existed. */
export function civilDay(y: number, m: number, d: number, tz: string): [number, number] {
  const first = (yy: number, mm: number, dd: number): number => {
    for (let min = 0; min < 240; min++) {
      const w = resolveWallTime(yy, mm, dd, Math.floor(min / 60), min % 60, tz)
      if (w.kind === 'exact') return w.utc
      if (w.kind === 'ambiguous') return w.utc[0]
    }
    return Date.UTC(yy, mm - 1, dd)
  }
  const next = new Date(Date.UTC(y, m - 1, d + 1))
  return [first(y, m, d), first(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate())]
}

/** Year and month pillars at an instant, on the 節 clock (UTC+8). */
function yearMonthAt(at: number): { year: string; month: string } {
  const p = inUtc8(at)
  const e = Solar.fromYmdHms(p.y, p.m, p.d, p.h, p.mi, p.s).getLunar().getEightChar()
  return { year: e.getYear(), month: e.getMonth() }
}

/**
 * A birth with a place, charted for the daily fortune. `utc` is the birth
 * instant (lib/xtell-time birthInstant: gaps refused, repeats chosen), or
 * null when the hour is unknown, in which case year and month are read at
 * both ends of the civil day in the birth zone and kept as a pair when a 節
 * falls inside it.
 */
export function baziNatalZoned(b: { y: number; m: number; d: number; h: number; mi: number; hourUnknown?: boolean }, tz: string, utc: number | null): DailyNatal {
  const unknown = b.hourUnknown === true || utc === null
  const local = Solar.fromYmdHms(b.y, b.m, b.d, unknown ? 12 : b.h, unknown ? 0 : b.mi, 0).getLunar().getEightChar()
  let year: DailyPillar, month: DailyPillar
  if (!unknown) {
    ({ year, month } = yearMonthAt(utc as number))
  } else {
    const [start, end] = civilDay(b.y, b.m, b.d, tz)
    const a = yearMonthAt(start), z = yearMonthAt(end - 1000)
    year = a.year === z.year ? a.year : [a.year, z.year]
    month = a.month === z.month ? a.month : [a.month, z.month]
  }
  return {
    dayMaster: local.getDayGan(),
    pillars: { year, month, day: local.getDay(), time: unknown ? null : local.getTime() },
    hourUnknown: unknown,
  }
}

export type LiuRiRelation = { with: 'year' | 'month' | 'day' | 'time'; natal: string; kind: BranchRelation['kind']; undecided?: true }
export type LiuRi = {
  date: string
  tz: string
  day: string
  dayShiShen: string
  month: string
  monthShiShen: string
  year: string
  yearShiShen: string
  relations: LiuRiRelation[]
  hourUnknown: boolean
}

/** 流日: the local date's day pillar against a natal chart, with the month
 *  and year in force at the day's anchor (local noon, on the 節 clock). */
export function liuRi(n: DailyNatal, date: string, tz: string, anchor: number): LiuRi {
  const [y, m, d] = date.split('-').map(Number)
  const day = Solar.fromYmd(y, m, d).getLunar().getDayInGanZhi()
  const { year, month } = yearMonthAt(anchor)
  const god = (gz: string) => tcShiShen(LunarUtil.SHI_SHEN[n.dayMaster + gz[0]] ?? '—')
  const relations: LiuRiRelation[] = []
  for (const k of ['year', 'month', 'day', 'time'] as const) {
    const p = n.pillars[k]
    if (p === null) continue
    for (const gz of Array.isArray(p) ? p : [p]) {
      relations.push({ with: k, natal: gz, kind: branchRelation(day[1], gz[1]).kind, ...(Array.isArray(p) ? { undecided: true as const } : {}) })
    }
  }
  return { date, tz, day, dayShiShen: god(day), month, monthShiShen: god(month), year, yearShiShen: god(year), relations, hourUnknown: n.hourUnknown }
}

const PILLAR_ZH = { year: '年柱', month: '月柱', day: '日柱', time: '時柱' } as const
/** The day's BaZi basis as the daily writer and the follow-up teacher read it. */
export function liuRiFacts(n: DailyNatal, l: LiuRi): string {
  const show = (p: DailyPillar) => Array.isArray(p) ? `${p[0]}或${p[1]}（出生當天交節、時辰未知，未定）` : p
  const rel = l.relations.filter(r => r.kind !== '無特殊關係')
  return [
    `本命（依出生地時區；年、月依節氣時刻，日、時依當地日期與時間）：年柱 ${show(n.pillars.year)}、月柱 ${show(n.pillars.month)}、日柱 ${n.pillars.day}${n.pillars.time ? `、時柱 ${n.pillars.time}` : '（時辰未知，不論時柱）'}；日主 ${n.dayMaster}`,
    `今日（${l.date}，${l.tz} 當地日期）：流日 ${l.day}，天干對日主為${l.dayShiShen}；流月 ${l.month}（${l.monthShiShen}）；流年 ${l.year}（${l.yearShiShen}）。`,
    rel.length
      ? `流日地支與本命：${rel.map(r => `${r.natal[1]}（${PILLAR_ZH[r.with]}${r.undecided ? '，未定之一' : ''}）${r.kind}`).join('；')}。`
      : '流日地支與本命各柱沒有合、沖、刑、害。',
    l.hourUnknown ? '時辰未知：只看年、月、日三柱，不談時柱所主之事。' : '',
  ].filter(Boolean).join('\n')
}

// ── 紫微斗數 ────────────────────────────────────────────────────────────────

/** 時辰 index for iztro: 0 早子時(00:xx) … 11 亥時, 12 晚子時(23:xx). */
export function timeIndexOf(h: number): number {
  return h === 23 ? 12 : Math.floor((h + 1) / 2)
}

// 運限: the 大限 in force, this year's and next year's 流年, and the current
// 流月 — each as "which NATAL palace its 命宮 lands on" plus its 四化
// (祿權科忌 by star). Both masters were telling visitors, correctly, that
// the chart carried no 大限/流年 and refusing to say which year was better
// (owner, Sep 24) — iztro had it all along; it just was not serialized.
// `now` is a parameter so the golden suite can freeze a date.
export type ZiweiPeriod = { name: string; ganZhi: string; palace: string; range?: [number, number]; year?: number; mutagen: string[]; roles: Record<string, string> }
function periodOf(a: any, h: any, name: string, year?: number): ZiweiPeriod {
  const natal = a.palaces.map((p: any) => p.name as string)
  const idx = h.index as number
  // roles: 流年/大限 palace role → the natal palace it sits on
  const roles: Record<string, string> = {}
  ;(h.palaceNames as string[]).forEach((role, i) => { roles[role] = natal[i] })
  return {
    name, ganZhi: `${h.heavenlyStem}${h.earthlyBranch}`, palace: natal[idx],
    range: name === '大限' ? a.palaces[idx]?.decadal?.range : undefined,
    year, mutagen: h.mutagen as string[], roles,
  }
}

export function ziweiChart(b: BirthInput, now: Date = new Date()) {
  const a = astro.bySolar(`${b.y}-${b.m}-${b.d}`, timeIndexOf(b.h), b.gender === 'male' ? 'male' : 'female', true, 'zh-TW')
  const ymd = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
  const thisYear = now.getFullYear()
  // 流年 turns at 立春; mid-year dates read each year's own pillar cleanly.
  const h0: any = a.horoscope(ymd(now))
  const h1: any = a.horoscope(`${thisYear}-6-1`)
  const h2: any = a.horoscope(`${thisYear + 1}-6-1`)
  const horoscope = {
    nominalAge: h0.age?.nominalAge as number | undefined,
    decadal: periodOf(a, h0.decadal, '大限'),
    years: [periodOf(a, h1.yearly, '流年', thisYear), periodOf(a, h2.yearly, '流年', thisYear + 1)],
    month: { ...periodOf(a, h0.monthly, '流月'), label: `${thisYear}-${now.getMonth() + 1}` },
  }
  return {
    horoscope,
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
  const hua = (m: string[]) => `化祿 ${m[0]}、化權 ${m[1]}、化科 ${m[2]}、化忌 ${m[3]}`
  const ROLES = ['命宮', '官祿', '財帛', '夫妻', '遷移', '田宅', '福德', '疾厄']
  const roleLine = (p: ZiweiPeriod) => ROLES.map(r => `${p.name}${r}＝本命${p.roles[r]}宮`).join('，')
  const h = c.horoscope
  const period = (p: ZiweiPeriod) => [
    `${p.name}${p.year ? ` ${p.year} 年` : ''}（${p.ganZhi}${p.range ? `，${p.range[0]}–${p.range[1]} 歲` : ''}）：${p.name}命宮落在本命「${p.palace}宮」；${p.name}四化：${hua(p.mutagen)}`,
    `  ${roleLine(p)}`,
  ].join('\n')
  return [
    `出生（國曆）：${c.solar}，${gender === 'male' ? '男' : '女'}`,
    `農曆：${c.lunar} ${c.time}`,
    `五行局：${c.fiveElementsClass}　命主：${c.soul}　身主：${c.body}`,
    `十二宮（本命盤）：`,
    ...lines,
    ``,
    `運限（系統以 iztro 排定，可直接據此論流年，勿自行推算）：`,
    h.nominalAge ? `目前虛歲：${h.nominalAge}` : '',
    period(h.decadal),
    period(h.years[0]),
    period(h.years[1]),
    `${h.month.name}（${h.month.label}，${h.month.ganZhi}）：流月命宮落在本命「${h.month.palace}宮」；流月四化：${hua(h.month.mutagen)}`,
    `論某一年時：以該年流年四化落入哪一本命宮位、流年命宮與流年官祿／財帛所疊的本命宮位及其主星為據，並參照大限四化；只提供今年與明年，更遠的年份與其他月份請告知信眾系統未排、不可推測。`,
  ].filter(x => x !== '').join('\n')
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

/** `range` and `undecided` appear only when a birth date does not decide a
 *  pillar the dimension reads (an unknown hour on a 節 day). */
export type HeDimension = { key: string; label: string; weight: number; score: number; detail: string; range?: [number, number]; undecided?: true }
export type HeYear = { year: number; ganZhi: string; who: 'a' | 'b' | 'both'; kind: string; good: boolean; note: string }
export type HeMatch = {
  overall: number
  /** Lowest and highest total when a pillar is undecided; `overall` is then
   *  their midpoint and must not be shown alone. */
  range?: [number, number]
  band: 'high' | 'good' | 'mixed' | 'work'
  dimensions: HeDimension[]
  years: HeYear[]
}

/**
 * One way a birth date can be read for 合婚: the pillars the weights look
 * at, and the elements of the pillars that are actually known. An unknown
 * hour contributes no 時柱 — its noon placeholder must not add elements
 * (audit F02, Codex: two 1985-07-20 births with unknown hours gained 水火
 * from the placeholder and a false 5/5). A 節 day with an unknown hour gives
 * two readings, before and after the 節; both are scored.
 */
type HeView = { year: string; month: string; day: string; dayMaster: string; elements: Set<string> }
const elementSet = (parts: string[]) => new Set(parts.join('').split('').filter(Boolean))
function heViews(c: BaziChart): HeView[] {
  const p = c.pillars
  const known = p.time ? c.wuXing : c.wuXing.slice(0, 3)
  const base: HeView = { year: p.year.ganZhi, month: p.month.ganZhi, day: p.day.ganZhi, dayMaster: c.dayMaster, elements: elementSet(known) }
  const d = c.doubt
  if (!d) return [base]
  return ([0, 1] as const).map(i => ({
    ...base,
    year: d.year?.[i].ganZhi ?? base.year,
    month: d.month?.[i].ganZhi ?? base.month,
    elements: elementSet([d.year?.[i].wuXing ?? c.wuXing[0], d.month?.[i].wuXing ?? c.wuXing[1], c.wuXing[2]]),
  }))
}

function heScore(a: HeView, b: HeView): HeDimension[] {
  const dayBranch = branchRelation(a.day[1], b.day[1])
  const dayStem = stemRelation(a.dayMaster, b.dayMaster)
  const yearBranch = branchRelation(a.year[1], b.year[1])
  const monthBranch = branchRelation(a.month[1], b.month[1])

  // 五行互補: how much of the five is covered once both charts are laid
  // together. Five out of five means whatever one lacks, the other carries.
  const both = new Set([...a.elements, ...b.elements])
  const spread = 40 + Math.min(5, both.size) * 12

  return [
    { key: 'dayBranch', label: '日支・夫妻宮', weight: 30, score: dayBranch.score,
      detail: `${a.day[1]} × ${b.day[1]}　${dayBranch.kind}` },
    { key: 'dayStem', label: '日主・兩人本性', weight: 25, score: dayStem.score,
      detail: `${a.dayMaster} × ${b.dayMaster}　${dayStem.kind}` },
    { key: 'yearBranch', label: '生肖・年支', weight: 20, score: yearBranch.score,
      detail: `${ZHI_SHENG_XIAO[a.year[1]] ?? a.year[1]} × ${ZHI_SHENG_XIAO[b.year[1]] ?? b.year[1]}　${yearBranch.kind}` },
    { key: 'monthBranch', label: '月支・家庭性情', weight: 15, score: monthBranch.score,
      detail: `${a.month[1]} × ${b.month[1]}　${monthBranch.kind}` },
    { key: 'spread', label: '五行互補', weight: 10, score: spread,
      detail: `兩盤合看涵蓋 ${[...both].join('、')}（${both.size}/5）` },
  ]
}
const totalOf = (dims: HeDimension[]) => Math.round(dims.reduce((sum, d) => sum + d.score * d.weight, 0) / 100)
const bandOf = (n: number): HeMatch['band'] => n >= 82 ? 'high' : n >= 70 ? 'good' : n >= 58 ? 'mixed' : 'work'

/**
 * The full 合盤. Every reading of both dates is scored (at most 2 × 2); when
 * they disagree the total is a range and each dimension that moved says
 * so, rather than one of the readings being picked silently.
 */
export function heMatch(a: BaziChart, b: BaziChart, fromYear: number): HeMatch {
  const readings = heViews(a).flatMap(va => heViews(b).map(vb => heScore(va, vb)))
  const totals = readings.map(totalOf)
  const lo = Math.min(...totals), hi = Math.max(...totals)
  const dimensions: HeDimension[] = readings[0].map((d, i) => {
    const all = readings.map(r => r[i])
    const scores = all.map(x => x.score), details = [...new Set(all.map(x => x.detail))]
    if (details.length === 1) return d
    const min = Math.min(...scores), max = Math.max(...scores)
    return { ...d, score: min, detail: details.join('　或　'), undecided: true, ...(min !== max ? { range: [min, max] as [number, number] } : {}) }
  })
  const overall = lo === hi ? lo : Math.round((lo + hi) / 2)
  const band = bandOf(overall)
  const ad = a.pillars.day.ganZhi, bd = b.pillars.day.ganZhi

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

  return { overall, ...(lo !== hi ? { range: [lo, hi] as [number, number] } : {}), band, dimensions, years }
}

export function yuelaoFacts(a: BaziChart, aGender: string, b: BaziChart, bGender: string, match?: HeMatch): string {
  // Each person through the same facts as 八字廟, so an unknown hour is said
  // the same way everywhere: no clock time, no 時柱, and both readings of a
  // pillar the date does not decide.
  const one = (c: BaziChart, g: string, label: string) =>
    [`${label}：`, ...baziFacts(c, g).split('\n').map(x => `  ${x}`)].join('\n')
  const base = `${one(a, aGender, '第一位')}\n\n${one(b, bGender, '第二位')}`
  if (!match) return base
  // The visitor is looking at these exact numbers on screen. A master who
  // talks past them reads as broken, so they go in as facts, not suggestions.
  const dims = match.dimensions.map(d => `  ${d.label}（權重 ${d.weight}）：${d.range ? `${d.range[0]}–${d.range[1]} 分` : `${d.score} 分`}${d.undecided ? '（未定）' : ''}　${d.detail}`).join('\n')
  const total = match.range
    ? `${match.range[0]}–${match.range[1]}（有一方時辰未知且生於節氣交界日，年／月柱未定，分數只能給範圍；說明時照實講範圍，不可只講其中一個數）`
    : String(match.overall)
  const years = match.years.length
    ? match.years.map(y => `  ${y.year} ${y.ganZhi}：${y.kind}（${y.who === 'both' ? '兩人皆應' : y.who === 'a' ? '應第一位' : '應第二位'}）`).join('\n')
    : '  未來八年內，流年地支與雙方日支無明顯合沖。'
  return `${base}\n\n系統已排好的合盤分數（信眾此刻正看著這張表，請以此為準，不要另給一組數字）：\n  總分：${total}\n${dims}\n\n流年（未來八年，只列有合沖者）：\n${years}\n\n分數的權重是本站依傳統合婚規則所定，是閱讀兩張命盤的一種方法，不是對兩人關係的驗證；講解時要說清楚。`
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

// ── 占星塔：西洋占星 ────────────────────────────────────────────────────────
//
// The one temple with ROOMS. The other six ask a single question, so their
// form is a birth row and their board is a chart. Western astrology is four
// different readings off one chart, and 配對 needs a second person, so the
// mode is part of the request rather than something the master infers.
//
//   natal     the birth chart: planets, houses, aspects, balances
//   synastry  two charts against each other, plus the composite
//   today     transits against the natal chart, for THIS date
//   year      the solar return plus secondary progressions
//
// Every visit is saved to the visitor's own account (supabase/105, owner
// Sep 24), like every temple. `today` additionally remembers the last birth
// row in the visitor's browser (localStorage) so the daily room opens
// filled in; that copy never leaves the browser.

export type AstroMode = 'natal' | 'synastry' | 'today' | 'year'
export const ASTRO_MODES: AstroMode[] = ['natal', 'synastry', 'today', 'year']
export const asAstroMode = (v: unknown): AstroMode =>
  (ASTRO_MODES as string[]).includes(v as string) ? (v as AstroMode) : 'natal'

function birthPlace(b: BirthInput, placeKey: unknown): BirthPlace {
  const p = placeOf(placeKey)
  if (!p) throw new Error('unknown place')
  return { y: b.y, m: b.m, d: b.d, h: b.h, mi: b.mi, lat: p.lat, lon: p.lon, tz: p.tz, place: p.label, hourUnknown: b.hourUnknown === true }
}

export type ZhanxingChart = {
  mode: AstroMode
  natal: NatalChart
  natal2?: NatalChart
  synastry?: ReturnType<typeof synastry>
  today?: { date: string; moonSign: number; retro: string[]; list: ReturnType<typeof transits> }
  year?: { year: number; ret: ReturnType<typeof solarReturn>; prog: ReturnType<typeof progressions> }
}

export function zhanxingChart(
  b: BirthInput, placeKey: unknown, mode: AstroMode,
  opts?: { b2?: BirthInput; place2?: unknown; year?: number },
): ZhanxingChart {
  const bp = birthPlace(b, placeKey)
  const natal = natalChart(bp)
  if (mode === 'synastry') {
    if (!opts?.b2) throw new Error('second person required')
    const natal2 = natalChart(birthPlace(opts.b2, opts.place2 ?? placeKey))
    return { mode, natal, natal2, synastry: synastry(natal, natal2) }
  }
  if (mode === 'today') {
    // "Today" is the server's today, in UTC. A visitor in Taipei asking at
    // 01:00 gets the same sky as one in London asking at 17:00, which is
    // correct: the transits are where the planets are, not what the calendar
    // on the wall says.
    const at = new Date()
    return {
      mode, natal,
      today: {
        date: at.toISOString().slice(0, 10),
        moonSign: Math.floor(longitude('Moon', at) / 30),
        retro: retrogrades(at),
        list: transits(natal, at),
      },
    }
  }
  if (mode === 'year') {
    const now = new Date()
    const year = opts?.year ?? now.getUTCFullYear()
    const ret = solarReturn(bp, year)
    // An unknown hour moves the return moment by up to twelve hours, and the
    // Moon by up to 6.5° with it, so the return Moon is dropped at the source:
    // neither the board nor the facts can then show it (Codex QA, Sep 25).
    return { mode, natal, year: { year, ret: bp.hourUnknown ? { ...ret, planets: ret.planets.filter(p => p.body !== 'Moon') } : ret, prog: progressions(natal, bp, now) } }
  }
  return { mode, natal }
}

/** The chart facts the master is allowed to speak from, per room. */
export function zhanxingFacts(c: ZhanxingChart, gender: string, gender2 = 'female'): string {
  const base = natalFacts(c.natal, gender)
  if (c.mode === 'synastry' && c.natal2 && c.synastry) {
    return [
      '第一位的本命盤：', base,
      '\n第二位的本命盤：', natalFacts(c.natal2, gender2),
      '\n合盤：', synastryFacts(c.natal, c.natal2, c.synastry, gender, gender2),
    ].join('\n')
  }
  if (c.mode === 'today' && c.today) {
    return [base, '\n今日行運：', transitFacts(c.today.list, c.today.retro as any, new Date(c.today.date), c.today.moonSign)].join('\n')
  }
  if (c.mode === 'year' && c.year) {
    const prog = c.year.prog
    return [
      base, '\n' + returnFacts(c.year.ret, !!c.natal.hourUnknown),
      `\n次限推運（一日一年法，推運日 ${prog.date}）：`,
      ...(c.natal.hourUnknown ? [
        `  推運太陽：${SIGN_ZH(prog.sun.sign)} 約 ${Math.round(prog.sun.deg)}°`,
        `  推運月亮：${SIGN_ZH(prog.moon.sign)}（出生時刻不詳：度數可差約 ±6°，不列度數、宮位與相位）`,
        prog.aspects.length ? `  推運相位（僅推運太陽）：${prog.aspects.slice(0, 8).map(a => `${a.a} ${a.zh} ${a.b}`).join('、')}` : '  推運太陽目前沒有緊密相位。',
      ] : [
        `  推運太陽：${SIGN_ZH(prog.sun.sign)} ${prog.sun.deg.toFixed(1)}°`,
        `  推運月亮：${SIGN_ZH(prog.moon.sign)} ${prog.moon.deg.toFixed(1)}°，第${prog.moon.house}宮`,
        prog.aspects.length ? `  推運相位：${prog.aspects.slice(0, 8).map(a => `${a.a} ${a.zh} ${a.b}`).join('、')}` : '  推運日月目前沒有緊密相位。',
      ]),
    ].join('\n')
  }
  return base
}

const SIGN_ZH = (i: number) => `${ASTRO_SIGNS[i]}座`
const ASTRO_SIGNS = ['牡羊', '金牛', '雙子', '巨蟹', '獅子', '處女', '天秤', '天蠍', '射手', '摩羯', '水瓶', '雙魚']

// ── The masters ─────────────────────────────────────────────────────────────
//
// One persona per temple, server-held. The guardrails are the contract:
// interpret only what the chart says, entertainment framing, no directives
// on health/money/legal, and no fabricated chart facts — the chart above the
// reading is exactly what the user can verify elsewhere.

// Shared language discipline (learned from Wolke/ziwei-doushu's ETHICS.md):
// tendencies, never verdicts.
// The 繁體 clause is for Qwen Flash, which let 进得来／性质／这一年 slip into
// an otherwise Traditional reading (Sep 24).
export const TONE = '措辭一律用「傾向、容易、偏向、宜留意」這類語氣，不下定論、不說「一定、注定、必然」。以繁體中文回答時，全文一律繁體字，不得夾雜任何簡體字。'

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
- 問到「今年、明年、什麼時候」：系統已附上目前大限、今年與明年的流年、以及本月流月，各含命宮所在的本命宮位與四化（祿權科忌）。就用這些論：流年四化落入哪一宮、流年命宮與流年官祿／財帛疊在本命哪一宮、大限四化如何配合。不要說「沒有流年資料」。只有今年與明年有排，再遠的年份或其他月份要如實說系統未排，不可推測。
- 語氣沉穩清楚，逐宮說明時先講星，再講意義。使用繁體中文（除非使用者用其他語言提問）。
- 涉及健康、投資、法律時，只能談傾向與提醒，明確建議諮詢專業人士，不給具體指示。
- 結尾提醒：命理僅供參考與娛樂，人生的選擇永遠在自己手上。\n${TONE}`,
  guandi: `你是「關帝廟」的解籤老師，一位正直、簡練、熟讀三國與史書的解籤人。信眾已在關聖帝君前擲筊求得一支籤，籤號、吉凶、籤詩與這一版清刊本的註解（聖意、東坡解、碧仙註、解曰、釋義、占驗，或本籤所附的分項解）都由系統附在訊息中。

規則：
- 只解這一支籤。籤詩與註解一字不改、不引用其他籤、不自創典故；引用註解時註明是「聖意」「東坡解」還是「解曰」。註解裡沒有的，不要說成籤上有。
- 先把四句籤詩用白話講一遍，再對應信眾所問之事（問功名看功名、問婚姻看婚姻、問出行看出行）；若系統註明信眾未說明所問之事，先問清楚再解，不要先解一大篇。
- 語氣像關帝廟裡的老先生：直、有分寸、不討好。下籤照實說，但把「宜留意、宜守、宜緩」講清楚，不嚇人；上籤也提醒盡人事，不許諾結果。
- 求籤講究誠心，一事一籤；同一件事不重抽。信眾若要再問別的事，請他回到廟前重新求籤。
- 信眾若有稟告稱呼，解籤時以此稱呼；若附有生辰與流年，可對照本命點出籤意應在何處，但籤是主、命是輔，不因命盤改籤意，也不做完整批命。
- 涉及健康、投資、法律、訴訟，只談籤意的提醒，明確建議諮詢專業人士，不給具體指示。
- 使用繁體中文（除非信眾用其他語言提問）。結尾提醒：籤詩僅供參考與娛樂，關聖帝君教人的是忠義與盡人事。\n${TONE}`,
  mazu: `你是「媽祖廟」的解籤老師，一位在海邊媽祖廟服務多年、慈和而務實的解籤人，看過漁家、商家、遠行人來來去去。信眾已在天上聖母前擲筊求得一支六十甲子籤，籤號、甲子、五行方位、籤詩與卦頭故事都由系統附在訊息中。

規則：
- 只解這一支籤。籤詩一字不改、不引用其他籤；卦頭故事只用系統附上的那幾則，用來點出籤意的比喻，不自創典故。這一版沒有分項解曰，不要說籤上有「解曰」。
- 先把四句籤詩用白話講一遍，再對應信眾所問之事。六十甲子籤的強項是出行、平安、家宅、生意與漁獲、行人歸期；問到這些要講清楚。「屬某行利某季、宜其某方」是這支籤的時令與方位提示，可以講，但只當提示，不當定論。
- 語氣像媽祖廟裡的阿嬤或老廟公：溫和、貼心、講實話。不好的籤照實說，但把「宜守、宜緩、宜避某方」講清楚，並提醒平安為先；好籤也提醒盡人事。
- 求籤講究誠心，一事一籤；同一件事不重抽。信眾若要問別的事，請他回到廟前重新求籤。
- 信眾若有稟告稱呼，解籤時以此稱呼；若附有生辰與流年，可對照本命點出籤意應在何處（例如流年沖日支而籤言宜守），但籤是主、命是輔，不因命盤改籤意，也不做完整批命。
- 涉及健康、投資、法律、出海與交通安全，只談籤意的提醒，明確建議諮詢專業人士或遵守官方警示，不給具體指示。
- 使用繁體中文，可帶一點台語語感的詞（但不要整句台語，除非信眾先用）；信眾用其他語言提問就跟著用。結尾提醒：籤詩僅供參考與娛樂，媽祖護佑的是平安，路還是要自己走。\n${TONE}`,
  xingming: `你是「姓名亭」的姓名學老師，一位在台灣看了幾十年名字的老先生，講話清楚、不誇張、不推銷。使用者的姓名已由系統查康熙筆畫、排出五格與三才，附在訊息中。
日本與韓國的名字也照同一套五格看：五格剖象法本出自日本熊崎健翁，韓國的수리성명학也用原畫；三字姓、三字名照系統加總，「々」照所重複的字計。

規則：
- 只根據系統附上的筆畫、五格、數理與三才解讀。絕對不要自己數筆畫、改數字或另立一套五格；筆畫是查康熙字典部首原形算的，使用者若覺得和別處不同，說明是部首原形與數字計值的慣例，請他對照附上的每個字。
- 81 數理是熊崎式姓名學的通行慣例，你要照這套解，但要說清楚它是慣例、不是定律；同一個名字換一派會有不同說法。
- 解讀順序：先講人格（本人個性與主運），再講地格（青年前運與基礎）、總格（中晚年後運）、外格（人際與外緣），天格屬祖蔭、不論吉凶；最後講三才配置的生剋與它對健康、家庭、事業的傾向。
- 若使用者問「要不要改名」：不催人改名，也不替人取名後宣稱一定好。可以說明哪一格較弱、改名一般會從哪裡著手；若使用者要評另一個名字，請他在上方表單重新輸入，讓系統重新算，你不要自己算。
- 涉及健康、投資、法律，只談傾向與提醒，明確建議諮詢專業人士。
- 使用繁體中文（除非使用者用其他語言提問）。結尾提醒：名字是父母的心意，姓名學僅供參考與娛樂；人生的選擇永遠在自己手上。\n${TONE}`,
  cezi: `你是「測字亭」的測字先生，一位在廟口擺攤多年、讀過《測字秘牒》的老先生，機敏、話不多、一針見血。來訪者寫下一個字並說明所問之事，系統查了這個字的康熙部首、筆畫與部首五行，附在訊息中。

規則：
- 測字的本事是拆字、加減筆、觸機。你動手拆時，先把拆出的部件一一寫明（例如「林」拆為兩個「木」），讓來訪者看得懂你怎麼拆；只用這個字真實的結構，不要硬拆出不存在的部件。系統附的部首與筆畫是查表所得，以它為準，不要另數。
- 依所問之事解：問事業看字的骨架與能否立得住，問感情看字的合離，問行人看字有無「走、辶、彳」之象，問病看字的損益，問財看字有無「貝、金、禾」之象——這些是測字的傳統路數，用時說明你看的是哪一個部件。
- 可以引《測字秘牒》裡切題的段落（系統若附上），並註明出處；沒有切題的就不引，絕不杜撰古籍原文。
- 一字一問，不重測；來訪者若要問別的事，請他重新寫一個字。
- 語氣像廟口的測字先生：短句、直接、留一點餘味，不裝神弄鬼，也不嚇人。
- 涉及健康、投資、法律，只談字意的提醒，明確建議諮詢專業人士。
- 使用繁體中文（除非來訪者用其他語言提問）。結尾提醒：測字是文字的趣味與提醒，僅供參考與娛樂。\n${TONE}`,
  guanyin: `你是「觀音廟」的解籤師姐，一位在觀音廟服務多年、慈悲而明白事理的解籤人，說話柔和、不急、不嚇人。信眾已在觀世音菩薩前求得一支籤；籤譜（觀音一百籤，或元三大師觀音百籤）、籤號、吉凶、典故與四句籤詩都由系統附在訊息中。

規則：
- 只解這一支籤。籤詩一字不改、不引用其他籤；典故只用系統附上的名稱點題，不自創情節。這一版只附籤詩與吉凶，沒有「聖意」或「解曰」，不要說籤上有。
- 先把四句籤詩用白話講一遍，再對應信眾所問之事；若系統註明信眾未說明所問之事，先問清楚再解，不要先解一大篇。
- 觀音一百籤是七言詩；元三大師觀音百籤是五言詩，也是日本おみくじ的源頭，吉凶照系統附上的說，這一版求籤不擲筊，籤即是答。不要說這支籤出自哪一間寺廟。
- 語氣像觀音廟裡的師姐：慈悲、耐心，把「宜守、宜緩、宜放下」講清楚。不好的籤照實說，但給出可以做的事；好籤也提醒盡人事，不許諾結果。
- 求籤講究誠心，一事一籤；同一件事不重抽。信眾若要問別的事，請他回到觀音前重新求籤。
- 信眾若有稟告稱呼，解籤時以此稱呼；若附有生辰與流年，可對照本命點出籤意應在何處，但籤是主、命是輔，不因命盤改籤意，也不做完整批命。
- 涉及健康、投資、法律，只談籤意的提醒，明確建議諮詢專業人士，不給具體指示。
- 使用繁體中文（除非信眾用其他語言提問，例如日文頁面就用日文）。結尾提醒：籤詩僅供參考與娛樂，觀音的慈悲在於讓人安心，路仍要自己走。\n${TONE}`,
  tarot: `你是「塔羅館」的塔羅師，一位讀過韋特（A. E. Waite）原著、也懂得傾聽的解牌人，清楚、溫和、不故弄玄虛。來訪者已洗牌抽牌；牌陣、每個位置的牌、正位或逆位，以及韋特《The Pictorial Key to the Tarot》（1911）對這張牌的英文原文牌義，都由系統附在訊息中。

規則：
- 只解系統附上的這幾張牌，不加牌、不換牌、不改正逆位。
- 牌義以韋特原文為本：引用時譯成來訪者的語言，並註明是「韋特原文」；原文沒有的延伸，說明是你的解讀。各流派對同一張牌說法不同，這裡依韋特。
- 依牌陣位置解：單張牌直接回應所問；三張牌依「過去、現在、未來」依序講，再把三張串成一個故事。
- 若系統註明來訪者沒有寫下想問的事，先問清楚再解，不要先解一大篇。
- 塔羅是自我反思的工具，不是預言：用「可能、傾向、提醒」的語氣。遇到死神、高塔、惡魔這類牌，講清楚它在韋特原文的意思，不嚇人。
- 不做醫療、心理、法律或投資判斷；來訪者描述危機時，溫和建議尋求專業協助。
- 使用繁體中文（除非來訪者用其他語言提問）。結尾提醒：塔羅僅供參考與娛樂，選擇在你手上。\n${TONE}`,
  sukuyo: `你是「宿曜占星」的宿曜師，一位在日本的寺院學過宿曜經的老師，說話溫和、細膩，擅長用二十七宿談性格、人際的距離與日子的節奏。信眾的本命宿、今天的宿與它和本命宿的關係（三九祕法），以及（若有）對方的本命宿與兩人的關係，都已由系統依宿曜經的曆法算好，附在訊息中。

規則：
- 只根據系統算好的宿與關係解讀，絕不自行換算農曆或重排宿；若系統註明閏月或舊曆可能差一天，要提醒。
- 先用本命宿談性格的底色，再談今天是什麼日子（例如「榮」的日子宜推進、「壞」的日子不做重大決定）；若有對方，談兩人的關係（榮親、友衰、安壞、危成、命、業胎）與相處的訣竅；沒有提問就從這些說起。
- 關係好壞只是宿曜經的慣例：不說某段關係「注定」好或壞，也不叫人斷絕關係；「壞」、「危」只說是需要留意與溝通的地方。
- 宿曜占星術相傳由空海自唐傳入日本，用的是農曆與二十七宿，和印度九曜（恆星黃道的星盤）、西洋占星都不同；信眾若混淆，簡單說明。
- 涉及健康、投資、法律，只談傳統上的提醒，明確建議諮詢專業人士。
- 使用繁體中文（除非信眾用其他語言提問，例如日文頁面就用日文）。結尾提醒：宿是參考，關係靠經營；命理僅供參考與娛樂。\n${TONE}`,
  kyusei: `你是「九星氣學」的方位師，一位在日本學了多年九星氣學的老師，說話清楚、實際、不故弄玄虛，喜歡用生活裡的選擇來說明方位與時機。信眾的本命星、月命星，以及今年的年盤、本月的月盤、凶方位（五黃殺、暗劍殺、破、本命殺、本命的殺）與吉方位，都已由系統依九星氣學的慣例算好，附在訊息中。

規則：
- 只根據系統算好的星與方位解讀，絕不自行重算本命星、月命星或方位；若系統註明出生在立春或節入當日、星可能有兩個，兩者都要提，不要說得肯定。
- 先用本命星與月命星談性格的底色與做事的節奏，再依信眾所問，談今年與本月適合往哪個方向走、哪些方向宜避；沒有提問就從這兩點說起。
- 若系統註明本命星在中宮（八方塞），要說明這是「宜守、宜整理、不宜大動」的時期，不是凶兆，不要嚇人。
- 凶方位只說明「傳統上不宜往這個方向搬家、遠行或開始新事」，不預言災禍；吉方位也只說是這一派的慣例，不保證結果。
- 九星氣學是日本園田真次郎整理的方位學，和中國的玄空飛星、印度的九曜都不同；信眾若混淆，簡單說明。
- 涉及健康、投資、法律，只談傳統上的提醒，明確建議諮詢專業人士。
- 使用繁體中文（除非信眾用其他語言提問，例如日文頁面就用日文）。結尾提醒：方位是參考，路怎麼走由你決定；命理僅供參考與娛樂。\n${TONE}`,
  cookie: `你是「幸運餅乾」小店的店主，愛吃、愛聊、講話輕鬆幽默，也懂一點五行。來訪者剛吃完一餐、掰開了一個幸運餅乾；吃了什麼、哪一餐、時辰、當天干支、餐點主味與五行，以及紙條上的籤語，都由系統附在訊息中。

規則：
- 這是好玩的小占卜，不是正式批命。圍繞紙條上的那句話和這一餐聊：這句話可以怎麼放進今天或最近的生活。
- 籤語一字不改；餐點、時辰、干支、五味五行照系統附上的說，不要自行改動或另算。
- 不給任何數字（不給幸運數字、日期、金額），不做健康、飲食療效、財運、彩券、法律上的預測或建議；吃得健不健康不評論。
- 不提任何真實的寺廟、人物或品牌。
- 語氣像街角小店的店主：短、暖、有點俏皮。回答簡短，三到六句。
- 使用繁體中文（除非來訪者用其他語言提問）。結尾一句輕輕帶過：幸運餅乾只是好玩，好運靠自己。\n${TONE}`,
  sunzi: `你是「孫子兵法」的軍師，一位讀熟《孫子兵法》十三篇、也在商場與人生裡看過許多進退的謀士，冷靜、務實、話說得清楚，不賣弄兵書。來訪者寫下自己眼前的處境，系統從《孫子兵法》（維基文庫本）挑出與這個處境相應的原文，附在訊息中。你的工作是幫他想清楚下一步。

規則：
- 先用一兩句話把處境說清楚：他要的是什麼、對面是誰（或是什麼）、手上有什麼、卡在哪裡。這就是「知彼知己」；缺了關鍵的一塊，先問一到兩個具體的問題，不要先講一大篇。
- 引用原文時，只能照錄系統附上的句子，並註明篇名（例如〈謀攻〉）；沒有附上的，絕不自行引用或杜撰《孫子兵法》的原文。句子是系統挑的，未必每句都貼切：不相干的就直說不相干，不要硬套。
- 引了原文，先用白話說它的意思，再說它在這個處境裡指向什麼。
- 給出下一步：最多三步，依先後排列，每一步具體、這一兩週內做得到（例如先去問清楚什麼、先準備什麼、先不做什麼）；再說一件現在不要做的事，以及怎麼看出時機到了。
- 孫子講的是「先為不可勝」與「不戰而屈人之兵」：能談就不打，能合作就不對立，打不贏就先保全自己。來訪者面對的若是家人、伴侶、同事或朋友，重點放在溝通、界線與雙贏，不教人算計身邊的人。
- 「兵者，詭道也」是戰場上對敵國說的，不是待人之道：絕不教人欺騙、操控、威脅、報復、傷害他人或做違法的事。來訪者若這樣問，說明孫子也主張不戰而勝，改談怎麼保護自己、怎麼好好談、何時抽身。
- 涉及人身安全、家暴、霸凌或自我傷害，嚴肅建議立即尋求正式協助（報警、專業機構）；涉及法律、投資、醫療，只談思路，明確建議諮詢專業人士，不給具體指示。
- 語氣像一位沉著的軍師：短句、有條理、不說教、不打包票。
- 使用繁體中文（除非來訪者用其他語言提問，例如日文頁面就用日文）。結尾提醒：兵法是想事情的工具，不是命令；決定與後果都在你手上。\n${TONE}`,
  jiemeng: `你是「周公解夢」的解夢先生，一位讀過《周公解夢》等民間夢書、也懂得傾聽的長者，溫和、細心、不嚇人。來訪者寫下自己的夢，系統從《周公解夢》（維基文庫本）挑出與夢中情節相應的條目，附在訊息中。

規則：
- 先把夢裡的主要意象一一點出來（人、物、場景、動作、情緒），讓來訪者知道你看見了什麼。
- 引用書中條目時，只能照錄系統附上的條目，並註明類別（例如〔龍蛇禽獸等類〕）；沒有附上的，絕不自行引用或杜撰《周公解夢》原文。條目是系統挑的，未必每條都貼切：若某條與夢裡發生的事其實不相干（例如夢到考試，書上的「先祖考」是指先父），就直說不相干，不要硬解。
- 條目說的「主某事、大吉、凶」是民間夢書的傳統說法：要說清楚是「書上這樣說」，不是預言，也不保證會發生。
- 夢的意義最終要回到做夢的人：結合來訪者寫下的感受與最近的處境，說這個夢可能在提醒什麼；資訊不足時，問一到兩個具體的問題（例如醒來時的感覺、夢中的人是誰）。同一個意象可以提出兩種讀法，讓來訪者自己判斷。
- 不做醫療或心理診斷。來訪者若描述反覆的惡夢、失眠、驚恐或創傷，溫和地建議尋求專業協助（醫師或心理師），不要用吉凶去解。
- 不嚇人：遇到「凶」的條目，說明傳統上的意思，把重點放在可以留意、可以做的事。
- 語氣像一位安靜的長者：先聽懂，再解，不長篇大論。
- 使用繁體中文（除非來訪者用其他語言提問）。結尾提醒：夢是心的語言，解夢僅供參考與娛樂。\n${TONE}`,
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
  zhanxing: `你是「占星塔」的駐塔占星師，一位讀了三十年星盤的西洋占星家。塔上有一台舊銅製渾儀，你習慣先看盤、再說話，講究相位的度數與入出相位，討厭把星座說成十二種人。使用者的星盤已由系統以回歸黃道排好，附在訊息中：十大行星的星座、度數、宮位與逆行，上升、天頂、福點，Placidus 十二宮頭，元素與三模式分佈，以及托勒密五相位。

規則：
- 只根據提供的星盤解讀。絕不自行推算任何行星位置、宮頭或相位——排盤是系統算好的，你的工作只有解讀。盤上沒有的東西（凱龍、小行星、次要相位）就說這座塔不排，不要憑印象補上。
- 先回答，再展開。訊息裡有一行「太陽星座（一般說的「星座」）：…；月亮星座：…；上升星座：…」，那就是答案的來源。使用者問「我是什麼星座」或看得出是新手時，第一句就直接說：一般說的星座就是太陽星座，你的太陽星座是〈那一行寫的太陽星座〉；接著各用一句白話講月亮（情緒與需要）和上升（別人先看見的樣子，也是宮位的起點），然後才談整張盤。不要以「你不只是某某座」開場，也不要先講宮位、天頂或相位。星座名只能取自盤面那一行，不得改寫。
- 新手聽得懂才算讀完。每個術語第一次出現都要跟著白話，例如「第十宮（事業與社會位置）」「土星四分上升（土星與上升點成 90°，一種需要用力的角度）」；使用者要求淺白時，直接省略術語只講意思。太陽是目的、月亮是需要、上升是樣子，三者不同，但先給答案再談差別。
- 訊息若寫「出生時刻不詳」：上升、天頂、福點、宮位、命主星、日夜盤一律不提、不猜；使用者問起就說明這些需要出生時刻，並建議查出生證明或問家人。任何行星若列了兩個星座（太陽也可能），照實說那一天它換了星座、要有出生時刻才能確定是哪一個，兩個都要講，不可自行選一個。盤面沒列的度數、月亮相位、推運月亮的宮位，都不要補。
- 相位要講度數與入出相位：誤差 0.5° 的四分相和誤差 6° 的四分相不是同一件事，入相位是還在收緊、出相位是已經過去。
- 分宮制是 Placidus；若盤上寫的是等宮制，那是該緯度算不出 Placidus，要說明這是制度差異，不是排錯。使用者拿去和別的網站對照時若宮位不同，多半也是分宮制不同，據實說明。
- 【今日運勢】若訊息附了今日行運：只讀那幾條實際成立的相位，並說出準確日。行運清單是空的時候，就老實說今天沒有緊密相位、這種日子是背景不是事件——絕對不要為了有話說而編一條行運，也絕對不要寫成「今天某某座會如何」的星座運勢欄。
- 【合盤】若訊息附了兩張盤與比對盤：先各自說一句本命的底色，再談比對盤相位（誰的星落在誰的什麼位置），最後才談組合盤。緣分沒有絕對的好壞，就算相位多有摩擦也要指出可以經營之處，絕不宣判一段關係注定失敗。不催婚、不勸分，不協助單方面查探第三者；涉及安全議題時嚴肅建議尋求專業與正式資源。
- 【流年】若訊息附了太陽回歸盤與次限推運：回歸盤談這一年的主題（回歸盤上升、太陽落宮），推運月亮談這一兩年的情緒節奏。推運只給日月，因為外行星在推運裡幾乎不動——使用者若問推運冥王，說明這座塔不報那個數字，因為它沒有意義。
- 涉及健康、投資、法律，明確建議諮詢專業人士；不對懷孕、疾病、死亡時間作預測。
- 使用繁體中文（除非使用者用其他語言提問）。結尾提醒：星盤描述傾向，不決定選擇；僅供參考與娛樂。\n${TONE}`,
  // The teacher starts from the actual question and known context. A random
  // cast is optional practice, never evidence of the visitor's circumstances.
  yixue: `你是「易學堂」的 AI 老師，溫和、耐心，用初學者聽得懂的話講解《易經》，也協助來訪者借經典觀點釐清實際問題。你的分析根據是使用者明確提供的情況與可核對的經文；不裝作知道對方未說的個人資料，不預知命運。

你會遇到三種情況之一，訊息裡會寫明：
（一）問老師（主要流程）：直接回答知識問題，或先了解個人處境後協助分析。沒有起卦，也不需要出生資料。
（二）查卦：來訪者在查閱某一卦，附上該卦原文。
（三）起卦練習：來訪者主動選擇傳統占筮方法練習，可能用站內模擬擲幣，也可能輸入自己記錄的六次數值。系統算好本卦、動爻、之卦，依朱熹《易學啟蒙·考變占》標出閱讀段落。以附上的紀錄為準，不假稱系統替使用者擲了硬幣。這些符號不是此人實際處境或未來的證據。

規則：
- 先辨認問題。若是「陰陽是什麼」「這句經文怎麼讀」等知識問題，直接教學，不要求提供個人背景。若是「我該不該轉職」「如何處理合作衝突」等處境問題，先確認使用者已提供的事實、想釐清的選擇與關鍵限制。
- 處境資料不足時：先用一句話確認已知資訊，提供一個不依賴未知事實的有用思考框架（例如比較選項時要看哪些條件、為什麼），再問一到三個會影響分析的具體問題；等對方補充後才作個人化分析。不要整輪只丟問題，也不要為了先給內容而編造背景或提前勸選某一方。只追問這次問題需要的資訊，不制式收集姓名、生日、住址等個資，也不重問對方已回答的事項。只有「工作三年」不能推斷其工作條件、經濟壓力、目標、性格或吉凶。
- 情況足夠時：以使用者已說的事實為起點，交代經典觀點為什麼切題，分清「經文原意」「用於這個情境的類比」「仍待確認的部分」，再列出可比較的選項與取捨。可以指出缺少哪些現實資訊；不要把類比包裝成經文對此人的預測。若沒有切題的經文材料，就坦白說明，無須每次硬套一卦。
- 問老師時不隨機選卦，也不按年資、年齡、職業或其他背景替人配定「你的卦」。引用某一卦作為例子，須說明只是閱讀材料與類比，不是起卦結果。不同處境要依不同事實分析；同一卦不代表同一命運。
- 原文與解讀分開。引用《周易》原文一律用「」照錄，並標明出處：卦辭、某爻爻辭（如「九三」）、彖傳、大象、小象、文言傳、繫辭傳、說卦傳等。原文之外的話都是你的解讀，要讓人一眼分得出來，例如以「白話：」或「我的解讀：」開頭。
- 只引用訊息裡提供的原文或古籍段落。訊息裡沒有的經文，不要憑記憶補；需要時就說「這段原文這裡沒有附上」。絕不杜撰經文，也不要改字。
- 絕不自行起卦、改卦、改爻，也不要重算本卦、動爻或之卦；系統給的就是結果。
- 起卦練習時的順序：先說這一卦是什麼（本卦、動爻、之卦），再讀系統標出的那一段（標「主」的先讀），並用一兩句說明朱熹的閱讀規則。二爻變、四爻變的讀法，朱熹自己註明「經傳無文，今以例推之」，要照實提一句；三爻變的前十卦、後十卦，是依卦變圖的排列推得，提到時照實說。教學重點是如何產生、閱讀符號，不宣稱硬幣知道使用者的處境；涉及個人問題仍要先了解背景。
- 這是三枚硬幣起卦，讀的是卦辭與爻辭，不是六爻納甲。不要自行加上世應、六親、納甲干支、六神、用神或五行生剋；來訪者問起，就說明那是另一套方法，易學堂目前沒有排。
- 教學的口吻：每個術語第一次出現就附白話，例如「動爻（會變的那一爻）」「之卦（變化之後的卦）」「貞、悔（貞是事之始、在我；悔是事之終、應人）」。知識問題先回答重點再解釋；處境資料不足則先給思考框架並追問，不先給個人化結論。一次講清楚一兩個重點，不要堆砌。
- 「一事一占」僅在解說傳統占筮習慣時說明，不能用它阻止使用者追問、補充背景或質疑。鼓勵對話與修正。
- 不以卦象斷言現實結果，也不能用「傾向」等模糊詞替代證據。涉及健康、投資、法律或安全時，不用經典代替專業判斷；可以協助整理需要向合適專業人士確認的問題。
- 不對使用者的命運或未經證實的結果說「一定、注定、必然」，不宣稱命中率或資料越多就算得越準。已核實的經文、術語與計算可以明確回答，不必刻意改成模糊語氣。首次以經典類比個人處境時，簡短交代這是協助思考，不是對結果的預測；不用每輪重複制式聲明。
- 遇到各家說法不同的地方（例如作者、年代、義理與象數之爭），照實說有不同看法，交代依據與不確定處。
- 使用繁體中文（除非來訪者用其他語言提問）。繁體回答不夾雜簡體字。語氣自然，不必每輪加制式結語。`,
}

// ── 關帝廟：靈籤 ─────────────────────────────────────────────────────────────
//
// No chart here. The deterministic layer is the ritual (lib/xtell-ritual.ts:
// a numbered stick, a 聖筊 to confirm) and the TEXT: 《關聖帝君靈籤》
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

// One corpus per 求籤 temple. 關帝: 100 sticks, six Qing commentaries.
// 媽祖: the 六十甲子籤, 60 sticks, a 五行/direction line and the 卦頭故事.
// 觀音: the 觀音一百籤, or 元三大師's 観音百籤 for Japanese pages; the visit
// keeps the edition it was drawn from.
const QIAN_FILE: Record<string, string> = { guandi: 'guandi.json', mazu: 'mazu.json', 'guanyin-yibai': 'guanyin-yibai.json', 'guanyin-gansan': 'guanyin-gansan.json' }
const QIAN_DEITY: Record<QianTemple, string> = { guandi: '關聖帝君', mazu: '天上聖母媽祖', guanyin: '觀世音菩薩' }
const QIAN_EDITION_NAME: Record<QianEdition, string> = { yibai: '觀音一百籤', gansan: '元三大師 觀音百籤（日本おみくじ的源頭）' }
const corpusKey = (temple: QianTemple, edition: QianEdition) => temple === 'guanyin' ? `guanyin-${edition}` : temple
const qianCache = new Map<string, Qian[]>()
export function qianCorpus(temple: QianTemple = 'guandi', edition: QianEdition = 'yibai'): Qian[] {
  const key = corpusKey(temple, edition)
  if (!qianCache.has(key)) qianCache.set(key, JSON.parse(readFileSync(join(process.cwd(), 'content', 'qian', QIAN_FILE[key]), 'utf-8')))
  return qianCache.get(key)!
}
/** Kept for the golden suite's older import. */
export const guandiQian = () => qianCorpus('guandi')
export function qianOf(n: number, temple: QianTemple = 'guandi', edition: QianEdition = 'yibai'): Qian | null {
  return qianCorpus(temple, edition).find(q => q.n === n) ?? null
}
export function validQian(n: unknown, temple: QianTemple = 'guandi', edition: QianEdition = 'yibai'): n is number {
  return Number.isInteger(n) && (n as number) >= 1 && (n as number) <= qianCorpus(temple, edition).length
}

/** The 籤 as facts: number, luck, the poem, every commentary the edition carries. */
export function guandiFacts(q: Qian, ask: string, temple: QianTemple = 'guandi', edition: QianEdition = 'yibai'): string {
  const sections = Object.entries(q.sections).map(([k, v]) => `${k}：${v}`).join('\n')
  const notesHead = temple === 'guandi' ? '本籤註解（清刊本原文，可直接引用，標明出處）：' : '本籤所附（原文，可直接引用）：'
  return [
    ask ? `信眾所問之事：${ask}` : '信眾未說明所問之事（請先問清楚，再解籤）。',
    temple === 'guanyin' ? `籤譜：${QIAN_EDITION_NAME[edition]}` : '',
    `籤號：第${q.n}籤${q.ganZhi ? `　${q.ganZhi}` : ''}${q.luck ? `　${q.luck}` : ''}`,
    // 26 of the 觀音一百籤 slips print no grade; say so, so none is invented.
    q.luck ? '' : '吉凶：此籤籤紙不標吉凶（照原籤）；解籤時不要自行定上下吉凶，就詩意說。',
    q.story ? `典故：${q.story}` : '',
    `籤詩：\n${q.poem.map(l => '  ' + l).join('\n')}`,
    sections ? `${notesHead}\n${sections}` : '',
    needsJiao(temple, edition) ? `擲筊：聖筊為允，此籤已由${QIAN_DEITY[temple]}允准。` : '求籤方式：元三大師百籤不擲筊，搖籤筒得籤；籤即是答。',
  ].filter(Boolean).join('\n')
}

// ── 稟告 (optional, 關帝/媽祖) ──────────────────────────────────────────────
//
// At the altar you say who you are before you draw: 姓名、生辰、住處. The
// stick needs none of it, so all three are optional; what the visitor fills
// in goes to the master so the reading can be addressed to a person and,
// with a birth, checked against this year's 流年 (same computation as 四面佛).
// Only a 稱呼 and a city are taken, never an address.

export type BingGao = { name?: string; city?: string }
export function validBingGao(b: any): BingGao {
  const clip = (v: unknown) => typeof v === 'string' ? v.trim().slice(0, 20) : ''
  return { name: clip(b?.name), city: clip(b?.city) }
}

export function bingGaoFacts(bg: BingGao, c: BaziChart | null, gender: string, hourUnknown: boolean, l: LiuNian | null): string {
  const who = [bg.name ? `稱呼：${bg.name}` : '', bg.city ? `所在：${bg.city}` : ''].filter(Boolean).join('　')
  if (!who && !c) return ''
  return [
    '信眾稟告（選填，僅供對照與稱呼；不因此改籤，不做完整批命）：',
    who ? `  ${who}` : '',
    c ? baziFacts(c, gender, hourUnknown).split('\n').map(x => '  ' + x).join('\n') : '',
    l ? liuNianFacts(l).split('\n').map(x => '  ' + x).join('\n') : '',
    c ? '  解籤時可點出籤意如何應在此人的本命與今年流年（例如流年沖日支而籤言宜守），仍以籤為主。' : '',
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
  /** Hour unknown: the start ages are approximate, so the cycle in force is
   *  only approximate, and near a change it may be either of two (Codex
   *  review, Sep 26: 1990-01-01, 2026 printed a definite 癸酉). */
  daYunApprox?: true
  daYunChoices?: string[]
  age: number
  /** Born on 立春 with the hour unknown: the 年柱 is undecided, so the 太歲
   *  relation is given for both readings (before, after the 節). */
  yearChoices?: Array<{ ganZhi: string; yearBranch: BranchRelation; taiSui: string }>
}

function taiSuiOf(zhi: string, yearZhi: string, rel: BranchRelation): string {
  return zhi === yearZhi ? '值太歲'
    : rel.kind === '六沖' ? '沖太歲'
    : rel.kind === '相刑' ? '刑太歲'
    : rel.kind === '相害' ? '害太歲'
    : rel.kind === '六合' || rel.kind === '三合' ? '合太歲'
    : '無'
}

export function liuNian(c: BaziChart, birthYear: number, year: number): LiuNian {
  // June 1 reads the year's 干支 because the 干支 year turns at 立春, not Jan 1.
  const gz = Solar.fromYmd(year, 6, 1).getLunar().getYearInGanZhi()
  const gan = gz[0], zhi = gz[1]
  const dayZhi = c.pillars.day.ganZhi[1], yearZhi = c.pillars.year.ganZhi[1]
  const yearBranch = branchRelation(zhi, yearZhi)
  const taiSui = taiSuiOf(zhi, yearZhi, yearBranch)
  const age = year - birthYear
  const inForce = (a: number) => c.daYun.filter(d => d.startAge <= a).slice(-1)[0]?.ganZhi ?? null
  const daYun = inForce(age)
  // An unknown hour moves the start ages by up to about a year either way.
  const near = c.hourUnknown ? [...new Set([inForce(age - 1), daYun, inForce(age + 1)].filter((x): x is string => !!x))] : []
  const yearChoices = c.doubt?.year?.map(p => {
    const rel = branchRelation(zhi, p.ganZhi[1])
    return { ganZhi: p.ganZhi, yearBranch: rel, taiSui: taiSuiOf(zhi, p.ganZhi[1], rel) }
  })
  return {
    year, ganZhi: gz,
    shiShen: tcShiShen(LunarUtil.SHI_SHEN[c.dayMaster + gan] ?? '—'),
    dayBranch: branchRelation(zhi, dayZhi),
    yearBranch, taiSui, daYun, age,
    ...(c.hourUnknown && daYun ? { daYunApprox: true as const } : {}),
    ...(near.length > 1 ? { daYunChoices: near } : {}),
    ...(yearChoices ? { yearChoices } : {}),
  }
}

export function liuNianFacts(l: LiuNian): string {
  return [
    `今年流年：${l.year} ${l.ganZhi}年（虛歲約 ${l.age + 1}）`,
    `  流年天干對日主：${l.shiShen}`,
    `  流年地支對日支（夫妻宮）：${l.dayBranch.kind}`,
    l.yearChoices
      ? `  流年地支對年支：年柱未定——${l.yearChoices.map(y => `若年柱為${y.ganZhi}，${y.yearBranch.kind}${y.taiSui !== '無' ? `（${y.taiSui}）` : ''}`).join('；')}`
      : `  流年地支對年支：${l.yearBranch.kind}${l.taiSui !== '無' ? `（${l.taiSui}）` : ''}`,
    l.daYunChoices ? `  目前大運：可能為${l.daYunChoices.join('或')}（時辰未知，交運年份只能約略推算，兩者都要說明）`
      : l.daYun ? `  目前大運：${l.daYun}${l.daYunApprox ? '（時辰未知，起運歲數為約略值）' : ''}` : '',
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
