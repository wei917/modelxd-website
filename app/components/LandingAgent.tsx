'use client'
// app/components/LandingAgent.tsx
// The middle of the landing page: a fixed answer panel, with the field
// under it.
//
// The panel's height is RESERVED, not grown. An answer box that expands when
// it replies shoves the hero down the page mid-read, so the first thing a
// visitor experiences is the layout moving under them. Holding the space
// from first paint costs one screenful and makes asking feel like the page
// was always going to answer. The panel scrolls internally once a
// conversation outgrows it; the page itself never reflows. (CC, Aug 5)
//
// The introduction is the agent's FIRST TURN, not a placeholder that gets
// swept away when you type. It says what ModelXD is to someone who has just
// landed, it shows the box talks back, and keeping it in the thread means
// the conversation has a beginning you can scroll back to rather than a
// greeting that vanished the moment it became useful.
//
// Under the intro sit STARTER CHIPS. A blank box that answers anything is
// the hardest kind to start using — the chips turn "what can I even ask"
// into one click, and each one deliberately exercises a different
// destination (free duel, a template, the director, the board) so the first
// answer demonstrates that this thing routes you somewhere rather than just
// talking. They come back after an off-topic decline, where "here is what I
// can actually do" is exactly what the visitor needs. (CC, Aug 5)
//
// Field BELOW the panel on purpose: you read the answer, then reply, so the
// reading order matches the conversation order.

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLang, useT } from '../../lib/i18n'

type Msg = {
  role: 'user' | 'agent'
  text: string
  route?: string | null
  routeLabel?: string | null
  /** The seeded greeting. Flagged so a language switch can re-render it
   *  while a conversation is still untouched. */
  intro?: boolean
  /** Set when the agent declined an off-topic question. Brings the starter
   *  chips back, so a refusal still leaves the visitor with somewhere to go. */
  offtopic?: boolean
}

// Per-TAB, not per-browser: following a link and pressing Back should return
// you to the conversation you were having, but a thread from three days ago
// reappearing on a fresh visit would be startling. sessionStorage is exactly
// that lifetime. (CC, Aug 5)
const STORE = 'modelxd.landing.chat'

const CHIPS = ['la.chip.duel', 'la.chip.bg', 'la.chip.ad', 'la.chip.price'] as const

export default function LandingAgent() {
  const t = useT()
  const { lang } = useLang()
  const router = useRouter()
  const [q, setQ] = useState('')
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [busy, setBusy] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  // Restore first, so the seeding effect below sees a real conversation and
  // leaves it alone.
  const [restored, setRestored] = useState(false)
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORE)
      if (raw) {
        const saved = JSON.parse(raw)
        if (Array.isArray(saved) && saved.length) setMsgs(saved)
      }
    } catch { /* private mode, corrupt value — start fresh */ }
    setRestored(true)
  }, [])

  // Seed the greeting, and keep it in the reader's language until they
  // actually say something — after that the thread is history and must not
  // be rewritten under them.
  useEffect(() => {
    if (!restored) return
    setMsgs(m => (m.length === 0 || (m.length === 1 && m[0].intro))
      ? [{ role: 'agent', text: t('la.intro'), intro: true }]
      : m)
  }, [lang, t, restored])

  // Persist every turn. Skipped until restore has run so the empty initial
  // state cannot overwrite a saved thread.
  useEffect(() => {
    if (!restored) return
    try {
      if (msgs.length > 1) sessionStorage.setItem(STORE, JSON.stringify(msgs))
      else sessionStorage.removeItem(STORE)
    } catch { /* quota or private mode — persistence is a nicety */ }
  }, [msgs, restored])

  const startOver = () => {
    try { sessionStorage.removeItem(STORE) } catch { /* ignore */ }
    setMsgs([{ role: 'agent', text: t('la.intro'), intro: true }])
    setQ('')
  }

  // Keep the newest turn in view INSIDE the panel. block:'nearest' so the
  // page itself is never scrolled by this.
  useEffect(() => {
    if (msgs.length) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [msgs.length, busy])

  /** `text` is passed by the starter chips; the field uses its own state. */
  const send = async (text?: string) => {
    const question = (text ?? q).trim()
    if (!question || busy) return
    setQ('')
    setBusy(true)
    const history = msgs.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }))
    setMsgs(m => [...m, { role: 'user', text: question }])
    try {
      const res = await fetch('/api/agent/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: question, lang, history }),
      })
      if (!res.ok) throw new Error(String(res.status))
      const d = await res.json()
      // The destination arrives fully formed — the API composes the href from
      // an allow-listed surface plus a validated template id, so there is
      // nothing left here to assemble or to get wrong.
      setMsgs(m => [...m, {
        role: 'agent', text: d.answer,
        route: d.route, routeLabel: d.routeLabel, offtopic: d.offtopic,
      }])
    } catch {
      setMsgs(m => [...m, { role: 'agent', text: t('omni.askfail') }])
    } finally {
      setBusy(false)
    }
  }

  // More than the greeting means there is something worth clearing.
  const hasChat = msgs.length > 1
  const last = msgs[msgs.length - 1]
  // Chips belong on the empty state and after a decline — never mid-answer,
  // where they would compete with the destination button.
  const showChips = !busy && !!last && last.role === 'agent' && (last.intro || last.offtopic)

  return (
    <div className="la-wrap">
      {/* Reserved. Same height empty, introducing, or mid-conversation. */}
      <div className="la-panel">
        {msgs.map((m, i) => (
          m.role === 'user' ? (
            <div key={i} className="la-row la-row-you">
              <div className="la-you">{m.text}</div>
            </div>
          ) : (
            <div key={i} className="la-row">
              <span className="la-mark" aria-hidden>XD</span>
              <div className={`la-agent${m.intro ? ' la-intro' : ''}`}>
                {m.intro && <div className="la-badge">{t('la.badge')}</div>}
                <div className="la-agent-text">{m.text}</div>
                {m.route && (
                  <button className="la-go" onClick={() => router.push(m.route as string)}>
                    {t('omni.goto').replace('{n}', m.routeLabel ?? '')}
                    <span className="la-go-arrow" aria-hidden>→</span>
                  </button>
                )}
              </div>
            </div>
          )
        ))}
        {busy && (
          <div className="la-row">
            <span className="la-mark" aria-hidden>XD</span>
            <div className="la-agent">
              <div className="la-typing" aria-label={t('omni.asking')}>
                <i /><i /><i />
              </div>
            </div>
          </div>
        )}
        {showChips && (
          <div className="la-chips">
            {CHIPS.map(k => (
              <button key={k} className="la-chip" onClick={() => void send(t(k))}>
                {t(k)}
              </button>
            ))}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form className="la-field" onSubmit={e => { e.preventDefault(); void send() }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="la-icon">
          <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
        </svg>
        <input
          className="la-input"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder={t('omni.hero')}
          aria-label={t('omni.hero')}
        />
        <button type="submit" className="la-send" disabled={!q.trim() || busy} aria-label={t('omni.ask')}>
          {busy ? '◐' : '→'}
        </button>
      </form>

      <div className="la-hint">
        {hasChat ? (
          <button className="la-restart" onClick={startOver}>↺ {t('la.startover')}</button>
        ) : t('omni.hero.hint')}
      </div>
    </div>
  )
}
