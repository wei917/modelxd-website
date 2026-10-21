'use client'
// app/xgame/BridgeLive.tsx — the bridge table (Oct 20). PokerLive's shape:
// the server holds the game (/api/xgame/bridge, lib/bridge-table.ts), this
// loops one step at a time and draws the view it is given. The view already
// hides what this viewer may not see (other hands, other seats' reasons
// until the board is over); this file never decides that.
//
// Phones first: the table turns so the hand you play is at the bottom
// (South when you watch). North and South run the full width, West, the
// trick and East share the middle row; hands are printed by suit, and your
// cards (or the dummy's, when you declare) become buttons on your turn. The
// auction is the usual W N E S table; your call comes from a bidding box of
// the legal calls only.

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLang, useT } from '../../lib/i18n'
import { SUITS, suitOf, ALL_BIDS, type Seat, type Card } from '../../lib/bridge-engine'
import { BRIDGE } from '../../lib/bridge-engine'
import { bridgeCostRange } from '../../lib/bridge-cost'
import { usd } from '../../lib/poker-cost'
import { isEligible, speedLevel } from '../../lib/xgame-speed'
import ModelPickerDialog from '../components/ModelPickerDialog'
import SeatSlot, { type SeatAssign } from './SeatSlot'
import type { SeatOpts } from '../xtalk/SeatConfig'
import type { Speaker } from '../xtalk/templates'

const SYM: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣', NT: 'NT' }
const RED = '#c0392b'
const suitColor = (s: string) => (s === 'H' || s === 'D' ? RED : 'var(--white)')
const rankText = (r: string) => (r === 'T' ? '10' : r)

function CallLabel({ call }: { call: string }) {
  if (call === 'P') return <span>Pass</span>
  if (call === 'X' || call === 'XX') return <span style={{ color: RED, fontWeight: 800 }}>{call}</span>
  const m = /^([1-7])(C|D|H|S|NT)$/.exec(call)
  if (!m) return <span>{call}</span>
  return <span style={{ whiteSpace: 'nowrap' }}>{m[1]}<span style={{ color: suitColor(m[2]) }}>{SYM[m[2]]}</span></span>
}
function CardLabel({ card }: { card: Card }) {
  const s = suitOf(card)
  return <span style={{ whiteSpace: 'nowrap', color: suitColor(s), fontWeight: 700 }}>{SYM[s]}{rankText(card[1])}</span>
}

type View = any

export default function BridgeLive({ models, resumeId, onExit }: {
  models: Speaker[]; resumeId?: string | null; onExit: () => void
}) {
  const t = useT()
  const { lang } = useLang()
  const router = useRouter()
  const [v, setV] = useState<View | null>(null)
  const [seats, setSeats] = useState<SeatAssign[]>([null, null, null, null])
  const [pickerFor, setPickerFor] = useState<number | null>(null)
  const [seatOpts, setSeatOpts] = useState<Record<number, Record<string, SeatOpts>>>({})
  const [deals, setDeals] = useState<number>(BRIDGE.defaultDeals)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [broke, setBroke] = useState(false)
  const loopRef = useRef(false)

  const seatName = (s: number) => t(`br.seat.${s}`)

  // Every request carries a timeout; a model's turn may hold two 90 s asks.
  const post = async (body: any): Promise<View | null> => {
    const ctl = new AbortController()
    const tm = setTimeout(() => ctl.abort(), body.action === 'step' ? 210_000 : 15_000)
    try {
      const res = await fetch('/api/xgame/bridge', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: ctl.signal,
      })
      const d = await res.json().catch(() => null)
      if (!res.ok) { setErr(d?.error ?? `HTTP ${res.status}`); if (res.status === 402) setBroke(true); return null }
      setErr(null); setBroke(false)
      // The newest save wins when replies cross (the version is the save counter).
      setV((prev: View | null) => (!prev || prev.id !== d.id || d.version >= prev.version) ? d : prev)
      return d
    } catch { return null }
    finally { clearTimeout(tm) }
  }

  const runLoop = async (from: View | null) => {
    if (loopRef.current) return
    loopRef.current = true
    let cur = from
    while (cur && cur.status === 'active' && (cur.next === 'ai' || cur.next === 'deal')) {
      cur = await post({ action: 'step', id: cur.id })
      if (!cur) break
    }
    loopRef.current = false
  }

  useEffect(() => {
    if (!resumeId) return
    ;(async () => {
      const x = await post({ action: 'state', id: resumeId })
      if (x) void runLoop(x)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeId])

  // WATCHDOG: a model's turn with no loop running restarts the loop.
  useEffect(() => {
    if (!v || v.status !== 'active' || v.next === 'human' || broke) return
    const id = v.id
    const iv = setInterval(() => {
      if (loopRef.current) return
      void post({ action: 'state', id }).then(x => { if (x) void runLoop(x) })
    }, 5000)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v?.id, v?.status, v?.next, broke])

  const start = async () => {
    if (busy || seats.some(s => !s)) return
    setBusy(true)
    const enc = (a: SeatAssign, i: number) => a === 'me'
      ? { human: true }
      : { modelId: (a as any).modelId, thinking: seatOpts[i]?.[(a as any).modelId]?.thinking ?? null }
    const x = await post({ action: 'create', seats: seats.map(enc), deals, lang })
    setBusy(false)
    if (x) router.push(`/xgame/${x.id}`)
  }

  const act = async (body: any) => {
    if (!v) return
    const x = await post({ ...body, id: v.id })
    if (x) void runLoop(x)
  }

  // ── setup ──────────────────────────────────────────────────────────────
  if (!v) {
    const ready = seats.every(Boolean)
    const assign = (i: number) => (a: SeatAssign) => setSeats(prev => prev.map((s, k) => (k === i ? a : a === 'me' && s === 'me' ? null : s)))
    const est = (() => {
      const ai = seats.map((a, i) => ({ a, i })).filter(x => x.a && x.a !== 'me')
      if (!ai.length) return null
      const rows = ai.map(({ a, i }) => {
        const m: any = models.find((mm: any) => mm.id === (a as any).modelId)
        return m ? { pricing: m.model_pricing, thinking: speedLevel('bridge', m, seatOpts[i]?.[m.id]?.thinking), levels: m.output_config?.text?.thinking_levels ?? [] } : null
      })
      return rows.every(Boolean) ? bridgeCostRange(rows as any, deals) : null
    })()
    const slot = (i: number) => (
      <SeatSlot key={i}
        icon={<span style={{ display: 'inline-flex', width: 26, height: 26, borderRadius: 999, alignItems: 'center', justifyContent: 'center', background: 'var(--surface2)', fontSize: 13, fontWeight: 800 }}>{seatName(i).slice(0, 1)}</span>}
        game="bridge" assign={seats[i]} models={models}
        seatOpts={seatOpts[i] ?? {}} onSeatOpts={o => setSeatOpts(prev => ({ ...prev, [i]: o }))}
        onAssign={assign(i)} onOpenPicker={() => setPickerFor(i)} />
    )
    return (
      <div style={{ marginTop: 18, maxWidth: 720 }}>
        {(['NS', 'EW'] as const).map(side => (
          <div key={side} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>{t(`br.${side}`)}</div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>{side === 'NS' ? [slot(0), slot(2)] : [slot(1), slot(3)]}</div>
          </div>
        ))}
        {pickerFor != null && (
          <ModelPickerDialog
            mode="text" recipeMode="text_to_text" slotIds={[]}
            allow={(m: any) => isEligible('bridge', m)}
            onClose={() => setPickerFor(null)}
            onSelect={(m: any) => { setSeats(prev => prev.map((s, k) => (k === pickerFor ? { modelId: m.id, name: m.display_name } : s))); setPickerFor(null) }}
          />
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 13 }}>{t('br.boards')}</b>
          {BRIDGE.dealChoices.map(n => (
            <button key={n} onClick={() => setDeals(n)} style={{
              width: 34, height: 30, borderRadius: 999, fontSize: 12.5, cursor: 'pointer',
              border: '1px solid ' + (deals === n ? 'var(--red)' : 'var(--border2)'),
              background: deals === n ? 'var(--red-dim)' : 'var(--surface)', color: deals === n ? 'var(--red)' : 'var(--white)', fontWeight: deals === n ? 700 : 400,
            }}>{n}</button>
          ))}
        </div>
        <p style={{ margin: '10px 0 0', fontSize: 12.5, color: 'var(--muted2)', lineHeight: 1.6 }}>{t('br.system')}</p>
        <div style={{ marginTop: 8, fontSize: 12.5 }}>
          <b>{t('pk.estimate')}</b>{' '}
          {est ? `${usd(est.low)} – ${usd(est.high)}` : <span style={{ color: 'var(--muted)' }}>{t('pk.estimate.none')}</span>}
          <span style={{ display: 'block', fontSize: 11.5, color: 'var(--muted)' }}>{t('pk.estimate.note')}</span>
        </div>
        <button onClick={start} disabled={busy || !ready}
          style={{ marginTop: 14, padding: '11px 26px', borderRadius: 10, border: 'none', background: 'var(--red)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: busy ? 'wait' : 'pointer', opacity: (!ready || busy) ? 0.5 : 1 }}
        >{busy ? '…' : t('gm.start')}</button>
        {err && <div style={{ marginTop: 10, color: 'var(--red)', fontSize: 13 }}>⚠ {err}</div>}
        <HarnessNote />
      </div>
    )
  }

  // ── live table ─────────────────────────────────────────────────────────
  const d = v.deal
  const me: number | null = v.me
  const bottom = me ?? 2
  const at = { bottom, left: (bottom + 1) % 4, top: (bottom + 2) % 4, right: (bottom + 3) % 4 }
  const turn = d?.turn ?? null
  const humanCard = v.humanTurn && turn?.kind === 'card'
  const humanCall = v.humanTurn && turn?.kind === 'call'
  const legal: string[] = d?.legal ?? []
  const contract = d?.contract ?? null
  const declarer: number | null = contract ? contract.declarer : null
  const dummy: number | null = d?.dummy ?? null
  const hands: (Card[] | null)[] = d ? (d.dealt && d.phase === 'done' ? d.dealt : d.hands) : [null, null, null, null]
  const contractText = contract ? `${contract.level}${SYM[contract.strain]}${contract.doubled === 2 ? ' XX' : contract.doubled ? ' X' : ''}` : ''
  const nameOf = (s: number) => {
    const p = v.seats[s]
    return p.isHuman ? t('ch.you') : p.name
  }
  const sideName = (side: 'NS' | 'EW') => t(`br.${side}`)
  const curTrick = d?.tricks?.length ? d.tricks[d.tricks.length - 1] : null
  // The trick in progress, or the one just finished until the next lead.
  const showTrick = curTrick

  const seatBox = (s: number, full: boolean) => {
    const p = v.seats[s]
    const active = !!turn && v.status === 'active' && turn.seat === s
    const hand = hands[s]
    const clickable = humanCard && turn.seat === s
    const role = declarer === s ? t('br.declarer') : dummy === s && d?.phase !== 'auction' ? t('br.dummy') : null
    return (
      <div key={s} style={{
        border: '1.5px solid ' + (active ? 'var(--red)' : 'var(--border)'), background: active ? 'var(--red-dim)' : 'var(--surface)',
        borderRadius: 10, padding: '7px 9px', minWidth: 0, width: '100%', boxSizing: 'border-box',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flexWrap: full ? 'nowrap' : 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--red)', flexShrink: 0 }}>{seatName(s)}</span>
          <span style={{ fontSize: 12.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: full ? 1 : '1 1 auto' }}>{nameOf(s)}</span>
          {p.thinking && <span style={{ fontSize: 9.5, fontFamily: 'var(--font-mono), monospace', color: 'var(--red)', background: 'var(--red-dim)', borderRadius: 5, padding: '0 5px', flexShrink: 0 }}>{p.thinking}</span>}
          {role && <span style={{ fontSize: 10, fontWeight: 700, color: '#fff', background: 'var(--red)', borderRadius: 5, padding: '0 5px', flexShrink: 0 }}>{role}</span>}
          {active && !p.isHuman && !(dummy === s && declarer != null && v.seats[declarer].isHuman) && <span className="nav-history-spin" aria-hidden style={{ flexShrink: 0 }} />}
        </div>
        <div style={{ marginTop: 4, fontSize: full ? 13.5 : 12, lineHeight: 1.55, fontFamily: 'var(--font-mono), monospace' }}>
          {hand ? SUITS.map(su => {
            const cs = hand.filter(c => suitOf(c) === su)
            return (
              <div key={su} style={{ display: 'flex', gap: clickable ? 4 : 0, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ color: suitColor(su), width: 14, flexShrink: 0 }}>{SYM[su]}</span>
                {cs.length === 0 && <span style={{ color: 'var(--muted2)' }}>—</span>}
                {clickable
                  ? cs.map(c => {
                    const can = legal.includes(c)
                    return (
                      <button key={c} disabled={!can} onClick={() => act({ action: 'play', card: c })} style={{
                        minWidth: 30, height: 30, padding: '0 6px', borderRadius: 7, cursor: can ? 'pointer' : 'default',
                        border: '1px solid ' + (can ? 'var(--red)' : 'var(--border)'), background: can ? '#fff' : 'var(--surface2)',
                        color: suitColor(su), fontWeight: 800, fontSize: 13, opacity: can ? 1 : 0.45, fontFamily: 'inherit',
                      }}>{rankText(c[1])}</button>
                    )
                  })
                  : <span style={{ wordBreak: 'break-all' }}>{cs.map(c => rankText(c[1])).join(full ? ' ' : '')}</span>}
              </div>
            )
          }) : (
            <span style={{ color: 'var(--muted2)', fontSize: 12 }}>🂠 × {d?.counts?.[s] ?? 13}</span>
          )}
        </div>
      </div>
    )
  }

  const trickSpot = (s: number) => {
    const c = showTrick?.cards?.find((x: any) => x.seat === s)
    return (
      <span style={{ minWidth: 34, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6,
        background: c ? '#fff' : 'transparent', border: c ? '1px solid var(--border2)' : '1px dashed transparent', fontSize: 13,
        outline: showTrick?.winner === s ? `2px solid ${RED}` : 'none' }}>
        {c ? <CardLabel card={c.card} /> : null}
      </span>
    )
  }

  const center = (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface2)', padding: 6, display: 'grid', gridTemplateAreas: '". t ." "l m r" ". b ."', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', justifyItems: 'center', gap: 4, minHeight: 104 }}>
      <div style={{ gridArea: 't' }}>{d?.phase === 'play' || d?.phase === 'done' ? trickSpot(at.top) : null}</div>
      <div style={{ gridArea: 'l' }}>{d?.phase === 'play' || d?.phase === 'done' ? trickSpot(at.left) : null}</div>
      <div style={{ gridArea: 'm', fontSize: 11, textAlign: 'center', color: 'var(--muted)', lineHeight: 1.35 }}>
        {d?.phase === 'auction' ? t('br.auction') : contract ? <><b style={{ color: 'var(--white)', fontSize: 13 }}>{contract.level}<span style={{ color: suitColor(contract.strain) }}>{SYM[contract.strain]}</span>{contract.doubled ? ' ' + 'X'.repeat(contract.doubled) : ''}</b><br />{seatName(contract.declarer)}</> : d?.passedOut ? t('br.passedout') : ''}
      </div>
      <div style={{ gridArea: 'r' }}>{d?.phase === 'play' || d?.phase === 'done' ? trickSpot(at.right) : null}</div>
      <div style={{ gridArea: 'b' }}>{d?.phase === 'play' || d?.phase === 'done' ? trickSpot(at.bottom) : null}</div>
    </div>
  )

  // The auction table: W N E S columns, the dealer's first call in its column.
  const auctionRows: { seat: number; call: string; auto?: boolean; retried?: boolean }[][] = []
  if (d) {
    const col = (s: number) => (s + 1) % 4
    let row: any[] = Array(4).fill(null)
    let c = col(d.dealer)
    for (const a of d.auction) {
      row[c] = a
      c++
      if (c === 4) { auctionRows.push(row); row = Array(4).fill(null); c = 0 }
    }
    if (row.some(Boolean) || !auctionRows.length) auctionRows.push(row)
  }

  // Reasons, newest first (the server sends only those this viewer may see).
  const reasons: { key: string; seat: number; what: React.ReactNode; why: string; auto?: boolean; retried?: boolean; forced?: boolean }[] = []
  if (d) {
    d.auction.forEach((a: any, i: number) => { if (a.why || a.auto) reasons.push({ key: `a${i}`, seat: a.seat, what: <CallLabel call={a.call} />, why: a.why ?? '', auto: a.auto, retried: a.retried }) })
    d.tricks.forEach((tr: any, k: number) => tr.cards.forEach((p: any, j: number) => { if (p.why || p.auto) reasons.push({ key: `p${k}-${j}`, seat: p.seat, what: <CardLabel card={p.card} />, why: p.why ?? '', auto: p.auto, retried: p.retried, forced: p.forced }) }))
  }
  reasons.reverse()

  const status = v.status === 'over'
    ? (v.winner === 'draw' ? t('br.tie') : me != null && v.winner === (me % 2 === 0 ? 'NS' : 'EW') ? t('br.youwin') : t('br.wins').replace('{side}', sideName(v.winner)))
    : humanCall ? t('br.yourcall')
    : humanCard ? (turn.seat !== me ? t('br.fromdummy') : t('br.yourcard'))
    : turn ? `${seatName(turn.decider)} ${nameOf(turn.decider)} ${t('br.thinking')}` : ''

  return (
    <div style={{ marginTop: 14, display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: 'min(560px, 100%)' }}>
        {d && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 12.5, color: 'var(--muted)', alignItems: 'center' }}>
            <b style={{ color: 'var(--white)' }}>{t('br.board').replace('{n}', String(d.board))}</b>
            <span>{t('br.dealer')} {seatName(d.dealer)}</span>
            <span>{t(`br.vul.${d.vul}`)}</span>
            {contract && <span>{t('br.contractby').replace('{c}', contractText).replace('{seat}', seatName(contract.declarer))}</span>}
            {contract && <span>{t('br.tricks')} {sideName('NS')} {d.won.NS} · {sideName('EW')} {d.won.EW}</span>}
          </div>
        )}

        {v.status === 'over' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, border: '1.5px solid var(--red)', background: 'var(--red-dim)' }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 19, fontWeight: 900, fontFamily: 'var(--font-display), inherit' }}>{status}</span>
              <span style={{ fontSize: 11.5, color: 'var(--muted2)', fontFamily: 'var(--font-mono), monospace' }}>
                {sideName('NS')} {v.total.NS} · {sideName('EW')} {v.total.EW} · ${v.costUsd.toFixed(3)}
              </span>
            </span>
            <button onClick={onExit} style={{ padding: '9px 16px', borderRadius: 999, border: 'none', background: 'var(--red)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', flexShrink: 0 }}>{t('gm.newgame')}</button>
          </div>
        )}

        {/* No board on the table (a game ended before its first board finished): no empty table. */}
        {d && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)', gridTemplateAreas: '"top top top" "left mid right" "bottom bottom bottom"', gap: 6 }}>
            <div style={{ gridArea: 'top' }}>{seatBox(at.top, true)}</div>
            <div style={{ gridArea: 'left' }}>{seatBox(at.left, false)}</div>
            <div style={{ gridArea: 'mid' }}>{center}</div>
            <div style={{ gridArea: 'right' }}>{seatBox(at.right, false)}</div>
            <div style={{ gridArea: 'bottom' }}>{seatBox(at.bottom, true)}</div>
          </div>
        )}

        {humanCall && (
          <div style={{ border: '1.5px solid var(--red)', borderRadius: 12, padding: 10, background: 'var(--surface)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>{t('br.yourcall')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 4 }}>
              {ALL_BIDS.map(b => {
                const can = legal.includes(b)
                return (
                  <button key={b} disabled={!can} onClick={() => act({ action: 'call', call: b })} style={{
                    height: 30, borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: can ? 'pointer' : 'default',
                    border: '1px solid ' + (can ? 'var(--border2)' : 'var(--border)'), background: can ? '#fff' : 'var(--surface2)', opacity: can ? 1 : 0.35,
                  }}><CallLabel call={b} /></button>
                )
              })}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              {['P', 'X', 'XX'].map(c => {
                const can = legal.includes(c)
                return (
                  <button key={c} disabled={!can} onClick={() => act({ action: 'call', call: c })} style={{
                    flex: c === 'P' ? 2 : 1, height: 34, borderRadius: 8, fontSize: 13.5, fontWeight: 800, cursor: can ? 'pointer' : 'default',
                    border: 'none', background: c === 'P' ? '#2e7d32' : RED, color: '#fff', opacity: can ? 1 : 0.3,
                  }}><span style={{ color: '#fff' }}>{c === 'P' ? 'Pass' : c}</span></button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <div style={{ flex: '1 1 260px', minWidth: 0, maxWidth: 420, width: '100%' }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{status}</div>
        <div style={{ fontSize: 11, color: 'var(--muted2)', fontFamily: 'var(--font-mono), monospace', marginBottom: 10 }}>${v.costUsd.toFixed(3)}</div>

        {d && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 4 }}>{t('br.auction')}</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'center' }}>
              <thead><tr>{[3, 0, 1, 2].map(s => <th key={s} style={{ fontWeight: 700, fontSize: 11.5, color: 'var(--muted)', padding: '2px 0', borderBottom: '1px solid var(--border)' }}>{seatName(s)}</th>)}</tr></thead>
              <tbody>
                {auctionRows.map((r, i) => (
                  <tr key={i}>{r.map((a, j) => (
                    <td key={j} style={{ padding: '3px 0' }}>
                      {a ? <><CallLabel call={a.call} />{a.auto && <span style={{ color: RED, fontSize: 10 }}> ⚠</span>}{!a.auto && a.retried && <span style={{ color: 'var(--muted2)', fontSize: 10 }}> ↻</span>}</> : ''}
                    </td>
                  ))}</tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ maxHeight: 300, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 5 }}>
          {reasons.map(r => (
            <div key={r.key} style={{ padding: '6px 9px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border)', fontSize: 12, lineHeight: 1.5 }}>
              <b>{seatName(r.seat)}</b> <span style={{ fontFamily: 'var(--font-mono), monospace' }}>{r.what}</span>
              {r.auto && <span style={{ marginLeft: 6, fontSize: 10, color: RED, fontWeight: 700 }}>⚠ {t('ch.auto')}</span>}
              {!r.auto && r.retried && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--muted2)' }}>↻ {t('ch.retry')}</span>}
              {r.why && <span style={{ color: 'var(--muted2)' }}> — {r.why}</span>}
            </div>
          ))}
        </div>

        {v.results?.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 12 }}>
            <thead><tr style={{ color: 'var(--muted)', fontSize: 11 }}>
              <th style={{ textAlign: 'left' }}>#</th><th style={{ textAlign: 'left' }}>{t('br.contract')}</th>
              <th>{t('br.tricks')}</th><th>{sideName('NS')}</th><th>{sideName('EW')}</th>
            </tr></thead>
            <tbody>
              {v.results.map((r: any) => (
                <tr key={r.board} style={{ borderTop: '1px solid var(--border)' }}>
                  <td>{r.board}</td>
                  <td>{r.passedOut ? t('br.passedout') : <><CallLabel call={`${r.contract.level}${r.contract.strain}`} />{r.contract.doubled ? ' ' + 'X'.repeat(r.contract.doubled) : ''} {seatName(r.contract.declarer)}</>}</td>
                  <td style={{ textAlign: 'center' }}>{r.passedOut ? '' : r.tricks}</td>
                  <td style={{ textAlign: 'center', fontWeight: r.ns > 0 ? 700 : 400 }}>{r.ns > 0 ? r.ns : ''}</td>
                  <td style={{ textAlign: 'center', fontWeight: r.ew > 0 ? 700 : 400 }}>{r.ew > 0 ? r.ew : ''}</td>
                </tr>
              ))}
              <tr style={{ borderTop: '1.5px solid var(--border2)', fontWeight: 800 }}>
                <td colSpan={3}>{t('br.total')}</td><td style={{ textAlign: 'center' }}>{v.total.NS}</td><td style={{ textAlign: 'center' }}>{v.total.EW}</td>
              </tr>
            </tbody>
          </table>
        )}

        {err && <div style={{ marginTop: 10, color: 'var(--red)', fontSize: 13 }}>⚠ {err}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <button onClick={onExit} style={{ background: 'none', border: '1px solid var(--border2)', borderRadius: 9, padding: '7px 16px', fontSize: 12, color: 'var(--muted)', cursor: 'pointer' }}>← {t('gm.newgame')}</button>
          {v.status === 'active' && (
            <button onClick={() => act({ action: 'end' })} style={{ background: 'none', border: '1px solid var(--border2)', borderRadius: 9, padding: '7px 16px', fontSize: 12, color: 'var(--red)', cursor: 'pointer' }}>{t('pk.end')}</button>
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
      <p style={{ margin: '6px 0 0' }}>{t('br.harness.body').replace('{sec}', '90')}</p>
    </details>
  )
}
