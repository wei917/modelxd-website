// lib/astrology.ts — a tropical (Western) chart engine for 占星塔.
//
// The sibling of lib/jyotish.ts, and deliberately built on the same parts:
// that file already computes TROPICAL longitudes and a tropical ascendant and
// then subtracts the Lahiri ayanamsa to make them sidereal. Western astrology
// is those same numbers without the subtraction, so the ephemeris work, the
// timezone handling and the arcsecond accuracy are already paid for. What is
// genuinely new here is houses, aspects, and time: transits, progressions and
// the solar return.
//
//   Zodiac     Tropical (true ecliptic of date), no ayanamsa.
//   Bodies     Ten: Sun through Pluto, all from astronomy-engine. Plus the
//              mean lunar nodes and the Part of Fortune. NOT Chiron —
//              astronomy-engine has no ephemeris for it, and inventing one
//              would break the rule that every number on the board is
//              checkable.
//   Houses     Placidus, the system Western readers expect and every
//              comparison site shows. Equal houses from the Ascendant when
//              Placidus is undefined (see placidus() for when that is).
//   Aspects    Ptolemaic five, with per-aspect orbs widened for the luminaries.
//   Time       Transits (a real date against the natal chart), secondary
//              progressions (a day for a year), and the solar return.
//
// Pure computation: no I/O, no randomness, client-safe. Same as jyotish.ts,
// so the chart can be rendered before anything is bought.

import * as A from 'astronomy-engine'
import { zonedToUtc } from './jyotish'

export const PLANETS = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto', 'NorthNode', 'SouthNode'] as const
export type Planet = (typeof PLANETS)[number]

/** The angles and the calculated point. Aspected like planets, never "in" a
 *  house (they ARE the houses), and meaningless without a birth time. */
export const POINTS = ['ASC', 'MC', 'Fortune'] as const
export type Point = (typeof POINTS)[number]

export const PLANET_ZH: Record<Planet, string> = {
  Sun: '太陽', Moon: '月亮', Mercury: '水星', Venus: '金星', Mars: '火星',
  Jupiter: '木星', Saturn: '土星', Uranus: '天王星', Neptune: '海王星', Pluto: '冥王星',
  NorthNode: '北交點', SouthNode: '南交點',
}
export const PLANET_GLYPH: Record<Planet, string> = {
  Sun: '☉', Moon: '☽', Mercury: '☿', Venus: '♀', Mars: '♂',
  Jupiter: '♃', Saturn: '♄', Uranus: '♅', Neptune: '♆', Pluto: '♇',
  NorthNode: '☊', SouthNode: '☋',
}
export const POINT_ZH: Record<Point, string> = { ASC: '上升', MC: '天頂', Fortune: '福點' }

/** Sign, Chinese name, element, modality, and traditional + modern ruler. */
export const SIGNS = [
  ['Aries', '牡羊', '火', '基本', 'Mars'], ['Taurus', '金牛', '土', '固定', 'Venus'],
  ['Gemini', '雙子', '風', '變動', 'Mercury'], ['Cancer', '巨蟹', '水', '基本', 'Moon'],
  ['Leo', '獅子', '火', '固定', 'Sun'], ['Virgo', '處女', '土', '變動', 'Mercury'],
  ['Libra', '天秤', '風', '基本', 'Venus'], ['Scorpio', '天蠍', '水', '固定', 'Pluto'],
  ['Sagittarius', '射手', '火', '變動', 'Jupiter'], ['Capricorn', '摩羯', '土', '基本', 'Saturn'],
  ['Aquarius', '水瓶', '風', '固定', 'Uranus'], ['Pisces', '雙魚', '水', '變動', 'Neptune'],
] as const

export const ELEMENTS = ['火', '土', '風', '水'] as const
export const MODALITIES = ['基本', '固定', '變動'] as const

/** The Ptolemaic five. `orb` is the base allowance; the luminaries get more
 *  (LUMINARY_BONUS) because the Sun and Moon are conventionally read with a
 *  wider reach, and a chart that says otherwise will not match the site the
 *  visitor checks it against. */
export const ASPECTS = [
  { name: 'conjunction', zh: '合相', glyph: '☌', angle: 0,   orb: 8 },
  { name: 'opposition',  zh: '對分', glyph: '☍', angle: 180, orb: 8 },
  { name: 'trine',       zh: '三分', glyph: '△', angle: 120, orb: 7 },
  { name: 'square',      zh: '四分', glyph: '□', angle: 90,  orb: 7 },
  { name: 'sextile',     zh: '六分', glyph: '⚹', angle: 60,  orb: 5 },
] as const
export type AspectName = (typeof ASPECTS)[number]['name']
const LUMINARY_BONUS = 2

const norm = (d: number) => ((d % 360) + 360) % 360
const DEG = Math.PI / 180
const clamp1 = (x: number) => Math.max(-1, Math.min(1, x))
/** Shortest signed distance from a to b, in (-180, 180]. */
const sep = (a: number, b: number) => { const d = norm(b - a); return d > 180 ? d - 360 : d }

function centuries(date: Date): number {
  return (date.getTime() / 86400000 + 2440587.5 - 2451545.0) / 36525
}
function obliquity(T: number): number {
  return 23.439279 - (46.836769 * T - 0.0001831 * T * T + 0.0020034 * T ** 3) / 3600
}
/** Mean ascending node of the Moon (Meeus 47.7). The mean node is the default
 *  in most Western software; the true node wobbles and would make a daily
 *  reading disagree with itself. */
function meanNode(T: number): number {
  return norm(125.04452 - 1934.136261 * T + 0.0020708 * T * T + T ** 3 / 450000)
}

const BODY: Partial<Record<Planet, A.Body>> = {
  Sun: A.Body.Sun, Mercury: A.Body.Mercury, Venus: A.Body.Venus, Mars: A.Body.Mars,
  Jupiter: A.Body.Jupiter, Saturn: A.Body.Saturn, Uranus: A.Body.Uranus,
  Neptune: A.Body.Neptune, Pluto: A.Body.Pluto,
}

/** Tropical geocentric ecliptic longitude, true equinox of date. */
export function longitude(p: Planet, date: Date): number {
  if (p === 'Moon') return norm(A.EclipticGeoMoon(date).lon)
  if (p === 'NorthNode') return meanNode(centuries(date))
  if (p === 'SouthNode') return norm(meanNode(centuries(date)) + 180)
  return norm(A.Ecliptic(A.GeoVector(BODY[p]!, date, true)).elon)
}

// ── Houses ────────────────────────────────────────────────────────────────

/** Ecliptic longitude of the point on the ecliptic with this right ascension. */
function lonFromRA(ra: number, eps: number): number {
  return norm(Math.atan2(Math.sin(ra * DEG), Math.cos(ra * DEG) * Math.cos(eps * DEG)) / DEG)
}

/** Local sidereal time in degrees = the right ascension of the Midheaven. */
function ramcOf(date: Date, lon: number): number {
  return norm(A.SiderealTime(date) * 15 + lon)
}

function ascendantOf(ramc: number, eps: number, lat: number): number {
  const r = ramc * DEG, e = eps * DEG, phi = lat * DEG
  return norm(Math.atan2(Math.cos(r), -(Math.sin(r) * Math.cos(e) + Math.tan(phi) * Math.sin(e))) / DEG)
}

/**
 * Placidus cusps 1–12.
 *
 * Placidus divides each quadrant by TIME, not by space: the arc a degree of
 * the ecliptic takes to travel from the horizon to the meridian is cut in
 * three. So each intermediate cusp depends on its own declination, which
 * depends on the cusp, which is why this iterates.
 *
 * Deriving the four seeds: hour angle H = RAMC - RA, a point rises at
 * H = -SD and sets at H = +SD where the semi-diurnal arc SD = 90 + AD and the
 * ascensional difference AD = asin(tan(lat)·tan(dec)). The quadrant from the
 * Ascendant (H = -SD) to the MC (H = 0) is cut in thirds, putting cusp 11 at
 * H = -SD/3 and cusp 12 at H = -2·SD/3. Below the horizon the semi-nocturnal
 * arc SN = 90 - AD runs from the IC (H = 180) to the Ascendant, putting cusp
 * 3 at H = 180 + SN/3 and cusp 2 at H = 180 + 2·SN/3. With AD = 0 those
 * collapse to RAMC + 30 / 60 / 150 / 120, which are the classic seeds.
 *
 * WHERE IT IS UNDEFINED: at |lat| >= 66° a degree of the ecliptic can be
 * circumpolar, tan(lat)·tan(dec) leaves [-1, 1], and the point never rises,
 * so there is no arc to divide. Rather than emit a NaN or a quietly wrong
 * cusp, this returns equal houses from the Ascendant and says so in `system`.
 * The board prints which one is in force, because a reader comparing against
 * another site needs to know why the numbers differ.
 */
export function houses(date: Date, lat: number, lon: number): { cusps: number[]; asc: number; mc: number; system: 'placidus' | 'equal' } {
  const eps = obliquity(centuries(date))
  const ramc = ramcOf(date, lon)
  const asc = ascendantOf(ramc, eps, lat)
  const mc = lonFromRA(ramc, eps)

  const equal = () => ({ cusps: Array.from({ length: 12 }, (_, i) => norm(asc + i * 30)), asc, mc, system: 'equal' as const })
  if (Math.abs(lat) >= 66) return equal()

  // ra(sd) gives the right ascension the cusp would have for a given semi-arc;
  // `nocturnal` cusps measure from the IC and use the semi-nocturnal arc.
  const solve = (ra0: number, ra: (arc: number) => number, nocturnal: boolean): number | null => {
    let x = ra0
    for (let i = 0; i < 40; i++) {
      const lam = lonFromRA(x, eps)
      const dec = Math.asin(clamp1(Math.sin(eps * DEG) * Math.sin(lam * DEG))) / DEG
      const t = Math.tan(lat * DEG) * Math.tan(dec * DEG)
      if (Math.abs(t) > 1) return null            // circumpolar: no arc to cut
      const ad = Math.asin(clamp1(t)) / DEG
      const next = norm(ra(nocturnal ? 90 - ad : 90 + ad))
      if (Math.abs(sep(x, next)) < 1e-9) { x = next; break }
      x = next
    }
    return lonFromRA(x, eps)
  }

  const c11 = solve(norm(ramc + 30),  sd => ramc + sd / 3,           false)
  const c12 = solve(norm(ramc + 60),  sd => ramc + (2 * sd) / 3,     false)
  const c2  = solve(norm(ramc + 120), sn => ramc - 180 - (2 * sn) / 3, true)
  const c3  = solve(norm(ramc + 150), sn => ramc - 180 - sn / 3,     true)
  if (c11 === null || c12 === null || c2 === null || c3 === null) return equal()

  const cusps = [asc, c2, c3, norm(mc + 180), norm(c11 + 180), norm(c12 + 180),
                 norm(asc + 180), norm(c2 + 180), norm(c3 + 180), mc, c11, c12]
  return { cusps, asc, mc, system: 'placidus' }
}

/** Which house a longitude falls in, 1–12, for cusps that may wrap. */
export function houseOf(lon: number, cusps: number[]): number {
  for (let i = 0; i < 12; i++) {
    const a = cusps[i], b = cusps[(i + 1) % 12]
    const span = norm(b - a)
    if (norm(lon - a) < span) return i + 1
  }
  return 1
}

// ── Aspects ───────────────────────────────────────────────────────────────

export type Aspect = {
  a: string; b: string
  name: AspectName; zh: string; glyph: string; angle: number
  orb: number              // how far off exact, degrees
  applying: boolean        // closing on exact rather than separating
}

const isLuminary = (k: string) => k === 'Sun' || k === 'Moon'

/**
 * Every aspect between two sets of placements. `speeds` decides applying vs
 * separating: an aspect that is still closing reads as building, and the
 * distinction is most of what makes a transit worth mentioning at all.
 */
export function aspectsBetween(
  left: Record<string, number>, right: Record<string, number>,
  opts?: { speeds?: Record<string, number>; sameSet?: boolean; maxOrb?: number },
): Aspect[] {
  const out: Aspect[] = []
  const lk = Object.keys(left), rk = Object.keys(right)
  for (let i = 0; i < lk.length; i++) {
    for (let j = 0; j < rk.length; j++) {
      // One pair once, and never a body against itself, when both sides are
      // the same chart.
      if (opts?.sameSet && j <= i) continue
      const a = lk[i], b = rk[j]
      // The nodes are exactly 180° apart by construction and the Part of
      // Fortune is derived from the Sun, Moon and Ascendant. Reporting those
      // as aspects would be reporting arithmetic as insight.
      if (opts?.sameSet && ((a === 'NorthNode' && b === 'SouthNode') || (a === 'SouthNode' && b === 'NorthNode'))) continue
      const d = Math.abs(sep(left[a], right[b]))
      for (const asp of ASPECTS) {
        const allow = Math.min(
          opts?.maxOrb ?? 99,
          asp.orb + (isLuminary(a) || isLuminary(b) ? LUMINARY_BONUS : 0))
        const orb = Math.abs(d - asp.angle)
        if (orb > allow) continue
        // Applying: the faster body is moving to close the gap. Relative
        // speed times the direction of the current offset.
        const va = opts?.speeds?.[a] ?? 0, vb = opts?.speeds?.[b] ?? 0
        const delta = sep(left[a], right[b])
        const current = Math.abs(delta)
        const closing = (current - asp.angle) * ((vb - va) * Math.sign(delta || 1)) < 0
        out.push({ a, b, name: asp.name, zh: asp.zh, glyph: asp.glyph, angle: asp.angle, orb, applying: closing })
        break
      }
    }
  }
  return out.sort((x, y) => x.orb - y.orb)
}

// ── The natal chart ───────────────────────────────────────────────────────

export type Placement = {
  body: Planet
  lon: number
  sign: number       // 0–11
  deg: number        // within the sign
  house: number      // 1–12
  retro: boolean
  speed: number      // degrees per day, signed
}

export type NatalChart = {
  utc: string
  tz: string
  place: string
  system: 'placidus' | 'equal'
  cusps: number[]
  angles: { asc: number; mc: number; fortune: number }
  planets: Placement[]
  aspects: Aspect[]
  balance: { elements: Record<string, number>; modalities: Record<string, number> }
  sect: 'day' | 'night'
  chartRuler: Planet | null
}

export type BirthPlace = { y: number; m: number; d: number; h: number; mi: number; lat: number; lon: number; tz: string; place: string }

/** Longitude of every body plus the angles, for aspect work. */
function pointMap(c: NatalChart): Record<string, number> {
  const m: Record<string, number> = {}
  for (const p of c.planets) m[p.body] = p.lon
  m.ASC = c.angles.asc; m.MC = c.angles.mc; m.Fortune = c.angles.fortune
  return m
}

export function natalChart(input: BirthPlace): NatalChart {
  const date = zonedToUtc(input.y, input.m, input.d, input.h, input.mi, input.tz)
  const h = houses(date, input.lat, input.lon)

  const dayBefore = new Date(date.getTime() - 43200000)
  const dayAfter = new Date(date.getTime() + 43200000)
  const planets: Placement[] = PLANETS.map(p => {
    const lon = longitude(p, date)
    // Centred difference over a day: a cleaner speed than a backward
    // difference near a station, which is exactly where retrograde matters.
    const speed = sep(longitude(p, dayBefore), longitude(p, dayAfter))
    return {
      body: p, lon, sign: Math.floor(lon / 30), deg: lon % 30,
      house: houseOf(lon, h.cusps),
      // The nodes always run backwards; the Sun and Moon never do.
      retro: p === 'NorthNode' || p === 'SouthNode' ? true : p === 'Sun' || p === 'Moon' ? false : speed < 0,
      speed,
    }
  })

  const sun = planets.find(p => p.body === 'Sun')!.lon
  const moon = planets.find(p => p.body === 'Moon')!.lon
  // A day chart has the Sun above the horizon: houses 7 through 12.
  const sunHouse = houseOf(sun, h.cusps)
  const sect: 'day' | 'night' = sunHouse >= 7 ? 'day' : 'night'
  // Part of Fortune, reversed by sect — the classical rule, not the modern
  // shortcut of always using the day formula.
  const fortune = sect === 'day' ? norm(h.asc + moon - sun) : norm(h.asc + sun - moon)

  const chart: NatalChart = {
    utc: date.toISOString(), tz: input.tz, place: input.place,
    system: h.system, cusps: h.cusps,
    angles: { asc: h.asc, mc: h.mc, fortune },
    planets, aspects: [],
    balance: balanceOf(planets),
    sect,
    chartRuler: (SIGNS[Math.floor(h.asc / 30)][4] as Planet) ?? null,
  }
  chart.aspects = aspectsBetween(pointMap(chart), pointMap(chart), {
    sameSet: true,
    speeds: Object.fromEntries(planets.map(p => [p.body, p.speed])),
  })
  return chart
}

/** Element and modality counts over the ten planets. The angles are left out
 *  deliberately: counting the Ascendant would double-weight a birth time the
 *  visitor may only know to the hour. */
function balanceOf(planets: Placement[]) {
  const elements: Record<string, number> = { 火: 0, 土: 0, 風: 0, 水: 0 }
  const modalities: Record<string, number> = { 基本: 0, 固定: 0, 變動: 0 }
  for (const p of planets) {
    if (p.body === 'NorthNode' || p.body === 'SouthNode') continue
    elements[SIGNS[p.sign][2]]++
    modalities[SIGNS[p.sign][3]]++
  }
  return { elements, modalities }
}

// ── Transits: what today is doing to the natal chart ──────────────────────

export type Transit = Aspect & { exact: string | null; transitSign: number; transitDeg: number; retro: boolean }

/**
 * Transiting bodies against a natal chart at a given moment.
 *
 * Orbs are TIGHT here (1° by default) and that is the whole point. A daily
 * reading with an 8° orb has thirty aspects in force every day of the year,
 * which is the same as having none: it cannot say what is different about
 * today. One degree is roughly a day of solar motion, so what comes back is
 * what is actually perfecting now.
 */
export function transits(natal: NatalChart, at: Date, maxOrb = 1): Transit[] {
  const moving: Record<string, number> = {}
  const speeds: Record<string, number> = {}
  const before = new Date(at.getTime() - 43200000), after = new Date(at.getTime() + 43200000)
  for (const p of PLANETS) {
    moving[p] = longitude(p, at)
    speeds[p] = sep(longitude(p, before), longitude(p, after))
  }
  const natalPoints = pointMap(natal)
  // Natal positions do not move, so every natal speed is zero.
  const found = aspectsBetween(moving, natalPoints, { speeds, maxOrb })
  return found.map(a => {
    const lon = moving[a.a]
    return {
      ...a,
      transitSign: Math.floor(lon / 30), transitDeg: lon % 30,
      retro: speeds[a.a] < 0,
      exact: exactDate(a.a as Planet, natalPoints[a.b], a.angle, at),
    }
  })
}

/**
 * When this transit perfects, searched ±45 days around `near`.
 *
 * Bisection on the signed offset from exact. A retrograde planet can perfect
 * the same aspect three times, so this reports the NEXT crossing rather than
 * pretending there is only one; the reading says "around", not "on".
 */
function exactDate(p: Planet, target: number, angle: number, near: Date): string | null {
  const f = (t: number) => sep(norm(target + angle), longitude(p, new Date(t)))
  const DAY = 86400000
  let prev = f(near.getTime() - 45 * DAY), prevT = near.getTime() - 45 * DAY
  for (let d = -44; d <= 45; d++) {
    const t = near.getTime() + d * DAY
    const v = f(t)
    // A sign change without a wrap (the jump at ±180 is the far side, not a
    // crossing) brackets the exact moment.
    if (prev !== 0 && Math.sign(v) !== Math.sign(prev) && Math.abs(v - prev) < 180) {
      let lo = prevT, hi = t
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2
        if (Math.sign(f(mid)) === Math.sign(f(lo))) lo = mid; else hi = mid
      }
      return new Date((lo + hi) / 2).toISOString().slice(0, 10)
    }
    prev = v; prevT = t
  }
  return null
}

/** Bodies currently retrograde, the one transit fact everybody already knows. */
export function retrogrades(at: Date): Planet[] {
  const before = new Date(at.getTime() - 43200000), after = new Date(at.getTime() + 43200000)
  return PLANETS.filter(p => p !== 'Sun' && p !== 'Moon' && p !== 'NorthNode' && p !== 'SouthNode'
    && sep(longitude(p, before), longitude(p, after)) < 0)
}

// ── Secondary progressions: a day for a year ──────────────────────────────

export type Progressed = {
  date: string
  sun: { sign: number; deg: number }
  moon: { sign: number; deg: number; house: number }
  aspects: Aspect[]
}

/**
 * Secondary progressions by the day-for-a-year convention: the sky N days
 * after birth, read as year N of the life.
 *
 * Only the Sun and Moon are reported. The outer planets barely move in ninety
 * days, so a progressed Pluto is the natal Pluto with a decimal place on it,
 * and printing one would imply a precision that is not there. The angles are
 * left out too: progressing them needs a choice between Naibod, solar arc and
 * the progressed sidereal time that the schools disagree on, and picking one
 * silently would make the board unverifiable.
 */
export function progressions(natal: NatalChart, birth: BirthPlace, at: Date): Progressed {
  const born = zonedToUtc(birth.y, birth.m, birth.d, birth.h, birth.mi, birth.tz)
  const years = (at.getTime() - born.getTime()) / (365.2422 * 86400000)
  const pDate = new Date(born.getTime() + years * 86400000)
  const sun = longitude('Sun', pDate), moon = longitude('Moon', pDate)
  const moving = { Sun: sun, Moon: moon }
  const speeds = { Sun: 1, Moon: 13 }
  return {
    date: pDate.toISOString().slice(0, 10),
    sun: { sign: Math.floor(sun / 30), deg: sun % 30 },
    moon: { sign: Math.floor(moon / 30), deg: moon % 30, house: houseOf(moon, natal.cusps) },
    aspects: aspectsBetween(moving, pointMap(natal), { speeds, maxOrb: 2 }),
  }
}

// ── Solar return ──────────────────────────────────────────────────────────

export type SolarReturn = { utc: string; year: number; asc: number; cusps: number[]; planets: Placement[]; system: 'placidus' | 'equal' }

/**
 * The moment the Sun returns to its natal longitude in a given year, and the
 * chart cast for it. This is the Western answer to 流年, and it is a real
 * instant rather than a convention: the return is found by bisection to
 * within a second, so the chart is as exact as the birth time it came from.
 *
 * Cast at the BIRTH place. Casting at the current residence is the other
 * school; doing it at the birthplace keeps the room's one input sufficient.
 */
export function solarReturn(birth: BirthPlace, year: number): SolarReturn {
  const born = zonedToUtc(birth.y, birth.m, birth.d, birth.h, birth.mi, birth.tz)
  const target = longitude('Sun', born)
  // The Sun passes any longitude once a year; search a 40-day window around
  // the anniversary, which covers the leap-day drift many times over.
  const anniversary = Date.UTC(year, birth.m - 1, birth.d, 12)
  const f = (t: number) => sep(target, longitude('Sun', new Date(t)))
  const DAY = 86400000
  let lo = anniversary - 20 * DAY, hi = anniversary + 20 * DAY
  let prev = f(lo), prevT = lo
  for (let t = lo + DAY; t <= hi; t += DAY) {
    const v = f(t)
    if (Math.sign(v) !== Math.sign(prev) && Math.abs(v - prev) < 180) { lo = prevT; hi = t; break }
    prev = v; prevT = t
  }
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2
    if (Math.sign(f(mid)) === Math.sign(f(lo))) lo = mid; else hi = mid
  }
  const at = new Date((lo + hi) / 2)
  const h = houses(at, birth.lat, birth.lon)
  const before = new Date(at.getTime() - 43200000), after = new Date(at.getTime() + 43200000)
  const planets: Placement[] = PLANETS.map(p => {
    const lon = longitude(p, at)
    const speed = sep(longitude(p, before), longitude(p, after))
    return {
      body: p, lon, sign: Math.floor(lon / 30), deg: lon % 30, house: houseOf(lon, h.cusps),
      retro: p === 'NorthNode' || p === 'SouthNode' ? true : p === 'Sun' || p === 'Moon' ? false : speed < 0,
      speed,
    }
  })
  return { utc: at.toISOString(), year, asc: h.asc, cusps: h.cusps, planets, system: h.system }
}

// ── Synastry and the composite ────────────────────────────────────────────

export type Synastry = {
  inter: Aspect[]
  composite: { asc: number | null; planets: Array<{ body: Planet; lon: number; sign: number; deg: number }> }
  elementFit: { a: Record<string, number>; b: Record<string, number>; shared: string[]; missing: string[] }
}

/**
 * Two charts read against each other.
 *
 * `inter` is the synastry proper: every planet of A against every planet and
 * angle of B, which is the part Western astrology does that 合婚 does not.
 * The composite is the midpoint chart, and its midpoints are taken the SHORT
 * way round, because the long way puts the composite Sun opposite where every
 * other program puts it.
 */
export function synastry(a: NatalChart, b: NatalChart): Synastry {
  const pa = pointMap(a), pb = pointMap(b)
  const speeds = Object.fromEntries([...a.planets, ...b.planets].map(p => [p.body, p.speed]))
  const inter = aspectsBetween(pa, pb, { speeds })

  const mid = (x: number, y: number) => norm(x + sep(x, y) / 2)
  const planets = PLANETS.map(body => {
    const lon = mid(a.planets.find(p => p.body === body)!.lon, b.planets.find(p => p.body === body)!.lon)
    return { body, lon, sign: Math.floor(lon / 30), deg: lon % 30 }
  })

  const shared = ELEMENTS.filter(e => a.balance.elements[e] > 0 && b.balance.elements[e] > 0) as unknown as string[]
  const missing = ELEMENTS.filter(e => a.balance.elements[e] === 0 && b.balance.elements[e] === 0) as unknown as string[]
  return {
    inter,
    composite: { asc: mid(a.angles.asc, b.angles.asc), planets },
    elementFit: { a: a.balance.elements, b: b.balance.elements, shared, missing },
  }
}

// ── Facts for the master ──────────────────────────────────────────────────

const dms = (d: number) => `${Math.floor(d)}°${String(Math.floor((d % 1) * 60)).padStart(2, '0')}'`
export const signName = (i: number) => `${SIGNS[i][1]}座`
const bodyName = (k: string) => (PLANET_ZH as any)[k] ?? (POINT_ZH as any)[k] ?? k
const aspectLine = (x: Aspect) => `${bodyName(x.a)} ${x.zh} ${bodyName(x.b)}（誤差 ${x.orb.toFixed(1)}°${x.applying ? '，入相位' : '，出相位'}）`

export function natalFacts(c: NatalChart, gender: string): string {
  const rows = c.planets.map(p =>
    `  ${PLANET_ZH[p.body]}：${signName(p.sign)} ${dms(p.deg)}，第${p.house}宮${p.retro && p.body !== 'NorthNode' && p.body !== 'SouthNode' ? '，逆行' : ''}`)
  const cusps = c.cusps.map((x, i) => `  第${i + 1}宮：${signName(Math.floor(x / 30))} ${dms(x % 30)}`)
  const el = ELEMENTS.map(e => `${e} ${c.balance.elements[e]}`).join('、')
  const mo = MODALITIES.map(m => `${m} ${c.balance.modalities[m]}`).join('、')
  return [
    `出生：${c.utc.replace('T', ' ').slice(0, 16)} UTC，${c.place}（${c.tz}），${gender === 'male' ? '男' : '女'}`,
    `制度：回歸黃道（西洋占星）；${c.system === 'placidus' ? 'Placidus 分宮' : '等宮制（該緯度無法用 Placidus）'}；南北交點取平均交點。`,
    `上升 ${signName(Math.floor(c.angles.asc / 30))} ${dms(c.angles.asc % 30)}　天頂 ${signName(Math.floor(c.angles.mc / 30))} ${dms(c.angles.mc % 30)}　福點 ${signName(Math.floor(c.angles.fortune / 30))} ${dms(c.angles.fortune % 30)}`,
    `命主星（上升星座守護星）：${c.chartRuler ? PLANET_ZH[c.chartRuler] : '—'}；${c.sect === 'day' ? '日生盤（太陽在地平線上）' : '夜生盤（太陽在地平線下）'}`,
    `十大行星：`, ...rows,
    `宮頭：`, ...cusps,
    `元素分佈：${el}；三模式：${mo}`,
    `主要相位（托勒密五相位）：`, ...c.aspects.slice(0, 24).map(a => `  ${aspectLine(a)}`),
  ].join('\n')
}

export function transitFacts(list: Transit[], retro: Planet[], at: Date, moonSign: number): string {
  const lines = list.map(x =>
    `  行運${bodyName(x.a)}（${signName(x.transitSign)} ${dms(x.transitDeg)}${x.retro ? ' 逆行' : ''}）${x.zh} 本命${bodyName(x.b)}，誤差 ${x.orb.toFixed(2)}°${x.applying ? '，入相位' : '，出相位'}${x.exact ? `，準確日約 ${x.exact}` : ''}`)
  return [
    `日期：${at.toISOString().slice(0, 10)}（UTC）`,
    `今日月亮：${signName(moonSign)}`,
    retro.length ? `目前逆行：${retro.map(p => PLANET_ZH[p]).join('、')}` : '目前沒有行星逆行。',
    list.length ? `今日生效的行運相位（1° 內）：` : '今日沒有 1° 內的行運相位——這種日子是背景，不是事件。',
    ...lines,
  ].join('\n')
}

export function synastryFacts(a: NatalChart, b: NatalChart, s: Synastry, aGender: string, bGender: string): string {
  const top = s.inter.slice(0, 22).map(x => `  第一位的${bodyName(x.a)} ${x.zh} 第二位的${bodyName(x.b)}（誤差 ${x.orb.toFixed(1)}°）`)
  const comp = s.composite.planets.slice(0, 10).map(p => `  ${PLANET_ZH[p.body]}：${signName(p.sign)} ${dms(p.deg)}`)
  return [
    `第一位（${aGender === 'male' ? '男' : '女'}）：上升 ${signName(Math.floor(a.angles.asc / 30))}，太陽 ${signName(a.planets[0].sign)}，月亮 ${signName(a.planets[1].sign)}`,
    `第二位（${bGender === 'male' ? '男' : '女'}）：上升 ${signName(Math.floor(b.angles.asc / 30))}，太陽 ${signName(b.planets[0].sign)}，月亮 ${signName(b.planets[1].sign)}`,
    `元素：第一位 ${ELEMENTS.map(e => `${e}${a.balance.elements[e]}`).join('、')}；第二位 ${ELEMENTS.map(e => `${e}${b.balance.elements[e]}`).join('、')}`,
    s.elementFit.missing.length ? `兩人都缺的元素：${s.elementFit.missing.join('、')}` : '兩人合起來四元素俱全。',
    `合盤相位（比對盤，第一位的星對第二位的星）：`, ...top,
    `組合盤（中點）：上升 ${s.composite.asc !== null ? `${signName(Math.floor(s.composite.asc / 30))} ${dms(s.composite.asc % 30)}` : '—'}`,
    ...comp,
  ].join('\n')
}

export function returnFacts(r: SolarReturn): string {
  const rows = r.planets.slice(0, 10).map(p => `  ${PLANET_ZH[p.body]}：${signName(p.sign)} ${dms(p.deg)}，第${p.house}宮${p.retro ? '，逆行' : ''}`)
  return [
    `${r.year} 年太陽回歸：${r.utc.replace('T', ' ').slice(0, 16)} UTC，於出生地起盤`,
    `回歸盤上升：${signName(Math.floor(r.asc / 30))} ${dms(r.asc % 30)}`,
    `回歸盤行星：`, ...rows,
  ].join('\n')
}
