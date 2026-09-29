// lib/xtell-almanac.ts — today's Chinese almanac (黃曆 / 農民曆) for the
// XTell street (owner, Sep 27): the lunar date, the day's 干支, what the
// day is 宜 and 忌 for, the clash and 煞 direction, the day officer (建除),
// the day's 值神 and 星宿, the solar term, and in the fold the 吉神 / 凶煞
// and 彭祖百忌.
//
// All of it comes from the calendar library the temples already use
// (lunar-typescript, 6tail's almanac tables), from the date alone: no
// birthday, no location, no model, free. It prints Simplified Chinese (and
// English for some fields); 繁體 pages get the Traditional forms through the
// table below, which covers every character the library's almanac
// vocabulary can print (scripts/test-today.ts holds that). Japanese and
// Korean pages get the 宜忌, 彭祖百忌, solar terms and 十二直 in their own
// language (lib/xtell-almanac-terms.ts, Sep 29); English pages the library's
// English where it has one and 彭祖百忌 from the same file.
//
// Client-safe and synchronous. The library's language switch is global;
// it is flipped and restored inside one synchronous call, so nothing else
// can observe it.

import { Solar, I18n } from 'lunar-typescript'
import type { Lang } from './lang'
import { YIJI, PENGZU, JIEQI_JA, JIEQI_KO, ZHIXING_JA, ZHIXING_KO, SHA_KO, ROKUYO_JA, japaneseLuckyDays } from './xtell-almanac-terms'

/** Simplified → Traditional for the almanac's vocabulary. Character by
 *  character is safe here except where one simplified form stands for two
 *  traditional ones; those are phrases below (益后 → 益後, but 天后 stays). */
const HANT_CHARS = '开開绘繪齐齊斋齋庙廟谢謝订訂纳納问問归歸宁寧帐帳进進坟墳启啟钻鑽寿壽殓殮门門动動竖豎坏壞补補盖蓋厕廁仓倉涂塗桥橋筑築扫掃饰飾墙牆马馬挂掛财財买買车車产產佣傭货貨经經络絡酝醞酿釀铸鑄种種渔漁结結网網养養习習艺藝学學发髮见見贵貴针針猎獵会會亲親医醫词詞讼訟库庫疗療诸諸馀餘丧喪断斷蚁蟻无無鸣鳴将將对對时時阴陰气氣匮匱龙龍续續仪儀宝寶临臨护護驿驛阳陽圣聖愿願虚虛离離复復贼賊祸禍败敗厌厭摇搖击擊陈陳专專灾災触觸风風废廢穷窮错錯鸟鳥岁歲阵陣冲沖单單绝絕纯純满滿执執闭閉鸡雞猪豬长長张張织織酱醬尝嘗难難敌敵强強带帶还還乡鄉远遠药藥肠腸颠顛惊驚蛰蟄谷穀处處毕畢轸軫娄婁东東腊臘并並疮瘡头頭机機参參闰閏'
const HANT = new Map<string, string>()
for (let i = 0; i < HANT_CHARS.length; i += 2) HANT.set(HANT_CHARS[i], HANT_CHARS[i + 1])
const HANT_PHRASES: Array<[string, string]> = [['益后', '益後']]

export function toHant(s: string): string {
  let out = s
  for (const [a, b] of HANT_PHRASES) out = out.split(a).join(b)
  return [...out].map(c => HANT.get(c) ?? c).join('')
}

/** The zodiac animals in Japanese and Korean use (the library prints the
 *  Chinese animal; 狗 and 豬 are not what a Japanese calendar says). */
const ANIMAL: Record<'ja' | 'ko', Record<string, string>> = {
  ja: { 狗: '犬', 雞: '鶏', 豬: '猪' },
  ko: { 鼠: '쥐', 牛: '소', 虎: '호랑이', 兔: '토끼', 龍: '용', 蛇: '뱀', 馬: '말', 羊: '양', 猴: '원숭이', 雞: '닭', 狗: '개', 豬: '돼지' },
}
const animalIn = (hant: string, lang: Lang) => lang === 'ja' || lang === 'ko' ? ANIMAL[lang][hant] ?? hant : hant

/** The library's English, with its one known misspelling fixed. */
const EN_FIX: Record<string, string> = { Consecretion: 'Consecration' }

export type Almanac = {
  /** The visitor's local date the almanac is for (YYYY-MM-DD), 0 = Sunday. */
  date: string
  weekday: number
  /** 八月十七 / 閏六月初三 — in the page's script (English: 8/17). */
  lunarDate: string
  yearGz: string
  monthGz: string
  dayGz: string
  /** The year's animal, in the page's language. */
  animal: string
  yi: string[]
  ji: string[]
  /** The animal the day clashes with and that branch's 干支; the 煞 direction. */
  chong: { animal: string; ganzhi: string }
  sha: string
  /** 建除十二值星 (建, 除, 滿 …). */
  zhiXing: string
  tianShen: { name: string; lucky: boolean }
  xiu: { name: string; lucky: boolean }
  jiShen: string[]
  xiongSha: string[]
  pengZu: [string, string]
  /** The solar term in force, and the next one, each with its date. */
  jieQi: { name: string; date: string }
  nextJieQi: { name: string; date: string }
  /** Japanese pages only: the day's 六曜, and the lucky days a Japanese
   *  calendar marks (天赦日, 一粒万倍日), each with a few words on it. */
  rokuyo?: string
  luckyDays?: string[]
}

const clean = (xs: string[]) => xs.filter(x => x && !/[.{}]/.test(x) && x !== '无' && x !== 'None')

/** The almanac for a local date (YYYY-MM-DD), in the page's language. */
export function almanacFor(date: string, lang: Lang): Almanac {
  const [y, m, d] = date.split('-').map(Number)
  const solar = Solar.fromYmd(y, m, d)
  const lunar = solar.getLunar()
  const hans = lang === 'zh-Hans'
  const zh = (s: string) => hans ? s : toHant(s)
  const prev = lunar.getPrevJieQi(true), next = lunar.getNextJieQi(true)
  const base = {
    date,
    weekday: solar.getWeek(),
    yearGz: lunar.getYearInGanZhi(),
    monthGz: lunar.getMonthInGanZhi(),
    dayGz: lunar.getDayInGanZhi(),
    tianShen: { name: zh(lunar.getDayTianShen()), lucky: lunar.getDayTianShenLuck() === '吉' },
    jiShen: clean(lunar.getDayJiShen()).map(zh),
    xiongSha: clean(lunar.getDayXiongSha()).map(zh),
    pengZu: [zh(lunar.getPengZuGan()), zh(lunar.getPengZuZhi())] as [string, string],
    jieQi: { name: zh(prev.getName()), date: prev.getSolar().toYmd() },
    nextJieQi: { name: zh(next.getName()), date: next.getSolar().toYmd() },
  }
  const month = lunar.getMonthInChinese(), day = lunar.getDayInChinese()
  if (lang === 'ja' || lang === 'ko') {
    // In the page's language (Sep 29, a Japanese tester: 「祭祀、冠笄、餘事勿取」
    // meant nothing there): the 宜忌 activities, 彭祖百忌, the solar terms
    // and 十二直 from lib/xtell-almanac-terms.ts. The 吉神 / 凶煞 lists stay
    // on Chinese pages: spirit names say nothing, translated or not.
    const word = (x: string) => YIJI[x]?.[lang] ?? x
    const term = (x: string) => (lang === 'ja' ? JIEQI_JA[x] : JIEQI_KO[x]) ?? x
    const zhi = zh(lunar.getZhiXing())
    return {
      ...base,
      lunarDate: zh(`${month}月${day}`),
      animal: animalIn(zh(lunar.getYearShengXiao()), lang),
      yi: clean(lunar.getDayYi()).map(zh).map(word),
      ji: clean(lunar.getDayJi()).map(zh).map(word),
      chong: { animal: animalIn(zh(lunar.getDayChongShengXiao()), lang), ganzhi: lunar.getDayChongGan() + lunar.getDayChong() },
      sha: lang === 'ko' ? SHA_KO[zh(lunar.getDaySha())] ?? zh(lunar.getDaySha()) : zh(lunar.getDaySha()),
      zhiXing: (lang === 'ja' ? ZHIXING_JA[zhi] : ZHIXING_KO[zhi]) ?? zhi,
      xiu: { name: zh(lunar.getXiu()), lucky: lunar.getXiuLuck() === '吉' },
      jiShen: [], xiongSha: [],
      pengZu: base.pengZu.map(l => PENGZU[l]?.[lang] ?? l) as [string, string],
      jieQi: { ...base.jieQi, name: term(base.jieQi.name) },
      nextJieQi: { ...base.nextJieQi, name: term(base.nextJieQi.name) },
      ...(lang === 'ja' ? {
        rokuyo: ROKUYO_JA[lunar.getLiuYao()] ?? lunar.getLiuYao(),
        luckyDays: japaneseLuckyDays(lunar.getMonthZhi(), lunar.getDayZhi(), lunar.getDayInGanZhi()),
      } : {}),
    }
  }
  if (lang !== 'en') {
    return {
      ...base,
      lunarDate: zh(`${month}月${day}`),
      animal: animalIn(zh(lunar.getYearShengXiao()), lang),
      yi: clean(lunar.getDayYi()).map(zh),
      ji: clean(lunar.getDayJi()).map(zh),
      chong: { animal: animalIn(zh(lunar.getDayChongShengXiao()), lang), ganzhi: lunar.getDayChongGan() + lunar.getDayChong() },
      sha: zh(lunar.getDaySha()),
      zhiXing: zh(lunar.getZhiXing()),
      xiu: { name: zh(lunar.getXiu()), lucky: lunar.getXiuLuck() === '吉' },
    }
  }
  // English: the library's own English where it has one; the rest keeps the
  // Traditional term (shown with an English label by the card).
  const leap = lunar.getMonth() < 0
  const lunarDate = `${leap ? 'leap ' : ''}${Math.abs(lunar.getMonth())}/${lunar.getDay()}`
  const chongGz = lunar.getDayChongGan() + lunar.getDayChong()
  const xiuLucky = lunar.getXiuLuck() === '吉'
  I18n.setLanguage('en')
  try {
    return {
      ...base,
      lunarDate,
      animal: lunar.getYearShengXiao(),
      yi: clean(lunar.getDayYi()).map(x => EN_FIX[x] ?? x),
      ji: clean(lunar.getDayJi()).map(x => EN_FIX[x] ?? x),
      chong: { animal: lunar.getDayChongShengXiao(), ganzhi: chongGz },
      sha: lunar.getDaySha(),
      zhiXing: lunar.getZhiXing(),
      xiu: { name: lunar.getXiu(), lucky: xiuLucky },
      tianShen: base.tianShen,
      // As on Japanese and Korean pages: 彭祖百忌 in English, no spirit lists.
      jiShen: [], xiongSha: [],
      pengZu: base.pengZu.map(l => PENGZU[l]?.en ?? l) as [string, string],
    }
  } finally {
    I18n.setLanguage('chs')
  }
}
