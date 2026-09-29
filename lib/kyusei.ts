// lib/kyusei.ts — 九星気学 (Nine Star Ki), the deterministic layer (Sep 29:
// a reviewer, "九星気学 is big in Japan").
//
// Everything here is the standard arithmetic of the 洛書 (Lo Shu) square:
//  - 本命星: the birth year's star, the year starting at 立春 (a birth before
//    立春 belongs to the year before). Star = 11 − (year mod 9), wrapped 1–9
//    (2024 三碧, 2025 二黒, 2026 一白).
//  - 月命星: the birth 節月's star. The 寅 month starts at 八白 in 一白・四緑・
//    七赤 years, 五黄 in 三碧・六白・九紫 years and 二黒 in 二黒・五黄・八白
//    years, and each month after it is one star lower.
//  - A board (年盤, 月盤): the given star in the centre, the rest flying
//    through the square in the 洛書 order (centre → 北西 → 西 → 北東 → 南 →
//    北 → 南西 → 東 → 南東).
//  - Unlucky directions: 五黄殺 (where 五黄 sits), 暗剣殺 (opposite it),
//    破 (opposite the year's or month's branch), 本命殺 (where one's own
//    star sits) and 本命的殺 (opposite it). Lucky directions: the stars whose
//    element feeds, is fed by, or matches one's own (相生・比和), avoiding
//    every unlucky one and 五黄 itself; those that also suit the 月命星 are
//    the best (最大吉方).
// These are conventions of 園田真次郎's school, not findings; the page and
// the teacher both say so. Boundary days (a birth on the day 立春 or a 節
// begins, when the hour is unknown or close) are flagged, not guessed.
//
// Client-safe: the lunar-typescript tables only.

import { Solar } from 'lunar-typescript'

import { STAR_ZH, DIRS, type Dir } from './kyusei-words'
export { DIRS, type Dir }
/** Each place's star in the 定位盤 (五黄 in the centre). */
const HOME: Record<Dir | 'C', number> = { C: 5, NW: 6, W: 7, NE: 8, S: 9, N: 1, SW: 2, E: 3, SE: 4 }
const OPP: Record<Dir, Dir> = { N: 'S', S: 'N', E: 'W', W: 'E', NE: 'SW', SW: 'NE', NW: 'SE', SE: 'NW' }
const BRANCH_DIR: Record<string, Dir> = { 子: 'N', 丑: 'NE', 寅: 'NE', 卯: 'E', 辰: 'SE', 巳: 'SE', 午: 'S', 未: 'SW', 申: 'SW', 酉: 'W', 戌: 'NW', 亥: 'NW' }
const OPP_BRANCH: Record<string, string> = { 子: '午', 丑: '未', 寅: '申', 卯: '酉', 辰: '戌', 巳: '亥', 午: '子', 未: '丑', 申: '寅', 酉: '卯', 戌: '辰', 亥: '巳' }

/** The nine stars' elements, 1–9. */
export const STAR_ELEMENT = ['', '水', '土', '木', '木', '土', '金', '金', '土', '火'] as const
const FEEDS: Record<string, string> = { 水: '木', 木: '火', 火: '土', 土: '金', 金: '水' }

const wrap = (n: number) => ((((n - 1) % 9) + 9) % 9) + 1
/** A 九星 year's star (the year that began at that year's 立春). */
export const yearStar = (year: number) => wrap(11 - (year % 9))
const MONTH_ORDER = ['寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥', '子', '丑']
/** A 節月's star, in a 九星 year whose star is `ys`. */
export function monthStar(ys: number, monthZhi: string): number {
  const start = [1, 4, 7].includes(ys) ? 8 : [3, 6, 9].includes(ys) ? 5 : 2
  return wrap(start - MONTH_ORDER.indexOf(monthZhi))
}
/** The board with `center` in the middle: each direction's star. */
export function board(center: number): Record<Dir | 'C', number> {
  const out = {} as Record<Dir | 'C', number>
  for (const d of [...DIRS, 'C'] as Array<Dir | 'C'>) out[d] = wrap(center - 5 + HOME[d])
  return out
}
/** Whether star `x` suits someone whose star is `own`: 相生 or 比和, never 五黄. */
export function suits(own: number, x: number): boolean {
  if (x === 5) return false
  const a = STAR_ELEMENT[own], b = STAR_ELEMENT[x]
  return a === b || FEEDS[a] === b || FEEDS[b] === a
}

export type Directions = {
  center: number
  branch: string
  board: Record<Dir | 'C', number>
  /** Unlucky: where each lies (null when the star sits in the centre). */
  goou: Dir | null; anken: Dir | null; ha: Dir; honmei: Dir | null; honmeiTeki: Dir | null
  bad: Dir[]
  good: Dir[]
  /** The good directions that also suit the 月命星. */
  best: Dir[]
  /** One's own star in the centre: 八方塞がり, a year (or month) most
   *  schools give no lucky direction for a move. `good` is then empty. */
  blocked: boolean
}
export function directions(center: number, branch: string, honmei: number, getsumei: number): Directions {
  const b = board(center)
  const at = (star: number) => DIRS.find(d => b[d] === star) ?? null
  const goou = at(5), anken = goou ? OPP[goou] : null
  const ha = BRANCH_DIR[OPP_BRANCH[branch]]
  const own = at(honmei), ownTeki = own ? OPP[own] : null
  const bad = DIRS.filter(d => d === goou || d === anken || d === ha || d === own || d === ownTeki)
  const blocked = b.C === honmei
  const good = blocked ? [] : DIRS.filter(d => !bad.includes(d) && suits(honmei, b[d]))
  return { center, branch, board: b, goou, anken, ha, honmei: own, honmeiTeki: ownTeki, bad, good, best: good.filter(d => suits(getsumei, b[d])), blocked }
}

export type BirthLike = { y: number; m: number; d: number; h?: number; mi?: number; hourUnknown?: boolean }

/** The 立春 of a Gregorian year, as the calendar tables give it (China time). */
function liChun(year: number): Solar {
  return Solar.fromYmd(year, 3, 1).getLunar().getJieQiTable()['立春']
}

export type KyuseiChart = {
  honmei: number
  getsumei: number
  /** The 九星 year the birth belongs to (it starts at 立春). */
  birthYear9: number
  /** A birth on the day 立春 (year) or a 節 (month) begins: the star on the
   *  other side of the line is given too. */
  boundary: { year: number | null; month: number | null }
  /** This 九星 year and 節月, as of `today`. */
  today: string
  year: Directions & { year9: number }
  month: Directions
}

/** A wall-clock moment moved by some minutes (the tables use wall time). */
function shift(x: Solar, minutes: number): Solar {
  const t = new Date(Date.UTC(x.getYear(), x.getMonth() - 1, x.getDay(), x.getHour(), x.getMinute()) + minutes * 60_000)
  return Solar.fromYmdHms(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate(), t.getUTCHours(), t.getUTCMinutes(), 0)
}
/** 本命星 and 月命星 at an exact moment. */
function starsAt(x: Solar): { year9: number; honmei: number; getsumei: number } {
  const year9 = x.isBefore(liChun(x.getYear())) ? x.getYear() - 1 : x.getYear()
  const honmei = yearStar(year9)
  return { year9, honmei, getsumei: monthStar(honmei, x.getLunar().getMonthZhiExact()) }
}

/** 本命星, 月命星, and this year's and month's boards and directions. */
export function kyuseiChart(b: BirthLike, today: string): KyuseiChart {
  const unknownHour = !!b.hourUnknown
  // With no hour, a 節入り day counts as the new month (and a 立春 day as the
  // new year), as Japanese 九星 calendars print it; the other side is kept.
  const birth = unknownHour ? Solar.fromYmdHms(b.y, b.m, b.d, 23, 59, 0) : Solar.fromYmdHms(b.y, b.m, b.d, b.h ?? 12, b.mi ?? 0, 0)
  const chosen = starsAt(birth)
  const jie = Solar.fromYmd(b.y, b.m, b.d).getLunar().getCurrentJie()
  let boundary: KyuseiChart['boundary'] = { year: null, month: null }
  if (jie) {
    const line = jie.getSolar()
    if (unknownHour || Math.abs(birth.subtractMinute(line)) < 120) {
      const other = starsAt(birth.isBefore(line) ? shift(line, 1) : shift(line, -1))
      boundary = { year: other.honmei !== chosen.honmei ? other.honmei : null, month: other.getsumei !== chosen.getsumei ? other.getsumei : null }
    }
  }
  const { honmei, getsumei, year9: birthYear9 } = chosen

  const [ty, tm, td] = today.split('-').map(Number)
  const now = Solar.fromYmdHms(ty, tm, td, 12, 0, 0)
  const nowLunar = now.getLunar()
  const year9 = now.isBefore(liChun(ty)) ? ty - 1 : ty
  const ys = yearStar(year9)
  const yearBranch = nowLunar.getYearZhiByLiChun()
  const monthZhi = nowLunar.getMonthZhi()
  return {
    honmei, getsumei, birthYear9, boundary,
    today,
    year: { ...directions(ys, yearBranch, honmei, getsumei), year9 },
    month: directions(monthStar(ys, monthZhi), monthZhi, honmei, getsumei),
  }
}

// ── What the teacher is told ───────────────────────────────────────────────

const DIR_ZH: Record<Dir, string> = { N: '北', NE: '東北', E: '東', SE: '東南', S: '南', SW: '西南', W: '西', NW: '西北' }

function dirFacts(label: string, x: Directions): string[] {
  const where = (d: Dir | null) => d ? DIR_ZH[d] : '（在中宮，無此方）'
  return [
    `${label}：中宮 ${STAR_ZH[x.center]}；${DIRS.map(d => `${DIR_ZH[d]} ${STAR_ZH[x.board[d]]}`).join('、')}`,
    `  凶方位：五黃殺 ${where(x.goou)}、暗劍殺 ${where(x.anken)}、破（${OPP_BRANCH[x.branch]}位，與${x.branch}相沖）${DIR_ZH[x.ha]}、本命殺 ${where(x.honmei)}、本命的殺 ${where(x.honmeiTeki)}`,
    x.blocked
      ? `  本命星在中宮：八方塞（多數流派認為這段期間沒有適合搬遷、遠行的吉方，宜守不宜動；不是凶兆，也不要說成災厄）。`
      : `  吉方位（與本命星相生或比和，且避開以上凶方）：${x.good.map(d => DIR_ZH[d]).join('、') || '無'}${x.best.length ? `；其中也合月命星（最大吉方）：${x.best.map(d => DIR_ZH[d]).join('、')}` : ''}`,
  ]
}

export function kyuseiFacts(c: KyuseiChart): string {
  return [
    `本命星：${STAR_ZH[c.honmei]}（五行${STAR_ELEMENT[c.honmei]}；九星年以立春為界，屬 ${c.birthYear9} 年）`,
    `月命星：${STAR_ZH[c.getsumei]}（五行${STAR_ELEMENT[c.getsumei]}；以節入為界）`,
    ...(c.boundary.year ? [`出生在立春當日且時刻不明或接近交節：本命星也可能是 ${STAR_ZH[c.boundary.year]}，請兩者都提到，不要說得肯定。`] : []),
    ...(c.boundary.month ? [`出生在節入當日且時刻不明或接近交節：月命星也可能是 ${STAR_ZH[c.boundary.month]}，請兩者都提到。`] : []),
    `今天：${c.today}`,
    ...dirFacts(`今年（${c.year.year9} 年，自立春起）年盤`, c.year),
    ...dirFacts(`本月（${c.month.branch}月，自節入起）月盤`, c.month),
    `說明：九星氣學是日本園田真次郎整理的方位學；凶方位、吉方位與相生比和都是這一派的慣例，不是定律。不要預言事件，不要用恐嚇的語氣。`,
  ].join('\n')
}

/** The visit's date as the page sent it (the visitor's local date, so the
 *  boards are "this year and month" where they are): a real date no later
 *  than two days from now, or else today's UTC date. Saved with the visit,
 *  so a reopened visit shows the boards of the day it was cast. */
export function asToday(v: unknown, now: number = Date.now()): string {
  const fallback = new Date(now).toISOString().slice(0, 10)
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return fallback
  const t = Date.parse(`${v}T00:00:00Z`)
  if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== v) return fallback
  return t >= Date.UTC(1950, 0, 1) && t <= now + 2 * 86_400_000 ? v : fallback
}
