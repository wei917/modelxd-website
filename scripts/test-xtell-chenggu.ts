// scripts/test-xtell-chenggu.ts — 稱骨 (八字幾兩幾錢). Real library output and
// the real chart/reading routes (auth, database, models and billing faked);
// no network.   npx tsx scripts/test-xtell-chenggu.ts
//
// Expected values do not come from the code under test:
//  - the weight table is checked against a published copy, kept here as the
//    text it prints (fatekeep.com/blog/2401, read 2026-09-27) and parsed by
//    this file's own reader;
//  - lunar dates come from the Hong Kong Observatory's 2000 and 2023
//    conversion tables (Codex's review cases) and well-known calendar facts
//    (2020 閏四月 from 05-23, 2025 閏六月 from 07-25, 2023 除夕 on 01-21,
//    1983 正月初一 on 02-13);
//  - the totals are sums of those published weights, added by hand.

import * as ts from 'typescript'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Solar } from 'lunar-typescript'
import {
  YEAR_QIAN, MONTH_QIAN, DAY_QIAN, HOUR_QIAN, VARIANTS, CHENGGU_SOURCES, CHENGGU_VERSION, ZHI,
  weigh, weightText, zhiOfHour, type Chenggu,
} from '../lib/xtell-chenggu'
import { chengguTheme, CHENGGU_MIN, CHENGGU_MAX } from '../lib/xtell-chenggu-reading'
import * as xtell from '../lib/xtell'
import * as yijing from '../lib/yijing'
const { chengGu, chengguFacts, validBirth } = xtell

let fails = 0
const check = (name: string, cond: boolean, extra = '') => {
  if (!cond) { fails++; console.log('FAIL', name, extra) } else console.log('ok  ', name)
}
const at = (y: number, m: number, d: number, h: number, mi: number, gender: 'male' | 'female' = 'male') => ({ y, m, d, h, mi, gender })
const unknown = (y: number, m: number, d: number, gender: 'male' | 'female' = 'male') => ({ y, m, d, h: 12, mi: 0, gender, hourUnknown: true })
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const sum = (c: Chenggu) => [c.weights.year, c.weights.month, c.weights.day, c.weights.hour]

// ── The table: v1 against a published copy ─────────────────────────────────
// fatekeep.com/blog/2401 as printed (two of its separators are spaces).
const PUBLISHED = {
  year: '甲子：一兩二錢丙子：一兩六錢戊子：一兩五錢庚子：七錢壬子：五錢乙丑：九錢丁丑：八錢己丑：七錢辛丑：七錢癸丑：七錢丙寅：六錢戊寅：八錢庚寅：九錢壬寅：九錢甲寅：一兩二錢丁卯：七錢己卯：一兩九錢辛卯：一兩二錢癸卯：一兩二錢乙卯：八錢戊辰：一兩二錢庚辰：一兩二錢壬辰：一兩甲辰：八錢丙辰：八錢己巳：五錢辛巳：六錢癸巳：七錢乙巳：七錢丁巳：六錢庚午：九錢壬午：八錢甲午：一兩五錢丙午：一兩三錢戊午：一兩九錢辛未：八錢癸未：七錢乙未：六錢丁未：五錢己未：六錢壬申：七錢甲申 五錢丙申：五錢戊申：一兩四錢庚申：八錢癸酉：八錢乙酉：一兩五錢丁酉：一兩四錢己酉：五錢辛酉：一兩六錢甲戌：一兩五錢丙戌：六錢戊戌：一兩四錢庚戌：九錢壬戌：一兩乙亥：九錢丁亥：一兩六錢己亥：九錢辛亥：一兩七錢癸亥：七錢',
  month: '正月：六錢二月：七錢三月：一兩八錢四月：九錢五月：五錢六月：一兩六錢七月：九錢八月：一兩五錢九月：一兩八錢十月：八錢冬月：九錢臘月：五錢',
  day: '初一：五錢初二 一兩初三：八錢初四：一兩五錢初五 一兩六錢初六：一兩五錢初七：八錢初八：一兩六錢初九：八錢初十：一兩六錢十一：九錢十二：一兩七錢十三：八錢十四：一兩七錢十五：一兩十六：八錢十七：九錢十八：一兩八錢十九：五錢二十：一兩五錢二十一：一兩二十二：九錢二十三：八錢二十四：九錢二十五：一兩五錢二十六：一兩八錢二十七：七錢二十八：八錢二十九：一兩六錢三十：六錢',
  hour: '子時：一兩六錢丑時：六錢寅時：七錢卯時：一兩辰時：九錢巳時：一兩六錢午時：一兩未時：八錢申時：八錢酉時：九錢戌時：六錢亥時：六錢',
}
const CN: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
/** 「一兩五錢」→ 15, 「七錢」→ 7, 「一兩」→ 10. */
const qianOf = (s: string) => { const m = /^(?:([一二三四五六七八九])兩)?(?:([一二三四五六七八九])錢)?$/.exec(s)!; return (m[1] ? CN[m[1]] * 10 : 0) + (m[2] ? CN[m[2]] : 0) }
const pairs = (text: string) => [...text.matchAll(/([^：\s兩錢]+?)[：\s]((?:[一二三四五六七八九]兩)?(?:[一二三四五六七八九]錢)?)(?=[^兩錢]|$)/g)].map(m => [m[1], qianOf(m[2])] as const)
{
  const year = new Map(pairs(PUBLISHED.year))
  const GZ = Array.from({ length: 60 }, (_, i) => '甲乙丙丁戊己庚辛壬癸'[i % 10] + '子丑寅卯辰巳午未申酉戌亥'[i % 12])
  check('the published year list has all 60 干支', year.size === 60 && GZ.every(g => year.has(g)), String(year.size))
  check('v1 year table = the published copy, all 60', Object.keys(YEAR_QIAN).length === 60 && GZ.every(g => YEAR_QIAN[g] === year.get(g)),
    GZ.filter(g => YEAR_QIAN[g] !== year.get(g)).join(' '))
  const month = pairs(PUBLISHED.month).map(([, q]) => q)
  check('v1 month table = the published copy, 正月 … 臘月', MONTH_QIAN.length === 12 && same([...MONTH_QIAN], month), JSON.stringify(month))
  const day = pairs(PUBLISHED.day).map(([, q]) => q)
  check('v1 day table = the published copy, 初一 … 三十', DAY_QIAN.length === 30 && same([...DAY_QIAN], day), JSON.stringify(day))
  const hour = pairs(PUBLISHED.hour).map(([k, q]) => [k.replace('時', ''), q] as const)
  check('v1 hour table = the published copy, 子 … 亥', Object.keys(HOUR_QIAN).length === 12 && same(hour.map(([k]) => k), [...ZHI]) && hour.every(([k, q]) => HOUR_QIAN[k as keyof typeof HOUR_QIAN] === q))
  const all = [...Object.values(YEAR_QIAN), ...MONTH_QIAN, ...DAY_QIAN, ...Object.values(HOUR_QIAN)]
  check('every weight is a whole number of 錢, 5 to 19', all.length === 114 && all.every(q => Number.isInteger(q) && q >= 5 && q <= 19))
  const min = Math.min(...Object.values(YEAR_QIAN)) + Math.min(...MONTH_QIAN) + Math.min(...DAY_QIAN) + Math.min(...Object.values(HOUR_QIAN))
  const max = Math.max(...Object.values(YEAR_QIAN)) + Math.max(...MONTH_QIAN) + Math.max(...DAY_QIAN) + Math.max(...Object.values(HOUR_QIAN))
  check('totals run from 二兩一錢 to 七兩一錢', min === 21 && max === 71)
  check('the two disputed entries: v1 癸亥 7 (other 6), day 20 15 (other 10)',
    YEAR_QIAN.癸亥 === 7 && DAY_QIAN[19] === 15 && same(VARIANTS.map(v => [v.entry, v.v1(), v.other]), [['guihai', 7, 6], ['day20', 15, 10]]))
  check('the source list names eight compared copies, all https', CHENGGU_SOURCES.length === 8 && CHENGGU_SOURCES.every(s => s.url.startsWith('https://')))
  check('every result carries the table version', chengGu(at(1990, 1, 1, 15, 0)).version === CHENGGU_VERSION && CHENGGU_VERSION === 'v1')
}

// ── Codex's HKO cases ──────────────────────────────────────────────────────
{
  const cases: Array<[string, ReturnType<typeof at>, string, number, boolean, number, string, number[], number]> = [
    ['1990-01-01 15:00', at(1990, 1, 1, 15, 0), '己巳', 12, false, 5, '申', [5, 5, 16, 8], 34],
    ['2000-02-04 23:00', at(2000, 2, 4, 23, 0), '己卯', 12, false, 29, '子', [19, 5, 16, 16], 56],
    ['2000-02-05 00:00', at(2000, 2, 5, 0, 0), '庚辰', 1, false, 1, '子', [12, 6, 5, 16], 39],
    ['2023-03-22 12:00', at(2023, 3, 22, 12, 0), '癸卯', 2, true, 1, '午', [12, 7, 5, 10], 34],
    ['2023-04-06 12:00', at(2023, 4, 6, 12, 0), '癸卯', 2, true, 16, '午', [12, 7, 8, 10], 37],
  ]
  for (const [label, b, gz, month, leap, day, zhi, parts, total] of cases) {
    const c = chengGu(b)
    check(`HKO ${label}: ${gz}年${leap ? '閏' : ''}${month}月${day}日${zhi}時 = ${total} 錢`,
      c.lunar.yearGanZhi === gz && c.lunar.month === month && c.lunar.leap === leap && c.lunar.day === day && c.zhi === zhi && same(sum(c), parts) && c.total === total,
      JSON.stringify(c))
  }
  // The weigher alone, fed HKO's lunar dates rather than the converter's.
  check('weigh() on HKO lunar dates gives the same totals',
    weigh({ yearGanZhi: '己卯', month: 12, leap: false, day: 29 }, '子').total === 56
    && weigh({ yearGanZhi: '癸卯', month: 2, leap: true, day: 16 }, '午').total === 37
    && weigh({ yearGanZhi: '己巳', month: 12, leap: false, day: 5 }, '申').total === 34)
}

// ── Lunar New Year, not 立春 ────────────────────────────────────────────────
{
  const ec = (y: number, m: number, d: number, h: number) => Solar.fromYmdHms(y, m, d, h, 0, 0).getLunar().getEightChar().getYear()
  const a = chengGu(at(2000, 2, 4, 23, 0))
  check('2000-02-04 23:00: after 立春 (八字 year 庚辰) but 稱骨 year 己卯 (19, not 12)', ec(2000, 2, 4, 23) === '庚辰' && a.lunar.yearGanZhi === '己卯' && a.weights.year === 19)
  const b = chengGu(at(2021, 2, 5, 12, 0))
  check('2021-02-05: after 立春 (辛丑) but before New Year: 庚子年臘月廿四 = 7+5+9+10 = 31',
    ec(2021, 2, 5, 12) === '辛丑' && b.lunar.yearGanZhi === '庚子' && b.lunar.month === 12 && b.lunar.day === 24 && b.total === 31, JSON.stringify(b))
  const c = chengGu(at(2023, 1, 25, 12, 0))
  check('2023-01-25: after New Year but before 立春 (壬寅): 癸卯年正月初四 = 12+6+15+10 = 43',
    ec(2023, 1, 25, 12) === '壬寅' && c.lunar.yearGanZhi === '癸卯' && c.lunar.month === 1 && c.lunar.day === 4 && c.total === 43, JSON.stringify(c))
  check('the month is the calendar month, not the 節 month (2023-04-06 is 丙辰月 on the 八字 board, 閏二月 here)',
    Solar.fromYmdHms(2023, 4, 6, 12, 0, 0).getLunar().getEightChar().getMonth() === '丙辰' && chengGu(at(2023, 4, 6, 12, 0)).weights.month === MONTH_QIAN[1])
}

// ── Leap months: the month they repeat ─────────────────────────────────────
{
  const a = chengGu(at(2020, 5, 23, 12, 0)), b = chengGu(at(2020, 6, 20, 12, 0)), c = chengGu(at(2020, 6, 21, 12, 0))
  check('2020-05-23 閏四月初一 weighs as 四月: 7+9+5+10 = 31', a.lunar.leap && a.lunar.month === 4 && a.lunar.day === 1 && a.weights.month === 9 && a.total === 31, JSON.stringify(a))
  check('2020-06-20 閏四月廿九 still 四月 (no split at the 16th)', b.lunar.leap && b.lunar.month === 4 && b.lunar.day === 29 && b.weights.month === 9)
  check('2020-06-21 is 五月初一 again, not leap: 7+5+5+10 = 27', !c.lunar.leap && c.lunar.month === 5 && c.lunar.day === 1 && c.total === 27)
  const d = chengGu(at(2025, 7, 25, 12, 0))
  check('2025-07-25 閏六月初一 weighs as 六月: 乙巳 7+16+5+10 = 38', d.lunar.yearGanZhi === '乙巳' && d.lunar.leap && d.lunar.month === 6 && d.total === 38)
}

// ── 23:00 and 00:00 ────────────────────────────────────────────────────────
{
  const a = chengGu(at(2000, 2, 4, 23, 0))
  check('23:00 keeps the calendar date (己卯年臘月廿九 子時 = 56)', a.lunar.day === 29 && a.zhi === '子' && a.total === 56)
  check('…and carries the 23:00-turns-the-day total: 庚辰年正月初一 子時 = 12+6+5+16 = 39',
    !!a.lateZi && a.lateZi.lunar.yearGanZhi === '庚辰' && a.lateZi.lunar.month === 1 && a.lateZi.lunar.day === 1 && a.lateZi.total === 39, JSON.stringify(a.lateZi))
  check('00:00 the next day is that date, with no second total', chengGu(at(2000, 2, 5, 0, 0)).total === 39 && !chengGu(at(2000, 2, 5, 0, 0)).lateZi)
  const b = chengGu(at(2000, 2, 4, 22, 59))
  check('22:59 is 亥 (6) and has no second total: 46', b.zhi === '亥' && b.total === 46 && !b.lateZi)
  const c = chengGu(at(2023, 1, 21, 23, 30))
  check('除夕 23:30: 壬寅年臘月三十 子時 = 9+5+6+16 = 36; turning at 23:00 gives 癸卯年正月初一 = 39',
    c.lunar.yearGanZhi === '壬寅' && c.lunar.month === 12 && c.lunar.day === 30 && c.total === 36 && c.lateZi?.lunar.yearGanZhi === '癸卯' && c.lateZi?.total === 39, JSON.stringify(c))
  let ok = true
  for (let h = 0; h < 24; h++) for (const mi of [0, 59]) {
    const lib = Solar.fromYmdHms(2000, 6, 15, h, mi, 0).getLunar().getTimeZhi()
    if (zhiOfHour(h) !== lib || chengGu(at(2000, 6, 15, h, mi)).zhi !== lib) { ok = false; console.log('  mismatch', h, mi, lib) }
  }
  check('every clock hour, :00 and :59, lands in the library\'s 時辰 (子 23–00, 丑 01–02 … 亥 21–22)', ok)
  check('00:59 is still 子, 01:00 is 丑', chengGu(at(2000, 6, 15, 0, 59)).zhi === '子' && chengGu(at(2000, 6, 15, 1, 0)).zhi === '丑')
}

// ── An unknown hour ────────────────────────────────────────────────────────
{
  const raw = unknown(1990, 1, 1)
  const c = chengGu(raw)
  check('unknown hour: no 時辰, no total, year+month+day = 26', c.zhi === null && c.total === null && c.weights.hour === null && c.fixed === 26)
  check('…and exactly the totals 32, 33, 34, 35, 36, 42 (not a range)', same(c.options?.map(o => o.total), [32, 33, 34, 35, 36, 42]), JSON.stringify(c.options))
  check('…each with its 時辰', same(c.options?.map(o => o.zhi), [['丑', '戌', '亥'], ['寅'], ['未', '申'], ['辰', '酉'], ['卯', '午'], ['子', '巳']]))
  const normalised = { ...raw }; validBirth(normalised)
  check('the noon placeholder validBirth() writes changes nothing', same(chengGu(normalised), c) && !c.lateZi)
  check('an unknown hour with h = 23 in the payload has no 23:00 total either', !chengGu({ ...unknown(2000, 2, 4), h: 23 }).lateZi)
}

// ── Table variants: one entry at a time ────────────────────────────────────
{
  const both = chengGu(at(1983, 3, 4, 12, 0))
  check('1983-03-04 is 癸亥年正月二十: 7+6+15+10 = 38', both.lunar.yearGanZhi === '癸亥' && both.lunar.month === 1 && both.lunar.day === 20 && both.total === 38, JSON.stringify(both.lunar))
  check('…with two variants, each changing only its own entry (37, 33)',
    same(both.variants, [{ entry: 'guihai', v1: 7, other: 6, total: 37 }, { entry: 'day20', v1: 15, other: 10, total: 33 }]), JSON.stringify(both.variants))
  const one = chengGu(at(1983, 3, 5, 12, 0))
  check('癸亥年正月廿一: only the 癸亥 variant (33 → 32)', one.total === 33 && same(one.variants, [{ entry: 'guihai', v1: 7, other: 6, total: 32 }]))
  const d20 = chengGu(at(2000, 2, 24, 12, 0))
  check('庚辰年正月二十: only the day-20 variant (43 → 38)', d20.lunar.day === 20 && d20.total === 43 && same(d20.variants, [{ entry: 'day20', v1: 15, other: 10, total: 38 }]))
  check('no variant when neither entry is used', !chengGu(at(2000, 2, 5, 0, 0)).variants)
  const u = chengGu(unknown(1983, 3, 4))
  check('unknown hour: a variant names the entry but no total', same(u.variants?.map(v => v.total), [null, null]))
}

// ── Invalid input never reaches the calendar ───────────────────────────────
{
  const throws = (b: any) => { try { chengGu(b); return false } catch (e) { return e instanceof RangeError } }
  for (const [label, b] of [
    ['1990-02-31', at(1990, 2, 31, 12, 0)], ['2025-02-29', at(2025, 2, 29, 12, 0)], ['1899-12-31', at(1899, 12, 31, 12, 0)],
    ['2099-01-01 (future)', at(2099, 1, 1, 12, 0)], ['hour 24', at(1990, 1, 1, 24, 0)], ['minute 60', at(1990, 1, 1, 12, 60)],
    ['hour 1.5', at(1990, 1, 1, 1.5, 0)], ['no gender', { y: 1990, m: 1, d: 1, h: 12, mi: 0 }],
  ] as const) check(`refused: ${label}`, throws(b))
  const bad = (f: () => unknown) => { try { f(); return false } catch (e) { return e instanceof RangeError } }
  check('weigh() refuses a lunar date or 時辰 no table has',
    bad(() => weigh({ yearGanZhi: '甲丑', month: 1, leap: false, day: 1 }, '子')) && bad(() => weigh({ yearGanZhi: '甲子', month: 13, leap: false, day: 1 }, '子'))
    && bad(() => weigh({ yearGanZhi: '甲子', month: 1, leap: false, day: 31 }, '子')) && bad(() => weigh({ yearGanZhi: '甲子', month: 0, leap: false, day: 1 }, '子'))
    && bad(() => weigh({ yearGanZhi: '甲子', month: 1, leap: false, day: 1 }, 'X' as any)))
}

// ── Same for everyone, whatever the server's time zone ─────────────────────
{
  const births = [at(1990, 1, 1, 15, 0), at(2000, 2, 4, 23, 0), at(2023, 4, 6, 12, 0), unknown(1990, 1, 1)]
  check('men and women weigh the same', births.every(b => same(chengGu({ ...b, gender: 'male' }), chengGu({ ...b, gender: 'female' }))))
  const run = (tz: string) => { process.env.TZ = tz; return { off: new Date(2000, 0, 1).getTimezoneOffset(), out: births.map(b => chengGu(b)) } }
  const before = process.env.TZ
  const kiri = run('Pacific/Kiritimati'), la = run('America/Los_Angeles')
  if (before === undefined) delete process.env.TZ; else process.env.TZ = before
  check('the host time zone changes nothing (UTC+14 vs UTC−8)', kiri.off !== la.off && same(kiri.out, la.out), `${kiri.off} ${la.off}`)
}

// ── Words ──────────────────────────────────────────────────────────────────
check('weights in five languages (56)', weightText(56) === '五兩六錢' && weightText(56, 'zh-Hans') === '五两六钱' && weightText(56, 'ja') === '5両6銭' && weightText(56, 'ko') === '5냥 6전' && weightText(56, 'en') === '5 liang 6 qian')
check('a whole 兩 drops the 錢, a light one has no 兩', weightText(50) === '五兩' && weightText(10) === '一兩' && weightText(7) === '七錢' && weightText(21) === '二兩一錢' && weightText(71) === '七兩一錢' && weightText(10, 'en') === '1 liang' && weightText(7, 'ko') === '7전')

// ── The master's facts ─────────────────────────────────────────────────────
{
  const f = chengguFacts(chengGu(at(2000, 2, 4, 23, 0)))
  check('facts: the equation and the total', f.includes('年 己卯 一兩九錢＋月 臘月 五錢＋日 廿九 一兩六錢＋時 子 一兩六錢＝五兩六錢'), f)
  check('facts: the 23:00 school, both to be told', f.includes('晚子時另一說') && f.includes('＝三兩九錢') && f.includes('不可只講一種'))
  check('facts: the rules, the version, the limits', f.includes('正月初一換年') && f.includes('閏月按所閏的月份計') && f.includes('通行本 v1') && f.includes('不是經過驗證的預測') && f.includes('不要引述、補寫或改寫任何稱骨歌句'))
  const u = chengguFacts(chengGu(unknown(1990, 1, 1)))
  check('unknown-hour facts: the part, the six totals with their 時辰, no single total',
    u.includes('時辰未知') && u.includes('小計 二兩六錢') && u.includes('三兩二錢（丑、戌、亥時）') && u.includes('四兩二錢（子、巳時）') && u.includes('不可給出單一總重') && !u.includes('＋時') && !u.includes('＝') && !/12:00/.test(u), u)
  const leap = chengguFacts(chengGu(at(2023, 4, 6, 12, 0)))
  check('leap-month facts say which month it counts as', leap.includes('閏二月（按二月計）') && leap.includes('＝三兩七錢'))
  const v = chengguFacts(chengGu(at(1983, 3, 4, 12, 0)))
  check('variant facts change one entry at a time and say so', (v.match(/只把這一項改為/g) ?? []).length === 2 && v.includes('總重是 三兩七錢') && v.includes('總重是 三兩三錢'), v)
}

// Editorial coverage and grounded tutor context, including non-monotonic themes.
{
  const languages = ['en', 'zh-Hant', 'zh-Hans', 'ja', 'ko']
  check('reading endpoints match arithmetic extremes',
    [YEAR_QIAN, MONTH_QIAN, DAY_QIAN, HOUR_QIAN].reduce((n, table) => n + Math.min(...Object.values(table)), 0) === CHENGGU_MIN &&
    [YEAR_QIAN, MONTH_QIAN, DAY_QIAN, HOUR_QIAN].reduce((n, table) => n + Math.max(...Object.values(table)), 0) === CHENGGU_MAX)
  check('every weight has a theme in all five languages', Array.from({ length: 51 }, (_, i) => i + 21).every(q => languages.every(l => !!chengguTheme(q, l))))
  check('invalid and fractional weights have no invented reading', [20, 72, 35.5, NaN, Infinity].every(q => chengguTheme(q) === null))
  check('lightest and heaviest preserve distinct traditional themes', chengguTheme(21)!.includes('困頓') && chengguTheme(71)!.includes('公侯卿相'))
  check('heavier is not automatically a better theme', chengguTheme(36)!.includes('順遂') && chengguTheme(37)!.includes('不定'))
  const known = chengGu(at(2000, 2, 4, 23, 0))
  check('teacher receives same editorial theme as the card', chengguFacts(known).includes(chengguTheme(known.total!)!))
  const unknown = chengGu({ ...at(1990, 1, 1, 12, 0), hourUnknown: true })
  const facts = chengguFacts(unknown)
  check('teacher gets every unknown-hour theme, with no single choice', unknown.options!.every(o => facts.includes(chengguTheme(o.total)!)) && facts.includes('不可選定單一結果'))
}

// ── The routes: computed on the server, only in 八字廟 ──────────────────────
function loadRoute(file: string, modules: Record<string, unknown>) {
  const js = ts.transpileModule(readFileSync(join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports: any = {}
  vm.runInNewContext(js, {
    exports, console, Response, Request, ReadableStream, TextEncoder,
    // The reading route keeps its work alive with after() and beats every 15 s.
    setInterval, clearInterval,
    require: (name: string) => { const deps: Record<string, unknown> = { 'next/server': { after: () => {} }, '@/lib/xtell-thread': require('../lib/xtell-thread'), ...modules }; if (!(name in deps)) throw new Error('unexpected route dependency: ' + name); return deps[name] },
  }, { filename: file })
  return exports.POST as (req: Request) => Promise<Response>
}
function fakeDb() {
  const inserted: any[] = []
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: 'test-user' } } }) },
    rpc: async () => ({ error: null }),
    from(table: string) {
      let op = 'select', values: any = null
      const q: any = {
        select: () => q, eq: () => q, is: () => q, order: () => q, limit: () => q, single: () => q, maybeSingle: () => q,
        insert: (v: any) => { op = 'insert'; values = v; return q },
        update: (v: any) => { op = 'update'; values = v; return q },
        then: (resolve: any, reject: any) => Promise.resolve(
          op === 'insert' ? (inserted.push({ table, ...values }), { data: { id: '00000000-0000-4000-8000-00000000c0de' }, error: null }) : { data: op === 'select' ? [] : null, error: null },
        ).then(resolve, reject),
      }
      return q
    },
  }
  return { db, inserted }
}
const post = (url: string, body: unknown) => new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

async function routes() {
  const { db, inserted } = fakeDb()
  const chart = loadRoute('app/api/xtell/chart/route.ts', { '@/lib/supabase-server': { createSupabaseServer: async () => db }, '@/lib/xtell': xtell, '@/lib/yijing': yijing, '@/lib/tarot': require('../lib/tarot'), '@/lib/xtell-cookie': require('../lib/xtell-cookie'), '@/lib/kyusei': require('../lib/kyusei'), '@/lib/sukuyo': require('../lib/sukuyo'), '@/lib/sunzi': require('../lib/sunzi'), '@/lib/sunzi-scan': { scanSituation: async () => null }, '@/lib/xtell-lang-check': require('../lib/xtell-lang-check'), '@/lib/xtell-personality': require('../lib/xtell-personality'), '@/lib/xtell-cookie-fortunes': require('../lib/xtell-cookie-fortunes'), '@/lib/xtell-almanac': require('../lib/xtell-almanac'), '@/lib/xtell-daily-model': { dailyText: async () => null }, '@/lib/credits': { debitCredits: async () => 0, grantCredits: async () => 0, InsufficientCreditsError: class extends Error {} }, '@/lib/jiemeng': require('../lib/jiemeng'), '@/lib/jiemeng-scan': { scanDream: async () => ({ ids: [0], model: 'stub' }) } })
  const cast = async (body: any) => { const r = await chart(post('http://t/api/xtell/chart', body)); return { status: r.status, d: await r.json() as any } }

  const a = await cast({ temple: 'bazi', birth: at(2000, 2, 4, 23, 0), chenggu: { total: 99 } })
  const saved = inserted.at(-1)
  check('chart route: 八字 returns the 稱骨 it computed (56), whatever the client sent', a.status === 200 && a.d.chenggu?.total === 56 && a.d.chenggu?.lateZi?.total === 39, JSON.stringify(a.d.chenggu))
  check('chart route: saved with the visit in extras, not in the subject', saved?.extras?.chenggu?.total === 56 && saved?.subject && !('chenggu' in saved.subject))
  const before = inserted.length
  const r = await cast({ temple: 'bazi', birth: at(2000, 2, 4, 23, 0), refresh: true })
  check('chart route: a reopened visit is recomputed and nothing is written', r.d.chenggu?.total === 56 && inserted.length === before)
  const u = await cast({ temple: 'bazi', birth: unknown(1990, 1, 1) })
  check('chart route: unknown hour gives the six totals, no total', u.d.chenggu?.total === null && same(u.d.chenggu?.options?.map((o: any) => o.total), [32, 33, 34, 35, 36, 42]))
  const bad = await cast({ temple: 'bazi', birth: at(1990, 2, 31, 12, 0) })
  check('chart route: an impossible date is refused before any weighing', bad.status === 400 && bad.d.code === 'birth_date' && !bad.d.chenggu)
  const others = [
    await cast({ temple: 'yuelao', birth: at(1990, 1, 1, 15, 0), birth2: at(1992, 5, 5, 9, 0, 'female') }),
    await cast({ temple: 'simianfo', birth: at(1990, 1, 1, 15, 0), wishes: { career: '升遷' } }),
    await cast({ temple: 'guandi', n: 1, birth: at(1990, 1, 1, 15, 0) }),
  ]
  check('chart route: 月老, 四面佛 and a 籤 with a birth carry no 稱骨', others.every(o => o.status === 200 && o.d.chenggu === undefined) && inserted.slice(-3).every(x => !x.extras?.chenggu), JSON.stringify(others.map(o => o.status)))

  const systems: string[] = []
  const model = { id: 'm1', provider: 'openai', model_name: 'test-model', display_name: 'Test', enabled: true, blocked_features: [], output_config: { text: { capabilities: [], thinking_levels: [] } } }
  const reading = loadRoute('app/api/xtell/reading/route.ts', {
    '@/lib/supabase-server': { createSupabaseServer: async () => db },
    '@/lib/models': { getModelById: async () => model },
    '@/lib/providers': { streamText: async (_m: unknown, _msgs: unknown, cb: any, _a: unknown, _c: unknown, opts: any) => { systems.push(opts.system); await cb.onDone({ cost: 0 }) } },
    '@/lib/credits': { debitCredits: async () => {}, accrueFraction: async () => null, InsufficientCreditsError: class extends Error {} },
    '@/lib/provider-errors': { sanitizeProviderError: (m: string) => m },
    '@/lib/xtell': xtell,
    '@/lib/classics': { classicsBlock: () => '' },
    // The daily follow-up branch's modules; no temple path may touch them.
    '@/lib/xtell-admin': { xtellAdmin: () => { throw new Error('the service role is not for temple readings') }, dailyMissing: () => false },
    '@/lib/xtell-daily': require('../lib/xtell-daily'),
    '@/lib/yijing': yijing,
    '@/lib/tarot': require('../lib/tarot'), '@/lib/xtell-cookie': require('../lib/xtell-cookie'), '@/lib/kyusei': require('../lib/kyusei'), '@/lib/sukuyo': require('../lib/sukuyo'), '@/lib/sunzi': require('../lib/sunzi'), '@/lib/sunzi-scan': { scanSituation: async () => null }, '@/lib/xtell-lang-check': require('../lib/xtell-lang-check'), '@/lib/xtell-personality': require('../lib/xtell-personality'), '@/lib/jiemeng': require('../lib/jiemeng'),
  })
  // '' unless THIS request reached the model: a refused one must not be
  // judged by the previous request's prompt.
  const ask = async (body: any) => {
    const n = systems.length
    const res = await reading(post('http://t/api/xtell/reading', { modelId: 'm1', question: '我幾兩幾錢？', ...body }))
    await res.text()
    return systems.length === n + 1 ? systems[n] : ''
  }
  const s1 = await ask({ temple: 'bazi', birth: at(2000, 2, 4, 23, 0), chenggu: { total: 99, weights: { year: 99 } } })
  check('reading route: the master gets the server\'s 稱骨, never the client\'s', s1.includes('四柱：') && s1.includes('＝五兩六錢') && !s1.includes('九兩九錢'), s1.slice(-400))
  const s2 = await ask({ temple: 'bazi', birth: unknown(1990, 1, 1) })
  check('reading route: unknown hour reaches the master as six totals, no noon', s2.includes('總重只能是以下其中之一') && !/12:00/.test(s2) && !s2.includes('＋時'))
  const rest = [
    await ask({ temple: 'yuelao', birth: at(1990, 1, 1, 15, 0), birth2: at(1992, 5, 5, 9, 0, 'female') }),
    await ask({ temple: 'simianfo', birth: at(1990, 1, 1, 15, 0), wishes: { career: '升遷' } }),
    await ask({ temple: 'guandi', n: 1, birth: at(1990, 1, 1, 15, 0) }),
    await ask({ temple: 'ziwei', birth: at(1990, 1, 1, 15, 0) }),
  ]
  check('reading route: 月老, 四面佛, 籤 and 紫微 masters get no 稱骨', rest.every(s => s.length > 0 && !s.includes('稱骨')))
}

routes().catch(e => { fails++; console.log('FAIL route tests threw', e?.stack ?? e) }).then(() => {
  console.log(fails ? `\n${fails} FAILED` : '\nall 稱骨 checks passed')
  if (fails) process.exit(1)
})
