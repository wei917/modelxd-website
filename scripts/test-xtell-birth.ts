// scripts/test-xtell-birth.ts — birth dates and unknown hours (audit F01,
// F02, F04, Sep 26). Real library output, no network.
//   npx tsx scripts/test-xtell-birth.ts
//
// Expected values are independent of the code under test: calendar facts
// (2 月有 28 或 29 日), the 立春 moment lunar-typescript itself reports for
// 2000-02-04 (20:40:24, the boundary Codex measured: 20:40 己卯/丁丑, 20:41
// 庚辰/戊寅), and Codex's 1985-07-20 case whose known pillars are 乙丑 癸未
// and a 金 day, so the known elements are 木土水金 and 火 appears only from
// a fabricated noon 時柱.

import { Solar } from 'lunar-typescript'
import { birthProblem, daysInMonth, birthYears, latestBirthDate, BIRTH_MIN_YEAR } from '../lib/xtell-birth'
import { validBirth, baziChart, baziFacts, heMatch, yuelaoFacts, liuNian, liuNianFacts, simianfoFacts, bingGaoFacts } from '../lib/xtell'

let fails = 0
const check = (name: string, cond: boolean, extra = '') => {
  if (!cond) { fails++; console.log('FAIL', name, extra) } else console.log('ok  ', name)
}
const at = (y: number, m: number, d: number, h: number, mi: number, gender: 'male' | 'female' = 'male') => ({ y, m, d, h, mi, gender })
const unknown = (y: number, m: number, d: number, gender: 'male' | 'female' = 'male') => ({ y, m, d, h: 12, mi: 0, gender, hourUnknown: true })
const NOW = new Date('2026-09-26T08:00:00Z')

// ── F01: only real dates ────────────────────────────────────────────────────
check('days in month: leap rules (2024, 2025, 1900, 2000)', daysInMonth(2024, 2) === 29 && daysInMonth(2025, 2) === 28 && daysInMonth(1900, 2) === 28 && daysInMonth(2000, 2) === 29 && daysInMonth(1990, 4) === 30 && daysInMonth(1990, 12) === 31)
for (const [label, b] of [['1990-02-31', at(1990, 2, 31, 12, 0)], ['1990-04-31', at(1990, 4, 31, 12, 0)], ['2025-02-29', at(2025, 2, 29, 12, 0)], ['1990-06-00', at(1990, 6, 0, 12, 0)], ['1990-13-01', at(1990, 13, 1, 12, 0)]] as const) {
  check(`refused: ${label}`, birthProblem(b, NOW) !== null && !validBirth({ ...b }), String(birthProblem(b, NOW)))
}
check('impossible day is reported as a date problem', birthProblem(at(1990, 2, 31, 12, 0), NOW) === 'date' && birthProblem(at(2025, 2, 29, 12, 0), NOW) === 'date')
check('leap day in a leap year is accepted', birthProblem(at(2024, 2, 29, 12, 0), NOW) === null)
check('before 1900 is out of range', birthProblem(at(1899, 12, 31, 12, 0), NOW) === 'range' && birthProblem(at(BIRTH_MIN_YEAR, 1, 1, 0, 0), NOW) === null)
check('a future date is refused, today is not', birthProblem(at(2026, 9, 28, 12, 0), NOW) === 'future' && birthProblem(at(2026, 9, 26, 9, 0), NOW) === null)
check('today in UTC+14 is still today', latestBirthDate(new Date('2026-09-26T12:00:00Z')).d === 27)
check('malformed input is a shape problem', birthProblem(null, NOW) === 'shape' && birthProblem({ y: 1990, m: 1, d: 1, h: 24, mi: 0, gender: 'male' }, NOW) === 'shape' && birthProblem({ y: 1990, m: 1, d: 1, h: 1, mi: 0 }, NOW) === 'shape')
check('an unknown hour needs no clock time', birthProblem({ y: 1990, m: 1, d: 1, gender: 'female', hourUnknown: true }, NOW) === null)
{
  const ys = birthYears(NOW)
  check('form years run from this year down to 1900', ys[0] === 2026 && ys[ys.length - 1] === 1900 && ys.length === 127)
}

// ── F04: every minute reaches the engine ────────────────────────────────────
{
  const p = (mi: number) => baziChart(at(2000, 2, 4, 20, mi)).pillars
  check('20:40 on 2000-02-04 is still 己卯年 丁丑月', p(40).year.ganZhi === '己卯' && p(40).month.ganZhi === '丁丑')
  check('20:41 is 庚辰年 戊寅月 (立春 at 20:40:24)', p(41).year.ganZhi === '庚辰' && p(41).month.ganZhi === '戊寅')
}

// ── F02: an unknown hour is never a noon ────────────────────────────────────
{
  const b = unknown(1990, 1, 1)
  check('validBirth keeps the unknown flag', validBirth(b) && b.hourUnknown === true)
  const c = baziChart(b)
  check('unknown hour: date only, no 時柱, three pillars of elements', c.solar === '1990-01-01' && c.pillars.time === null && c.wuXing.length === 3 && c.hourUnknown === true && !c.doubt)
  const f = baziFacts(c, 'male')
  check('unknown-hour facts carry no clock time and no 時柱 value', !/12:00/.test(f) && f.includes('時辰未知') && !f.includes('甲午'), f)
  // 1990-01-01 is a 丙 day; 丙辛日起戊子 (五鼠遁) makes 申時 丙申.
  check('known-hour chart still has its 時柱', baziChart(at(1990, 1, 1, 15, 25)).pillars.time?.ganZhi === '丙申')
  check('大運 start ages are marked approximate when the hour is unknown', /約\d+歲起/.test(f))
}
{
  // 2000-02-04 is 立春: the date alone does not decide 年柱 or 月柱.
  const c = baziChart(unknown(2000, 2, 4))
  const d = c.doubt
  check('立春 day, unknown hour: both years and both months are kept',
    d?.term.name === '立春' && d.term.time === '20:40'
    && d.year?.[0].ganZhi === '己卯' && d.year?.[1].ganZhi === '庚辰'
    && d.month?.[0].ganZhi === '丁丑' && d.month?.[1].ganZhi === '戊寅', JSON.stringify(d))
  check('…and no 大運 sequence is claimed', c.daYun.length === 0)
  const f = baziFacts(c, 'female')
  check('…and the facts give both readings, not one', f.includes('己卯或庚辰') && f.includes('丁丑或戊寅') && f.includes('交立春') && f.includes('大運：月柱未定'), f)
  const ln = liuNian(c, 2000, 2026)
  check('流年 against an undecided 年柱 is given both ways', ln.yearChoices?.length === 2 && liuNianFacts(ln).includes('年柱未定'))
}
{
  // 驚蟄 2000-03-05 moves the 月柱 only.
  const c = baziChart(unknown(2000, 3, 5))
  check('驚蟄 day: month undecided, year decided', c.doubt?.term.name === '驚蟄' && !!c.doubt?.month && !c.doubt?.year, JSON.stringify(c.doubt))
  check('an ordinary day has no doubt', !baziChart(unknown(2000, 3, 10)).doubt)
}
{
  // The 日柱 follows the calendar date all day in this library (sect 2).
  const sameDay = [[1990, 1, 1], [2000, 2, 4], [2024, 2, 29], [1985, 7, 20]].every(([y, m, d]) => {
    const e = (h: number, mi: number) => Solar.fromYmdHms(y, m, d, h, mi, 0).getLunar().getEightChar().getDay()
    return e(0, 0) === e(23, 59)
  })
  check('the 日柱 never changes within a calendar date', sameDay)
}

{
  // Codex: 1990-01-01, hour unknown, read in 2026 printed a definite 大運.
  const ln = liuNian(baziChart(unknown(1990, 1, 1)), 1990, 2026)
  const f = liuNianFacts(ln)
  check('流年: the 大運 in force is marked approximate when the hour is unknown', !!ln.daYunApprox && (f.includes('約略') || f.includes('可能為')), f)
  const known = liuNianFacts(liuNian(baziChart(at(1990, 1, 1, 15, 25)), 1990, 2026))
  check('…and stays definite when the hour is known', !known.includes('約略') && !known.includes('可能為'))
  // Near a change of 大運 the cycle in force may be either of two.
  const c = baziChart(unknown(1990, 1, 1))
  const edge = c.daYun[1].startAge
  const near = liuNian(c, 1990, 1990 + edge)
  check('at a 大運 change the facts give both cycles', (near.daYunChoices?.length ?? 0) === 2 && liuNianFacts(near).includes('可能為'), JSON.stringify(near))
}

// ── 月老: the score reads only what is known ─────────────────────────────────
{
  const a = baziChart(unknown(1985, 7, 20, 'male')), b = baziChart(unknown(1985, 7, 20, 'female'))
  const m = heMatch(a, b, 2026)
  const spread = m.dimensions.find(x => x.key === 'spread')!
  check('Codex case: two unknown-hour 1985-07-20 births cover 4/5, no 火 from a noon placeholder',
    spread.detail.includes('4/5') && !spread.detail.includes('火'), spread.detail)
  const facts = yuelaoFacts(a, 'male', b, 'female', m)
  // 壬午 would be the noon 時柱 here, but it is also a genuine 大運 step for
  // the man, so the check is on the pillar lines themselves.
  check('…and the teacher facts carry no 12:00 and only three pillars', !/12:00/.test(facts) && !facts.includes('四柱') && facts.includes('三柱：年 乙丑、月 癸未、日 庚申') && facts.includes('（4/5）'), facts)
  const known = heMatch(baziChart(at(1985, 7, 20, 12, 0)), baziChart(at(1985, 7, 20, 12, 0, 'female')), 2026)
  check('with a real noon birth the 時柱 does count (5/5)', known.dimensions.find(x => x.key === 'spread')!.detail.includes('5/5'))
}
{
  const a = baziChart(unknown(2000, 2, 4)), b = baziChart(at(1990, 1, 1, 15, 25, 'female'))
  const m = heMatch(a, b, 2026)
  const year = m.dimensions.find(x => x.key === 'yearBranch')!, month = m.dimensions.find(x => x.key === 'monthBranch')!
  check('an undecided pillar marks its dimensions undecided, with both details', !!year.undecided && !!month.undecided && year.detail.includes('或') && month.detail.includes('或'))
  const lo = m.range?.[0] ?? m.overall, hi = m.range?.[1] ?? m.overall
  check('the total is a range or a single agreed value', lo <= m.overall && m.overall <= hi)
  const facts = yuelaoFacts(a, 'male', b, 'female', m)
  check('…and the teacher is handed the same range', m.range ? facts.includes(`${m.range[0]}–${m.range[1]}`) : facts.includes(`總分：${m.overall}`))
  check('the facts say what the score is and is not', facts.includes('不是對兩人關係的驗證'))
}

// ── Every temple that takes a birth says the same about an unknown hour ─────
{
  const c = baziChart(unknown(2000, 2, 4, 'female'))
  const ln = liuNian(c, 2000, 2026)
  const wish = simianfoFacts(c, 'female', true, { career: '升職' }, ln)
  const bing = bingGaoFacts({ name: '測試' }, c, 'female', true, ln)
  check('四面佛 and 求籤 facts: no 12:00, both readings', [wish, bing].every(f => !/12:00/.test(f) && f.includes('己卯或庚辰')))
}

// ── Script: what the 繁體 page shows ─────────────────────────────────────────
{
  const c = baziChart(at(1990, 1, 1, 15, 25))
  check('納音 in traditional script (澗下水, not 涧下水)', c.pillars.month.naYin === '澗下水' && !JSON.stringify(c).includes('涧'))
  check('lunar month in traditional script (臘月)', c.lunar.includes('臘') && !c.lunar.includes('腊'))
}

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`)
process.exit(fails === 0 ? 0 : 1)
