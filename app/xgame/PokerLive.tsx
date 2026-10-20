'use client'
// app/xgame/PokerLive.tsx — the hold'em table (Oct 19).
// GomokuLive's pattern: the server holds the game (/api/xgame/poker), this
// loops one step at a time and draws whatever comes back. It never holds a
// card it may not show: the server leaves them out of the reply.
//
// Phone first (~93% of visits): an oval table that fits 375px with up to 9
// seats, the person's seat (or seat 1 when watching) at the bottom, and the
// controls and the story of the hand below it. Our own CSS cards, no art.
// Chips are plain numbers: no currency, nothing that reads like a casino.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLang, useT } from '../../lib/i18n'
import { pokerCostRange, usd } from '../../lib/poker-cost'
import ModelPickerDialog from '../components/ModelPickerDialog'
import ProviderLogo from '../components/ProviderLogo'
import SeatSlot, { type SeatAssign } from './SeatSlot'
import type { SeatOpts } from '../xtalk/SeatConfig'
import type { Speaker } from '../xtalk/templates'

type Card = string
type Act = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin'
type LogLine =
  | { t: 'post'; seat: number; blind: 'sb' | 'bb'; amount: number }
  | { t: 'board'; street: string; board: Card[] }
  | { t: 'act'; seat: number; act: Act; put: number; to: number; street: string; say?: string; why?: string; auto?: boolean; retried?: boolean; ms?: number; cost?: number }
type Result = { showdown: boolean; shown: Record<number, Card[]>; rank: Record<number, number>; won: Record<number, number>; net: Record<number, number>; pots: { size: number; winners: number[] }[] }
type HandView = {
  n: number; button: number; sbSeat: number; bbSeat: number; positions: Record<number, string>
  street: string; board: Card[]; pot: number
  seats: { seat: number; stack: number; bet: number; committed: number; inGame: boolean; folded: boolean; allIn: boolean; cards: Card[] | null }[]
  toAct: number | null
  legal: { seat: number; canCheck: boolean; toCall: number; raise: { kind: 'bet' | 'raise'; min: number; max: number } | null } | null
  log: LogLine[]
  result: Result | null
}
type SeatInfo = { seat: number; name: string; isHuman: boolean; provider: string | null; thinking: string | null; chips: number; stats: { asked: number; retried: number; auto: number; costUsd: number; ms: number } }
type TableView = {
  id: string; version: number; status: 'active' | 'over'; title: string | null; lang: string
  settings: { smallBlind: number; bigBlind: number; startStack: number; maxHands: number; retries: number; timeoutSec: number }
  me: number | null; spectator: boolean; seats: SeatInfo[]; handsPlayed: number
  hand: HandView | null; prev: HandView | null
  results: { n: number; won: Record<number, number>; net: Record<number, number>; shown: Record<number, Card[]>; rank: Record<number, number>; showdown: boolean }[]
  next: 'over' | 'deal' | 'ai' | 'human'; toAct: number | null; winner: string | null; costUsd: number
}

const HAND_CHOICES = [5, 10, 20, 50]

// Where seats sit on a phone (% of a 5:7 table), clockwise from the bottom.
// No seat may share the board's band (~38-62% down): a phone is too narrow
// for a seat beside five cards, so seats go above and below it, as in
// portrait poker apps. Desktop uses an ellipse instead.
const SLOT: Record<string, [number, number]> = {
  B: [50, 90], BL: [18, 90], L2: [12, 72], L1: [12, 29], TL: [18, 10], T: [50, 10], TR: [82, 10], R1: [88, 29], R2: [88, 72], BR: [82, 90],
}
const PHONE_LAYOUT: Record<number, string[]> = {
  2: ['B', 'T'],
  3: ['B', 'TL', 'TR'],
  4: ['B', 'L1', 'T', 'R1'],
  5: ['B', 'L2', 'TL', 'TR', 'R2'],
  6: ['B', 'L2', 'L1', 'T', 'R1', 'R2'],
  7: ['B', 'L2', 'L1', 'TL', 'TR', 'R1', 'R2'],
  8: ['B', 'L2', 'L1', 'TL', 'T', 'TR', 'R1', 'R2'],
  9: ['B', 'BL', 'L2', 'L1', 'TL', 'TR', 'R1', 'R2', 'BR'],
}
const MAX_SEATS = 9
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const fmt = (n: number) => n.toLocaleString('en-US')

// ── Cards ────────────────────────────────────────────────────────────────

const SUIT: Record<string, { sym: string; red: boolean }> = {
  s: { sym: '♠', red: false }, h: { sym: '♥', red: true }, d: { sym: '♦', red: true }, c: { sym: '♣', red: false },
}

function PlayingCard({ card, size = 'md', dim = false }: { card: Card | null; size?: 'sm' | 'md'; dim?: boolean }) {
  const cls = `pk-card pk-card-${size}${dim ? ' is-dim' : ''}`
  if (!card) return <span className={`${cls} is-back`} aria-label="hidden card" />
  const s = SUIT[card[1]]
  const rank = card[0] === 'T' ? '10' : card[0]
  return (
    <span className={`${cls}${s.red ? ' is-red' : ''}`} aria-label={`${rank}${s.sym}`}>
      <span className="pk-card-rank">{rank}</span>
      <span className="pk-card-suit">{s.sym}</span>
    </span>
  )
}

const CSS = `
.pk-wrap { margin-top: 14px; max-width: 980px; }
.pk-card { display: inline-flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1;
  background: #fff; border: 1px solid var(--border2); border-radius: 5px; color: var(--white);
  font-family: var(--font-mono), monospace; font-weight: 700; box-shadow: 0 1px 2px rgba(0,0,0,.12); flex-shrink: 0; }
.pk-card.is-red { color: var(--red); }
.pk-card.is-dim { opacity: .45; }
.pk-card-sm { width: 22px; height: 31px; border-radius: 4px; }
.pk-card-sm .pk-card-rank { font-size: 11px; }
.pk-card-sm .pk-card-suit { font-size: 10px; margin-top: 1px; }
.pk-card-md { width: 34px; height: 48px; }
.pk-card-md .pk-card-rank { font-size: 15px; }
.pk-card-md .pk-card-suit { font-size: 14px; margin-top: 2px; }
.pk-card.is-back { border-color: rgba(214,59,50,.55);
  background: repeating-linear-gradient(45deg, #e45a51 0 4px, #d63b32 4px 8px); box-shadow: inset 0 0 0 2px #fff, 0 1px 2px rgba(0,0,0,.12); }
.pk-slot { display: inline-block; width: 34px; height: 48px; border-radius: 5px; border: 1.5px dashed var(--border2); flex-shrink: 0; }
.pk-table { position: relative; width: 100%; max-width: 640px; aspect-ratio: 5 / 7; margin: 22px auto 26px; }
.pk-felt { position: absolute; left: 10%; right: 10%; top: 14%; bottom: 14%; border-radius: 50%;
  background: radial-gradient(ellipse at 50% 40%, #fffdf8 0%, #f3ede2 100%);
  border: 2px solid rgba(0,0,0,.12); box-shadow: inset 0 0 0 8px rgba(214,59,50,.06), 0 6px 24px rgba(0,0,0,.06); }
.pk-center { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; gap: 7px; width: 74%; }
.pk-board { display: flex; gap: 4px; justify-content: center; }
.pk-pot { font-family: var(--font-mono), monospace; font-size: 12.5px; font-weight: 700; padding: 3px 10px; border-radius: 12px; background: #fff; border: 1px solid var(--border2); max-width: 62%; text-align: center; line-height: 1.35; }
.pk-meta { font-family: var(--font-mono), monospace; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted2); text-align: center; }
.pk-seat { position: absolute; left: var(--px); top: var(--py); transform: translate(-50%, -50%); width: 84px; display: flex; flex-direction: column; align-items: center; z-index: 2; }
.pk-seat.is-out { opacity: .35; }
.pk-seat.is-folded .pk-pod { opacity: .5; }
.pk-pod { width: 100%; padding: 12px 5px 9px; border-radius: 10px; background: #fff; border: 1.5px solid var(--border2); text-align: center; position: relative; }
.pk-seat.is-turn .pk-pod { border-color: var(--red); box-shadow: 0 0 0 3px var(--red-dim); }
.pk-seat.is-win .pk-pod { border-color: var(--green); box-shadow: 0 0 0 3px var(--green-dim); }
.pk-name { font-size: 10px; font-weight: 700; line-height: 1.2; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; word-break: break-word; min-height: 24px; }
.pk-name img { margin-right: 3px; vertical-align: -1px; }
.pk-stack { font-family: var(--font-mono), monospace; font-size: 11.5px; font-weight: 700; }
.pk-holes { display: flex; gap: 2px; min-height: 31px; align-items: flex-end; margin-bottom: -10px; position: relative; z-index: 1; }
.pk-table.is-dense .pk-seat { width: 68px; }
.pk-table.is-dense .pk-name { font-size: 9.5px; -webkit-line-clamp: 1; min-height: 0; }
.pk-table.is-dense .pk-pod { padding: 12px 3px 8px; }
.pk-seat.is-me { z-index: 3; }
.pk-tag { position: absolute; top: -8px; font-family: var(--font-mono), monospace; font-size: 8.5px; font-weight: 700; padding: 1px 4px; border-radius: 6px; background: var(--white); color: #fff; }
.pk-tag.is-btn { left: -6px; background: #fff; color: var(--white); border: 1.5px solid var(--white); border-radius: 999px; width: 17px; height: 17px; padding: 0; display: flex; align-items: center; justify-content: center; top: -9px; }
.pk-tag.is-blind { right: -4px; background: var(--muted2); }
.pk-last { position: absolute; left: 50%; bottom: -9px; transform: translateX(-50%); font-size: 9.5px; font-weight: 700; padding: 1px 6px; border-radius: 999px; background: #fff; border: 1px solid var(--border2); white-space: nowrap; max-width: 104%; overflow: hidden; text-overflow: ellipsis; z-index: 2; }
.pk-last.is-aggr { background: var(--red); border-color: var(--red); color: #fff; }
.pk-last.is-auto { border-style: dashed; color: var(--red); }
.pk-bet { position: absolute; left: var(--px); top: var(--py); transform: translate(-50%, -50%); font-family: var(--font-mono), monospace; font-size: 10.5px; font-weight: 700; display: inline-flex; align-items: center; gap: 3px; z-index: 1; white-space: nowrap; }
.pk-chip { width: 10px; height: 10px; border-radius: 50%; background: var(--red); box-shadow: inset 0 0 0 2px #fff, 0 0 0 1px var(--red); display: inline-block; }
.pk-say { position: absolute; left: var(--px); top: var(--py); transform: translate(-50%, -100%); z-index: 4; max-width: 170px; padding: 6px 9px; border-radius: 11px; background: var(--white); color: #fff;
  font-size: 11.5px; line-height: 1.35; box-shadow: 0 4px 14px rgba(0,0,0,.18); pointer-events: none; animation: pk-pop .25s ease-out; }
.pk-say::after { content: ''; position: absolute; left: 50%; bottom: -5px; margin-left: -5px; border: 5px solid transparent; border-bottom: 0; border-top-color: var(--white); }
@keyframes pk-pop { from { transform: translate(-50%, -88%) scale(.92) } to { transform: translate(-50%, -100%) scale(1) } }
.pk-cols { display: flex; flex-direction: column; gap: 14px; }
.pk-main, .pk-side { min-width: 0; width: 100%; }
.pk-panel { border: 1px solid var(--border); border-radius: 12px; background: var(--surface); padding: 12px 14px; }
.pk-btn { padding: 11px 14px; border-radius: 10px; border: 1.5px solid var(--border2); background: #fff; font-family: inherit; font-size: 14px; font-weight: 700; color: var(--white); cursor: pointer; flex: 1; min-width: 0; }
.pk-btn.is-main { background: var(--red); border-color: var(--red); color: #fff; }
.pk-btn:disabled { opacity: .5; cursor: wait; }
.pk-mini { padding: 5px 10px; border-radius: 999px; border: 1px solid var(--border2); background: #fff; font-family: inherit; font-size: 12px; color: var(--muted2); cursor: pointer; }
.pk-mini.is-on { border-color: var(--red); color: var(--red); background: var(--red-dim); font-weight: 700; }
.pk-log { display: flex; flex-direction: column; gap: 5px; }
/* On a phone the table fills the screen: the person's controls stay in reach. */
.pk-actbar { position: sticky; bottom: 8px; z-index: 20; background: #fff; box-shadow: 0 6px 24px rgba(0,0,0,.14); }
.pk-line { font-size: 12.5px; line-height: 1.5; }
.pk-why { display: block; color: var(--muted2); font-size: 12px; margin-top: 1px; }
.pk-quote { display: inline-block; margin-top: 2px; padding: 2px 8px; border-radius: 9px; background: var(--white); color: #fff; font-size: 12px; }
.pk-street { font-family: var(--font-mono), monospace; font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); margin-top: 6px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
@media (min-width: 720px) {
  .pk-table { aspect-ratio: 16 / 10; }
  .pk-felt { left: 9%; right: 9%; top: 13%; bottom: 13%; }
  .pk-seat, .pk-bet, .pk-say { left: var(--dx); top: var(--dy); }
  .pk-seat, .pk-table.is-dense .pk-seat { width: 112px; }
  .pk-table.is-dense .pk-name { font-size: 11px; }
  .pk-name { font-size: 11.5px; min-height: 0; -webkit-line-clamp: 1; }
  .pk-table { margin: 40px auto 30px; }
  .pk-stack { font-size: 13px; }
  .pk-card-md, .pk-slot { width: 46px; height: 64px; }
  .pk-card-md .pk-card-rank { font-size: 19px; }
  .pk-card-md .pk-card-suit { font-size: 18px; }
  .pk-cols { flex-direction: row; align-items: flex-start; }
  .pk-main { flex: 1 1 600px; }
  .pk-side { flex: 1 1 320px; max-width: 460px; }
}
`

// ── The component ────────────────────────────────────────────────────────

export default function PokerLive({ models, resumeId, onExit }: {
  models: Speaker[]; resumeId?: string | null; onExit: () => void
}) {
  const t = useT()
  const { lang } = useLang()
  const router = useRouter()
  const [g, setG] = useState<TableView | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [paused, setPaused] = useState(false)
  const pausedRef = useRef(false)
  const haltRef = useRef(false)
  const loopRef = useRef(false)

  // Setup
  const [seats, setSeats] = useState<SeatAssign[]>([null, null, null, null])
  const [seatOpts, setSeatOpts] = useState<Record<number, Record<string, SeatOpts>>>({})
  const [pickerFor, setPickerFor] = useState<number | null>(null)
  const [hands, setHands] = useState(10)

  // Only models with a text list price can sit: the estimate needs one, and
  // speech-to-text rows (Whisper, Fun-ASR) output text but cannot read a prompt.
  const pool = useMemo(() => models.filter((m: any) => {
    const o = m.model_pricing?.tokens?.text_output
    const out = typeof o === 'number' ? o : o?.default
    return typeof out === 'number' && out > 0
  }), [models])

  const post = async (body: any): Promise<TableView | null> => {
    const ctl = new AbortController()
    const tm = setTimeout(() => ctl.abort(), body.action === 'step' ? 210_000 : 20_000)
    try {
      const res = await fetch('/api/xgame/poker', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: ctl.signal,
      })
      const d = await res.json().catch(() => null)
      if (!res.ok) {
        setErr(d?.error ?? `HTTP ${res.status}`)
        // An empty wallet or an unreadable table will not fix itself: stop
        // stepping instead of asking again every few seconds.
        if (res.status === 402 || res.status === 409 || res.status === 404) haltRef.current = true
        return null
      }
      setErr(null)
      // MONOTONIC: replies can cross (a watchdog fetch racing a step).
      setG(prev => (!prev || prev.id !== d.id || d.version >= prev.version) ? d : prev)
      return d
    } catch { return null }   // timeout/abort: the watchdog takes it from here
    finally { clearTimeout(tm) }
  }

  const runLoop = async (from: TableView | null) => {
    if (loopRef.current) return
    loopRef.current = true
    let cur = from
    while (cur && !pausedRef.current && !haltRef.current && (cur.next === 'ai' || cur.next === 'deal')) {
      // Let a finished hand be seen before the next deal.
      if (cur.next === 'deal' && cur.hand?.result) await sleep(cur.hand.result.showdown ? 4200 : 2000)
      if (pausedRef.current) break
      cur = await post({ action: 'step', id: cur.id })
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

  // WATCHDOG (gomoku's): whatever kills the loop, this restarts it.
  useEffect(() => {
    if (!g || (g.next !== 'ai' && g.next !== 'deal') || paused) return
    const id = g.id
    const iv = setInterval(() => {
      if (loopRef.current || pausedRef.current || haltRef.current) return
      void post({ action: 'state', id }).then(v => { if (v) void runLoop(v) })
    }, 5000)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g?.id, g?.next, paused])

  const start = async () => {
    if (busy) return
    const filled = seats.filter(Boolean)
    if (filled.length !== seats.length || seats.length < 2) return
    setBusy(true)
    const v = await post({
      action: 'create', hands, lang,
      seats: seats.map((a, i) => a === 'me'
        ? { human: true }
        : { modelId: (a as any).modelId, thinking: seatOpts[i]?.[(a as any).modelId]?.thinking ?? null }),
    })
    setBusy(false)
    if (v) router.push(`/xgame/${v.id}`)
  }

  const act = async (move: Act, amount?: number) => {
    if (!g || busy) return
    setBusy(true)
    const v = await post({ action: 'act', id: g.id, move, amount: amount ?? null })
    setBusy(false)
    if (v) void runLoop(v)
  }

  const endGame = async () => {
    if (!g) return
    pausedRef.current = true
    setPaused(true)
    await post({ action: 'end', id: g.id })
  }

  const togglePause = () => {
    const next = !pausedRef.current
    pausedRef.current = next
    setPaused(next)
    if (!next && g) { haltRef.current = false; void runLoop(g) }
  }

  // ── setup ──────────────────────────────────────────────────────────────
  if (!g) {
    if (resumeId) return <div className="pk-wrap" style={{ color: 'var(--muted)', fontSize: 13 }}>{err ? `⚠ ${err}` : '…'}</div>
    const ready = seats.length >= 2 && seats.every(Boolean)
    const assign = (i: number) => (a: SeatAssign) => setSeats(prev => prev.map((x, k) => {
      if (k === i) return a
      // One person per table: taking a seat vacates the other one.
      return a === 'me' && x === 'me' ? null : x
    }))
    const fill = () => setSeats(prev => prev.map(x => {
      if (x || !pool.length) return x
      const m: any = pool[Math.floor(Math.random() * pool.length)]
      return { modelId: m.id, name: m.display_name }
    }))
    const ai = seats.flatMap((a, i) => {
      if (!a || a === 'me') return []
      const m: any = models.find((x: any) => x.id === a.modelId)
      if (!m) return []
      return [{ pricing: m.model_pricing, thinking: seatOpts[i]?.[m.id]?.thinking ?? null, levels: m.output_config?.text?.thinking_levels ?? [] }]
    })
    const est = ai.length ? pokerCostRange(ai, seats.length, hands) : null
    return (
      <div className="pk-wrap">
        <style>{CSS}</style>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(min(240px, 100%), 1fr))' }}>
          {seats.map((a, i) => (
            <div key={i} style={{ position: 'relative', display: 'flex' }}>
              <SeatSlot
                icon={String(i + 1)} assign={a} models={pool}
                seatOpts={seatOpts[i] ?? {}}
                onSeatOpts={next => setSeatOpts(prev => ({ ...prev, [i]: next }))}
                onAssign={assign(i)} onOpenPicker={() => setPickerFor(i)}
              />
              {seats.length > 2 && (
                <button aria-label={t('pk.removeseat')} title={t('pk.removeseat')}
                  onClick={() => {
                    setSeats(prev => prev.filter((_, k) => k !== i))
                    setSeatOpts(prev => {
                      const out: Record<number, Record<string, SeatOpts>> = {}
                      Object.entries(prev).forEach(([k, v]) => { const n = +k; if (n < i) out[n] = v; else if (n > i) out[n - 1] = v })
                      return out
                    })
                  }}
                  style={{ position: 'absolute', top: -7, right: -7, width: 22, height: 22, borderRadius: 999, border: '1px solid var(--border2)', background: '#fff', color: 'var(--muted2)', fontSize: 13, lineHeight: 1, cursor: 'pointer', zIndex: 3 }}>×</button>
              )}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <button className="pk-mini" disabled={seats.length >= MAX_SEATS} onClick={() => setSeats(prev => prev.length < MAX_SEATS ? [...prev, null] : prev)}>＋ {t('pk.addseat')}</button>
          <button className="pk-mini" onClick={fill}>🎲 {t('pk.fill')}</button>
          <span style={{ fontSize: 12, color: 'var(--muted)', alignSelf: 'center' }}>{t('pk.seatcount').replace('{n}', String(seats.length))}</span>
        </div>
        <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{t('pk.hands')}</span>
          {HAND_CHOICES.map(n => (
            <button key={n} className={`pk-mini${hands === n ? ' is-on' : ''}`} onClick={() => setHands(n)}>{n}</button>
          ))}
        </div>
        <div style={{ marginTop: 12, fontSize: 12.5, color: 'var(--muted2)', lineHeight: 1.6 }}>
          {t('pk.rules').replace('{sb}', '5').replace('{bb}', '10').replace('{stack}', '1,000')}
        </div>
        <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.6 }}>
          <b>{t('pk.estimate')}</b>{' '}
          {est ? <span style={{ fontFamily: 'var(--font-mono), monospace' }}>{usd(est.low)} – {usd(est.high)}</span>
            : <span style={{ color: 'var(--muted)' }}>{ai.length ? '—' : t('pk.estimate.none')}</span>}
          <span style={{ display: 'block', fontSize: 11.5, color: 'var(--muted)' }}>{t('pk.estimate.note')}</span>
        </div>
        {pickerFor != null && (
          <ModelPickerDialog
            mode="text" recipeMode="text_to_text" slotIds={[]}
            onClose={() => setPickerFor(null)}
            onSelect={(m: any) => { const i = pickerFor; setSeats(prev => prev.map((x, k) => k === i ? { modelId: m.id, name: m.display_name } : x)); setPickerFor(null) }}
          />
        )}
        <button onClick={start} disabled={busy || !ready}
          style={{ marginTop: 16, padding: '12px 28px', borderRadius: 10, border: 'none', background: 'var(--red)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: busy ? 'wait' : 'pointer', opacity: (!ready || busy) ? 0.5 : 1 }}
        >{busy ? '…' : t('gm.start')}</button>
        {err && <div style={{ marginTop: 10, color: 'var(--red)', fontSize: 13 }}>⚠ {err}</div>}
      </div>
    )
  }

  // ── the table ──────────────────────────────────────────────────────────
  return <Table g={g} t={t} busy={busy} err={err} paused={paused}
    onAct={act} onEnd={endGame} onPause={togglePause} onExit={onExit} />
}

// ── Table rendering ──────────────────────────────────────────────────────

const actWord = (t: (k: string) => string, l: Extract<LogLine, { t: 'act' }>) => {
  const w = t(`pk.act.${l.act}`)
  if (l.act === 'call') return `${w} ${fmt(l.put)}`
  if (l.act === 'bet' || l.act === 'raise' || l.act === 'allin') return `${w} ${fmt(l.to)}`
  return w
}

function Table({ g, t, busy, err, paused, onAct, onEnd, onPause, onExit }: {
  g: TableView; t: (k: string) => string; busy: boolean; err: string | null; paused: boolean
  onAct: (m: Act, amount?: number) => void; onEnd: () => void; onPause: () => void; onExit: () => void
}) {
  const h = g.hand
  const n = g.seats.length
  const bottom = g.me ?? 0
  const name = (s: number) => g.seats[s]?.isHuman ? t('pk.you') : (g.seats[s]?.name ?? `#${s + 1}`)

  // Seat positions: the bottom seat first, then clockwise. Phone slots in
  // --px/--py, the desktop ellipse in --dx/--dy (the CSS picks by width).
  // r < 1 pulls toward the middle (the chips in front of a seat); dy lifts
  // (a speech bubble above the seat's cards).
  const spot = (s: number, r = 1, dy = 0): React.CSSProperties => {
    const k = (s - bottom + n) % n
    const [px, py] = SLOT[(PHONE_LAYOUT[n] ?? PHONE_LAYOUT[9])[k] ?? 'B']
    const a = Math.PI / 2 + (k * 2 * Math.PI) / n
    const dx = 50 + 41 * Math.cos(a), dyy = 50 + 40 * Math.sin(a)
    const lerp = (v: number) => 50 + (v - 50) * r
    const bubble = dy !== 0
    return {
      ['--px' as any]: `${bubble ? Math.max(26, Math.min(74, px)) : lerp(px)}%`,
      ['--py' as any]: `calc(${lerp(py)}% - ${dy}px)`,
      ['--dx' as any]: `${bubble ? Math.max(20, Math.min(80, dx)) : lerp(dx)}%`,
      ['--dy' as any]: `calc(${lerp(dyy)}% - ${dy}px)`,
    }
  }

  // Each seat's latest action this hand, and the newest table talk.
  const lastAct: Record<number, Extract<LogLine, { t: 'act' }>> = {}
  let lastSay: Extract<LogLine, { t: 'act' }> | null = null
  for (const l of h?.log ?? []) if (l.t === 'act') { lastAct[l.seat] = l; if (l.say) lastSay = l }
  const winners = new Set(Object.keys(h?.result?.won ?? {}).map(Number))
  const acting = g.next === 'ai' && g.toAct != null ? g.toAct : null

  return (
    <div className="pk-wrap">
      <style>{CSS}</style>
      <div className="pk-cols">
        <div className="pk-main">
          <div className={`pk-table${n >= 7 ? ' is-dense' : ''}`}>
            <div className="pk-felt" />
            <div className="pk-center">
              <div className="pk-meta">
                {h ? t('pk.handof').replace('{n}', String(h.n)).replace('{m}', String(g.settings.maxHands)) : ''}
                {h && !h.result ? ` · ${t(`pk.street.${h.street}`)}` : ''}
              </div>
              <div className="pk-board">
                {Array.from({ length: 5 }, (_, i) => h?.board[i]
                  ? <PlayingCard key={i} card={h.board[i]} />
                  : <span key={i} className="pk-slot" />)}
              </div>
              {h && (
                <div className="pk-pot">
                  {h.result
                    ? Object.entries(h.result.won).map(([s, w]) => `${name(+s)} +${fmt(w)}`).join(' · ')
                    : `${t('pk.pot')} ${fmt(h.pot)}`}
                </div>
              )}
            </div>

            {g.seats.map(s => {
              const sv = h?.seats[s.seat]
              const out = !sv?.inGame
              const la = lastAct[s.seat]
              const isTurn = !h?.result && h?.toAct === s.seat
              const cards = sv?.cards ?? null
              const pos = h?.positions[s.seat]
              const blind = pos === 'SB' || pos === 'BB' || pos === 'BTN/SB' ? (pos === 'BB' ? 'BB' : 'SB') : null
              const mine = g.me === s.seat && !g.spectator
              return (
                <div key={s.seat} className={`pk-seat${mine ? ' is-me' : ''}${out ? ' is-out' : ''}${sv?.folded ? ' is-folded' : ''}${isTurn ? ' is-turn' : ''}${h?.result && winners.has(s.seat) ? ' is-win' : ''}`} style={spot(s.seat)}>
                  <div className="pk-holes">
                    {/* A crowded table mucks folded hands; a small one shows them dimmed. */}
                    {!out && !(sv?.folded && n >= 7) && (cards
                      ? cards.map((c, i) => <PlayingCard key={i} card={c} size={mine ? 'md' : 'sm'} dim={sv?.folded} />)
                      : [0, 1].map(i => <PlayingCard key={i} card={null} size="sm" dim={sv?.folded} />))}
                  </div>
                  <div className="pk-pod">
                    {h && h.button === s.seat && !out && <span className="pk-tag is-btn" title="Dealer">D</span>}
                    {blind && !out && <span className="pk-tag is-blind">{blind}</span>}
                    <div className="pk-name" title={name(s.seat)}>
                      {s.isHuman ? <span aria-hidden>👤 </span> : <ProviderLogo provider={s.provider} model={s.name} size={10} />}
                      {name(s.seat)}
                    </div>
                    <div className="pk-stack">{out ? t('pk.out') : fmt(sv?.stack ?? s.chips)}</div>
                    {sv?.allIn && !h?.result && <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--red)' }}>{t('pk.act.allin')}</div>}
                  </div>
                  {la && !out && (la.street === h?.street || la.act === 'fold' || la.act === 'allin' || h?.result) && (
                    <span className={`pk-last${la.act === 'bet' || la.act === 'raise' || la.act === 'allin' ? ' is-aggr' : ''}${la.auto ? ' is-auto' : ''}`}>
                      {la.auto ? '⚠ ' : ''}{actWord(t, la)}
                    </span>
                  )}
                </div>
              )
            })}

            {/* Chips in front of each seat this street. */}
            {h && !h.result && h.seats.filter(x => x.bet > 0).map(x => (
              <span key={`b${x.seat}`} className="pk-bet" style={spot(x.seat, 0.55)}>
                <span className="pk-chip" />{fmt(x.bet)}
              </span>
            ))}

            {/* The newest table talk, above its speaker (kept inside the table). */}
            {lastSay && !h?.result && (
              <div key={`${h?.n}-${h?.log.length}`} className="pk-say" style={spot(lastSay.seat, 1, 44)}>{lastSay.say}</div>
            )}
          </div>

          {/* Status and controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <span style={{ fontSize: 13.5, fontWeight: 700, flex: '1 1 auto' }}>
              {g.next === 'over' ? t('pk.over')
                : g.next === 'human' ? t('pk.yourturn')
                : g.next === 'deal' ? t('pk.dealing')
                : acting != null ? t('pk.thinking').replace('{name}', name(acting)) : '…'}
              {(g.next === 'ai' || g.next === 'deal') && !paused && <span className="nav-history-spin" aria-hidden style={{ marginLeft: 8, verticalAlign: 'middle' }} />}
            </span>
            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono), monospace', color: 'var(--muted2)' }} title={t('pk.aicost')}>
              {t('pk.aicost')} ${g.costUsd.toFixed(3)}
            </span>
            {g.next !== 'over' && (
              <>
                {g.me == null || g.spectator ? <button className="pk-mini" onClick={onPause}>{paused ? `▶ ${t('pk.resume')}` : `❚❚ ${t('pk.pause')}`}</button> : null}
                <button className="pk-mini" onClick={onEnd}>■ {t('pk.end')}</button>
              </>
            )}
          </div>
          {err && <div style={{ marginTop: 8, color: 'var(--red)', fontSize: 13 }}>⚠ {err}</div>}

          {g.next === 'human' && h?.legal && <ActionBar h={h} t={t} busy={busy} onAct={onAct} />}

          {g.next === 'over' && <Standings g={g} t={t} name={name} onExit={onExit} />}
        </div>

        <div className="pk-side">
          {h && <HandLog h={h} g={g} t={t} name={name} />}
          {g.prev && (!h || h.log.filter(l => l.t === 'act').length < 2) && (
            <div style={{ marginTop: 12 }}><HandLog h={g.prev} g={g} t={t} name={name} compact /></div>
          )}
          {g.results.length > 0 && (
            <div className="pk-panel" style={{ marginTop: 12 }}>
              <div className="pk-meta" style={{ textAlign: 'left', marginBottom: 6 }}>{t('pk.history')}</div>
              {[...g.results].reverse().map(r => (
                <div key={r.n} style={{ fontSize: 12, lineHeight: 1.6, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontFamily: 'var(--font-mono), monospace', color: 'var(--muted)' }}>#{r.n}</span>
                  <span style={{ fontWeight: 700 }}>{Object.entries(r.won).map(([s, w]) => `${name(+s)} +${fmt(w)}`).join(', ')}</span>
                  {r.showdown && Object.keys(r.rank).filter(s => r.won[+s]).map(s => (
                    <span key={s} style={{ color: 'var(--muted2)' }}>{t(`pk.rank.${r.rank[+s]}`)}</span>
                  ))}
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 12, fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.6 }}>
            {t('pk.harness').replace('{sb}', String(g.settings.smallBlind)).replace('{bb}', String(g.settings.bigBlind))
              .replace('{stack}', fmt(g.settings.startStack)).replace('{hands}', String(g.settings.maxHands)).replace('{sec}', String(g.settings.timeoutSec))}
            {' '}
            {g.seats.filter(s => !s.isHuman).map(s => `${s.name}: ${s.thinking ?? t('gm.auto')}`).join(' · ')}
          </div>
          <button onClick={onExit} style={{ marginTop: 12, background: 'none', border: '1px solid var(--border2)', borderRadius: 9, padding: '7px 16px', fontSize: 12, color: 'var(--muted)', cursor: 'pointer' }}>
            ← {t('gm.newgame')}
          </button>
        </div>
      </div>
    </div>
  )
}

function ActionBar({ h, t, busy, onAct }: { h: HandView; t: (k: string) => string; busy: boolean; onAct: (m: Act, amount?: number) => void }) {
  const L = h.legal!
  const me = h.seats[L.seat]
  const r = L.raise
  const [amt, setAmt] = useState<number>(r?.min ?? 0)
  useEffect(() => { setAmt(r?.min ?? 0) }, [h.n, h.log.length, r?.min])
  const clamp = (x: number) => r ? Math.max(r.min, Math.min(r.max, Math.round(x))) : 0
  // Pot-sized raises: the total after calling, added on top of the call.
  const biggest = me.bet + L.toCall
  const potAfter = h.pot + L.toCall
  const presets = r ? [
    { k: 'pk.min', v: r.min },
    { k: 'pk.halfpot', v: clamp(biggest + potAfter / 2) },
    { k: 'pk.potsize', v: clamp(biggest + potAfter) },
    { k: 'pk.act.allin', v: r.max },
  ] : []
  return (
    <div className="pk-panel pk-actbar" style={{ marginTop: 10, borderColor: 'var(--red)' }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="pk-btn" disabled={busy} onClick={() => onAct('fold')}>{t('pk.act.fold')}</button>
        <button className="pk-btn" disabled={busy} onClick={() => onAct(L.canCheck ? 'check' : 'call')}>
          {L.canCheck ? t('pk.act.check') : `${t('pk.act.call')} ${fmt(L.toCall)}`}
        </button>
      </div>
      {r && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {presets.map(p => (
              <button key={p.k} className={`pk-mini${amt === p.v ? ' is-on' : ''}`} onClick={() => setAmt(p.v)}>{t(p.k)}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="range" min={r.min} max={r.max} step={1} value={amt}
              onChange={e => setAmt(clamp(Number(e.target.value)))} style={{ flex: 1, minWidth: 0, accentColor: 'var(--red)' }} />
            <input type="number" inputMode="numeric" min={r.min} max={r.max} value={amt}
              onChange={e => setAmt(Number(e.target.value))} onBlur={() => setAmt(clamp(amt))}
              style={{ width: 84, padding: '8px 8px', borderRadius: 8, border: '1px solid var(--border2)', fontFamily: 'var(--font-mono), monospace', fontSize: 14 }} />
          </div>
          <button className="pk-btn is-main" style={{ width: '100%', marginTop: 8 }} disabled={busy}
            onClick={() => onAct(amt >= r.max ? 'allin' : r.kind, clamp(amt))}>
            {amt >= r.max ? `${t('pk.act.allin')} ${fmt(r.max)}` : t('pk.raiseto').replace('{act}', t(`pk.act.${r.kind}`)).replace('{n}', fmt(clamp(amt)))}
          </button>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5 }}>{t('pk.totalnote')}</div>
        </div>
      )}
    </div>
  )
}

function HandLog({ h, g, t, name, compact = false }: { h: HandView; g: TableView; t: (k: string) => string; name: (s: number) => string; compact?: boolean }) {
  const hiddenWhy = !g.spectator && !h.result
  return (
    <div className="pk-panel">
      <div className="pk-meta" style={{ textAlign: 'left', marginBottom: 4 }}>
        {compact ? t('pk.lasthand') : t('pk.log')} · #{h.n}
      </div>
      {hiddenWhy && <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 4 }}>🔒 {t('pk.hiddenwhy')}</div>}
      <div className="pk-log">
        {h.log.map((l, i) => {
          if (l.t === 'post') return compact ? null : (
            <div key={i} className="pk-line" style={{ color: 'var(--muted2)' }}>{name(l.seat)} · {l.blind === 'sb' ? t('pk.sb') : t('pk.bb')} {fmt(l.amount)}</div>
          )
          if (l.t === 'board') return (
            <div key={i} className="pk-street">
              <span>{t(`pk.street.${l.street}`)}</span>
              {l.board.map(c => <PlayingCard key={c} card={c} size="sm" />)}
            </div>
          )
          if (compact) return null
          return (
            <div key={i} className="pk-line">
              <b>{name(l.seat)}</b> {actWord(t, l)}
              {l.auto && <span title={t('pk.autonote')} style={{ marginLeft: 6, fontSize: 10.5, color: 'var(--red)' }}>⚠ {t('pk.auto')}</span>}
              {l.retried && <span title={t('pk.retriednote')} style={{ marginLeft: 6, fontSize: 10.5, color: 'var(--muted)' }}>↻</span>}
              {l.ms != null && l.ms > 0 && <span style={{ float: 'right', fontSize: 10.5, fontFamily: 'var(--font-mono), monospace', color: 'var(--muted)' }}>{(l.ms / 1000).toFixed(1)}s</span>}
              {l.say && <><br /><span className="pk-quote">“{l.say}”</span></>}
              {l.why && <span className="pk-why">{l.why}</span>}
            </div>
          )
        })}
      </div>
      {h.result && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)', fontSize: 12.5, lineHeight: 1.7 }}>
          {Object.entries(h.result.won).map(([s, w]) => (
            <div key={s}><b>{name(+s)}</b> +{fmt(w)}{h.result!.rank[+s] != null ? ` · ${t(`pk.rank.${h.result!.rank[+s]}`)}` : ''}</div>
          ))}
          {h.result.showdown && Object.entries(h.result.shown).filter(([s]) => !h.result!.won[+s]).map(([s, cs]) => (
            <div key={s} style={{ color: 'var(--muted2)', display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              {name(+s)} {cs.map(c => <PlayingCard key={c} card={c} size="sm" />)} {h.result!.rank[+s] != null ? t(`pk.rank.${h.result!.rank[+s]}`) : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Standings({ g, t, name, onExit }: { g: TableView; t: (k: string) => string; name: (s: number) => string; onExit: () => void }) {
  const rows = [...g.seats].sort((a, b) => b.chips - a.chips)
  return (
    <div className="pk-panel" style={{ marginTop: 10, borderColor: 'var(--red)', background: 'var(--red-dim)' }}>
      <div style={{ fontSize: 18, fontWeight: 900, fontFamily: 'var(--font-display), inherit', marginBottom: 8 }}>
        🏆 {rows[0] && rows[0].chips > (rows[1]?.chips ?? -1) ? `${name(rows[0].seat)} ${t('gm.win')}` : t('gm.draw')}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {rows.map((s, i) => (
          <div key={s.seat} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
            <span style={{ width: 18, fontFamily: 'var(--font-mono), monospace', color: 'var(--muted)' }}>{i + 1}</span>
            <span style={{ flex: 1, minWidth: 0, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {name(s.seat)}{s.thinking ? <span style={{ fontWeight: 400, color: 'var(--muted2)' }}> · {s.thinking}</span> : null}
            </span>
            <span style={{ fontFamily: 'var(--font-mono), monospace', fontWeight: 700 }}>{fmt(s.chips)}</span>
            {!s.isHuman && (
              <span style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 10.5, color: 'var(--muted2)', textAlign: 'right', minWidth: 92 }}>
                {s.stats.asked}× · {s.stats.auto ? `⚠${s.stats.auto} · ` : ''}${s.stats.costUsd.toFixed(3)}
              </span>
            )}
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted2)', marginTop: 8 }}>
        {t('pk.played').replace('{n}', String(g.handsPlayed))} · {t('pk.aicost')} ${g.costUsd.toFixed(3)}
      </div>
      <button onClick={onExit} style={{ marginTop: 10, padding: '9px 20px', borderRadius: 999, border: 'none', background: 'var(--red)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
        {t('gm.newgame')}
      </button>
    </div>
  )
}
