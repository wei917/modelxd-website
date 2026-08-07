'use client'
// app/xgame/GomokuLive.tsx — the gomoku table (CC, Aug 6).
// A screen and an input box, like WerewolfLive: the server holds the game,
// this loops one step at a time and draws whatever comes back. The board
// is SVG — stones, star points, last-move ring, win line — because a game
// deserves to look like one, not like a data grid.

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '../../lib/i18n'
import { SIZE, COLS } from '../../lib/gomoku-engine'
import ModelPickerDialog from '../components/ModelPickerDialog'
import SeatSlot, { type SeatAssign } from './SeatSlot'
import type { SeatOpts } from '../xtalk/SeatConfig'
import type { Speaker } from '../xtalk/templates'

type Move = { n: number; stone: 'B' | 'W'; coord: string; why?: string; fallback?: boolean; ms?: number }
type GameView = {
  id: string; status: 'active' | 'over'; winner: 'black' | 'white' | 'draw' | null
  board: string[]; moves: Move[]; players: any[]; turn: 'B' | 'W' | null
  humanTurn: boolean; winLine: Array<[number, number]> | null
  // null while a blind duel is anonymous — price is identity's loudest hint.
  costUsd: number | null
  duel?: { anon: boolean; revealed: boolean; thumbs: Record<string, { up: boolean; blind?: boolean }> } | null
}

const CELL = 32, PAD = 30
const XY = (i: number) => PAD + i * CELL
const W = PAD * 2 + (SIZE - 1) * CELL

export default function GomokuLive({ models, resumeId, onExit }: {
  models: Speaker[]; resumeId?: string | null; onExit: () => void
}) {
  const t = useT()
  const router = useRouter()
  const [g, setG] = useState<GameView | null>(null)
  // Two seats ARE the interface (owner's layout, Aug 6): click a seat,
  // assign Me / a random model / a picked model. Play-vs-watch is emergent
  // from the assignments, and the same pattern scales to chess and mahjong.
  const [seats, setSeats] = useState<{ B: SeatAssign; W: SeatAssign }>({ B: null, W: null })
  const [pickerFor, setPickerFor] = useState<'B' | 'W' | null>(null)
  const [seatOpts, setSeatOpts] = useState<Record<string, SeatOpts>>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // Hover target for the ghost stone. The site hides the native cursor
  // (GlobalCursor), so without this preview the user aims at a 32px
  // intersection blind — the root of "I click and nothing happens".
  const [hover, setHover] = useState<[number, number] | null>(null)
  // Live clock: ms since the current turn began, ticking every second while
  // the game is active. Resets whenever the turn (move count) changes.
  const [tick, setTick] = useState(0)
  const turnStartRef = useRef(Date.now())
  useEffect(() => {
    turnStartRef.current = Date.now()
    setTick(0)
    if (!g || g.status !== 'active') return
    const iv = setInterval(() => setTick(Date.now() - turnStartRef.current), 1000)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g?.moves.length, g?.status])
  const loopRef = useRef(false)

  // Every request carries a timeout: a dev-server reload (or any dropped
  // connection) can sever an in-flight fetch, and an await that never
  // resolves left loopRef locked forever — the watchdog then refused to
  // rescue ("a loop is running") and the game wedged. Steps get 90s (a
  // deep-thinking model is slow); everything else 15s.
  const post = async (body: any): Promise<GameView | null> => {
    const ctl = new AbortController()
    const tm = setTimeout(() => ctl.abort(), body.action === 'step' ? 90_000 : 15_000)
    try {
      const res = await fetch('/api/xgame/gomoku', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: ctl.signal,
      })
      const d = await res.json().catch(() => null)
      if (!res.ok) { setErr(d?.error ?? `HTTP ${res.status}`); return null }
      setErr(null)
      // MONOTONIC: a response may arrive out of order (a watchdog state
      // fetch racing the move POST it was guarding). Never let an older
      // snapshot erase newer moves — that was the "my stone appeared and
      // then vanished" report, twice.
      setG(prev => (!prev || prev.id !== d.id || (d.moves?.length ?? 0) >= (prev.moves?.length ?? 0)) ? d : prev)
      return d
    } catch { setErr(null); return null }   // timeout/abort: quiet — the watchdog takes it from here
    finally { clearTimeout(tm) }
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

  // WATCHDOG (CC, Aug 6): the server said "AI's turn" while no client loop
  // was running — a game wedged this way in the wild (an HMR remount raced
  // a stale state fetch against an in-flight human move; a dropped network
  // response does the same). Whatever kills the loop, this restarts it:
  // every few seconds, if it's an AI's turn and nothing is stepping, fetch
  // fresh state and drive on. No-ops entirely while the loop is alive.
  useEffect(() => {
    if (!g || g.status !== 'active' || g.humanTurn) return
    const id = g.id
    const iv = setInterval(() => {
      if (loopRef.current) return
      void post({ action: 'state', id }).then(v => { if (v) void runLoop(v) })
    }, 4000)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g?.id, g?.status, g?.humanTurn])

  const start = async () => {
    if (busy || !seats.B || !seats.W) return
    setBusy(true)
    const enc = (a: SeatAssign) => a === 'me'
      ? { human: true }
      : { modelId: (a as any).modelId, thinking: seatOpts[(a as any).modelId]?.thinking ?? null }
    const v = await post({ action: 'create', seats: { black: enc(seats.B), white: enc(seats.W) } })
    setBusy(false)
    // Start = leave the lobby for the table. This is ROUTER navigation at a
    // deliberate boundary, not a history rewrite mid-play (that earlier bug
    // was a replaceState DURING the game): the game page mounts fresh with
    // resumeId, restores state, and drives the loop itself.
    if (v) router.push(`/xgame/${v.id}`)
  }

  // Blind-duel controls. Thumbs toggle (clicking the selected one clears
  // it); the reveal is one-way. Both are plain posts — the server's view
  // comes back unmasked after the reveal and setG does the rest.
  const thumb = (seat: 0 | 1, up: boolean) => {
    if (!g) return
    const cur = g.duel?.thumbs?.[seat]?.up
    void post({ action: 'duel_thumb', id: g.id, seat, up: cur === up ? null : up })
  }
  const reveal = () => { if (g) void post({ action: 'duel_reveal', id: g.id }) }
  // A duel came from XDuel; hand the player back there. A lobby game goes
  // back to the lobby.
  const exit = () => { if (g?.duel) router.push('/xduel'); else onExit() }

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
    const ready = !!seats.B && !!seats.W
    const assign = (side: 'B' | 'W') => (a: SeatAssign) => {
      setSeats(prev => {
        const other = side === 'B' ? 'W' : 'B'
        const next = { ...prev, [side]: a }
        // Only one human at the table: taking a seat vacates the other.
        if (a === 'me' && prev[other] === 'me') (next as any)[other] = null
        return next
      })
    }
    return (
      <div style={{ marginTop: 18, maxWidth: 720 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <SeatSlot icon="⚫" assign={seats.B} models={models} seatOpts={seatOpts} onSeatOpts={setSeatOpts} onAssign={assign('B')} onOpenPicker={() => setPickerFor('B')} />
          <SeatSlot icon="⚪" assign={seats.W} models={models} seatOpts={seatOpts} onSeatOpts={setSeatOpts} onAssign={assign('W')} onOpenPicker={() => setPickerFor('W')} />
        </div>
        {pickerFor && (
          <ModelPickerDialog
            mode="text" recipeMode="text_to_text"
            slotIds={[]}
            onClose={() => setPickerFor(null)}
            onSelect={(m: any) => { setSeats(prev => ({ ...prev, [pickerFor]: { modelId: m.id, name: m.display_name } })); setPickerFor(null) }}
          />
        )}
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

  // Seat arrangement (owner, Aug 6): the table reads vertically like every
  // board app — your opponent across the board (top), you at the bottom.
  // Watching AI vs AI seats white across and black near.
  const meIdx = g.players.findIndex((p: any) => p.isHuman)
  const bottomIdx = (meIdx >= 0 ? meIdx : 0) as 0 | 1
  const topIdx = (bottomIdx === 0 ? 1 : 0) as 0 | 1
  const fmtClock = (ms: number) => {
    const sTot = Math.floor(ms / 1000)
    return `${Math.floor(sTot / 60)}:${String(sTot % 60).padStart(2, '0')}`
  }
  const seatCard = (i: 0 | 1) => {
    const p: any = g.players[i]
    const stone = i === 0 ? 'B' : 'W'
    const activeSeat = g.status === 'active' && g.turn === stone
    const used = g.moves.filter(m => m.stone === stone).reduce((sum, m) => sum + (m.ms ?? 0), 0)
      + (activeSeat ? tick : 0)
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
        borderRadius: 10, width: '100%',
        border: '1.5px solid ' + (activeSeat ? 'var(--red)' : 'var(--border)'),
        background: activeSeat ? 'var(--red-dim)' : 'var(--surface)',
      }}>
        <span style={{ fontSize: 18 }} aria-hidden>{i === 0 ? '⚫' : '⚪'}</span>
        <span style={{ fontSize: 13.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {p.name}
          {p.thinking && (
            <span title={t('xcreate.thinking')} style={{ marginLeft: 7, fontSize: 10.5, fontFamily: 'var(--font-mono), monospace', fontWeight: 700, color: 'var(--red)', border: '1px solid var(--red-dim)', background: 'var(--red-dim)', borderRadius: 6, padding: '1px 6px', verticalAlign: 'middle' }}>
              {p.thinking}
            </span>
          )}
        </span>
        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono), monospace', color: activeSeat ? 'var(--red)' : 'var(--muted2)', fontWeight: 700, flexShrink: 0 }}>
          {fmtClock(used)}
        </span>
        {activeSeat && <span className="nav-history-spin" aria-hidden style={{ flexShrink: 0 }} />}
      </div>
    )
  }

  return (
    <div style={{ marginTop: 16, display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: 'min(520px, 96vw)', position: 'relative' }}>
        {seatCard(topIdx)}
        {/* The win is an EVENT — but never a curtain: the whole point of
            winning is SEEING the final position and the highlighted five.
            A banner above the board, the board untouched. (owner, Aug 6,
            two iterations: whisper → curtain → banner) */}
        {g.status === 'over' && (
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 18px',
            borderRadius: 12, border: '1.5px solid var(--red)', background: 'var(--red-dim)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ fontSize: 30 }} aria-hidden>
                {g.winner === 'draw' ? '🤝' : g.winner === 'black' ? '⚫' : '⚪'}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 20, fontWeight: 900, fontFamily: 'var(--font-display), inherit' }}>
                  {g.winner === 'draw' ? t('gm.draw') : `${g.players[g.winner === 'black' ? 0 : 1].name} ${t('gm.win')}`}
                </span>
                <span style={{ fontSize: 11, color: 'var(--muted2)', fontFamily: 'var(--font-mono), monospace' }}>
                  {g.moves.length} moves{g.costUsd != null ? ` · $${g.costUsd.toFixed(3)}` : ''}
                </span>
              </span>
              {g.duel && !g.duel.revealed ? (
                <button onClick={reveal} style={{ padding: '9px 20px', borderRadius: 999, border: 'none', background: 'var(--red)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', flexShrink: 0 }}>
                  🎭 {t('gd.reveal')}
                </button>
              ) : (
                <button onClick={exit} style={{ padding: '9px 20px', borderRadius: 999, border: 'none', background: 'var(--red)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', flexShrink: 0 }}>
                  {t('gm.newgame')}
                </button>
              )}
            </div>
            {/* Judging is a duel thing: the engine already named the winner,
                the thumbs rate the PLAY — and thumbs cast before the reveal
                are flagged blind server-side, the cleaner signal. */}
            {g.duel && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', fontSize: 12 }}>
                <span style={{ color: 'var(--muted)', fontWeight: 700 }}>{t('gd.rate')}</span>
                {([0, 1] as const).map(seat => (
                  <span key={seat} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <span aria-hidden>{seat === 0 ? '⚫' : '⚪'}</span>
                    {([true, false] as const).map(up => {
                      const sel = g.duel?.thumbs?.[seat]?.up === up
                      return (
                        <button key={String(up)} onClick={() => thumb(seat, up)} style={{
                          padding: '3px 9px', borderRadius: 999, fontSize: 13, cursor: 'pointer',
                          border: '1px solid ' + (sel ? 'var(--red)' : 'var(--border2)'),
                          background: sel ? 'var(--red)' : 'var(--surface)',
                        }}>{up ? '👍' : '👎'}</button>
                      )
                    })}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      <svg viewBox={`0 0 ${W} ${W}`} style={{ width: '100%', height: 'auto', borderRadius: 12, boxShadow: '0 2px 18px rgba(0,0,0,0.12)' }}>
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
        {seatCard(bottomIdx)}
      </div>

      <div style={{ flex: '1 1 260px', minWidth: 240, maxWidth: 380 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
          {g.status === 'over'
            ? (g.winner === 'draw' ? t('gm.draw') : `${g.players[g.winner === 'black' ? 0 : 1].name} ${t('gm.win')}`)
            : g.humanTurn ? t('gm.yourclick') : `${turnP?.name ?? ''} ${t('gm.turn')}`}
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted2)', fontFamily: 'var(--font-mono), monospace', marginBottom: 10 }}>
          {g.costUsd != null ? `$${g.costUsd.toFixed(3)}` : '🎭'}
        </div>
        <div style={{ maxHeight: 380, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[...g.moves].reverse().map(m => (
            <div key={m.n} style={{ padding: '7px 10px', borderRadius: 9, background: 'var(--surface)', border: '1px solid var(--border)', fontSize: 12.5, lineHeight: 1.5 }}>
              <span style={{ fontFamily: 'var(--font-mono), monospace', fontWeight: 700 }}>
                {m.n}. {m.stone === 'B' ? '⚫' : '⚪'} {m.coord}
              </span>
              {m.ms != null && (
                <span style={{ float: 'right', fontSize: 10.5, fontFamily: 'var(--font-mono), monospace', color: 'var(--muted2)' }}>
                  {(m.ms / 1000).toFixed(1)}s
                </span>
              )}
              {m.fallback && <span title="fallback move" style={{ marginLeft: 6, fontSize: 10, color: 'var(--red)' }}>⚠ auto</span>}
              {m.why && <span style={{ color: 'var(--muted2)' }}> — {m.why}</span>}
            </div>
          ))}
        </div>
        {err && <div style={{ marginTop: 10, color: 'var(--red)', fontSize: 13 }}>⚠ {err}</div>}
        <button onClick={exit} style={{ marginTop: 14, background: 'none', border: '1px solid var(--border2)', borderRadius: 9, padding: '7px 16px', fontSize: 12, color: 'var(--muted)', cursor: 'pointer' }}>
          ← {t('gm.newgame')}
        </button>
      </div>
    </div>
  )
}
