'use client'
// app/xgame/GridBoard.tsx — the one board for XGame's grid games (Oct 19).
// Chess uses it now; 五子棋 (15×15 intersections) and 象棋 (9×10
// intersections, river and palaces through `decorate`) are next. It knows
// geometry, highlights and taps, never rules: the game passes in where a
// piece may go (`movesFrom`) and decides what a tap means (`onMove`,
// `onPlace`).
//
// Coordinates are [x, y] with x = 0 the left column and y = 0 the TOP row as
// the board is drawn unflipped (for chess: a8 is [0, 0], White at the
// bottom). `flipped` turns the board round for the player on the other side.
//
// Phones first (owner, Sep 28: ~93% of traffic): every interaction is a tap.
// Tap a piece, its targets light up, tap a target. No drag-only moves; the
// whole cell is the hit area; touch-action stops a double tap from zooming.

import { useEffect, useMemo, useState, type ReactNode } from 'react'

export type XY = [number, number]

export type GridGeometry = {
  cell: number
  width: number
  height: number
  /** Centre of board point [x, y] in SVG units, flip applied. */
  cx: (x: number) => number
  cy: (y: number) => number
  flipped: boolean
}

export type GridTheme = { light: string; dark: string; bg: string; line: string; label: string }

const CHESS_THEME: GridTheme = { light: '#efe3cc', dark: '#b58a63', bg: '#e6c48c', line: '#8a6a3d', label: '#7a5c33' }

export default function GridBoard({
  cols, rows, mode, pieces, renderPiece,
  flipped = false, lastMove, alerts, interactive = false,
  movesFrom, onMove, onPlace, colLabels, rowLabels, decorate,
  theme = CHESS_THEME, ariaLabel,
}: {
  cols: number
  rows: number
  /** 'cells': pieces sit IN squares (chess). 'points': ON intersections (五子棋, 象棋). */
  mode: 'cells' | 'points'
  /** pieces[y][x]: a piece code the renderer understands, or null. */
  pieces: (string | null)[][]
  /** Draw one piece centred on (0, 0), `size` = one cell. */
  renderPiece: (code: string, size: number) => ReactNode
  flipped?: boolean
  /** From and to of the last move (one point for a placement game). */
  lastMove?: XY[] | null
  /** Points to mark in red: a king in check, a winning line. */
  alerts?: XY[] | null
  interactive?: boolean
  /** Where the piece on `at` may go, or null when it is not yours to move. */
  movesFrom?: (at: XY) => XY[] | null
  onMove?: (from: XY, to: XY) => void
  /** Placement games: a tap on an empty point. */
  onPlace?: (at: XY) => void
  /** Labels per x and per y, in unflipped order (files a..h, ranks 8..1). */
  colLabels?: string[]
  rowLabels?: string[]
  /** Board furniture drawn under the pieces: star points, river, palaces. */
  decorate?: (g: GridGeometry) => ReactNode
  theme?: GridTheme
  ariaLabel?: (at: XY) => string
}) {
  const CELL = 50
  // Cells: squares edge to edge, labels inside the corner squares.
  // Points: a margin of most of a cell so edge stones fit and labels sit outside.
  const pad = mode === 'cells' ? 0 : CELL * 0.75
  const spanX = mode === 'cells' ? cols * CELL : (cols - 1) * CELL
  const spanY = mode === 'cells' ? rows * CELL : (rows - 1) * CELL
  const width = spanX + pad * 2, height = spanY + pad * 2
  const off = mode === 'cells' ? CELL / 2 : 0
  const geo: GridGeometry = useMemo(() => ({
    cell: CELL, width, height, flipped,
    cx: (x: number) => pad + off + (flipped ? cols - 1 - x : x) * CELL,
    cy: (y: number) => pad + off + (flipped ? rows - 1 - y : y) * CELL,
  }), [width, height, flipped, pad, off, cols, rows])

  const [sel, setSel] = useState<XY | null>(null)
  const [targets, setTargets] = useState<XY[]>([])
  // A new position (the other side moved, or a server view replaced an
  // optimistic one) clears whatever was selected.
  const posKey = pieces.map(r => r.map(p => p ?? '.').join(',')).join('/')
  useEffect(() => { setSel(null); setTargets([]) }, [posKey, interactive])

  const same = (a: XY | null | undefined, b: XY) => !!a && a[0] === b[0] && a[1] === b[1]
  const isTarget = (p: XY) => targets.some(t => same(t, p))

  const tap = (p: XY) => {
    if (!interactive) return
    if (sel && isTarget(p)) {
      const from = sel
      setSel(null); setTargets([])
      onMove?.(from, p)
      return
    }
    const ts = movesFrom?.(p) ?? null
    if (ts && ts.length && !same(sel, p)) {
      // One square per target: a pawn's four promotions all land on one.
      setSel(p); setTargets(ts.filter((t, i) => ts.findIndex(u => same(u, t)) === i))
      return
    }
    setSel(null); setTargets([])
    if (!pieces[p[1]]?.[p[0]] && onPlace) onPlace(p)
  }

  // The last move's piece slides in from where it came from (chess); a
  // placement just appears. The key restarts the animation per move.
  const slide = mode === 'cells' && lastMove && lastMove.length === 2 ? {
    to: lastMove[1],
    dx: geo.cx(lastMove[0][0]) - geo.cx(lastMove[1][0]),
    dy: geo.cy(lastMove[0][1]) - geo.cy(lastMove[1][1]),
    key: `${lastMove[0].join()}-${lastMove[1].join()}`,
  } : null

  const all: XY[] = []
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) all.push([x, y])
  const sq = (p: XY, fill: string, opacity = 1, k = '') => (
    <rect key={`${k}${p[0]}:${p[1]}`} x={geo.cx(p[0]) - CELL / 2} y={geo.cy(p[1]) - CELL / 2}
      width={CELL} height={CELL} fill={fill} opacity={opacity} />
  )

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="group"
      style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 10, touchAction: 'manipulation', userSelect: 'none', WebkitUserSelect: 'none', WebkitTapHighlightColor: 'transparent' }}>
      <style>{`
        @keyframes gb-slide { from { transform: translate(var(--gb-dx), var(--gb-dy)); } to { transform: none; } }
        .gb-slide { animation: gb-slide 220ms ease-out; }
        @media (prefers-reduced-motion: reduce) { .gb-slide { animation: none; } }
      `}</style>
      <defs>
        <radialGradient id="gb-alert">
          <stop offset="0%" stopColor="#ff2a1a" stopOpacity="0.95" />
          <stop offset="45%" stopColor="#e8261a" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#e8261a" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* the board */}
      {mode === 'cells'
        ? all.map(p => sq(p, (p[0] + p[1]) % 2 === 0 ? theme.light : theme.dark, 1, 'c'))
        : (
          <g>
            <rect width={width} height={height} fill={theme.bg} />
            <g stroke={theme.line} strokeWidth={1.4}>
              {Array.from({ length: rows }, (_, y) => (
                <line key={`h${y}`} x1={geo.cx(0)} y1={geo.cy(y)} x2={geo.cx(cols - 1)} y2={geo.cy(y)} />
              ))}
              {Array.from({ length: cols }, (_, x) => (
                <line key={`v${x}`} x1={geo.cx(x)} y1={geo.cy(0)} x2={geo.cx(x)} y2={geo.cy(rows - 1)} />
              ))}
            </g>
          </g>
        )}
      {decorate?.(geo)}

      {/* highlights under the pieces */}
      {mode === 'cells'
        ? (lastMove ?? []).map(p => sq(p, 'rgb(246, 208, 68)', 0.55, 'l'))
        : (lastMove ?? []).map(p => <circle key={`l${p.join()}`} cx={geo.cx(p[0])} cy={geo.cy(p[1])} r={CELL * 0.47} fill="none" stroke="var(--red)" strokeWidth={2.4} />)}
      {sel && (mode === 'cells' ? sq(sel, 'rgb(20, 85, 30)', 0.42, 's') : <circle cx={geo.cx(sel[0])} cy={geo.cy(sel[1])} r={CELL * 0.5} fill="rgb(20, 85, 30)" opacity={0.3} />)}
      {(alerts ?? []).map(p => <circle key={`a${p.join()}`} cx={geo.cx(p[0])} cy={geo.cy(p[1])} r={CELL * 0.5} fill="url(#gb-alert)" />)}

      {/* labels */}
      {mode === 'cells' ? (
        <g fontFamily="var(--font-mono), monospace" fontSize={CELL * 0.22} fontWeight={700}>
          {(rowLabels ?? []).map((lab, y) => {
            const left = flipped ? cols - 1 : 0
            return <text key={`rl${y}`} x={geo.cx(left) - CELL / 2 + 3} y={geo.cy(y) - CELL / 2 + CELL * 0.24}
              fill={(left + y) % 2 === 0 ? theme.dark : theme.light}>{lab}</text>
          })}
          {(colLabels ?? []).map((lab, x) => {
            const bottom = flipped ? 0 : rows - 1
            return <text key={`cl${x}`} x={geo.cx(x) + CELL / 2 - 3} y={geo.cy(bottom) + CELL / 2 - 4} textAnchor="end"
              fill={(x + bottom) % 2 === 0 ? theme.dark : theme.light}>{lab}</text>
          })}
        </g>
      ) : (
        <g fontFamily="var(--font-mono), monospace" fontSize={CELL * 0.26} fill={theme.label} textAnchor="middle">
          {(colLabels ?? []).map((lab, x) => <text key={`cl${x}`} x={geo.cx(x)} y={pad * 0.5}>{lab}</text>)}
          {(rowLabels ?? []).map((lab, y) => <text key={`rl${y}`} x={pad * 0.42} y={geo.cy(y) + CELL * 0.09}>{lab}</text>)}
        </g>
      )}

      {/* pieces */}
      {all.map(p => {
        const code = pieces[p[1]]?.[p[0]]
        if (!code) return null
        const moving = slide && same(slide.to, p)
        return (
          <g key={`p${p[0]}:${p[1]}${moving ? slide!.key : ''}`} transform={`translate(${geo.cx(p[0])} ${geo.cy(p[1])})`} style={{ pointerEvents: 'none' }}>
            {moving
              ? <g className="gb-slide" style={{ ['--gb-dx' as any]: `${slide!.dx}px`, ['--gb-dy' as any]: `${slide!.dy}px` }}>{renderPiece(code, CELL)}</g>
              : renderPiece(code, CELL)}
          </g>
        )
      })}

      {/* legal targets of the selected piece, over the pieces */}
      {targets.map(p => pieces[p[1]]?.[p[0]]
        ? <circle key={`t${p.join()}`} cx={geo.cx(p[0])} cy={geo.cy(p[1])} r={CELL * 0.44} fill="none" stroke="rgba(20, 85, 30, 0.55)" strokeWidth={CELL * 0.08} style={{ pointerEvents: 'none' }} />
        : <circle key={`t${p.join()}`} cx={geo.cx(p[0])} cy={geo.cy(p[1])} r={CELL * 0.15} fill="rgba(20, 85, 30, 0.5)" style={{ pointerEvents: 'none' }} />)}

      {/* hit areas: the whole cell around every point */}
      {interactive && all.map(p => (
        <rect key={`h${p[0]}:${p[1]}`} x={geo.cx(p[0]) - CELL / 2} y={geo.cy(p[1]) - CELL / 2} width={CELL} height={CELL}
          fill="transparent" style={{ cursor: 'pointer' }} role="button" aria-label={ariaLabel?.(p)}
          onClick={() => tap(p)} />
      ))}
    </svg>
  )
}
