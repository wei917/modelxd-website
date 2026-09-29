// scripts/test-today.ts — the street's almanac card (lib/xtell-almanac.ts):
// the 2026-09-27 page read by hand, and every term the library can print
// in 繁體.
//   npx tsx scripts/test-today.ts

import { LunarUtil } from 'lunar-typescript'
import { almanacFor, toHant } from '../lib/xtell-almanac'
import { YIJI, PENGZU, JIEQI_KO, ZHIXING_KO } from '../lib/xtell-almanac-terms'
import { almanacWindow, cachedAlmanac, almanacForZone, validAlmanacDate } from '../lib/xtell-almanac-server'
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
  // Japanese, Korean and English pages (Sep 29): no raw Chinese almanac terms.
  const terms = [...new Set(LunarUtil.YI_JI.filter(w => w && !/[.{}]/.test(w)).map(toHant))].filter(w => w !== '無')
  const noJaKo = terms.filter(w => !YIJI[w]?.ja?.trim() || !YIJI[w]?.ko?.trim())
  check(`every one of the ${terms.length} 宜忌 terms has Japanese and Korean`, noJaKo.length === 0 && terms.length >= 140, noJaKo.join(' '))
  const lines = [...LunarUtil.PENGZU_GAN, ...LunarUtil.PENGZU_ZHI].filter(Boolean).map(toHant)
  check(`all ${lines.length} 彭祖百忌 lines in Japanese, Korean and English`, lines.length === 22 && lines.every(l => PENGZU[l]?.ja && PENGZU[l]?.ko && PENGZU[l]?.en))
  check('the 24 solar terms and 12 day officers in Hangul', LunarUtil.JIE_QI.filter(Boolean).map(toHant).every(j => JIEQI_KO[j]) && LunarUtil.ZHI_XING.filter(Boolean).map(toHant).every(z => ZHIXING_KO[z]))
  const ja = almanacFor('2026-09-27', 'ja'), ko = almanacFor('2026-09-27', 'ko')
  check('Japanese 2026-09-27: 結婚, 結納 … 開店・仕事始め; 彭祖 as sayings; no spirit lists', ja.yi.includes('結婚') && ja.yi.includes('結納') && ja.ji.includes('開店・仕事始め') && ja.pengZu[0] === '甲の日は倉を開けない（財が散る）' && ja.jiShen.length === 0 && ja.xiongSha.length === 0, JSON.stringify(ja.yi))
  check('Korean 2026-09-27: 결혼 … 개업, 추분 → 한로, 위, 남쪽', ko.yi.includes('결혼') && ko.ji.includes('개업') && ko.jieQi.name === '추분' && ko.nextJieQi.name === '한로' && ko.zhiXing === '위' && ko.sha === '남')
  check('English 彭祖百忌 in English; no spirit lists', en.pengZu[0].startsWith('A 甲 day') && en.jiShen.length === 0 && en.xiongSha.length === 0)
  check('a Japanese calendar\'s forms: 啓蟄, 十二直 納', almanacFor('2026-03-06', 'ja').jieQi.name === '啓蟄' && Array.from({ length: 14 }, (_, i) => almanacFor(`2026-10-${String(i + 1).padStart(2, '0')}`, 'ja').zhiXing).includes('納'))
  {
    const jaWords = new Set(Object.values(YIJI).map(v => v.ja)), koWords = new Set(Object.values(YIJI).map(v => v.ko))
    const jaLines = new Set(Object.values(PENGZU).map(v => v.ja)), koLines = new Set(Object.values(PENGZU).map(v => v.ko))
    let raw = ''
    for (let i = 0; i < 400 && !raw; i++) {
      const d = new Date(Date.UTC(2026, 0, 1) + i * 86400_000).toISOString().slice(0, 10)
      const j = almanacFor(d, 'ja'), k = almanacFor(d, 'ko')
      if (![...j.yi, ...j.ji].every(w => jaWords.has(w)) || ![...k.yi, ...k.ji].every(w => koWords.has(w)) || !j.pengZu.every(l => jaLines.has(l)) || !k.pengZu.every(l => koLines.has(l))) raw = d
    }
    check('400 days of Japanese and Korean almanacs: every 宜忌 and 彭祖 line translated', !raw, raw)
  }
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

// ── Computed on the server, cached for the three live dates (Sep 28) ────────
{
  const now = Date.UTC(2026, 8, 27, 20, 0)   // 2026-09-27 20:00 UTC = 9/28 04:00 in Taipei
  check('the window is the three dates anyone can be living', almanacWindow(now).join() === '2026-09-26,2026-09-27,2026-09-28')
  const a1 = cachedAlmanac('2026-09-27', 'zh-Hant', now), a2 = cachedAlmanac('2026-09-27', 'zh-Hant', now)
  check('a live date is computed once and kept', a1 === a2 && a1.dayGz === '甲辰')
  check('a date outside the window is computed fresh, not kept', cachedAlmanac('2026-01-01', 'zh-Hant', now) !== cachedAlmanac('2026-01-01', 'zh-Hant', now))
  check('Taipei is already on 9/28 while New York is on 9/27', almanacForZone('Asia/Taipei', 'zh-Hant', now)!.date === '2026-09-28' && almanacForZone('America/New_York', 'en', now)!.date === '2026-09-27')
  check('Kiritimati (UTC+14) and Baker-adjacent Pago Pago (UTC-11) stay inside the window', almanacWindow(now).includes(almanacForZone('Pacific/Kiritimati', 'en', now)!.date) && almanacWindow(now).includes(almanacForZone('Pacific/Pago_Pago', 'en', now)!.date))
  check('no zone, or a bad one: no almanac (the card asks the API)', almanacForZone(null, 'en', now) === null && almanacForZone('Mars/Olympus', 'en', now) === null)
  check('the next UTC day drops the date that left the window', (() => { const later = now + 2 * 86_400_000; cachedAlmanac('2026-09-29', 'en', later); return cachedAlmanac('2026-09-27', 'zh-Hant', later) !== a1 })())
  check('dates: real calendar days the library covers', validAlmanacDate('2026-09-28') && !validAlmanacDate('2026-02-30') && !validAlmanacDate('1850-01-01') && !validAlmanacDate('2026-9-28') && !validAlmanacDate(20260928))
}

// ── /api/xtell/almanac ─────────────────────────────────────────────────────
async function route() {
  const { GET } = await import('../app/api/xtell/almanac/route')
  const get = async (q: string) => { const r = await GET(new Request(`http://t/api/xtell/almanac?${q}`)); return { status: r.status, cache: r.headers.get('cache-control') ?? '', d: await r.json() as any } }
  const ok = await get('date=2026-09-27&lang=ja')
  check('route: a day in a language, cacheable by the CDN', ok.status === 200 && ok.d.almanac.date === '2026-09-27' && ok.d.almanac.chong.animal === '犬' && /s-maxage=86400/.test(ok.cache))
  check('route: a bad date or language is refused', (await get('date=2026-13-01&lang=en')).status === 400 && (await get('date=2026-09-27&lang=fr')).status === 400 && (await get('lang=en')).status === 400)
}

// ── Strings ────────────────────────────────────────────────────────────────
{
  const keys = Object.keys(STRINGS).filter(k => k.startsWith('xtell.today.'))
  check(`${keys.length} card strings, all in five languages`, keys.length >= 14 && keys.every(k => LANGS.every(l => typeof (STRINGS as any)[k][l] === 'string' && (STRINGS as any)[k][l].trim())), keys.filter(k => !LANGS.every(l => (STRINGS as any)[k][l])).join())
}

route().then(() => {
  console.log(fails ? `\n${fails} FAILED` : '\nall today checks passed')
  if (fails) process.exit(1)
}).catch(e => { console.error(e); process.exit(1) })
