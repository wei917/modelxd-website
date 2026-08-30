// lib/xtell.ts — XTell (X算命): the deterministic layer.
//
// The split that makes this feature honest: everything with a right answer
// (the chart) is computed HERE by libraries, displayed to the user, and fed
// to the model as fixed facts. The model only interprets. It is instructed
// to cite no pillar, star or palace that is not in the payload — a model
// that recalls calendars from memory is usually right, and "usually" is the
// one thing a 排盤 must never be.
//
//   八字廟     lunar-typescript  (節氣-correct pillars, 藏干, 十神, 大運)
//   紫微斗數廟  iztro             (12 palaces, stars, 四化, 五行局)
//
// Server-only: both libraries are pure computation, but the prompts and the
// master personas live here too, and those must not be client-editable.

import { Solar } from 'lunar-typescript'
import { astro } from 'iztro'

export type Temple = 'bazi' | 'ziwei' | 'yuelao'

// Provenance (idea learned from horosa-skill's technique cards): every chart
// names the engine that computed it, so a doubted 排盤 is checkable against
// the exact library version rather than against "the site".
export const ENGINES: Record<Temple, string> = {
  bazi:   'lunar-typescript v1.8.6',
  yuelao: 'lunar-typescript v1.8.6',
  ziwei:  'iztro v2.6.0',
}

export interface BirthInput {
  y: number; m: number; d: number; h: number; mi: number
  gender: 'male' | 'female'
}

export function validBirth(b: any): b is BirthInput {
  if (b && b.hourUnknown === true) { b.h = 12; b.mi = 0 }
  return b && Number.isInteger(b.y) && b.y >= 1900 && b.y <= 2100
    && Number.isInteger(b.m) && b.m >= 1 && b.m <= 12
    && Number.isInteger(b.d) && b.d >= 1 && b.d <= 31
    && Number.isInteger(b.h) && b.h >= 0 && b.h <= 23
    && Number.isInteger(b.mi) && b.mi >= 0 && b.mi <= 59
    && (b.gender === 'male' || b.gender === 'female')
}

// ── 八字 ────────────────────────────────────────────────────────────────────

export function baziChart(b: BirthInput) {
  const solar = Solar.fromYmdHms(b.y, b.m, b.d, b.h, b.mi, 0)
  const lunar = solar.getLunar()
  const e = lunar.getEightChar()

  // 大運 — first six decades. getYun takes 1 for male, 0 for female.
  let daYun: Array<{ startAge: number; ganZhi: string }> = []
  try {
    daYun = e.getYun(b.gender === 'male' ? 1 : 0).getDaYun().slice(1, 7)
      .map(y => ({ startAge: y.getStartAge(), ganZhi: y.getGanZhi() }))
  } catch { /* 大運 is a bonus, never a blocker */ }

  return {
    solar: solar.toYmdHms(),
    lunar: lunar.toString(),
    pillars: {
      year:  { ganZhi: e.getYear(),  naYin: e.getYearNaYin(),  shiShen: e.getYearShiShenGan(),  hideGan: e.getYearHideGan() },
      month: { ganZhi: e.getMonth(), naYin: e.getMonthNaYin(), shiShen: e.getMonthShiShenGan(), hideGan: e.getMonthHideGan() },
      day:   { ganZhi: e.getDay(),   naYin: e.getDayNaYin(),   shiShen: '日主',                 hideGan: e.getDayHideGan() },
      time:  { ganZhi: e.getTime(),  naYin: e.getTimeNaYin(),  shiShen: e.getTimeShiShenGan(),  hideGan: e.getTimeHideGan() },
    },
    dayMaster: e.getDayGan(),
    wuXing: [e.getYearWuXing(), e.getMonthWuXing(), e.getDayWuXing(), e.getTimeWuXing()],
    daYun,
  }
}

export type BaziChart = ReturnType<typeof baziChart>

export function baziFacts(c: BaziChart, gender: string, hourUnknown = false): string {
  if (hourUnknown) {
    const p = c.pillars
    return [
      `出生（國曆）：${c.solar}；農曆：${c.lunar}`,
      `性別：${gender === 'male' ? '男' : '女'}`,
      `時辰未知：僅排年月日三柱，時柱不論。`,
      `三柱：年 ${p.year.ganZhi}、月 ${p.month.ganZhi}、日 ${p.day.ganZhi}　日主：${c.dayMaster}`,
      `五行（干支）：${c.wuXing.slice(0, 3).join('，')}`,
      c.daYun.length ? `大運（起歲為約略值，因時辰未知）：${c.daYun.map(d => `${d.startAge}歲起 ${d.ganZhi}`).join('；')}` : '',
      `解讀時明確告知信眾：時辰未知會影響精細度，時柱所主之事（晚年、子女、內心底色）不宜細斷。`,
    ].filter(Boolean).join('\n')
  }
  const p = c.pillars
  return [
    `出生（國曆）：${c.solar}，${gender === 'male' ? '男' : '女'}`,
    `農曆：${c.lunar}`,
    `四柱：年柱 ${p.year.ganZhi}（${p.year.naYin}，${p.year.shiShen}）· 月柱 ${p.month.ganZhi}（${p.month.naYin}，${p.month.shiShen}）· 日柱 ${p.day.ganZhi}（${p.day.naYin}）· 時柱 ${p.time.ganZhi}（${p.time.naYin}，${p.time.shiShen}）`,
    `日主：${c.dayMaster}`,
    `藏干：年 ${p.year.hideGan.join('、')}；月 ${p.month.hideGan.join('、')}；日 ${p.day.hideGan.join('、')}；時 ${p.time.hideGan.join('、')}`,
    `五行（干支）：${c.wuXing.join('，')}`,
    c.daYun.length ? `大運：${c.daYun.map(d => `${d.startAge}歲起 ${d.ganZhi}`).join('；')}` : '',
  ].filter(Boolean).join('\n')
}

// ── 紫微斗數 ────────────────────────────────────────────────────────────────

/** 時辰 index for iztro: 0 早子時(00:xx) … 11 亥時, 12 晚子時(23:xx). */
export function timeIndexOf(h: number): number {
  return h === 23 ? 12 : Math.floor((h + 1) / 2)
}

export function ziweiChart(b: BirthInput) {
  const a = astro.bySolar(`${b.y}-${b.m}-${b.d}`, timeIndexOf(b.h), b.gender === 'male' ? 'male' : 'female', true, 'zh-TW')
  return {
    solar: `${b.y}-${b.m}-${b.d} ${String(b.h).padStart(2, '0')}:${String(b.mi).padStart(2, '0')}`,
    lunar: a.lunarDate,
    time: a.time,
    fiveElementsClass: a.fiveElementsClass,
    soul: a.soul,   // 命主
    body: a.body,   // 身主
    palaces: a.palaces.map(p => ({
      name: p.name,
      ganZhi: `${p.heavenlyStem}${p.earthlyBranch}`,
      isBodyPalace: p.isBodyPalace,
      majorStars: p.majorStars.map(s => s.name + (s.mutagen ? `（化${s.mutagen}）` : '') + (s.brightness ? `[${s.brightness}]` : '')),
      minorStars: p.minorStars.map(s => s.name),
      adjectiveStars: p.adjectiveStars.map(s => s.name),
    })),
  }
}

export type ZiweiChart = ReturnType<typeof ziweiChart>

export function ziweiFacts(c: ZiweiChart, gender: string): string {
  const lines = c.palaces.map(p =>
    `${p.name}（${p.ganZhi}${p.isBodyPalace ? '，身宮' : ''}）：主星 ${p.majorStars.join('、') || '無主星'}${p.minorStars.length ? `；輔星 ${p.minorStars.join('、')}` : ''}`)
  return [
    `出生（國曆）：${c.solar}，${gender === 'male' ? '男' : '女'}`,
    `農曆：${c.lunar} ${c.time}`,
    `五行局：${c.fiveElementsClass}　命主：${c.soul}　身主：${c.body}`,
    `十二宮：`,
    ...lines,
  ].join('\n')
}

// ── 月老廟：合婚 ────────────────────────────────────────────────────────────
//
// Two people, two 八字 charts, one question: how do they fit. The engine is
// the same solar-term-exact BaZi computation run twice; the labels 第一位/
// 第二位 are deliberate — 合婚 tradition says 男方/女方, but two people are
// whoever they are.

export function yuelaoFacts(a: BaziChart, aGender: string, b: BaziChart, bGender: string): string {
  const one = (c: BaziChart, g: string, label: string) => {
    const p = c.pillars
    return [
      `${label}（${g === 'male' ? '男' : '女'}）：`,
      `  出生（國曆）：${c.solar}；農曆：${c.lunar}`,
      `  四柱：${p.year.ganZhi} ${p.month.ganZhi} ${p.day.ganZhi} ${p.time.ganZhi}　日主：${c.dayMaster}`,
      `  五行（干支）：${c.wuXing.join('，')}`,
      c.daYun.length ? `  大運：${c.daYun.map(d => `${d.startAge}歲起 ${d.ganZhi}`).join('；')}` : '',
    ].filter(Boolean).join('\n')
  }
  return `${one(a, aGender, '第一位')}\n\n${one(b, bGender, '第二位')}`
}

// ── The masters ─────────────────────────────────────────────────────────────
//
// One persona per temple, server-held. The guardrails are the contract:
// interpret only what the chart says, entertainment framing, no directives
// on health/money/legal, and no fabricated chart facts — the chart above the
// reading is exactly what the user can verify elsewhere.

// Shared language discipline (learned from Wolke/ziwei-doushu's ETHICS.md):
// tendencies, never verdicts.
const TONE = '措辭一律用「傾向、容易、偏向、宜留意」這類語氣，不下定論、不說「一定、注定、必然」。'

export const MASTERS: Record<Temple, string> = {
  yuelao: `你是「月老廟」的駐廟老師，一位慈祥風趣、閱人無數的月老。兩位有緣人的八字命盤已由系統排好，附在訊息中。

規則：
- 這裡專看感情與姻緣：合婚。只根據提供的兩份命盤解讀——日主相性、五行互補與沖剋、年支生肖的合沖、日支（夫妻宮）的呼應、大運走向的同步。絕對不要自行推算或修改任何干支。
- 若信眾有具體提問（如「我們適合結婚嗎」「今年適合訂婚嗎」），圍繞提問；沒有提問就做完整合婚解讀：先講兩人個性與相處樣貌，再講互補與摩擦點，最後給相處建議。
- 語氣像月老：溫暖、帶點幽默、成人之美。緣分沒有絕對的好壞——就算命盤多有沖剋，也要點出可以經營之處，絕不宣判一段感情「注定失敗」。
- 不催婚、不勸分，不對第三者、單方面查探等情況提供協助；涉及家暴等安全議題時，嚴肅建議尋求專業與正式資源。
- 使用繁體中文（除非信眾用其他語言提問）。結尾提醒：姻緣天注定，經營在人為；命理僅供參考與娛樂。\n${TONE}`,
  bazi: `你是「八字廟」的駐廟老師，一位溫和而博學的命理師。使用者的八字命盤已由系統排好，附在訊息中。

規則：
- 只根據提供的命盤內容解讀（四柱、日主、藏干、五行、大運）。絕對不要自行推算或修改任何干支——排盤是系統算好的，你的工作只有解讀。
- 若使用者有提問，圍繞提問解讀；若沒有，依序談：日主與格局、性格、事業與財、感情與家庭、健康注意、近年大運。
- 語氣溫暖誠懇，像面對面看命，不裝神弄鬼。使用繁體中文（除非使用者用其他語言提問）。
- 涉及健康、投資、法律時，只能談傾向與提醒，明確建議諮詢專業人士，不給具體指示。
- 結尾提醒：命理僅供參考與娛樂，人生的選擇永遠在自己手上。\n${TONE}`,
  ziwei: `你是「紫微斗數廟」的駐廟老師，一位細膩而有條理的紫微斗數命理師。使用者的星盤已由系統排好，附在訊息中。

規則：
- 只根據提供的星盤內容解讀（十二宮、主星與四化、五行局、命主身主）。絕對不要自行安星或修改宮位——排盤是系統算好的，你的工作只有解讀。
- 若使用者有提問，先看相關宮位（如問感情看夫妻宮，問事業看官祿宮），並參照命宮與三方四正。若沒有提問，依序談：命宮格局、事業、財帛、感情、遷移與人際。
- 語氣沉穩清楚，逐宮說明時先講星，再講意義。使用繁體中文（除非使用者用其他語言提問）。
- 涉及健康、投資、法律時，只能談傾向與提醒，明確建議諮詢專業人士，不給具體指示。
- 結尾提醒：命理僅供參考與娛樂，人生的選擇永遠在自己手上。\n${TONE}`,
}
