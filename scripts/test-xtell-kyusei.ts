// scripts/test-xtell-kyusei.ts — 九星気学 (lib/kyusei.ts), against values any
// 九星 calendar prints.   npx tsx scripts/test-xtell-kyusei.ts
import fs from 'node:fs'
import path from 'node:path'
import { yearStar, monthStar, board, directions, kyuseiChart, kyuseiFacts, asToday, suits } from '../lib/kyusei'
import { KY_WORDS, DIRS } from '../lib/kyusei-words'
import { STRINGS } from '../lib/i18n'
import { liveFeature } from '../lib/xtell-catalog'

let fails = 0
const check = (name: string, cond: boolean, extra = '') => { if (!cond) { fails++; console.log('FAIL', name, extra) } else console.log('ok  ', name) }

check('year stars: 1985 六白, 1990 一白, 2024 三碧, 2025 二黒, 2026 一白, 2027 九紫', [1985, 1990, 2024, 2025, 2026, 2027].map(yearStar).join(' ') === '6 1 3 2 1 9')
check('month stars: a 一白 year starts 寅 at 八白 (酉 is 一白); 二黒 years at 二黒 (丑 is 九紫); 三碧 years at 五黄', monthStar(1, '寅') === 8 && monthStar(1, '酉') === 1 && monthStar(2, '寅') === 2 && monthStar(2, '丑') === 9 && monthStar(3, '寅') === 5)
const b26 = board(1)
check('2026 board (一白 in the centre): 北西 二黒, 西 三碧, 北東 四緑, 南 五黄, 北 六白, 南西 七赤, 東 八白, 南東 九紫', [b26.NW, b26.W, b26.NE, b26.S, b26.N, b26.SW, b26.E, b26.SE].join('') === '23456789')
const d26 = directions(1, '午', 6, 1)
check('2026 for a 六白: 五黄殺 南, 暗剣殺 北, 歳破 北, 本命殺 北, 的殺 南; good 東・南西・北西, best 南西', d26.goou === 'S' && d26.anken === 'N' && d26.ha === 'N' && d26.honmei === 'N' && d26.honmeiTeki === 'S' && d26.good.join() === 'E,SW,NW' && d26.best.join() === 'SW', JSON.stringify(d26))
const own = directions(1, '午', 1, 5)
check('一白 in 2026: its own star in the centre, 八方塞がり, no good direction', own.blocked && own.good.length === 0 && own.honmei === null)
check('五黄 never suits, even an earth star', !suits(2, 5) && suits(2, 8) && suits(1, 7) && !suits(1, 9))
const c = kyuseiChart({ y: 1985, m: 7, d: 1, h: 9, mi: 0 }, '2026-09-29')
check('1985-07-01: 本命星 六白, 月命星 一白; this year 2026 and month 酉', c.honmei === 6 && c.getsumei === 1 && c.year.year9 === 2026 && c.month.branch === '酉' && !c.boundary.year && !c.boundary.month)
const early = kyuseiChart({ y: 1990, m: 1, d: 20, h: 12, mi: 0 }, '2026-01-20')
check('before 立春 is the year before: 1990-01-20 is 二黒, and 2026-01-20 is still the 2025 board', early.honmei === 2 && early.year.year9 === 2025 && early.year.center === 2)
const onLc = kyuseiChart({ y: 1990, m: 2, d: 4, hourUnknown: true }, '2026-09-29')
check('born on 立春 day, hour unknown: the new year (一白) with 二黒 kept as the other side', onLc.honmei === 1 && onLc.boundary.year === 2 && onLc.boundary.month !== null)
check('a plain day has no boundary', kyuseiChart({ y: 1990, m: 5, d: 20, h: 9, mi: 0 }, '2026-09-29').boundary.year === null)
const facts = kyuseiFacts(c)
check('the teacher gets both stars, both boards, the unlucky and lucky directions, and the convention', ['本命星：六白金星', '月命星：一白水星', '今年（2026 年', '五黃殺 南', '暗劍殺 北', '吉方位', '園田真次郎', '慣例'].every(w => facts.includes(w)), facts.slice(0, 200))
check('八方塞 is said as holding still, not an omen', kyuseiFacts(kyuseiChart({ y: 1990, m: 5, d: 20, h: 9, mi: 0 }, '2026-09-29')).includes('八方塞') && kyuseiFacts(kyuseiChart({ y: 1990, m: 5, d: 20, h: 9, mi: 0 }, '2026-09-29')).includes('不是凶兆'))
const now = Date.UTC(2026, 8, 29, 12)
check('the visit date: a real date up to two days ahead, else today', asToday('2026-09-29', now) === '2026-09-29' && asToday('2026-10-01', now) === '2026-10-01' && asToday('2026-10-05', now) === '2026-09-29' && asToday('2026-02-30', now) === '2026-09-29' && asToday(null, now) === '2026-09-29' && asToday('1990-01-01', now) === '1990-01-01')
check('board words in five languages: nine stars, nine places, seven marks', Object.values(KY_WORDS).every(w => w.star.length === 10 && w.short.length === 10 && [...DIRS, 'C'].every(d => (w.dir as any)[d]) && Object.keys(w.tag).length === 7))
const S = STRINGS as any, LANGS = ['en', 'zh-Hant', 'zh-Hans', 'ja', 'ko']
const keys = Object.keys(S).filter(k => /^xtell\.(ky\.|kyusei\.|q\.kyusei\.|site\.focus\.kyusei\.|saved\.notasked\.kyusei|sum\.kyusei)/.test(k))
check(`${keys.length} 九星 strings, all in five languages`, keys.length >= 25 && keys.every(k => LANGS.every(l => typeof S[k][l] === 'string' && S[k][l].trim())))
check('the guide can open it', liveFeature('kyusei')?.temple === 'kyusei')
const chartRoute = fs.readFileSync(path.join(__dirname, '..', 'app/api/xtell/chart/route.ts'), 'utf8')
const readingRoute = fs.readFileSync(path.join(__dirname, '..', 'app/api/xtell/reading/route.ts'), 'utf8')
check('the chart and the teacher use the same visit date', chartRoute.includes("kyuseiChart(body.birth, (body.today = asToday(body?.today)))") && readingRoute.includes('kyuseiFacts(kyuseiChart(body.birth, asToday(body?.today)))') && chartRoute.includes("'crack', 'today'] as const"))
console.log(fails ? `\n${fails} FAILED` : '\nall 九星 checks passed')
if (fails) process.exit(1)
