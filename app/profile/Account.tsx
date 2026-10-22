'use client'
// app/profile/Account.tsx — the Profile tab of www's /profile (Oct 16; owner:
// "it doesn't make sense you show logged in and language bar and then
// profile icon, display name... just messy", "organize and group the credit
// spent activities", text in X先知's sizes). One column of plain sections:
// who you are, your credits with their activity grouped by day and by app,
// the monthly plan, inviting friends, your voices (我的聲音, Oct 20), X先知's
// settings, then language and signing out. The page keeps the state and the flows (checkout, the face
// editor, the plan and referral calls); this file only lays them out.
// X先知's own front door keeps its account page as it was.

import { useMemo, useState, type ReactNode } from 'react'
import { useLang, LANGS, type Lang } from '../../lib/i18n'
import type { UserCredits, CreditTransaction } from '../../lib/credits'

const money = (cents: number) => `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toFixed(2)}`

// Which app a ledger row belongs to, from its reference_type (every type in
// credit_transactions as of Oct 22). Money in (grants, purchases, the plan)
// is its own group; a refund stays with the app it refunds, so a reserve and
// its refund net out in that app's total.
const APP_OF: Record<string, string> = {
  api: 'xdev',
  xcreate: 'xcreate', xcreate_reserve: 'xcreate', xcreate_refund: 'xcreate', xcreate_chat: 'xcreate',
  create_job: 'xcreate',
  // XFilm (Oct 22): the director, the cutting room, Auto films and 同款 makes
  // (風扇變裝 included) under one app; the stored types keep their old names.
  xdirector: 'xfilm', xcut: 'xfilm', xcreate_film_reserve: 'xfilm', xcreate_film_refund: 'xfilm',
  xcreate_remake_reserve: 'xfilm', xcreate_remake_refund: 'xfilm', xcreate_fan_reserve: 'xfilm', xcreate_fan_refund: 'xfilm',
  xtalk_werewolf: 'xgame', xgame_gomoku: 'xgame', xgame_draw: 'xgame', xgame_chess: 'xgame',
  xgame_poker: 'xgame', xgame_xiangqi: 'xgame', xgame_bridge: 'xgame',
  xtalk_turn: 'xtalk', xtalk_bid: 'xtalk', xtalk_scene: 'xtalk',
  xcharacter_chat: 'xpersona', xpersona_story: 'xpersona',
  xtell: 'xtell', tripo_task: 'xworld', xworld: 'xworld', xarch: 'xarch',
  xsports: 'xsports', xduel: 'xduel',
}
const MONEY_IN = new Set(['welcome', 'daily', 'admin_grant', 'subscription_bonus', 'subscription_bonus_expiry', 'stripe_checkout_session', 'stripe_invoice'])
const appOf = (t: CreditTransaction): string => {
  const rt = t.reference_type ?? ''
  if (MONEY_IN.has(rt) || t.kind === 'grant' || t.kind === 'purchase') return 'in'
  return APP_OF[rt] ?? 'other'
}

type AppGroup = { app: string; total: number; txns: CreditTransaction[] }
type DayGroup = { day: string; date: Date; total: number; apps: AppGroup[] }

// Newest day first; inside a day, apps in the order they were last used.
function groupByDayAndApp(rows: CreditTransaction[]): DayGroup[] {
  const days: DayGroup[] = []
  const byDay = new Map<string, DayGroup>()
  for (const t of rows) {
    const d = new Date(t.created_at)
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    let day = byDay.get(key)
    if (!day) { day = { day: key, date: d, total: 0, apps: [] }; byDay.set(key, day); days.push(day) }
    const app = appOf(t)
    let g = day.apps.find(a => a.app === app)
    if (!g) { g = { app, total: 0, txns: [] }; day.apps.push(g) }
    g.txns.push(t); g.total += t.amount_cents
    if (app !== 'in') day.total += t.amount_cents
  }
  return days
}

export type AccountProps = {
  name: string | null
  photo: string | null
  handle: string | null
  email: string | null
  onEdit: () => void
  faceEditor: ReactNode
  onSignOut: () => void
  credits: UserCredits | null
  onTopUp: () => void
  txns: CreditTransaction[]
  txLoaded: boolean
  banner: ReactNode
  plan: any
  planBusy: boolean
  planAction: (a: 'subscribe' | 'cancel' | 'resume' | 'portal', when?: string) => void
  referral: null | { link: string; pending: number; paid: number; earnedCents: number; verified: boolean; refereeStatus: string | null }
  refBusy: boolean
  refCopied: boolean
  onVerifyCard: () => void
  onCopyRef: () => void
  xoracleSettings: ReactNode
  /** 我的聲音: your cloned voices from X創作's 語音 (Voices.tsx). */
  voices: ReactNode
}

export default function AccountPanel(p: AccountProps) {
  const { t, lang, setLang } = useLang()
  const initial = (p.name ?? p.email ?? '?').charAt(0).toUpperCase()
  return (
    <div className="acct">
      {/* You */}
      <section className="acct-you">
        <span className="acct-avatar">
          {p.photo
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={p.photo} alt="" referrerPolicy="no-referrer" />
            : <span>{initial}</span>}
        </span>
        {/* Labelled, so each is plain (owner, Oct 16). An X or LINE account
            may have no email; that line is left out. The language is the
            last line; 登出 goes under the picture (owner, Oct 16). */}
        <dl className="acct-ids">
          <div><dt>{t('acct.f.name')}</dt><dd className="acct-name">{p.name ?? 'Anonymous'}</dd></div>
          {p.handle && <div><dt>{t('acct.f.id')}</dt><dd>@{p.handle}</dd></div>}
          {p.email && <div><dt>{t('acct.f.email')}</dt><dd>{p.email}</dd></div>}
          <div className="acct-f-lang">
            <dt>
              <label htmlFor="language">{t('acct.language')}</label>
            </dt>
            {/* id="language": the sidebar globe and /profile#language land
                here. The menu is see-through over its label: a phone zooms
                into any form field under 16px. */}
            <dd>
              <span className="acct-btn acct-lang">
                <span aria-hidden="true">{LANGS.find(l => l.code === lang)?.label ?? lang}</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6l6-6"/></svg>
                <select id="language" value={lang} onChange={e => setLang(e.target.value as Lang)}>
                  {LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
                </select>
              </span>
            </dd>
          </div>
        </dl>
        <button type="button" className="acct-btn acct-edit" onClick={p.onEdit}>{t('face.edit')}</button>
        <button type="button" className="acct-btn acct-out" onClick={p.onSignOut}>{t('auth.signout')}</button>
        {p.faceEditor}
      </section>

      {p.banner}

      {/* Credits, and where they went */}
      <section className="acct-section">
        <h2 className="acct-h">{t('profile.balance')}</h2>
        <div className="acct-balance">
          <span className="acct-balance-num">{money(p.credits?.balance_cents ?? 0)}</span>
          <button type="button" className="acct-btn is-primary" onClick={p.onTopUp}>{t('profile.addcredits')}</button>
        </div>
        {p.credits && (p.credits.bonus_cents ?? 0) > 0 && p.credits.bonus_expires_at && new Date(p.credits.bonus_expires_at).getTime() > Date.now() && (
          <p className="acct-note">{t('profile.bonus')
            .replace('{amount}', money(p.credits.bonus_cents ?? 0))
            .replace('{date}', new Date(p.credits.bonus_expires_at).toLocaleDateString(lang, { month: 'short', day: 'numeric' }))}</p>
        )}
        {p.credits && p.credits.lifetime_spent_cents > 0 && (
          <p className="acct-note">{t('profile.spent')} {money(p.credits.lifetime_spent_cents)}{p.credits.lifetime_granted_cents > 0 ? ` · ${t('profile.granted')} ${money(p.credits.lifetime_granted_cents)}` : ''}</p>
        )}
        <CreditActivity txns={p.txns} loaded={p.txLoaded} />
      </section>

      {p.plan?.available && <PlanSection plan={p.plan} busy={p.planBusy} act={p.planAction} />}

      {p.referral && (
        <section className="acct-section">
          <h2 className="acct-h">{t('profile.ref.title')}</h2>
          <p className="acct-note">{t('profile.ref.blurb')}</p>
          {p.referral.refereeStatus === 'pending' && !p.referral.verified && (
            <p className="acct-row">
              <span>{t('profile.ref.unlock')}</span>
              <button type="button" className="acct-btn is-primary" onClick={p.onVerifyCard} disabled={p.refBusy}>{p.refBusy ? '…' : t('profile.ref.verify')}</button>
            </p>
          )}
          <div className="acct-ref">
            <code>{p.referral.link}</code>
            <button type="button" className="acct-btn" onClick={p.onCopyRef}>{p.refCopied ? t('profile.ref.copied') : t('profile.ref.copy')}</button>
          </div>
          <p className="acct-stats">
            <span>{t('profile.ref.joined')} <b>{p.referral.paid}</b></span>
            <span>{t('profile.ref.pending')} <b>{p.referral.pending}</b></span>
            <span>{t('profile.ref.earned')} <b>{money(p.referral.earnedCents)}</b></span>
          </p>
        </section>
      )}

      {p.voices}

      {/* X先知: the birth details and the personality type (its readings
          are a Library section). */}
      <section className="acct-section acct-xoracle">
        <h2 className="acct-h">{t('nav.xoracle')}</h2>
        {p.xoracleSettings}
      </section>

    </div>
  )
}

// ── Credit activity: by day, then by app ────────────────────────────────

// The three latest days first, so the plan and settings below stay in
// reach; each press shows a week more.
const DAYS_FIRST = 3
const DAYS_STEP = 7

function CreditActivity({ txns, loaded }: { txns: CreditTransaction[]; loaded: boolean }) {
  const { t, lang } = useLang()
  const days = useMemo(() => groupByDayAndApp(txns), [txns])
  const [shown, setShown] = useState(DAYS_FIRST)
  const [open, setOpen] = useState<Record<string, boolean>>({})

  // This month's spending, by app, biggest first.
  const month = useMemo(() => {
    const now = new Date()
    const by = new Map<string, number>()
    for (const tx of txns) {
      const d = new Date(tx.created_at)
      if (d.getFullYear() !== now.getFullYear() || d.getMonth() !== now.getMonth()) continue
      const app = appOf(tx)
      if (app === 'in') continue
      by.set(app, (by.get(app) ?? 0) + tx.amount_cents)
    }
    const apps = [...by.entries()].filter(([, c]) => c < 0).sort((a, b) => a[1] - b[1])
    return { total: apps.reduce((s, [, c]) => s + c, 0), apps }
  }, [txns])

  const appName = (app: string) => app === 'in' ? t('acct.in') : app === 'other' ? t('acct.other') : t('nav.' + app)
  const dayLabel = (d: Date) => {
    const today = new Date(); const y = new Date(); y.setDate(today.getDate() - 1)
    const same = (a: Date, b: Date) => a.toDateString() === b.toDateString()
    const date = d.toLocaleDateString(lang, { month: 'long', day: 'numeric', weekday: 'short' })
    return same(d, today) ? `${t('acct.today')} · ${date}` : same(d, y) ? `${t('acct.yesterday')} · ${date}` : date
  }
  const time = (iso: string) => new Date(iso).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit', hour12: false })

  if (!loaded) return <p className="acct-empty">{t('profile.ledger.loading')}</p>
  if (days.length === 0) return <p className="acct-empty">{t('profile.ledger.empty')}</p>
  return (
    <div className="acct-activity">
      <h3 className="acct-h3">{t('acct.activity')}</h3>
      {month.apps.length > 0 && (
        <p className="acct-month">
          <span>{t('acct.thismonth').replace('{amount}', money(-month.total))}</span>
          {month.apps.map(([app, c]) => <span key={app} className="acct-chip">{appName(app)} {money(-c)}</span>)}
        </p>
      )}
      {days.slice(0, shown).map(day => (
        <div key={day.day} className="acct-day">
          <div className="acct-day-head">
            <span>{dayLabel(day.date)}</span>
            {day.total !== 0 && <span className="acct-amt">{money(day.total)}</span>}
          </div>
          <ul className="acct-apps">
            {day.apps.map(g => {
              const k = `${day.day}:${g.app}`
              const isOpen = !!open[k]
              return (
                <li key={g.app}>
                  <button type="button" className="acct-app" aria-expanded={isOpen} onClick={() => setOpen(s => ({ ...s, [k]: !s[k] }))}>
                    <span className="acct-app-name">{appName(g.app)}</span>
                    <span className="acct-app-count">{t('acct.charges').replace('{n}', String(g.txns.length))}</span>
                    <span className={g.total >= 0 ? 'acct-amt is-in' : 'acct-amt'}>{g.total > 0 ? '+' : ''}{money(g.total)}</span>
                    <span className="acct-caret" aria-hidden>{isOpen ? '▾' : '▸'}</span>
                  </button>
                  {isOpen && (
                    <ul className="acct-charges">
                      {g.txns.map(tx => (
                        <li key={tx.id}>
                          <time dateTime={tx.created_at}>{time(tx.created_at)}</time>
                          <span className="acct-charge-what">{tx.description ?? tx.reference_type ?? ''}</span>
                          <span className={tx.amount_cents >= 0 ? 'acct-amt is-in' : 'acct-amt'}>{tx.amount_cents > 0 ? '+' : ''}{money(tx.amount_cents)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ))}
      {shown < days.length && <button type="button" className="acct-btn acct-more" onClick={() => setShown(n => n + DAYS_STEP)}>{t('acct.more')}</button>}
      {txns.length >= 300 && shown >= days.length && <p className="acct-note">{t('acct.limit').replace('{n}', '300')}</p>}
    </div>
  )
}

// ── The monthly plan, compact ───────────────────────────────────────────

function PlanSection({ plan, busy, act }: { plan: any; busy: boolean; act: AccountProps['planAction'] }) {
  const { t, lang } = useLang()
  const sub = plan.subscription
  const live = !!sub && ['active', 'trialing', 'past_due'].includes(sub.status)
  const when = sub?.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toLocaleDateString(lang, { year: 'numeric', month: 'short', day: 'numeric' }) : ''
  return (
    <section className="acct-section">
      <h2 className="acct-h">{t('profile.plan.title')} <span className="acct-h-note">{plan.plan.price}{t('profile.plan.permonth')}</span></h2>
      {live
        ? <p className={sub.status === 'past_due' ? 'acct-text is-warn' : 'acct-text'}>
            {sub.status === 'past_due' ? t('profile.plan.pastdue')
              : sub.cancelAtPeriodEnd ? t('profile.plan.ending').replace('{date}', when)
              : t('profile.plan.active').replace('{date}', when)}
          </p>
        : <>
            <p className="acct-text">{t('profile.plan.pitch')
              .replace('{total}', money(plan.plan.creditCents + plan.plan.bonusCents))
              .replace('{credit}', money(plan.plan.creditCents))
              .replace('{bonus}', money(plan.plan.bonusCents))}</p>
            <p className="acct-note">{t('profile.plan.fine')}</p>
          </>}
      <div className="acct-actions">
        {!live && <button type="button" className="acct-btn is-primary" disabled={busy} onClick={() => act('subscribe')}>{t('profile.plan.subscribe')}</button>}
        {live && !sub.cancelAtPeriodEnd && <button type="button" className="acct-btn" disabled={busy} onClick={() => act('cancel', when)}>{t('profile.plan.cancel')}</button>}
        {live && sub.cancelAtPeriodEnd && <button type="button" className="acct-btn is-primary" disabled={busy} onClick={() => act('resume')}>{t('profile.plan.resume')}</button>}
        {sub && <button type="button" className="acct-btn" disabled={busy} onClick={() => act('portal')}>{t('profile.plan.manage')}</button>}
      </div>
    </section>
  )
}
