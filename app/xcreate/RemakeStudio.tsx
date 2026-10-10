'use client'
// 同款 (Remake), XCreate's sixth type (owner, Oct 10: "paste a link to do the
// same video。做同款。 但是換掉人物或主角 主題 背景"). Phase 1: paste a link or
// upload a video, read it into a shot list (/api/xcreate/remake/breakdown),
// pick the length and what to swap. Making the remake is phase 2, so the
// make button waits. Plan: docs/REMAKE-PLAN.md.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useLang, type Lang } from '@/lib/i18n'
import { createSupabaseBrowser } from '@/lib/supabase-client'
import { pendingAttachment, commitAttachments } from '../components/AttachmentButton'
import ModeIcon from '../components/ModeIcon'
import {
  REMAKE_LENGTHS, REMAKE_LOOKS, estimateRemakeCents,
  type BreakdownResult, type CastChoice, type RemakeLook,
} from '@/lib/remake/config'
import { remakeCopy, REMAKE_LANGUAGES } from './remake-copy'

const DRAFT_KEY = 'xcreate.remake-draft'
const MAX_VIDEO_BYTES = 300_000_000
const CAST_CHOICES: CastChoice[] = ['keep', 'photo', 'describe', 'famous']
const money = (cents: number) => `$${(cents / 100).toFixed(cents >= 1000 ? 0 : 2)}`
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

type CastPick = { choice: CastChoice; text: string; consent: boolean; photo?: string }
const withoutPhotos = (cast: Record<string, CastPick>): Record<string, CastPick> =>
  Object.fromEntries(Object.entries(cast).map(([k, v]) => [k, { ...v, photo: undefined }]))
type Draft = {
  link: string
  start: number
  result: BreakdownResult | null
  length: number
  fromShot: number
  cast: Record<string, CastPick>
  theme: string
  setting: string
  look: RemakeLook
  language: Lang
}

export default function RemakeStudio({ signedIn, onSignIn }: {
  signedIn: boolean
  /** Opens sign-in; `next` is where to come back to. */
  onSignIn: (next?: string) => void
}) {
  const { lang } = useLang()
  const c = remakeCopy(lang)
  const listSep = lang === 'en' || lang === 'ko' ? ', ' : '、'
  const colon = lang === 'en' || lang === 'ko' ? ': ' : '：'
  // The read and the choices survive a sign-in round trip and a trip to
  // another type (per tab, like the film's brief). Read before the first
  // draw: restoring in an effect let the save below write the empty draft
  // over the stored one first. Photos are never stored, only their choice.
  const [d, setD] = useState<Draft>(() => {
    const base: Draft = { link: '', start: 0, result: null, length: 30, fromShot: 0, cast: {}, theme: '', setting: '', look: 'keep', language: lang }
    if (typeof window === 'undefined') return base
    try {
      const saved = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? 'null')
      if (saved && typeof saved === 'object') return { ...base, ...saved, cast: withoutPhotos(saved.cast ?? {}) }
    } catch { /* storage unavailable */ }
    return base
  })
  const set = (patch: Partial<Draft>) => setD(prev => ({ ...prev, ...patch }))
  const [stage, setStage] = useState<'idle' | 'uploading' | 'reading'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [productPhoto, setProductPhoto] = useState<string | null>(null)
  const [allShots, setAllShots] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ ...d, cast: withoutPhotos(d.cast) })) } catch { /* storage unavailable */ }
  }, [d])

  const busy = stage !== 'idle'
  const errorText = (body: any): string => {
    const code = String(body?.code ?? '')
    if (code === 'upload_only') return c.uploadOnly(String(body?.platform ?? ''))
    if (code === 'daily_cap') return c.dailyCap(Number(body?.cap) || 10)
    return (c.errors as Record<string, string>)[code] ?? c.errors.read_failed
  }

  const read = async (payload: { url?: string; uploadPath?: string; seconds?: number }) => {
    setStage('reading'); setError(null)
    try {
      const res = await fetch('/api/xcreate/remake/breakdown', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...payload, start: d.start || 0, lang }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.status === 401) { onSignIn('/?type=remake'); return }
      if (!res.ok || !body?.breakdown) { setError(errorText(body)); return }
      const r = body as BreakdownResult
      const dur = r.breakdown.duration
      set({
        result: r, fromShot: 0,
        length: dur <= 15 ? 0 : dur <= 30 ? 15 : 30,
        cast: Object.fromEntries(r.breakdown.characters.map(ch => [ch.id, { choice: 'keep', text: '', consent: false }])),
      })
    } catch {
      setError(c.errors.read_failed)
    } finally {
      setStage('idle')
    }
  }

  const readLink = () => {
    if (!signedIn) { onSignIn('/?type=remake'); return }
    if (!d.link.trim() || busy) return
    void read({ url: d.link.trim() })
  }

  const uploadAndRead = async (file: File) => {
    const { data } = await createSupabaseBrowser().auth.getUser()
    if (!data.user) { onSignIn('/?type=remake'); return }
    if (file.size > MAX_VIDEO_BYTES) { setError(c.errors.too_large); return }
    setStage('uploading'); setError(null)
    try {
      // Its length plans the read's one-minute pieces on the server.
      const seconds = await new Promise<number>(resolve => {
        const v = document.createElement('video')
        const src = URL.createObjectURL(file)
        const done = (n: number) => { URL.revokeObjectURL(src); resolve(Number.isFinite(n) ? n : 0) }
        v.preload = 'metadata'; v.onloadedmetadata = () => done(v.duration); v.onerror = () => done(0); v.src = src
      })
      const [att] = await commitAttachments([pendingAttachment(file, 'xcreate')])
      await read({ uploadPath: att.storagePath, seconds })
    } catch {
      setError(c.errors.read_failed); setStage('idle')
    }
  }

  const b = d.result?.breakdown ?? null
  const roles = useMemo(() => new Map((b?.characters ?? []).map(ch => [ch.id, ch.role])), [b])
  /** The model writes "C1 grips his head"; the page says who C1 is. */
  const named = (text: string) => text.replace(/\b[cC](\d{1,2})\b/g, (m, n) => roles.get(`c${n}`) ?? m)
  const SHOTS_FIRST = 6
  // The main characters first (by shots they are in); one-shot extras, like
  // a crowd's faces, fold away so the people who matter are not buried.
  const castOrder = useMemo(() => {
    const n = new Map<string, number>()
    for (const s of b?.shots ?? []) for (const w of s.who) n.set(w, (n.get(w) ?? 0) + 1)
    const sorted = [...(b?.characters ?? [])].sort((x, y) => (n.get(y.id) ?? 0) - (n.get(x.id) ?? 0))
    const main = sorted.filter((ch, i) => i < 2 || (n.get(ch.id) ?? 0) >= 2)
    return { main, extra: sorted.filter(ch => !main.includes(ch)) }
  }, [b])
  const fromT = b ? b.shots[Math.min(d.fromShot, b.shots.length - 1)]?.t0 ?? 0 : 0
  const remaining = b ? Math.max(1, Math.round(b.duration - fromT)) : 0
  const lengths = b ? REMAKE_LENGTHS.filter(n => n === 0 || n < remaining) : []
  const chosenSeconds = d.length === 0 || d.length >= remaining ? remaining : d.length
  const price = money(estimateRemakeCents(chosenSeconds))
  const setCast = (id: string, patch: Partial<CastPick>) =>
    set({ cast: { ...d.cast, [id]: { ...(d.cast[id] ?? { choice: 'keep', text: '', consent: false }), ...patch } } })
  const pickPhoto = (id: string, file: File | undefined) => {
    if (!file) return
    setCast(id, { photo: URL.createObjectURL(file) })
  }

  const castCard = (ch: { id: string; role: string; look: string }) => {
    const pick = d.cast[ch.id] ?? { choice: 'keep' as CastChoice, text: '', consent: false }
    return <fieldset key={ch.id} className="xcs-remake-cast">
      <legend>{ch.role}</legend>
      <p className="xcs-film-note">{ch.look}</p>
      <div className="xcs-film-seg">
        {CAST_CHOICES.map(choice => <button key={choice} type="button" aria-pressed={pick.choice === choice}
          onClick={() => setCast(ch.id, { choice })}>{c.cast[choice]}</button>)}
      </div>
      {(pick.choice === 'describe' || pick.choice === 'famous') && <input className="xcs-remake-input" value={pick.text} maxLength={200}
        placeholder={pick.choice === 'describe' ? c.describePlaceholder : c.famousPlaceholder}
        onChange={e => setCast(ch.id, { text: e.target.value })} />}
      {pick.choice === 'photo' && <div className="xcs-remake-photo">
        <label className="xcs-secondary">
          {c.photoPick}
          <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e => pickPhoto(ch.id, e.target.files?.[0])} />
        </label>
        {pick.photo && <img src={pick.photo} alt="" />}
        <label className="xcs-remake-consent">
          <input type="checkbox" checked={pick.consent} onChange={e => setCast(ch.id, { consent: e.target.checked })} />
          <span>{c.photoConsent}</span>
        </label>
      </div>}
    </fieldset>
  }

  return <section className="xcs-film xcs-remake" aria-labelledby="xcs-remake-title">
    <header className="xcs-heading">
      <h1 id="xcs-remake-title">{c.title}</h1>
      <p>{c.subtitle}</p>
    </header>

    <div className="xcs-film-form">
      <label className="xcs-field-heading" htmlFor="xcs-remake-link">{c.linkLabel}</label>
      <div className="xcs-film-box xcs-remake-link">
        <input id="xcs-remake-link" type="url" inputMode="url" autoComplete="off" value={d.link} disabled={busy}
          placeholder={c.placeholder} onChange={e => set({ link: e.target.value })}
          onKeyDown={e => { if (e.key === 'Enter') readLink() }} />
      </div>
      <details className="xcs-remake-start">
        <summary>{c.startAt}</summary>
        <input type="number" min={0} step={1} inputMode="numeric" value={d.start || ''} placeholder="0" disabled={busy}
          onChange={e => set({ start: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
        <p className="xcs-film-note">{c.startHint}</p>
      </details>
      <div className="xcs-film-actions">
        <button className="xcs-primary" disabled={busy || (signedIn && !d.link.trim())} onClick={readLink}>
          {stage === 'reading' ? c.reading : signedIn ? c.read : c.signIn}
        </button>
        <button className="xcs-secondary" disabled={busy} onClick={() => signedIn ? fileRef.current?.click() : onSignIn('/?type=remake')}>
          {stage === 'uploading' ? c.uploading : c.upload}
        </button>
        <input ref={fileRef} type="file" accept="video/mp4,video/quicktime,video/webm" hidden
          onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void uploadAndRead(f) }} />
      </div>
      <p className="xcs-film-note">{c.orUpload}</p>
      {stage === 'reading' && <p className="xcs-film-live" role="status"><span className="xcs-film-spinner" aria-hidden="true" />{c.reading}</p>}
      {error && <p className="xcs-film-error" role="alert">{error}</p>}
    </div>

    {b && d.result && <div className="xcs-remake-read" aria-live="polite">
      <header className="xcs-film-head">
        <p className="xcs-film-eyebrow"><ModeIcon m="remake" /><span>{c.shots(b.shots.length, String(Math.round(b.duration)))} · {b.aspect}</span></p>
        <h2 className="xcs-remake-title">{b.title}</h2>
        <p className="xcs-film-brief">{named(b.summary)}</p>
        <p className="xcs-film-note">{c.left(d.result.left)}</p>
      </header>

      <dl className="xcs-remake-facts">
        <div><dt>{c.look}</dt><dd>{[b.look.style, b.look.palette, b.look.light].filter(Boolean).join(' · ')}</dd></div>
        {b.characters.length > 0 && <div><dt>{c.characters}</dt><dd>{b.characters.map(ch => ch.role).join(listSep)}</dd></div>}
        {b.music.present && <div><dt>{c.music}</dt><dd>{c.musicLine(b.music.mood, b.music.bpm, b.music.cuts_on_beat)}</dd></div>}
      </dl>

      <ol className="xcs-remake-shots">
        {b.shots.slice(0, allShots ? undefined : SHOTS_FIRST).map((s, i) => <li key={i} className={i < d.fromShot ? 'is-skipped' : undefined}>
          <p className="xcs-remake-shot-meta">
            <span className="xcs-remake-shot-n">{i + 1}</span>
            <span>{clock(s.t0)}–{clock(s.t1)}</span>
            <span>{c.framing[s.framing] ?? s.framing}</span>
            {s.camera && <span>{s.camera}</span>}
            {s.transition_in && s.transition_in !== 'cut' && <span className="xcs-remake-shot-tr">{c.transitions[s.transition_in] ?? s.transition_in}</span>}
          </p>
          <p className="xcs-remake-shot-action">{named(s.action)}</p>
          {(s.who.length > 0 || s.where) && <p className="xcs-remake-shot-where">{[s.who.map(w => roles.get(w) ?? w).join(listSep), s.where].filter(Boolean).join(' · ')}</p>}
          {s.text && <p className="xcs-remake-shot-text">「{s.text}」</p>}
        </li>)}
      </ol>
      {b.shots.length > SHOTS_FIRST && <button type="button" className="xcs-secondary xcs-remake-more" onClick={() => setAllShots(v => !v)}>
        {allShots ? c.showLess : c.showAll(b.shots.length)}
      </button>}

      {b.lines.length > 0 && <details className="xcs-film-more">
        <summary>{c.lines} ({b.lines.length})</summary>
        <ul className="xcs-remake-lines">{b.lines.map((l, i) => <li key={i}><span>{clock(l.t)}</span> {roles.get(l.who) ?? l.who}{colon}{l.text}</li>)}</ul>
      </details>}

      <div className="xcs-film-options xcs-remake-length">
        <fieldset>
          <legend>{c.lengthLabel}</legend>
          <div className="xcs-film-seg">
            {lengths.map(n => {
              const secs = n === 0 ? remaining : n
              return <button key={n} type="button" aria-pressed={chosenSeconds === secs} onClick={() => set({ length: n })}>
                <span>{n === 0 ? c.whole(remaining) : c.seconds(n)}</span>
                <small>{c.about(money(estimateRemakeCents(secs)))}</small>
              </button>
            })}
          </div>
        </fieldset>
        <fieldset>
          <legend>{c.fromShot}</legend>
          <select className="xcs-remake-select" value={d.fromShot} onChange={e => set({ fromShot: Number(e.target.value) })}>
            {b.shots.map((s, i) => <option key={i} value={i}>{i + 1} · {clock(s.t0)} · {named(s.action).slice(0, 28)}</option>)}
          </select>
        </fieldset>
      </div>

      <h2 className="xcs-remake-h">{c.swapHeading}</h2>
      <div className="xcs-remake-swaps">
        {castOrder.main.map(ch => castCard(ch))}
        {castOrder.extra.length > 0 && <details className="xcs-film-more xcs-remake-extra">
          <summary>{c.otherCast(castOrder.extra.length)}</summary>
          <div className="xcs-remake-swaps">{castOrder.extra.map(ch => castCard(ch))}</div>
        </details>}

        <label className="xcs-remake-field">
          <span>{c.theme}</span>
          <input className="xcs-remake-input" value={d.theme} maxLength={300} placeholder={c.themePlaceholder} onChange={e => set({ theme: e.target.value })} />
        </label>
        <label className="xcs-remake-field">
          <span>{c.setting}</span>
          <input className="xcs-remake-input" value={d.setting} maxLength={300} placeholder={c.settingPlaceholder} onChange={e => set({ setting: e.target.value })} />
        </label>
        <fieldset className="xcs-remake-field">
          <legend>{c.lookLabel}</legend>
          <div className="xcs-film-seg">
            {REMAKE_LOOKS.map(l => <button key={l} type="button" aria-pressed={d.look === l} onClick={() => set({ look: l })}>{c.looks[l]}</button>)}
          </div>
        </fieldset>
        <label className="xcs-remake-field">
          <span>{c.language}</span>
          <select className="xcs-remake-select" value={d.language} onChange={e => set({ language: e.target.value as Lang })}>
            {REMAKE_LANGUAGES.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <div className="xcs-remake-field">
          <span>{c.product}</span>
          <div className="xcs-remake-photo">
            <label className="xcs-secondary">
              {c.photoPick}
              <input type="file" accept="image/jpeg,image/png,image/webp" hidden
                onChange={e => { const f = e.target.files?.[0]; if (f) setProductPhoto(URL.createObjectURL(f)) }} />
            </label>
            {productPhoto && <img src={productPhoto} alt="" />}
          </div>
        </div>
      </div>

      <div className="xcs-film-actions">
        <button className="xcs-primary" disabled>{c.make(c.about(price))}</button>
        <button className="xcs-secondary" onClick={() => { set({ result: null, link: '', start: 0 }); setError(null); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>{c.another}</button>
      </div>
      <p className="xcs-film-note">{c.makeSoon}</p>
    </div>}
  </section>
}
