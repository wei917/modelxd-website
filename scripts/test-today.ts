// scripts/test-today.ts — the street's "today" cards: the Chinese almanac
// (lib/xtell-almanac.ts) and the Indian calendar (lib/panchang.ts).
// Independent expectations: astronomy-engine's own full/new moon search for
// the tithi boundaries, the 九曜 chart's nakshatra for the same instant, the
// textbook Rahu Kalam rule, and the 2026-09-27 almanac page read by hand.
//   npx tsx scripts/test-today.ts

import * as A from 'astronomy-engine'
import { LunarUtil } from 'lunar-typescript'
import { almanacFor, toHant } from '../lib/xtell-almanac'
import { panchangAt, sunDay, karanaName } from '../lib/panchang'
import { jyotishChart } from '../lib/jyotish'
import { STRINGS } from '../lib/i18n'

let fails = 0
const check = (name: string, cond: boolean, extra = '') => { if (!cond) { fails++; console.log('FAIL', name, extra) } else console.log('ok  ', name) }
const LANGS = ['en', 'zh-Hant', 'zh-Hans', 'ja', 'ko'] as const

// ── Almanac ────────────────────────────────────────────────────────────────
{
  const a = almanacFor('2026-09-27', 'zh-Hant')
  check('2026-09-27: 農曆八月十七, 丙午年屬馬, 甲辰日', a.lunarDate === '八月十七' && a.yearGz === '丙午' && a.animal === '馬' && a.dayGz === '甲辰' && a.weekday === 0)
  check('宜 嫁娶 納采 … 忌 開市 開倉 安門 安葬, in 繁體', a.yi.slice(0, 3).join() === '嫁娶,納采,訂盟' && a.ji.join() === '開市,開倉,安門,安葬')
  check('沖狗（戊戌）煞南, 值日 危, 秋分 9/23 → 寒露 10/8', a.chong.animal === '狗' && a.chong.ganzhi === '戊戌' && a.sha === '南' && a.zhiXing === '危' && a.jieQi.name === '秋分' && a.jieQi.date === '2026-09-23' && a.nextJieQi.name === '寒露' && a.nextJieQi.date === '2026-10-08')
  check('the fold: 值神 天刑 (凶), 星宿 虛 (凶), 彭祖百忌 in 繁體', a.tianShen.name === '天刑' && !a.tianShen.lucky && a.xiu.name === '虛' && !a.xiu.lucky && a.pengZu[0] === '甲不開倉財物耗散')
  const hans = almanacFor('2026-09-27', 'zh-Hans')
  check('简体 pages keep the library\'s own forms', hans.yi.includes('纳采') && hans.ji.includes('开市') && hans.jiShen.includes('母仓'))
  const en = almanacFor('2026-09-27', 'en')
  check('English: the library\'s English, its misspelling fixed', en.yi.includes('Marriage') && en.yi.includes('Consecration') && !en.yi.includes('Consecretion') && en.chong.animal === 'Dog' && en.sha === 'South' && en.lunarDate === '8/17' && en.animal === 'Horse')
  check('Japanese and Korean name the animals their own way', almanacFor('2026-09-27', 'ja').chong.animal === '犬' && almanacFor('2026-09-27', 'ko').chong.animal === '개' && almanacFor('2026-09-27', 'ko').animal === '말')
  check('a leap month is marked', almanacFor('2025-07-30', 'zh-Hant').lunarDate.startsWith('閏六月') && almanacFor('2025-07-30', 'en').lunarDate.startsWith('leap 6/'))
  check('where one simplified form is two traditional ones', toHant('益后') === '益後' && toHant('天后') === '天后' && toHant('理发') === '理髮' && toHant('馀事勿取') === '餘事勿取' && toHant('谷雨') === '穀雨' && toHant('复日') === '復日' && toHant('己不破券二比并亡') === '己不破券二比並亡')
  // Every character the library's almanac vocabulary can print, converted:
  // none of the simplified forms the table knows may survive into 繁體.
  const vocab = [...LunarUtil.YI_JI, ...LunarUtil.SHEN_SHA, ...LunarUtil.TIAN_SHEN, ...LunarUtil.ZHI_XING, ...LunarUtil.SHENGXIAO, ...LunarUtil.PENGZU_GAN, ...LunarUtil.PENGZU_ZHI, ...LunarUtil.JIE_QI].filter(w => w && !/[.{}]/.test(w))
  const SIMPLIFIED = '开绘齐斋庙谢订纳问归宁帐进坟启钻寿殓门动竖坏补盖厕仓涂桥筑扫饰墙马挂财买车产佣货经络酝酿铸种渔结网养习艺学发见贵针猎会亲医词讼库疗诸馀丧断蚁无鸣将对时阴气匮龙续仪宝临护驿阳圣愿虚离复贼祸败厌摇击陈专灾触风废穷错鸟岁阵冲单绝纯满执闭鸡猪长张织酱尝难敌强带还乡远药肠颠惊蛰谷处毕轸娄东腊并疮头机参闰'
  const left = vocab.map(toHant).join('').split('').filter(c => SIMPLIFIED.includes(c))
  check(`all ${vocab.length} almanac terms come out in 繁體`, left.length === 0, [...new Set(left)].join(''))
  let bad = ''
  for (let i = 0; i < 400 && !bad; i++) {
    const d = new Date(Date.UTC(2026, 0, 1) + i * 86400_000).toISOString().slice(0, 10)
    const x = almanacFor(d, 'zh-Hant')
    const all = [x.lunarDate, x.animal, ...x.yi, ...x.ji, x.chong.animal, x.sha, x.zhiXing, x.tianShen.name, x.xiu.name, ...x.jiShen, ...x.xiongSha, ...x.pengZu, x.jieQi.name, x.nextJieQi.name].join('')
    if ([...all].some(c => SIMPLIFIED.includes(c)) || /[.{}]/.test(all) || !x.yi.length && !x.ji.length) bad = d
  }
  check('400 days of 繁體 almanac: no simplified forms, no placeholders, never empty', !bad, bad)
}

// ── Panchang ───────────────────────────────────────────────────────────────
{
  // Purnima ends at the full moon and Amavasya at the new moon, by the
  // tithi's own definition (the Moon–Sun angle reaching 180° and 360°).
  let worst = 0, bad = ''
  let t = new Date('2026-01-01T00:00:00Z')
  for (let i = 0; i < 6; i++) {
    const full = A.SearchMoonPhase(180, t, 40)!.date, fresh = A.SearchMoonPhase(0, full, 40)!.date
    const p = panchangAt(new Date(full.getTime() - 2 * 3600_000)), q = panchangAt(new Date(fresh.getTime() - 2 * 3600_000))
    if (p.tithi.name !== 'Purnima' || !p.tithi.waxing || q.tithi.name !== 'Amavasya' || q.tithi.waxing) bad = full.toISOString()
    worst = Math.max(worst, Math.abs(p.tithi.ends.getTime() - full.getTime()), Math.abs(q.tithi.ends.getTime() - fresh.getTime()))
    t = fresh
  }
  check('six months: Purnima ends at each full moon, Amavasya at each new moon, within a minute', !bad && worst < 60_000, `${bad} worst ${worst / 1000}s`)
  const at = new Date('2026-09-27T04:00:00Z')
  const chart = jyotishChart({ y: 2026, m: 9, d: 27, h: 12, mi: 0, lat: 25.03, lon: 121.57, tz: 'Asia/Taipei', place: 'taipei' })
  check('the Moon\'s nakshatra matches the 九曜 chart for the same instant', panchangAt(at).nakshatra.index === chart.moonNakshatra)
  const p = panchangAt(at)
  check('every limb ends in the future, within about a day', [p.tithi, p.nakshatra, p.yoga, p.karana].every(l => l.ends > at && l.ends.getTime() - at.getTime() < 30 * 3600_000))
  check('karana names: Kimstughna, the seven movable ones in turn, then the three fixed', karanaName(0) === 'Kimstughna' && karanaName(1) === 'Bava' && karanaName(7) === 'Vishti' && karanaName(8) === 'Bava' && karanaName(56) === 'Vishti' && karanaName(57) === 'Shakuni' && karanaName(58) === 'Chatushpada' && karanaName(59) === 'Naga')
  const sun = sunDay('2026-09-27', 'Asia/Taipei', 25.03, 121.57)
  const hm = (d: Date | null) => d ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit' }).format(d) : ''
  check('Taipei 2026-09-27: sunrise 05:44, sunset 17:45', hm(sun.sunrise) === '05:44' && hm(sun.sunset) === '17:45', `${hm(sun.sunrise)} ${hm(sun.sunset)}`)
  check('Sunday\'s Rahu Kalam is the last eighth of daylight', sun.weekday === 0 && !!sun.rahu && sun.rahu[1].getTime() === sun.sunset!.getTime() && Math.abs((sun.sunset!.getTime() - sun.rahu[0].getTime()) * 8 - (sun.sunset!.getTime() - sun.sunrise!.getTime())) < 1000)
  const mon = sunDay('2026-09-28', 'Asia/Taipei', 25.03, 121.57)
  const eighth = (mon.sunset!.getTime() - mon.sunrise!.getTime()) / 8
  check('Monday\'s is the second eighth', mon.weekday === 1 && Math.abs(mon.rahu![0].getTime() - (mon.sunrise!.getTime() + eighth)) < 1000)
  check('polar night: no sunrise, no Rahu Kalam, no error', sunDay('2026-12-21', 'Arctic/Longyearbyen', 78.2, 15.6).rahu === null)
}

// ── Strings ────────────────────────────────────────────────────────────────
{
  const keys = Object.keys(STRINGS).filter(k => k.startsWith('xtell.today.'))
  check(`${keys.length} card strings, all in five languages`, keys.length >= 45 && keys.every(k => LANGS.every(l => typeof (STRINGS as any)[k][l] === 'string' && (STRINGS as any)[k][l].trim())), keys.filter(k => !LANGS.every(l => (STRINGS as any)[k][l])).join())
  check('the weekday rulers exist as planet names', ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn'].every(p => LANGS.every(l => (STRINGS as any)[`xtell.pl.${p}`]?.[l])))
}

console.log(fails ? `\n${fails} FAILED` : '\nall today checks passed')
if (fails) process.exit(1)
