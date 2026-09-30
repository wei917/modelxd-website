// lib/xtell-daily.ts — XTell's free daily fortune: the saved birth profile,
// the day's two computed bases (Western transits, 八字流日), and the words
// the house model is asked for. Server-only (the chart engines and the
// prompts live here); the routes are app/api/xtell/{profile,daily}.
//
// What makes a day's reading stable: it is keyed by the user, the local date
// in their chosen zone, that zone, the profile revision, the method, the
// rules version below and the language (supabase/109). Every number in it is
// computed here at the day's anchor (local noon), never at request time, and
// the model only explains what this file hands it.

import { natalChart, transits, retrogrades, longitude, PLANET_ZH, SIGNS, type NatalChart, type Planet } from './astrology'
import { placeOf, birthZone, PLACES } from './xtell-places'
import { baziNatalZoned, liuRi, liuRiFacts, TONE, type DailyNatal, type LiuRi } from './xtell'
import { momentProblem } from './xtell-birth'
import { birthInstant, dayAnchor, localDateIn, validZone } from './xtell-time'

export const DAILY_METHODS = ['western', 'bazi'] as const
export type DailyMethod = (typeof DAILY_METHODS)[number]
/** Bumped when a method's computation or its writing brief changes; a new
 *  version is a new cache key, so old readings are never shown as new. */
// -2 (Sep 29): readings are checked for the page's language; the day's
// cached rows written before that (a Chinese reading on a Japanese page)
// are not served again.
export const DAILY_RULES: Record<DailyMethod, string> = { western: 'western-2', bazi: 'bazi-2' }
/** Which consent wording a saved profile agreed to (the i18n key's version). */
export const CONSENT_VERSION = 'daily-consent-1'
export const DAILY_LANGS = ['en', 'zh-Hant', 'zh-Hans', 'ja', 'ko'] as const
export type DailyLang = (typeof DAILY_LANGS)[number]
export const asDailyLang = (v: unknown): DailyLang => ((DAILY_LANGS as readonly string[]).includes(v as string) ? v as DailyLang : 'zh-Hant')

/** A birth as the daily fortune stores it: date, clock time or an unknown
 *  hour. No gender: nothing in v1 reads one (Codex review). */
export type DailyBirth = { y: number; m: number; d: number; h: number; mi: number; hourUnknown?: true }

/** A saved birth profile, as the routes pass it around. */
export type DailyProfile = {
  birth: DailyBirth
  place: string
  fold: 0 | 1 | null
  displayTz: string
  /** Never reused (supabase/109): a re-created profile has a new one. */
  revision: number
}

/**
 * Why a profile cannot be saved, or null. The same birth checks as every
 * temple (1900 to today, a real date), plus what the daily feature needs: the
 * zone of birth ('tz:<zone>', or a listed city from before Sep 27), a real
 * display zone, and a birth
 * time that happened exactly once in that zone, or the visitor's choice of
 * which of two.
 */
export function profileProblem(v: any): string | null {
  const birth = v?.birth
  const p = momentProblem(birth)
  if (p) return `birth_${p}`
  if (!birthZone(v?.place)) return 'place_invalid'
  if (!validZone(v?.displayTz)) return 'tz_invalid'
  if (v?.fold !== undefined && v.fold !== null && v.fold !== 0 && v.fold !== 1) return 'fold_invalid'
  if (birth.hourUnknown === true) return null
  const at = birthInstant(birth.y, birth.m, birth.d, birth.h, birth.mi, birthZone(v.place)!, v?.fold ?? null)
  return at.ok ? null : at.problem === 'gap' ? 'birth_time_gap' : 'birth_time_ambiguous'
}

/** The stored shape of a birth: only the fields the engines read. */
export function cleanBirth(b: any): DailyBirth {
  const hourUnknown = b.hourUnknown === true
  return { y: b.y, m: b.m, d: b.d, h: hourUnknown ? 12 : b.h, mi: hourUnknown ? 0 : b.mi, ...(hourUnknown ? { hourUnknown: true as const } : {}) }
}

/** The birth instant, or null when the hour is unknown. */
export function birthUtc(p: DailyProfile): number | null {
  if (p.birth.hourUnknown) return null
  const at = birthInstant(p.birth.y, p.birth.m, p.birth.d, p.birth.h, p.birth.mi, birthZone(p.place)!, p.fold)
  return at.ok ? at.utc : null
}

// ── Western: transits at the day's anchor ─────────────────────────────────

export type WesternContact = {
  transit: Planet; natal: string; aspect: string; zh: string; orb: number; applying: boolean; exact: string | null
  /** Hour unknown: every natal position is a noon estimate, so every contact
   *  is only possible (another birth time can put it in or out of orb); no
   *  orb figure or timing is given for it (Codex review). */
  approx?: true
}
export type WesternDaily = {
  date: string; tz: string; anchor: string; moonSign: number; retro: Planet[]; contacts: WesternContact[]; hourUnknown: boolean
  /** Born in a zone, not a place (owner, Sep 27): the planets only; no
   *  rising sign, midheaven or houses, which need the birth place's horizon. */
  noPlace?: true
}

export function westernDaily(p: DailyProfile, date: string, anchor: number): WesternDaily {
  // Only profiles from before Sep 27 name a city; planet positions are
  // geocentric, so a zone alone gives them all, and the horizon-bound points
  // (ASC, MC, Fortune) are dropped below instead of computed at 0°, 0°.
  const city = placeOf(p.place)
  const zone = birthZone(p.place)!
  const natal: NatalChart = natalChart({
    y: p.birth.y, m: p.birth.m, d: p.birth.d, h: p.birth.hourUnknown ? 12 : p.birth.h, mi: p.birth.hourUnknown ? 0 : p.birth.mi,
    lat: city?.lat ?? 0, lon: city?.lon ?? 0, tz: zone, place: city?.label ?? zone,
    ...(p.birth.hourUnknown ? { hourUnknown: true } : { utc: birthUtc(p) ?? undefined }),
  })
  const at = new Date(anchor)
  // A perfection date says something for a day only when it is near that
  // day; the Moon perfects within hours, and the ±45-day search behind
  // `exact` would name one of last month's crossings for it.
  const near = (iso: string | null, body: string) => {
    if (!iso || body === 'Moon') return null
    return Math.abs(Date.parse(iso) - Date.parse(date)) <= 2 * 86400_000 ? iso : null
  }
  const approx = natal.hourUnknown === true
  const noPlace = !city && !approx
  const HORIZON = new Set(['ASC', 'MC', 'Fortune'])
  const contacts: WesternContact[] = transits(natal, at, 1).filter(t => !(noPlace && HORIZON.has(t.b))).slice(0, 8).map(t => ({
    transit: t.a as Planet, natal: t.b, aspect: t.name, zh: t.zh, orb: Math.round(t.orb * 100) / 100, applying: t.applying,
    exact: approx ? null : near(t.exact, t.a),
    ...(approx ? { approx: true as const } : {}),
  }))
  return {
    date, tz: p.displayTz, anchor: at.toISOString(),
    moonSign: Math.floor(longitude('Moon', at) / 30),
    retro: retrogrades(at), contacts, hourUnknown: natal.hourUnknown === true,
    ...(noPlace ? { noPlace: true as const } : {}),
  }
}

const pointZh = (k: string) => (PLANET_ZH as Record<string, string>)[k] ?? ({ ASC: '上升點', MC: '天頂', Fortune: '福點' } as Record<string, string>)[k] ?? k
const signZh = (i: number) => `${SIGNS[i][1]}座`

export function westernFacts(w: WesternDaily): string {
  return [
    `今日（${w.date}，${w.tz} 當地日期；以當地中午計算）：行運月亮在${signZh(w.moonSign)}。`,
    w.retro.length ? `逆行中：${w.retro.map(pointZh).join('、')}。` : '今天沒有行星逆行。',
    w.contacts.length
      ? `與本命盤 1° 內的行運相位：${w.contacts.map(c => c.approx
          ? `行運${pointZh(c.transit)}${c.zh}本命${pointZh(c.natal)}（時辰未知，只是可能）`
          : `行運${pointZh(c.transit)}${c.zh}本命${pointZh(c.natal)}（差 ${c.orb.toFixed(1)}°，${c.applying ? '入相' : '出相'}${c.exact ? `，約 ${c.exact} 最準` : ''}）`).join('；')}。`
      : '在這個計算下，今天沒有 1° 以內的主要行運相位。這不代表生活平靜或有事，不可據此推論事件，也不要自行補造相位。',
    w.hourUnknown ? '時辰未知：本命以中午估算，不談上升、宮位與本命月亮；每個相位都只是可能，另一個出生時間可能多出或少掉某些相位，不給精確度數與時間。' : '',
    w.noPlace ? '只知道出生時區、不知道出生地點：只看行星，不談上升、天頂、宮位與福點。' : '',
  ].filter(Boolean).join('\n')
}

// ── Both bases for a day ───────────────────────────────────────────────────

export type BaziDaily = { natal: DailyNatal; day: LiuRi }
export type DailyBases = { date: string; tz: string; anchor: number; western: WesternDaily; bazi: BaziDaily }

/** Today, for this profile: the local date in its display zone at `now`,
 *  and both methods computed at that date's anchor. */
export function dailyBases(p: DailyProfile, now: number = Date.now()): DailyBases {
  const date = localDateIn(p.displayTz, now)
  const anchor = dayAnchor(date, p.displayTz)
  const natal = baziNatalZoned(p.birth, birthZone(p.place)!, birthUtc(p))
  return { date, tz: p.displayTz, anchor, western: westernDaily(p, date, anchor), bazi: { natal, day: liuRi(natal, date, p.displayTz, anchor) } }
}

export const basisFacts = (method: DailyMethod, b: DailyBases): string =>
  method === 'western' ? westernFacts(b.western) : liuRiFacts(b.bazi.natal, b.bazi.day)

// ── Words ──────────────────────────────────────────────────────────────────

const LANG_NAME: Record<DailyLang, string> = {
  en: 'English', 'zh-Hant': 'Traditional Chinese (繁體中文)', 'zh-Hans': 'Simplified Chinese (简体中文)', ja: 'Japanese (日本語)', ko: 'Korean (한국어)',
}

/** The free writer's brief. It explains the computed basis for one method,
 *  and nothing else: no invented placements, no mixing the two methods, no
 *  score, no prediction of events. */
export function dailyBrief(method: DailyMethod, lang: DailyLang): string {
  const what = method === 'western' ? 'Western astrology: today\'s transits against the visitor\'s natal chart' : 'BaZi: today\'s day pillar (流日) against the visitor\'s natal pillars'
  return [
    `You write a free daily reading from ${what}, for someone who is not an expert.`,
    'Use ONLY the facts given. Never add a planet, sign, house, aspect, pillar, stem or branch that is not listed, and never mention the other method.',
    'Describe tendencies and things to notice; never predict events, and never give medical, legal or financial advice. No scores, no percentages, no lucky numbers or colours.',
    'If the facts say something is approximate or undecided (an unknown birth hour), say so plainly and do not sound certain about it.',
    'If the facts show no prominent contacts, say that nothing stands out under this calculation and draw no conclusion about events; never call the day calm or quiet because of it.',
    TONE,
    lang === 'zh-Hant' || lang === 'zh-Hans'
      ? `Write every field in ${LANG_NAME[lang]}. Keep the technical terms in Chinese characters with a short explanation the first time.`
      : `Write every field in ${LANG_NAME[lang]} only. The facts below are in Chinese: translate them, do not copy their sentences, and never write a Chinese sentence. Use the words a reader of ${LANG_NAME[lang]} knows${lang === 'ja' ? ' (ハウス, コンジャンクション, スクエア, トライン, 月, 逆行, 命式, 日主)' : ''}; a BaZi term may stay in its characters with a short explanation the first time.`,
    'Reply with ONLY a JSON object, no markdown fence:',
    '{"summary": "one or two sentences", "themes": ["two or three short things to notice"], "reflect": "one question or thing to think about today", "why": "two or three sentences: which computed facts led to this, in plain words"}',
  ].join('\n')
}

export type DailyReading = { summary: string; themes: string[]; reflect: string; why: string }

/** The writer's JSON, bounded, or null (then the day shows its basis and
 *  says the reading is not ready; nothing falls back to a paid reading). */
export function parseDailyReading(raw: string): DailyReading | null {
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) return null
  let j: any
  try { j = JSON.parse(m[0]) } catch { return null }
  const str = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null)
  const summary = str(j?.summary, 400), reflect = str(j?.reflect, 300), why = str(j?.why, 600)
  const themes = Array.isArray(j?.themes) ? j.themes.map((x: unknown) => str(x, 160)).filter(Boolean).slice(0, 3) as string[] : []
  if (!summary || !reflect || !why || themes.length === 0) return null
  return { summary, themes, reflect, why }
}

/** The paid follow-up teacher, per method: the day's stored basis is the
 *  whole chart it may speak from. */
export const DAILY_TEACHER: Record<DailyMethod, string> = {
  western: `你是占星塔的老師，信眾想就「今日運勢（西洋占星）」多問一些。只依下方系統算好的今日依據與當天已給的免費解讀回答；不得新增或推算任何行星、星座、宮位或相位。時辰未知時，標為約略的相位只能說可能。不預言事件，不給醫療、法律、財務決定建議。${TONE}`,
  bazi: `你是八字廟的老師，信眾想就「今日運勢（八字流日）」多問一些。只依下方系統算好的今日依據與當天已給的免費解讀回答；不得新增或推算任何天干地支、十神或柱。時辰未知時不談時柱。不預言事件，不給醫療、法律、財務決定建議。${TONE}`,
}

/** For the tests and the form: every birth place key. */
export const PLACE_KEYS = PLACES.map(p => p.key)
