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
  /** The question that produced this answer, kept so a route into the
   *  director can carry the request with it. */
  askedQ?: string
}

// Per-TAB, not per-browser: following a link and pressing Back should return
// you to the conversation you were having, but a thread from three days ago
// reappearing on a fresh visit would be startling. sessionStorage is exactly
// that lifetime. (CC, Aug 5)
const STORE = 'modelxd.landing.chat'

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

  const send = async () => {
    const question = q.trim()
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
      setMsgs(m => [...m, { role: 'agent', text: d.answer, route: d.route, routeLabel: d.routeLabel, askedQ: question }])
    } catch {
      setMsgs(m => [...m, { role: 'agent', text: t('omni.askfail') }])
    } finally {
      setBusy(false)
    }
  }

  /** A route into the director carries the original request, so the user
   *  does not have to retype the thing they just asked for. */
  const hrefFor = (m: Msg) =>
    m.route === '/xcreate?agent=1' && m.askedQ
      ? `/xcreate?agent=1&q=${encodeURIComponent(m.askedQ)}`
      : (m.route as string)

  // More than the greeting means there is something worth clearing.
  const hasChat = msgs.length > 1

  return (
    <div className="la-wrap">
      {/* Reserved. Same height empty, introducing, or mid-conversation. */}
      <div className="la-panel">
        {msgs.map((m, i) => (
          m.role === 'user' ? (
            <div key={i} className="la-you">{m.text}</div>
          ) : (
            <div key={i} className={`la-agent${m.intro ? ' la-intro' : ''}`}>
              <div className="la-agent-text">{m.text}</div>
              {m.route && (
                <button className="la-go" onClick={() => router.push(hrefFor(m))}>
                  {t('omni.goto').replace('{n}', m.routeLabel ?? '')} →
                </button>
              )}
            </div>
          )
        ))}
        {busy && (
          <div className="la-agent">
            <div className="la-agent-text la-dim">{t('omni.asking')}</div>
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
