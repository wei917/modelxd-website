'use client'
// app/xgame/ChessLive.tsx — the chess table (Oct 19). GomokuLive's shape: the
// server holds the game (/api/xgame/chess), this loops one step at a time
// and draws what comes back. No rules code here: the view carries the FEN,
// the human's legal moves (UCI) and the result. The board is the shared
// GridBoard; the pieces are Cburnett's set (BSD 3-clause, see
// public/xgame/chess/LICENSE.txt), drawn as images because Unicode chess
// glyphs turn into emoji on some phones.

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '../../lib/i18n'
import { parseFen, squareName, squareXY, kingSquare, FILES, CHESS_HARNESS, type Color } from '../../lib/chess-board'
import ModelPickerDialog from '../components/ModelPickerDialog'
import SeatSlot, { type SeatAssign } from './SeatSlot'
import GridBoard, { type XY } from './GridBoard'
import type { SeatOpts } from '../xtalk/SeatConfig'
import type { Speaker } from '../xtalk/templates'

type Move = {
  n: number; color: Color; san: string; uci: string
  why?: string; fallback?: boolean; retried?: boolean; rejected?: string[]; timedOut?: boolean
  cost?: number; ms?: number
}
type Player = { color: Color; name: string; isHuman: boolean; thinking?: string | null }
type GameView = {
  id: string; status: 'active' | 'over'; winner: 'white' | 'black' | 'draw' | null
  end: { reason: string; winner: string } | null
  fen: string; turn: Color | null; check: boolean; legal: string[]
  moves: Move[]; players: Player[]; humanTurn: boolean; costUsd: number
}

const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1']
const pieceImg = (code: string) => `/xgame/chess/${code}.svg`
const renderPiece = (code: string, size: number) => (
  <image href={pieceImg(code)} x={-size / 2} y={-size / 2} width={size} height={size} />
)
const King = ({ color, size = 22 }: { color: Color; size?: number }) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img src={pieceImg(`${color}K`)} width={size} height={size} alt="" aria-hidden style={{ display: 'block', flexShrink: 0 }} />
)

/** The position after a move the server has not confirmed yet: enough to
 *  draw it (castling's rook, en passant's pawn, promotion), never to judge
 *  it. The server's view replaces it a moment later. */
function previewGrid(fen: string, uci: string) {
  const grid = parseFen(fen).grid.map(r => r.slice())
  const a = squareXY(uci.slice(0, 2)), b = squareXY(uci.slice(2, 4))
  if (!a || !b) return grid
  const p = grid[a[1]][a[0]]
  if (!p) return grid
  if (p[1] === 'P' && a[0] !== b[0] && !grid[b[1]][b[0]]) grid[a[1]][b[0]] = null      // en passant
  if (p[1] === 'K' && Math.abs(a[0] - b[0]) === 2) {                                   // castling
    const rookFrom = b[0] > a[0] ? 7 : 0, rookTo = b[0] > a[0] ? 5 : 3
    grid[a[1]][rookTo] = grid[a[1]][rookFrom]; grid[a[1]][rookFrom] = null
  }
  grid[b[1]][b[0]] = uci[4] ? p[0] + uci[4].toUpperCase() : p
  grid[a[1]][a[0]] = null
  return grid
}

export default function ChessLive({ models, resumeId, onExit }: {
  models: Speaker[]; resumeId?: string | null; onExit: () => void
}) {
  const t = useT()
  const router = useRouter()
  const [g, setG] = useState<GameView | null>(null)
  const [seats, setSeats] = useState<{ w: SeatAssign; b: SeatAssign }>({ w: null, b: null })
  const [pickerFor, setPickerFor] = useState<Color | null>(null)
  const [seatOpts, setSeatOpts] = useState<Record<string, SeatOpts>>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // Out of credits (402): the watchdog stops retrying until a step succeeds.
  const [broke, setBroke] = useState(false)
  // A move sent but not yet confirmed: drawn at once (a phone tap with no
  // feedback for half a second reads as "nothing happened").
  const [pending, setPending] = useState<string | null>(null)
  // A pawn reached the last rank: which piece? (from, to)
  const [promo, setPromo] = useState<[string, string] | null>(null)
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

  // Every request carries a timeout (GomokuLive's lesson: a severed fetch
  // left the loop locked forever). A step may hold two 90 s asks.
  const post = async (body: any): Promise<GameView | null> => {
    const ctl = new AbortController()
    const tm = setTimeout(() => ctl.abort(), body.action === 'step' ? 210_000 : 15_000)
    try {
      const res = await fetch('/api/xgame/chess', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: ctl.signal,
      })
      const d = await res.json().catch(() => null)
      if (!res.ok) { setErr(d?.error ?? `HTTP ${res.status}`); if (res.status === 402) setBroke(true); return null }
      setErr(null); setBroke(false)
      // MONOTONIC: an older snapshot never erases newer moves, and a game
      // that ended (a resignation adds no move) never comes back to life.
      setG(prev => {
        if (!prev || prev.id !== d.id) return d
        const n = d.moves?.length ?? 0, m = prev.moves?.length ?? 0
        if (n > m) return d
        if (n === m && !(prev.status === 'over' && d.status === 'active')) return d
        return prev
      })
      return d
    } catch { return null }
    finally { clearTimeout(tm) }
  }

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
      if (v) void runLoop(v)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeId])

  // WATCHDOG (as in GomokuLive): an AI's turn with no loop running restarts
  // the loop. Paused while out of credits: the error stays on screen.
  useEffect(() => {
    if (!g || g.status !== 'active' || g.humanTurn || broke) return
    const id = g.id
    const iv = setInterval(() => {
      if (loopRef.current) return
      void post({ action: 'state', id }).then(v => { if (v) void runLoop(v) })
    }, 5000)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g?.id, g?.status, g?.humanTurn, broke])

  const start = async () => {
    if (busy || !seats.w || !seats.b) return
    setBusy(true)
    const enc = (a: SeatAssign) => a === 'me'
      ? { human: true }
      : { modelId: (a as any).modelId, thinking: seatOpts[(a as any).modelId]?.thinking ?? null }
    const v = await post({ action: 'create', seats: { white: enc(seats.w), black: enc(seats.b) } })
    setBusy(false)
    if (v) router.push(`/xgame/${v.id}`)
  }

  const send = async (uci: string) => {
    if (!g) return
    const id = g.id
    setPending(uci)
    const v = await post({ action: 'move', id, uci })
    setPending(null)
    if (v) { void runLoop(v); return }
    const fresh = await post({ action: 'state', id })
    if (fresh) void runLoop(fresh)
  }

  const resign = async () => {
    if (!g || !window.confirm(t('ch.resign.confirm'))) return
    await post({ action: 'resign', id: g.id })
  }

  // ── setup ──────────────────────────────────────────────────────────────
  if (!g) {
    const ready = !!seats.w && !!seats.b
    const assign = (side: Color) => (a: SeatAssign) => {
      setSeats(prev => {
        const other: Color = side === 'w' ? 'b' : 'w'
        const next = { ...prev, [side]: a }
        if (a === 'me' && prev[other] === 'me') (next as any)[other] = null
        return next
      })
    }
    return (
      <div style={{ marginTop: 18, maxWidth: 720 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <SeatSlot icon={<King color="w" size={26} />} assign={seats.w} models={models} seatOpts={seatOpts} onSeatOpts={setSeatOpts} onAssign={assign('w')} onOpenPicker={() => setPickerFor('w')} />
          <SeatSlot icon={<King color="b" size={26} />} assign={seats.b} models={models} seatOpts={seatOpts} onSeatOpts={setSeatOpts} onAssign={assign('b')} onOpenPicker={() => setPickerFor('b')} />
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
        <HarnessNote />
      </div>
    )
  }

  // ── live board ─────────────────────────────────────────────────────────
  const meIdx = g.players.findIndex(p => p.isHuman)
  const flipped = meIdx === 1
  const bottomIdx = (meIdx >= 0 ? meIdx : 0) as 0 | 1
  const topIdx = (bottomIdx === 0 ? 1 : 0) as 0 | 1
  const last = g.moves.length ? g.moves[g.moves.length - 1] : null
  const shownUci = pending ?? last?.uci ?? null
  const grid = pending ? previewGrid(g.fen, pending) : parseFen(g.fen).grid
  const lastXY = shownUci ? [squareXY(shownUci.slice(0, 2)), squareXY(shownUci.slice(2, 4))].filter(Boolean) as XY[] : null
  // The side to move comes from the FEN, not g.turn: a mated king stays lit
  // after the game ends (turn is null then).
  const checkXY = !pending && g.check ? kingSquare(g.fen, parseFen(g.fen).turn) : null
  const canMove = g.status === 'active' && g.humanTurn && !pending && !promo

  const movesFrom = (at: XY): XY[] | null => {
    const from = squareName(at[0], at[1])
    const ts = g.legal.filter(m => m.startsWith(from)).map(m => squareXY(m.slice(2, 4))).filter(Boolean) as XY[]
    return ts.length ? ts : null
  }
  const onMove = (a: XY, b: XY) => {
    const base = squareName(a[0], a[1]) + squareName(b[0], b[1])
    const options = g.legal.filter(m => m.startsWith(base))
    if (options.length > 1) { setPromo([base.slice(0, 2), base.slice(2)]); return }
    if (options.length === 1) void send(options[0])
  }

  const fmtClock = (ms: number) => {
    const sTot = Math.floor(ms / 1000)
    return `${Math.floor(sTot / 60)}:${String(sTot % 60).padStart(2, '0')}`
  }
  const winnerLabel = () => {
    if (g.winner === 'draw' || !g.winner) return t('ch.draw')
    const p = g.players[g.winner === 'white' ? 0 : 1]
    return p.isHuman ? t('gm.youwin') : `${p.name} ${t('gm.win')}`
  }
  const reasonLabel = g.end ? t(`ch.end.${g.end.reason}`) : ''

  const seatCard = (i: 0 | 1) => {
    const p = g.players[i]
    const color: Color = i === 0 ? 'w' : 'b'
    const mine = g.moves.filter(m => m.color === color)
    const activeSeat = g.status === 'active' && g.turn === color
    const used = mine.reduce((sum, m) => sum + (m.ms ?? 0), 0) + (activeSeat ? tick : 0)
    const spend = mine.reduce((sum, m) => sum + (m.cost ?? 0), 0)
    const autos = mine.filter(m => m.fallback).length
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 9, padding: '9px 12px',
        borderRadius: 10, width: '100%', boxSizing: 'border-box',
        border: '1.5px solid ' + (activeSeat ? 'var(--red)' : 'var(--border)'),
        background: activeSeat ? 'var(--red-dim)' : 'var(--surface)',
      }}>
        <King color={color} />
        <span style={{ fontSize: 13.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
          {p.isHuman ? t('ch.you') : p.name}
          {p.thinking && (
            <span title={t('xcreate.thinking')} style={{ marginLeft: 7, fontSize: 10.5, fontFamily: 'var(--font-mono), monospace', fontWeight: 700, color: 'var(--red)', border: '1px solid var(--red-dim)', background: 'var(--red-dim)', borderRadius: 6, padding: '1px 6px', verticalAlign: 'middle' }}>
              {p.thinking}
            </span>
          )}
        </span>
        {autos > 0 && (
          <span title={t('ch.auto')} style={{ fontSize: 11, fontFamily: 'var(--font-mono), monospace', color: 'var(--red)', fontWeight: 700, flexShrink: 0 }}>⚠ {autos}</span>
        )}
        {spend > 0 && (
          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono), monospace', color: 'var(--muted2)', flexShrink: 0 }}>${spend.toFixed(3)}</span>
        )}
        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono), monospace', color: activeSeat ? 'var(--red)' : 'var(--muted2)', fontWeight: 700, flexShrink: 0 }}>
          {fmtClock(used)}
        </span>
        {activeSeat && !p.isHuman && <span className="nav-history-spin" aria-hidden style={{ flexShrink: 0 }} />}
      </div>
    )
  }

  const humanColor: Color = meIdx === 1 ? 'b' : 'w'

  return (
    <div style={{ marginTop: 16, display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: 'min(520px, 100%)', position: 'relative' }}>
        {seatCard(topIdx)}
        {g.status === 'over' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, border: '1.5px solid var(--red)', background: 'var(--red-dim)' }}>
            {g.winner === 'white' || g.winner === 'black'
              ? <King color={g.winner === 'white' ? 'w' : 'b'} size={34} />
              : <span style={{ fontSize: 28 }} aria-hidden>🤝</span>}
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 19, fontWeight: 900, fontFamily: 'var(--font-display), inherit' }}>{winnerLabel()}</span>
              <span style={{ fontSize: 11, color: 'var(--muted2)', fontFamily: 'var(--font-mono), monospace' }}>
                {reasonLabel} · {t('ch.moves').replace('{n}', String(Math.ceil(g.moves.length / 2)))} · ${g.costUsd.toFixed(3)}
              </span>
            </span>
            <button onClick={onExit} style={{ padding: '9px 16px', borderRadius: 999, border: 'none', background: 'var(--red)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', flexShrink: 0 }}>
              {t('gm.newgame')}
            </button>
          </div>
        )}
        <div style={{ position: 'relative', borderRadius: 10, boxShadow: '0 2px 18px rgba(0,0,0,0.12)' }}>
          <GridBoard
            cols={8} rows={8} mode="cells"
            pieces={grid} renderPiece={renderPiece}
            flipped={flipped}
            lastMove={lastXY}
            alerts={checkXY ? [checkXY] : null}
            interactive={canMove}
            movesFrom={movesFrom} onMove={onMove}
            colLabels={FILES.split('')} rowLabels={RANKS}
            ariaLabel={([x, y]) => squareName(x, y)}
          />
          {promo && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(253,253,251,0.72)', borderRadius: 10 }}>
              <div style={{ background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 14, padding: '12px 14px', boxShadow: '0 8px 30px rgba(0,0,0,0.16)', textAlign: 'center' }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{t('ch.promote')}</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['q', 'r', 'b', 'n'] as const).map(k => (
                    <button key={k} onClick={() => { const m = promo[0] + promo[1] + k; setPromo(null); void send(m) }}
                      style={{ width: 58, height: 58, borderRadius: 10, border: '1px solid var(--border2)', background: 'var(--surface)', cursor: 'pointer', padding: 4 }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={pieceImg(humanColor + k.toUpperCase())} alt={k.toUpperCase()} width={48} height={48} style={{ display: 'block' }} />
                    </button>
                  ))}
                </div>
                <button onClick={() => setPromo(null)} style={{ marginTop: 8, background: 'none', border: 'none', color: 'var(--muted)', fontSize: 12, cursor: 'pointer' }}>{t('ch.cancel')}</button>
              </div>
            </div>
          )}
        </div>
        {seatCard(bottomIdx)}
      </div>

      <div style={{ flex: '1 1 260px', minWidth: 0, maxWidth: 420, width: '100%' }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {g.status === 'over'
            ? `${winnerLabel()} · ${reasonLabel}`
            : g.humanTurn ? t('ch.yourmove') : `${g.players[g.turn === 'b' ? 1 : 0]?.name ?? ''} ${t('gm.turn')}`}
          {g.status === 'active' && g.check && (
            <span style={{ fontSize: 11, fontWeight: 800, color: '#fff', background: 'var(--red)', borderRadius: 6, padding: '2px 7px' }}>{t('ch.check')}</span>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted2)', fontFamily: 'var(--font-mono), monospace', marginBottom: 10 }}>
          ${g.costUsd.toFixed(3)}
        </div>
        <div style={{ maxHeight: 380, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[...g.moves].reverse().map(m => (
            <div key={m.n} style={{ padding: '7px 10px', borderRadius: 9, background: 'var(--surface)', border: '1px solid var(--border)', fontSize: 12.5, lineHeight: 1.5 }}>
              <span style={{ fontFamily: 'var(--font-mono), monospace', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 5, verticalAlign: 'middle' }}>
                {Math.ceil(m.n / 2)}{m.color === 'w' ? '.' : '…'} <King color={m.color} size={15} /> {m.san}
              </span>
              {m.ms != null && (
                <span style={{ float: 'right', fontSize: 10.5, fontFamily: 'var(--font-mono), monospace', color: 'var(--muted2)' }}>
                  {(m.ms / 1000).toFixed(1)}s
                </span>
              )}
              {m.fallback && <span title={t('ch.auto')} style={{ marginLeft: 6, fontSize: 10, color: 'var(--red)', fontWeight: 700 }}>⚠ {t('ch.auto')}</span>}
              {!m.fallback && m.retried && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--muted2)' }}>↻ {t('ch.retry')}</span>}
              {m.why && <span style={{ color: 'var(--muted2)' }}> — {m.why}</span>}
            </div>
          ))}
        </div>
        {err && <div style={{ marginTop: 10, color: 'var(--red)', fontSize: 13 }}>⚠ {err}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <button onClick={onExit} style={{ background: 'none', border: '1px solid var(--border2)', borderRadius: 9, padding: '7px 16px', fontSize: 12, color: 'var(--muted)', cursor: 'pointer' }}>
            ← {t('gm.newgame')}
          </button>
          {g.status === 'active' && meIdx >= 0 && (
            <button onClick={resign} style={{ background: 'none', border: '1px solid var(--border2)', borderRadius: 9, padding: '7px 16px', fontSize: 12, color: 'var(--red)', cursor: 'pointer' }}>
              {t('ch.resign')}
            </button>
          )}
        </div>
        <HarnessNote />
      </div>
    </div>
  )
}

/** The rules every model plays under, said on the table (the fairness rule:
 *  the harness changes results, so it is published). */
function HarnessNote() {
  const t = useT()
  return (
    <details style={{ marginTop: 16, fontSize: 12.5, color: 'var(--muted2)', lineHeight: 1.6 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 700, color: 'var(--muted)' }}>{t('ch.harness.title')}</summary>
      <p style={{ margin: '6px 0 0' }}>
        {t('ch.harness.body').replace('{sec}', String(CHESS_HARNESS.timeoutSec)).replace('{cap}', String(CHESS_HARNESS.plyCap / 2))}
      </p>
    </details>
  )
}
