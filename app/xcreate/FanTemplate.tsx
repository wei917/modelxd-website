'use client'
// 風扇變裝 (fan outfit change), the template in 同款's tab (Oct 18; owner:
// "the template card should be in 做同款 tab and a new section besides 影片連結
// and popular videos"; "template needs to be more accurate"). The user gives
// their photo, five outfits, a caption and the music; the run is the method
// in lib/fan-template (one fixed set, our own fan), followed here until the
// video is on its Library item. A run opens again at /xcreate?fan=<id>.

import { useEffect, useRef, useState } from 'react'
import { useLang } from '@/lib/i18n'
import { pendingAttachment, commitAttachments } from '../components/AttachmentButton'
import { DEFAULT_OUTFITS, DEFAULT_TITLE, DEMO, FAN_ABOUT_CENTS, FAN_MUSIC_STYLES, FAN_RESERVE_CENTS, OUTFITS, type FanMusic, type FanMusicStyle } from '@/lib/fan-template/recipe'
import type { FanView } from '@/lib/fan-template/job'
import { fanCopy } from './fan-copy'

const DRAFT_KEY = 'xcreate.fan-draft'
const POLL_MS = 4000
const LANDING = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/landing`
export const FAN_CARD_VIDEO = `${LANDING}/${DEMO.card}`
export const FAN_POSTER = `${LANDING}/${DEMO.poster}`
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`
const tick = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

type Draft = { outfits: string[]; title: string; music: FanMusic['choice']; style: FanMusicStyle; consent: boolean }
type Picked = { url: string; name: string; file: File }

export default function FanTemplate({ signedIn, onSignIn, runId, onRunId, onBack }: {
  signedIn: boolean
  onSignIn: (next?: string) => void
  /** A run to follow (/xcreate?fan=<id>), or null for the form. */
  runId: string | null
  onRunId: (id: string | null) => void
  onBack: () => void
}) {
  const { lang } = useLang()
  const c = fanCopy(lang)
  const [d, setD] = useState<Draft>(() => {
    const base: Draft = { outfits: DEFAULT_OUTFITS[lang] ?? DEFAULT_OUTFITS.en, title: DEFAULT_TITLE[lang] ?? DEFAULT_TITLE.en, music: 'style', style: 'pop', consent: false }
    if (typeof window === 'undefined') return base
    try {
      const saved = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? 'null')
      if (saved && typeof saved === 'object') return {
        ...base, ...saved,
        outfits: Array.from({ length: OUTFITS }, (_, i) => typeof saved.outfits?.[i] === 'string' ? saved.outfits[i] : base.outfits[i]),
        consent: false,
      }
    } catch { /* storage unavailable */ }
    return base
  })
  const set = (patch: Partial<Draft>) => setD(prev => ({ ...prev, ...patch }))
  const [files, setFiles] = useState<Record<string, Picked>>({})
  const [view, setView] = useState<FanView | null>(null)
  const [missing, setMissing] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<{ text: string; topUp: boolean } | null>(null)
  const [now, setNow] = useState(0)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // The photos are never kept; the words and picks follow the tab.
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ outfits: d.outfits, title: d.title, music: d.music, style: d.style })) } catch { /* storage unavailable */ }
  }, [d])

  // Follow a run: the first look even in a background tab, then only while
  // the tab is in front (a look also restarts a pass whose lease ran out).
  useEffect(() => {
    setView(null); setMissing(false)
    if (!runId) return
    let stopped = false, finished = false, first = true, asking = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const look = async () => {
      if (stopped || finished || asking) return
      if (timer) { clearTimeout(timer); timer = undefined }
      if (first || !document.hidden) {
        first = false; asking = true
        try {
          const res = await fetch(`/api/xcreate/remake/fan/${runId}`)
          if (res.status === 401) { finished = true; onSignIn(`/xcreate?fan=${runId}`) }
          else if (res.status === 404) { finished = true; if (!stopped) setMissing(true) }
          else if (res.ok) {
            const v = ((await res.json()) as { job: FanView }).job
            if (!stopped) setView(v)
            if (v.status === 'done' || v.status === 'failed') finished = true
          }
        } catch { /* offline for a moment */ }
        asking = false
      }
      if (!stopped && !finished) timer = setTimeout(look, POLL_MS)
    }
    const onVisible = () => { if (!document.hidden) void look() }
    document.addEventListener('visibilitychange', onVisible)
    void look()
    return () => { stopped = true; if (timer) clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId])

  const active = !!view && view.status !== 'done' && view.status !== 'failed'
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [active])

  const pick = (key: string, file: File | undefined) => {
    if (!file) return
    setFiles(prev => { if (prev[key]) URL.revokeObjectURL(prev[key].url); return { ...prev, [key]: { url: URL.createObjectURL(file), name: file.name, file } } })
  }
  const unpick = (key: string) => setFiles(prev => { if (prev[key]) URL.revokeObjectURL(prev[key].url); const next = { ...prev }; delete next[key]; return next })

  const start = async () => {
    if (starting) return
    if (!signedIn) { onSignIn('/xcreate?fan=new'); return }
    const errs = c.errors
    if (!files.front) { setError({ text: errs.missing_photo, topUp: false }); return }
    if (!d.consent) { setError({ text: errs.consent, topUp: false }); return }
    if (d.outfits.some(o => !o.trim())) { setError({ text: errs.missing_outfit, topUp: false }); return }
    if (d.music === 'mine' && !files.track) { setError({ text: errs.no_track, topUp: false }); return }
    setStarting(true); setError(null)
    try {
      const keys = Object.keys(files).filter(k => k !== 'track' || d.music === 'mine')
      const at: Record<string, string> = {}
      try {
        const up = await commitAttachments(keys.map(k => pendingAttachment(files[k].file, 'xcreate')))
        keys.forEach((k, i) => { at[k] = up[i].storagePath })
      } catch { setError({ text: errs.upload_failed, topUp: false }); return }
      const res = await fetch('/api/xcreate/remake/fan', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          front: at.front, side: at.side, consent: true, title: d.title, language: lang, cardTitle: c.name,
          outfits: d.outfits.map((text, i) => ({ text, ...(at[`o${i}`] ? { photo: at[`o${i}`] } : {}) })),
          music: { choice: d.music, style: d.style, ...(at.track ? { track: at.track } : {}) },
        }),
      })
      if (res.status === 401) { onSignIn('/xcreate?fan=new'); return }
      const body = await res.json().catch(() => ({}))
      if (!res.ok || typeof body?.id !== 'string') {
        const code = String(body?.code ?? '')
        if (code === 'insufficient_credits') setError({ text: c.insufficient(money(Number(body?.requiredCents) || FAN_RESERVE_CENTS), money(Number(body?.balanceCents) || 0)), topUp: true })
        else setError({ text: (errs as Record<string, string>)[code] || errs.start_failed, topUp: false })
        return
      }
      setView(body.job as FanView)
      onRunId(body.id)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch {
      setError({ text: c.errors.start_failed, topUp: false })
    } finally {
      setStarting(false)
    }
  }

  const photoTile = (key: string, label: string, accept = 'image/jpeg,image/png,image/webp') =>
    <label className={`xcs-fan-photo${files[key] ? ' is-on' : ''}`}>
      <span className="xcs-remake-photo-tile">{files[key] ? <img src={files[key].url} alt="" /> : '+'}</span>
      <span>{label}</span>
      <input type="file" accept={accept} hidden onChange={e => { pick(key, e.target.files?.[0]); e.target.value = '' }} />
    </label>

  const header = <>
    <button type="button" className="xcs-fan-back" onClick={onBack}>← {c.back}</button>
    <header className="xcs-heading xcs-fan-head">
      <h1>{c.title}</h1>
      <p>{c.subtitle}</p>
    </header>
  </>

  // ── A run: its progress, then the video
  if (runId) {
    if (missing) return <section className="xcs-film xcs-remake xcs-fan">{header}<p className="xcs-film-error">{c.missingRun}</p></section>
    const done = view?.status === 'done', failed = view?.status === 'failed'
    return <section className="xcs-film xcs-remake xcs-fan" aria-live="polite">
      {header}
      {!view ? <p className="xcs-film-wait" role="status"><span className="xcs-film-spinner" aria-hidden="true" /></p>
        : <div ref={panelRef} className={`xcs-remake-made is-${view.status}`}>
          <p className="xcs-remake-made-head">
            <span className="xcs-remake-made-state">{c.stages[view.status]}</span>
            {active && <span className="xcs-film-clock">{tick(Math.max(0, (now - Date.parse(view.createdAt)) / 1000))}</span>}
          </p>
          {active && <div className="xcs-fan-progress" aria-hidden="true"><b style={{ width: `${Math.min(97, (view.done / Math.max(1, view.total)) * 100)}%` }} /></div>}
          {active && <p className="xcs-remake-made-meta"><span>{c.steps(view.done, view.total)}</span><span>{c.spent(money(view.spentCents), money(view.reservedCents))}</span></p>}
          {done && view.video && <div className="xcs-remake-player"><video src={view.video} controls playsInline preload="metadata" style={{ aspectRatio: '9 / 16' }} /></div>}
          {done && view.download && <a className="xcs-primary xcs-remake-download" href={view.download}>{c.download}</a>}
          {done && <p className="xcs-film-note">{[c.saved, view.chargedCents != null ? c.charged(money(view.chargedCents)) : ''].filter(Boolean).join(lang === 'en' || lang === 'ko' ? ' ' : '')}</p>}
          {failed && <p className="xcs-film-note">{c.failedNote}</p>}
          {(done || failed) && <button type="button" className="xcs-secondary xcs-fan-again" onClick={() => onRunId(null)}>{c.again}</button>}
        </div>}
    </section>
  }

  // ── The form
  return <section className="xcs-film xcs-remake xcs-fan">
    {header}
    <div className="xcs-fan-demo">
      <video src={`${LANDING}/${DEMO.video}`} poster={FAN_POSTER} controls playsInline preload="none" />
    </div>

    <section className="xcs-remake-sec">
      <h2 className="xcs-remake-step"><b aria-hidden="true">01</b>{c.photosLabel}</h2>
      <div className="xcs-fan-photos">
        {photoTile('front', c.front)}
        {photoTile('side', c.side)}
      </div>
      <p className="xcs-film-note">{c.sideNote}</p>
      <label className="xcs-remake-consent">
        <input type="checkbox" checked={d.consent} onChange={e => set({ consent: e.target.checked })} />
        <span>{c.consent}</span>
      </label>
    </section>

    <section className="xcs-remake-sec">
      <h2 className="xcs-remake-step"><b aria-hidden="true">02</b>{c.outfitsLabel}</h2>
      <ol className="xcs-fan-outfits">
        {d.outfits.map((text, i) => <li key={i}>
          <span className="xcs-fan-outfit-n">{c.outfit(i + 1)}</span>
          <input className="xcs-remake-input" value={text} maxLength={60} placeholder={c.outfitPlaceholder} aria-label={c.outfit(i + 1)}
            onChange={e => { const v = e.target.value; setD(prev => ({ ...prev, outfits: prev.outfits.map((o, k) => k === i ? v : o) })) }} />
          {files[`o${i}`]
            ? <span className="xcs-fan-outfit-pic"><img src={files[`o${i}`].url} alt="" /><button type="button" aria-label={c.outfitPhotoClear} onClick={() => unpick(`o${i}`)}>×</button></span>
            : <label className="xcs-fan-outfit-add">+ {c.outfitPhoto}<input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e => { pick(`o${i}`, e.target.files?.[0]); e.target.value = '' }} /></label>}
        </li>)}
      </ol>
    </section>

    <section className="xcs-remake-sec">
      <h2 className="xcs-remake-step"><b aria-hidden="true">03</b>{c.captionLabel}</h2>
      <input className="xcs-remake-input" value={d.title} maxLength={30} aria-label={c.captionLabel} onChange={e => set({ title: e.target.value })} />
      <p className="xcs-film-note">{c.captionNote}</p>
    </section>

    <section className="xcs-remake-sec">
      <h2 className="xcs-remake-step"><b aria-hidden="true">04</b>{c.musicLabel}</h2>
      <div className="xcs-film-seg">
        {(['style', 'mine', 'none'] as const).map(o => <button key={o} type="button" aria-pressed={d.music === o} onClick={() => set({ music: o })}>{c.musicChoices[o]}</button>)}
      </div>
      {d.music === 'style' && <div className="xcs-remake-chips">
        {FAN_MUSIC_STYLES.map(s => <button key={s} type="button" aria-pressed={d.style === s} onClick={() => set({ style: s })}>{c.styles[s]}</button>)}
      </div>}
      {d.music === 'mine' && <div className="xcs-remake-audio">
        <label className="xcs-remake-audio-pick"><span>{files.track?.name ?? c.audioPick}</span>
          <input type="file" accept="audio/*" hidden onChange={e => { pick('track', e.target.files?.[0]); e.target.value = '' }} /></label>
        {files.track && <audio src={files.track.url} controls preload="none" />}
      </div>}
    </section>

    {error && <p className="xcs-film-error" role="alert">{error.text} {error.topUp && <a href="/profile">{c.topUp}</a>}</p>}
    <p className="xcs-film-note xcs-remake-makenote">{c.makeNote(money(FAN_RESERVE_CENTS))}</p>
    <div className="xcs-remake-bar">
      <p className="xcs-remake-bar-sum"><b>{c.about(money(FAN_ABOUT_CENTS))}</b><span>{c.name}</span></p>
      <button className="xcs-primary" disabled={starting} onClick={() => void start()}>{starting ? c.starting : signedIn ? c.make : c.signIn}</button>
    </div>
  </section>
}
