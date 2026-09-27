'use client'
// app/components/xtell/XTellDaily.tsx — the free daily fortune on the temple
// street (XTell door): the saved birth profile, today's two readings, and a
// paid follow-up question about either.
//
// What the visitor controls: nothing is saved until they tick the consent box
// and press Save; the saved details can be viewed, changed or deleted here,
// and deleting says exactly what goes with them. A skipped reminder stays
// skipped in this browser and shrinks to one line.
//
// What is free: both readings and their calculations, with no credit at all.
// A question to a teacher is paid, shows its estimate before sending, and
// answers only from that day's stored calculation for that method (the
// server loads it by reference; nothing here sends a basis).

import { useEffect, useId, useRef, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useLang, useT, tOr } from '../../../lib/i18n'
import { useAuthModal } from '../../../lib/AuthModalContext'
import { daysInMonth, birthYears, REMEMBER_KEY, rememberedBirth } from '../../../lib/xtell-birth'
import { PLACES, DEFAULT_PLACE, placeOf } from '../../../lib/xtell-places'
import { resolveWallTime, detectedZone, localDateIn } from '../../../lib/xtell-time'
import { PRESETS, EST_PROMPT_TOKENS, estimateReadingUsd, fmtUsd, defaultThinking, type PresetModel } from '../../../lib/xtell-presets'

type Method = 'western' | 'bazi'
const METHODS: Method[] = ['western', 'bazi']
type Profile = { birth: { y: number; m: number; d: number; h: number; mi: number; hourUnknown?: boolean }; place: string; fold: 0 | 1 | null; displayTz: string; revision: number }
type Reading = { summary: string; themes: string[]; reflect: string; why: string }
type MethodDay = { status: 'ready' | 'pending' | 'failed' | 'capped' | 'gone'; id?: string; basis?: any; reading?: Reading }
type Day = { date: string; tz: string; methods: Record<Method, MethodDay> }
type Teacher = PresetModel & { id: string; display_name: string; blocked_features?: string[] }
export type SavedDaily = { id: string; subject: any; chart: any; turns: any[] }

const DISMISS_KEY = 'xtell.daily.reminder'
const pad = (n: number) => String(n).padStart(2, '0')

function zoneLabel(tz: string, lang: string): string {
  try {
    const n = new Intl.DateTimeFormat(lang, { timeZone: tz, timeZoneName: 'longGeneric' }).formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value
    return n ? `${n} · ${tz.split('/').pop()!.replace(/_/g, ' ')}` : tz
  } catch { return tz }
}

export default function XTellDaily({ openSignal, resume, onClearResume }: { openSignal: number; resume: SavedDaily | null; onClearResume?: () => void }) {
  const t = useT()
  const { lang } = useLang()
  const { show: showSignIn } = useAuthModal()
  const titleId = useId()
  const sectionRef = useRef<HTMLElement>(null)
  const [phase, setPhase] = useState<'loading' | 'signedOut' | 'none' | 'ready'>('loading')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [day, setDay] = useState<Day | null>(null)
  const [dayError, setDayError] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  // A saved follow-up opened from history is shown only after THIS section has
  // read it again under the current session and generation: a history answer
  // that arrives after a sign-out, an account switch or a delete finds nothing
  // (or a stale generation) and shows nothing (Codex review).
  const [shownResume, setShownResume] = useState<SavedDaily | null>(null)
  // The latest callback, for handlers registered at mount (auth events).
  const clearResume = useRef(onClearResume)
  clearResume.current = onClearResume
  const dayToken = useRef(0)
  // Every answer is checked against the generation it was asked in: a sign-in,
  // a sign-out or a delete bumps it, so a late profile, day or save from
  // before can never repaint the section (Codex review).
  const gen = useRef(0)
  // The account the section is showing (undefined until the first report).
  const userRef = useRef<string | null | undefined>(undefined)
  // The language NOW, for callbacks made long ago (auth events, retries).
  const langRef = useRef(lang)
  langRef.current = lang

  const errText = (code: string) => {
    const m = code.match(/^birth_(.+)$/)
    return m ? tOr(t, `xtell.err.birth.${m[1]}`, t('xtell.dy.err.save')) : tOr(t, `xtell.err.${code}`, t('xtell.dy.err.save'))
  }

  const loadDay = async (attempt = 0) => {
    const mine = ++dayToken.current, g = gen.current
    const current = () => mine === dayToken.current && g === gen.current
    setDayError(false)
    try {
      const res = await fetch('/api/xtell/daily', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang: langRef.current }) })
      if (!current()) return
      const d = await res.json().catch(() => null)
      if (!current()) return
      if (!res.ok || !d) { setDayError(true); return }
      if (!d.profile) { setProfile(null); setDay(null); setPhase('none'); return }
      if (d.problem) { setProblem(d.problem); setDay(null); return }
      setProblem(null)
      setDay({ date: d.date, tz: d.tz, methods: d.methods })
      const waiting = METHODS.some(m => d.methods?.[m]?.status === 'pending' || d.methods?.[m]?.status === 'gone')
      if (waiting && attempt < 8) setTimeout(() => { if (current()) void loadDay(attempt + 1) }, 3000)
    } catch { if (current()) setDayError(true) }
  }

  const loadProfile = async () => {
    const g = gen.current
    try {
      const res = await fetch('/api/xtell/profile')
      if (g !== gen.current) return
      if (res.status === 401) { setPhase('signedOut'); return }
      // Saved details that cannot be read are treated as none: the card asks
      // for them (owner, Sep 27), and a save that fails says so in the form.
      if (!res.ok) { setPhase('none'); return }
      const d = await res.json()
      if (g !== gen.current) return
      setProfile(d.profile)
      setPhase(d.profile ? 'ready' : 'none')
      if (d.profile) void loadDay()
    } catch { if (g === gen.current) setPhase('none') }
  }
  /** Drop everything the previous account or profile showed, at once,
   *  including a reopened follow-up (its stream unmounts with it). */
  const reset = () => {
    gen.current++; dayToken.current++
    setProfile(null); setDay(null); setProblem(null); setEditing(false); setConfirmDelete(false); setDayError(false)
    setShownResume(null)
    clearResume.current?.()
  }
  useEffect(() => {
    setShownResume(null)
    if (!resume?.id) return
    const g = gen.current
    const sb = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)
    sb.from('xtell_readings').select('id, temple, subject, chart, turns').eq('id', resume.id).eq('temple', 'daily').is('deleted_at', null).maybeSingle()
      .then(({ data }: { data: any }) => { if (g === gen.current && data?.temple === 'daily') setShownResume(data as SavedDaily) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resume?.id])

  useEffect(() => {
    try { setDismissed(localStorage.getItem(DISMISS_KEY) === '1') } catch { /* private mode */ }
    void loadProfile()
    // Signing in (from the reminder) reloads the profile.
    const sb = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)
    // Only a change of ACCOUNT resets the section: Supabase also reports
    // SIGNED_IN when a tab regains focus, which must not blank it.
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      const id = session?.user?.id ?? null
      if (userRef.current === undefined) { userRef.current = id; return }
      if (id === userRef.current) return
      userRef.current = id
      reset(); setPhase(id ? 'loading' : 'signedOut')
      if (id) void loadProfile()
    })
    return () => { sub.subscription.unsubscribe(); gen.current++; dayToken.current++ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Each language is its own reading (the cache key includes it).
  const langSeen = useRef(lang)
  useEffect(() => {
    if (langSeen.current === lang) return
    langSeen.current = lang
    if (phase === 'ready' && profile) void loadDay()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang])
  // A tab left open past midnight: when it comes back, a new local date means
  // a new day's reading (Codex review: yesterday must not linger).
  useEffect(() => {
    if (phase !== 'ready' || !profile || !day) return
    const check = () => { if (document.visibilityState === 'visible' && localDateIn(profile.displayTz) !== day.date) void loadDay() }
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    return () => { document.removeEventListener('visibilitychange', check); window.removeEventListener('focus', check) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, profile?.displayTz, day?.date])
  // The front-door guide's "daily" button.
  useEffect(() => {
    if (!openSignal) return
    sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    if (phase === 'none') setEditing(true)
    if (phase === 'signedOut') showSignIn()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSignal])

  const dismiss = () => { setDismissed(true); try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* ignore */ } }
  const start = () => { setNotice(null); if (phase === 'signedOut') showSignIn(); else setEditing(true) }

  const onSaved = (p: Profile, g: number) => {
    if (g !== gen.current) return
    gen.current++
    setProfile(p); setEditing(false); setPhase('ready'); setProblem(null); setDay(null); void loadDay()
  }
  const remove = async () => {
    // Nothing from before the delete may repaint after it.
    reset()
    const g = gen.current
    const res = await fetch('/api/xtell/profile', { method: 'DELETE' }).catch(() => null)
    if (g !== gen.current) return
    if (!res?.ok) { setNotice(t('xtell.dy.err.save')); void loadProfile(); return }
    // The browser's own copy of the birth goes too (Codex review).
    try { localStorage.removeItem(REMEMBER_KEY) } catch { /* ignore */ }
    setPhase('none'); setNotice(t('xtell.dy.deleted'))
  }

  // The card always keeps its place in the street's 今日 row (owner, Sep 27:
  // nothing hidden): its title and a loading line while the profile loads.
  if (phase === 'loading') return (
    <section id="xtell-daily" className="xtell-dy" aria-labelledby={titleId} aria-busy="true" ref={sectionRef}>
      <div className="xtell-dy-head"><h2 id={titleId} className="xtell-dy-title">{t('xtell.dy.title')}</h2></div>
      <p className="xtell-dy-small">{t('common.loading')}</p>
    </section>
  )
  const born = profile ? `${profile.birth.y}-${pad(profile.birth.m)}-${pad(profile.birth.d)} ${profile.birth.hourUnknown ? t('xtell.hourunknown') : `${pad(profile.birth.h)}:${pad(profile.birth.mi)}`}` : ''

  return (
    <section id="xtell-daily" className="xtell-dy" aria-labelledby={titleId} ref={sectionRef}>
      <div className="xtell-dy-head">
        <h2 id={titleId} className="xtell-dy-title">{t('xtell.dy.title')}</h2>
        <p className="xtell-dy-sub">{t('xtell.dy.sub')}</p>
      </div>
      {shownResume && phase !== 'signedOut' && <Resumed key={shownResume.id} row={shownResume} />}
      {notice && <p className="xtell-dy-notice" role="status">{notice}</p>}

      {editing ? (
        <ProfileForm profile={profile} gen={gen} onSaved={onSaved} onCancel={() => setEditing(false)} errText={errText} />
      ) : (phase === 'none' || phase === 'signedOut') ? (
        dismissed
          ? <p className="xtell-dy-later">{t('xtell.dy.later')} <button type="button" className="xtell-dy-link" onClick={start}>{t('xtell.dy.start')}</button></p>
          : <div className="xtell-dy-remind">
              <p>{t('xtell.dy.remind')}</p>
              {phase === 'signedOut' && <p className="xtell-dy-small">{t('xtell.dy.signin')}</p>}
              <div className="xtell-dy-row">
                <button type="button" className="xtell-dy-primary" onClick={start}>{t(phase === 'signedOut' ? 'xtell.dy.signinBtn' : 'xtell.dy.start')}</button>
                <button type="button" className="xtell-dy-secondary" onClick={dismiss}>{t('xtell.dy.skip')}</button>
              </div>
            </div>
      ) : (
        <>
          <div className="xtell-dy-profile">
            <span>{t('xtell.dy.saved').replace('{birth}', born).replace('{place}', placeOf(profile?.place)?.label ?? '').replace('{tz}', zoneLabel(profile?.displayTz ?? '', lang))}</span>
            <span className="xtell-dy-row">
              <button type="button" className="xtell-dy-link" onClick={() => { setConfirmDelete(false); setEditing(true) }}>{t('xtell.dy.edit')}</button>
              <button type="button" className="xtell-dy-link" onClick={() => setConfirmDelete(c => !c)}>{t('xtell.dy.delete')}</button>
            </span>
          </div>
          {confirmDelete && (
            <div className="xtell-dy-confirm" role="alertdialog" aria-label={t('xtell.dy.delete')}>
              <p>{t('xtell.dy.deleteConfirm')}</p>
              <div className="xtell-dy-row">
                <button type="button" className="xtell-dy-danger" onClick={() => void remove()}>{t('xtell.dy.deleteYes')}</button>
                <button type="button" className="xtell-dy-secondary" onClick={() => setConfirmDelete(false)}>{t('xtell.dy.cancel')}</button>
              </div>
            </div>
          )}
          {problem && <p className="xtell-dy-notice" role="alert">{t('xtell.dy.problem')} <button type="button" className="xtell-dy-link" onClick={() => setEditing(true)}>{t('xtell.dy.edit')}</button></p>}
          {dayError && <p className="xtell-dy-notice" role="alert">{t('xtell.dy.err.load')} <button type="button" className="xtell-dy-link" onClick={() => void loadDay()}>{t('xtell.dy.retry')}</button></p>}
          {day && (
            <div className="xtell-dy-cards">
              {METHODS.map(m => <MethodCard key={`${m}:${day.methods[m]?.id ?? day.date}`} method={m} day={day} data={day.methods[m]} onRetry={() => void loadDay()} />)}
            </div>
          )}
        </>
      )}
    </section>
  )
}

// ── The profile form ───────────────────────────────────────────────────────

function ProfileForm({ profile, gen, onSaved, onCancel, errText }: { profile: Profile | null; gen: { current: number }; onSaved: (p: Profile, g: number) => void; onCancel: () => void; errText: (c: string) => string }) {
  const t = useT()
  const { lang } = useLang()
  const errId = useId()
  // A new profile starts from 占星塔's remembered birth when there is one:
  // a convenience, never consent (the box below is always unticked).
  const [f, setF] = useState(() => {
    const r = profile ? null : (() => { try { return rememberedBirth(localStorage.getItem(REMEMBER_KEY)) } catch { return null } })()
    const b = profile?.birth ?? r ?? { y: 1990, m: 1, d: 1, h: 12, mi: 0, hourUnknown: false }
    return {
      y: b.y, m: b.m, d: b.d, h: b.h, mi: b.mi, hourUnknown: b.hourUnknown === true,
      place: profile?.place ?? (r?.place && placeOf(r.place) ? r.place : DEFAULT_PLACE),
      displayTz: profile?.displayTz ?? detectedZone(),
      fold: (profile?.fold ?? null) as 0 | 1 | null,
      consent: false,
    }
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const set = (patch: Partial<typeof f>) => { setErr(null); setF(v => ({ ...v, ...patch })) }
  const days = daysInMonth(f.y, f.m)
  const tz = placeOf(f.place)?.tz ?? 'Asia/Taipei'
  const wall = f.hourUnknown ? null : resolveWallTime(f.y, f.m, f.d, f.h, f.mi, tz).kind
  const zones = [...new Set([f.displayTz, detectedZone(), ...PLACES.map(p => p.tz)])].sort()
  const needsConsent = !profile

  const save = async () => {
    if (needsConsent && !f.consent) { setErr('consent_required'); return }
    if (wall === 'gap') { setErr('birth_time_gap'); return }
    if (wall === 'ambiguous' && f.fold === null) { setErr('birth_time_ambiguous'); return }
    setBusy(true)
    const g = gen.current
    try {
      const res = await fetch('/api/xtell/profile', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ birth: { y: f.y, m: f.m, d: f.d, h: f.h, mi: f.mi, ...(f.hourUnknown ? { hourUnknown: true } : {}) }, place: f.place, fold: wall === 'ambiguous' ? f.fold : null, displayTz: f.displayTz, consent: f.consent }),
      })
      const d = await res.json().catch(() => null)
      if (g !== gen.current) return
      if (!res.ok || !d?.profile) { setErr(d?.code ?? 'save'); return }
      onSaved(d.profile, g)
    } catch { setErr('save') } finally { setBusy(false) }
  }

  const sel = 'xtell-dy-select'
  return (
    <form className="xtell-dy-form" onSubmit={e => { e.preventDefault(); void save() }} aria-describedby={err ? errId : undefined}>
      <p className="xtell-dy-form-title">{t('xtell.dy.form.title')}</p>
      <fieldset className="xtell-dy-field">
        <legend>{t('xtell.dy.form.date')}</legend>
        <select className={sel} aria-label={t('xtell.site.birth.year')} value={f.y} onChange={e => set({ y: +e.target.value, d: Math.min(f.d, daysInMonth(+e.target.value, f.m)), fold: null })}>{birthYears().map(y => <option key={y} value={y}>{y}</option>)}</select>
        <select className={sel} aria-label={t('xtell.site.birth.month')} value={f.m} onChange={e => set({ m: +e.target.value, d: Math.min(f.d, daysInMonth(f.y, +e.target.value)), fold: null })}>{Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{m}</option>)}</select>
        <select className={sel} aria-label={t('xtell.site.birth.day')} value={f.d} onChange={e => set({ d: +e.target.value, fold: null })}>{Array.from({ length: days }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}</select>
      </fieldset>
      <fieldset className="xtell-dy-field">
        <legend>{t('xtell.dy.form.time')}</legend>
        <select className={sel} aria-label={t('xtell.site.birth.hour')} disabled={f.hourUnknown} value={f.h} onChange={e => set({ h: +e.target.value, fold: null })}>{Array.from({ length: 24 }, (_, i) => i).map(h => <option key={h} value={h}>{pad(h)}</option>)}</select>
        <select className={sel} aria-label={t('xtell.site.birth.minute')} disabled={f.hourUnknown} value={f.mi} onChange={e => set({ mi: +e.target.value, fold: null })}>{Array.from({ length: 60 }, (_, i) => i).map(mi => <option key={mi} value={mi}>{pad(mi)}</option>)}</select>
        <label className="xtell-dy-check"><input type="checkbox" checked={f.hourUnknown} onChange={e => set({ hourUnknown: e.target.checked, fold: null })} /> {t('xtell.dy.form.unknown')}</label>
      </fieldset>
      <label className="xtell-dy-field">
        <span>{t('xtell.dy.form.place')}</span>
        <select className={sel} value={f.place} onChange={e => set({ place: e.target.value, fold: null })}>{PLACES.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}</select>
      </label>
      {wall === 'gap' && <p className="xtell-dy-warn" role="alert">{t('xtell.dy.form.gap')}</p>}
      {wall === 'ambiguous' && (
        <fieldset className="xtell-dy-field">
          <legend>{t('xtell.dy.form.fold')}</legend>
          {([0, 1] as const).map(k => <label key={k} className="xtell-dy-check"><input type="radio" name="fold" checked={f.fold === k} onChange={() => set({ fold: k })} /> {t(`xtell.dy.form.fold${k}`)}</label>)}
        </fieldset>
      )}
      <label className="xtell-dy-field">
        <span>{t('xtell.dy.form.tz')}</span>
        <select className={sel} value={f.displayTz} onChange={e => set({ displayTz: e.target.value })}>{zones.map(z => <option key={z} value={z}>{zoneLabel(z, lang)}</option>)}</select>
        <small>{t('xtell.dy.form.tzHint')}</small>
      </label>
      {needsConsent && <label className="xtell-dy-check xtell-dy-consent"><input type="checkbox" checked={f.consent} onChange={e => set({ consent: e.target.checked })} /> {t('xtell.dy.consent')}</label>}
      {err && <p id={errId} className="xtell-dy-warn" role="alert">{err === 'save' ? t('xtell.dy.err.save') : errText(err)}</p>}
      <div className="xtell-dy-row">
        <button type="submit" className="xtell-dy-primary" disabled={busy || wall === 'gap'}>{t('xtell.dy.save')}</button>
        <button type="button" className="xtell-dy-secondary" onClick={onCancel}>{t('xtell.dy.cancel')}</button>
      </div>
    </form>
  )
}

// ── A method's card ────────────────────────────────────────────────────────

function Basis({ method, basis }: { method: Method; basis: any }) {
  const t = useT()
  const fill = (k: string, v: Record<string, string>) => Object.entries(v).reduce((a, [x, y]) => a.split(`{${x}}`).join(y), t(k))
  const pl = (k: string) => tOr(t, `xtell.pl.${k}`, k)
  if (method === 'western') {
    const w = basis?.western
    if (!w) return null
    return (
      <ul className="xtell-dy-basis">
        <li>{fill('xtell.dy.b.moon', { sign: tOr(t, `xtell.sign.${w.moonSign}`, '') })}</li>
        {w.retro?.length > 0 && <li>{fill('xtell.dy.b.retro', { list: w.retro.map(pl).join(t('xtell.list.sep')) })}</li>}
        {w.contacts?.length ? w.contacts.map((c: any, i: number) => (
          <li key={i}>{fill('xtell.dy.b.contact', { t: pl(c.transit), asp: tOr(t, `xtell.asp.${c.aspect}`, c.aspect), n: pl(c.natal) })}
            <span className="xtell-dy-muted"> · {c.approx ? t('xtell.dy.approx') : `${Number(c.orb).toFixed(1)}°`}</span></li>
        )) : <li>{t('xtell.dy.none')}</li>}
        {w.hourUnknown && <li className="xtell-dy-muted">{t('xtell.dy.unknownHour')}</li>}
      </ul>
    )
  }
  const b = basis?.bazi
  if (!b) return null
  const god = (x: string) => tOr(t, `xtell.god.${x}`, x)
  const pillar = (p: any) => Array.isArray(p) ? fill('xtell.dy.b.or', { a: p[0], b: p[1] }) : p
  const n = b.natal.pillars
  const pillars = [`${t('xtell.p.year')} ${pillar(n.year)}`, `${t('xtell.p.month')} ${pillar(n.month)}`, `${t('xtell.p.day')} ${n.day}`, `${t('xtell.p.time')} ${n.time ?? t('xtell.p.timeUnknown')}`].join(t('xtell.list.sep'))
  return (
    <ul className="xtell-dy-basis">
      <li>{fill('xtell.dy.b.today', { day: b.day.day, god: god(b.day.dayShiShen), month: b.day.month, year: b.day.year })}</li>
      <li>{fill('xtell.dy.b.natal', { pillars, dm: b.natal.dayMaster })}</li>
      {b.day.relations.filter((r: any) => r.kind !== '無特殊關係').map((r: any, i: number) => (
        <li key={i}>{fill('xtell.dy.b.rel', { a: b.day.day[1], b: r.natal[1], pillar: t(`xtell.p.${r.with}`), rel: tOr(t, `xtell.rel.${r.kind}`, r.kind) })}
          {r.undecided && <span className="xtell-dy-muted">{t('xtell.dy.b.maybe')}</span>}</li>
      ))}
      {b.natal.hourUnknown && <li className="xtell-dy-muted">{t('xtell.dy.unknownHour')}</li>}
    </ul>
  )
}

function ReadingView({ reading }: { reading: Reading }) {
  const t = useT()
  return (
    <>
      <p className="xtell-dy-summary">{reading.summary}</p>
      <p className="xtell-dy-label">{t('xtell.dy.themes')}</p>
      <ul className="xtell-dy-themes">{reading.themes.map((x, i) => <li key={i}>{x}</li>)}</ul>
      <p className="xtell-dy-label">{t('xtell.dy.reflect')}</p>
      <p>{reading.reflect}</p>
    </>
  )
}

function MethodCard({ method, day, data, onRetry }: { method: Method; day: Day; data: MethodDay; onRetry: () => void }) {
  const t = useT()
  const { lang } = useLang()
  return (
    <article className="xtell-dy-card">
      <header>
        <h3>{t(`xtell.dy.${method}`)}</h3>
        <span className="xtell-dy-muted">{day.date} · {zoneLabel(day.tz, lang)}</span>
      </header>
      {data.status === 'ready' && data.reading ? <ReadingView reading={data.reading} />
        : data.status === 'pending' || data.status === 'gone' ? <p className="xtell-dy-muted" role="status">{t('xtell.dy.pending')}</p>
        : data.status === 'capped' ? <p className="xtell-dy-muted">{t('xtell.dy.capped')}</p>
        : <p className="xtell-dy-muted">{t('xtell.dy.failed')} <button type="button" className="xtell-dy-link" onClick={onRetry}>{t('xtell.dy.retry')}</button></p>}
      {data.basis && (
        <details className="xtell-dy-why">
          <summary>{t('xtell.dy.why')}</summary>
          {data.reading?.why && <p>{data.reading.why}</p>}
          <p className="xtell-dy-label">{t('xtell.dy.basis')}</p>
          <Basis method={method} basis={data.basis} />
        </details>
      )}
      {data.status === 'ready' && data.id && <FollowUp key={data.id} dailyId={data.id} />}
    </article>
  )
}

// ── Paid follow-up ─────────────────────────────────────────────────────────

type Turn = { role: 'user' | 'assistant'; content: string; name?: string; cost?: number }

function FollowUp({ dailyId, readingId: savedId = null, turns: savedTurns = [] }: { dailyId?: string; readingId?: string | null; turns?: Turn[] }) {
  const t = useT()
  const { lang } = useLang()
  const [open, setOpen] = useState(savedTurns.length > 0)
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [pick, setPick] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [turns, setTurns] = useState<Turn[]>(savedTurns)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const readingId = useRef<string | null>(savedId)
  // This composer belongs to one day's reading (it is keyed by it); when it
  // goes (another day, an edited profile, a sign-out) its stream goes too.
  const inflight = useRef<AbortController | null>(null)
  const alive = useRef(true)
  // Set in setup too: StrictMode runs setup, cleanup, setup (Codex review).
  useEffect(() => { alive.current = true; return () => { alive.current = false; inflight.current?.abort() } }, [])

  useEffect(() => {
    if (!open || teachers.length) return
    const sb = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)
    sb.from('ai_models').select('id, provider, model_name, display_name, model_pricing, output_config, blocked_features')
      .eq('enabled', true).contains('output_modalities', ['text'])
      .then(({ data }) => {
        const rows = ((data ?? []) as Teacher[]).filter(r => !(r.blocked_features ?? []).includes('xtell'))
        setTeachers(rows)
        const first = PRESETS.map(p => p.models.map(n => rows.find(r => r.model_name === n)).find(Boolean)).find(Boolean)
        if (first) setPick(p => p ?? first.id)
      })
  }, [open, teachers.length])

  const offered = PRESETS.map(p => ({ key: p.key, model: p.models.map(n => teachers.find(r => r.model_name === n)).find(Boolean) }))
    .filter((p): p is { key: typeof PRESETS[number]['key']; model: Teacher } => !!p.model)
  const model = teachers.find(r => r.id === pick) ?? null
  const chars = turns.reduce((n, x) => n + x.content.length, 0) + question.length
  const estimate = model ? estimateReadingUsd(model, { thinking: defaultThinking(model), search: false }, chars, EST_PROMPT_TOKENS) : null

  const send = async () => {
    const q = question.trim()
    if (!q || busy || !model) return
    setBusy(true); setErr(null)
    const ctrl = new AbortController()
    inflight.current = ctrl
    try {
      if (!readingId.current) {
        const res = await fetch('/api/xtell/daily/followup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dailyId }), signal: ctrl.signal })
        const d = await res.json().catch(() => null)
        if (!alive.current) return
        if (!res.ok || typeof d?.readingId !== 'string') { setErr(d?.code === 'daily_missing' ? 'xtell.dy.expired' : 'xtell.dy.askFailed'); return }
        readingId.current = d.readingId
      }
      const history = turns.map(x => ({ role: x.role, content: x.content }))
      setQuestion('')
      setTurns(ts => [...ts, { role: 'user', content: q }, { role: 'assistant', content: '', name: model.display_name }])
      const res = await fetch('/api/xtell/reading', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ temple: 'daily', readingId: readingId.current, qid: crypto.randomUUID(), question: q, modelId: model.id, history, thinking: defaultThinking(model), lang }),
        signal: ctrl.signal,
      })
      if (!alive.current) return
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}))
        setTurns(ts => ts.slice(0, -2)); setQuestion(q)
        setErr(d?.code === 'daily_expired' ? 'xtell.dy.expired' : 'xtell.dy.askFailed')
        return
      }
      const reader = res.body.getReader(), dec = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done || !alive.current) break
        buf += dec.decode(value, { stream: true })
        const events = buf.split('\n\n'); buf = events.pop() ?? ''
        for (const ev of events) {
          const type = ev.match(/^event: (\w+)/m)?.[1], data = ev.match(/^data: (.*)$/m)?.[1]
          if (!type || !data) continue
          const j = JSON.parse(data)
          if (type === 'delta') setTurns(ts => ts.map((x, i) => i === ts.length - 1 ? { ...x, content: x.content + j.text } : x))
          if (type === 'done') setTurns(ts => ts.map((x, i) => i === ts.length - 1 ? { ...x, cost: j.cost ?? 0 } : x))
          if (type === 'error') setErr('xtell.dy.askFailed')
        }
      }
    } catch { if (alive.current) setErr('xtell.dy.askFailed') } finally { if (alive.current) setBusy(false) }
  }

  if (!open) return <button type="button" className="xtell-dy-ask" onClick={() => setOpen(true)}>{t('xtell.dy.ask')}</button>
  return (
    <div className="xtell-dy-follow">
      <p className="xtell-dy-small">{t('xtell.dy.askNote')}</p>
      {turns.map((x, i) => (
        <div key={i} className={x.role === 'user' ? 'xtell-dy-q' : 'xtell-dy-a'}>
          {x.role === 'assistant' && x.name && <span className="xtell-dy-muted">{x.name}{typeof x.cost === 'number' && x.cost > 0 ? ` · ${t('xtell.dy.cost').replace('{usd}', fmtUsd(x.cost))}` : ''}</span>}
          <p>{x.content}</p>
        </div>
      ))}
      {offered.length > 0 && (
        <div className="xtell-dy-row" role="group" aria-label={t('xtell.preset.title')}>
          {offered.map(({ key, model: m }) => (
            <button key={key} type="button" aria-pressed={pick === m.id} className="xtell-dy-preset" onClick={() => setPick(m.id)} disabled={busy}>
              <b>{t(`xtell.preset.${key}`)}</b> · {m.display_name}
            </button>
          ))}
        </div>
      )}
      <textarea className="xtell-dy-input" rows={2} value={question} maxLength={2000} onChange={e => setQuestion(e.target.value)} placeholder={t('xtell.dy.askPh')} aria-label={t('xtell.dy.askPh')} disabled={busy} />
      <div className="xtell-dy-row">
        <button type="button" className="xtell-dy-primary" onClick={() => void send()} disabled={busy || !question.trim() || !model}>{t('xtell.dy.send')}</button>
        {estimate != null && <span className="xtell-dy-muted">{t('xtell.dy.estimate').replace('{usd}', fmtUsd(estimate))}</span>}
      </div>
      {err && <p className="xtell-dy-warn" role="alert">{t(err)}</p>}
    </div>
  )
}

// ── A saved follow-up, reopened from history ───────────────────────────────

function Resumed({ row }: { row: SavedDaily }) {
  const t = useT()
  const method: Method = row.subject?.method === 'bazi' ? 'bazi' : 'western'
  const turns: Turn[] = (row.turns ?? []).map((x: any) => x.role === 'user'
    ? { role: 'user' as const, content: String(x.content ?? '') }
    : { role: 'assistant' as const, content: String(x.content ?? ''), name: x.name, cost: typeof x.cost === 'number' ? x.cost : undefined })
  return (
    <article className="xtell-dy-card xtell-dy-resumed">
      <header><h3>{t('xtell.dy.resumed').replace('{date}', String(row.subject?.date ?? '')).replace('{method}', t(`xtell.dy.${method}`))}</h3></header>
      {row.chart?.reading && <ReadingView reading={row.chart.reading} />}
      {row.chart?.basis && (
        <details className="xtell-dy-why">
          <summary>{t('xtell.dy.why')}</summary>
          {row.chart.reading?.why && <p>{row.chart.reading.why}</p>}
          <Basis method={method} basis={row.chart.basis} />
        </details>
      )}
      <FollowUp readingId={row.id} turns={turns} />
    </article>
  )
}
