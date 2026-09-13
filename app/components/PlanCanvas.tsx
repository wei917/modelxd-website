'use client'
// app/components/PlanCanvas.tsx — the XArch blueprint: the drawing the
// architect read, with its geometry drawn on top, pan (drag) and zoom
// (wheel / buttons), and every wall, door, window, stair and room clickable.
//
// Coordinates are the plan image's pixels (lib/xarch.ts), so the SVG viewBox
// IS the image size and the drawing and the geometry can never drift apart.

import { useCallback, useEffect, useRef, useState } from 'react'
import { centroid, doorWidthPx, fmtFt, roomSize, type Kind, type Plan, type Selection } from '../../lib/xarch'

export type PlanClick = { selection: NonNullable<Selection>; clientX: number; clientY: number }

export default function PlanCanvas({ plan, imageUrl, selection, highlight, showDrawing, onPick, onClear, flagged }: {
  plan: Plan
  imageUrl: string | null
  selection: Selection
  highlight: Set<string>
  showDrawing: boolean
  onPick: (c: PlanClick) => void
  onClear: () => void
  flagged?: Set<string>
}) {
  const host = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ x: 0, y: 0, k: 1 })
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null)
  const { w, h } = plan.image

  // Wheel zoom around the cursor. A native listener: React's onWheel is
  // passive, so it cannot stop the page from scrolling.
  useEffect(() => {
    const el = host.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const px = e.clientX - r.left, py = e.clientY - r.top
      setView(v => {
        const k = Math.min(8, Math.max(0.5, v.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)))
        return { k, x: px - (px - v.x) * (k / v.k), y: py - (py - v.y) * (k / v.k) }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const zoom = (f: number) => setView(v => {
    const el = host.current; if (!el) return v
    const cx = el.clientWidth / 2, cy = el.clientHeight / 2
    const k = Math.min(8, Math.max(0.5, v.k * f))
    return { k, x: cx - (cx - v.x) * (k / v.k), y: cy - (cy - v.y) * (k / v.k) }
  })

  const pick = useCallback((kind: Kind, id: string) => (e: React.MouseEvent) => {
    e.stopPropagation()
    if (drag.current?.moved) return
    onPick({ selection: { kind, id }, clientX: e.clientX, clientY: e.clientY })
  }, [onPick])

  const isSel = (id: string) => selection?.id === id
  const col = (id: string, base: string) => isSel(id) ? 'var(--red)' : highlight.has(id) ? '#f08a00' : flagged?.has(id) ? '#c026d3' : base
  const ppf = plan.scale?.px_per_ft ?? null
  const unit = Math.max(w, h) / 1000   // stroke/label sizes scale with the drawing

  return (
    <div ref={host} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: 'var(--surface2)', borderRadius: 10, cursor: drag.current ? 'grabbing' : 'grab', touchAction: 'none' }}
      onPointerDown={e => { drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false } }}
      onPointerMove={e => {
        const d = drag.current; if (!d) return
        const dx = e.clientX - d.x, dy = e.clientY - d.y
        if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true
        if (d.moved) setView(v => ({ ...v, x: d.vx + dx, y: d.vy + dy }))
      }}
      onPointerUp={() => { setTimeout(() => { drag.current = null }, 0) }}
      onPointerLeave={() => { drag.current = null }}
      onClick={() => { if (!drag.current?.moved) onClear() }}
    >
      <div style={{ position: 'absolute', left: 0, top: 0, transformOrigin: '0 0', transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, width: '100%' }}>
        <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto', display: 'block', background: '#fff' }}>
          {imageUrl && showDrawing && <image href={imageUrl} width={w} height={h} opacity={0.35} />}
          {plan.rooms.map(r => {
            const size = roomSize(plan, r)
            const [cx, cy] = centroid(r.polygon)
            return (
              <g key={r.id} onClick={pick('rooms', r.id)} style={{ cursor: 'pointer' }}>
                <polygon points={r.polygon.map(p => p.join(',')).join(' ')}
                  fill={isSel(r.id) ? 'rgba(220,38,38,0.14)' : highlight.has(r.id) ? 'rgba(240,138,0,0.18)' : 'rgba(59,130,246,0.08)'}
                  stroke={col(r.id, 'rgba(59,130,246,0.35)')} strokeWidth={1.5 * unit} strokeDasharray={`${5 * unit} ${4 * unit}`} />
                <text x={cx} y={cy} textAnchor="middle" fontSize={15 * unit} fontFamily="var(--font-body), Arial" fill="#1e3a8a" style={{ pointerEvents: 'none', fontWeight: 600 }}>{r.name}</text>
                {size && <text x={cx} y={cy + 17 * unit} textAnchor="middle" fontSize={11 * unit} fontFamily="var(--font-mono), monospace" fill="#475569" style={{ pointerEvents: 'none' }}>{fmtFt(size.w)} × {fmtFt(size.d)} · {Math.round(size.sqft)} ft²</text>}
              </g>
            )
          })}
          {plan.stairs.map(s => (
            <rect key={s.id} x={s.x} y={s.y} width={s.w} height={s.h} fill="rgba(147,51,234,0.06)" stroke={col(s.id, '#9333ea')} strokeWidth={2 * unit} onClick={pick('stairs', s.id)} style={{ cursor: 'pointer' }} />
          ))}
          {plan.walls.map(wl => {
            const th = wl.thickness_in && ppf ? Math.max(3 * unit, (wl.thickness_in / 12) * ppf) : (wl.exterior ? 8 : 5) * unit
            return (
              <g key={wl.id} onClick={pick('walls', wl.id)} style={{ cursor: 'pointer' }}>
                <line x1={wl.x1} y1={wl.y1} x2={wl.x2} y2={wl.y2} stroke="transparent" strokeWidth={Math.max(th, 14 * unit)} />
                <line x1={wl.x1} y1={wl.y1} x2={wl.x2} y2={wl.y2} stroke={col(wl.id, wl.exterior ? '#111827' : '#4b5563')} strokeWidth={th} strokeLinecap="square" />
              </g>
            )
          })}
          {plan.windows.map(wn => (
            <g key={wn.id} onClick={pick('windows', wn.id)} style={{ cursor: 'pointer' }}>
              <line x1={wn.x1} y1={wn.y1} x2={wn.x2} y2={wn.y2} stroke="transparent" strokeWidth={14 * unit} />
              <line x1={wn.x1} y1={wn.y1} x2={wn.x2} y2={wn.y2} stroke={col(wn.id, '#3b82f6')} strokeWidth={6 * unit} />
            </g>
          ))}
          {plan.doors.map(d => {
            const r = doorWidthPx(plan, d) / 2
            return (
              <g key={d.id} onClick={pick('doors', d.id)} style={{ cursor: 'pointer' }}>
                <circle cx={d.x} cy={d.y} r={Math.max(r, 8 * unit)} fill="rgba(22,163,74,0.12)" stroke={col(d.id, '#16a34a')} strokeWidth={2.5 * unit} />
              </g>
            )
          })}
        </svg>
      </div>
      <div style={{ position: 'absolute', right: 10, bottom: 10, display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
        {[['+', () => zoom(1.25)], ['−', () => zoom(0.8)], ['⤢', () => setView({ x: 0, y: 0, k: 1 })]].map(([label, fn]) => (
          <button key={label as string} onClick={fn as () => void} style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--surface)', color: 'var(--white)', cursor: 'pointer', fontSize: 16 }}>{label as string}</button>
        ))}
      </div>
    </div>
  )
}
