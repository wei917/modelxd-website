'use client'

// The traffic dashboard's view: today's numbers, three small charts and the
// table they are drawn from. Everything here is presentation; the rows come
// from site_visit_daily() through page.tsx.
//
// Built phone-first (owner, Sep 28). Charts are plain HTML and SVG: columns
// capped at 24px with a 2px gap between stacked parts, one y-axis each, a
// legend whenever there are two series, hover/focus tooltips on the whole
// day slot, and the table below as the no-hover way to every number.

import { useState } from 'react'
import Link from 'next/link'

export type DayRow = {
  day: string                // YYYY-MM-DD in the page's time zone
  visits: number
  browsers: number
  newBrowsers: number
  returningBrowsers: number
  signedInUsers: number
  medianSeconds: number
  avgSeconds: number
  totalSeconds: number
  chatgpt: number
  google: number
  other: number
}

type Series = { key: keyof DayRow; label: string; color: string }

// Categorical slots 1-3 of the chart palette, in fixed order (validated on
// the site's light surface; the aqua is under 3:1, which the legend, the
// tooltip and the table cover).
const BLUE = '#2a78d6', ORANGE = '#eb6834', AQUA = '#1baf7a'
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

function Legend({ series }: { series: Series[] }) {
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

function Tip({ title, lines, x, n }: { title: string; lines: Array<{ label: string; value: string; color?: string }>; x: number; n: number }) {
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
function Plot({ rows, max, format, ticksFor = axis, tip, children }: {
  rows: DayRow[]
  max: number
  format: (n: number) => string
  ticksFor?: (max: number) => number[]
  tip: (r: DayRow) => Array<{ label: string; value: string; color?: string }>
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

function Columns({ rows, series }: { rows: DayRow[]; series: Series[] }) {
  const total = (r: DayRow) => series.reduce((s, x) => s + (r[x.key] as number), 0)
  const max = Math.max(1, ...rows.map(total))
  return (
    <Plot rows={rows} max={max} format={num}
      tip={r => [...series.map(s => ({ label: s.label, value: num(r[s.key] as number), color: s.color })), ...(series.length > 1 ? [{ label: 'total', value: num(total(r)) }] : [])]}>
      {(top, hover) => (
        <div aria-hidden style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end' }}>
          {rows.map((r, i) => {
            const parts = series.filter(s => (r[s.key] as number) > 0)
            return (
              <div key={r.day} style={{ flex: 1, height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'flex-end', padding: '0 1px' }}>
                <div style={{ width: '100%', maxWidth: 24, height: `${(total(r) / top) * 100}%`, display: 'flex', flexDirection: 'column-reverse', gap: 2, opacity: hover === null || hover === i ? 1 : 0.55 }}>
                  {parts.map((s, k) => (
                    <div key={s.label} style={{ flex: `${r[s.key] as number} 0 0`, minHeight: 2, background: s.color, borderRadius: k === parts.length - 1 ? '4px 4px 0 0' : 0 }} />
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

function Lines({ rows, series, format }: { rows: DayRow[]; series: Series[]; format: (n: number) => string }) {
  const max = Math.max(1, ...rows.flatMap(r => series.map(s => r[s.key] as number)))
  const n = rows.length
  const x = (i: number) => ((i + 0.5) / n) * 100
  return (
    <Plot rows={rows} max={max} format={format} ticksFor={timeAxis}
      tip={r => series.map(s => ({ label: s.label, value: format(r[s.key] as number), color: s.color }))}>
      {(top, hover) => (
        <>
          <svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
            {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={0} y2={100} stroke="var(--border2)" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
            {n > 1 && series.map(s => (
              <polyline key={s.label} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"
                points={rows.map((r, i) => `${x(i)},${100 - ((r[s.key] as number) / top) * 100}`).join(' ')} />
            ))}
          </svg>
          {/* End dots (and the hovered day's), round at any width: 8px with a 2px surface ring. */}
          {series.map(s => [n - 1, hover].filter((i, k, a): i is number => i !== null && a.indexOf(i) === k).map(i => (
            <span key={`${s.label}${i}`} aria-hidden style={{
              position: 'absolute', left: `${x(i)}%`, bottom: `${((rows[i][s.key] as number) / top) * 100}%`,
              width: 8, height: 8, borderRadius: '50%', background: s.color, boxShadow: '0 0 0 2px var(--bg)', transform: 'translate(-50%, 50%)',
            }} />
          )))}
        </>
      )}
    </Plot>
  )
}

function Card({ title, note, legend, children }: { title: string; note?: string; legend?: Series[]; children: React.ReactNode }) {
  return (
    <section style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 16, minWidth: 0 }}>
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: INK }}>{title}</h2>
      {note && <p style={{ margin: '2px 0 0', fontSize: 12, color: INK2 }}>{note}</p>}
      {legend && <div style={{ marginTop: 8 }}><Legend series={legend} /></div>}
      <div style={{ marginTop: 14 }}>{children}</div>
    </section>
  )
}

function Tile({ label, value, was }: { label: string; value: string; was: string | null }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px', minWidth: 0 }}>
      <div style={{ fontSize: 12, color: INK2 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 600, color: INK, lineHeight: 1.2, marginTop: 2 }}>{value}</div>
      <div style={{ fontSize: 12, color: INK3, marginTop: 2 }}>{was === null ? ' ' : `Yesterday ${was}`}</div>
    </div>
  )
}

const BROWSERS: Series[] = [
  { key: 'newBrowsers', label: 'New', color: BLUE },
  { key: 'returningBrowsers', label: 'Returning', color: ORANGE },
]
const SOURCES: Series[] = [
  { key: 'chatgpt', label: 'ChatGPT ads', color: BLUE },
  { key: 'google', label: 'Google Ads', color: ORANGE },
  { key: 'other', label: 'Other', color: AQUA },
]
const STAY: Series[] = [
  { key: 'medianSeconds', label: 'Median', color: BLUE },
  { key: 'avgSeconds', label: 'Average', color: ORANGE },
]

export default function TrafficView({ rows, days, ranges, tz }: { rows: DayRow[]; days: number; ranges: readonly number[]; tz: string }) {
  const today = rows[rows.length - 1]
  const prev = rows.length > 1 ? rows[rows.length - 2] : null
  const th: React.CSSProperties = { textAlign: 'right', padding: '6px 10px', fontWeight: 500, color: INK2, whiteSpace: 'nowrap', borderBottom: '1px solid var(--border2)' }
  const td: React.CSSProperties = { textAlign: 'right', padding: '6px 10px', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)', fontVariantNumeric: 'tabular-nums' }
  return (
    <main style={{ maxWidth: 1040, margin: '0 auto', padding: '20px 16px 56px', color: INK, fontFamily: 'var(--font-body)' }}>
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Traffic</h1>
      <p style={{ margin: '4px 0 0', fontSize: 13, color: INK2, lineHeight: 1.5 }}>
        Production visits from our own visit log, by day in {tz}. &ldquo;Browsers&rdquo; are visitor cookies, not people:
        one person on a phone and a laptop counts twice.
      </p>

      <nav aria-label="Date range" style={{ display: 'flex', gap: 6, marginTop: 14, flexWrap: 'wrap' }}>
        {ranges.map(d => (
          <Link key={d} href={`/admin/traffic?days=${d}`} aria-current={d === days ? 'true' : undefined} style={{
            padding: '6px 12px', borderRadius: 999, fontSize: 13, textDecoration: 'none',
            border: `1px solid ${d === days ? INK : 'var(--border2)'}`, background: d === days ? INK : 'transparent', color: d === days ? 'var(--bg)' : INK,
          }}>{d} days</Link>
        ))}
      </nav>

      {!today ? (
        <p style={{ marginTop: 24, fontSize: 14, color: INK2 }}>No visits logged in this range yet.</p>
      ) : (
        <>
          <h2 style={{ margin: '22px 0 8px', fontSize: 13, fontWeight: 500, color: INK2 }}>Today so far ({today.day})</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            <Tile label="Active browsers" value={num(today.browsers)} was={prev && num(prev.browsers)} />
            <Tile label="Returning browsers" value={num(today.returningBrowsers)} was={prev && num(prev.returningBrowsers)} />
            <Tile label="Signed-in users" value={num(today.signedInUsers)} was={prev && num(prev.signedInUsers)} />
            <Tile label="Median stay" value={stay(today.medianSeconds)} was={prev && stay(prev.medianSeconds)} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 440px), 1fr))', gap: 12, marginTop: 16 }}>
            <Card title="Active browsers per day" note="Returning = first seen on an earlier day." legend={BROWSERS}>
              <Columns rows={rows} series={BROWSERS} />
            </Card>
            <Card title="Visits by source" note="ChatGPT ads carry utm_source=chatgpt; Google Ads carry a click id." legend={SOURCES}>
              <Columns rows={rows} series={SOURCES} />
            </Card>
            <Card title="Stay per browser" note="Time with the tab in front, added up per browser per day. A few long stays pull the average above the median." legend={STAY}>
              <Lines rows={rows} series={STAY} format={stay} />
            </Card>
          </div>

          <h2 style={{ margin: '26px 0 8px', fontSize: 15, fontWeight: 600 }}>Every day</h2>
          <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 12 }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 13, width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: 'left', position: 'sticky', left: 0, background: 'var(--bg)' }}>Day</th>
                  <th style={th}>Browsers</th><th style={th}>New</th><th style={th}>Returning</th><th style={th}>Signed-in users</th>
                  <th style={th}>Visits</th><th style={th}>Median stay</th><th style={th}>Average stay</th><th style={th}>Total time</th>
                  <th style={th}>ChatGPT ads</th><th style={th}>Google Ads</th><th style={th}>Other</th>
                </tr>
              </thead>
              <tbody>
                {[...rows].reverse().map(r => (
                  <tr key={r.day}>
                    <td style={{ ...td, textAlign: 'left', position: 'sticky', left: 0, background: 'var(--bg)' }}>{r.day}</td>
                    <td style={td}>{num(r.browsers)}</td><td style={td}>{num(r.newBrowsers)}</td><td style={td}>{num(r.returningBrowsers)}</td><td style={td}>{num(r.signedInUsers)}</td>
                    <td style={td}>{num(r.visits)}</td><td style={td}>{stay(r.medianSeconds)}</td><td style={td}>{stay(r.avgSeconds)}</td><td style={td}>{(r.totalSeconds / 3600).toFixed(1)} h</td>
                    <td style={td}>{num(r.chatgpt)}</td><td style={td}>{num(r.google)}</td><td style={td}>{num(r.other)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  )
}
