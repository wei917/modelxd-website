'use client'
// app/xgame/DrawLive.tsx — the Draw & Guess table (owner design, Aug 6).
// Two pre-drawn pictures of one secret word, a 45s clock, a host that
// drops hints, a vote for the better drawing — and after five rounds the
// artists take their masks off. All reads: the round images were painted
// offline, so nothing here waits on a model except the host's hint.

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useT, useLang } from '../../lib/i18n'

type ChatLine = { who: 'you' | 'host'; text: string; correct?: boolean }
type HistRound = { n: number; term: string; got: boolean | null; vote: string | null; imgA: string; imgB: string }
type View = {
  id: string; status: string; phase: 'guess' | 'vote' | 'over'; lang: string
  round: number; rounds: number; imgA: string; imgB: string
  term: string | null; tier: string; chat: ChatLine[]; hints: number; maxHints: number
  attempts: number; maxAttempts: number
  got: boolean | null; noMore: boolean; vote: string | null; remainingMs: number
  history: HistRound[]; tally: { A: number; B: number }
  players: Array<{ side: 'A' | 'B'; name: string }>; winner: string | null
}

export default function DrawLive({ resumeId, onExit }: { resumeId?: string | null; onExit: () => void }) {
  const t = useT()
  const { lang } = useLang()
  const router = useRouter()
  const [g, setG] = useState<View | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [hintBusy, setHintBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // The clock: server sends remainingMs; we count down locally and tell
  // the server when it hits zero (the server re-checks — a stalled client
  // can't freeze the round).
  const [left, setLeft] = useState(0)
  const deadlineRef = useRef(0)
  const lastNudgeRef = useRef(0)

  const post = async (body: any): Promise<View | null> => {
    const ctl = new AbortController()
    const tm = setTimeout(() => ctl.abort(), body.action === 'hint' ? 30_000 : 15_000)
    try {
      const res = await fetch('/api/xgame/draw', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: ctl.signal,
      })
      const d = await res.json().catch(() => null)
      if (!res.ok) { setErr(d?.error ?? `HTTP ${res.status}`); return null }
      setErr(null); setG(d)
      deadlineRef.current = Date.now() + (d.remainingMs ?? 0)
      return d
    } catch {
      // NEVER silent (Aug 7, the wedged-round bug): a swallowed failure
      // reads as "nothing happened" and hides a stuck game.
      setErr('Network hiccup — retrying…')
      return null
    }
    finally { clearTimeout(tm) }
  }

  useEffect(() => {
    if (!resumeId) return
    void post({ action: 'state', id: resumeId })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeId])

  // Tick the clock; at zero, nudge the server until the phase flips.
  // The original fired ONCE at local zero — which always landed inside the
  // server's 1.5s expiry grace, was ignored, and was never retried: every
  // quietly-expired round wedged (owner's report, Aug 7). Retrying every
  // 3s clears the grace window on the second nudge at the latest, and
  // also survives a dropped request.
  useEffect(() => {
    if (!g || g.phase !== 'guess') return
    const iv = setInterval(() => {
      const ms = Math.max(0, deadlineRef.current - Date.now())
      setLeft(ms)
      if (ms === 0 && Date.now() - lastNudgeRef.current > 3000) {
        lastNudgeRef.current = Date.now()
        void post({ action: 'timeout', id: g.id })
      }
    }, 250)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g?.id, g?.phase, g?.round])

  const start = async () => {
    if (busy) return
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/xgame/draw', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', lang }),
      })
      const d = await res.json().catch(() => null)
      if (!res.ok || !d?.id) { setErr(d?.error ?? `HTTP ${res.status}`); setBusy(false); return }
      router.push(`/xgame/${d.id}`)
    } catch { setErr('Network error — try again.'); setBusy(false) }
  }

  const sendGuess = async () => {
    const text = input.trim()
    if (!text || !g || g.phase !== 'guess' || busy) return
    setInput(''); setBusy(true)
    const v = await post({ action: 'guess', id: g.id, text })
    if (!v) setInput(text)   // failed send: give the words back
    setBusy(false)
  }

  const askHint = async () => {
    if (!g || hintBusy || g.hints >= g.maxHints || g.phase !== 'guess') return
    setHintBusy(true)
    await post({ action: 'hint', id: g.id })
    setHintBusy(false)
  }

  const vote = async (choice: 'A' | 'B' | 'skip') => {
    if (!g || g.phase !== 'vote' || busy) return
    setBusy(true)
    await post({ action: 'vote', id: g.id, choice })
    setBusy(false)
  }

  // ── start panel (lobby card selected, no game yet) ─────────────────────
  if (!g) {
    if (resumeId) return null
    return (
      <div style={{ marginTop: 18, maxWidth: 560 }}>
        <div style={{ fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 14 }}>
          {t('xg.draw.blurb')}
        </div>
        <button
          onClick={start} disabled={busy}
          style={{ padding: '11px 26px', borderRadius: 10, border: 'none', background: 'var(--red)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1 }}
        >{busy ? '…' : `🎨 ${t('gm.start')}`}</button>
        {err && <div style={{ marginTop: 10, color: 'var(--red)', fontSize: 13 }}>⚠ {err}</div>}
      </div>
    )
  }

  const over = g.status === 'over'
  const secs = Math.ceil(left / 1000)
  const nameOf = (side: 'A' | 'B') => g.players.find(p => p.side === side)?.name ?? side

  const imgFrame = (side: 'A' | 'B') => {
    const src = side === 'A' ? g.imgA : g.imgB
    const votable = g.phase === 'vote' && !g.vote
    const chosen = g.vote === side
    const won = over && g.tally[side] > g.tally[side === 'A' ? 'B' : 'A']
    return (
      <div style={{ flex: '1 1 280px', minWidth: 240, maxWidth: 440 }}>
        <div
          onClick={() => votable && vote(side)}
          style={{
            position: 'relative', borderRadius: 14, overflow: 'hidden',
            border: '2px solid ' + (chosen || won ? 'var(--red)' : 'var(--border)'),
            cursor: votable ? 'pointer' : 'default',
            boxShadow: '0 2px 14px rgba(0,0,0,0.10)',
          }}
        >
          <img src={src} alt="" style={{ width: '100%', display: 'block', aspectRatio: '1', objectFit: 'cover', background: 'var(--surface)' }} />
          <span style={{
            position: 'absolute', top: 10, left: 10, width: 28, height: 28, borderRadius: 8,
            background: 'rgba(0,0,0,0.55)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 900, fontFamily: 'var(--font-mono), monospace', fontSize: 14,
          }}>{side}</span>
          {votable && (
            <span style={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
              background: 'linear-gradient(transparent 65%, rgba(0,0,0,0.45))', color: '#fff',
              paddingBottom: 12, fontSize: 13, fontWeight: 700,
            }}>👍 {side}</span>
          )}
        </div>
        <div style={{ marginTop: 7, textAlign: 'center', fontSize: 12.5, fontWeight: 700, color: won ? 'var(--red)' : 'inherit' }}>
          {over ? `${nameOf(side)} · ${g.tally[side]}` : (side === 'A' ? 'Model A' : 'Model B')}
          {won && ' 🏆'}
        </div>
      </div>
    )
  }

  return (
    <div style={{ marginTop: 16, maxWidth: 940 }}>
      {/* Header: round · clock · running tally */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 800 }}>
          {t('dg.round')} {g.round}/{g.rounds}
        </span>
        {g.phase === 'guess' && (
          <span style={{
            fontFamily: 'var(--font-mono), monospace', fontWeight: 800, fontSize: 15,
            color: secs <= 10 ? 'var(--red)' : 'var(--muted)',
          }}>⏱ 0:{String(secs).padStart(2, '0')}</span>
        )}
        <span style={{ fontSize: 12, fontFamily: 'var(--font-mono), monospace', color: 'var(--muted2)' }}>
          A {g.tally.A} : {g.tally.B} B
        </span>
      </div>

      {/* The two drawings */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {imgFrame('A')}{imgFrame('B')}
      </div>

      {/* ── the round's conversation — stays up through the vote (owner,
          Aug 7: "leave it there"); only the input retires when the clock
          does. It resets when the NEXT round starts: new word, clean
          slate — the host is stateless per round by design. ── */}
      {(g.phase === 'guess' || g.phase === 'vote') && g.chat.length > 0 && (
        <div style={{ marginTop: 14, maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {g.chat.map((c, i) => (
            <div key={i} style={{
              alignSelf: c.who === 'you' ? 'flex-end' : 'flex-start',
              maxWidth: '85%', padding: '7px 12px', borderRadius: 11, fontSize: 13, lineHeight: 1.5,
              background: c.who === 'you' ? (c.correct ? 'var(--green-dim)' : 'var(--surface2)') : 'var(--surface)',
              // A wrong guess gets a VERDICT — the red edge and the ✗.
              // Without it a miss looked like "nothing happened" (the
              // owner literally typed "hello?" at a host who only answers
              // the hint button — Aug 7).
              border: '1px solid ' + (c.correct ? 'var(--green)' : c.who === 'you' ? 'var(--red)' : 'var(--border2)'),
            }}>
              {c.who === 'host' && <strong style={{ marginRight: 6 }}>🎤</strong>}
              {c.text}{c.correct && ' ✓'}
              {c.who === 'you' && !c.correct && <span style={{ color: 'var(--red)', marginLeft: 6 }}>✗</span>}
            </div>
          ))}
        </div>
      )}

      {/* ── guess phase: the input row ── */}
      {g.phase === 'guess' && (
        <div style={{ marginTop: 10, maxWidth: 640 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void sendGuess() }}
              placeholder={t('dg.guessph')}
              style={{ flex: 1, padding: '10px 14px', borderRadius: 10, border: '1.5px solid var(--border2)', background: 'var(--surface)', color: 'var(--white)', fontSize: 14, outline: 'none' }}
            />
            <button onClick={sendGuess} disabled={busy || !input.trim()}
              style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: 'var(--red)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: busy || !input.trim() ? 0.5 : 1 }}>
              {t('dg.guess')} ({g.maxAttempts - g.attempts})
            </button>
            <button onClick={askHint} disabled={hintBusy || g.hints >= g.maxHints}
              title={`${g.maxHints - g.hints}`}
              style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border2)', background: 'none', color: 'var(--muted)', fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: g.hints >= g.maxHints ? 0.4 : 1 }}>
              {hintBusy ? '…' : `💡 ${t('dg.hint')} (${g.maxHints - g.hints})`}
            </button>
          </div>
        </div>
      )}

      {/* ── vote phase: the reveal + the judgment ── */}
      {g.phase === 'vote' && (
        <div style={{
          marginTop: 14, maxWidth: 640, padding: '14px 18px', borderRadius: 12,
          border: '1.5px solid var(--red)', background: 'var(--red-dim)',
        }}>
          <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 4 }}>
            {g.got ? `🎉 ${t('dg.correct')}` : g.noMore ? `🚫 ${t('dg.nomore')}` : `⏰ ${t('dg.timeup')}`} — {t('dg.wordwas')} <span style={{ fontFamily: 'var(--font-display), inherit', fontWeight: 900 }}>{g.term}</span>
          </div>
          {!g.vote && (
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 10 }}>{t('dg.which')}</div>
          )}
          {!g.vote && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => vote('A')} style={{ padding: '9px 22px', borderRadius: 999, border: 'none', background: 'var(--red)', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>A</button>
              <button onClick={() => vote('B')} style={{ padding: '9px 22px', borderRadius: 999, border: 'none', background: 'var(--red)', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>B</button>
              <button onClick={() => vote('skip')} style={{ padding: '9px 18px', borderRadius: 999, border: '1px solid var(--border2)', background: 'none', color: 'var(--muted)', fontWeight: 700, cursor: 'pointer', fontSize: 12.5 }}>{t('dg.skip')}</button>
            </div>
          )}
        </div>
      )}

      {/* ── over: the unmasking + recap ── */}
      {over && (
        <div style={{ marginTop: 16, maxWidth: 640 }}>
          <div style={{
            padding: '16px 20px', borderRadius: 12, border: '1.5px solid var(--red)', background: 'var(--red-dim)',
            display: 'flex', alignItems: 'center', gap: 14,
          }}>
            <span style={{ fontSize: 30 }} aria-hidden>🎭</span>
            <span style={{ flex: 1 }}>
              <span style={{ display: 'block', fontSize: 19, fontWeight: 900, fontFamily: 'var(--font-display), inherit' }}>
                {g.tally.A === g.tally.B
                  ? t('dg.tie')
                  : `${nameOf(g.tally.A > g.tally.B ? 'A' : 'B')} — ${t('dg.better')}`}
              </span>
              <span style={{ fontSize: 12, color: 'var(--muted2)', fontFamily: 'var(--font-mono), monospace' }}>
                {nameOf('A')} {g.tally.A} : {g.tally.B} {nameOf('B')}
              </span>
            </span>
            <button onClick={onExit} style={{ padding: '9px 20px', borderRadius: 999, border: 'none', background: 'var(--red)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', flexShrink: 0 }}>
              {t('gm.newgame')}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
            {g.history.map(h => (
              <div key={h.n} style={{ width: 108, fontSize: 11, textAlign: 'center', color: 'var(--muted)' }}>
                <div style={{ display: 'flex', gap: 2 }}>
                  <img src={h.imgA} alt="" style={{ width: '50%', borderRadius: 6, aspectRatio: '1', objectFit: 'cover', outline: h.vote === 'A' ? '2px solid var(--red)' : 'none' }} />
                  <img src={h.imgB} alt="" style={{ width: '50%', borderRadius: 6, aspectRatio: '1', objectFit: 'cover', outline: h.vote === 'B' ? '2px solid var(--red)' : 'none' }} />
                </div>
                <div style={{ marginTop: 3, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {h.got ? '✓' : '✗'} {h.term}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {err && <div style={{ marginTop: 10, color: 'var(--red)', fontSize: 13 }}>⚠ {err}</div>}
    </div>
  )
}
