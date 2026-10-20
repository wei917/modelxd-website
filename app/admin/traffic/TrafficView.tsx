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

import type { CheerModelRow } from '@/lib/xsports-cheer-stats'
import { Fragment, useState } from 'react'
import Link from 'next/link'
import { STRINGS } from '../../../lib/i18n'
import type { AccountRow, CountryDay, DayRow, FunnelRow, PageRow, ProductAvgDay, ProductDay, ProductTotal, ShareLine, SigninDay, SigninTotal, StayLine, Summary, TapTotals, VoteLine } from './data'

type Series<R> = { key: keyof R & string; label: string; color: string }
type TipLine = { label: string; value: string; color?: string }

// Categorical slots 1-4 of the chart palette, in fixed order (validated on
// the site's light surface; the aqua and the yellow are under 3:1, which the
// legend, the tooltip and the tables cover). "Other" is a neutral, never a
// fifth hue.
const BLUE = '#2a78d6', ORANGE = '#eb6834', AQUA = '#1baf7a', YELLOW = '#eda100', NEUTRAL = '#898781'
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
  // A series value may also be null on its own (an app nobody opened that
  // day, in "Avg per visit"): that series breaks there, the others go on.
  const val = (r: R, s: Series<R>) => r[s.key] as number | null
  const at = (i: number, s: Series<R>) => (has(rows[i]) ? val(rows[i], s) : null)
  const max = Math.max(1, ...rows.flatMap((r, i) => series.map(s => at(i, s))).filter((v): v is number => v != null))
  const n = rows.length
  const x = (i: number) => ((i + 0.5) / n) * 100
  // Unbroken runs of days that have a number, per series: one polyline each.
  // A run of one day is a dot, drawn below with the end dots.
  const runsOf = (s: Series<R>) => {
    const runs: number[][] = []
    rows.forEach((_, i) => {
      if (at(i, s) == null) return
      const last = runs[runs.length - 1]
      if (last && last[last.length - 1] === i - 1) last.push(i)
      else runs.push([i])
    })
    return runs
  }
  const lines = series.map(s => {
    const runs = runsOf(s)
    const lastDay = runs.length ? runs[runs.length - 1][runs[runs.length - 1].length - 1] : null
    return { s, runs, lastDay, lone: runs.filter(run => run.length === 1).map(run => run[0]) }
  })
  return (
    <Plot rows={rows} max={max} format={format} ticksFor={timeAxis}
      tip={r => {
        if (!has(r)) return extra ? extra(r) : []
        return [...(extra ? extra(r) : []), ...series.map(s => { const v = val(r, s); return { label: s.label, value: v == null ? '—' : format(v), color: s.color } })]
      }}>
      {(top, hover) => (
        <>
          <svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
            {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={0} y2={100} stroke="var(--border2)" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
            {lines.map(({ s, runs }) => runs.filter(run => run.length > 1).map(run => (
              <polyline key={`${s.label}${run[0]}`} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"
                points={run.map(i => `${x(i)},${100 - ((at(i, s) ?? 0) / top) * 100}`).join(' ')} />
            )))}
          </svg>
          {/* Dots on the last day with numbers, on a day that stands alone, and on
              the hovered day: round at any width, 8px with a 2px surface ring. */}
          {lines.map(({ s, lastDay, lone }) => [lastDay, ...lone, hover].filter((i, k, a): i is number => i !== null && a.indexOf(i) === k && at(i, s) != null).map(i => (
            <span key={`${s.label}${i}`} aria-hidden style={{
              position: 'absolute', left: `${x(i)}%`, bottom: `${((at(i, s) ?? 0) / top) * 100}%`,
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

export interface SportsDay { day: string; usd: number; remarks: number; capped_at: string | null }

/** 晴晴's photos and clips by model (owner, Oct 16: "so we know which models
 *  are better"): what each made for admins' asks, what failed, and fans'
 *  👍 / 👎 and reports on what was posted, over the range (every country). */
function CheerModels({ rows, days }: { rows: CheerModelRow[] | null; days: number }) {
  const th: React.CSSProperties = { textAlign: 'right', padding: '6px 8px', fontWeight: 600, color: INK2, whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { textAlign: 'right', padding: '6px 8px', color: INK, whiteSpace: 'nowrap' }
  return (
    <section aria-label="晴晴's models" style={{ marginTop: 14, border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px' }}>
      <div style={{ fontSize: 12, color: INK2 }}>晴晴's photos and clips by model, last {days} days (every country)</div>
      {rows === null ? (
        <div style={{ fontSize: 13, color: INK, marginTop: 4, lineHeight: 1.5 }}>Waiting for supabase/137_xsports_cheer_jobs.sql.</div>
      ) : rows.length === 0 ? (
        <div style={{ fontSize: 13, color: INK3, marginTop: 4 }}>Nothing made yet: an admin taps her name in a room and asks.</div>
      ) : (
        <div style={{ overflowX: 'auto', marginTop: 6 }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 13, minWidth: 560 }}>
            <thead><tr>
              <th style={{ ...th, textAlign: 'left' }}>Model</th><th style={th}>Made</th><th style={th}>Failed</th><th style={th}>Posted</th>
              <th style={th}>👍</th><th style={th}>👎</th><th style={th}>Reports</th><th style={th}>Median time</th><th style={th}>Avg cost</th>
            </tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={`${r.kind}:${r.model}`} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ ...td, textAlign: 'left' }}>{r.label} <span style={{ color: INK3 }}>{r.kind === 'video' ? 'clip' : 'photo'}</span></td>
                  <td style={td}>{r.made}</td><td style={{ ...td, color: r.failed ? 'var(--red)' : INK3 }}>{r.failed}</td><td style={td}>{r.posted}</td>
                  <td style={td}>{r.up}</td><td style={td}>{r.down}</td><td style={{ ...td, color: r.reports ? 'var(--red)' : INK3 }}>{r.reports}</td>
                  <td style={td}>{r.medianMs == null ? '-' : `${Math.round(r.medianMs / 1000)} s`}</td>
                  <td style={td}>{r.avgUsd == null ? '-' : `$${r.avgUsd.toFixed(3)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/** XSports' AI commentators: today's spend against the daily cap (owner,
 *  Oct 15: "so we can cap $50 a day for sports? when it hits cap, how do I
 *  know?"). Red once the cap is reached, with the time; the filters do not
 *  narrow it. */
function SportsSpend({ s }: { s: { cap: number; today: string; days: SportsDay[] | null } }) {
  const today = s.days?.find(d => d.day === s.today) ?? null
  const usd = today?.usd ?? 0
  const over = !!s.days && usd >= s.cap
  const at = today?.capped_at ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit' }).format(new Date(today.capped_at)) : null
  const week = (s.days ?? []).reduce((a, d) => a + d.usd, 0)
  return (
    <section aria-label="XSports AI commentators" style={{ marginTop: 14, border: `1px solid ${over ? 'var(--red)' : 'var(--border)'}`, background: over ? 'var(--red-dim)' : undefined, borderRadius: 12, padding: '12px 14px' }}>
      <div style={{ fontSize: 12, color: INK2 }}>XSports AI commentators, today (Taiwan time)</div>
      {s.days === null ? (
        <div style={{ fontSize: 13, color: INK, marginTop: 4, lineHeight: 1.5 }}>Waiting for supabase/135_xsports_ai_spend.sql. Until it runs, every room uses GPT-6 Luna and Qwen 3.8 Flash.</div>
      ) : (
        <>
          <div style={{ fontSize: 26, fontWeight: 600, color: over ? 'var(--red)' : INK, lineHeight: 1.2, marginTop: 2 }}>
            ${usd.toFixed(2)} <span style={{ fontSize: 14, fontWeight: 500, color: INK2 }}>of ${s.cap} a day</span>
          </div>
          <div style={{ fontSize: 12, color: INK3, marginTop: 2 }}>{today?.remarks ?? 0} remarks today; ${week.toFixed(2)} over the last 7 days</div>
          {over && (
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--red)', marginTop: 6, lineHeight: 1.5 }}>
              Cap reached{at ? ` at ${at}` : ''}. Every room uses GPT-6 Luna and Qwen 3.8 Flash until midnight.
            </div>
          )}
        </>
      )}
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

/** One group's stay over the whole range: how many browsers, and its times
 *  (the two top averages only once migration 128 has run). */
function Group({ title, line }: { title: string; line: StayLine }) {
  const top: Array<[string, number]> = line.top20 != null && line.top10 != null ? [['Top 20% avg', line.top20], ['Top 10% avg', line.top10]] : []
  const cells: Array<[string, number]> = [['Median', line.median], ...top, ['Average', line.avg]]
  return (
    <section style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px', minWidth: 0 }}>
      <div style={{ fontSize: 12, color: INK2 }}>{title} · {num(line.browsers)} {line.browsers === 1 ? 'browser' : 'browsers'}</div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))`, gap: 8, marginTop: 6 }}>
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
  { key: 'top20Seconds', label: 'Top 20% avg', color: BLUE_550 },
  { key: 'top10Seconds', label: 'Top 10% avg', color: BLUE_700 },
  { key: 'avgSeconds', label: 'Average', color: ORANGE },
]
const STAY_SIGNED: Series<DayRow>[] = [
  { key: 'signedMedian', label: 'Median', color: BLUE_400 },
  { key: 'signedTop20', label: 'Top 20% avg', color: BLUE_550 },
  { key: 'signedTop10', label: 'Top 10% avg', color: BLUE_700 },
  { key: 'signedAvg', label: 'Average', color: ORANGE },
]
const STAY_GUEST: Series<DayRow>[] = [
  { key: 'guestMedian', label: 'Median', color: BLUE_400 },
  { key: 'guestTop20', label: 'Top 20% avg', color: BLUE_550 },
  { key: 'guestTop10', label: 'Top 10% avg', color: BLUE_700 },
  { key: 'guestAvg', label: 'Average', color: ORANGE },
]
/** The two group charts' lines before migration 128: no top averages. */
const TOP_KEYS = new Set<keyof DayRow>(['top20Seconds', 'top10Seconds', 'signedTop20', 'signedTop10', 'guestTop20', 'guestTop10'])
const withoutTop = (series: Series<DayRow>[]) => series.filter(s => !TOP_KEYS.has(s.key))
const METHODS: Array<Series<SigninDay> & { key: SigninTotal['key'] }> = [
  { key: 'google', label: 'Google', color: BLUE },
  { key: 'lineTw', label: 'LINE (Taiwan)', color: ORANGE },
  { key: 'lineJp', label: 'LINE (Japan)', color: AQUA },
  { key: 'x', label: 'X', color: YELLOW },
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
  { label: 'Top 20% avg stay', top: true, whole: s => stayOf(s.browsers, s.everyone.top20 ?? 0), day: r => stayOf(r.browsers, r.top20Seconds) },
  { label: 'Top 10% avg stay', top: true, whole: s => stayOf(s.browsers, s.everyone.top10 ?? 0), day: r => stayOf(r.browsers, r.top10Seconds) },
  { label: 'Average stay', whole: s => stayOf(s.browsers, s.everyone.avg), day: r => stayOf(r.browsers, r.avgSeconds) },
]

/** Shown where the numbers go until the owner has run a migration. */
const NEEDS_128 = 'Top 20% and top 10% average stay appear once supabase/128_site_visit_top_avg.sql has been run.'
const NEEDS_118 = 'These tiles are today only. Totals for the whole range appear once supabase/118_site_visit_summary.sql has been run.'
const NEEDS_120 = 'Taps on the sign-in buttons appear once supabase/120_signin_taps.sql has been run.'
const NEEDS_122 = 'XTell answer votes and share presses appear once supabase/122_xtell_votes_shares.sql has been run.'
const NEEDS_123 = 'What ad visitors did, and accounts per country, appear once supabase/123_site_ads_accounts.sql has been run.'
const AD_SOURCE: Record<string, string> = { google: 'Google Ads', chatgpt: 'ChatGPT ads' }
/** "43 (70%)": a count and its share of the ad browsers. */
const ofAll = (n: number, all: number) => (all > 0 ? `${num(n)} (${Math.round((100 * n) / all)}%)` : num(n))
/** XTell share counter words (lib/xtell-feedback.ts). */
const SHARE_KIND: Record<string, string> = { answer: 'Answer', daily: "Today's fortune", almanac: 'Almanac', cookie: 'Fortune cookie', tarot: 'Tarot', qian: '籤 (stick)' }
const SHARE_HOW: Record<string, string> = { save: 'Save to Photos (iPhone)', download: 'Download', share: 'Share…', copy: 'Copy link' }
/** One line per app, each in a colour that stays with the app whatever the
 *  range or country (owner, Oct 15: "each line is one xapp"). Every other
 *  landing page is Other, the neutral. */
const PRODUCTS: Series<ProductDay>[] = [
  { key: 'xtell', label: 'X先知', color: BLUE },
  { key: 'xcreate', label: 'X創作', color: ORANGE },
  { key: 'xsports', label: 'X體育', color: AQUA },
  { key: 'www', label: 'www home', color: YELLOW },
  { key: 'other', label: 'Other pages', color: NEUTRAL },
]
/** The table's names for what site_visit_by_product() returns: an app, www's
 *  home, or the first part of another path. */
const PRODUCT_NAMES: Record<string, string> = {
  xtell: 'X先知', xcreate: 'X創作', xsports: 'X體育', www: 'www home', xpersona: 'XPersona',
  xduel: 'XDuel', xtalk: 'XTalk', xgame: 'XGame', xdirect: 'XDirect', xcut: 'XCut', xworld: 'XWorld', xarch: 'XArch',
  xdev: 'XDev', xboard: 'XBoard', xeval: 'XEval', xvote: 'XVote', profile: 'Account page', login: 'Sign-in page', unknown: 'Unknown',
}
const productName = (p: string) => PRODUCT_NAMES[p] ?? `/${p}`
/** A page view's key as the table shows it: an X先知 room by its Chinese
 *  name (the street is 'xtell'), an app's path by the app, anything else as
 *  the path it is. */
function pageName(key: string): string {
  if (key === 'xtell' || key === '/xtell') return 'X先知 street'
  const room = key.match(/^xtell\/([a-z]+)$/)?.[1]
  if (room) return `X先知 ${STRINGS[`xtell.site.focus.${room}.name`]?.['zh-Hant'] ?? room}`
  if (key === '/') return 'www home'
  const app = key.match(/^\/(x[a-z]+)(\/.*)?$/)
  if (app && PRODUCT_NAMES[app[1]]) return `${PRODUCT_NAMES[app[1]]}${app[2] ?? ''}`
  return key
}
const NEEDS_139 = 'Rooms and pages appear once supabase/139_site_page_views.sql has been run.'
const NEEDS_138 = 'Browsers per app appear once supabase/138_site_visit_by_product.sql has been run.'

const NEEDS_117 = 'The country filter, stay for signed-in and not signed-in browsers, and the fixed charts appear once supabase/117_site_visit_groups_country.sql has been run.'

export default function TrafficView({ rows, whole, taps, votes, shares, funnel, accounts, products, pages, days, ranges, tz, topStay, upgraded, country, picker, names, countryDays, countryCodes, signinDays, signinTotals, sports, cheerModels }: {
  rows: DayRow[]
  /** Presses of Google and LINE in the range (migration 120), or null until it has been run. */
  taps: TapTotals | null
  /** 👍 / 👎 on XTell answers and share presses in the range (migration 122),
   *  or null until it has been run. */
  votes: VoteLine[] | null
  shares: ShareLine[] | null
  /** What ad visitors did in the range, per source (migration 123), or null until it has been run. */
  funnel: FunnelRow[] | null
  /** Accounts per country, every country (123), or null until it has been run. */
  accounts: AccountRow[] | null
  /** Browsers per app in the range and country (138), or null until it has been run. */
  products: { days: ProductDay[]; avg: ProductAvgDay[]; totals: ProductTotal[] } | null
  /** Page views per page and X先知 room in the range and country (139), or null until it has been run. */
  pages: PageRow[] | null
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
  /** XSports' AI commentators: the last 7 Taipei days' spend (supabase/135),
   *  null until it has been run, and the daily cap. */
  sports: { cap: number; today: string; days: SportsDay[] | null }
  cheerModels: CheerModelRow[] | null
}) {
  const today = rows[rows.length - 1]
  const prev = rows.length > 1 ? rows[rows.length - 2] : null
  const staySeries = topStay ? STAY_TOP : STAY
  const signedSeries = topStay ? STAY_SIGNED : withoutTop(STAY_SIGNED)
  const guestSeries = topStay ? STAY_GUEST : withoutTop(STAY_GUEST)
  const groupCols = topStay ? 5 : 3
  const th: React.CSSProperties = { textAlign: 'right', padding: '6px 10px', fontWeight: 500, color: INK2, whiteSpace: 'nowrap', borderBottom: '1px solid var(--border2)' }
  const td: React.CSSProperties = { textAlign: 'right', padding: '6px 10px', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)', fontVariantNumeric: 'tabular-nums' }
  const first: React.CSSProperties = { textAlign: 'left', position: 'sticky', left: 0, background: 'var(--bg)' }
  const wrap: React.CSSProperties = { overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 12 }
  // Five columns at phone width: narrower cell padding for that one table.
  const tight: React.CSSProperties = { paddingLeft: 7, paddingRight: 7 }
  const table: React.CSSProperties = { borderCollapse: 'collapse', fontSize: 13, width: '100%' }
  const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 440px), 1fr))', gap: 12 }
  const summary: React.CSSProperties = { cursor: 'pointer', fontSize: 15, fontWeight: 600, padding: '10px 0' }
  const rowLabel: React.CSSProperties = { fontSize: 12, color: INK2, width: 56, flex: 'none' }

  const href = (d: number, c: string | null) => `/admin/traffic?days=${d}${c ? `&country=${c}` : ''}`
  const nameOf = (c: string) => names[c] ?? c
  const where = country ? nameOf(country) : 'All countries'
  const offered = country && !picker.includes(country) ? [...picker, country] : picker
  // New accounts per day; left out when the page could not read them.
  const madeKnown = rows.some(r => r.newAccounts != null)

  const countrySeries: Series<CountryDay>[] = [
    ...countryCodes.slice(0, 3).map((c, i) => ({ key: COUNTRY_KEYS[i], label: nameOf(c), color: COUNTRY_COLORS[i] })),
    ...(countryDays.some(d => d.other > 0) ? [{ key: 'other' as const, label: 'Other', color: NEUTRAL }] : []),
  ]
  // Only the apps with a browser in the range get a line.
  const productSeries = products ? PRODUCTS.filter(s => products.days.some(d => (d[s.key] as number) > 0)) : []
  // The same apps, the same colours, for the per-visit chart.
  const productAvgSeries: Series<ProductAvgDay>[] = productSeries.map(s => ({ ...s, key: s.key as keyof ProductAvgDay & string }))
  // What the app chart shows (owner, Oct 16: "maybe a button to switch?").
  const [appMetric, setAppMetric] = useState<'browsers' | 'avg'>('browsers')
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
        one person on a phone and a laptop counts twice. Your own accounts, and every browser that has signed in with one,
        are left out.
      </p>

      <SportsSpend s={sports} />
      <CheerModels rows={cheerModels} days={days} />

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
          {!topStay && <p style={{ margin: '8px 0 0', fontSize: 12, color: INK2 }}>{NEEDS_128}</p>}

          <div style={{ ...grid, marginTop: 16 }}>
            <Card title="Active browsers per day" note="Returning = first seen on an earlier day." legend={BROWSERS}>
              <Columns rows={rows} series={BROWSERS} />
            </Card>
            <Card title="Visits by source" note="ChatGPT ads carry utm_source=chatgpt; Google Ads carry a click id." legend={SOURCES}>
              <Columns rows={rows} series={SOURCES} />
            </Card>
            {upgraded && (
              <Card title="Browsers by app"
                note={`Every app a visit opened, with the time spent in it (from page views, since Oct 16; older visits count where they landed). A browser counts once a day per app; the table is the whole range.${country ? ` ${where} only.` : ''}`}
                legend={productSeries.length > 1 ? productSeries : undefined}>
                {!products ? <p style={{ margin: 0, fontSize: 13, color: INK2 }}>{NEEDS_138}</p>
                  : products.totals.length === 0 ? <p style={{ margin: 0, fontSize: 13, color: INK2 }}>No visits in this range{country ? ` from ${where}` : ''} yet.</p>
                  : (
                    <>
                      <div role="group" aria-label="The chart shows" style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                        {([['browsers', 'Browsers'], ['avg', 'Avg per visit']] as const).map(([m, label]) => (
                          <button key={m} type="button" aria-pressed={appMetric === m} onClick={() => setAppMetric(m)}
                            style={{ font: 'inherit', fontSize: 13, padding: '5px 12px', borderRadius: 999, cursor: 'pointer',
                              border: `1px solid ${appMetric === m ? 'var(--white)' : 'var(--border2)'}`,
                              background: appMetric === m ? 'var(--white)' : 'transparent', color: appMetric === m ? 'var(--bg)' : INK2 }}>
                            {label}
                          </button>
                        ))}
                      </div>
                      {appMetric === 'browsers'
                        ? <Lines rows={products.days} series={productSeries} format={num} />
                        : <Lines rows={products.avg} series={productAvgSeries} format={stay} />}
                      <div style={{ ...wrap, marginTop: 14 }}>
                        <table style={table}>
                          <thead>
                            <tr><th style={{ ...th, ...first, ...tight }}>App</th><th style={{ ...th, ...tight }}>Browsers</th><th style={{ ...th, ...tight }}>Visits</th><th style={{ ...th, ...tight, whiteSpace: 'normal' }}>Avg per visit</th><th style={{ ...th, ...tight }}>Time</th></tr>
                          </thead>
                          <tbody>
                            {products.totals.map(t => (
                              <tr key={t.product}>
                                <td style={{ ...td, ...first, ...tight, whiteSpace: 'normal' }}>{productName(t.product)}</td>
                                <td style={{ ...td, ...tight }}>{num(t.browsers)}</td><td style={{ ...td, ...tight }}>{num(t.visits)}</td>
                                <td style={{ ...td, ...tight }}>{stay(t.visits > 0 ? Math.round(t.seconds / t.visits) : 0)}</td><td style={{ ...td, ...tight }}>{stay(t.seconds)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
              </Card>
            )}
            {upgraded && (
              <Card title="Rooms and pages"
                note={`Which X先知 room or page each visit opened, and the time spent there (tab in front). Recorded since Oct 16.${country ? ` ${where} only.` : ''}`}>
                {!pages ? <p style={{ margin: 0, fontSize: 13, color: INK2 }}>{NEEDS_139}</p>
                  : pages.length === 0 ? <p style={{ margin: 0, fontSize: 13, color: INK2 }}>No page views in this range{country ? ` from ${where}` : ''} yet.</p>
                  : (
                    <div style={wrap}>
                      <table style={table}>
                        <thead>
                          <tr><th style={{ ...th, ...first }}>Room or page</th><th style={th}>Browsers</th><th style={th}>Views</th><th style={th}>Time</th></tr>
                        </thead>
                        <tbody>
                          {pages.slice(0, 25).map(p => (
                            <tr key={p.page}>
                              <td style={{ ...td, ...first, whiteSpace: 'normal' }}>{pageName(p.page)}</td>
                              <td style={td}>{num(p.browsers)}</td><td style={td}>{num(p.views)}</td><td style={td}>{stay(Number(p.total_seconds))}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
              </Card>
            )}
            {funnel && (
              <Card title="From ads"
                note={`Browsers whose visit in this range came from an ad${country ? ` (${where})` : ''}, and what they did after: all their visits in the range count, later ones too. Pressed = tapped Google, LINE or X (counted since Oct 1; X since Oct 2).`}>
                {funnel.length ? (
                  <div style={wrap}>
                    <table style={table}>
                      <thead>
                        <tr><th style={{ ...th, ...first }} />{funnel.map(f => <th key={f.source} style={th}>{AD_SOURCE[f.source] ?? f.source}</th>)}</tr>
                      </thead>
                      <tbody>
                        <tr><td style={{ ...td, ...first }}>Browsers</td>{funnel.map(f => <td key={f.source} style={td}>{num(f.browsers)}</td>)}</tr>
                        <tr><td style={{ ...td, ...first }}>Stayed 30 s or more</td>{funnel.map(f => <td key={f.source} style={td}>{ofAll(f.stayed_30s, f.browsers)}</td>)}</tr>
                        <tr><td style={{ ...td, ...first }}>Pressed sign-in</td>{funnel.map(f => <td key={f.source} style={td}>{ofAll(f.tapped, f.browsers)}</td>)}</tr>
                        <tr><td style={{ ...td, ...first }}>Signed in</td>{funnel.map(f => <td key={f.source} style={td}>{ofAll(f.signed_in, f.browsers)}</td>)}</tr>
                        <tr><td style={{ ...td, ...first }}>Median time on site</td>{funnel.map(f => <td key={f.source} style={td}>{stay(f.median_seconds)}</td>)}</tr>
                      </tbody>
                    </table>
                  </div>
                ) : <p style={{ margin: 0, fontSize: 13, color: INK2 }}>No ad visitors in this range{country ? ` from ${where}` : ''}.</p>}
              </Card>
            )}
            {upgraded ? (
              <>
                <Card title="Stay, signed in"
                  note="Browsers with an account on a visit that day. Time with the tab in front, added up per browser per day. Top 20% avg and top 10% avg are the average stay of the fifth and the tenth of browsers that stayed longest."
                  legend={signedSeries}>
                  <Lines rows={rows} series={signedSeries} format={stay} has={r => r.signedBrowsers > 0} extra={r => [{ label: 'browsers signed in', value: num(r.signedBrowsers) }]} />
                </Card>
                <Card title="Stay, not signed in"
                  note="Everyone else, the same four numbers. Its own scale: usually seconds here and minutes on the signed-in chart."
                  legend={guestSeries}>
                  <Lines rows={rows} series={guestSeries} format={stay} has={r => r.guestBrowsers > 0} extra={r => [{ label: 'browsers not signed in', value: num(r.guestBrowsers) }]} />
                </Card>
              </>
            ) : (
              <Card title="Stay per browser"
                note={topStay
                  ? 'Time with the tab in front, added up per browser per day. Top 20% avg and top 10% avg are the average stay of the fifth and the tenth of browsers that stayed longest.'
                  : 'Time with the tab in front, added up per browser per day. A few long stays pull the average above the median.'}
                legend={staySeries}>
                <Lines rows={rows} series={staySeries} format={stay} has={r => r.browsers > 0} />
              </Card>
            )}
            {taps && (
              <Card title="Taps on sign-in"
                note={country
                  ? `Presses of Google, LINE and X from ${where}, counted before the visitor leaves for the provider. Completed sign-ins are not known by country: the sign-ins chart below is every country.`
                  : 'Presses of Google, LINE and X, counted before the visitor leaves for the provider, so someone who gives up there still shows. Signed in = accounts that finished (any host, dev included).'}>
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
            {votes && (
              <Card title="XTell teacher votes"
                note={`👍 and 👎 under teachers' answers${country ? ` from ${where}` : ''}, as they stand now, counted on the day last set. People = accounts that voted. Production only.`}>
                {votes.length ? (
                  <div style={wrap}>
                    <table style={table}>
                      <thead>
                        <tr><th style={{ ...th, ...first }}>Teacher</th><th style={{ ...th, textAlign: 'left' }}>Temple</th><th style={th}>👍</th><th style={th}>👎</th><th style={th}>People</th></tr>
                      </thead>
                      <tbody>
                        {votes.map(v => (
                          <tr key={`${v.temple}|${v.model}`}>
                            <td style={{ ...td, ...first }}>{v.model}</td><td style={{ ...td, textAlign: 'left' }}>{v.temple}</td>
                            <td style={td}>{num(v.up)}</td><td style={td}>{num(v.down)}</td><td style={td}>{num(v.people)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <p style={{ margin: 0, fontSize: 13, color: INK2 }}>No votes in this range yet.</p>}
              </Card>
            )}
            {shares && (
              <Card title="XTell shares"
                note={`Presses in XTell's share dialogs${country ? ` from ${where}` : ''}: what was shared, from which temple, and how. Completed and Closed come from the phone's share sheet, which never says which app was picked; a download or a copied link counts as completed. Production only.`}>
                {shares.length ? (
                  <div style={wrap}>
                    <table style={table}>
                      <thead>
                        <tr><th style={{ ...th, ...first }}>What</th><th style={{ ...th, textAlign: 'left' }}>Temple</th><th style={{ ...th, textAlign: 'left' }}>How</th><th style={th}>Completed</th><th style={th}>Closed</th><th style={th}>Failed</th></tr>
                      </thead>
                      <tbody>
                        {shares.map(l => (
                          <tr key={`${l.kind}|${l.temple}|${l.method}`}>
                            <td style={{ ...td, ...first }}>{SHARE_KIND[l.kind] ?? l.kind}</td><td style={{ ...td, textAlign: 'left' }}>{l.temple || '—'}</td>
                            <td style={{ ...td, textAlign: 'left' }}>{SHARE_HOW[l.method] ?? l.method}</td>
                            <td style={td}>{num(l.done)}</td><td style={td}>{num(l.cancelled)}</td><td style={td}>{num(l.failed)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <p style={{ margin: 0, fontSize: 13, color: INK2 }}>No shares in this range yet.</p>}
              </Card>
            )}
          </div>
          {upgraded && !taps && <p style={{ margin: '8px 0 0', fontSize: 12, color: INK2 }}>{NEEDS_120}</p>}
          {upgraded && !votes && <p style={{ margin: '8px 0 0', fontSize: 12, color: INK2 }}>{NEEDS_122}</p>}
          {upgraded && !funnel && <p style={{ margin: '8px 0 0', fontSize: 12, color: INK2 }}>{NEEDS_123}</p>}
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
              note={`Accounts that signed in each day, by the button used (before Oct 2: the method the account was made with, the same unless an account has two). In this range: ${methodSummary}. Sign-ins on dev and localhost count too: the login log does not record the host.`}
              legend={methodSeries}>
              {signinDays.length ? <Columns rows={signinDays} series={methodSeries} /> : <p style={{ margin: 0, fontSize: 13, color: INK2 }}>No sign-ins in this range yet.</p>}
            </Card>
            {accounts && (
              <Card title="Registered accounts"
                note={`Every account, all time, by the country it was last seen in (not where it signed up). New = made in the last ${days} days.`}>
                <div style={wrap}>
                  <table style={table}>
                    <thead>
                      <tr><th style={{ ...th, ...first }}>Country</th><th style={th}>Accounts</th><th style={th}>New in {days} days</th></tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td style={{ ...td, ...first, fontWeight: 600 }}>All</td>
                        <td style={{ ...td, fontWeight: 600 }}>{num(accounts.reduce((s, r) => s + r.users, 0))}</td>
                        <td style={{ ...td, fontWeight: 600 }}>{num(accounts.reduce((s, r) => s + r.new_users, 0))}</td>
                      </tr>
                      {accounts.map(r => (
                        <tr key={r.country}>
                          <td style={{ ...td, ...first }}>{nameOf(r.country)}</td><td style={td}>{num(r.users)}</td><td style={td}>{num(r.new_users)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
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
                  {madeKnown && <th style={th}>New accounts</th>}
                  <th style={th}>Visits</th><th style={th}>Median stay</th>
                  {topStay && <><th style={th}>Top 20% avg stay</th><th style={th}>Top 10% avg stay</th></>}
                  <th style={th}>Average stay</th><th style={th}>Total time</th>
                  <th style={th}>ChatGPT ads</th><th style={th}>Google Ads</th><th style={th}>Other</th>
                </tr>
              </thead>
              <tbody>
                {[...rows].reverse().map(r => (
                  <tr key={r.day}>
                    <td style={{ ...td, ...first }}>{r.day}</td>
                    <td style={td}>{num(r.browsers)}</td><td style={td}>{num(r.newBrowsers)}</td><td style={td}>{num(r.returningBrowsers)}</td><td style={td}>{num(r.signedInUsers)}</td>
                    {madeKnown && <td style={td}>{num(r.newAccounts ?? 0)}</td>}
                    <td style={td}>{num(r.visits)}</td><td style={td}>{stayOf(r.browsers, r.medianSeconds)}</td>
                    {topStay && <><td style={td}>{stayOf(r.browsers, r.top20Seconds)}</td><td style={td}>{stayOf(r.browsers, r.top10Seconds)}</td></>}
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
                  <th style={{ ...th, textAlign: 'center', borderBottom: 'none' }} colSpan={groupCols}>Signed in</th>
                  <th style={{ ...th, textAlign: 'center', borderBottom: 'none' }} colSpan={groupCols}>Not signed in</th>
                </tr>
                <tr>
                  <th style={{ ...th, ...first }}>Day</th>
                  {[0, 1].map(g => <Fragment key={g}><th style={th}>Browsers</th><th style={th}>Median</th>{topStay && <><th style={th}>Top 20% avg</th><th style={th}>Top 10% avg</th></>}<th style={th}>Average</th></Fragment>)}
                </tr>
              </thead>
              <tbody>
                {[...rows].reverse().map(r => (
                  <tr key={r.day}>
                    <td style={{ ...td, ...first }}>{r.day}</td>
                    <td style={td}>{num(r.signedBrowsers)}</td><td style={td}>{stayOf(r.signedBrowsers, r.signedMedian)}</td>
                    {topStay && <><td style={td}>{stayOf(r.signedBrowsers, r.signedTop20)}</td><td style={td}>{stayOf(r.signedBrowsers, r.signedTop10)}</td></>}
                    <td style={td}>{stayOf(r.signedBrowsers, r.signedAvg)}</td>
                    <td style={td}>{num(r.guestBrowsers)}</td><td style={td}>{stayOf(r.guestBrowsers, r.guestMedian)}</td>
                    {topStay && <><td style={td}>{stayOf(r.guestBrowsers, r.guestTop20)}</td><td style={td}>{stayOf(r.guestBrowsers, r.guestTop10)}</td></>}
                    <td style={td}>{stayOf(r.guestBrowsers, r.guestAvg)}</td>
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
