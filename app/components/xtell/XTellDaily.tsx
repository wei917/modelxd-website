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
import { daysInMonth, birthYears, REMEMBER_KEY } from '../../../lib/xtell-birth'
import { placeOf, birthZone, ZONE_PREFIX, COMMON_ZONES } from '../../../lib/xtell-places'
import { resolveWallTime, detectedZone, localDateIn } from '../../../lib/xtell-time'
import { dropDates } from '../../../lib/xtell-share'
import { ShareButton } from './ShareButton'
import { WaitBar, WAIT_SECONDS } from './WaitBar'
import { partialFields, readNdjson } from '../../../lib/partial-json'

type Method = 'western' | 'bazi'
const METHODS: Method[] = ['western', 'bazi']
type Profile = { birth: { y: number; m: number; d: number; h: number; mi: number; hourUnknown?: boolean }; place: string; fold: 0 | 1 | null; displayTz: string; revision: number }
type Reading = { summary: string; themes: string[]; reflect: string; why: string }
// 'writing': this request is writing it now, and `draft` is the reply so far
// (Sep 29: the free reading streams instead of arriving all at once).
type MethodDay = { status: 'ready' | 'pending' | 'failed' | 'capped' | 'gone' | 'writing'; id?: string; basis?: any; reading?: Reading; draft?: string }
type Day = { date: string; tz: string; methods: Record<Method, MethodDay> }
export type SavedDaily = { id: string; subject: any; chart: any; turns: any[] }

const DISMISS_KEY = 'xtell.daily.reminder'
const pad = (n: number) => String(n).padStart(2, '0')

/** Zones for the two zone fields: the given ones first (the detected zone,
 *  the saved one), then the common birth zones, then every other zone the
 *  browser knows. */
function zoneChoices(first: string[]): string[] {
  let all: string[] = []
  try { all = (Intl as any).supportedValuesOf?.('timeZone') ?? [] } catch { /* older browsers: the lists above */ }
  return [...new Set([...first.filter(Boolean), ...COMMON_ZONES, ...all])]
}

function zoneLabel(tz: string, lang: string): string {
  try {
    const n = new Intl.DateTimeFormat(lang, { timeZone: tz, timeZoneName: 'longGeneric' }).formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value
    return n ? `${n} · ${tz.split('/').pop()!.replace(/_/g, ' ')}` : tz
  } catch { return tz }
}

/** `compact` (the homepage's card row, Oct 3): the card opens to the day's
 *  readings on a press, and widens to the whole row while open. */
export default function XTellDaily({ openSignal, onContinue, compact = false }: { openSignal: number; onContinue: (row: SavedDaily) => void; compact?: boolean }) {
  const t = useT()
  const { lang } = useLang()
  const { show: showSignIn } = useAuthModal()
  const titleId = useId()
  const sectionRef = useRef<HTMLElement>(null)
  const [phase, setPhase] = useState<'loading' | 'signedOut' | 'none' | 'ready'>('loading')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [day, setDay] = useState<Day | null>(null)
  const [dayError, setDayError] = useState(false)
  const [dismissed, setDismissed] = useState(false)
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
    const again = (methods: Record<string, MethodDay | undefined>) => {
      const waiting = METHODS.some(m => methods[m]?.status === 'pending' || methods[m]?.status === 'gone')
      if (waiting && attempt < 8) setTimeout(() => { if (current()) void loadDay(attempt + 1) }, 3000)
    }
    try {
      const res = await fetch('/api/xtell/daily', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang: langRef.current, stream: true }) })
      if (!current()) return
      // The day streams: each card fills in as its own reading is written.
      // Anything else (no profile, a problem, an error) is one JSON answer.
      if (res.ok && (res.headers.get('content-type') ?? '').includes('ndjson')) {
        let methods: Record<string, MethodDay> = {}
        let head: { date: string; tz: string } | null = null
        const paint = () => { if (head && current()) setDay({ date: head.date, tz: head.tz, methods: { ...methods } as Day['methods'] }) }
        await readNdjson(res, e => {
          if (!current()) return
          if (e.t === 'day') {
            head = { date: e.date, tz: e.tz }
            methods = Object.fromEntries(METHODS.map(m => [m, { status: 'writing', draft: '' } as MethodDay]))
            setProblem(null)
          } else if (e.t === 'writing') methods[e.m] = { status: 'writing', basis: e.basis, draft: '' }
          else if (e.t === 'd' && methods[e.m]?.status === 'writing') methods[e.m] = { ...methods[e.m], draft: (methods[e.m].draft ?? '') + e.d }
          else if (e.t === 'restart' && methods[e.m]) methods[e.m] = { ...methods[e.m], draft: '' }
          else if (e.t === 'm') methods[e.m] = e.data ?? { status: 'failed' }
          else return
          paint()
        })
        if (!current()) return
        if (!head) { setDayError(true); return }
        // A stream cut off mid-way: the server keeps writing and saves it, so
        // what was still being written is waiting now, and is asked for again.
        for (const m of METHODS) if (methods[m]?.status === 'writing') methods[m] = { status: 'pending', basis: methods[m].basis }
        paint()
        again(methods)
        return
      }
      const d = await res.json().catch(() => null)
      if (!current()) return
      if (!res.ok || !d) { setDayError(true); return }
      if (!d.profile) { setProfile(null); setDay(null); setPhase('none'); return }
      if (d.problem) { setProblem(d.problem); setDay(null); return }
      setProblem(null)
      setDay({ date: d.date, tz: d.tz, methods: d.methods })
      again(d.methods ?? {})
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
    setProfile(null); setDay(null); setProblem(null); setEditing(false); setDayError(false)
  }
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
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!openSignal) return
    setOpen(true)
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

  // The card always keeps its place in the street's 今日 row (owner, Sep 27:
  // nothing hidden): its title and a loading line while the profile loads.
  const badge = compact ? <span className="xtell-home-badge is-free">{t('xtell.home.daily.free')}</span> : null
  const wide = compact && (editing || (open && phase === 'ready'))
  const cls = 'xtell-dy' + (compact ? ' xtell-home-card' + (wide ? ' is-open' : ' is-compact') : '')
  if (phase === 'loading') return (
    <section id="xtell-daily" className={cls} aria-labelledby={titleId} aria-busy="true" ref={sectionRef}>
      <div className="xtell-dy-head"><h2 id={titleId} className="xtell-dy-title">{t('xtell.dy.title')}</h2>{badge}</div>
      <p className="xtell-dy-small">{t('common.loading')}</p>
    </section>
  )
  return (
    <section id="xtell-daily" className={cls} aria-labelledby={titleId} ref={sectionRef}>
      <div className="xtell-dy-head">
        <h2 id={titleId} className="xtell-dy-title">{t('xtell.dy.title')}</h2>{badge}
        <p className="xtell-dy-sub">{t('xtell.dy.sub')}</p>
      </div>
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
          {/* The saved birth and zones are not shown here (owner, Sep 28):
              they are changed or deleted on the account page. */}
          {problem && <p className="xtell-dy-notice" role="alert">{t('xtell.dy.problem')} <button type="button" className="xtell-dy-link" onClick={() => setEditing(true)}>{t('xtell.dy.edit')}</button></p>}
          {dayError && <p className="xtell-dy-notice" role="alert">{t('xtell.dy.err.load')} <button type="button" className="xtell-dy-link" onClick={() => void loadDay()}>{t('xtell.dy.retry')}</button></p>}
          {compact && !open ? (
            <button type="button" className="xtell-dy-primary xtell-home-cta" aria-expanded={false} onClick={() => setOpen(true)}>{t('xtell.home.daily.open')} <span aria-hidden="true">→</span></button>
          ) : <>
            {day && (
              <div className="xtell-dy-cards">
                {METHODS.map(m => <MethodCard key={`${m}:${day.date}`} method={m} day={day} data={day.methods[m]} onRetry={() => void loadDay()} onContinue={onContinue} />)}
              </div>
            )}
            <p className="xtell-dy-small xtell-dy-settings"><a className="xtell-dy-link" href="/profile#xtell-daily-settings">{t('xtell.dy.editBirth')}</a></p>
            {compact && <button type="button" className="xtell-home-more" aria-expanded={true} onClick={() => setOpen(false)}>{t('xtell.home.daily.close')} <span aria-hidden="true">↑</span></button>}
          </>}
        </>
      )}
    </section>
  )
}

// ── On the account page: the saved birth and zones ─────────────────────────
// Shown and changed here, not on the street's card (owner, Sep 28). Same
// form and the same delete as the card had: /api/xtell/profile.

export function DailyProfileSettings() {
  const t = useT()
  const [state, setState] = useState<'loading' | 'none' | 'ready' | 'hidden'>('loading')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const gen = useRef(0)
  const errText = (code: string) => {
    const m = code.match(/^birth_(.+)$/)
    return m ? tOr(t, `xtell.err.birth.${m[1]}`, t('xtell.dy.err.save')) : tOr(t, `xtell.err.${code}`, t('xtell.dy.err.save'))
  }
  const load = async () => {
    const g = gen.current
    const res = await fetch('/api/xtell/profile').catch(() => null)
    if (g !== gen.current) return
    if (!res || res.status === 401 || !res.ok) { setState('hidden'); return }
    const d = await res.json().catch(() => null)
    if (g !== gen.current) return
    setProfile(d?.profile ?? null)
    setState(d?.profile ? 'ready' : 'none')
  }
  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // Arrived from the street's 「修改出生資料」 link: scroll here once loaded.
  useEffect(() => {
    if ((state === 'ready' || state === 'none') && window.location.hash === '#xtell-daily-settings') document.getElementById('xtell-daily-settings')?.scrollIntoView({ block: 'start' })
  }, [state])
  const remove = async () => {
    const g = ++gen.current
    setConfirmDelete(false)
    const res = await fetch('/api/xtell/profile', { method: 'DELETE' }).catch(() => null)
    if (g !== gen.current) return
    if (!res?.ok) { setNotice(t('xtell.dy.err.save')); void load(); return }
    // The browser's own copy of the birth goes too (Codex review).
    try { localStorage.removeItem(REMEMBER_KEY) } catch { /* ignore */ }
    setProfile(null); setState('none'); setNotice(t('xtell.dy.deleted'))
  }
  if (state === 'loading' || state === 'hidden') return null
  return (
    <section id="xtell-daily-settings" className="xtell-dy xtell-dy-account" aria-label={t('xtell.dy.settings')}>
      <div className="xtell-dy-head"><h2 className="xtell-dy-title">{t('xtell.dy.settings')}</h2></div>
      {notice && <p className="xtell-dy-notice" role="status">{notice}</p>}
      {editing ? (
        <ProfileForm profile={profile} gen={gen} onSaved={(p, g) => { if (g !== gen.current) return; gen.current++; setProfile(p); setState('ready'); setEditing(false); setNotice(null) }} onCancel={() => setEditing(false)} errText={errText} />
      ) : state === 'none' ? (
        // A room's 「填入我的生日」 sends a visitor with nothing saved here
        // (Oct 1): the form opens in place instead of sending them away again.
        <p className="xtell-dy-small">{t('xtell.dy.remind')} <button type="button" className="xtell-dy-link" onClick={() => { setConfirmDelete(false); setEditing(true) }}>{t('xtell.dy.start')}</button></p>
      ) : (<>
        <div className="xtell-dy-profile">
          {/* Hidden by default (owner, Sep 28): the birth and zones show
              only in the form, after 修改. */}
          <span>{t('xtell.dy.savedHidden')}</span>
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
      </>)}
    </section>
  )
}

// ── The profile form ───────────────────────────────────────────────────────

function ProfileForm({ profile, gen, onSaved, onCancel, errText }: { profile: Profile | null; gen: { current: number }; onSaved: (p: Profile, g: number) => void; onCancel: () => void; errText: (c: string) => string }) {
  const t = useT()
  const { lang } = useLang()
  const errId = useId()
  // A new profile starts on the default; the 占星 room's old browser copy
  // is no longer offered (owner, Oct 1: it filled 1900-1-1).
  const [f, setF] = useState(() => {
    const b = profile?.birth ?? { y: 1990, m: 1, d: 1, h: 12, mi: 0, hourUnknown: false }
    return {
      y: b.y, m: b.m, d: b.d, h: b.h, mi: b.mi, hourUnknown: b.hourUnknown === true,
      // The zone of birth (owner, Sep 27: no city): a saved profile's, or
      // the visitor's own zone today.
      birthTz: birthZone(profile?.place) ?? detectedZone(),
      displayTz: profile?.displayTz ?? detectedZone(),
      fold: (profile?.fold ?? null) as 0 | 1 | null,
      consent: false,
    }
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const set = (patch: Partial<typeof f>) => { setErr(null); setF(v => ({ ...v, ...patch })) }
  const days = daysInMonth(f.y, f.m)
  const tz = f.birthTz
  const wall = f.hourUnknown ? null : resolveWallTime(f.y, f.m, f.d, f.h, f.mi, tz).kind
  const birthZones = zoneChoices([f.birthTz, detectedZone()])
  const zones = zoneChoices([f.displayTz, detectedZone()])
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
        body: JSON.stringify({ birth: { y: f.y, m: f.m, d: f.d, h: f.h, mi: f.mi, ...(f.hourUnknown ? { hourUnknown: true } : {}) }, place: ZONE_PREFIX + f.birthTz, fold: wall === 'ambiguous' ? f.fold : null, displayTz: f.displayTz, consent: f.consent }),
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
        <select className={sel} value={f.birthTz} onChange={e => set({ birthTz: e.target.value, fold: null })}>{birthZones.map(z => <option key={z} value={z}>{zoneLabel(z, lang)}</option>)}</select>
        <small>{t('xtell.dy.form.placeHint')}</small>
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

/** The reading while it is being written: the fields so far, a caret at the
 *  end of the one being written. The finished reading replaces it. */
function DraftView({ f }: { f: ReturnType<typeof partialFields> }) {
  const t = useT()
  const text = (v: unknown) => typeof v === 'string' ? v.trim() : ''
  const summary = text(f.summary), reflect = text(f.reflect)
  const themes = Array.isArray(f.themes) ? f.themes.map(x => x.trim()).filter(Boolean) : []
  // The caret sits on the last visible field; `why` is folded below.
  const at = f.why !== undefined ? 'why' : reflect ? 'reflect' : themes.length ? 'themes' : 'summary'
  const caret = (on: boolean) => on ? 'xtell-caret' : undefined
  return (
    <>
      {summary && <p className={['xtell-dy-summary', caret(at === 'summary')].filter(Boolean).join(' ')}>{summary}</p>}
      {themes.length > 0 && <>
        <p className="xtell-dy-label">{t('xtell.dy.themes')}</p>
        <ul className="xtell-dy-themes">{themes.map((x, i) => <li key={i} className={caret(at === 'themes' && i === themes.length - 1)}>{x}</li>)}</ul>
      </>}
      {reflect && <>
        <p className="xtell-dy-label">{t('xtell.dy.reflect')}</p>
        <p className={caret(at === 'reflect')}>{reflect}</p>
      </>}
    </>
  )
}

function MethodCard({ method, day, data, onRetry, onContinue }: { method: Method; day: Day; data: MethodDay; onRetry: () => void; onContinue: (row: SavedDaily) => void }) {
  const t = useT()
  const { lang } = useLang()
  const draftFields = data.status === 'writing' && data.draft ? partialFields(data.draft) : null
  const why = data.reading?.why ?? (typeof draftFields?.why === 'string' ? draftFields.why.trim() : '')
  return (
    <article className="xtell-dy-card">
      <header>
        <h3>{t(`xtell.dy.${method}`)}</h3>
        <span className="xtell-dy-muted">{day.date} · {zoneLabel(day.tz, lang)}</span>
        {data.status === 'ready' && data.reading && (() => { const r = data.reading; return (
          <ShareButton className="xtell-dy-share" spec={() => ({ icon: dailyTemple(method), link: null, title: t('xtell.dy.title'),
            kicker: `${t(`xtell.dy.${method}`)} · ${day.date}`, body: [dropDates(r.summary), r.themes.map(x => '・' + dropDates(x)).join('\n')],
            style: 'prose', name: `xtell-today-${day.date}`, log: { kind: 'daily', temple: dailyTemple(method) } })} />
        ) })()}
      </header>
      {/* Until the first words arrive: the bar and the estimate. After: the
          bar alone, while the words themselves show the progress. */}
      {(data.status === 'writing' || data.status === 'pending' || data.status === 'gone') && (
        <WaitBar seconds={WAIT_SECONDS.daily} label={draftFields && typeof draftFields.summary === 'string' && draftFields.summary.trim() ? undefined : t('xtell.dy.pending')} />
      )}
      {data.status === 'ready' && data.reading ? <ReadingView reading={data.reading} />
        : data.status === 'writing' ? (draftFields && <DraftView f={draftFields} />)
        : data.status === 'pending' || data.status === 'gone' ? null
        : data.status === 'capped' ? <p className="xtell-dy-muted">{t('xtell.dy.capped')}</p>
        : <p className="xtell-dy-muted">{t('xtell.dy.failed')} <button type="button" className="xtell-dy-link" onClick={onRetry}>{t('xtell.dy.retry')}</button></p>}
      {data.basis && (
        <details className="xtell-dy-why">
          <summary>{t('xtell.dy.why')}</summary>
          {why && <p>{why}</p>}
          <p className="xtell-dy-label">{t('xtell.dy.basis')}</p>
          <Basis method={method} basis={data.basis} />
        </details>
      )}
      {data.status === 'ready' && data.id && <ContinueInTemple key={data.id} method={method} dailyId={data.id} onContinue={onContinue} />}
    </article>
  )
}

// ── Asking a teacher about the day, in its temple ─────────────────────────
// The paid follow-up is not a chat inside this card any more (owner, Sep 28:
// "bring this to its temple"): the button opens 占星塔 (西洋占星) or 八字廟
// (八字流日) with the day's reading at the top and the usual teacher seats
// below (TempleRoom's `daily` mode). The visit is the same follow-up row as
// before (xtell_daily_followup), so the teacher still sees exactly the
// reading shown here.

/** The temple a day's reading continues in. */
export const dailyTemple = (method: unknown): 'zhanxing' | 'bazi' => method === 'bazi' ? 'bazi' : 'zhanxing'

function ContinueInTemple({ method, dailyId, onContinue }: { method: Method; dailyId: string; onContinue: (row: SavedDaily) => void }) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const go = async () => {
    if (busy) return
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/xtell/daily/followup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dailyId }) })
      const d = await res.json().catch(() => null)
      if (!res.ok || typeof d?.readingId !== 'string') { setErr(d?.code === 'daily_missing' ? 'xtell.dy.expired' : 'xtell.dy.askFailed'); return }
      const sb = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)
      const { data: row } = await sb.from('xtell_readings').select('id, temple, subject, chart, turns').eq('id', d.readingId).is('deleted_at', null).maybeSingle()
      if (row?.temple !== 'daily') { setErr('xtell.dy.askFailed'); return }
      onContinue(row as SavedDaily)
    } catch { setErr('xtell.dy.askFailed') } finally { setBusy(false) }
  }
  return <>
    <button type="button" className="xtell-dy-ask" onClick={() => void go()} disabled={busy} aria-busy={busy || undefined}>
      {t('xtell.dy.continueIn').replace('{temple}', t(`xtell.site.focus.${dailyTemple(method)}.name`))}
    </button>
    {err && <p className="xtell-dy-warn" role="alert">{t(err)}</p>}
  </>
}

/** A day's reading as its temple room shows it, above the teachers: the
 *  free reading and, folded, why (the computed basis). */
export function DailyBoard({ row }: { row: SavedDaily }) {
  const t = useT()
  const method: Method = row.subject?.method === 'bazi' ? 'bazi' : 'western'
  return (
    <article className="xtell-dy-board">
      <header>
        <h3>{t('xtell.dy.title')} · {t(`xtell.dy.${method}`)}</h3>
        <span className="xtell-dy-muted">{String(row.subject?.date ?? '')}</span>
      </header>
      {row.chart?.reading && <ReadingView reading={row.chart.reading} />}
      {row.chart?.basis && (
        <details className="xtell-dy-why">
          <summary>{t('xtell.dy.why')}</summary>
          {row.chart.reading?.why && <p>{row.chart.reading.why}</p>}
          <Basis method={method} basis={row.chart.basis} />
        </details>
      )}
    </article>
  )
}
