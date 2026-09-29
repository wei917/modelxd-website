// scripts/test-xtell-sukuyo.ts — 宿曜占星術 (lib/sukuyo.ts), against a
// published 宿曜 calendar.   npx tsx scripts/test-xtell-sukuyo.ts
import fs from 'node:fs'
import path from 'node:path'
import { shukuOf, shukuOn, relationOf, sukuyoChart, sukuyoFacts, asPartnerDate, RELATION } from '../lib/sukuyo'
import { SK_WORDS, SHUKU_ZH } from '../lib/sukuyo-words'
import { STRINGS } from '../lib/i18n'
import { liveFeature } from '../lib/xtell-catalog'

let fails = 0
const check = (name: string, cond: boolean, extra = '') => { if (!cond) { fails++; console.log('FAIL', name, extra) } else console.log('ok  ', name) }
const name = (i: number) => SHUKU_ZH[i]

check('each lunar month starts on its fixed 宿: 1月 室, 2月 奎, 3月 胃, 4月 畢, 12月 虚', [1, 2, 3, 4, 12].map(m => name(shukuOf(m, 1))).join('') === '室宿奎宿胃宿畢宿虛宿')
// rekichu.com's 2026 January: 1/18 虚, 1/19 虚 (旧暦12月1日), 1/20 危, 1/21 室, 1/22 壁, 1/25 胃, 1/26 昴, 1/27 畢, 1/28 觜, 1/29 参.
const jan = [18, 19, 20, 21, 22, 25, 26, 27, 28, 29].map(d => name(shukuOn(2026, 1, d).index)).join(' ')
check('2026 January matches the published 宿曜 calendar, across the 12月1日 boundary', jan === '虛宿 虛宿 危宿 室宿 壁宿 胃宿 昴宿 畢宿 觜宿 參宿', jan)
check('1990-01-01 (農曆12月5日) is 奎宿', name(shukuOn(1990, 1, 1).index) === '奎宿' && shukuOn(1990, 1, 1).lunar.month === 12 && shukuOn(1990, 1, 1).lunar.day === 5)
check('三九の秘法: 命 at 0, 業 at 9, 胎 at 18, and 栄 衰 安 危 成 壊 友 親 in each nine', RELATION[0] === '命' && RELATION[9] === '業' && RELATION[18] === '胎' && RELATION.slice(1, 9).join('') === '栄衰安危成壊友親' && RELATION.slice(10, 18).join('') === '栄衰安危成壊友親' && RELATION.slice(19).join('') === '栄衰安危成壊友親')
check('relations run around the ring', relationOf(26, 0) === '栄' && relationOf(0, 26) === '親' && relationOf(5, 5) === '命')
const c = sukuyoChart({ y: 1990, m: 1, d: 1 }, '2026-09-29', '1992-06-15')
check('a pair reads the same from both sides (友 and 衰 make 友衰)', c.partner!.fromMe === '衰' && c.partner!.fromThem === '友' && c.partner!.pair === '友衰')
check('the ring holds all twenty-seven, 命 on one\'s own', c.ring.length === 27 && c.ring[c.own.index] === '命')
check('without a partner, no partner', sukuyoChart({ y: 1990, m: 1, d: 1 }, '2026-09-29').partner === undefined)
const f = sukuyoFacts(c)
check('the teacher gets the mansions, today, the pair and the convention', ['本命宿：奎宿', '今天（2026-09-29', '友衰', '三九祕法', '空海', '慣例'].every(w => f.includes(w)), f.slice(0, 160))
const leapBirth = [...Array(400)].map((_, i) => new Date(Date.UTC(2025, 0, 1) + i * 864e5)).find(d => shukuOn(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()).lunar.leap)!
check('a leap-month birth is flagged for the teacher', sukuyoFacts(sukuyoChart({ y: leapBirth.getUTCFullYear(), m: leapBirth.getUTCMonth() + 1, d: leapBirth.getUTCDate() }, '2026-09-29')).includes('閏月'))
const now = Date.UTC(2026, 8, 29, 12)
check('a partner date: real, 1900 to today, else none', asPartnerDate('1992-06-15', now) === '1992-06-15' && asPartnerDate('2026-10-01', now) === null && asPartnerDate('1992-02-30', now) === null && asPartnerDate('1899-12-31', now) === null && asPartnerDate(42, now) === null)
check('words in five languages: 27 mansions, 11 relations, 6 pairs', Object.values(SK_WORDS).every(w => w.shuku.length === 27 && Object.keys(w.rel).length === 11 && Object.keys(w.pair).length === 6 && Object.values(w.rel).every(Boolean)))
const S = STRINGS as any, LANGS = ['en', 'zh-Hant', 'zh-Hans', 'ja', 'ko']
const keys = Object.keys(S).filter(k => /^xtell\.(sk\.|sukuyo\.|q\.sukuyo\.|site\.focus\.sukuyo\.|saved\.notasked\.sukuyo|sum\.sukuyo)/.test(k))
check(`${keys.length} 宿曜 strings, all in five languages, a meaning for every kind of day`, keys.length >= 40 && keys.every(k => LANGS.every(l => typeof S[k][l] === 'string' && S[k][l].trim())) && ['命', '栄', '衰', '安', '危', '成', '壊', '友', '親', '業', '胎'].every(r => S[`xtell.sk.day.${r}`]))
check('the guide can open it', liveFeature('sukuyo')?.temple === 'sukuyo')
const chartRoute = fs.readFileSync(path.join(__dirname, '..', 'app/api/xtell/chart/route.ts'), 'utf8')
const readingRoute = fs.readFileSync(path.join(__dirname, '..', 'app/api/xtell/reading/route.ts'), 'utf8')
check('the chart and the teacher use the same date and partner', chartRoute.includes('sukuyoChart(body.birth, (body.today = asToday(body?.today)), (body.partner = asPartnerDate(body?.partner) ?? undefined))') && readingRoute.includes('sukuyoFacts(sukuyoChart(body.birth, asToday(body?.today), asPartnerDate(body?.partner)))') && chartRoute.includes("'today', 'partner'] as const"))
console.log(fails ? `\n${fails} FAILED` : '\nall 宿曜 checks passed')
if (fails) process.exit(1)
