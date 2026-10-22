'use client'
// app/xgame/XGameGuide.tsx — the guide box on XGame's landing page (Oct 22;
// owner: "you should add the guide chat box, same as XOracle"). X先知's
// XOracleAssistant for games, in its look (.xoracle-as, globals.css): right under
// the slideshow, the question 「不知道玩什麼？問問嚮導」, the field and the
// send button; the starter chips and the note once the field is used; the
// conversation grows in the page's flow. An answer may offer up to two games
// (by key, from /api/xgame/guide); the buttons are built from
// lib/xgame-games.ts and open the game's tab, never starting a game.
//
// XOracleAssistant's patterns, kept: the thread lives per tab in
// sessionStorage, rebuilt field by field; a reply is matched to the request
// that asked for it (start over or a language switch drops a late answer).

import { useEffect, useId, useRef, useState } from 'react'
import { useLang } from '../../lib/i18n'
import { GAME_NAME_KEY, isGameKey, type GameKey } from '../../lib/xgame-games'

type Msg = { role: 'user' | 'agent'; text: string; games?: GameKey[]; offtopic?: boolean; error?: boolean }

const STORE = 'xgame.guide.chat'
const CHIPS = ['xg.guide.chip.1', 'xg.guide.chip.2', 'xg.guide.chip.3', 'xg.guide.chip.4'] as const
const MAX_Q = 500
const MAX_KEPT = 40
const MAX_TEXT = 1200

const gamesOf = (v: unknown): GameKey[] =>
  Array.isArray(v) ? v.filter(isGameKey).filter((g, i, all) => all.indexOf(g) === i).slice(0, 2) : []

/** A thread read back from sessionStorage is untrusted: rebuilt field by
 *  field, bounded, or dropped (as X先知's guide). */
function restoredThread(raw: string | null): Msg[] {
  let saved: unknown
  try { saved = raw ? JSON.parse(raw) : null } catch { return [] }
  if (!Array.isArray(saved)) return []
  return saved.slice(-MAX_KEPT).flatMap((m: any): Msg[] => {
    if ((m?.role !== 'user' && m?.role !== 'agent') || typeof m?.text !== 'string' || !m.text.trim()) return []
    const text = m.text.slice(0, MAX_TEXT)
    if (m.role === 'user') return [{ role: 'user', text }]
    return [{ role: 'agent', text, games: gamesOf(m.games), offtopic: m.offtopic === true, error: m.error === true }]
  })
}

export default function XGameGuide({ onOpen }: { onOpen: (game: GameKey) => void }) {
  const { lang, t } = useLang()
  const titleId = useId()
  const [q, setQ] = useState('')
  const [engaged, setEngaged] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [busy, setBusy] = useState(false)
  const [restored, setRestored] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const token = useRef(0)
  const inflight = useRef<AbortController | null>(null)
  const pending = useRef<string | null>(null)

  /** Drop whatever is in flight: its answer, if it still arrives, is ignored. */
  const cancel = () => {
    token.current++
    inflight.current?.abort()
    inflight.current = null
    pending.current = null
  }

  useEffect(() => {
    try { setMsgs(restoredThread(sessionStorage.getItem(STORE))) } catch { /* private mode: start fresh */ }
    setRestored(true)
    return cancel
  }, [])

  useEffect(() => {
    if (!restored) return
    try {
      if (msgs.length) sessionStorage.setItem(STORE, JSON.stringify(msgs))
      else sessionStorage.removeItem(STORE)
    } catch { /* persistence is a convenience */ }
  }, [msgs, restored])

  // A language switch mid-question: the answer would come back in the old
  // language, so the question goes back into the field to be asked again.
  const langSeen = useRef(lang)
  useEffect(() => {
    if (langSeen.current === lang) return
    langSeen.current = lang
    if (!pending.current) return
    const question = pending.current
    cancel()
    setBusy(false)
    setMsgs(m => (m.length && m[m.length - 1].role === 'user' && m[m.length - 1].text === question ? m.slice(0, -1) : m))
    setQ(question)
  }, [lang])

  useEffect(() => {
    if (msgs.length || busy) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [msgs.length, busy])

  const send = async (text?: string) => {
    const question = (text ?? q).trim().slice(0, MAX_Q)
    if (!question || busy) return
    cancel()
    const mine = token.current
    const ctrl = new AbortController()
    inflight.current = ctrl
    pending.current = question
    const history = msgs.filter(m => !m.error).slice(-8).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }))
    setQ('')
    setBusy(true)
    setMsgs(m => [...m, { role: 'user', text: question }])
    const say = (m: Msg) => { if (mine === token.current) setMsgs(list => [...list, m]) }
    try {
      const res = await fetch('/api/xgame/guide', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: question, lang, history }), signal: ctrl.signal,
      })
      const d = await res.json().catch(() => null)
      if (mine !== token.current) return
      if (!res.ok || !d || typeof d.answer !== 'string') {
        say({ role: 'agent', error: true, text: t(res.status === 429 ? 'xoracle.as.limited' : d?.error === 'guide_unreadable' ? 'xoracle.as.retry' : 'xoracle.as.fail') })
        return
      }
      say({ role: 'agent', text: d.answer.slice(0, MAX_TEXT), games: gamesOf(d.games), offtopic: d.offtopic === true })
    } catch {
      say({ role: 'agent', error: true, text: t('xoracle.as.fail') })
    } finally {
      if (mine === token.current) { setBusy(false); inflight.current = null; pending.current = null }
    }
  }

  const startOver = () => {
    cancel()
    setBusy(false)
    setMsgs([])
    setQ('')
    try { sessionStorage.removeItem(STORE) } catch { /* ignore */ }
  }

  const last = msgs[msgs.length - 1]
  const showChips = !busy && (!msgs.length || (last?.role === 'agent' && last.offtopic))

  return (
    <section className="xoracle-as xgame-guide" aria-labelledby={titleId}>
      <div className="xoracle-as-head">
        <h2 id={titleId} className="xoracle-as-title">{t('xg.guide.ask')}</h2>
        {msgs.length > 0 && <button type="button" className="xoracle-as-restart" onClick={startOver}>↺ {t('xoracle.as.restart')}</button>}
      </div>
      {msgs.length > 0 && (
        <div className="xoracle-as-panel" aria-live="polite">
          {msgs.map((m, i) => m.role === 'user'
            ? <div key={i} className="xoracle-as-you">{m.text}</div>
            : <div key={i} className={'xoracle-as-reply' + (m.error ? ' is-error' : '')}>
                <p>{m.text}</p>
                {(m.games ?? []).length > 0 && (
                  <div className="xoracle-as-actions">
                    {(m.games ?? []).map(g => (
                      <button key={g} type="button" className="xoracle-as-go" onClick={() => { cancel(); onOpen(g) }}>
                        {t('xoracle.as.open').replace('{name}', t(GAME_NAME_KEY[g]))}<span aria-hidden="true">→</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>)}
          {busy && <div className="xoracle-as-reply"><span className="xoracle-as-typing" role="status" aria-label={t('xoracle.as.asking')}><i /><i /><i /></span></div>}
          <div ref={endRef} />
        </div>
      )}
      <form className="xoracle-as-field" onSubmit={e => { e.preventDefault(); void send() }}>
        <input value={q} maxLength={MAX_Q} onChange={e => setQ(e.target.value)} onFocus={() => setEngaged(true)}
          placeholder={t('xg.guide.ph')} aria-labelledby={titleId} />
        <button type="submit" disabled={!q.trim() || busy}>{t('xoracle.as.send')}</button>
      </form>
      {showChips && engaged && (
        <div className="xoracle-as-chips">
          {CHIPS.map(k => <button key={k} type="button" className="xoracle-as-chip" onClick={() => void send(t(k))}>{t(k)}</button>)}
        </div>
      )}
      {(engaged || msgs.length > 0) && <p className="xoracle-as-note">{t('xg.guide.note')}</p>}
    </section>
  )
}
