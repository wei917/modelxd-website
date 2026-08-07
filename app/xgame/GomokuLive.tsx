'use client'
// app/xgame/GomokuLive.tsx — the gomoku table (CC, Aug 6).
// A screen and an input box, like WerewolfLive: the server holds the game,
// this loops one step at a time and draws whatever comes back. The board
// is SVG — stones, star points, last-move ring, win line — because a game
// deserves to look like one, not like a data grid.

import { useEffect, useRef, useState } from 'react'
import { useT } from '../../lib/i18n'
import { SIZE, COLS } from '../../lib/gomoku-engine'
import ModelSlots from '../xtalk/ModelSlots'
import { DEFAULT_SEAT_OPTS, type SeatOpts } from '../xtalk/SeatConfig'
import type { Speaker } from '../xtalk/templates'

type Move = { n: number; stone: 'B' | 'W'; coord: string; why?: string; fallback?: boolean }
type GameView = {
  id: string; status: 'active' | 'over'; winner: 'black' | 'white' | 'draw' | null
  board: string[]; moves: Move[]; players: any[]; turn: 'B' | 'W' | null
  humanTurn: boolean; winLine: Array<[number, number]> | null; costUsd: number
}

const CELL = 32, PAD = 30
const XY = (i: number) => PAD + i * CELL
const W = PAD * 2 + (SIZE - 1) * CELL

export default function GomokuLive({ models, resumeId, onExit }: {
  models: Speaker[]; resumeId?: string | null; onExit: () => void
}) {
  const t = useT()
  const [g, setG] = useState<GameView | null>(null)
  // The REAL seat machinery — same picker + per-seat thinking config the
  // other tables use, not a bare <select> (owner's correction, Aug 6).
  const [picked, setPicked] = useState<string[]>([])
  const [seatOpts, setSeatOpts] = useState<Record<string, SeatOpts>>({})
  const [playing, setPlaying] = useState(true)   // human takes black
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const loopRef = useRef(false)

  const post = async (body: any): Promise<GameView | null> => {
    try {
      const res = await fetch('/api/xgame/gomoku', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const d = await res.json().catch(() => null)
      if (!res.ok) { setErr(d?.error ?? `HTTP ${res.status}`); return null }
      setErr(null); setG(d); return d
    } catch { setErr('network'); return null }
  }

  // Drive AI turns: one step at a time, strictly sequential, until it's a
  // human's move or the game ends. Ref-guarded so remounts can't double-run.
  const runLoop = async (from: GameView | null) => {
    if (loopRef.current) return
    loopRef.current = true
    let cur = from
    while (cur && cur.status === 'active' && !cur.humanTurn) {
      cur = await post({ action: 'step', id: cur.id })
      if (!cur) break
    }
    loopRef.current = false
  }

  useEffect(() => {
    if (!resumeId) return
    ;(async () => {
      const v = await post({ action: 'state', id: resumeId })
      if (v) void runLoop(v)   // also rescues a game whose loop was orphaned
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeId])

  const start = async () => {
    if (busy) return
    const need = playing ? 1 : 2
    if (picked.filter(Boolean).length < need) return
    setBusy(true)
    const ai = (id: string) => ({ modelId: id, thinking: seatOpts[id]?.thinking ?? null })
    const v = await post({
      action: 'create',
      seats: playing
        ? { black: { human: true }, white: ai(picked[0]) }
        : { black: ai(picked[0]),   white: ai(picked[1]) },
    })
    setBusy(false)
    // Deliberately NOT written into the URL mid-game: Next syncs native
    // history calls into the router, and a PATH change remounts the page —
    // which killed the step loop and blanked the board on the first live
    // game (the /xdirect minted-key lesson, relearned at /xgame). The game
    // is saved regardless; the permalink chip below and the nav history
    // carry the address.
    if (v) void runLoop(v)
  }

  const clickCell = async (r: number, c: number) => {
    if (!g || !g.humanTurn || g.status !== 'active') return
    if (g.board[r][c] !== '.') return
    const v = await post({ action: 'move', id: g.id, coord: `${COLS[c]}${r + 1}` })
    if (v) void runLoop(v)
  }

  // ── setup ──────────────────────────────────────────────────────────────
  if (!g) {
    const need = playing ? 1 : 2
    const ready = picked.filter(Boolean).length >= need
    return (
      <div style={{ marginTop: 18, maxWidth: 720 }}>
        <button
          onClick={() => { setPlaying(p => !p); setPicked([]) }}
          style={{
            padding: '8px 16px', borderRadius: 999, fontSize: 13, cursor: 'pointer',
            border: '1px solid ' + (playing ? 'var(--red)' : 'var(--border2)'),
            background: playing ? 'var(--red-dim)' : 'transparent',
            color: playing ? 'var(--red)' : 'var(--muted)', fontFamily: 'inherit', marginBottom: 14,
          }}
        >⚫ {t('gm.iplay')}</button>
        <div style={{ fontSize: 11, color: 'var(--muted2)', marginBottom: 8, fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.06em' }}>
          {playing ? `⚪ ${t('gm.opponent')}` : '⚫ + ⚪'}
        </div>
        <ModelSlots
          models={models} picked={picked} onPicked={setPicked}
          seatOpts={seatOpts} onSeatOpts={setSeatOpts}
          allowSearch={false} count={need} fixed allowDuplicates
        />
        <button
          onClick={start} disabled={busy || !ready}
          style={{ marginTop: 16, padding: '11px 26px', borderRadius: 10, border: 'none', background: 'var(--red)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: busy ? 'wait' : 'pointer', opacity: (!ready || busy) ? 0.5 : 1 }}
        >{busy ? '…' : t('gm.start')}</button>
        {err && <div style={{ marginTop: 10, color: 'var(--red)', fontSize: 13 }}>⚠ {err}</div>}
      </div>
    )
  }

  // ── live board ─────────────────────────────────────────────────────────
  const last = g.moves.length ? g.moves[g.moves.length - 1] : null
  const winSet = new Set((g.winLine ?? []).map(([r, c]) => `${r}:${c}`))
  const turnP = g.turn ? g.players[g.turn === 'B' ? 0 : 1] : null

  return (
    <div style={{ marginTop: 16, display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <svg viewBox={`0 0 ${W} ${W}`} style={{ width: 'min(520px, 96vw)', height: 'auto', borderRadius: 12, boxShadow: '0 2px 18px rgba(0,0,0,0.12)' }}>
        <defs>
          <radialGradient id="gsB" cx="35%" cy="30%"><stop offset="0%" stopColor="#555"/><stop offset="100%" stopColor="#0a0a0a"/></radialGradient>
          <radialGradient id="gsW" cx="35%" cy="30%"><stop offset="0%" stopColor="#ffffff"/><stop offset="100%" stopColor="#cfcabe"/></radialGradient>
        </defs>
        <rect width={W} height={W} fill="#e6c48c" rx="10" />
        {Array.from({ length: SIZE }, (_, i) => (
          <g key={i} stroke="#8a6a3d" strokeWidth="1">
            <line x1={XY(0)} y1={XY(i)} x2={XY(SIZE - 1)} y2={XY(i)} />
            <line x1={XY(i)} y1={XY(0)} x2={XY(i)} y2={XY(SIZE - 1)} />
          </g>
        ))}
        {[3, 7, 11].flatMap(r => [3, 7, 11].map(c => (
          <circle key={`st${r}${c}`} cx={XY(c)} cy={XY(r)} r="3" fill="#8a6a3d" />
        )))}
        {Array.from({ length: SIZE }, (_, i) => (
          <g key={`lb${i}`} fill="#7a5c33" fontSize="9" fontFamily="var(--font-mono), monospace" textAnchor="middle">
            <text x={XY(i)} y={13}>{COLS[i]}</text>
            <text x={11} y={XY(i) + 3}>{i + 1}</text>
          </g>
        ))}
        {g.board.map((row, r) => row.split('').map((cell, c) => {
          if (cell === '.') {
            return g.humanTurn && g.status === 'active' ? (
              <rect key={`h${r}${c}`} x={XY(c) - CELL / 2} y={XY(r) - CELL / 2} width={CELL} height={CELL}
                fill="transparent" style={{ cursor: 'pointer' }} onClick={() => clickCell(r, c)} />
            ) : null
          }
          const isWin = winSet.has(`${r}:${c}`)
          return (
            <g key={`s${r}${c}`}>
              <circle cx={XY(c)} cy={XY(r)} r={13.5} fill={cell === 'B' ? 'url(#gsB)' : 'url(#gsW)'}
                stroke={isWin ? 'var(--red)' : 'rgba(0,0,0,0.35)'} strokeWidth={isWin ? 2.5 : 0.6} />
            </g>
          )
        }))}
        {last && (() => {
          const pc = [parseInt(last.coord.slice(1), 10) - 1, COLS.indexOf(last.coord[0])]
          return <circle cx={XY(pc[1])} cy={XY(pc[0])} r="5" fill="none" stroke="var(--red)" strokeWidth="1.8" />
        })()}
      </svg>

      <div style={{ flex: '1 1 260px', minWidth: 240, maxWidth: 380 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
          {g.status === 'over'
            ? (g.winner === 'draw' ? t('gm.draw') : `${g.players[g.winner === 'black' ? 0 : 1].name} ${t('gm.win')}`)
            : g.humanTurn ? t('gm.yourclick') : `${turnP?.name ?? ''} ${t('gm.turn')}`}
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted2)', fontFamily: 'var(--font-mono), monospace', marginBottom: 10 }}>
          ⚫ {g.players[0].name} · ⚪ {g.players[1].name} · ${g.costUsd.toFixed(3)}
          {' · '}<a href={`/xgame/${g.id}`} style={{ color: 'var(--muted2)' }}>🔗</a>
        </div>
        <div style={{ maxHeight: 380, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[...g.moves].reverse().map(m => (
            <div key={m.n} style={{ padding: '7px 10px', borderRadius: 9, background: 'var(--surface)', border: '1px solid var(--border)', fontSize: 12.5, lineHeight: 1.5 }}>
              <span style={{ fontFamily: 'var(--font-mono), monospace', fontWeight: 700 }}>
                {m.n}. {m.stone === 'B' ? '⚫' : '⚪'} {m.coord}
              </span>
              {m.fallback && <span title="fallback move" style={{ marginLeft: 6, fontSize: 10, color: 'var(--red)' }}>⚠ auto</span>}
              {m.why && <span style={{ color: 'var(--muted2)' }}> — {m.why}</span>}
            </div>
          ))}
        </div>
        {err && <div style={{ marginTop: 10, color: 'var(--red)', fontSize: 13 }}>⚠ {err}</div>}
        <button onClick={onExit} style={{ marginTop: 14, background: 'none', border: '1px solid var(--border2)', borderRadius: 9, padding: '7px 16px', fontSize: 12, color: 'var(--muted)', cursor: 'pointer' }}>
          ← {t('gm.newgame')}
        </button>
      </div>
    </div>
  )
}
