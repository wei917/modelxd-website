// lib/sukuyo.ts — 宿曜占星術 (Sukuyō), the deterministic layer (Sep 29: a
// reviewer, "宿曜占星術 is big in Japan").
//
// The 宿曜経 calendar, as Japanese 宿曜 books print it: each lunar month's
// first day has a fixed 宿 (1月 室, 2月 奎, 3月 胃, 4月 畢, 5月 参, 6月 鬼,
// 7月 張, 8月 角, 9月 氐, 10月 心, 11月 斗, 12月 虚) and every day after it is
// the next of the twenty-seven (牛宿 is not used). The birth day's 宿 is the
// 本命宿; any other day's 宿, counted from it, falls in the 三九の秘法: 命
// (0), 業 (9), 胎 (18), and 栄 衰 安 危 成 壊 友 親 in each of the three
// cycles of nine. Two people's relation is the pair (栄親, 友衰, 安壊, 危成,
// 命, 業胎). Checked against a published 2026 宿曜 calendar (rekichu.com:
// 1/18 虚, 1/19 虚 as 旧暦12月1日, 1/20 危 … 1/29 参).
//
// The lunar dates are the Chinese calendar's (lunar-typescript), which in
// rare months starts a day away from Japan's 旧暦; a leap-month birth takes
// its month's number, which schools treat differently. Both are said.
//
// Client-safe: the lunar-typescript tables only.

import { Solar } from 'lunar-typescript'
import { SHUKU_ZH } from './sukuyo-words'

const ORDER = ['昴', '畢', '觜', '参', '井', '鬼', '柳', '星', '張', '翼', '軫', '角', '亢', '氐', '房', '心', '尾', '箕', '斗', '女', '虚', '危', '室', '壁', '奎', '婁', '胃']
const MONTH_START: Record<number, string> = { 1: '室', 2: '奎', 3: '胃', 4: '畢', 5: '参', 6: '鬼', 7: '張', 8: '角', 9: '氐', 10: '心', 11: '斗', 12: '虚' }

/** The 宿 (0–26 in 昴…胃 order) of a lunar month and day. */
export function shukuOf(lunarMonth: number, lunarDay: number): number {
  return (ORDER.indexOf(MONTH_START[Math.abs(lunarMonth)]) + lunarDay - 1) % 27
}

export type ShukuDay = { index: number; lunar: { month: number; day: number; leap: boolean } }
/** A Gregorian date's 宿 and lunar date. */
export function shukuOn(y: number, m: number, d: number): ShukuDay {
  const l = Solar.fromYmd(y, m, d).getLunar()
  return { index: shukuOf(l.getMonth(), l.getDay()), lunar: { month: Math.abs(l.getMonth()), day: l.getDay(), leap: l.getMonth() < 0 } }
}

/** 三九の秘法, by how far along the twenty-seven another 宿 lies. */
export const RELATION = ['命', '栄', '衰', '安', '危', '成', '壊', '友', '親', '業', '栄', '衰', '安', '危', '成', '壊', '友', '親', '胎', '栄', '衰', '安', '危', '成', '壊', '友', '親'] as const
export type Relation = (typeof RELATION)[number]
export const relationOf = (own: number, other: number): Relation => RELATION[(other - own + 27) % 27]
const PAIR: Record<Relation, string> = { 命: '命', 栄: '栄親', 親: '栄親', 友: '友衰', 衰: '友衰', 安: '安壊', 壊: '安壊', 危: '危成', 成: '危成', 業: '業胎', 胎: '業胎' }

export type SukuyoChart = {
  own: ShukuDay
  today: string
  day: ShukuDay & { relation: Relation }
  /** Every 宿 as seen from one's own (index → relation), for the ring. */
  ring: Relation[]
  partner?: ShukuDay & { date: string; fromMe: Relation; fromThem: Relation; pair: string }
}

const parse = (s: string) => s.split('-').map(Number) as [number, number, number]

/** The birth's 本命宿, today's 宿 against it, and a partner's if given. */
export function sukuyoChart(birth: { y: number; m: number; d: number }, today: string, partner?: string | null): SukuyoChart {
  const own = shukuOn(birth.y, birth.m, birth.d)
  const day = shukuOn(...parse(today))
  const out: SukuyoChart = {
    own, today,
    day: { ...day, relation: relationOf(own.index, day.index) },
    ring: ORDER.map((_, i) => relationOf(own.index, i)),
  }
  if (partner) {
    const p = shukuOn(...parse(partner))
    const fromMe = relationOf(own.index, p.index)
    out.partner = { ...p, date: partner, fromMe, fromThem: relationOf(p.index, own.index), pair: PAIR[fromMe] }
  }
  return out
}

/** A partner's birth date as the page sent it (YYYY-MM-DD, 1900 to today),
 *  or null. */
export function asPartnerDate(v: unknown, now: number = Date.now()): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const t = Date.parse(`${v}T00:00:00Z`)
  if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== v) return null
  return t >= Date.UTC(1900, 0, 1) && t <= now ? v : null
}

// ── What the teacher is told ───────────────────────────────────────────────
const lunarZh = (x: ShukuDay['lunar']) => `農曆${x.leap ? '閏' : ''}${x.month}月${x.day}日`

export function sukuyoFacts(c: SukuyoChart): string {
  return [
    `本命宿：${SHUKU_ZH[c.own.index]}（${lunarZh(c.own.lunar)}生；宿曜經以農曆每月初一的固定宿起算，一日一宿）`,
    ...(c.own.lunar.leap ? ['出生在閏月：此處以該月的月份起算，各流派對閏月的處理不同，請提醒。'] : []),
    `今天（${c.today}，${lunarZh(c.day.lunar)}）是${SHUKU_ZH[c.day.index]}，從本命宿看是「${c.day.relation}」的日子。`,
    `二十七宿從本命宿看的關係（三九祕法）：${c.ring.map((r, i) => `${SHUKU_ZH[i]}${r}`).join('、')}`,
    ...(c.partner ? [
      `對方（${c.partner.date} 生，${lunarZh(c.partner.lunar)}）：${SHUKU_ZH[c.partner.index]}。從本人看對方是「${c.partner.fromMe}」，從對方看本人是「${c.partner.fromThem}」，合稱「${c.partner.pair}」的關係。`,
    ] : []),
    `說明：宿曜占星術相傳由空海自唐傳入日本；本命宿、日宿與三九祕法都是宿曜經的曆法慣例，農曆依中國曆表計算，少數月份的初一可能與日本舊曆差一天。不要預言事件，不要用恐嚇的語氣。`,
  ].join('\n')
}
