'use client'
// app/components/xtell/XTellAssistant.tsx — the front-door guide on the
// temple street (the XTell door's home only; www keeps its own agent).
//
// A newcomer who does not know 八字 from 紫微 can say what they want in their
// own words. The guide answers, and when a temple room fits it offers a
// button built from the catalog (lib/xtell-catalog.ts), never from text the
// model wrote. Clicking hands the feature id and a prepared question to the
// room (lib/xtell-handoff.ts); nothing is sent, drawn or cast for them.
//
// LandingAgent's patterns, adapted: the thread lives per tab in
// sessionStorage; starter chips once the field is used, and after a decline. And
// one thing LandingAgent does not need: a reply is matched to the request
// that asked for it. Start over, a language switch or leaving the street
// aborts the request in flight and bumps a token, so a late answer cannot
// reappear in a cleared thread (Codex review).
//
// On the homepage (Oct 3, the owner's choice of two placements) it sits
// right under the hero, compact: the heading 「不知道從哪裡開始？問我」, the
// field and the send button. The chips and the note come once the field is
// used, and the conversation grows in the page's flow, never over the cards.

import { useEffect, useId, useRef, useState } from 'react'
import { useLang, useT } from '../../../lib/i18n'
import { XTELL_CATALOG_VERSION, liveFeature, type FeatureId } from '../../../lib/xtell-catalog'
import { cleanQuestion } from '../../../lib/xtell-handoff'

type Action = { feature: string; question: string | null }
type Msg = {
  role: 'user' | 'agent'
  text: string
  /** Catalog version the actions were made under; other versions show none. */
  v?: string
  actions?: Action[]
  offtopic?: boolean
  /** A failure notice in the visitor's language; not sent back as history. */
  error?: boolean
}

const STORE = 'xtell.assistant.chat'
const CHIPS = ['xtell.as.chip.1', 'xtell.as.chip.2', 'xtell.as.chip.3', 'xtell.as.chip.4', 'xtell.as.chip.5'] as const
const MAX_Q = 500
const MAX_KEPT = 40
const MAX_TEXT = 1200

/** Catalog actions only: known live ids, a clean question, two at most. */
export function actionsOf(v: unknown): Action[] {
  if (!Array.isArray(v)) return []
  const out: Action[] = []
  for (const a of v) {
    const f = liveFeature((a as any)?.feature)
    if (!f || out.some(o => o.feature === f.id)) continue
    out.push({ feature: f.id, question: f.question ? cleanQuestion((a as any)?.question) : null })
    if (out.length === 2) break
  }
  return out
}

/** A thread read back from sessionStorage is untrusted (another version,
 *  or edited by hand): rebuilt field by field, bounded, or dropped, so a
 *  bad value can never take the street down (Codex review). */
export function restoredThread(raw: string | null): Msg[] {
  let saved: unknown
  try { saved = raw ? JSON.parse(raw) : null } catch { return [] }
  if (!Array.isArray(saved)) return []
  return saved.slice(-MAX_KEPT).flatMap((m: any): Msg[] => {
    if ((m?.role !== 'user' && m?.role !== 'agent') || typeof m?.text !== 'string' || !m.text.trim()) return []
    const text = m.text.slice(0, MAX_TEXT)
    if (m.role === 'user') return [{ role: 'user', text }]
    return [{
      role: 'agent', text, error: m.error === true, offtopic: m.offtopic === true,
      ...(m.v === XTELL_CATALOG_VERSION ? { v: m.v, actions: actionsOf(m.actions) } : {}),
    }]
  })
}

export default function XTellAssistant({ onOpen }: { onOpen: (feature: FeatureId, question: string | null) => void }) {
  const t = useT()
  const { lang } = useLang()
  const titleId = useId()
  const [q, setQ] = useState('')
  // The field has been used: the chips and the note show from then on (a
  // blur never hides them, or a tap on a chip would miss).
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
  // language, so the request is dropped and the question goes back into the
  // field to be asked again.
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
      const res = await fetch('/api/xtell/assistant', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: question, lang, history }), signal: ctrl.signal,
      })
      const d = await res.json().catch(() => null)
      if (mine !== token.current) return
      if (!res.ok || !d || typeof d.answer !== 'string') {
        say({ role: 'agent', error: true, text: t(res.status === 429 ? 'xtell.as.limited' : d?.error === 'assistant_unreadable' ? 'xtell.as.retry' : 'xtell.as.fail') })
        return
      }
      // The route has checked the ids already; checked again here against
      // THIS page's catalog, so a reply from another deploy offers nothing.
      const actions = d.version === XTELL_CATALOG_VERSION ? actionsOf(d.actions) : []
      say({ role: 'agent', text: d.answer.slice(0, MAX_TEXT), v: XTELL_CATALOG_VERSION, actions, offtopic: d.offtopic === true })
    } catch {
      say({ role: 'agent', error: true, text: t('xtell.as.fail') })
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

  const labelOf = (feature: string) => {
    const f = liveFeature(feature)
    return f ? f.label.map(k => t(k)).join(t('xtell.as.labelSep')) : ''
  }
  const last = msgs[msgs.length - 1]
  const showChips = !busy && (!msgs.length || (last?.role === 'agent' && last.offtopic))

  return (
    <section className="xtell-as" aria-labelledby={titleId}>
      <div className="xtell-as-head">
        <h2 id={titleId} className="xtell-as-title">{t('xtell.as.ask')}</h2>
        {msgs.length > 0 && <button type="button" className="xtell-as-restart" onClick={startOver}>↺ {t('xtell.as.restart')}</button>}
      </div>
      {msgs.length > 0 && (
        <div className="xtell-as-panel" aria-live="polite">
          {msgs.map((m, i) => m.role === 'user'
            ? <div key={i} className="xtell-as-you">{m.text}</div>
            : <div key={i} className={'xtell-as-reply' + (m.error ? ' is-error' : '')}>
                <p>{m.text}</p>
                {m.v === XTELL_CATALOG_VERSION && (m.actions ?? []).length > 0 && (
                  <div className="xtell-as-actions">
                    {(m.actions ?? []).map(a => (
                      <button key={a.feature} type="button" className="xtell-as-go" onClick={() => { cancel(); onOpen(a.feature as FeatureId, a.question) }}>
                        {t('xtell.as.open').replace('{name}', labelOf(a.feature))}<span aria-hidden="true">→</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>)}
          {busy && <div className="xtell-as-reply"><span className="xtell-as-typing" role="status" aria-label={t('xtell.as.asking')}><i /><i /><i /></span></div>}
          <div ref={endRef} />
        </div>
      )}
      {/* The heading asks; the field shows a short example (the long one was
          cut off on a phone). */}
      <form className="xtell-as-field" onSubmit={e => { e.preventDefault(); void send() }}>
        <input value={q} maxLength={MAX_Q} onChange={e => setQ(e.target.value)} onFocus={() => setEngaged(true)}
          placeholder={t('xtell.as.placeholderShort')} aria-labelledby={titleId} />
        <button type="submit" disabled={!q.trim() || busy}>{t('xtell.as.send')}</button>
      </form>
      {showChips && engaged && (
        <div className="xtell-as-chips">
          {CHIPS.map(k => <button key={k} type="button" className="xtell-as-chip" onClick={() => void send(t(k))}>{t(k)}</button>)}
        </div>
      )}
      {(engaged || msgs.length > 0) && <p className="xtell-as-note">{t('xtell.as.note')}</p>}
    </section>
  )
}
