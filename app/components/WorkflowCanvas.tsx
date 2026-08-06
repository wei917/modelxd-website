'use client'
// app/components/WorkflowCanvas.tsx
// The workflow BOARD (CC, July 27 → product pipeline, July 28).
//
// A ComfyUI-style canvas over one board. Nodes are generations (uploaded
// source photos, generated angles, videos); wires are derivations. Unlike
// the first version this is an EDITOR, not a viewer: nodes multi-select,
// delete, and drive the actions in the floating toolbar.
//
// Multi-select is the load-bearing part of the product pipeline. Generating
// a product video means handing a model the original photo AND the
// generated angles as reference images at once, so "which nodes are
// selected" IS the input set — not a cursor.
//
// Hand-rolled on purpose: a dotted-grid pan/zoom surface with bezier wires
// is ~300 lines, needs no dependency, and stays in ModelXD's design
// language instead of fighting a library theme.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useT } from '../../lib/i18n'

export type NodeKind = 'source' | 'input' | 'video' | 'shot'

export type CanvasNode = {
  id: string
  thumb: string | null
  isVideo: boolean
  parentId: string | null
  parentIds?: string[]
  label?: string
  cost?: number
  kind?: NodeKind | null
  /** Output nodes carry the row they came from and WHICH slot. A two-model
   *  run is two nodes sharing one rowId — the board shows both outputs the
   *  user paid for instead of collapsing them into one. */
  rowId?: string
  slotIdx?: number
  chosen?: boolean
  /** Set on INPUT nodes: the uploaded reference image behind a generation.
   *  Not a database row, so it can be used as a generation input but never
   *  deleted. Shape matches /api/xcreate's `attachments` parameter. */
  attach?: { bucket: string; storagePath: string; mediaType: string; fileName: string; fileSize: number }
  /** 'running' nodes are client-side placeholders for in-flight jobs —
   *  they have a jobId for an id and no row in the database yet. */
  status?: 'done' | 'running' | 'error'
  error?: string | null
}

const NODE_W = 168
const NODE_H = 138   // 100 thumb + footer
const COL_GAP = 110  // horizontal space for the wires
const ROW_GAP = 28

const KIND_BADGE: Record<NodeKind, { text: string; bg: string }> = {
  source: { text: 'SRC',   bg: '#3c6ee8' },
  input:  { text: 'INPUT', bg: '#5a6472' },
  video:  { text: 'VIDEO', bg: '#e8453c' },
  shot:   { text: 'SHOT',  bg: '#9a5ce8' },
}

export default function WorkflowCanvas({
  nodes, selectedIds, onSelect, onClearSelection,
  onDelete, busy = false, height = 460,
}: {
  nodes: CanvasNode[]
  selectedIds: string[]
  /** additive = shift/cmd-click: add to the selection instead of replacing. */
  onSelect: (n: CanvasNode, additive: boolean) => void
  onClearSelection: () => void
  onDelete?: (nodes: CanvasNode[]) => void
  busy?: boolean
  /** XCreate keeps the compact 460px board; /xdirect runs it as the stage. */
  height?: number | string
}) {
  const t = useT()
  const sel = useMemo(() => new Set(selectedIds), [selectedIds])

  // ── Layout: generation depth → column, siblings stack in rows. ──────────
  const layout = useMemo(() => {
    const byId = new Map(nodes.map(n => [n.id, n]))
    const parentsOf = (n: CanvasNode) =>
      ((n.parentIds && n.parentIds.length > 0) ? n.parentIds : (n.parentId ? [n.parentId] : []))
        .filter(p => byId.has(p))

    // A node sits one column right of its DEEPEST parent, so a video built
    // from the source plus three angles lands after the angles, not beside
    // the source. Memoised, with a visited set so a bad edge can't hang the
    // board.
    const memo = new Map<string, number>()
    const depthOf = (id: string, seen: Set<string>): number => {
      const hit = memo.get(id)
      if (hit !== undefined) return hit
      if (seen.has(id)) return 0
      seen.add(id)
      const n = byId.get(id)
      const ps = n ? parentsOf(n) : []
      const d = ps.length > 0 ? Math.max(...ps.map(p => depthOf(p, seen))) + 1 : 0
      memo.set(id, d)
      return d
    }

    const cols = new Map<number, CanvasNode[]>()
    for (const n of nodes) {
      const d = depthOf(n.id, new Set())
      if (!cols.has(d)) cols.set(d, [])
      cols.get(d)!.push(n)
    }
    const pos = new Map<string, { x: number; y: number }>()
    const maxRows = Math.max(1, ...[...cols.values()].map(c => c.length))
    const fullH = maxRows * (NODE_H + ROW_GAP)
    for (const [d, col] of cols) {
      const colH = col.length * (NODE_H + ROW_GAP)
      col.forEach((n, i) => {
        pos.set(n.id, {
          x: 40 + d * (NODE_W + COL_GAP),
          y: 40 + (fullH - colH) / 2 + i * (NODE_H + ROW_GAP),
        })
      })
    }
    const width = 80 + (Math.max(0, ...[...cols.keys()]) + 1) * (NODE_W + COL_GAP)
    return { pos, byId, parentsOf, height: fullH + 80, width }
  }, [nodes])

  // ── Pan + zoom. Drag empty canvas to pan, wheel to zoom. ────────────────
  // Thumbnails whose signed URL 403'd, keyed BY URL. Keying by url (not by
  // node id) matters: when the board re-signs a stale link the key changes,
  // so the new URL is retried automatically. The first version of this set
  // style.display='none' imperatively in onError, and React reused the same
  // <img> element when the src changed — so a node that had once expired
  // stayed invisible even after a perfectly good URL arrived.
  const [failed, setFailed] = useState<Record<string, true>>({})

  const [view, setView] = useState({ x: 0, y: 0, z: 1 })
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null)
  const hostRef = useRef<HTMLDivElement>(null)

  // Wheel-zoom has to be a MANUAL listener with passive:false. React
  // registers onWheel as passive, so preventDefault() there is ignored and
  // the browser scrolls the page instead of zooming the board — the hint
  // said "scroll to zoom" while the page slid out from under you.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const onWheelRaw = (e: WheelEvent) => {
      e.preventDefault()
      setView(v => ({ ...v, z: Math.min(2, Math.max(0.35, v.z * (e.deltaY > 0 ? 0.9 : 1.1))) }))
    }
    host.addEventListener('wheel', onWheelRaw, { passive: false })
    return () => host.removeEventListener('wheel', onWheelRaw)
  }, [])

  const onPointerDown = (e: React.PointerEvent) => {
    // Only pan when grabbing the BACKGROUND. Nodes are their own click
    // targets, and the floating toolbar is chrome sitting on top of the
    // canvas — pressing either must not start a pan, or the toolbar's own
    // buttons arm a drag that then eats the click.
    const el = e.target as HTMLElement
    if (el.closest('[data-node]') || el.closest('[data-ui]')) return
    drag.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) d.moved = true
    // Resolve the origin NOW, not inside the updater. React may run the
    // updater after onPointerUp has already nulled drag.current, and reading
    // drag.current!.ox in there threw "Cannot read properties of null" the
    // first time anyone clicked the toolbar.
    const nx = d.ox + dx, ny = d.oy + dy
    setView(v => ({ ...v, x: nx, y: ny }))
  }
  const onPointerUp = () => {
    // A click on empty space (as opposed to a pan) clears the selection —
    // the standard canvas gesture, and the only way to deselect everything
    // without hunting for a button.
    if (drag.current && !drag.current.moved) onClearSelection()
    drag.current = null
  }
  // ── Wires: one cubic bezier per parent edge. ────────────────────────────
  const wires = nodes.flatMap(n => {
    const c = layout.pos.get(n.id)
    if (!c) return []
    return layout.parentsOf(n).flatMap(pid => {
      const p = layout.pos.get(pid)
      if (!p) return []
      const x1 = p.x + NODE_W, y1 = p.y + NODE_H / 2
      const x2 = c.x,          y2 = c.y + NODE_H / 2
      const mid = Math.max(30, (x2 - x1) / 2)
      const lit = sel.has(n.id) || sel.has(pid)
      return [{
        key: `${pid}->${n.id}`,
        d: `M ${x1} ${y1} C ${x1 + mid} ${y1}, ${x2 - mid} ${y2}, ${x2} ${y2}`,
        lit,
      }]
    })
  })

  const selNodes    = nodes.filter(n => sel.has(n.id))
  const selReady    = selNodes.filter(n => n.status !== 'running')
  // Input nodes are attachments, not rows — there is nothing to soft-delete.
  const selDeletable = selReady.filter(n => !!n.rowId)
  const boardCost   = nodes.reduce((sum, n) => sum + (n.cost ?? 0), 0)

  const btn = (enabled: boolean): React.CSSProperties => ({
    background: 'transparent',
    border: '1px solid ' + (enabled ? 'var(--red)' : '#3a3c42'),
    color: enabled ? 'var(--red)' : '#5a5c63',
    borderRadius: 7, padding: '5px 11px', fontSize: 10.5, fontFamily: 'var(--mono)',
    letterSpacing: '0.07em', textTransform: 'uppercase', whiteSpace: 'nowrap',
    cursor: enabled ? 'pointer' : 'not-allowed',
  })

  return (
    <div
      ref={hostRef}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{
        position: 'relative', height, marginBottom: 24, borderRadius: 12,
        border: '1px solid var(--border2)', overflow: 'hidden',
        cursor: drag.current ? 'grabbing' : 'grab', touchAction: 'none',
        // ComfyUI-style dotted grid on a dark surface.
        background: '#141518',
        backgroundImage: 'radial-gradient(circle, #2a2c31 1px, transparent 1px)',
        backgroundSize: '22px 22px',
      }}
    >
      <div style={{ position: 'absolute', transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`, transformOrigin: '0 0' }}>
        <svg
          width={Math.max(1200, layout.width)} height={Math.max(600, layout.height)}
          style={{ position: 'absolute', pointerEvents: 'none', overflow: 'visible' }}
        >
          {wires.map(w => (
            <path
              key={w.key} d={w.d} fill="none" stroke="#e8453c"
              strokeWidth={w.lit ? 2.5 : 2} strokeOpacity={w.lit ? 0.95 : 0.4}
            />
          ))}
        </svg>
        {nodes.map(n => {
          const p = layout.pos.get(n.id)
          if (!p) return null
          const selected = sel.has(n.id)
          const running  = n.status === 'running'
          const errored  = n.status === 'error'
          const badge    = n.kind ? KIND_BADGE[n.kind] : null
          return (
            <div
              key={n.id} data-node
              onClick={e => { e.stopPropagation(); onSelect(n, e.shiftKey || e.metaKey || e.ctrlKey) }}
              style={{
                position: 'absolute', left: p.x, top: p.y, width: NODE_W,
                borderRadius: 10, overflow: 'hidden', cursor: 'pointer',
                border: '2px solid ' + (selected ? 'var(--red)' : errored ? '#7a3a36' : '#33353b'),
                boxShadow: selected ? '0 0 0 4px rgba(232,69,60,0.25)' : '0 2px 10px rgba(0,0,0,0.4)',
                background: '#1d1f24',
                opacity: running ? 0.75 : 1,
              }}
            >
              <div style={{ position: 'relative', height: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000' }}>
                {running
                  ? <span className="nav-history-spin" style={{ color: '#8a8c93', fontSize: 18 }}>◠</span>
                  : errored
                    ? <span style={{ color: '#c4564e', fontSize: 18 }} title={n.error ?? undefined}>⚠</span>
                    : (n.thumb && !failed[n.thumb])
                      ? (n.isVideo
                        ? <video
                            src={n.thumb} muted playsInline
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            onError={() => setFailed(f => ({ ...f, [n.thumb!]: true }))}
                          />
                        : <img
                            src={n.thumb} alt="" draggable={false}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            onError={() => setFailed(f => ({ ...f, [n.thumb!]: true }))}
                          />)
                      : <span style={{ color: '#555', fontSize: 11, fontFamily: 'var(--mono)' }}>expired</span>}
                {badge && (
                  <span style={{
                    position: 'absolute', left: 6, top: 6, background: badge.bg, color: '#fff',
                    fontSize: 8.5, fontFamily: 'var(--mono)', letterSpacing: '0.08em',
                    padding: '2px 5px', borderRadius: 4, opacity: 0.92,
                  }}>{badge.text}</span>
                )}
              </div>
              <div style={{ padding: '6px 9px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{ fontSize: 10, fontFamily: 'var(--mono)', color: '#9a9ca3', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}
                  title={n.error ?? n.label}
                >
                  {n.isVideo ? '▶ ' : ''}{n.label ?? '—'}
                </span>
                {typeof n.cost === 'number' && n.cost > 0 && (
                  <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--red)', flexShrink: 0 }}>${n.cost.toFixed(3)}</span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Floating selection toolbar. Appears only with a selection, so the
          empty board stays clean. */}
      {selNodes.length > 0 && (
        <div data-ui style={{
          position: 'absolute', left: 10, top: 10, display: 'flex', alignItems: 'center',
          gap: 8, flexWrap: 'wrap', maxWidth: 'calc(100% - 20px)',
          background: 'rgba(20,21,24,0.94)', border: '1px solid var(--border2)',
          borderRadius: 9, padding: '7px 10px', backdropFilter: 'blur(6px)',
        }}>
          <span style={{ fontSize: 10.5, fontFamily: 'var(--mono)', color: '#9a9ca3', letterSpacing: '0.07em' }}>
            {selNodes.length} {t('wf.selected')}
          </span>
          <button
            disabled={busy || selDeletable.length === 0}
            onClick={e => { e.stopPropagation(); if (!busy && selDeletable.length > 0) onDelete?.(selDeletable) }}
            style={btn(!busy && selDeletable.length > 0)}
            title={selDeletable.length === 0 ? t('wf.inputnodelete') : undefined}
          >✕ {t('wf.delete')}</button>
          <button
            onClick={e => { e.stopPropagation(); onClearSelection() }}
            style={{ ...btn(true), border: '1px solid #3a3c42', color: '#9a9ca3' }}
          >{t('wf.clearsel')}</button>
        </div>
      )}

      {boardCost > 0 && (
        <div style={{ position: 'absolute', left: 12, bottom: 8, fontSize: 10, fontFamily: 'var(--mono)', color: '#7a7c83', pointerEvents: 'none' }}>
          {t('wf.boardcost')} ${boardCost.toFixed(3)}
        </div>
      )}
      <div style={{ position: 'absolute', right: 10, bottom: 8, fontSize: 10, fontFamily: 'var(--mono)', color: '#5a5c63', pointerEvents: 'none' }}>
        {t('wf.canvashint')}
      </div>
    </div>
  )
}
