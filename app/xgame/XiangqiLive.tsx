'use client'
// app/xgame/XiangqiLive.tsx — the 象棋 table (Oct 20). ChessLive's shape:
// the server holds the game (/api/xgame/xiangqi), this loops one step at a
// time and draws what comes back. No rules code here: the view carries the
// FEN, the person's legal moves and the result.
//
// The board is the shared GridBoard in points mode, 9 × 10, with the river
// (楚河 漢界, the inner files broken across it) and the two palaces drawn by
// decorate(). The pieces are our own discs with their characters, red and
// black as on a real set (帥仕相傌俥炮兵 / 將士象馬車砲卒; simplified in
// zh-Hans). Moves are named the Chinese way (炮二平五) with WXF beside it.
// Phones first: tap a piece, its points light up, tap one.
//
// Two people (Oct 21), as the chess table: 「邀請朋友」, the link, clocks and
// the Realtime ping (app/xgame/DuoParts.tsx); the page steps the game only
// while a MODEL is to move (`aiTurn`).

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLang, useT } from '../../lib/i18n'
import {
  parseFen, squareName, squareXY, splitMove, generalSquare, pieceChar, isRed,
  wxfToChinese, XIANGQI_HARNESS, type Side,
} from '../../lib/xiangqi-board'
import ModelPickerDialog from '../components/ModelPickerDialog'
import SeatSlot, { type SeatAssign } from './SeatSlot'
import { isEligible } from '../../lib/xgame-speed'
import GridBoard, { type XY, type GridGeometry } from './GridBoard'
import type { SeatOpts } from '../xtalk/SeatConfig'
import type { Speaker } from '../xtalk/templates'
import { ClockText, Face, InvitePanel, JoinPanel, useDuoClock, useJoinToken, useTablePings, type ViewClock } from './DuoParts'

type Move = {
  n: number; side: Side; uci: string; wxf: string
  why?: string; fallback?: boolean; retried?: boolean; rejected?: string[]; timedOut?: boolean
  cost?: number; ms?: number
}
type Player = { side: Side; name: string; isHuman: boolean; thinking?: string | null; handle?: string | null; avatar?: string | null; invited?: boolean }
type GameView = {
  id: string; status: 'active' | 'over'; winner: 'red' | 'black' | 'draw' | null
  end: { reason: string; winner: string } | null
  fen: string; turn: Side | null; check: boolean; legal: string[]
  moves: Move[]; players: Player[]; humanTurn: boolean; costUsd: number
  aiTurn: boolean; me: 0 | 1 | null; isHost: boolean
  lobby: { open: number[]; token?: string } | null; canJoin: boolean; clock: ViewClock | null
}

const BOARD_THEME = { light: '#efe3cc', dark: '#b58a63', bg: '#e9c992', line: '#7a5530', label: '#7a5530' }
const RED = '#c0392b', INK = '#1d1b19'

/** One piece: an ivory disc, a ring and its character in red or black. */
function Disc({ code, size, lang }: { code: string; size: number; lang: string }) {
  const red = isRed(code)
  return (
    <g>
      <circle r={size * 0.45} fill="#f7ead0" stroke={red ? RED : INK} strokeWidth={size * 0.045} />
      <circle r={size * 0.37} fill="none" stroke={red ? RED : INK} strokeWidth={size * 0.02} opacity={0.75} />
      <text textAnchor="middle" dominantBaseline="central" y={size * 0.02}
        fontSize={size * 0.46} fontWeight={700} fill={red ? RED : INK}
        style={{ fontFamily: "var(--font-zh), 'Noto Sans TC', 'PingFang TC', sans-serif" }}>
        {pieceChar(code, lang)}
      </text>
    </g>
  )
}

/** The seat's mark: its general, as a small disc. */
function General({ side, lang, size = 24 }: { side: Side; lang: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`} aria-hidden style={{ display: 'block', flexShrink: 0 }}>
      <Disc code={side === 'w' ? 'K' : 'k'} size={size} lang={lang} />
    </svg>
  )
}

const RED_NUMS = ['一', '二', '三', '四', '五', '六', '七', '八', '九']

/** The river, its words, the palaces and the file numbers, under the
 *  pieces. The inner files stop at the river as on a printed board; the two
 *  edge files cross it. Each side's files are numbered from its own right,
 *  on its own edge: Red 九…一, Black 1…9, the numbers in its move names
 *  (炮二平五, 馬８進７). No a-i / 1-10 here: those are the models'
 *  coordinates, and the corner pieces covered them. */
function decorateBoard(geo: GridGeometry, lang: string) {
  const x0 = geo.cx(0), x8 = geo.cx(8)
  const yTop = Math.min(geo.cy(4), geo.cy(5)), yBot = Math.max(geo.cy(4), geo.cy(5))
  const left = Math.min(x0, x8), right = Math.max(x0, x8)
  const line = (a: XY, b: XY, k: string) => (
    <line key={k} x1={geo.cx(a[0])} y1={geo.cy(a[1])} x2={geo.cx(b[0])} y2={geo.cy(b[1])} stroke={BOARD_THEME.line} strokeWidth={1.4} />
  )
  const words = lang === 'zh-Hans' ? ['楚 河', '汉 界'] : ['楚 河', '漢 界']
  return (
    <g>
      <rect x={left + 0.8} y={yTop + 0.8} width={right - left - 1.6} height={yBot - yTop - 1.6} fill={BOARD_THEME.bg} />
      <text x={left + (right - left) * 0.25} y={(yTop + yBot) / 2} textAnchor="middle" dominantBaseline="central"
        fontSize={geo.cell * 0.42} fill={BOARD_THEME.line} opacity={0.8} style={{ fontFamily: "var(--font-zh), serif", letterSpacing: '.2em' }}>{words[0]}</text>
      <text x={left + (right - left) * 0.75} y={(yTop + yBot) / 2} textAnchor="middle" dominantBaseline="central"
        fontSize={geo.cell * 0.42} fill={BOARD_THEME.line} opacity={0.8} style={{ fontFamily: "var(--font-zh), serif", letterSpacing: '.2em' }}>{words[1]}</text>
      {/* the palaces: an X across d-f, ranks 1-3 and 8-10 */}
      {line([3, 7], [5, 9], 'p1')}{line([5, 7], [3, 9], 'p2')}
      {line([3, 0], [5, 2], 'p3')}{line([5, 0], [3, 2], 'p4')}
      {Array.from({ length: 9 }, (_, x) => {
        const out = geo.cy(9) > geo.cy(0) ? 1 : -1
        return (
          <g key={`n${x}`} fontSize={geo.cell * 0.24} textAnchor="middle" dominantBaseline="central" fontWeight={700}
            style={{ fontFamily: "var(--font-zh), sans-serif" }}>
            <text x={geo.cx(x)} y={geo.cy(9) + out * geo.cell * 0.6} fill={RED}>{RED_NUMS[8 - x]}</text>
            <text x={geo.cx(x)} y={geo.cy(0) - out * geo.cell * 0.6} fill={INK}>{x + 1}</text>
          </g>
        )
      })}
    </g>
  )
}

/** The position after a move the server has not confirmed yet. */
function previewGrid(fen: string, uci: string) {
  const grid = parseFen(fen).grid.map(r => r.slice())
  const sq = splitMove(uci)
  const a = sq && squareXY(sq[0]), b = sq && squareXY(sq[1])
  if (!a || !b) return grid
  grid[b[1]][b[0]] = grid[a[1]][a[0]]
  grid[a[1]][a[0]] = null
  return grid
}

export default function XiangqiLive({ models, resumeId, onExit }: {
  models: Speaker[]; resumeId?: string | null; onExit: () => void
}) {
  const t = useT()
  const { lang } = useLang()
  const router = useRouter()
  const [g, setG] = useState<GameView | null>(null)
  const [askResign, setAskResign] = useState(false)
  const [seats, setSeats] = useState<{ w: SeatAssign; b: SeatAssign }>({ w: null, b: null })
  const [pickerFor, setPickerFor] = useState<Side | null>(null)
  const [seatOpts, setSeatOpts] = useState<Record<string, SeatOpts>>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [broke, setBroke] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
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
  // A friend's way in: the table's link carries ?join=<token>.
  const join = useJoinToken()

  // Every request carries a timeout; a step may hold two 90 s asks.
  const post = async (body: any): Promise<GameView | null> => {
    const ctl = new AbortController()
    const tm = setTimeout(() => ctl.abort(), body.action === 'step' ? 210_000 : 15_000)
    try {
      const res = await fetch('/api/xgame/xiangqi', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(join ? { ...body, join } : body), signal: ctl.signal,
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
    while (cur && cur.status === 'active' && cur.aiTurn) {
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

  // WATCHDOG: an AI's turn with no loop running restarts the loop.
  useEffect(() => {
    if (!g || g.status !== 'active' || !g.aiTurn || broke) return
    const id = g.id
    const iv = setInterval(() => {
      if (loopRef.current) return
      void post({ action: 'state', id }).then(v => { if (v) void runLoop(v) })
    }, 5000)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g?.id, g?.status, g?.aiTurn, broke])

  // Two people: the other person's move arrives as a ping; the clocks run
  // on the server's numbers.
  const duo = !!g && g.players.length === 2 && g.players.every(p => p.isHuman)
  useTablePings(g?.id, duo && g?.status === 'active', () => { if (g) void post({ action: 'state', id: g.id }) })
  const toMoveIdx: 0 | 1 | null = g && g.status === 'active' && g.turn && !g.lobby ? (g.turn === 'w' ? 0 : 1) : null
  const clockLeft = useDuoClock(duo ? g?.clock : null, toMoveIdx, () => { if (g) void post({ action: 'state', id: g.id }) })

  const start = async () => {
    if (busy || !seats.w || !seats.b) return
    setBusy(true)
    const enc = (a: SeatAssign) => a === 'me'
      ? { human: true }
      : a === 'invite' ? { invite: true }
      : { modelId: (a as any).modelId, thinking: seatOpts[(a as any).modelId]?.thinking ?? null }
    const v = await post({ action: 'create', seats: { red: enc(seats.w), black: enc(seats.b) } })
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
    if (!g) return
    setAskResign(false)
    await post({ action: 'resign', id: g.id })
  }

  const sitDown = async () => {
    if (!g || busy) return
    setBusy(true)
    const v = await post({ action: 'join', id: g.id })
    setBusy(false)
    // Seated: the token has done its job, the address goes back to the table.
    if (v && v.me != null) { try { window.history.replaceState(window.history.state, '', `/xgame/${g.id}`) } catch { /* cosmetic */ } }
  }

  // ── setup ──────────────────────────────────────────────────────────────
  if (!g) {
    // A friend by link plays against the host: the other seat is the host's.
    const ready = !!seats.w && !!seats.b && (seats.w !== 'invite' || seats.b === 'me') && (seats.b !== 'invite' || seats.w === 'me')
    const assign = (side: Side) => (a: SeatAssign) => {
      setSeats(prev => {
        const other: Side = side === 'w' ? 'b' : 'w'
        const next = { ...prev, [side]: a }
        if (a === 'me' && prev[other] === 'me') (next as any)[other] = null
        if (a === 'invite') (next as any)[other] = 'me'
        return next
      })
    }
    return (
      <div style={{ marginTop: 18, maxWidth: 720 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <SeatSlot icon={<General side="w" lang={lang} size={28} />} game="xiangqi" allowInvite assign={seats.w} models={models} seatOpts={seatOpts} onSeatOpts={setSeatOpts} onAssign={assign('w')} onOpenPicker={() => setPickerFor('w')} />
          <SeatSlot icon={<General side="b" lang={lang} size={28} />} game="xiangqi" allowInvite assign={seats.b} models={models} seatOpts={seatOpts} onSeatOpts={setSeatOpts} onAssign={assign('b')} onOpenPicker={() => setPickerFor('b')} />
        </div>
        {pickerFor && (
          <ModelPickerDialog
            mode="text" recipeMode="text_to_text"
            slotIds={[]}
            allow={(m: any) => isEligible('xiangqi', m)}
            onClose={() => setPickerFor(null)}
            onSelect={(m: any) => { setSeats(prev => ({ ...prev, [pickerFor]: { modelId: m.id, name: m.display_name } })); setPickerFor(null) }}
          />
        )}
        <p style={{ margin: '12px 0 0', fontSize: 12.5, color: 'var(--muted2)', lineHeight: 1.6 }}>{t('xq.redfirst')}</p>
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
  const meIdx = g.me ?? -1
  const flipped = meIdx === 1
  const bottomIdx = (meIdx >= 0 ? meIdx : 0) as 0 | 1
  const topIdx = (bottomIdx === 0 ? 1 : 0) as 0 | 1
  const last = g.moves.length ? g.moves[g.moves.length - 1] : null
  const shown = pending ?? last?.uci ?? null
  const grid = pending ? previewGrid(g.fen, pending) : parseFen(g.fen).grid
  const sq = shown ? splitMove(shown) : null
  const lastXY = sq ? [squareXY(sq[0]), squareXY(sq[1])].filter(Boolean) as XY[] : null
  const checkXY = !pending && g.check ? generalSquare(g.fen, parseFen(g.fen).turn) : null
  const canMove = g.status === 'active' && g.humanTurn && !pending

  const movesFrom = (at: XY): XY[] | null => {
    const from = squareName(at[0], at[1])
    const ts = g.legal
      .map(m => splitMove(m))
      .filter((p): p is [string, string] => !!p && p[0] === from)
      .map(p => squareXY(p[1]))
      .filter(Boolean) as XY[]
    return ts.length ? ts : null
  }
  const onMove = (a: XY, b: XY) => {
    const uci = squareName(a[0], a[1]) + squareName(b[0], b[1])
    if (g.legal.includes(uci)) void send(uci)
  }

  const fmtClock = (ms: number) => {
    const sTot = Math.floor(ms / 1000)
    return `${Math.floor(sTot / 60)}:${String(sTot % 60).padStart(2, '0')}`
  }
  const nameOf = (p: Player) => p.isHuman ? t('ch.you') : p.name
  const winnerLabel = () => {
    if (g.end?.reason === 'cancel') return t('gm.cancelled')
    if (g.winner === 'draw' || !g.winner) return t('ch.draw')
    const w = g.winner === 'red' ? 0 : 1
    const p = g.players[w]
    if (duo) return w === meIdx ? t('gm.youwin') : `${p.name} ${t('gm.win')}`
    return p.isHuman ? t('gm.youwin') : `${p.name} ${t('gm.win')}`
  }
  const reasonLabel = g.end ? t(`xq.end.${g.end.reason}`) : ''
  const moveName = (m: Move) => wxfToChinese(m.wxf, m.side, lang)

  const seatCard = (i: 0 | 1) => {
    const p = g.players[i]
    const side: Side = i === 0 ? 'w' : 'b'
    const mine = g.moves.filter(m => m.side === side)
    const activeSeat = g.status === 'active' && g.turn === side
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
        <General side={side} lang={lang} />
        {duo && !p.invited && <Face name={p.name} avatar={p.avatar} />}
        <span style={{ fontSize: 13.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
          {duo
            ? (p.invited ? <span style={{ color: 'var(--muted)', fontWeight: 400 }}>{t('gm.invite.seat')}</span> : <>{p.name}{i === meIdx ? ` ${t('gm.you.tag')}` : ''}</>)
            : nameOf(p)}
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
        {duo ? <ClockText ms={clockLeft(i)} live={activeSeat && !g.lobby} /> : (
          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono), monospace', color: activeSeat ? 'var(--red)' : 'var(--muted2)', fontWeight: 700, flexShrink: 0 }}>
            {fmtClock(used)}
          </span>
        )}
        {activeSeat && !p.isHuman && <span className="nav-history-spin" aria-hidden style={{ flexShrink: 0 }} />}
      </div>
    )
  }

  return (
    <div style={{ marginTop: 16, display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: 'min(500px, 100%)', position: 'relative' }}>
        {g.status === 'active' && g.lobby && g.isHost && g.lobby.token && (
          <InvitePanel id={g.id} token={g.lobby.token} gameName={t('xg.game.xiangqi')} />
        )}
        {g.status === 'active' && g.canJoin && g.lobby && (
          <JoinPanel
            host={g.players[g.lobby.open[0] === 0 ? 1 : 0]} gameName={t('xg.game.xiangqi')}
            seatLabel={t(`xq.side.${g.lobby.open[0] === 0 ? 'w' : 'b'}`)} onJoin={sitDown} busy={busy}
          />
        )}
        {seatCard(topIdx)}
        {g.status === 'over' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, border: '1.5px solid var(--red)', background: 'var(--red-dim)' }}>
            {g.winner === 'red' || g.winner === 'black'
              ? <General side={g.winner === 'red' ? 'w' : 'b'} lang={lang} size={34} />
              : <span style={{ fontSize: 28 }} aria-hidden>🤝</span>}
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 19, fontWeight: 900, fontFamily: 'var(--font-display), inherit' }}>{winnerLabel()}</span>
              <span style={{ fontSize: 11, color: 'var(--muted2)', fontFamily: 'var(--font-mono), monospace' }}>
                {reasonLabel} · {t('ch.moves').replace('{n}', String(Math.ceil(g.moves.length / 2)))}{duo ? '' : ` · $${g.costUsd.toFixed(3)}`}
              </span>
            </span>
            <button onClick={onExit} style={{ padding: '9px 16px', borderRadius: 999, border: 'none', background: 'var(--red)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', flexShrink: 0 }}>
              {t('gm.newgame')}
            </button>
          </div>
        )}
        <div style={{ borderRadius: 10, overflow: 'hidden', boxShadow: '0 2px 18px rgba(0,0,0,0.12)' }}>
          <GridBoard
            cols={9} rows={10} mode="points"
            pieces={grid} renderPiece={(code, size) => <Disc code={code} size={size} lang={lang} />}
            flipped={flipped}
            lastMove={lastXY}
            alerts={checkXY ? [checkXY] : null}
            interactive={canMove}
            movesFrom={movesFrom} onMove={onMove}
            decorate={geo => decorateBoard(geo, lang)}
            theme={BOARD_THEME}
            ariaLabel={([x, y]) => squareName(x, y)}
          />
        </div>
        {seatCard(bottomIdx)}
      </div>

      <div style={{ flex: '1 1 260px', minWidth: 0, maxWidth: 420, width: '100%' }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {g.status === 'over'
            ? `${winnerLabel()} · ${reasonLabel}`
            : g.lobby ? t('gm.invite.waiting')
            : g.humanTurn ? t('ch.yourmove')
            : duo ? t('gm.theirmove').replace('{name}', g.players[g.turn === 'b' ? 1 : 0]?.name ?? '')
            : `${nameOf(g.players[g.turn === 'b' ? 1 : 0])} ${t('gm.turn')}`}
          {g.status === 'active' && g.check && (
            <span style={{ fontSize: 11, fontWeight: 800, color: '#fff', background: 'var(--red)', borderRadius: 6, padding: '2px 7px' }}>{t('ch.check')}</span>
          )}
        </div>
        {!duo && (
          <div style={{ fontSize: 11, color: 'var(--muted2)', fontFamily: 'var(--font-mono), monospace', marginBottom: 10 }}>
            ${g.costUsd.toFixed(3)}
          </div>
        )}
        <div style={{ maxHeight: 400, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[...g.moves].reverse().map(m => (
            <div key={m.n} style={{ padding: '7px 10px', borderRadius: 9, background: 'var(--surface)', border: '1px solid var(--border)', fontSize: 12.5, lineHeight: 1.5 }}>
              <span style={{ fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 5, verticalAlign: 'middle' }}>
                <span style={{ fontFamily: 'var(--font-mono), monospace' }}>{Math.ceil(m.n / 2)}{m.side === 'w' ? '.' : '…'}</span>
                <General side={m.side} lang={lang} size={16} />
                <span style={{ color: m.side === 'w' ? RED : INK }}>{moveName(m)}</span>
                <span style={{ fontFamily: 'var(--font-mono), monospace', fontWeight: 400, fontSize: 10.5, color: 'var(--muted2)' }}>{m.wxf}</span>
              </span>
              {m.ms != null && (
                <span style={{ float: 'right', fontSize: 10.5, fontFamily: 'var(--font-mono), monospace', color: 'var(--muted2)' }}>{(m.ms / 1000).toFixed(1)}s</span>
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
          {g.status === 'active' && meIdx >= 0 && !askResign && (
            <button onClick={() => setAskResign(true)} style={{ background: 'none', border: '1px solid var(--border2)', borderRadius: 9, padding: '7px 16px', fontSize: 12, color: 'var(--red)', cursor: 'pointer' }}>
              {g.lobby ? t('gm.invite.cancel') : t('ch.resign')}
            </button>
          )}
          {g.status === 'active' && meIdx >= 0 && askResign && (
            <span role="group" aria-label={t(g.lobby ? 'gm.invite.cancel.confirm' : 'ch.resign.confirm')} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '4px 4px 4px 12px', border: '1px solid var(--red)', borderRadius: 9, background: 'var(--red-dim)' }}>
              <span style={{ fontSize: 12.5, color: 'var(--white)', fontWeight: 600 }}>{t(g.lobby ? 'gm.invite.cancel.confirm' : 'ch.resign.confirm')}</span>
              <button onClick={resign} style={{ background: 'var(--red)', border: 'none', borderRadius: 7, padding: '6px 14px', fontSize: 12, fontWeight: 700, color: '#fff', cursor: 'pointer' }}>
                {g.lobby ? t('gm.invite.cancel') : t('ch.resign')}
              </button>
              <button onClick={() => setAskResign(false)} style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 7, padding: '6px 14px', fontSize: 12, color: 'var(--muted)', cursor: 'pointer' }}>
                {t('ch.cancel')}
              </button>
            </span>
          )}
        </div>
        <HarnessNote />
      </div>
    </div>
  )
}

/** The rules every model plays under, said on the table. */
function HarnessNote() {
  const t = useT()
  return (
    <details style={{ marginTop: 16, fontSize: 12.5, color: 'var(--muted2)', lineHeight: 1.6 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 700, color: 'var(--muted)' }}>{t('ch.harness.title')}</summary>
      <p style={{ margin: '6px 0 0' }}>
        {t('xq.harness.body').replace('{sec}', String(XIANGQI_HARNESS.timeoutSec)).replace('{cap}', String(XIANGQI_HARNESS.plyCap / 2))}
      </p>
    </details>
  )
}
