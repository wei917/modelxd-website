'use client'
// app/xgame/GomokuLive.tsx — the 五子棋 table (Aug 6; rebuilt Oct 20 on the
// shared GridBoard, owner: "go ahead on this plan"). The server holds the
// game (/api/xgame/gomoku); this loops one step at a time and draws whatever
// comes back.
//
// What the rebuild changed on the table:
//   • The board is GridBoard's points mode, so chess, 五子棋 and 象棋 look
//     like one family. Phones first: on a touch screen the first tap shows
//     the stone, a second tap on the same point places it (a 15×15 board is
//     ~22 px a point on a phone); a mouse places on the first click.
//   • A table is a two-game match, colours swapped (lib/gomoku-match.ts).
//     Between the games: the result, then game 2 by button when you play,
//     on its own after a few seconds when the models play each other.
//   • Viewer marks (lib/gomoku-engine.ts threats()): where a side would make
//     five or an open four. Drawn only while AI plays AI, never sent to a
//     model, and off when a person is seated (they would be a hint).
//   • The rules every model plays under are published under the board.
//
// Rows from before the rebuild (no match) still open as the single game
// they were, blind duels with their thumbs and reveal.

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '../../lib/i18n'
import { SIZE, COLS, threats, type Threat } from '../../lib/gomoku-engine'
import { GOMOKU_HARNESS, type GameResult, type MatchState } from '../../lib/gomoku-match'
import ModelPickerDialog from '../components/ModelPickerDialog'
import GridBoard, { type XY, type GridGeometry } from './GridBoard'
import SeatSlot, { type SeatAssign } from './SeatSlot'
import { isEligible } from '../../lib/xgame-speed'
import type { SeatOpts } from '../xtalk/SeatConfig'
import type { Speaker } from '../xtalk/templates'

type Stone = 'B' | 'W'
type Move = {
  n: number; stone: Stone; coord: string; g?: 1 | 2
  why?: string; fallback?: boolean; retried?: boolean; timedOut?: boolean; ms?: number; cost?: number
}
type GameView = {
  id: string; status: 'active' | 'over'; winner: string | null
  board: string[]; moves: Move[]; players: any[]; turn: Stone | null
  humanTurn: boolean; winLine: Array<[number, number]> | null
  // null while a blind duel is anonymous — price is identity's loudest hint.
  costUsd: number | null
  duel?: { anon: boolean; revealed: boolean; thumbs: Record<string, { up: boolean; blind?: boolean }> } | null
  match: (MatchState & { score: [number, number] }) | null
}

/** The order two views of one game came in: more moves, or the same moves
 *  and a later game of the match (the 'next' step adds no move). */
const rank = (v: GameView) => (v.moves?.length ?? 0) * 4 + (v.match?.game ?? 1)

const coordOf = (r: number, c: number) => `${COLS[c]}${r + 1}`
const fmtScore = (n: number) => n % 1 ? `${Math.floor(n) || ''}½` : String(n)
const fmtClock = (ms: number) => {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export default function GomokuLive({ models, resumeId, onExit }: {
  models: Speaker[]; resumeId?: string | null; onExit: () => void
}) {
  const t = useT()
  const router = useRouter()
  const [g, setG] = useState<GameView | null>(null)
  // Two seats ARE the interface (owner's layout, Aug 6). Seat 0 (⚫) plays
  // Black in game 1, seat 1 (⚪) in game 2.
  const [seats, setSeats] = useState<{ B: SeatAssign; W: SeatAssign }>({ B: null, W: null })
  const [pickerFor, setPickerFor] = useState<'B' | 'W' | null>(null)
  const [seatOpts, setSeatOpts] = useState<Record<string, SeatOpts>>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // Touch screens: the first tap shows the stone here, the second places it.
  const [ghost, setGhost] = useState<[number, number] | null>(null)
  const [touch, setTouch] = useState(false)
  useEffect(() => { setTouch(!window.matchMedia('(hover: hover) and (pointer: fine)').matches) }, [])
  // Live clock: ms since the current turn began, ticking every second.
  const [tick, setTick] = useState(0)
  const turnStartRef = useRef(Date.now())
  useEffect(() => {
    turnStartRef.current = Date.now()
    setTick(0)
    setGhost(null)
    if (!g || g.status !== 'active') return
    const iv = setInterval(() => setTick(Date.now() - turnStartRef.current), 1000)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g?.moves.length, g?.status, g?.match?.game])
  const loopRef = useRef(false)

  // Every request carries a timeout: a dropped connection must not leave the
  // loop locked forever. A step is up to two 90 s asks, so 210 s.
  const post = async (body: any): Promise<GameView | null> => {
    const ctl = new AbortController()
    const tm = setTimeout(() => ctl.abort(), body.action === 'step' ? 210_000 : 15_000)
    try {
      const res = await fetch('/api/xgame/gomoku', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: ctl.signal,
      })
      const d = await res.json().catch(() => null)
      if (!res.ok) { setErr(d?.error ?? `HTTP ${res.status}`); return null }
      setErr(null)
      // MONOTONIC: a response may arrive out of order (a watchdog state
      // fetch racing the move it was guarding). Never let an older snapshot
      // erase newer moves.
      setG(prev => (!prev || prev.id !== d.id || rank(d) >= rank(prev)) ? d : prev)
      return d
    } catch { setErr(null); return null }   // timeout/abort: the watchdog takes it from here
    finally { clearTimeout(tm) }
  }

  // Drive AI turns one step at a time until it is a person's move, the gap
  // between the two games, or the end. Ref-guarded so remounts can't double-run.
  const runLoop = async (from: GameView | null) => {
    if (loopRef.current) return
    loopRef.current = true
    let cur = from
    while (cur && cur.status === 'active' && !cur.humanTurn && !cur.match?.between) {
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

  // WATCHDOG (Aug 6): the server says "AI's turn" while no loop runs (a
  // remount, a dropped response). Every few seconds, if it's an AI's turn
  // and nothing is stepping, fetch fresh state and drive on.
  useEffect(() => {
    if (!g || g.status !== 'active' || g.humanTurn || g.match?.between) return
    const id = g.id
    const iv = setInterval(() => {
      if (loopRef.current) return
      void post({ action: 'state', id }).then(v => { if (v) void runLoop(v) })
    }, 4000)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g?.id, g?.status, g?.humanTurn, g?.match?.between])

  // Between the two games: a person starts game 2 with the button; when the
  // models play each other it starts on its own after a short pause, so the
  // final position of game 1 can be seen.
  const human = !!g?.players.some((p: any) => p.isHuman)
  const between = !!g && g.status === 'active' && !!g.match?.between
  const [countdown, setCountdown] = useState<number | null>(null)
  const nextGame = async () => {
    if (!g) return
    setCountdown(null)
    const v = await post({ action: 'next', id: g.id })
    if (v) void runLoop(v)
  }
  useEffect(() => {
    if (!between || human) { setCountdown(null); return }
    let left = 5
    setCountdown(left)
    const iv = setInterval(() => {
      left -= 1
      if (left <= 0) { clearInterval(iv); void nextGame() } else setCountdown(left)
    }, 1000)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [between, human, g?.id])

  const start = async () => {
    if (busy || !seats.B || !seats.W) return
    setBusy(true)
    const enc = (a: SeatAssign) => a === 'me'
      ? { human: true }
      : { modelId: (a as any).modelId, thinking: seatOpts[(a as any).modelId]?.thinking ?? null }
    const v = await post({ action: 'create', seats: { black: enc(seats.B), white: enc(seats.W) } })
    setBusy(false)
    // Start = leave the lobby for the table: the game page mounts fresh with
    // resumeId, restores state, and drives the loop itself.
    if (v) router.push(`/xgame/${v.id}`)
  }

  // Blind-duel controls (rows from before XDuel's redesign).
  const thumb = (seat: 0 | 1, up: boolean) => {
    if (!g) return
    const cur = g.duel?.thumbs?.[seat]?.up
    void post({ action: 'duel_thumb', id: g.id, seat, up: cur === up ? null : up })
  }
  const exit = () => { if (g?.duel) router.push('/xduel'); else onExit() }

  const placeAt = async (r: number, c: number) => {
    if (!g || !g.humanTurn || g.status !== 'active') return
    if (g.board[r][c] !== '.') return
    if (touch && !(ghost && ghost[0] === r && ghost[1] === c)) { setGhost([r, c]); return }
    const stone = g.turn as Stone
    const id = g.id
    setGhost(null)
    // OPTIMISTIC: the stone lands at once; the server's view replaces this
    // one on response, and an error resyncs from state.
    setG(prev => prev ? {
      ...prev,
      board: prev.board.map((row, ri) => ri === r ? row.slice(0, c) + stone + row.slice(c + 1) : row),
      humanTurn: false,
      moves: [...prev.moves, { n: prev.moves.filter(m => (m.g ?? 1) === (prev.match?.game ?? 1)).length + 1, stone, coord: coordOf(r, c), ...(prev.match ? { g: prev.match.game } : {}) }],
    } : prev)
    const v = await post({ action: 'move', id, coord: coordOf(r, c) })
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
        // Only one person at the table: taking a seat vacates the other.
        if (a === 'me' && prev[other] === 'me') (next as any)[other] = null
        return next
      })
    }
    return (
      <div style={{ marginTop: 18, maxWidth: 720 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <SeatSlot icon="⚫" game="gomoku" assign={seats.B} models={models} seatOpts={seatOpts} onSeatOpts={setSeatOpts} onAssign={assign('B')} onOpenPicker={() => setPickerFor('B')} />
          <SeatSlot icon="⚪" game="gomoku" assign={seats.W} models={models} seatOpts={seatOpts} onSeatOpts={setSeatOpts} onAssign={assign('W')} onOpenPicker={() => setPickerFor('W')} />
        </div>
        {pickerFor && (
          <ModelPickerDialog
            mode="text" recipeMode="text_to_text"
            slotIds={[]}
            allow={(m: any) => isEligible('gomoku', m)}
            onClose={() => setPickerFor(null)}
            onSelect={(m: any) => { setSeats(prev => ({ ...prev, [pickerFor]: { modelId: m.id, name: m.display_name } })); setPickerFor(null) }}
          />
        )}
        <p style={{ margin: '12px 0 0', fontSize: 12.5, color: 'var(--muted2)', lineHeight: 1.6 }}>{t('gk.match.note')}</p>
        <button
          onClick={start} disabled={busy || !ready}
          style={{ marginTop: 14, padding: '11px 26px', borderRadius: 10, border: 'none', background: 'var(--red)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: busy ? 'wait' : 'pointer', opacity: (!ready || busy) ? 0.5 : 1 }}
        >{busy ? '…' : t('gm.start')}</button>
        {err && <div style={{ marginTop: 10, color: 'var(--red)', fontSize: 13 }}>⚠ {err}</div>}
        <HarnessNote />
      </div>
    )
  }

  // ── live board ─────────────────────────────────────────────────────────
  const m = g.match
  const game = m?.game ?? 1
  const inGame = (mv: Move) => (mv.g ?? 1) === game
  const lastMove = [...g.moves].reverse().find(inGame) ?? null
  const turnP = g.turn ? g.players.find((p: any) => p.stone === g.turn) : null
  const meIdx = g.players.findIndex((p: any) => p.isHuman)
  // Your opponent across the board (top), you at the bottom. Watching AI vs
  // AI: seat 1 across, seat 0 near.
  const bottomIdx = (meIdx >= 0 ? meIdx : 0) as 0 | 1
  const topIdx = (bottomIdx === 0 ? 1 : 0) as 0 | 1
  const nameOf = (i: 0 | 1) => {
    const p: any = g.players[i]
    return p?.isHuman ? t('ch.you') : (p?.name ?? '')
  }

  const showMarks = g.status === 'active' && !between && !human && !g.duel
  const marks: Threat[] = showMarks ? threats(g.board) : []

  // pieces[y][x]: 'B'/'W', a trailing '*' on the last stone. The touch
  // preview is drawn by decorate(), so its point stays empty for the board
  // (GridBoard only calls onPlace on an empty point).
  const pieces: (string | null)[][] = g.board.map((row, r) => row.split('').map((cell, c) => {
    if (cell === '.') return null
    return lastMove && lastMove.coord === coordOf(r, c) ? `${cell}*` : cell
  }))

  const renderStone = (code: string, size: number) => {
    return (
      <g>
        <circle r={size * 0.45} fill={code[0] === 'B' ? 'url(#gk-b)' : 'url(#gk-w)'} stroke="rgba(0,0,0,0.38)" strokeWidth={size * 0.02} />
        {code.endsWith('*') && <circle r={size * 0.11} fill="var(--red)" />}
      </g>
    )
  }

  const decorate = (geo: GridGeometry) => {
    const byPoint = new Map<string, { at: [number, number]; win: boolean; stones: Stone[] }>()
    for (const th of marks) {
      const k = th.at.join(':')
      const e = byPoint.get(k) ?? { at: th.at, win: false, stones: [] }
      e.win = e.win || th.kind === 'win'
      if (!e.stones.includes(th.stone)) e.stones.push(th.stone)
      byPoint.set(k, e)
    }
    return (
      <g>
        <defs>
          <radialGradient id="gk-b" cx="35%" cy="30%"><stop offset="0%" stopColor="#555" /><stop offset="100%" stopColor="#0a0a0a" /></radialGradient>
          <radialGradient id="gk-w" cx="35%" cy="30%"><stop offset="0%" stopColor="#ffffff" /><stop offset="100%" stopColor="#cfcabe" /></radialGradient>
        </defs>
        {[3, 7, 11].flatMap(y => [3, 7, 11].map(x => (
          <circle key={`st${x}:${y}`} cx={geo.cx(x)} cy={geo.cy(y)} r={geo.cell * 0.09} fill="#8a6a3d" />
        )))}
        {ghost && g.turn && g.board[ghost[0]]?.[ghost[1]] === '.' && (
          <circle cx={geo.cx(ghost[1])} cy={geo.cy(ghost[0])} r={geo.cell * 0.45} opacity={0.5}
            fill={g.turn === 'B' ? 'url(#gk-b)' : 'url(#gk-w)'} stroke="rgba(0,0,0,0.38)" strokeWidth={geo.cell * 0.02} />
        )}
        {[...byPoint.values()].map(e => {
          const x = e.at[1], y = e.at[0]
          const ring = e.win ? '#e8261a' : '#f08c00'
          return (
            <g key={`mk${x}:${y}`} transform={`translate(${geo.cx(x)} ${geo.cy(y)})`}>
              <circle r={geo.cell * 0.34} fill="none" stroke={ring} strokeWidth={geo.cell * 0.075} />
              {e.stones.map((st, i) => (
                <circle key={st} cx={e.stones.length > 1 ? (i === 0 ? -1 : 1) * geo.cell * 0.11 : 0} r={geo.cell * 0.1}
                  fill={st === 'B' ? '#111' : '#fff'} stroke="rgba(0,0,0,0.5)" strokeWidth={geo.cell * 0.02} />
              ))}
            </g>
          )
        })}
      </g>
    )
  }

  const gameResultLine = (r: GameResult, n: number) => {
    const head = t('gk.gamelabel').replace('{n}', String(n))
    const plies = t('gk.plies').replace('{n}', String(r.plies))
    if (r.winner === null) return `${head} · ${t('gk.draw')} (${t(`gk.end.${r.reason}`)}) · ${plies}`
    return `${head} · ${r.winner === r.black ? '⚫' : '⚪'} ${t('gk.won').replace('{name}', nameOf(r.winner))} · ${plies}`
  }

  const matchTitle = () => {
    if (!m) return null
    const [a, b] = m.score
    const score = `${fmtScore(a)}–${fmtScore(b)}`
    if (g.winner === 'draw') return t('gk.matchdraw').replace('{score}', score)
    const w = g.winner === 'seat1' ? 1 : 0
    const sc = w === 0 ? score : `${fmtScore(b)}–${fmtScore(a)}`
    return g.players[w]?.isHuman
      ? t('gk.youwinmatch').replace('{score}', sc)
      : t('gk.matchwin').replace('{name}', nameOf(w as 0 | 1)).replace('{score}', sc)
  }

  // Rows from before the match format: one game, black/white/draw.
  const legacyWinner = () => {
    if (g.winner === 'draw') return t('gm.draw')
    const p: any = g.players[g.winner === 'black' ? 0 : 1]
    return p?.isHuman ? t('gm.youwin') : `${p?.name ?? ''} ${t('gm.win')}`
  }

  const seatCard = (i: 0 | 1) => {
    const p: any = g.players[i]
    const stone: Stone = p.stone
    const activeSeat = g.status === 'active' && !between && g.turn === stone
    const mine = g.moves.filter(mv => inGame(mv) && mv.stone === stone)
    const used = mine.reduce((sum, mv) => sum + (mv.ms ?? 0), 0) + (activeSeat ? tick : 0)
    // What THIS seat has spent over the whole match. Move costs are
    // server-stripped while a duel is anonymous.
    const spend = g.moves.filter(mv => {
      const blackSeat = m ? ((mv.g ?? 1) === 1 ? 0 : 1) : 0
      const seatOfMove = mv.stone === 'B' ? blackSeat : 1 - blackSeat
      return seatOfMove === i
    }).reduce((sum, mv) => sum + (mv.cost ?? 0), 0)
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
        borderRadius: 10, width: '100%', boxSizing: 'border-box',
        border: '1.5px solid ' + (activeSeat ? 'var(--red)' : 'var(--border)'),
        background: activeSeat ? 'var(--red-dim)' : 'var(--surface)',
      }}>
        <span style={{ fontSize: 18 }} aria-hidden>{stone === 'B' ? '⚫' : '⚪'}</span>
        <span style={{ fontSize: 13.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
          {nameOf(i)}
          {p.thinking && (
            <span title={t('xcreate.thinking')} style={{ marginLeft: 7, fontSize: 10.5, fontFamily: 'var(--font-mono), monospace', fontWeight: 700, color: 'var(--red)', border: '1px solid var(--red-dim)', background: 'var(--red-dim)', borderRadius: 6, padding: '1px 6px', verticalAlign: 'middle' }}>
              {p.thinking}
            </span>
          )}
        </span>
        {m && (
          <span style={{ fontSize: 15, fontWeight: 900, fontFamily: 'var(--font-mono), monospace', flexShrink: 0 }}>{fmtScore(m.score[i])}</span>
        )}
        {spend > 0 && (
          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono), monospace', color: 'var(--muted2)', flexShrink: 0 }}>${spend.toFixed(3)}</span>
        )}
        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono), monospace', color: activeSeat ? 'var(--red)' : 'var(--muted2)', fontWeight: 700, flexShrink: 0 }}>
          {fmtClock(used)}
        </span>
        {activeSeat && <span className="nav-history-spin" aria-hidden style={{ flexShrink: 0 }} />}
      </div>
    )
  }

  const statusLine = g.status === 'over'
    ? (m ? matchTitle() : legacyWinner())
    : between ? gameResultLine(m!.games[0], 1)
    : g.humanTurn ? (touch && ghost ? t('gk.tapagain') : t('gk.yourmove'))
    : `${turnP?.isHuman ? t('ch.you') : (turnP?.name ?? '')} ${t('gm.turn')}`

  // The record, newest first, in one block per game.
  const gamesShown: number[] = m ? (m.game === 2 ? [2, 1] : [1]) : [1]

  return (
    <div style={{ marginTop: 16, display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 560 }}>
        {m && g.status === 'active' && (
          <div style={{ fontSize: 12, fontFamily: 'var(--font-mono), monospace', color: 'var(--muted)', fontWeight: 700, letterSpacing: '.04em' }}>
            {t('gk.game').replace('{n}', String(game))}
          </div>
        )}
        {seatCard(topIdx)}

        {/* Between the games: game 1's result over its final position, then game 2. */}
        {between && m && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 16px', borderRadius: 12, border: '1.5px solid var(--red)', background: 'var(--red-dim)' }}>
            <div style={{ fontSize: 15, fontWeight: 800 }}>{gameResultLine(m.games[0], 1)}</div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{t('gk.swap').replace('{name}', nameOf(1))}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button onClick={nextGame} style={{ padding: '8px 18px', borderRadius: 999, border: 'none', background: 'var(--red)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                {t('gk.next')}
              </button>
              {countdown != null && (
                <span style={{ fontSize: 12, color: 'var(--muted2)', fontFamily: 'var(--font-mono), monospace' }}>{t('gk.next.auto').replace('{s}', String(countdown))}</span>
              )}
            </div>
          </div>
        )}

        {/* The end is an EVENT, never a curtain: the final position stays in view (owner, Aug 6). */}
        {g.status === 'over' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 18px', borderRadius: 12, border: '1.5px solid var(--red)', background: 'var(--red-dim)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 19, fontWeight: 900, fontFamily: 'var(--font-display), inherit' }}>
                  {m ? matchTitle() : legacyWinner()}
                </span>
                <span style={{ fontSize: 11, color: 'var(--muted2)', fontFamily: 'var(--font-mono), monospace' }}>
                  {g.costUsd != null ? `$${g.costUsd.toFixed(3)}` : ''}
                </span>
              </span>
              <button onClick={exit} style={{ padding: '9px 20px', borderRadius: 999, border: 'none', background: 'var(--red)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', flexShrink: 0 }}>
                {t('gm.newgame')}
              </button>
            </div>
            {m && m.games.map((r, k) => (
              <div key={k} style={{ fontSize: 12.5, color: 'var(--muted)' }}>{gameResultLine(r, k + 1)}</div>
            ))}
          </div>
        )}

        {/* Judging is a duel thing, its OWN box (owner, Aug 6). */}
        {g.status === 'over' && g.duel && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', fontSize: 12, padding: '11px 18px', borderRadius: 12, border: '1.5px solid var(--border)', background: 'var(--surface)' }}>
            <span style={{ color: 'var(--muted)', fontWeight: 700 }}>{t('gd.rate')}</span>
            {([0, 1] as const).filter(seat => !g.players[seat]?.isHuman).map(seat => (
              <span key={seat} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span aria-hidden>{seat === 0 ? '⚫' : '⚪'}</span>
                {g.duel?.revealed && (
                  <span style={{ fontWeight: 700, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.players[seat]?.name}</span>
                )}
                {([true, false] as const).map(up => {
                  const sel = g.duel?.thumbs?.[seat]?.up === up
                  return (
                    <button key={String(up)} onClick={() => thumb(seat, up)} style={{
                      padding: '3px 9px', borderRadius: 999, fontSize: 13, cursor: 'pointer',
                      border: '1px solid ' + (sel ? 'var(--red)' : 'var(--border2)'),
                      background: sel ? 'var(--red)' : 'var(--surface2)',
                    }}>{up ? '👍' : '👎'}</button>
                  )
                })}
              </span>
            ))}
          </div>
        )}

        <div style={{ borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 18px rgba(0,0,0,0.12)' }}>
          <GridBoard
            cols={SIZE} rows={SIZE} mode="points"
            pieces={pieces} renderPiece={renderStone}
            alerts={(g.winLine ?? []).map(([r, c]) => [c, r] as XY)}
            interactive={g.humanTurn && g.status === 'active'}
            onPlace={([x, y]) => { void placeAt(y, x) }}
            colLabels={COLS.split('')}
            rowLabels={Array.from({ length: SIZE }, (_, i) => String(i + 1))}
            decorate={decorate}
            ariaLabel={([x, y]) => coordOf(y, x)}
          />
        </div>
        {seatCard(bottomIdx)}
        {showMarks && (
          <p style={{ margin: 0, fontSize: 11.5, color: 'var(--muted2)', lineHeight: 1.55 }}>{t('gk.marks')}</p>
        )}
      </div>

      <div style={{ flex: '1 1 260px', minWidth: 0, maxWidth: 400, width: '100%' }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>{statusLine}</div>
        <div style={{ fontSize: 11, color: 'var(--muted2)', fontFamily: 'var(--font-mono), monospace', marginBottom: 10 }}>
          {g.costUsd != null ? `$${g.costUsd.toFixed(3)}` : '🎭'}
        </div>
        <div style={{ maxHeight: 420, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {gamesShown.map(n => {
            const block = g.moves.filter(mv => (mv.g ?? 1) === n).reverse()
            return (
              <div key={n} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {m && (
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', fontFamily: 'var(--font-mono), monospace', marginTop: n === gamesShown[0] ? 0 : 6 }}>
                    {t('gk.gamelabel').replace('{n}', String(n))}
                  </div>
                )}
                {block.map(mv => (
                  <div key={`${n}-${mv.n}`} style={{ padding: '7px 10px', borderRadius: 9, background: 'var(--surface)', border: '1px solid var(--border)', fontSize: 12.5, lineHeight: 1.5 }}>
                    <span style={{ fontFamily: 'var(--font-mono), monospace', fontWeight: 700 }}>
                      {mv.n}. {mv.stone === 'B' ? '⚫' : '⚪'} {mv.coord}
                    </span>
                    {mv.ms != null && (
                      <span style={{ float: 'right', fontSize: 10.5, fontFamily: 'var(--font-mono), monospace', color: 'var(--muted2)' }}>{(mv.ms / 1000).toFixed(1)}s</span>
                    )}
                    {mv.fallback && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--red)' }}>⚠ {t('ch.auto')}</span>}
                    {!mv.fallback && mv.retried && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--muted2)' }}>↻ {t('ch.retry')}</span>}
                    {mv.why && <span style={{ color: 'var(--muted2)' }}> — {mv.why}</span>}
                  </div>
                ))}
              </div>
            )
          })}
        </div>
        {err && <div style={{ marginTop: 10, color: 'var(--red)', fontSize: 13 }}>⚠ {err}</div>}
        <button onClick={exit} style={{ marginTop: 14, background: 'none', border: '1px solid var(--border2)', borderRadius: 9, padding: '7px 16px', fontSize: 12, color: 'var(--muted)', cursor: 'pointer' }}>
          ← {t('gm.newgame')}
        </button>
        {m && <HarnessNote />}
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
        {t('gk.harness.body').replace('{sec}', String(GOMOKU_HARNESS.timeoutSec)).replace('{cap}', String(GOMOKU_HARNESS.plyCap))}
      </p>
    </details>
  )
}
