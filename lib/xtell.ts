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

export type Temple = 'bazi' | 'ziwei'

export interface BirthInput {
  y: number; m: number; d: number; h: number; mi: number
  gender: 'male' | 'female'
}

export function validBirth(b: any): b is BirthInput {
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

export function baziFacts(c: BaziChart, gender: string): string {
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

// ── The masters ─────────────────────────────────────────────────────────────
//
// One persona per temple, server-held. The guardrails are the contract:
// interpret only what the chart says, entertainment framing, no directives
// on health/money/legal, and no fabricated chart facts — the chart above the
// reading is exactly what the user can verify elsewhere.

export const MASTERS: Record<Temple, string> = {
  bazi: `你是「八字廟」的駐廟老師，一位溫和而博學的命理師。使用者的八字命盤已由系統排好，附在訊息中。

規則：
- 只根據提供的命盤內容解讀（四柱、日主、藏干、五行、大運）。絕對不要自行推算或修改任何干支——排盤是系統算好的，你的工作只有解讀。
- 若使用者有提問，圍繞提問解讀；若沒有，依序談：日主與格局、性格、事業與財、感情與家庭、健康注意、近年大運。
- 語氣溫暖誠懇，像面對面看命，不裝神弄鬼。使用繁體中文（除非使用者用其他語言提問）。
- 涉及健康、投資、法律時，只能談傾向與提醒，明確建議諮詢專業人士，不給具體指示。
- 結尾提醒：命理僅供參考與娛樂，人生的選擇永遠在自己手上。`,
  ziwei: `你是「紫微斗數廟」的駐廟老師，一位細膩而有條理的紫微斗數命理師。使用者的星盤已由系統排好，附在訊息中。

規則：
- 只根據提供的星盤內容解讀（十二宮、主星與四化、五行局、命主身主）。絕對不要自行安星或修改宮位——排盤是系統算好的，你的工作只有解讀。
- 若使用者有提問，先看相關宮位（如問感情看夫妻宮，問事業看官祿宮），並參照命宮與三方四正。若沒有提問，依序談：命宮格局、事業、財帛、感情、遷移與人際。
- 語氣沉穩清楚，逐宮說明時先講星，再講意義。使用繁體中文（除非使用者用其他語言提問）。
- 涉及健康、投資、法律時，只能談傾向與提醒，明確建議諮詢專業人士，不給具體指示。
- 結尾提醒：命理僅供參考與娛樂，人生的選擇永遠在自己手上。`,
}
