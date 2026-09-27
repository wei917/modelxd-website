// lib/xtell-chenggu.ts — 稱骨（八字幾兩幾錢）: the folk method that weighs a
// birth by adding four table weights: the lunar year's 干支, the lunar
// month, the lunar day and the 時辰.
//
// Client-safe and pure. lib/xtell.ts chengGu() turns a birth into a lunar
// date with lunar-typescript; weigh() does the rest in whole 錢 (10 錢 =
// 1 兩), so there is no floating point and no model ever adds anything up.
// The 八字 card lays out what weigh() returned, and the master is handed the
// same numbers as facts (lib/xtell.ts chengguFacts).
//
// ── Table v1 ─────────────────────────────────────────────────────────────────
// Published 稱骨 tables agree on 112 of the 114 entries. v1 is the table
// printed by fatekeep.com/blog/2401 (TW), 易安居 m.zhouyi.cc/bazi/sm/49663.html
// and chenggusuanming.zhunsuan.org/calculation.html, and used by the
// tt-qimen repo (weights.ts, which cites 百度百科). All four were compared
// with it entry by entry on 2026-09-27 and match all 114; 356.com.tw matches
// too, apart from two apparent typos in its year list (己卯, 己丑). The
// two entries published tables disagree on:
//   癸亥 year     v1 7 錢; 6 錢 in fortune-assistant (chenggu.py),
//                 hankwu61/lunarcalendar (tools/chenggu.py), suanzhun.net
//                 and yourchineseastrology.com/hk
//   lunar day 20  v1 1兩5錢; 1兩 in hankwu61/lunarcalendar and suanzhun.net
// A result that uses either entry carries the other value (`variants`), so a
// visitor comparing with another site can see why the totals differ.
// Changing any weight means a new CHENGGU_VERSION; every result carries its
// version, and a reopened visit is recomputed (REFRESHED in the client).
//
// ── The calendar rules (the card and the facts state them) ──────────────────
// year   the lunar year's 干支, changing at 正月初一. Not at 立春, which is
//        where the 八字 年柱 changes: 2000-02-04 23:00 is 己卯 here and 庚辰
//        on the 八字 board above it.
// month  the lunar calendar month, not the 節 month of the 月柱. A leap
//        month counts as the month it repeats (閏二月 weighs as 二月); some
//        schools count its second half as the next month, v1 does not.
// day    the lunar date of the calendar date entered. The date changes at
//        00:00, so 23:00–23:59 is the 子時 of that same date, as on the 八字
//        board (lunar-typescript's default). The school that turns the day
//        at 23:00 is given as a second total (`lateZi`), never silently.
// hour   the 時辰 of the clock time entered (子 23:00–00:59, 丑 01:00–02:59
//        …), with no true-solar-time correction: 八字 asks for no place.
// An unknown hour has no total: the year + month + day part, and every
// total the twelve 時辰 could make, each with its 時辰. That is at most six
// separate totals, not a range: 1990-01-01 can weigh 32, 33, 34, 35, 36 or
// 42 錢 and nothing in between. Men and women use the same table; the
// traditional verses differ by sex and by edition, and none is shown (no
// edition has been verified, see chengguFacts).

export const CHENGGU_VERSION = 'v1'
/** The table's name in the master's facts. */
export const CHENGGU_TABLE = '通行本 v1'

export const ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'] as const
export type Zhi = (typeof ZHI)[number]

/** Year weights in 錢, by the lunar year's 干支, in 甲子 order. */
export const YEAR_QIAN: Readonly<Record<string, number>> = Object.freeze({
  甲子: 12, 乙丑: 9, 丙寅: 6, 丁卯: 7, 戊辰: 12, 己巳: 5, 庚午: 9, 辛未: 8, 壬申: 7, 癸酉: 8,
  甲戌: 15, 乙亥: 9, 丙子: 16, 丁丑: 8, 戊寅: 8, 己卯: 19, 庚辰: 12, 辛巳: 6, 壬午: 8, 癸未: 7,
  甲申: 5, 乙酉: 15, 丙戌: 6, 丁亥: 16, 戊子: 15, 己丑: 7, 庚寅: 9, 辛卯: 12, 壬辰: 10, 癸巳: 7,
  甲午: 15, 乙未: 6, 丙申: 5, 丁酉: 14, 戊戌: 14, 己亥: 9, 庚子: 7, 辛丑: 7, 壬寅: 9, 癸卯: 12,
  甲辰: 8, 乙巳: 7, 丙午: 13, 丁未: 5, 戊申: 14, 己酉: 5, 庚戌: 9, 辛亥: 17, 壬子: 5, 癸丑: 7,
  甲寅: 12, 乙卯: 8, 丙辰: 8, 丁巳: 6, 戊午: 19, 己未: 6, 庚申: 8, 辛酉: 16, 壬戌: 10, 癸亥: 7,
})
/** Month weights in 錢, 正月 … 臘月. */
export const MONTH_QIAN: readonly number[] = Object.freeze([6, 7, 18, 9, 5, 16, 9, 15, 18, 8, 9, 5])
/** Day weights in 錢, 初一 … 三十. */
export const DAY_QIAN: readonly number[] = Object.freeze([
  5, 10, 8, 15, 16, 15, 8, 16, 8, 16,
  9, 17, 8, 17, 10, 8, 9, 18, 5, 15,
  10, 9, 8, 9, 15, 18, 7, 8, 16, 6,
])
/** 時辰 weights in 錢. */
export const HOUR_QIAN: Readonly<Record<Zhi, number>> = Object.freeze({
  子: 16, 丑: 6, 寅: 7, 卯: 10, 辰: 9, 巳: 16, 午: 10, 未: 8, 申: 8, 酉: 9, 戌: 6, 亥: 6,
})

/** The two entries published tables disagree on, with the other value. */
export const VARIANTS = [
  { entry: 'guihai' as const, other: 6, applies: (l: ChengguLunar) => l.yearGanZhi === '癸亥', v1: () => YEAR_QIAN.癸亥 },
  { entry: 'day20' as const, other: 10, applies: (l: ChengguLunar) => l.day === 20, v1: () => DAY_QIAN[19] },
]

/**
 * The copies v1 was compared with (2026-09-27), listed on the card so a
 * visitor can trace the table. `differs` names only what was verified to
 * differ; `[]` means all 114 entries were compared and match v1. 356.com.tw
 * matches too but is left out for its typos; suanzhun.net and
 * yourchineseastrology.com were checked on the two disputed entries only.
 */
export const CHENGGU_SOURCES: ReadonlyArray<{ name: string; url: string; differs: ReadonlyArray<'guihai' | 'day20'> }> = [
  { name: 'fatekeep.com', url: 'https://www.fatekeep.com/blog/2401', differs: [] },
  { name: '易安居 zhouyi.cc', url: 'https://m.zhouyi.cc/bazi/sm/49663.html', differs: [] },
  { name: 'zhunsuan.org', url: 'https://chenggusuanming.zhunsuan.org/calculation.html', differs: [] },
  { name: 'tt-qimen', url: 'https://github.com/shetengteng/tt-qimen', differs: [] },
  { name: 'yourchineseastrology.com', url: 'https://www.yourchineseastrology.com/hk/bone-weight/', differs: ['guihai'] },
  { name: 'fortune-assistant', url: 'https://github.com/DepressionL/fortune-assistant', differs: ['guihai'] },
  { name: 'suanzhun.net', url: 'https://www.suanzhun.net/chengu/1773.html', differs: ['guihai', 'day20'] },
  { name: 'hankwu61/lunarcalendar', url: 'https://github.com/hankwu61/lunarcalendar/blob/main/tools/chenggu.py', differs: ['guihai', 'day20'] },
]

/** A lunar date as 稱骨 reads it. `month` is 1–12 and a leap month keeps
 *  its number with `leap` set; `day` is 1–30. */
export type ChengguLunar = { yearGanZhi: string; month: number; leap: boolean; day: number }
export type ChengguWeights = { year: number; month: number; day: number; hour: number | null }
export type Chenggu = {
  version: string
  lunar: ChengguLunar
  weights: ChengguWeights
  /** The 時辰, or null when the hour is unknown. */
  zhi: Zhi | null
  /** Year + month + day. */
  fixed: number
  /** null when the hour is unknown: see `options`. */
  total: number | null
  /** Hour unknown: every total the twelve 時辰 can give, lightest first,
   *  with the 時辰 behind each (in 子 … 亥 order). */
  options?: Array<{ total: number; zhi: Zhi[] }>
  /** Born 23:00–23:59: the total by the school that turns the day at 23:00. */
  lateZi?: { lunar: ChengguLunar; weights: ChengguWeights; total: number }
  /** Published tables that weigh an entry this date uses differently.
   *  `total` changes ONLY that entry: a table that differs on both (hankwu61)
   *  is neither line, so the card and the facts say "only this entry". */
  variants?: Array<{ entry: 'guihai' | 'day20'; v1: number; other: number; total: number | null }>
}

/** The 時辰 of a clock hour: 23 and 0 are 子, 1–2 丑 … 21–22 亥. */
export const zhiOfHour = (h: number): Zhi => ZHI[Math.floor((h + 1) / 2) % 12]

/** The clock span of each 時辰, for the card. */
export const ZHI_SPAN: Readonly<Record<Zhi, string>> = Object.freeze({
  子: '23:00–00:59', 丑: '01:00–02:59', 寅: '03:00–04:59', 卯: '05:00–06:59', 辰: '07:00–08:59', 巳: '09:00–10:59',
  午: '11:00–12:59', 未: '13:00–14:59', 申: '15:00–16:59', 酉: '17:00–18:59', 戌: '19:00–20:59', 亥: '21:00–22:59',
})

/**
 * Weigh a lunar date and 時辰 (null: hour unknown). Throws on a date the
 * table cannot weigh, which a real lunar date never is.
 */
export function weigh(lunar: ChengguLunar, zhi: Zhi | null): Chenggu {
  const year = YEAR_QIAN[lunar.yearGanZhi]
  const month = Number.isInteger(lunar.month) ? MONTH_QIAN[lunar.month - 1] : undefined
  const day = Number.isInteger(lunar.day) ? DAY_QIAN[lunar.day - 1] : undefined
  if (year === undefined || month === undefined || day === undefined) {
    throw new RangeError(`稱骨: no weight for ${lunar.yearGanZhi} ${lunar.month}/${lunar.day}`)
  }
  const hour = zhi === null ? null : HOUR_QIAN[zhi]
  if (hour === undefined) throw new RangeError(`稱骨: no weight for 時辰 ${zhi}`)
  const fixed = year + month + day
  const total = hour === null ? null : fixed + hour
  let options: Chenggu['options']
  if (zhi === null) {
    const byTotal = new Map<number, Zhi[]>()
    for (const z of ZHI) byTotal.set(fixed + HOUR_QIAN[z], [...(byTotal.get(fixed + HOUR_QIAN[z]) ?? []), z])
    options = [...byTotal].sort((a, b) => a[0] - b[0]).map(([t, zs]) => ({ total: t, zhi: zs }))
  }
  const variants = VARIANTS.filter(v => v.applies(lunar)).map(v => ({
    entry: v.entry, v1: v.v1(), other: v.other, total: total === null ? null : total - v.v1() + v.other,
  }))
  return {
    version: CHENGGU_VERSION,
    lunar: { yearGanZhi: lunar.yearGanZhi, month: lunar.month, leap: lunar.leap, day: lunar.day },
    weights: { year, month, day, hour },
    zhi, fixed, total,
    ...(options ? { options } : {}),
    ...(variants.length ? { variants } : {}),
  }
}

// ── Words ────────────────────────────────────────────────────────────────────

const ZH_NUM = '〇一二三四五六七八九'
/** A weight in 錢 as the visitor's language writes it: 五兩六錢, 五两六钱,
 *  5両6銭, 5냥 6전, 5 liang 6 qian. A whole 兩 drops the 錢 (三兩). */
export function weightText(qian: number, lang: string = 'zh-Hant'): string {
  const l = Math.floor(qian / 10), q = qian % 10
  if (lang === 'en') return [l ? `${l} liang` : '', q ? `${q} qian` : ''].filter(Boolean).join(' ') || '0 qian'
  if (lang === 'ko') return [l ? `${l}냥` : '', q ? `${q}전` : ''].filter(Boolean).join(' ') || '0전'
  if (lang === 'ja') return `${l ? `${l}両` : ''}${q ? `${q}銭` : ''}` || '0銭'
  const [LIANG, QIAN] = lang === 'zh-Hans' ? ['两', '钱'] : ['兩', '錢']
  return `${l ? ZH_NUM[l] + LIANG : ''}${q ? ZH_NUM[q] + QIAN : ''}` || `〇${QIAN}`
}

const MONTH_ZH = ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '臘月']
const DAY_ZH = [
  '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十',
]
/** 正月 … 臘月 (腊月 in 简体). */
export const monthZh = (m: number, lang: string = 'zh-Hant') => lang === 'zh-Hans' ? (MONTH_ZH[m - 1] ?? '').replace('臘', '腊') : (MONTH_ZH[m - 1] ?? '')
/** 初一 … 三十. */
export const dayZh = (d: number) => DAY_ZH[d - 1] ?? ''
/** 己卯年臘月廿九, 癸卯年閏二月初一: the lunar date as the facts write it. */
export const lunarDateZh = (l: ChengguLunar) => `${l.yearGanZhi}年${l.leap ? '閏' : ''}${monthZh(l.month)}${dayZh(l.day)}`
