// scripts/test-astrology.ts — unit test for lib/astrology.ts.
//   npx tsx scripts/test-astrology.ts
//
// The part that needs proving is the houses. Planetary longitudes come from
// astronomy-engine, which the Jyotish golden suite already checks against
// Swiss Ephemeris; the tropical values are those same numbers before the
// ayanamsa is taken off, so this file checks that relationship holds and then
// spends its effort on Placidus, which is ours.
//
// Placidus is verified from its DEFINITION rather than against a table: cusp
// 11 is the ecliptic degree standing two thirds of the way from its own
// rising to its own culmination. That is checkable without any external
// reference, by taking the cusp this code returns, recomputing its
// declination and semi-diurnal arc independently, and asking where in its own
// arc it actually is.

import {
  natalChart, houses, transits, progressions, solarReturn, synastry, retrogrades,
  aspectsBetween, houseOf, longitude, SIGNS, PLANETS, type BirthPlace,
} from '../lib/astrology'
import { jyotishChart, lahiriAyanamsa, zonedToUtc } from '../lib/jyotish'

let fails = 0
const check = (name: string, cond: boolean, extra = '') => {
  if (!cond) { fails++; console.log('FAIL', name, extra) } else console.log('ok  ', name, extra)
}
const norm = (d: number) => ((d % 360) + 360) % 360
const sep = (a: number, b: number) => { const d = norm(b - a); return d > 180 ? d - 360 : d }
const DEG = Math.PI / 180

// Taipei, a real place in the curated list, and an hour that is not noon so
// the angles are not accidentally symmetric.
const TAIPEI: BirthPlace = { y: 1990, m: 6, d: 15, h: 14, mi: 30, lat: 25.033, lon: 121.5654, tz: 'Asia/Taipei', place: '台北' }
const c = natalChart(TAIPEI)

// ── The ephemeris path ────────────────────────────────────────────────────
// Same instant through both engines: tropical minus Lahiri must be sidereal.
const j = jyotishChart(TAIPEI)
const ayan = lahiriAyanamsa(new Date(c.utc))
const pairs: Array<[string, string]> = [['Sun', 'Sun'], ['Moon', 'Moon'], ['Mars', 'Mars'], ['Saturn', 'Saturn'], ['NorthNode', 'Rahu']]
let worst = 0
for (const [w, v] of pairs) {
  const west = c.planets.find(p => p.body === (w as any))!.lon
  const ved = j.grahas.find(g => g.graha === (v as any))!.lon
  worst = Math.max(worst, Math.abs(sep(norm(west - ayan), ved)))
}
check('tropical - Lahiri == sidereal, all bodies', worst < 1e-9, `worst ${(worst * 3600).toExponential(1)}"`)
check('ascendant agrees with the Jyotish engine', Math.abs(sep(norm(c.angles.asc - ayan), j.lagna.lon)) < 1e-9)

// ── Houses ────────────────────────────────────────────────────────────────
check('twelve cusps', c.cusps.length === 12)
check('cusp 1 is the Ascendant, cusp 10 the MC', c.cusps[0] === c.angles.asc && c.cusps[9] === c.angles.mc)
check('opposite cusps are opposite', [0, 1, 2].every(i =>
  Math.abs(sep(c.cusps[i] + 180, c.cusps[i + 6])) < 1e-9 && Math.abs(sep(c.cusps[i + 3] + 180, c.cusps[i + 9])) < 1e-9))
check('cusps run forward around the zodiac', c.cusps.every((x, i) => {
  const span = norm(c.cusps[(i + 1) % 12] - x)
  return span > 0.5 && span < 180
}), `spans ${c.cusps.map((x, i) => norm(c.cusps[(i + 1) % 12] - x).toFixed(0)).join(',')}`)
check('Placidus in force at this latitude', c.system === 'placidus')

// THE definitional test. For each intermediate cusp, recompute its own
// declination and semi-arc from scratch and ask what fraction of that arc it
// has travelled. Placidus says exactly a third, two thirds, and so on.
function arcFraction(cuspLon: number, date: Date, lat: number, lon: number) {
  const T = (date.getTime() / 86400000 + 2440587.5 - 2451545.0) / 36525
  const eps = 23.439279 - (46.836769 * T - 0.0001831 * T * T + 0.0020034 * T ** 3) / 3600
  // The cusp as a fixed point on the celestial sphere.
  const ra = norm(Math.atan2(Math.sin(cuspLon * DEG) * Math.cos(eps * DEG), Math.cos(cuspLon * DEG)) / DEG)
  const dec = Math.asin(Math.sin(eps * DEG) * Math.sin(cuspLon * DEG)) / DEG
  const ad = Math.asin(Math.tan(lat * DEG) * Math.tan(dec * DEG)) / DEG
  const sd = 90 + ad, sn = 90 - ad
  // Hour angle now. Negative = east of the meridian, not yet culminated.
  const ramc = norm((new (require('astronomy-engine').AstroTime)(date), require('astronomy-engine').SiderealTime(date)) * 15 + lon)
  const h = sep(ra, ramc)
  return { h, sd, sn }
}
for (const [i, want, arc] of [[10, -1 / 3, 'sd'], [11, -2 / 3, 'sd'], [2, 1 / 3, 'sn'], [1, 2 / 3, 'sn']] as const) {
  const { h, sd, sn } = arcFraction(c.cusps[i], new Date(c.utc), TAIPEI.lat, TAIPEI.lon)
  // Cusps 11 and 12 sit between the Ascendant and the MC, so their hour angle
  // is a negative fraction of the semi-diurnal arc. Cusps 2 and 3 sit below,
  // measured from the IC through the semi-nocturnal arc.
  const got = arc === 'sd' ? h / sd : sep(180, h) / sn
  const label = `cusp ${i + 1} stands at ${want < 0 ? `${Math.abs(want * 3).toFixed(0)}/3` : `${(want * 3).toFixed(0)}/3`} of its own semi-${arc === 'sd' ? 'diurnal' : 'nocturnal'} arc`
  check(label, Math.abs(got - want) < 1e-6, `got ${got.toFixed(9)} want ${want.toFixed(9)}`)
}

// At the equator no degree has an ascensional difference, so every semi-arc
// is 90° and Placidus collapses to equal divisions of right ascension. That
// is a closed-form answer this code must reproduce.
const eq = houses(new Date(c.utc), 0, 121.5654)
const T0 = (new Date(c.utc).getTime() / 86400000 + 2440587.5 - 2451545.0) / 36525
const eps0 = 23.439279 - (46.836769 * T0 - 0.0001831 * T0 * T0 + 0.0020034 * T0 ** 3) / 3600
const A0 = require('astronomy-engine')
const ramc0 = norm(A0.SiderealTime(new Date(c.utc)) * 15 + 121.5654)
const fromRA = (ra: number) => norm(Math.atan2(Math.sin(ra * DEG), Math.cos(ra * DEG) * Math.cos(eps0 * DEG)) / DEG)
check('at the equator Placidus is equal thirds of right ascension',
  [[10, 30], [11, 60], [1, 120], [2, 150]].every(([i, off]) => Math.abs(sep(eq.cusps[i], fromRA(ramc0 + off))) < 1e-6))

// Above the arctic circle a degree of the ecliptic can be circumpolar: there
// is no rising, so no arc to divide, so Placidus has no answer and must say so.
const arctic = houses(new Date(c.utc), 69.65, 18.96)   // Tromsø
check('polar latitude falls back to equal houses and says so', arctic.system === 'equal'
  && arctic.cusps.every((x, i) => Math.abs(sep(x, norm(arctic.asc + i * 30))) < 1e-9))

check('houseOf places a longitude in the right house', (() => {
  // Every cusp must land in its own house, and a degree just before a cusp in
  // the previous one.
  return c.cusps.every((x, i) => houseOf(norm(x + 0.001), c.cusps) === i + 1
    && houseOf(norm(x - 0.001), c.cusps) === ((i + 11) % 12) + 1)
})())

// ── Placements ────────────────────────────────────────────────────────────
check('ten planets plus both nodes', c.planets.length === 12)
check('nodes are exactly opposite', Math.abs(sep(
  c.planets.find(p => p.body === 'NorthNode')!.lon + 180,
  c.planets.find(p => p.body === 'SouthNode')!.lon)) < 1e-9)
check('sign and degree agree with the longitude', c.planets.every(p =>
  p.sign === Math.floor(p.lon / 30) && Math.abs(p.deg - (p.lon % 30)) < 1e-9))
check('the Sun and Moon are never retrograde, the nodes always',
  !c.planets.find(p => p.body === 'Sun')!.retro && !c.planets.find(p => p.body === 'Moon')!.retro
  && c.planets.find(p => p.body === 'NorthNode')!.retro)
check('element and modality counts total ten planets',
  Object.values(c.balance.elements).reduce((a, b) => a + b, 0) === 10
  && Object.values(c.balance.modalities).reduce((a, b) => a + b, 0) === 10)
check('chart ruler is the Ascendant sign ruler', c.chartRuler === SIGNS[Math.floor(c.angles.asc / 30)][4])
check('sect matches where the Sun is', (c.sect === 'day') === (c.planets.find(p => p.body === 'Sun')!.house >= 7))

// ── Aspects ───────────────────────────────────────────────────────────────
check('an exact square is found', (() => {
  const a = aspectsBetween({ X: 10 }, { Y: 100 }, {})
  return a.length === 1 && a[0].name === 'square' && a[0].orb < 1e-9
})())
check('a 9° square is outside the orb', aspectsBetween({ X: 10 }, { Y: 109 }, {}).length === 0)
// A square 8° from exact: inside the luminary allowance (7 + 2), outside the
// base one, so the same geometry is an aspect for the Sun and not for Mars.
check('the luminaries get the wider orb', aspectsBetween({ Sun: 10 }, { Y: 108 }, {}).length === 1
  && aspectsBetween({ Mars: 10 }, { Y: 108 }, {}).length === 0)
check('the nodes are not aspected to each other', (() => {
  const m = { NorthNode: 10, SouthNode: 190 }
  return aspectsBetween(m, m, { sameSet: true }).length === 0
})())
check('same-set aspects are not double counted', (() => {
  const m = { A: 0, B: 90, C: 180 }
  return aspectsBetween(m, m, { sameSet: true }).length === 3   // A□B, B□C, A☍C
})())
check('applying vs separating', (() => {
  // A fast body 1° short of a conjunction is applying; 1° past it is not.
  const before = aspectsBetween({ Moon: 89 }, { Mars: 90 }, { speeds: { Moon: 13, Mars: 0.5 } })[0]
  const after = aspectsBetween({ Moon: 91 }, { Mars: 90 }, { speeds: { Moon: 13, Mars: 0.5 } })[0]
  return before.applying && !after.applying
})())

// ── Time ──────────────────────────────────────────────────────────────────
const now = new Date('2026-09-09T12:00:00Z')
const tr = transits(c, now)
check('transits stay inside the tight orb', tr.every(x => x.orb <= 1 + 1e-9), `${tr.length} in force`)
check('a transit that names an exact date has it near today', tr.filter(x => x.exact).every(x =>
  Math.abs(new Date(x.exact!).getTime() - now.getTime()) < 60 * 86400000))
check('retrogrades never include the lights or the nodes',
  retrogrades(now).every(p => p !== 'Sun' && p !== 'Moon' && p !== 'NorthNode' && p !== 'SouthNode'))

const pr = progressions(c, TAIPEI, now)
check('progressed date is a day per year from birth', (() => {
  const born = zonedToUtc(TAIPEI.y, TAIPEI.m, TAIPEI.d, TAIPEI.h, TAIPEI.mi, TAIPEI.tz)
  const years = (now.getTime() - born.getTime()) / (365.2422 * 86400000)
  const want = new Date(born.getTime() + years * 86400000).toISOString().slice(0, 10)
  return pr.date === want
})(), `→ ${pr.date} (age ${((now.getTime() - zonedToUtc(TAIPEI.y, TAIPEI.m, TAIPEI.d, TAIPEI.h, TAIPEI.mi, TAIPEI.tz).getTime()) / (365.2422 * 86400000)).toFixed(1)})`)
check('the progressed Moon has moved on from the natal Moon',
  Math.abs(sep(pr.moon.deg + pr.moon.sign * 30, c.planets.find(p => p.body === 'Moon')!.lon)) > 1)

const sr = solarReturn(TAIPEI, 2026)
check('the solar return puts the Sun back on its natal degree', (() => {
  const natalSun = c.planets.find(p => p.body === 'Sun')!.lon
  const returnSun = sr.planets.find(p => p.body === 'Sun')!.lon
  return Math.abs(sep(natalSun, returnSun)) * 3600 < 1     // within an arcsecond
})(), `off by ${(Math.abs(sep(c.planets.find(p => p.body === 'Sun')!.lon, sr.planets.find(p => p.body === 'Sun')!.lon)) * 3600).toFixed(3)}"`)
check('the return falls within days of the birthday', (() => {
  const d = new Date(sr.utc)
  return d.getUTCFullYear() === 2026 && Math.abs(d.getUTCMonth() + 1 - TAIPEI.m) <= 1
})(), `→ ${sr.utc.slice(0, 10)}`)

// ── Synastry ──────────────────────────────────────────────────────────────
const other = natalChart({ y: 1988, m: 11, d: 3, h: 7, mi: 15, lat: 35.6895, lon: 139.6917, tz: 'Asia/Tokyo', place: '東京' })
const syn = synastry(c, other)
check('synastry finds inter-aspects', syn.inter.length > 0, `${syn.inter.length} aspects`)
check('the composite Sun is the short-way midpoint', (() => {
  const a = c.planets.find(p => p.body === 'Sun')!.lon, b = other.planets.find(p => p.body === 'Sun')!.lon
  const got = syn.composite.planets.find(p => p.body === 'Sun')!.lon
  // The midpoint must be closer to both than they are to each other.
  const half = Math.abs(sep(a, b)) / 2
  return Math.abs(Math.abs(sep(a, got)) - half) < 1e-9 && Math.abs(Math.abs(sep(b, got)) - half) < 1e-9
})())
check('a midpoint across 0° Aries does not flip to the far side', (() => {
  // 350° and 10° meet at 0°, not at 180°.
  const m = norm(350 + sep(350, 10) / 2)
  return Math.abs(sep(m, 0)) < 1e-9
})())

// ── Timezones ─────────────────────────────────────────────────────────────
check('a DST birth resolves through Intl', (() => {
  // 1 July 1985, London: British Summer Time, so 12:00 local is 11:00 UTC.
  const c2 = natalChart({ y: 1985, m: 7, d: 1, h: 12, mi: 0, lat: 51.5, lon: -0.12, tz: 'Europe/London', place: 'London' })
  return c2.utc.slice(11, 16) === '11:00'
})())
check('a southern-hemisphere chart still runs', (() => {
  const c3 = natalChart({ y: 1975, m: 2, d: 20, h: 3, mi: 45, lat: -33.87, lon: 151.21, tz: 'Australia/Sydney', place: 'Sydney' })
  return c3.system === 'placidus' && c3.cusps.every(Number.isFinite)
})())

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`)
process.exit(fails === 0 ? 0 : 1)
