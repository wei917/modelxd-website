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
  // 'black' | 'white' | 'watch' — black opens (gomoku rule, as in Go); a
  // human on white answers the AI's opening. 'watch' is AI vs AI.
  const [seat, setSeat] = useState<'black' | 'white' | 'watch'>('black')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // Hover target for the ghost stone. The site hides the native cursor
  // (GlobalCursor), so without this preview the user aims at a 32px
  // intersection blind — the root of "I click and nothing happens".
  const [hover, setHover] = useState<[number, number] | null>(null)
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
    const need = seat === 'watch' ? 2 : 1
    if (picked.filter(Boolean).length < need) return
    setBusy(true)
    const ai = (id: string) => ({ modelId: id, thinking: seatOpts[id]?.thinking ?? null })
    const seats =
      seat === 'black' ? { black: { human: true }, white: ai(picked[0]) } :
      seat === 'white' ? { black: ai(picked[0]),   white: { human: true } } :
                         { black: ai(picked[0]),   white: ai(picked[1]) }
    const v = await post({ action: 'create', seats })
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
    const stone = g.turn as 'B' | 'W'
    const id = g.id
    setHover(null)
    // OPTIMISTIC: the stone lands the instant you click — the half-second
    // server round-trip with zero feedback is what read as "nothing
    // happened" and invited double clicks. The server stays the truth: its
    // view replaces this one on response, and an error resyncs from state.
    setG(prev => prev ? {
      ...prev,
      board: prev.board.map((row, ri) => ri === r ? row.slice(0, c) + stone + row.slice(c + 1) : row),
      humanTurn: false,
      moves: [...prev.moves, { n: prev.moves.length + 1, stone, coord: `${COLS[c]}${r + 1}` }],
    } : prev)
    const v = await post({ action: 'move', id, coord: `${COLS[c]}${r + 1}` })
    if (v) { void runLoop(v); return }
    const fresh = await post({ action: 'state', id })   // revert/resync
    if (fresh) void runLoop(fresh)
  }

  // ── setup ──────────────────────────────────────────────────────────────
  if (!g) {
    const need = seat === 'watch' ? 2 : 1
    const ready = picked.filter(Boolean).length >= need
    const chip = (k: 'black' | 'white' | 'watch', label: string) => (
      <button
        key={k} onClick={() => { setSeat(k); setPicked([]) }}
        style={{
          padding: '8px 16px', borderRadius: 999, fontSize: 13, cursor: 'pointer',
          border: '1px solid ' + (seat === k ? 'var(--red)' : 'var(--border2)'),
          background: seat === k ? 'var(--red-dim)' : 'transparent',
          color: seat === k ? 'var(--red)' : 'var(--muted)', fontFamily: 'inherit',
        }}
      >{label}</button>
    )
    return (
      <div style={{ marginTop: 18, maxWidth: 720 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          {chip('black', `⚫ ${t('gm.playblack')}`)}
          {chip('white', `⚪ ${t('gm.playwhite')}`)}
          {chip('watch', `⚔ ${t('gm.watch')}`)}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--muted2)', fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.06em' }}>
            {seat === 'black' ? `⚪ ${t('gm.opponent')}` : seat === 'white' ? `⚫ ${t('gm.opponent')}` : '⚫ + ⚪'}
          </span>
          <button
            onClick={() => {
              const pool = models.filter((m: any) => m.id)
              if (pool.length === 0) return
              const empty = picked.filter(Boolean).length
              if (empty >= need) return
              const pick: any = pool[Math.floor(Math.random() * pool.length)]
              setPicked([...picked.filter(Boolean), pick.id])
            }}
            title={t('gm.random')}
            style={{ background: 'none', border: '1px solid var(--border2)', borderRadius: 999, padding: '4px 12px', fontSize: 12, color: 'var(--muted)', cursor: 'pointer', fontFamily: 'inherit' }}
          >🎲 {t('gm.random')}</button>
        </div>
        <ModelSlots
          models={models} picked={picked} onPicked={setPicked}
          seatOpts={seatOpts} onSeatOpts={setSeatOpts}
          allowSearch={false} count={need} fixed allowDuplicates
        />
        {/* Thinking level, ALWAYS VISIBLE once a model is seated. The shared
            slot row hides this behind a 24px gear, and the owner could not
            find it twice — that is the design failing, not the user. The
            gear still works; these pills are the front door. (CC, Aug 6) */}
        {picked.filter(Boolean).map(id => {
          const m: any = models.find((x: any) => x.id === id)
          const levels: string[] = m?.output_config?.text?.thinking_levels ?? []
          if (!m || levels.length === 0) return null
          const cur = seatOpts[id]?.thinking ?? null
          const setLv = (lv: string | null) =>
            setSeatOpts({ ...seatOpts, [id]: { ...(seatOpts[id] ?? DEFAULT_SEAT_OPTS), thinking: lv } })
          return (
            <div key={id} style={{ marginTop: 12 }}>
              <div style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 9, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 5 }}>
                {m.display_name} · {t('xcreate.thinking')}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {[null, ...levels].map(lv => {
                  const on = cur === lv
                  return (
                    <button
                      key={lv ?? 'auto'} type="button" onClick={() => setLv(lv)}
                      style={{
                        padding: '3px 10px', borderRadius: 7, fontSize: 11, fontFamily: 'inherit',
                        border: '1px solid ' + (on ? 'var(--red)' : 'var(--border2)'),
                        background: on ? 'var(--red-dim)' : 'var(--surface)',
                        color: on ? 'var(--red)' : 'var(--muted2)', fontWeight: on ? 700 : 400,
                        cursor: 'pointer',
                      }}
                    >{lv ?? t('gm.auto')}</button>
                  )
                })}
              </div>
            </div>
          )
        })}
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
                fill="transparent" style={{ cursor: 'pointer' }}
                onClick={() => clickCell(r, c)}
                onMouseEnter={() => setHover([r, c])}
                onMouseLeave={() => setHover(h => h && h[0] === r && h[1] === c ? null : h)} />
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
        {/* Ghost stone: where the click will snap. */}
        {hover && g.humanTurn && g.status === 'active' && g.board[hover[0]][hover[1]] === '.' && (
          <circle cx={XY(hover[1])} cy={XY(hover[0])} r={13.5}
            fill={g.turn === 'B' ? 'url(#gsB)' : 'url(#gsW)'} opacity={0.45}
            style={{ pointerEvents: 'none' }} />
        )}
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
