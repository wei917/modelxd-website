'use client'
// XCreate's fifth type (owner, Sep 29: "5th top bar", "$7"): a whole film,
// directed and edited by Claude Opus 5.5 in a sandbox, with ModelXD's models
// making the pictures, clips and voice. Two states: the brief composer, and
// one film (?film=<id>) with its progress and, at the end, the video.
//
// While a film is being made this page drives it: every few seconds it asks
// the server for the film, and that request also answers any tool call the
// film is waiting on (lib/film/driver.ts). A closed tab leaves it to the
// per-minute cron.

import { useEffect, useMemo, useState } from 'react'
import { useLang } from '@/lib/i18n'
import ModeIcon from '../components/ModeIcon'
import {
  FILM_ASPECTS, FILM_BRIEF_MAX, FILM_BUDGETS, FILM_DEFAULT_BUDGET, FILM_LENGTHS, isFilmActive,
  isFilmAspect, isFilmBudget, isFilmLength, type FilmAspect, type FilmView,
} from '@/lib/film/config'
import { filmCopy } from './film-copy'

const DRAFT_KEY = 'xcreate.film-draft'
const POLL_MS = 4000
const money = (cents: number) => `$${(Math.max(0, cents) / 100).toFixed(2)}`
/** A budget reads "$7", not "$7.00". */
const dollars = (cents: number) => cents % 100 ? money(cents) : `$${cents / 100}`
const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

type Props = {
  filmId: string | null
  onFilm: (id: string | null) => void
  signedIn: boolean
  /** Opens sign-in; `next` is where to come back to. */
  onSignIn: (next?: string) => void
}

export default function FilmStudio({ filmId, onFilm, signedIn, onSignIn }: Props) {
  const { lang } = useLang()
  const c = filmCopy(lang)

  const [brief, setBrief] = useState('')
  const [aspect, setAspect] = useState<FilmAspect>('9:16')
  const [seconds, setSeconds] = useState<number>(30)
  const [budget, setBudget] = useState<number>(FILM_DEFAULT_BUDGET)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ text: string; topUp: boolean } | null>(null)
  const [view, setView] = useState<FilmView | null>(null)
  const [loadError, setLoadError] = useState<null | 'auth' | 'missing'>(null)
  const [now, setNow] = useState(() => Date.now())

  // The brief survives a sign-in round trip and a trip to another type
  // (per tab, like the studio's own draft).
  useEffect(() => {
    try {
      const d = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? 'null')
      if (!d) return
      if (typeof d.brief === 'string') setBrief(d.brief.slice(0, FILM_BRIEF_MAX))
      if (isFilmAspect(d.aspect)) setAspect(d.aspect)
      if (isFilmLength(d.seconds)) setSeconds(d.seconds)
      if (isFilmBudget(d.budget)) setBudget(d.budget)
    } catch { /* storage unavailable */ }
  }, [])
  useEffect(() => {
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ brief, aspect, seconds, budget })) } catch { /* storage unavailable */ }
  }, [brief, aspect, seconds, budget])

  // Follow (and drive) the film.
  useEffect(() => {
    setView(null)
    setLoadError(null)
    if (!filmId) return
    // The first read happens even in a background tab; after that a hidden
    // tab stops asking (the cron keeps the film moving) and asks again the
    // moment it is looked at.
    let stopped = false
    let finished = false
    let first = true
    let busy = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      if (stopped || finished || busy) return
      if (timer) { clearTimeout(timer); timer = undefined }
      if (first || !document.hidden) {
        first = false
        busy = true
        try {
          const res = await fetch(`/api/xcreate/film/${filmId}`, { method: 'POST' })
          if (res.status === 401 || res.status === 404) {
            finished = true
            if (!stopped) setLoadError(res.status === 401 ? 'auth' : 'missing')
          } else if (res.ok) {
            const v: FilmView = await res.json()
            if (!stopped) setView(v)
            if (!isFilmActive(v.status)) finished = true
          }
        } catch { /* offline for a moment; the next tick retries */ }
        busy = false
      }
      if (!stopped && !finished) timer = setTimeout(tick, POLL_MS)
    }
    const onVisible = () => { if (!document.hidden) void tick() }
    document.addEventListener('visibilitychange', onVisible)
    void tick()
    return () => { stopped = true; if (timer) clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [filmId])

  const active = !!view && isFilmActive(view.status)
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])

  const start = async () => {
    if (!signedIn) { onSignIn(); return }
    const text = brief.trim()
    if (!text || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/xcreate/film', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brief: text, aspect, seconds, budgetCents: budget }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.status === 401) { onSignIn(); return }
      if (!res.ok || typeof body?.id !== 'string') {
        setError({ text: typeof body?.error === 'string' ? body.error : c.startError, topUp: body?.code === 'insufficient_credits' || res.status === 402 })
        return
      }
      setBrief('')
      onFilm(body.id)
    } catch {
      setError({ text: c.startError, topUp: false })
    } finally {
      setBusy(false)
    }
  }

  const another = () => { setError(null); onFilm(null) }
  const retry = () => {
    if (view) {
      setBrief(view.brief)
      if (isFilmAspect(view.aspect)) setAspect(view.aspect)
      if (isFilmLength(view.seconds)) setSeconds(view.seconds)
      if (isFilmBudget(view.budgetCents)) setBudget(view.budgetCents)
    }
    another()
  }

  // One list, oldest first: Claude's own notes and the generations it asked for.
  const steps = useMemo(() => {
    if (!view) return []
    const items: { at: string; key: string; node: React.ReactNode; cls: string }[] = []
    const stepWords: Record<string, string> = { time_limit: c.timeLimit, budget_moved: c.budgetMoved }
    view.progress.forEach((p, i) => {
      const text = p.kind === 'step' ? stepWords[p.text] : p.text
      if (text) items.push({ at: p.at, key: `p${i}`, cls: p.kind === 'error' ? 'is-error' : 'is-note', node: text })
    })
    view.calls.forEach((call, i) => {
      const kind = call.tool === 'generate_image' ? 'image' : call.tool === 'generate_video' ? 'clip' : 'voice'
      const status = call.status === 'running' ? c.working
        : call.status === 'done' ? (!call.costUsd ? '✓' : call.costUsd < 0.005 ? '<$0.01' : money(Math.round(call.costUsd * 100)))
        : call.status === 'refused' ? c.refused : c.callFailed
      items.push({
        at: call.at, key: `c${i}`, cls: `is-call is-${call.status}`,
        node: <>
          <ModeIcon m={kind === 'image' ? 'image' : kind === 'clip' ? 'video' : 'audio'} />
          <span className="xcs-film-call-kind">{c.kinds[kind]}</span>
          {call.name && <code>{call.name}</code>}
          <span className="xcs-film-call-status">{status}</span>
        </>,
      })
    })
    return items.sort((a, b) => a.at.localeCompare(b.at))
  }, [view, c])

  if (filmId) {
    if (loadError) {
      return <section className="xcs-film">
        <div className="xcs-empty" role={loadError === 'missing' ? 'alert' : undefined}>
          {loadError === 'auth'
            ? <button className="xcs-primary" onClick={() => onSignIn(`/?film=${filmId}`)}>{c.signInToView}</button>
            : <><p>{c.loadError}</p><button className="xcs-secondary" onClick={another}>{c.another}</button></>}
        </div>
      </section>
    }
    if (!view) return <section className="xcs-film"><p className="xcs-film-wait" role="status"><span className="xcs-film-spinner" aria-hidden="true" /></p></section>

    const done = view.status === 'done'
    const failed = view.status === 'failed'
    const list = steps.length > 0 && <ol className="xcs-film-steps" aria-label={c.steps}>
      {steps.map(s => <li key={s.key} className={s.cls}>{s.node}</li>)}
    </ol>
    return <section className="xcs-film" aria-live="polite">
      <header className="xcs-film-head">
        <p className="xcs-film-eyebrow"><ModeIcon m="film" /><span>{c.seconds(view.seconds)} · {c.aspects[view.aspect]} · {c.budget} {dollars(view.budgetCents)}</span></p>
        <h1>{done ? c.done : failed ? c.failed : c.making}</h1>
        <p className="xcs-film-brief">{view.brief}</p>
      </header>

      {active && <div className="xcs-film-live" role="status">
        <span className="xcs-film-spinner" aria-hidden="true" />
        <span className="xcs-film-clock">{clock(now - Date.parse(view.createdAt))}</span>
        <span>{c.spent(money(view.spentCents), money(view.budgetCents))}</span>
      </div>}
      {active && <p className="xcs-film-note">{c.time}</p>}

      {done && view.videoUrl && <div className="xcs-film-player" data-aspect={view.aspect}>
        <video src={view.videoUrl} controls playsInline preload="metadata" />
      </div>}
      {done && <div className="xcs-film-actions">
        {view.downloadUrl && <a className="xcs-primary" href={view.downloadUrl}>{c.download}</a>}
        <button className="xcs-secondary" onClick={another}>{c.another}</button>
      </div>}
      {done && view.chargedCents != null && <p className="xcs-film-note">
        {c.charged(money(view.chargedCents), dollars(view.budgetCents), money(view.budgetCents - view.chargedCents))}
      </p>}

      {failed && <>
        {view.error && <p className="xcs-film-error">{(c.errors as Record<string, string>)[view.error] ?? view.error}</p>}
        <p className="xcs-film-note">{c.refunded(dollars(view.budgetCents))}</p>
        <div className="xcs-film-actions">
          <button className="xcs-primary" onClick={retry}>{c.retry}</button>
          <button className="xcs-secondary" onClick={another}>{c.another}</button>
        </div>
      </>}

      {active ? list : list && <details className="xcs-film-more"><summary>{c.steps}</summary>{list}</details>}
      {view.notes && <details className="xcs-film-more"><summary>{c.notes}</summary><pre>{view.notes}</pre></details>}
    </section>
  }

  return <section className="xcs-film" aria-labelledby="xcs-film-title">
    <header className="xcs-heading">
      <h1 id="xcs-film-title">{c.title}</h1>
      <p>{c.subtitle}</p>
    </header>
    <div className="xcs-film-form">
      <label className="xcs-field-heading" htmlFor="xcs-film-brief">{c.briefLabel}</label>
      <div className="xcs-film-box">
        <textarea id="xcs-film-brief" value={brief} maxLength={FILM_BRIEF_MAX} rows={6}
          placeholder={c.placeholder} onChange={e => setBrief(e.target.value)} />
      </div>
      <div className="xcs-film-options">
        <fieldset>
          <legend>{c.shape}</legend>
          <div className="xcs-film-seg">
            {FILM_ASPECTS.map(a => <button key={a} type="button" aria-pressed={aspect === a} onClick={() => setAspect(a)}>{c.aspects[a]}</button>)}
          </div>
        </fieldset>
        <fieldset>
          <legend>{c.length}</legend>
          <div className="xcs-film-seg">
            {FILM_LENGTHS.map(n => <button key={n} type="button" aria-pressed={seconds === n} onClick={() => setSeconds(n)}>{c.seconds(n)}</button>)}
          </div>
        </fieldset>
        <fieldset>
          <legend>{c.budget}</legend>
          <div className="xcs-film-seg">
            {FILM_BUDGETS.map(b => <button key={b} type="button" aria-pressed={budget === b} onClick={() => setBudget(b)}>{dollars(b)}</button>)}
          </div>
        </fieldset>
      </div>
      <p className="xcs-film-note">{c.budgetNote(dollars(budget))} {c.time}</p>
      {error && <p className="xcs-film-error" role="alert">
        {error.text} {error.topUp && <a href="/profile">{c.topUp}</a>}
      </p>}
      <div className="xcs-film-actions">
        <button className="xcs-primary" disabled={busy || (signedIn && !brief.trim())} onClick={start}>
          {busy ? c.starting : signedIn ? c.make(dollars(budget)) : c.signIn}
        </button>
      </div>
    </div>
  </section>
}
