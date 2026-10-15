'use client'

// app/xsports/OddsChart.tsx — the 賠率 tab's timeline (owner, Oct 14:
// "賠率。應該要有時間軸才對 不是現在的一個數字"): each source's chance for the
// away team over time, from /api/xsports/odds/[pk] (lib/xsports-odds-history).
// Above the middle line the away team is favoured, below it the home team,
// each half lightly in the team's colour. A finger (or the mouse) moved
// across the chart reads every source at that moment in the legend; let go
// and it reads the latest again. 比賽中 shows the game, 開盤以來 everything
// since the markets opened. Information only; nothing links to a bet.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Copy } from './copy'

interface Pt { t: number; away: number }
interface History {
  away: string; home: string; status: string; start: number | null
  model: Pt[]; kalshi: Pt[]; poly: Pt[]
  marks: { t: number; away: number; awayScore: number; homeScore: number }[]
  ticks: { t: number; n: number }[]
  asOf: number
}
type Key = 'model' | 'kalshi' | 'poly'

const H = 168
const POLL_MS = 30_000
const COLORS: Record<Key, string> = { model: '#202124', kalshi: '#0b7fab', poly: '#6d4bd8' }
const WIDTH: Record<Key, number> = { model: 2.2, kalshi: 1.6, poly: 1.6 }

/** The last value at or before t, or null before the first one. */
function at(points: Pt[], t: number): number | null {
  let lo = 0, hi = points.length - 1, found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (points[mid].t <= t) { found = mid; lo = mid + 1 } else hi = mid - 1
  }
  return found < 0 ? null : points[found].away
}

export default function OddsChart({ league, pk, c, lang, awayColor, homeColor }: {
  league: 'mlb' | 'nba'; pk: number; c: Copy; lang: string; awayColor: string; homeColor: string
}) {
  const [h, setH] = useState<History | null>(null)
  const [down, setDown] = useState(false)
  const [range, setRange] = useState<'game' | 'all' | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [w, setW] = useState(0)
  const boxRef = useRef<HTMLDivElement | null>(null)

  // The history, again every 30 s while the tab is in front; a finished
  // game's no longer changes.
  useEffect(() => {
    let stop = false
    let timer: ReturnType<typeof setInterval> | null = null
    const load = async () => {
      if (document.hidden) return
      try {
        const res = await fetch(`/api/xsports/odds/${pk}?league=${league}`)
        if (!res.ok) throw new Error(String(res.status))
        const j: History = await res.json()
        if (stop) return
        setH(j)
        setDown(false)
        if (j.status === 'final' && timer) { clearInterval(timer); timer = null }
      } catch {
        if (!stop) setDown(true)
      }
    }
    load()
    timer = setInterval(load, POLL_MS)
    return () => { stop = true; if (timer) clearInterval(timer) }
  }, [pk, league])

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    setW(el.clientWidth)
    return () => ro.disconnect()
  }, [h !== null]) // eslint-disable-line react-hooks/exhaustive-deps

  const view = useMemo(() => {
    if (!h) return null
    const all = [...h.model, ...h.kalshi, ...h.poly]
    if (!all.length) return null
    const lastModel = h.model[h.model.length - 1]?.t ?? null
    const started = h.model.length > 0
    const final = h.status === 'final'
    const gameFrom = (h.start ?? h.model[0]?.t ?? h.asOf) - 10 * 60_000
    const gameTo = final && lastModel ? lastModel + 10 * 60_000 : h.asOf
    const allFrom = Math.min(...all.map(p => p.t))
    const r = range ?? (started ? 'game' : 'all')
    const from = r === 'game' && started ? gameFrom : allFrom
    const to = r === 'game' && started ? gameTo : (final && lastModel ? gameTo : h.asOf)
    return { started, final, r: started ? r : 'all' as const, from, to: Math.max(to, from + 60_000) }
  }, [h, range])

  if (down && !h) return null
  if (!h || !view) {
    return h ? <p className="xs-none" style={{ padding: '12px 0' }}>{c.trendEmpty}</p> : <div className="xs-trend skel" aria-busy="true" />
  }

  const x = (t: number) => ((t - view.from) / (view.to - view.from)) * w
  const y = (away: number) => H - (Math.min(100, Math.max(0, away)) / 100) * H
  const sources: { key: Key; label: string; points: Pt[] }[] = ([
    { key: 'model', label: c.modelOf(league), points: h.model },
    { key: 'kalshi', label: 'Kalshi', points: h.kalshi },
    { key: 'poly', label: c.poly, points: h.poly },
  ] as { key: Key; label: string; points: Pt[] }[]).filter(s => s.points.length)

  // A line through the range: from the value in force at its left edge, at
  // most about two points per pixel column.
  const path = (points: Pt[]) => {
    if (!w) return ''
    const inside = points.filter(p => p.t >= view.from && p.t <= view.to)
    const before = at(points, view.from)
    const step = Math.max(1, Math.floor(inside.length / (w * 2)))
    const pts: [number, number][] = []
    if (before !== null) pts.push([0, y(before)])
    inside.forEach((p, i) => { if (i % step === 0 || i === inside.length - 1) pts.push([x(p.t), y(p.away)]) })
    return pts.length > 1 ? `M${pts.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join('L')}` : ''
  }

  // What the legend reads: the moment under the finger, else the latest.
  const when = hover ?? Math.min(view.to, h.asOf)
  const read = (points: Pt[]) => at(points, when)
  const fmtTime = (t: number, withDay: boolean) => {
    try {
      return new Intl.DateTimeFormat(lang, withDay ? { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false } : { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(t))
    } catch { return '' }
  }
  const multiDay = view.to - view.from > 20 * 3600_000
  const whenLabel = hover === null ? (view.final ? c.final : c.trendNow) : fmtTime(hover, multiDay)
  const favored = (away: number) => (away >= 50 ? `${h.away} ${away.toFixed(away >= 99.95 || away < 10 ? 0 : 1).replace(/\.0$/, '')}%` : `${h.home} ${(100 - away).toFixed(100 - away >= 99.95 || 100 - away < 10 ? 0 : 1).replace(/\.0$/, '')}%`)

  // Along the bottom: innings or periods in a game, dates or hours since the
  // markets opened.
  const ticks: { x: number; label: string }[] = view.r === 'game'
    ? h.ticks.filter(k => k.t >= view.from && k.t <= view.to).map(k => ({ x: x(k.t), label: league === 'nba' ? (k.n <= 4 ? `Q${k.n}` : `OT${k.n > 5 ? k.n - 4 : ''}`) : String(k.n) }))
    : Array.from({ length: 4 }, (_, i) => view.from + ((i + 0.5) / 4) * (view.to - view.from)).map(t => ({ x: x(t), label: fmtTime(t, multiDay) }))

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse' && e.buttons === 0 && e.type === 'pointermove') return
    const box = e.currentTarget.getBoundingClientRect()
    const f = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width))
    setHover(view.from + f * (view.to - view.from))
  }
  const hx = hover === null ? null : x(hover)

  return (
    <section className="xs-trend" aria-label={c.trendTitle}>
      <div className="hd">
        <h3>{c.trendTitle}</h3>
        {view.started ? (
          <div className="rng" role="group">
            <button type="button" aria-pressed={view.r === 'game'} onClick={() => { setRange('game'); setHover(null) }}>{c.rangeGame}</button>
            <button type="button" aria-pressed={view.r === 'all'} onClick={() => { setRange('all'); setHover(null) }}>{c.rangeAll}</button>
          </div>
        ) : null}
      </div>
      <div ref={boxRef} className="plot" onPointerDown={onMove} onPointerMove={onMove} onPointerLeave={() => setHover(null)} onPointerUp={e => { if (e.pointerType !== 'mouse') setHover(null) }} onPointerCancel={() => setHover(null)}>
        {w ? (
          <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} aria-hidden>
            <rect x={0} y={0} width={w} height={H / 2} style={{ fill: awayColor }} fillOpacity={0.07} />
            <rect x={0} y={H / 2} width={w} height={H / 2} style={{ fill: homeColor }} fillOpacity={0.07} />
            {[0.25, 0.75].map(f => <line key={f} x1={0} x2={w} y1={H * f} y2={H * f} className="grid" />)}
            <line x1={0} x2={w} y1={H / 2} y2={H / 2} className="mid" />
            {view.r === 'game' ? ticks.map((k, i) => <line key={i} x1={k.x} x2={k.x} y1={0} y2={H} className="grid" />) : null}
            {[...sources].reverse().map(s => <path key={s.key} d={path(s.points)} style={{ stroke: COLORS[s.key], strokeWidth: WIDTH[s.key] }} className="ln" />)}
            {h.marks.filter(m => m.t >= view.from && m.t <= view.to).map((m, i) => <circle key={i} cx={x(m.t)} cy={y(m.away)} r={3.6} className="mk" />)}
            {hx !== null ? (
              <g className="cur">
                <line x1={hx} x2={hx} y1={0} y2={H} />
                {sources.map(s => { const v = read(s.points); return v === null ? null : <circle key={s.key} cx={hx} cy={y(v)} r={3.4} style={{ fill: COLORS[s.key] }} /> })}
              </g>
            ) : null}
          </svg>
        ) : null}
        <span className="ya top">{h.away}</span>
        <span className="ya bot">{h.home}</span>
      </div>
      <div className="xt" aria-hidden>
        {ticks.map((k, i) => <span key={i} style={{ left: `${(k.x / Math.max(1, w)) * 100}%` }}>{k.label}</span>)}
      </div>
      <div className="lg">
        <span className="when">{whenLabel}</span>
        {sources.map(s => { const v = read(s.points); return (
          <span key={s.key} className="src"><i style={{ background: COLORS[s.key] }} />{s.label}<b>{v === null ? '–' : favored(v)}</b></span>
        ) })}
      </div>
    </section>
  )
}
