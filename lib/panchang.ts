// lib/panchang.ts — today's Indian calendar (Panchang) for the XTell street
// (owner, Sep 27), from the same sidereal engine as 九曜廟 (lib/jyotish.ts).
//
// Two halves, because only one needs to know where the visitor is:
//   - panchangAt(now): the four limbs that belong to the moment, the same
//     everywhere on Earth: tithi (the Moon–Sun angle in 12° steps), the
//     Moon's nakshatra, yoga (Sun + Moon in 13°20′ steps) and karana (half a
//     tithi), each with the moment it ends. Shown in the visitor's own zone.
//   - sunDay(date, place): sunrise, sunset and Rahu Kalam, which depend on
//     the horizon, so they appear only once the visitor shares a location or
//     picks a city (owner, Sep 27: no default city). The weekday's ruling
//     planet (vara) is the civil weekday's.
//
// Pure and client-safe; the location never leaves the browser.

import * as A from 'astronomy-engine'
import { siderealLongitude, NAKSHATRA, zonedToUtc } from './jyotish'

const norm = (d: number) => ((d % 360) + 360) % 360
const SPAN = 360 / 27

/** Tithi 1–14 by name; 15 is Purnima in the waxing half, Amavasya in the waning. */
export const TITHI = ['Pratipada', 'Dvitiya', 'Tritiya', 'Chaturthi', 'Panchami', 'Shashthi', 'Saptami', 'Ashtami', 'Navami', 'Dashami', 'Ekadashi', 'Dvadashi', 'Trayodashi', 'Chaturdashi'] as const
export const YOGA = ['Vishkambha', 'Priti', 'Ayushman', 'Saubhagya', 'Shobhana', 'Atiganda', 'Sukarma', 'Dhriti', 'Shula', 'Ganda', 'Vriddhi', 'Dhruva', 'Vyaghata', 'Harshana', 'Vajra', 'Siddhi', 'Vyatipata', 'Variyana', 'Parigha', 'Shiva', 'Siddha', 'Sadhya', 'Shubha', 'Shukla', 'Brahma', 'Indra', 'Vaidhriti'] as const
const MOVABLE_KARANA = ['Bava', 'Balava', 'Kaulava', 'Taitila', 'Garaja', 'Vanija', 'Vishti'] as const

/** Karana 0–59 across the lunar month: Kimstughna first, the seven movable
 *  ones eight times, then Shakuni, Chatushpada, Naga. */
export function karanaName(k: number): string {
  if (k === 0) return 'Kimstughna'
  if (k >= 57) return ['Shakuni', 'Chatushpada', 'Naga'][k - 57]
  return MOVABLE_KARANA[(k - 1) % 7]
}

const elongation = (t: Date) => norm(siderealLongitude('Moon', t) - siderealLongitude('Sun', t))
const tithiOf = (t: Date) => Math.floor(elongation(t) / 12)
const karanaOf = (t: Date) => Math.floor(elongation(t) / 6)
const nakshatraOf = (t: Date) => Math.floor(siderealLongitude('Moon', t) / SPAN)
const yogaOf = (t: Date) => Math.floor(norm(siderealLongitude('Sun', t) + siderealLongitude('Moon', t)) / SPAN)

/** When a stepwise quantity next changes after `from`: hour steps, then
 *  bisection to under 20 seconds. Every limb changes within ~26 hours. */
function nextChange(f: (t: Date) => number, from: Date): Date {
  const v = f(from)
  let lo = from.getTime(), hi = lo
  for (let i = 0; i < 48; i++) {
    hi = lo + 3600_000
    if (f(new Date(hi)) !== v) break
    lo = hi
  }
  while (hi - lo > 20_000) {
    const mid = (lo + hi) / 2
    if (f(new Date(mid)) === v) lo = mid; else hi = mid
  }
  return new Date(hi)
}

export type Limb = { index: number; ends: Date }
export type PanchangNow = {
  /** index 0–29; waxing (shukla) 0–14, waning (krishna) 15–29. */
  tithi: Limb & { waxing: boolean; day: number; name: string }
  nakshatra: Limb & { sa: string; zh: string }
  yoga: Limb & { name: string }
  karana: Limb & { name: string }
}

export function panchangAt(now: Date): PanchangNow {
  const t = tithiOf(now), n = nakshatraOf(now), y = yogaOf(now), k = karanaOf(now)
  const waxing = t < 15, day = (t % 15) + 1
  return {
    tithi: { index: t, ends: nextChange(tithiOf, now), waxing, day, name: day === 15 ? (waxing ? 'Purnima' : 'Amavasya') : TITHI[day - 1] },
    nakshatra: { index: n, ends: nextChange(nakshatraOf, now), sa: NAKSHATRA[n][0], zh: NAKSHATRA[n][1] },
    yoga: { index: y, ends: nextChange(yogaOf, now), name: YOGA[y] },
    karana: { index: k, ends: nextChange(karanaOf, now), name: karanaName(k) },
  }
}

/** Rahu Kalam is one eighth of the daylight; which eighth, by weekday
 *  (Sunday first): the 8th, 2nd, 7th, 5th, 6th, 4th, 3rd. */
const RAHU_PART = [8, 2, 7, 5, 6, 4, 3]

export type SunDay = {
  sunrise: Date | null
  sunset: Date | null
  /** Null where the Sun does not both rise and set that day (polar). */
  rahu: [Date, Date] | null
  /** 0 = Sunday: the day's ruling planet (vara). */
  weekday: number
}

/** Sunrise, sunset and Rahu Kalam on a local date (YYYY-MM-DD) at a place. */
export function sunDay(date: string, tz: string, lat: number, lon: number): SunDay {
  const [y, m, d] = date.split('-').map(Number)
  const start = zonedToUtc(y, m, d, 0, 0, tz)
  const observer = new A.Observer(lat, lon, 0)
  const rise = A.SearchRiseSet(A.Body.Sun, observer, +1, start, 1)
  const set = rise ? A.SearchRiseSet(A.Body.Sun, observer, -1, rise.date, 1) : null
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  if (!rise || !set) return { sunrise: rise?.date ?? null, sunset: set?.date ?? null, rahu: null, weekday }
  const part = (set.date.getTime() - rise.date.getTime()) / 8
  const from = rise.date.getTime() + (RAHU_PART[weekday] - 1) * part
  return { sunrise: rise.date, sunset: set.date, rahu: [new Date(from), new Date(from + part)], weekday }
}
