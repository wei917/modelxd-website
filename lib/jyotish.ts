// lib/jyotish.ts — a small Vedic (sidereal) chart engine for 九曜廟.
//
// No mature JavaScript Jyotish library exists (surveyed Sep 1: vedic-astro
// is positions + panchang with 1 star, grahan is Sun/Moon only, jyotishganit
// is Python, Swiss Ephemeris bindings are a native addon under AGPL). What a
// chart needs is small: nine sidereal longitudes, the ascendant, and
// arithmetic on top. astronomy-engine (MIT, pure JS, Don Cross) gives
// true-ecliptic-of-date positions to arcsecond accuracy; everything else is
// here, ~250 lines, and checked against Swiss Ephemeris (Lahiri) in the
// golden suite — so a wrong 宿 fails loudly instead of quietly.
//
//   Ayanamsa   Lahiri (Chitrapaksha): the Swiss Ephemeris J2000 value plus
//              IAU general precession in longitude since J2000.
//   Rahu/Ketu  Mean lunar node (Meeus), the default of most Indian software.
//   Houses     Whole sign from the Lagna (the Parashari default).
//   D9         Navamsa by the standard 9-fold division.
//   Dasha      Vimshottari from the Moon's nakshatra, 365.25-day years.
//
// Pure computation: no I/O, no randomness, client-safe. Time zone handling
// uses Intl so DST places (US, Europe) come out right without a tz database.

import * as A from 'astronomy-engine'

export const GRAHAS = ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn', 'Rahu', 'Ketu'] as const
export type Graha = (typeof GRAHAS)[number]

export const GRAHA_ZH: Record<Graha, string> = {
  Sun: '太陽', Moon: '月亮', Mars: '火星', Mercury: '水星', Jupiter: '木星', Venus: '金星', Saturn: '土星', Rahu: '羅睺', Ketu: '計都',
}
export const GRAHA_SA: Record<Graha, string> = {
  Sun: 'Surya', Moon: 'Chandra', Mars: 'Mangala', Mercury: 'Budha', Jupiter: 'Guru', Venus: 'Shukra', Saturn: 'Shani', Rahu: 'Rahu', Ketu: 'Ketu',
}

export const RASI = [
  ['Mesha', '白羊'], ['Vrishabha', '金牛'], ['Mithuna', '雙子'], ['Karka', '巨蟹'], ['Simha', '獅子'], ['Kanya', '處女'],
  ['Tula', '天秤'], ['Vrischika', '天蠍'], ['Dhanu', '射手'], ['Makara', '摩羯'], ['Kumbha', '水瓶'], ['Meena', '雙魚'],
] as const

// The 27 nakshatras with the 宿曜經 (Tang, Amoghavajra) Chinese equivalents:
// the Buddhist mapping onto the 二十八宿 drops 牛宿 (Abhijit).
export const NAKSHATRA = [
  ['Ashwini', '婁'], ['Bharani', '胃'], ['Krittika', '昴'], ['Rohini', '畢'], ['Mrigashira', '觜'], ['Ardra', '參'],
  ['Punarvasu', '井'], ['Pushya', '鬼'], ['Ashlesha', '柳'], ['Magha', '星'], ['Purva Phalguni', '張'], ['Uttara Phalguni', '翼'],
  ['Hasta', '軫'], ['Chitra', '角'], ['Swati', '亢'], ['Vishakha', '氐'], ['Anuradha', '房'], ['Jyeshtha', '心'],
  ['Mula', '尾'], ['Purva Ashadha', '箕'], ['Uttara Ashadha', '斗'], ['Shravana', '女'], ['Dhanishta', '虛'], ['Shatabhisha', '危'],
  ['Purva Bhadrapada', '室'], ['Uttara Bhadrapada', '壁'], ['Revati', '奎'],
] as const

// Vimshottari: lord and years, in nakshatra order starting from Ashwini.
const DASHA_LORDS: Array<[Graha, number]> = [
  ['Ketu', 7], ['Venus', 20], ['Sun', 6], ['Moon', 10], ['Mars', 7], ['Rahu', 18], ['Jupiter', 16], ['Saturn', 19], ['Mercury', 17],
]
const DASHA_TOTAL = 120

const norm = (d: number) => ((d % 360) + 360) % 360
const DEG = Math.PI / 180

// ── Time ──────────────────────────────────────────────────────────────────

/** Local wall-clock time in an IANA zone → UTC Date. Two-pass offset lookup
 *  through Intl, so DST is honoured wherever the zone has it. */
export function zonedToUtc(y: number, m: number, d: number, h: number, mi: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, h, mi)
  const offset = (at: number) => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
      .formatToParts(new Date(at))
    const get = (t: string) => Number(parts.find(p => p.type === t)?.value)
    return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - at
  }
  const utc1 = guess - offset(guess)
  return new Date(guess - offset(utc1))
}

/** Julian centuries from J2000 for a Date. */
function centuries(date: Date): number {
  return (date.getTime() / 86400000 + 2440587.5 - 2451545.0) / 36525
}

// ── Ayanamsa ──────────────────────────────────────────────────────────────

/** Lahiri at J2000 (Swiss Ephemeris SIDM_LAHIRI, observed 23.857092°) plus
 *  IAU 2006 general precession in longitude since J2000. */
export function lahiriAyanamsa(date: Date): number {
  const T = centuries(date)
  const pA = (5028.796195 * T + 1.1054348 * T * T + 0.00007964 * T ** 3) / 3600
  return 23.857092 + pA
}

/** Mean obliquity of the ecliptic (IAU 2006), degrees. */
function obliquity(T: number): number {
  return 23.439279 - (46.836769 * T - 0.0001831 * T * T + 0.0020034 * T ** 3) / 3600
}

/** Mean ascending node of the Moon (Meeus 47.7), tropical of date. */
function meanNode(T: number): number {
  return norm(125.04452 - 1934.136261 * T + 0.0020708 * T * T + T ** 3 / 450000)
}

// ── Positions ─────────────────────────────────────────────────────────────

const BODY: Partial<Record<Graha, A.Body>> = {
  Sun: A.Body.Sun, Mars: A.Body.Mars, Mercury: A.Body.Mercury, Jupiter: A.Body.Jupiter, Venus: A.Body.Venus, Saturn: A.Body.Saturn,
}

/** Tropical (true ecliptic of date) geocentric longitude. */
function tropical(g: Graha, date: Date): number {
  if (g === 'Moon') return norm(A.EclipticGeoMoon(date).lon)
  if (g === 'Rahu') return meanNode(centuries(date))
  if (g === 'Ketu') return norm(meanNode(centuries(date)) + 180)
  return norm(A.Ecliptic(A.GeoVector(BODY[g]!, date, true)).elon)
}

/** Tropical ascendant from local sidereal time and latitude. */
function ascendant(date: Date, lat: number, lon: number): number {
  const T = centuries(date)
  const ramc = norm(A.SiderealTime(date) * 15 + lon) * DEG
  const eps = obliquity(T) * DEG, phi = lat * DEG
  const asc = Math.atan2(Math.cos(ramc), -(Math.sin(ramc) * Math.cos(eps) + Math.tan(phi) * Math.sin(eps)))
  return norm(asc / DEG)
}

// ── The chart ─────────────────────────────────────────────────────────────

export type Placement = {
  graha: Graha
  lon: number            // sidereal, 0–360
  rasi: number           // 0–11
  deg: number            // degrees within the sign
  nakshatra: number      // 0–26
  pada: number           // 1–4
  house: number          // 1–12, whole sign from the Lagna
  navamsa: number        // D9 sign, 0–11
  retro: boolean
}

export type DashaPeriod = { lord: Graha; from: Date; to: Date }

export type JyotishChart = {
  utc: string
  tz: string
  place: string
  ayanamsa: number
  lagna: { lon: number; rasi: number; deg: number; nakshatra: number; pada: number; navamsa: number }
  grahas: Placement[]
  moonNakshatra: number
  dasha: { maha: DashaPeriod[]; current: DashaPeriod | null; antar: DashaPeriod[]; currentAntar: DashaPeriod | null }
}

const nakOf = (lon: number) => Math.floor(lon / (360 / 27))
const padaOf = (lon: number) => (Math.floor(lon / (360 / 108)) % 4) + 1
/** D9: the sign in which the 3°20' slice falls, counting from the sign itself. */
const navamsaOf = (lon: number) => (Math.floor(lon / 30) * 9 + Math.floor((lon % 30) / (10 / 3))) % 12

export function jyotishChart(input: { y: number; m: number; d: number; h: number; mi: number; lat: number; lon: number; tz: string; place: string }): JyotishChart {
  const date = zonedToUtc(input.y, input.m, input.d, input.h, input.mi, input.tz)
  const ayan = lahiriAyanamsa(date)
  const sid = (t: number) => norm(t - ayan)

  const ascLon = sid(ascendant(date, input.lat, input.lon))
  const lagnaRasi = Math.floor(ascLon / 30)
  const lagna = { lon: ascLon, rasi: lagnaRasi, deg: ascLon % 30, nakshatra: nakOf(ascLon), pada: padaOf(ascLon), navamsa: navamsaOf(ascLon) }

  const dayBefore = new Date(date.getTime() - 86400000)
  const grahas: Placement[] = GRAHAS.map(g => {
    const lon = sid(tropical(g, date))
    const prev = sid(tropical(g, dayBefore))
    const motion = norm(lon - prev + 180) - 180
    return {
      graha: g, lon, rasi: Math.floor(lon / 30), deg: lon % 30,
      nakshatra: nakOf(lon), pada: padaOf(lon),
      house: ((Math.floor(lon / 30) - lagnaRasi + 12) % 12) + 1,
      navamsa: navamsaOf(lon),
      // The nodes always run backwards; Sun and Moon never do.
      retro: g === 'Rahu' || g === 'Ketu' ? true : g === 'Sun' || g === 'Moon' ? false : motion < 0,
    }
  })

  const moon = grahas.find(g => g.graha === 'Moon')!
  return {
    utc: date.toISOString(), tz: input.tz, place: input.place, ayanamsa: ayan,
    lagna, grahas, moonNakshatra: moon.nakshatra,
    dasha: vimshottari(moon.lon, date, new Date()),
  }
}

// ── Vimshottari ───────────────────────────────────────────────────────────

const YEAR_MS = 365.25 * 86400000

export function vimshottari(moonLon: number, birth: Date, now: Date) {
  const span = 360 / 27
  const nak = Math.floor(moonLon / span)
  const elapsed = (moonLon - nak * span) / span
  const maha: DashaPeriod[] = []
  let t = birth.getTime()
  for (let i = 0; i < 9; i++) {
    const [lord, years] = DASHA_LORDS[(nak + i) % 9]
    const ms = years * YEAR_MS * (i === 0 ? 1 - elapsed : 1)
    maha.push({ lord, from: new Date(t), to: new Date(t + ms) })
    t += ms
  }
  const current = maha.find(p => now >= p.from && now < p.to) ?? null
  // Antardashas of the current mahadasha: same nine lords in order starting
  // from the mahadasha lord, each proportional to its own years.
  const antar: DashaPeriod[] = []
  if (current) {
    const start = DASHA_LORDS.findIndex(([l]) => l === current.lord)
    const full = DASHA_LORDS[start][1]
    // The first mahadasha is truncated at birth, so lay antardashas over the
    // FULL period ending at `to`, then keep those that end after birth.
    const fullFrom = current.to.getTime() - full * YEAR_MS
    let a = fullFrom
    for (let i = 0; i < 9; i++) {
      const [lord, years] = DASHA_LORDS[(start + i) % 9]
      const ms = full * years / DASHA_TOTAL * YEAR_MS
      if (a + ms > birth.getTime()) antar.push({ lord, from: new Date(Math.max(a, birth.getTime())), to: new Date(a + ms) })
      a += ms
    }
  }
  const currentAntar = antar.find(p => now >= p.from && now < p.to) ?? null
  return { maha, current, antar, currentAntar }
}

// ── Facts for the master ──────────────────────────────────────────────────

const dms = (d: number) => `${Math.floor(d)}°${String(Math.round((d % 1) * 60)).padStart(2, '0')}'`
const ymd = (d: Date) => d.toISOString().slice(0, 10)
const nakName = (i: number) => `${NAKSHATRA[i][0]}（${NAKSHATRA[i][1]}宿）`
const rasiName = (i: number) => `${RASI[i][1]}座 ${RASI[i][0]}`

export function jyotishFacts(c: JyotishChart, gender: string): string {
  const rows = c.grahas.map(p =>
    `  ${GRAHA_ZH[p.graha]} ${GRAHA_SA[p.graha]}：${rasiName(p.rasi)} ${dms(p.deg)}，第${p.house}宮，${nakName(p.nakshatra)} 第${p.pada}足，D9 ${RASI[p.navamsa][1]}${p.retro && p.graha !== 'Rahu' && p.graha !== 'Ketu' ? '，逆行' : ''}`)
  const maha = c.dasha.maha.map(p => `  ${GRAHA_ZH[p.lord]}大運 ${ymd(p.from)} 至 ${ymd(p.to)}`)
  const antar = c.dasha.antar.map(p => `  ${GRAHA_ZH[p.lord]} ${ymd(p.from)} 至 ${ymd(p.to)}`)
  return [
    `出生：${c.utc.replace('T', ' ').slice(0, 16)} UTC，${c.place}（${c.tz}），${gender === 'male' ? '男' : '女'}`,
    `制度：恆星黃道，Lahiri 歲差 ${c.ayanamsa.toFixed(4)}°；整宮制；羅睺計都取平均交點。`,
    `上升（Lagna）：${rasiName(c.lagna.rasi)} ${dms(c.lagna.deg)}，${nakName(c.lagna.nakshatra)} 第${c.lagna.pada}足`,
    `月亮所在宿（Janma Nakshatra）：${nakName(c.moonNakshatra)}`,
    `九曜（D1 命盤）：`, ...rows,
    `Vimshottari 大運：`, ...maha,
    c.dasha.current ? `目前大運：${GRAHA_ZH[c.dasha.current.lord]}（${ymd(c.dasha.current.from)} 至 ${ymd(c.dasha.current.to)}）` : '',
    c.dasha.currentAntar ? `目前副運（Antardasha）：${GRAHA_ZH[c.dasha.currentAntar.lord]}（${ymd(c.dasha.currentAntar.from)} 至 ${ymd(c.dasha.currentAntar.to)}）` : '',
    antar.length ? `本大運的副運：` : '', ...antar,
  ].filter(Boolean).join('\n')
}
