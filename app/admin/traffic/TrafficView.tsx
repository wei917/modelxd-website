'use client'

// The traffic dashboard's view. Everything here is presentation; the rows
// come from the database functions through page.tsx and data.ts.
//
// Layout (owner, Sep 30): the filters at the top, then the part they narrow
// (the range's numbers with today's under them, browsers, sources, stay for
// the two groups), then the fixed charts that are always for every country
// (browsers by country, sign-ins by method), then the tables every chart is
// drawn from.
//
// Built phone-first (owner, Sep 28). Charts are plain HTML and SVG: columns
// capped at 24px with a 2px gap between stacked parts, one y-axis each, a
// legend whenever there are two series, hover/focus tooltips on the whole
// day slot, and the tables as the no-hover way to every number.

import { useState } from 'react'
import Link from 'next/link'
import type { CountryDay, DayRow, SigninDay, SigninTotal, StayLine, Summary, TapTotals } from './data'

type Series<R> = { key: keyof R & string; label: string; color: string }
type TipLine = { label: string; value: string; color?: string }

// Categorical slots 1-3 of the chart palette, in fixed order (validated on
// the site's light surface; the aqua is under 3:1, which the legend, the
// tooltip and the tables cover). "Other" is a neutral, never a fourth hue.
const BLUE = '#2a78d6', ORANGE = '#eb6834', AQUA = '#1baf7a', NEUTRAL = '#898781'
// Median, top 20% and top 10% are one measure at three points, in order, so
// they share the blue hue and step darker as they go up: steps 400, 550 and
// 700 of the blue ramp, even in lightness and validated as an ordinal ramp on
// the site's surface (the light end is 3.57:1). They never cross: the darker
// line is always the higher one. The average is a different kind of number
// and keeps its own hue.
const BLUE_400 = '#3987e5', BLUE_550 = '#1c5cab', BLUE_700 = '#0d366b'
const INK = 'var(--white)', INK2 = 'var(--muted2)', INK3 = 'var(--muted)'
const GRID = 'rgba(0,0,0,0.07)'
const PLOT_H = 168

const num = (n: number) => n.toLocaleString('en-US')
const dayLabel = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`
function stay(s: number): string {
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60), r = s % 60
  return m < 60 ? (r ? `${m}m ${r}s` : `${m}m`) : `${Math.floor(m / 60)}h ${m % 60}m`
}

/** A stay time, or a dash when nobody was there to measure: 0s would be a wrong number. */
const stayOf = (n: number, s: number) => (n > 0 ? stay(s) : '—')

/** A round axis top and 3-4 even ticks under it. */
function axis(max: number): number[] {
  if (max <= 0) return [0, 1]
  const raw = max / 4
  const pow = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map(m => m * pow).find(s => s >= raw) ?? raw
  const ticks: number[] = []
  for (let t = 0; t < max + step - 1e-9; t += step) ticks.push(Math.round(t * 100) / 100)
  return ticks
}

/** The same for a time axis: ticks land on round times, not round numbers of seconds. */
function timeAxis(max: number): number[] {
  const step = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200].find(s => max / s <= 4) ?? 14400
  const ticks: number[] = []
  for (let t = 0; t < max + step; t += step) ticks.push(t)
  return ticks
}

/** Which x labels fit: first, last and an even spread between. */
function labelEvery(n: number): number {
  return n <= 8 ? 1 : n <= 16 ? 2 : n <= 32 ? 5 : n <= 64 ? 10 : 15
}

function Legend({ series }: { series: Array<{ label: string; color: string }> }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: 12, color: INK2 }}>
      {series.map(s => (
        <span key={s.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span aria-hidden style={{ width: 10, height: 10, borderRadius: 2, background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  )
}

function Tip({ title, lines, x, n }: { title: string; lines: TipLine[]; x: number; n: number }) {
  // Pinned to the hovered day, flipped to the other side past the middle so
  // it never leaves the plot on a phone.
  const pct = ((x + 0.5) / n) * 100
  const left = pct < 50
  return (
    <div role="status" style={{
      position: 'absolute', top: 0, [left ? 'left' : 'right']: `${left ? pct : 100 - pct}%`,
      transform: `translateX(${left ? 8 : -8}px)`, zIndex: 2, pointerEvents: 'none',
      background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 8, padding: '8px 10px',
      boxShadow: '0 4px 14px rgba(0,0,0,0.08)', fontSize: 12, lineHeight: 1.5, whiteSpace: 'nowrap',
    } as React.CSSProperties}>
      <div style={{ color: INK2, marginBottom: 2 }}>{title}</div>
      {lines.map(l => (
        <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {l.color && <span aria-hidden style={{ width: 10, height: 2, background: l.color, borderRadius: 1 }} />}
          <strong style={{ color: INK, fontWeight: 600 }}>{l.value}</strong>
          <span style={{ color: INK2 }}>{l.label}</span>
        </div>
      ))}
    </div>
  )
}

/** The shared frame: y ticks, gridlines, one hover/focus slot per day, x labels. */
function Plot<R extends { day: string }>({ rows, max, format, ticksFor = axis, tip, children }: {
  rows: R[]
  max: number
  format: (n: number) => string
  ticksFor?: (max: number) => number[]
  tip: (r: R) => TipLine[]
  children: (top: number, hover: number | null) => React.ReactNode
}) {
  const [hover, setHover] = useState<number | null>(null)
  const ticks = ticksFor(max)
  const top = ticks[ticks.length - 1]
  const every = labelEvery(rows.length)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 8 }}>
      <div style={{ position: 'relative', height: PLOT_H, fontSize: 11, color: INK3, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        {/* In flow but invisible: the column is as wide as its longest label. */}
        {ticks.map(t => <span key={`w${t}`} aria-hidden style={{ display: 'block', height: 0, visibility: 'hidden' }}>{format(t)}</span>)}
        {ticks.map(t => (
          <span key={t} style={{ position: 'absolute', right: 0, bottom: `${(t / top) * 100}%`, transform: 'translateY(50%)' }}>{format(t)}</span>
        ))}
      </div>
      <div style={{ position: 'relative', height: PLOT_H }} onPointerLeave={() => setHover(null)}>
        {ticks.map(t => (
          <div key={t} aria-hidden style={{ position: 'absolute', left: 0, right: 0, bottom: `${(t / top) * 100}%`, height: 1, background: t === 0 ? 'var(--border2)' : GRID }} />
        ))}
        {children(top, hover)}
        <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
          {rows.map((r, i) => (
            <div key={r.day} tabIndex={0} aria-label={`${r.day}: ${tip(r).map(l => `${l.value} ${l.label}`).join(', ')}`}
              onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
              style={{ flex: 1, outline: 'none', background: hover === i ? 'rgba(0,0,0,0.035)' : 'transparent' }} />
          ))}
        </div>
        {hover !== null && rows[hover] && <Tip title={rows[hover].day} lines={tip(rows[hover])} x={hover} n={rows.length} />}
      </div>
      <div />
      <div style={{ display: 'flex', marginTop: 6 }}>
        {rows.map((r, i) => (
          <span key={r.day} style={{ flex: 1, textAlign: 'center', fontSize: 11, color: INK3, whiteSpace: 'nowrap', overflow: 'visible', fontVariantNumeric: 'tabular-nums' }}>
            {(i % every === 0 && rows.length - 1 - i >= every) || i === rows.length - 1 ? dayLabel(r.day) : ''}
          </span>
        ))}
      </div>
    </div>
  )
}

function Columns<R extends { day: string }>({ rows, series }: { rows: R[]; series: Series<R>[] }) {
  const val = (r: R, s: Series<R>) => r[s.key] as number
  const total = (r: R) => series.reduce((sum, s) => sum + val(r, s), 0)
  const max = Math.max(1, ...rows.map(total))
  return (
    <Plot rows={rows} max={max} format={num}
      tip={r => [...series.map(s => ({ label: s.label, value: num(val(r, s)), color: s.color })), ...(series.length > 1 ? [{ label: 'total', value: num(total(r)) }] : [])]}>
      {(top, hover) => (
        <div aria-hidden style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end' }}>
          {rows.map((r, i) => {
            const parts = series.filter(s => val(r, s) > 0)
            return (
              <div key={r.day} style={{ flex: 1, height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'flex-end', padding: '0 1px' }}>
                <div style={{ width: '100%', maxWidth: 24, height: `${(total(r) / top) * 100}%`, display: 'flex', flexDirection: 'column-reverse', gap: 2, opacity: hover === null || hover === i ? 1 : 0.55 }}>
                  {parts.map((s, k) => (
                    <div key={s.label} style={{ flex: `${val(r, s)} 0 0`, minHeight: 2, background: s.color, borderRadius: k === parts.length - 1 ? '4px 4px 0 0' : 0 }} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Plot>
  )
}

function Lines<R extends { day: string }>({ rows, series, format, extra, has = () => true }: {
  rows: R[]
  series: Series<R>[]
  format: (n: number) => string
  /** More tooltip lines, above the series (how many browsers the day's numbers rest on). */
  extra?: (r: R) => TipLine[]
  /** False for a day nobody was there to measure. A stay of "0s" would be a
   *  wrong number for it, so the line breaks there instead of diving to zero,
   *  and the tooltip gives no times. */
  has?: (r: R) => boolean
}) {
  const val = (r: R, s: Series<R>) => r[s.key] as number
  const max = Math.max(1, ...rows.filter(has).flatMap(r => series.map(s => val(r, s))))
  const n = rows.length
  const x = (i: number) => ((i + 0.5) / n) * 100
  // Unbroken runs of days that have numbers: one polyline each. A run of one
  // day is a dot, drawn below with the end dots.
  const runs: number[][] = []
  rows.forEach((r, i) => {
    if (!has(r)) return
    const last = runs[runs.length - 1]
    if (last && last[last.length - 1] === i - 1) last.push(i)
    else runs.push([i])
  })
  const lastDay = runs.length ? runs[runs.length - 1][runs[runs.length - 1].length - 1] : null
  const lone = runs.filter(run => run.length === 1).map(run => run[0])
  return (
    <Plot rows={rows} max={max} format={format} ticksFor={timeAxis}
      tip={r => [...(extra ? extra(r) : []), ...(has(r) ? series.map(s => ({ label: s.label, value: format(val(r, s)), color: s.color })) : [])]}>
      {(top, hover) => (
        <>
          <svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
            {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={0} y2={100} stroke="var(--border2)" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
            {series.map(s => runs.filter(run => run.length > 1).map(run => (
              <polyline key={`${s.label}${run[0]}`} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"
                points={run.map(i => `${x(i)},${100 - (val(rows[i], s) / top) * 100}`).join(' ')} />
            )))}
          </svg>
          {/* Dots on the last day with numbers, on a day that stands alone, and on
              the hovered day: round at any width, 8px with a 2px surface ring. */}
          {series.map(s => [lastDay, ...lone, hover].filter((i, k, a): i is number => i !== null && a.indexOf(i) === k && has(rows[i])).map(i => (
            <span key={`${s.label}${i}`} aria-hidden style={{
              position: 'absolute', left: `${x(i)}%`, bottom: `${(val(rows[i], s) / top) * 100}%`,
              width: 8, height: 8, borderRadius: '50%', background: s.color, boxShadow: '0 0 0 2px var(--bg)', transform: 'translate(-50%, 50%)',
            }} />
          )))}
        </>
      )}
    </Plot>
  )
}

function Card({ title, note, legend, children }: { title: string; note?: string; legend?: Array<{ label: string; color: string }>; children: React.ReactNode }) {
  return (
    <section style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 16, minWidth: 0 }}>
      <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: INK }}>{title}</h3>
      {note && <p style={{ margin: '2px 0 0', fontSize: 12, color: INK2, lineHeight: 1.5 }}>{note}</p>}
      {legend && <div style={{ marginTop: 8 }}><Legend series={legend} /></div>}
      <div style={{ marginTop: 14 }}>{children}</div>
    </section>
  )
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string[] }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px', minWidth: 0 }}>
      <div style={{ fontSize: 12, color: INK2 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 600, color: INK, lineHeight: 1.2, marginTop: 2 }}>{value}</div>
      {sub.map((line, i) => <div key={i} style={{ fontSize: 12, color: INK3, marginTop: 2 }}>{line}</div>)}
    </div>
  )
}

/** One group's stay over the whole range: how many browsers, and its four times. */
function Group({ title, line }: { title: string; line: StayLine }) {
  const cells: Array<[string, number]> = [['Median', line.median], ['Top 20%', line.p80], ['Top 10%', line.p90], ['Average', line.avg]]
  return (
    <section style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px', minWidth: 0 }}>
      <div style={{ fontSize: 12, color: INK2 }}>{title} · {num(line.browsers)} {line.browsers === 1 ? 'browser' : 'browsers'}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8, marginTop: 6 }}>
        {cells.map(([label, secs]) => (
          <div key={label} style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: INK, lineHeight: 1.3, whiteSpace: 'nowrap' }}>{stayOf(line.browsers, secs)}</div>
            <div style={{ fontSize: 12, color: INK3, marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

function Chip({ href, on, children }: { href: string; on: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} aria-current={on ? 'true' : undefined} style={{
      padding: '6px 12px', borderRadius: 999, fontSize: 13, textDecoration: 'none', whiteSpace: 'nowrap',
      border: `1px solid ${on ? INK : 'var(--border2)'}`, background: on ? INK : 'transparent', color: on ? 'var(--bg)' : INK,
    }}>{children}</Link>
  )
}

/** A heading that opens one part of the page, with what it covers under it. */
function Part({ title, note }: { title: string; note: string }) {
  return (
    <div style={{ margin: '28px 0 10px' }}>
      <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: INK }}>{title}</h2>
      <p style={{ margin: '2px 0 0', fontSize: 12, color: INK2, lineHeight: 1.5 }}>{note}</p>
    </div>
  )
}

const BROWSERS: Series<DayRow>[] = [
  { key: 'newBrowsers', label: 'New', color: BLUE },
  { key: 'returningBrowsers', label: 'Returning', color: ORANGE },
]
const SOURCES: Series<DayRow>[] = [
  { key: 'chatgpt', label: 'ChatGPT ads', color: BLUE },
  { key: 'google', label: 'Google Ads', color: ORANGE },
  { key: 'other', label: 'Other', color: AQUA },
]
const STAY: Series<DayRow>[] = [
  { key: 'medianSeconds', label: 'Median', color: BLUE_400 },
  { key: 'avgSeconds', label: 'Average', color: ORANGE },
]
const STAY_TOP: Series<DayRow>[] = [
  { key: 'medianSeconds', label: 'Median', color: BLUE_400 },
  { key: 'p80Seconds', label: 'Top 20%', color: BLUE_550 },
  { key: 'p90Seconds', label: 'Top 10%', color: BLUE_700 },
  { key: 'avgSeconds', label: 'Average', color: ORANGE },
]
const STAY_SIGNED: Series<DayRow>[] = [
  { key: 'signedMedian', label: 'Median', color: BLUE_400 },
  { key: 'signedP80', label: 'Top 20%', color: BLUE_550 },
  { key: 'signedP90', label: 'Top 10%', color: BLUE_700 },
  { key: 'signedAvg', label: 'Average', color: ORANGE },
]
const STAY_GUEST: Series<DayRow>[] = [
  { key: 'guestMedian', label: 'Median', color: BLUE_400 },
  { key: 'guestP80', label: 'Top 20%', color: BLUE_550 },
  { key: 'guestP90', label: 'Top 10%', color: BLUE_700 },
  { key: 'guestAvg', label: 'Average', color: ORANGE },
]
const METHODS: Array<Series<SigninDay> & { key: SigninTotal['key'] }> = [
  { key: 'google', label: 'Google', color: BLUE },
  { key: 'lineTw', label: 'LINE (Taiwan)', color: ORANGE },
  { key: 'lineJp', label: 'LINE (Japan)', color: AQUA },
  { key: 'other', label: 'Other', color: NEUTRAL },
]
const COUNTRY_KEYS = ['c0', 'c1', 'c2'] as const
const COUNTRY_COLORS = [BLUE, ORANGE, AQUA]

/** The tiles at the top of the filtered part: the same number for the whole
 *  range and for one day. */
const TILES: Array<{ label: string; top?: boolean; whole: (s: Summary) => string; day: (r: DayRow) => string }> = [
  { label: 'Active browsers', whole: s => num(s.browsers), day: r => num(r.browsers) },
  { label: 'Returning browsers', whole: s => num(s.returningBrowsers), day: r => num(r.returningBrowsers) },
  { label: 'Signed-in users', whole: s => num(s.signedInUsers), day: r => num(r.signedInUsers) },
  { label: 'Median stay', whole: s => stayOf(s.browsers, s.everyone.median), day: r => stayOf(r.browsers, r.medianSeconds) },
  { label: 'Top 20% stay', top: true, whole: s => stayOf(s.browsers, s.everyone.p80), day: r => stayOf(r.browsers, r.p80Seconds) },
  { label: 'Top 10% stay', top: true, whole: s => stayOf(s.browsers, s.everyone.p90), day: r => stayOf(r.browsers, r.p90Seconds) },
  { label: 'Average stay', whole: s => stayOf(s.browsers, s.everyone.avg), day: r => stayOf(r.browsers, r.avgSeconds) },
]

/** Shown where the numbers go until the owner has run a migration. */
const NEEDS_116 = 'Top 20% and top 10% stay appear once supabase/116_site_visit_stay_top.sql has been run.'
const NEEDS_118 = 'These tiles are today only. Totals for the whole range appear once supabase/118_site_visit_summary.sql has been run.'
const NEEDS_120 = 'Taps on the Google and LINE buttons appear once supabase/120_signin_taps.sql has been run.'
const NEEDS_117 = 'The country filter, stay for signed-in and not signed-in browsers, and the fixed charts appear once supabase/117_site_visit_groups_country.sql has been run.'

export default function TrafficView({ rows, whole, taps, days, ranges, tz, topStay, upgraded, country, picker, names, countryDays, countryCodes, signinDays, signinTotals }: {
  rows: DayRow[]
  /** Presses of Google and LINE in the range (migration 120), or null until it has been run. */
  taps: TapTotals | null
  /** The range as a whole (migration 118), or null until it has been run:
   *  the tiles then show today, and say so. */
  whole: Summary | null
  days: number
  ranges: readonly number[]
  tz: string
  /** Migration 116 has been run: the top 20% / top 10% numbers exist. */
  topStay: boolean
  /** Migration 117 has been run: country filter, the two groups, the fixed charts. */
  upgraded: boolean
  /** The country the filtered part is narrowed to, or null for every country. */
  country: string | null
  /** Countries offered by the filter, busiest first. */
  picker: string[]
  /** English names for every country code on the page, made on the server. */
  names: Record<string, string>
  countryDays: CountryDay[]
  /** The countries behind c0, c1, c2 in countryDays. */
  countryCodes: string[]
  signinDays: SigninDay[]
  signinTotals: SigninTotal[]
}) {
  const today = rows[rows.length - 1]
  const prev = rows.length > 1 ? rows[rows.length - 2] : null
  const staySeries = topStay ? STAY_TOP : STAY
  const th: React.CSSProperties = { textAlign: 'right', padding: '6px 10px', fontWeight: 500, color: INK2, whiteSpace: 'nowrap', borderBottom: '1px solid var(--border2)' }
  const td: React.CSSProperties = { textAlign: 'right', padding: '6px 10px', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)', fontVariantNumeric: 'tabular-nums' }
  const first: React.CSSProperties = { textAlign: 'left', position: 'sticky', left: 0, background: 'var(--bg)' }
  const wrap: React.CSSProperties = { overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 12 }
  const table: React.CSSProperties = { borderCollapse: 'collapse', fontSize: 13, width: '100%' }
  const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 440px), 1fr))', gap: 12 }
  const summary: React.CSSProperties = { cursor: 'pointer', fontSize: 15, fontWeight: 600, padding: '10px 0' }
  const rowLabel: React.CSSProperties = { fontSize: 12, color: INK2, width: 56, flex: 'none' }

  const href = (d: number, c: string | null) => `/admin/traffic?days=${d}${c ? `&country=${c}` : ''}`
  const nameOf = (c: string) => names[c] ?? c
  const where = country ? nameOf(country) : 'All countries'
  const offered = country && !picker.includes(country) ? [...picker, country] : picker

  const countrySeries: Series<CountryDay>[] = [
    ...countryCodes.slice(0, 3).map((c, i) => ({ key: COUNTRY_KEYS[i], label: nameOf(c), color: COUNTRY_COLORS[i] })),
    ...(countryDays.some(d => d.other > 0) ? [{ key: 'other' as const, label: 'Other', color: NEUTRAL }] : []),
  ]
  const methodSeries = METHODS.filter(m => m.key !== 'other' || signinDays.some(d => d.other > 0))
  const totalOf = (k: SigninTotal['key']) => signinTotals.find(t => t.key === k)
  const methodSummary = methodSeries.map(m => {
    const t = totalOf(m.key)
    return `${m.label} ${num(t?.people ?? 0)}${t && t.newPeople ? ` (${num(t.newPeople)} new)` : ''}`
  }).join(' · ')

  return (
    <main style={{ maxWidth: 1040, margin: '0 auto', padding: '20px 16px 56px', color: INK, fontFamily: 'var(--font-body)' }}>
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Traffic</h1>
      <p style={{ margin: '4px 0 0', fontSize: 13, color: INK2, lineHeight: 1.5 }}>
        Production visits from our own visit log, by day in {tz}. &ldquo;Browsers&rdquo; are visitor cookies, not people:
        one person on a phone and a laptop counts twice.
      </p>

      <section aria-label="Filters" style={{ marginTop: 14, border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px', display: 'grid', gap: 10 }}>
        <nav aria-label="Date range" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={rowLabel}>Range</span>
          {ranges.map(d => <Chip key={d} href={href(d, country)} on={d === days}>{d} days</Chip>)}
        </nav>
        {upgraded && (
          <nav aria-label="Country" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={rowLabel}>Country</span>
            <Chip href={href(days, null)} on={!country}>All</Chip>
            {offered.map(c => <Chip key={c} href={href(days, c)} on={c === country}>{nameOf(c)}</Chip>)}
          </nav>
        )}
        <p style={{ margin: 0, fontSize: 12, color: INK2, lineHeight: 1.5 }}>
          {upgraded
            ? 'The range applies to the whole page. The country applies to the filtered part only; the fixed charts are always every country.'
            : NEEDS_117}
        </p>
      </section>

      <Part title={`Filtered: ${days} days · ${where}`} note="Follows the range and the country above." />
      {!today ? (
        <p style={{ fontSize: 14, color: INK2 }}>No visits logged for this range{country ? ` from ${where}` : ''} yet.</p>
      ) : (
        <>
          <h3 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 500, color: INK2 }}>
            {whole ? `All ${days} days together, through today (${today.day})` : `Today only, so far (${today.day})`}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
            {TILES.filter(t => topStay || !t.top).map(t => whole
              ? <Tile key={t.label} label={t.label} value={t.whole(whole)} sub={[`Today ${t.day(today)}`, ...(prev ? [`Yesterday ${t.day(prev)}`] : [])]} />
              : <Tile key={t.label} label={`${t.label} today`} value={t.day(today)} sub={prev ? [`Yesterday ${t.day(prev)}`] : []} />)}
          </div>
          {whole && (
            <>
              <div style={{ ...grid, marginTop: 10 }}>
                <Group title="Signed in" line={whole.signed} />
                <Group title="Not signed in" line={whole.guest} />
              </div>
              <p style={{ margin: '8px 0 0', fontSize: 12, color: INK2, lineHeight: 1.5 }}>
                A browser or an account that came on several days counts once. Returning = came on more than one day.
                Stay is per browser per day. Signed in = had an account on any visit in the range.
              </p>
            </>
          )}
          {!whole && upgraded && <p style={{ margin: '8px 0 0', fontSize: 12, color: INK2 }}>{NEEDS_118}</p>}
          {!topStay && <p style={{ margin: '8px 0 0', fontSize: 12, color: INK2 }}>{NEEDS_116}</p>}

          <div style={{ ...grid, marginTop: 16 }}>
            <Card title="Active browsers per day" note="Returning = first seen on an earlier day." legend={BROWSERS}>
              <Columns rows={rows} series={BROWSERS} />
            </Card>
            <Card title="Visits by source" note="ChatGPT ads carry utm_source=chatgpt; Google Ads carry a click id." legend={SOURCES}>
              <Columns rows={rows} series={SOURCES} />
            </Card>
            {upgraded ? (
              <>
                <Card title="Stay, signed in"
                  note="Browsers with an account on a visit that day. Time with the tab in front, added up per browser per day. Top 20% and top 10% are the stay the most engaged fifth and tenth reached or passed."
                  legend={STAY_SIGNED}>
                  <Lines rows={rows} series={STAY_SIGNED} format={stay} has={r => r.signedBrowsers > 0} extra={r => [{ label: 'browsers signed in', value: num(r.signedBrowsers) }]} />
                </Card>
                <Card title="Stay, not signed in"
                  note="Everyone else, the same four numbers. Its own scale: usually seconds here and minutes on the signed-in chart."
                  legend={STAY_GUEST}>
                  <Lines rows={rows} series={STAY_GUEST} format={stay} has={r => r.guestBrowsers > 0} extra={r => [{ label: 'browsers not signed in', value: num(r.guestBrowsers) }]} />
                </Card>
              </>
            ) : (
              <Card title="Stay per browser"
                note={topStay
                  ? 'Time with the tab in front, added up per browser per day. Top 20% and top 10% are the stay that the most engaged fifth and tenth of browsers reached or passed. A few very long stays can lift the average above both.'
                  : 'Time with the tab in front, added up per browser per day. A few long stays pull the average above the median.'}
                legend={staySeries}>
                <Lines rows={rows} series={staySeries} format={stay} has={r => r.browsers > 0} />
              </Card>
            )}
            {taps && (
              <Card title="Taps on sign-in"
                note={country
                  ? `Presses of Google and LINE from ${where}, counted before the visitor leaves for Google or LINE. Completed sign-ins are not known by country: the sign-ins chart below is every country.`
                  : 'Presses of Google and LINE, counted before the visitor leaves for Google or LINE, so someone who gives up there still shows. Signed in = accounts that finished (any host, dev included).'}>
                <div style={wrap}>
                  <table style={table}>
                    <thead>
                      <tr>
                        <th style={{ ...th, ...first }}>Method</th><th style={th}>Taps</th><th style={th}>Browsers</th>
                        {!country && <th style={th}>Signed in</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {METHODS.filter(m => m.key !== 'other' || taps.other.taps > 0).map(m => (
                        <tr key={m.key}>
                          <td style={{ ...td, ...first }}>{m.label}</td>
                          <td style={td}>{num(taps[m.key].taps)}</td><td style={td}>{num(taps[m.key].browsers)}</td>
                          {!country && <td style={td}>{num(totalOf(m.key)?.people ?? 0)}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </div>
          {upgraded && !taps && <p style={{ margin: '8px 0 0', fontSize: 12, color: INK2 }}>{NEEDS_120}</p>}
        </>
      )}

      {upgraded && (
        <>
          <Part title={`Fixed charts: ${days} days · every country`} note="Not narrowed by the country filter. Only the range applies." />
          <div style={grid}>
            <Card title="Browsers by country" note="Where Vercel placed each visit. The three biggest countries are named; the rest are Other." legend={countrySeries.length > 1 ? countrySeries : undefined}>
              {countryDays.length ? <Columns rows={countryDays} series={countrySeries} /> : <p style={{ margin: 0, fontSize: 13, color: INK2 }}>No visits in this range yet.</p>}
            </Card>
            <Card title="Sign-ins by method"
              note={`Accounts that signed in each day, by the method the account was made with. In this range: ${methodSummary}. Sign-ins on dev and localhost count too: the login log does not record the host.`}
              legend={methodSeries}>
              {signinDays.length ? <Columns rows={signinDays} series={methodSeries} /> : <p style={{ margin: 0, fontSize: 13, color: INK2 }}>No sign-ins in this range yet.</p>}
            </Card>
          </div>
        </>
      )}

      <Part title="Tables" note="Every number the charts are drawn from." />
      {today && (
        <>
          <h3 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 600 }}>Every day · {where}</h3>
          <div style={wrap}>
            <table style={table}>
              <thead>
                <tr>
                  <th style={{ ...th, ...first }}>Day</th>
                  <th style={th}>Browsers</th><th style={th}>New</th><th style={th}>Returning</th><th style={th}>Signed-in users</th>
                  <th style={th}>Visits</th><th style={th}>Median stay</th>
                  {topStay && <><th style={th}>Top 20% stay</th><th style={th}>Top 10% stay</th></>}
                  <th style={th}>Average stay</th><th style={th}>Total time</th>
                  <th style={th}>ChatGPT ads</th><th style={th}>Google Ads</th><th style={th}>Other</th>
                </tr>
              </thead>
              <tbody>
                {[...rows].reverse().map(r => (
                  <tr key={r.day}>
                    <td style={{ ...td, ...first }}>{r.day}</td>
                    <td style={td}>{num(r.browsers)}</td><td style={td}>{num(r.newBrowsers)}</td><td style={td}>{num(r.returningBrowsers)}</td><td style={td}>{num(r.signedInUsers)}</td>
                    <td style={td}>{num(r.visits)}</td><td style={td}>{stayOf(r.browsers, r.medianSeconds)}</td>
                    {topStay && <><td style={td}>{stayOf(r.browsers, r.p80Seconds)}</td><td style={td}>{stayOf(r.browsers, r.p90Seconds)}</td></>}
                    <td style={td}>{stayOf(r.browsers, r.avgSeconds)}</td><td style={td}>{(r.totalSeconds / 3600).toFixed(1)} h</td>
                    <td style={td}>{num(r.chatgpt)}</td><td style={td}>{num(r.google)}</td><td style={td}>{num(r.other)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {upgraded && today && (
        <details style={{ marginTop: 10 }}>
          <summary style={summary}>Stay by group · {where}</summary>
          <div style={wrap}>
            <table style={table}>
              <thead>
                <tr>
                  <th style={{ ...th, ...first, borderBottom: 'none' }} />
                  <th style={{ ...th, textAlign: 'center', borderBottom: 'none' }} colSpan={5}>Signed in</th>
                  <th style={{ ...th, textAlign: 'center', borderBottom: 'none' }} colSpan={5}>Not signed in</th>
                </tr>
                <tr>
                  <th style={{ ...th, ...first }}>Day</th>
                  <th style={th}>Browsers</th><th style={th}>Median</th><th style={th}>Top 20%</th><th style={th}>Top 10%</th><th style={th}>Average</th>
                  <th style={th}>Browsers</th><th style={th}>Median</th><th style={th}>Top 20%</th><th style={th}>Top 10%</th><th style={th}>Average</th>
                </tr>
              </thead>
              <tbody>
                {[...rows].reverse().map(r => (
                  <tr key={r.day}>
                    <td style={{ ...td, ...first }}>{r.day}</td>
                    <td style={td}>{num(r.signedBrowsers)}</td><td style={td}>{stayOf(r.signedBrowsers, r.signedMedian)}</td><td style={td}>{stayOf(r.signedBrowsers, r.signedP80)}</td><td style={td}>{stayOf(r.signedBrowsers, r.signedP90)}</td><td style={td}>{stayOf(r.signedBrowsers, r.signedAvg)}</td>
                    <td style={td}>{num(r.guestBrowsers)}</td><td style={td}>{stayOf(r.guestBrowsers, r.guestMedian)}</td><td style={td}>{stayOf(r.guestBrowsers, r.guestP80)}</td><td style={td}>{stayOf(r.guestBrowsers, r.guestP90)}</td><td style={td}>{stayOf(r.guestBrowsers, r.guestAvg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {upgraded && countryDays.length > 0 && (
        <details style={{ marginTop: 4 }}>
          <summary style={summary}>Browsers by country · every country</summary>
          <div style={wrap}>
            <table style={table}>
              <thead>
                <tr>
                  <th style={{ ...th, ...first }}>Day</th>
                  {countrySeries.map(s => <th key={s.key} style={th}>{s.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {[...countryDays].reverse().map(r => (
                  <tr key={r.day}>
                    <td style={{ ...td, ...first }}>{r.day}</td>
                    {countrySeries.map(s => <td key={s.key} style={td}>{num(r[s.key] as number)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {upgraded && signinDays.length > 0 && (
        <details style={{ marginTop: 4 }}>
          <summary style={summary}>Sign-ins by method · every country</summary>
          <div style={wrap}>
            <table style={table}>
              <thead>
                <tr>
                  <th style={{ ...th, ...first }}>Day</th>
                  {methodSeries.map(s => <th key={s.key} style={th}>{s.label}</th>)}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ ...td, ...first, fontWeight: 600 }}>Whole range</td>
                  {methodSeries.map(s => <td key={s.key} style={{ ...td, fontWeight: 600 }}>{num(totalOf(s.key)?.people ?? 0)}</td>)}
                </tr>
                <tr>
                  <td style={{ ...td, ...first }}>New accounts</td>
                  {methodSeries.map(s => <td key={s.key} style={td}>{num(totalOf(s.key)?.newPeople ?? 0)}</td>)}
                </tr>
                <tr>
                  <td style={{ ...td, ...first }}>Sign-ins</td>
                  {methodSeries.map(s => <td key={s.key} style={td}>{num(totalOf(s.key)?.logins ?? 0)}</td>)}
                </tr>
                {[...signinDays].reverse().map(r => (
                  <tr key={r.day}>
                    <td style={{ ...td, ...first }}>{r.day}</td>
                    {methodSeries.map(s => <td key={s.key} style={td}>{num(r[s.key])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </main>
  )
}
