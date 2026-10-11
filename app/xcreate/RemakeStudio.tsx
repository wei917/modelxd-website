'use client'
// 同款 (Remake), XCreate's sixth type (owner, Oct 10: "paste a link to do the
// same video。做同款。 但是換掉人物或主角 主題 背景"). Phase 1: paste a link or
// upload a video, read it into a shot list (/api/xcreate/remake/breakdown),
// pick the length and what to swap. Making the remake is phase 2, so the
// make button waits. Plan: docs/REMAKE-PLAN.md.
//
// The page is drawn around the original's cut rhythm (Oct 11): the heading
// shows one edit twice (the original, then yours), the read shows the real
// one as a strip with the stretch to remake framed in red, the shots run as
// a timeline, and each person to swap is a card from the original to yours.

import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useLang, type Lang } from '@/lib/i18n'
import { createSupabaseBrowser } from '@/lib/supabase-client'
import { pendingAttachment, commitAttachments } from '../components/AttachmentButton'
import ModeIcon from '../components/ModeIcon'
import {
  REMAKE_LENGTHS, REMAKE_LOOKS, estimateRemakeCents,
  type BreakdownResult, type CastChoice, type RemakeLook, type Shot,
} from '@/lib/remake/config'
import { remakeCopy, REMAKE_LANGUAGES } from './remake-copy'

const DRAFT_KEY = 'xcreate.remake-draft'
const MAX_VIDEO_BYTES = 300_000_000
const CAST_CHOICES: CastChoice[] = ['keep', 'photo', 'describe', 'famous']
const SHOTS_FIRST = 6
const money = (cents: number) => `$${(cents / 100).toFixed(cents >= 1000 ? 0 : 2)}`
/** Fast cuts are under a second, so times keep their tenths: 0:00.8. */
const clock = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`
/** Whole seconds, for the strip's scale and the reading clock: 1:05. */
const tick = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const pct = (n: number) => `${(n * 100).toFixed(3)}%`
/** The heading's made-up edit, drawn twice: the original's cuts, then yours. */
const HERO_RHYTHM = [2.6, 1, 1.8, 0.7, 1.2, 3.4, 1.4, 0.8, 2.2, 1, 1.6, 2.4, 0.6, 2.8]
/** How tight a shot is, for the strip's shading: close-ups dark, wides light. */
const TIGHTNESS: Record<string, number> = {
  'extreme close-up': 1, 'close-up': 0.85, insert: 0.8, 'medium close-up': 0.7,
  medium: 0.55, 'medium wide': 0.4, wide: 0.25, 'extreme wide': 0.1,
}

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

const LinkIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
  <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" /><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
</svg>
const UploadIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
  <path d="M12 15V3" /><path d="m7 8 5-5 5 5" /><path d="M20 15v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4" />
</svg>

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
  const [since, setSince] = useState(0)
  const [now, setNow] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)
  const linkRef = useRef<HTMLInputElement>(null)
  const readRef = useRef<HTMLDivElement>(null)
  /** Set by a read that just finished, so it scrolls into view; a draft restored on load does not. */
  const fresh = useRef(false)

  useEffect(() => {
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ ...d, cast: withoutPhotos(d.cast) })) } catch { /* storage unavailable */ }
  }, [d])

  // The clock beside the reading reel: a long read takes up to two minutes.
  useEffect(() => {
    if (stage === 'idle') return
    const t = Date.now()
    setSince(t); setNow(t)
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [stage])

  useEffect(() => {
    if (!fresh.current || !d.result) return
    fresh.current = false
    readRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [d.result])

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
      fresh.current = true
      setAllShots(false)
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

  /** One tap instead of a long press on a phone; without clipboard access the field takes the paste. */
  const paste = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim()
      if (text) { set({ link: text }); setError(null); return }
    } catch { /* not allowed here */ }
    linkRef.current?.focus()
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
  const shots = b?.shots ?? []
  const roles = useMemo(() => new Map((b?.characters ?? []).map(ch => [ch.id, ch.role])), [b])
  /** The model writes "C1 grips his head"; the page says who C1 is. */
  const named = (text: string) => text.replace(/\b[cC](\d{1,2})\b/g, (m, n) => roles.get(`c${n}`) ?? m)
  // The main characters first (by shots they are in); one-shot extras, like
  // a crowd's faces, fold away so the people who matter are not buried.
  const castOrder = useMemo(() => {
    const count = new Map<string, number>()
    for (const s of b?.shots ?? []) for (const w of s.who) count.set(w, (count.get(w) ?? 0) + 1)
    const sorted = [...(b?.characters ?? [])].sort((x, y) => (count.get(y.id) ?? 0) - (count.get(x.id) ?? 0))
    const main = sorted.filter((ch, i) => i < 2 || (count.get(ch.id) ?? 0) >= 2)
    return { main, extra: sorted.filter(ch => !main.includes(ch)), count }
  }, [b])

  // The stretch to remake: from the chosen shot, for the chosen length.
  const total = Math.max(0.1, b?.duration ?? 0, shots.length ? shots[shots.length - 1].t1 : 0)
  const first = Math.min(d.fromShot, Math.max(0, shots.length - 1))
  const fromT = shots[first]?.t0 ?? 0
  const remaining = b ? Math.max(1, Math.round(b.duration - fromT)) : 0
  const lengths = b ? REMAKE_LENGTHS.filter(n => n === 0 || n < remaining) : []
  const chosenSeconds = d.length === 0 || d.length >= remaining ? remaining : d.length
  const endT = Math.min(total, fromT + chosenSeconds)
  const inStretch = (s: Shot) => s.t1 > fromT + 0.05 && s.t0 < endT - 0.05
  const stretchCount = shots.filter(inStretch).length
  const longest = Math.max(0.1, ...shots.map(s => s.t1 - s.t0))
  const shown = allShots
    ? shots.map((_, i) => i)
    : shots.map((_, i) => i).filter(i => inStretch(shots[i])).slice(0, SHOTS_FIRST)
  const step = total <= 20 ? 5 : total <= 60 ? 15 : total <= 120 ? 30 : 60
  const ticks: number[] = []
  for (let t = 0; t <= total - step * 0.45; t += step) ticks.push(t)
  const price = money(estimateRemakeCents(chosenSeconds))

  /** A tap on the strip starts the stretch at the shot under the finger. */
  const pickAt = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const t = ((e.clientX - r.left) / r.width) * total
    const i = shots.findIndex(s => t < s.t1)
    set({ fromShot: i < 0 ? shots.length - 1 : i })
  }
  const setCast = (id: string, patch: Partial<CastPick>) =>
    setD(prev => ({ ...prev, cast: { ...prev.cast, [id]: { ...(prev.cast[id] ?? { choice: 'keep', text: '', consent: false }), ...patch } } }))
  const pickPhoto = (id: string, file: File | undefined) => {
    if (!file) return
    setCast(id, { photo: URL.createObjectURL(file) })
  }

  const castCard = (ch: { id: string; role: string; look: string }) => {
    const pick = d.cast[ch.id] ?? { choice: 'keep' as CastChoice, text: '', consent: false }
    return <div key={ch.id} className="xcs-remake-cast" role="group" aria-labelledby={`xcs-remake-cast-${ch.id}`}>
      <div className="xcs-remake-cast-was">
        <p className="xcs-remake-tag"><span>{c.original}</span><span>{c.inShots(castOrder.count.get(ch.id) ?? 0)}</span></p>
        <p className="xcs-remake-cast-role" id={`xcs-remake-cast-${ch.id}`}>{ch.role}</p>
        <p className="xcs-remake-cast-look">{ch.look}</p>
      </div>
      <div className="xcs-remake-cast-now">
        <p className="xcs-remake-tag is-yours"><span>{c.yours}</span></p>
        <div className="xcs-film-seg">
          {CAST_CHOICES.map(choice => <button key={choice} type="button" aria-pressed={pick.choice === choice}
            onClick={() => setCast(ch.id, { choice })}>{c.cast[choice]}</button>)}
        </div>
        {(pick.choice === 'describe' || pick.choice === 'famous') && <input className="xcs-remake-input" value={pick.text} maxLength={200}
          aria-label={`${ch.role}${colon}${c.cast[pick.choice]}`}
          placeholder={pick.choice === 'describe' ? c.describePlaceholder : c.famousPlaceholder}
          onChange={e => setCast(ch.id, { text: e.target.value })} />}
        {pick.choice === 'photo' && <div className="xcs-remake-photo">
          <label className="xcs-remake-photo-pick">
            <span className="xcs-remake-photo-tile">{pick.photo ? <img src={pick.photo} alt="" /> : '+'}</span>
            <span>{c.photoPick}</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e => pickPhoto(ch.id, e.target.files?.[0])} />
          </label>
          <label className="xcs-remake-consent">
            <input type="checkbox" checked={pick.consent} onChange={e => setCast(ch.id, { consent: e.target.checked })} />
            <span>{c.photoConsent}</span>
          </label>
        </div>}
      </div>
    </div>
  }

  return <section className="xcs-film xcs-remake" aria-labelledby="xcs-remake-title">
    <header className="xcs-heading">
      <h1 id="xcs-remake-title">{c.title}</h1>
      <p>{c.subtitle}</p>
      <div className="xcs-remake-hero" aria-hidden="true">
        {[c.original, c.yours].map((label, row) => <div key={row} className={row ? 'is-yours' : undefined}>
          <span>{label}</span>
          <i>{HERO_RHYTHM.map((w, k) => <b key={k} style={{ flexGrow: w, animationDelay: row ? `${250 + k * 70}ms` : undefined }} />)}</i>
        </div>)}
      </div>
    </header>

    <div className="xcs-remake-form">
      <label className="xcs-remake-step" htmlFor="xcs-remake-link"><b aria-hidden="true">01</b>{c.linkLabel}</label>
      <div className="xcs-remake-paste">
        <LinkIcon />
        <input ref={linkRef} id="xcs-remake-link" type="url" inputMode="url" enterKeyHint="go" autoComplete="off" value={d.link} disabled={busy}
          placeholder={c.placeholder} onChange={e => set({ link: e.target.value })}
          onKeyDown={e => { if (e.key === 'Enter') readLink() }} />
        {d.link
          ? <button type="button" className="xcs-remake-clear" aria-label={c.clear} disabled={busy}
            onClick={() => { set({ link: '' }); setError(null); linkRef.current?.focus() }}>×</button>
          : <button type="button" className="xcs-remake-pastebtn" disabled={busy} onClick={() => void paste()}>{c.paste}</button>}
      </div>
      <details className="xcs-remake-start">
        <summary>{c.startAt}</summary>
        <input type="number" min={0} step={1} inputMode="numeric" value={d.start || ''} placeholder="0" disabled={busy}
          aria-label={c.startAt} onChange={e => set({ start: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
        <p className="xcs-film-note">{c.startHint}</p>
      </details>
      {busy
        ? <div className="xcs-remake-scan" role="status">
          <div className="xcs-remake-reel" aria-hidden="true">
            <div>{Array.from({ length: 14 }, (_, k) => <i key={k} style={{ animationDelay: `${k * 110}ms` }} />)}</div>
          </div>
          <p><span>{stage === 'reading' ? c.reading : c.uploading}</span><b className="xcs-film-clock">{tick(Math.max(0, (now - since) / 1000))}</b></p>
        </div>
        : <>
          <button className="xcs-primary xcs-remake-go" disabled={signedIn && !d.link.trim()} onClick={readLink}>
            {signedIn ? c.read : c.signIn}
          </button>
          <button type="button" className="xcs-remake-upload" onClick={() => signedIn ? fileRef.current?.click() : onSignIn('/?type=remake')}>
            <UploadIcon /><span>{c.upload}</span>
          </button>
          <p className="xcs-remake-note">{c.orUpload}</p>
        </>}
      <input ref={fileRef} type="file" accept="video/mp4,video/quicktime,video/webm" hidden
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void uploadAndRead(f) }} />
      {error && <p className="xcs-film-error" role="alert">{error}</p>}
    </div>

    {b && d.result && <div ref={readRef} className="xcs-remake-read" aria-live="polite">
      <article className="xcs-remake-card">
        <p className="xcs-remake-eyebrow"><ModeIcon m="remake" /><span>{c.shots(shots.length, String(Math.round(b.duration)))} · {b.aspect}</span></p>
        <h2 className="xcs-remake-title">{b.title}</h2>
        <p className="xcs-remake-summary">{named(b.summary)}</p>
        <dl className="xcs-remake-facts">
          <div><dt>{c.look}</dt><dd>{[b.look.style, b.look.palette, b.look.light].filter(Boolean).join(' · ')}</dd></div>
          {b.characters.length > 0 && <div><dt>{c.characters}</dt><dd>
            {castOrder.main.map(ch => ch.role).join(listSep)}
            {castOrder.extra.length > 0 && <small>+{castOrder.extra.length}</small>}
          </dd></div>}
          {b.music.present && <div><dt>{c.music}</dt><dd>{c.musicLine(b.music.mood, b.music.bpm, b.music.cuts_on_beat)}</dd></div>}
        </dl>
        <p className="xcs-remake-left">{c.left(d.result.left)}</p>
      </article>

      <section className="xcs-remake-sec" aria-labelledby="xcs-remake-s2">
        <h2 className="xcs-remake-step" id="xcs-remake-s2"><b aria-hidden="true">02</b>{c.lengthLabel}</h2>
        {shots.length > 0 && <div className="xcs-remake-cut">
          <p className="xcs-remake-cut-head"><b>{c.shots(stretchCount, String(chosenSeconds))}</b><span>{clock(fromT)} → {clock(endT)}</span></p>
          <div className="xcs-remake-strip" aria-hidden="true" onClick={pickAt}>
            <div className="xcs-remake-strip-shots">
              {shots.map((s, i) => <i key={i} className={inStretch(s) ? 'is-in' : undefined}
                style={{ left: pct(s.t0 / total), width: pct((s.t1 - s.t0) / total), ['--k' as string]: TIGHTNESS[s.framing] ?? 0.5 }} />)}
            </div>
            <span className="xcs-remake-strip-sel" style={{ left: pct(fromT / total), width: pct((endT - fromT) / total) }} />
          </div>
          <div className="xcs-remake-ticks" aria-hidden="true">
            {ticks.map(t => <span key={t} style={{ left: pct(t / total) }}>{tick(t)}</span>)}
            <span className="is-end">{tick(total)}</span>
          </div>
        </div>}
        <div className="xcs-film-seg xcs-remake-len" role="group" aria-label={c.lengthLabel}>
          {lengths.map(n => {
            const secs = n === 0 ? remaining : n
            return <button key={n} type="button" aria-pressed={chosenSeconds === secs} onClick={() => set({ length: n })}>
              <span>{n === 0 ? c.whole(remaining) : c.seconds(n)}</span>
              <small>{c.about(money(estimateRemakeCents(secs)))}</small>
            </button>
          })}
        </div>
        <label className="xcs-remake-from">
          <span>{c.fromShot}</span>
          <select className="xcs-remake-select" value={first} onChange={e => set({ fromShot: Number(e.target.value) })}>
            {shots.map((s, i) => <option key={i} value={i}>{i + 1} · {clock(s.t0)} · {named(s.action).slice(0, 28)}</option>)}
          </select>
        </label>

        <ol className="xcs-remake-shots">
          {shown.map(i => {
            const s = shots[i], len = s.t1 - s.t0
            return <li key={i} className={inStretch(s) ? undefined : 'is-out'}>
              <span className="xcs-remake-shot-n">{String(i + 1).padStart(2, '0')}</span>
              <div className="xcs-remake-shot-body">
                <p className="xcs-remake-shot-meta">
                  <span>{clock(s.t0)}</span>
                  <span className="xcs-remake-shot-len"><i><b style={{ width: pct(Math.max(0.04, len / longest)) }} /></i>{c.seconds(Math.round(len * 10) / 10)}</span>
                  {s.transition_in && s.transition_in !== 'cut' && <span className="xcs-remake-shot-tr">{c.transitions[s.transition_in] ?? s.transition_in}</span>}
                </p>
                <p className="xcs-remake-shot-tags"><span>{c.framing[s.framing] ?? s.framing}</span>{s.camera && <span>{s.camera}</span>}</p>
                <p className="xcs-remake-shot-action">{named(s.action)}</p>
                {(s.who.length > 0 || s.where) && <p className="xcs-remake-shot-where">{[s.who.map(w => roles.get(w) ?? w).join(listSep), s.where].filter(Boolean).join(' · ')}</p>}
                {s.text && <p className="xcs-remake-shot-text"><span>{s.text}</span></p>}
              </div>
            </li>
          })}
        </ol>
        {shown.length < shots.length || allShots
          ? <button type="button" className="xcs-remake-moreshots" onClick={() => setAllShots(v => !v)}>
            {allShots ? c.showLess : c.showAll(shots.length)}
          </button>
          : null}

        {b.lines.length > 0 && <details className="xcs-film-more xcs-remake-linesbox">
          <summary>{c.lines} ({b.lines.length})</summary>
          <ul className="xcs-remake-lines">{b.lines.map((l, i) => <li key={i}><span>{clock(l.t)}</span> {roles.get(l.who) ?? l.who}{colon}{l.text}</li>)}</ul>
        </details>}
      </section>

      <section className="xcs-remake-sec" aria-labelledby="xcs-remake-s3">
        <h2 className="xcs-remake-step" id="xcs-remake-s3"><b aria-hidden="true">03</b>{c.swapHeading}</h2>
        <div className="xcs-remake-swaps">
          {castOrder.main.map(ch => castCard(ch))}
          {castOrder.extra.length > 0 && <details className="xcs-film-more xcs-remake-extra">
            <summary>{c.otherCast(castOrder.extra.length)}</summary>
            <div className="xcs-remake-swaps">{castOrder.extra.map(ch => castCard(ch))}</div>
          </details>}
        </div>
        <div className="xcs-remake-set">
          <label className="xcs-remake-row">
            <span>{c.theme}</span>
            <input className="xcs-remake-input" value={d.theme} maxLength={300} placeholder={c.themePlaceholder} onChange={e => set({ theme: e.target.value })} />
          </label>
          <label className="xcs-remake-row">
            <span>{c.setting}</span>
            <input className="xcs-remake-input" value={d.setting} maxLength={300} placeholder={c.settingPlaceholder} onChange={e => set({ setting: e.target.value })} />
          </label>
          <div className="xcs-remake-row" role="group" aria-labelledby="xcs-remake-look">
            <span id="xcs-remake-look">{c.lookLabel}</span>
            <div className="xcs-film-seg">
              {REMAKE_LOOKS.map(l => <button key={l} type="button" aria-pressed={d.look === l} onClick={() => set({ look: l })}>{c.looks[l]}</button>)}
            </div>
          </div>
          <label className="xcs-remake-row">
            <span>{c.language}</span>
            <select className="xcs-remake-select" value={d.language} onChange={e => set({ language: e.target.value as Lang })}>
              {REMAKE_LANGUAGES.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          <div className="xcs-remake-row">
            <span>{c.product}</span>
            <label className="xcs-remake-photo-pick">
              <span className="xcs-remake-photo-tile">{productPhoto ? <img src={productPhoto} alt="" /> : '+'}</span>
              <span>{c.photoPick}</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" hidden
                onChange={e => { const f = e.target.files?.[0]; if (f) setProductPhoto(URL.createObjectURL(f)) }} />
            </label>
          </div>
        </div>
      </section>

      <p className="xcs-film-note xcs-remake-soon">{c.makeSoon}</p>
      <div className="xcs-remake-bar">
        <p className="xcs-remake-bar-sum"><b>{c.about(price)}</b><span>{c.shots(stretchCount, String(chosenSeconds))}</span></p>
        <button className="xcs-primary" disabled>{c.make}</button>
      </div>
      <button type="button" className="xcs-remake-again" onClick={() => { set({ result: null, link: '', start: 0 }); setError(null); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>{c.another}</button>
    </div>}
  </section>
}
