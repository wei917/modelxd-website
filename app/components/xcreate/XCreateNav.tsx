'use client'
// The xcreate.modelxd.com shell: top bar, footer, and the small pieces other
// shared pages borrow on that host (the wordmark for the sign-in dialog, the
// note on the legal pages). Nav.tsx swaps this in when useSite() is
// 'xcreate'; the root layout renders the footer there. The studio itself is
// app/xcreate/client.tsx (Codex). The views are URL state the studio owns:
// `/` Create, `/?view=creations`, `/?view=templates` (Sep 26 contract).

import Link from 'next/link'
import { Suspense, useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { useAuthModal } from '../../../lib/AuthModalContext'
import { LANGS, useLang, type Lang } from '../../../lib/i18n'
import { useSite } from '../../../lib/useSite'
import './xcreate-shell.css'

export type XCreateView = 'create' | 'creations' | 'templates'

const VIEWS: { view: XCreateView; href: string; label: string }[] = [
  { view: 'create',    href: '/',               label: 'xcreate.site.nav.create' },
  { view: 'creations', href: '/?view=creations', label: 'xcreate.site.nav.creations' },
  { view: 'templates', href: '/?view=templates', label: 'xcreate.site.nav.templates' },
]

/** The mark: the ModelXD logo beside the name in the reader's language
 *  (XCreate, X創作 / X创作, X作成, X창작; owner, Sep 28, as XTell is X先知),
 *  the X in the accent as XTell's mark does it (owner, Sep 26: logo + text,
 *  no full stop). */
export function XCreateMark() {
  const { t } = useLang()
  const brand = t('xcreate.site.brand')
  return <span className="xcs-brand"><img className="xcs-logo" src="/logo.png" alt="" width={26} height={26} /><span><span className="xcs-accent">{brand.slice(0, 1)}</span>{brand.slice(1)}</span></span>
}

function viewOf(param: string | null | undefined): XCreateView {
  return param === 'creations' || param === 'templates' ? param : 'create'
}

/** Nav links + the tab title. Reads the query, so it renders under Suspense
 *  (a statically rendered page cannot know the query); the fallback is the
 *  same links with Create current. */
function Views({ view }: { view: XCreateView | null }) {
  const { t } = useLang()
  const pathname = usePathname()
  const studio = pathname === '/' || pathname === '/xcreate'
  return <nav className="xcs-nav" aria-label={t('xcreate.site.navigation')}>
    {VIEWS.map(v => <Link key={v.view} href={v.href} aria-current={studio && (view ?? 'create') === v.view ? 'page' : undefined}>{t(v.label)}</Link>)}
  </nav>
}

function LiveViews() {
  const { lang, t } = useLang()
  const pathname = usePathname()
  const view = viewOf(useSearchParams()?.get('view'))
  // The tab title follows the page, the view and the language. The server's
  // title is the first paint's and sits in <head> before it (next.config
  // htmlLimitedBots), so a title set here is not overwritten afterwards.
  useEffect(() => {
    const compute = () => {
      const brand = t('xcreate.site.brand')
      if (pathname === '/' || pathname === '/xcreate') return view === 'create' ? brand : `${t('xcreate.site.nav.' + view)} | ${brand}`
      if (pathname === '/profile') return `${t('profile.account')} | ${brand}`
      if (pathname === '/terms') return `${t('xtell.site.title.terms')} | ${brand}`
      if (pathname === '/privacy') return `${t('xtell.site.title.privacy')} | ${brand}`
      return null
    }
    const apply = () => { const title = compute(); if (title) document.title = title }
    apply()
  }, [lang, t, pathname, view])
  return <Views view={view} />
}

export default function XCreateNav({ user }: { user: User | null }) {
  const { lang, setLang, t } = useLang()
  const { show } = useAuthModal()
  const initial = (user?.user_metadata?.full_name || user?.email || 'X').slice(0, 1).toUpperCase()
  // The Google photo, as www's nav shows it; the initial only without one
  // (owner, Sep 26: a letter read as "not updated after sign in").
  const photo = typeof user?.user_metadata?.avatar_url === 'string' ? user.user_metadata.avatar_url : null
  return (
    <header className="xcs-top">
      <a href="#xcreate-main" className="xcs-skip" onClick={event => {
        event.preventDefault()
        // The studio carries #xcreate-main; shared pages (account, terms,
        // privacy) are reached through their <main> landmark.
        const main = document.getElementById('xcreate-main') ?? document.querySelector<HTMLElement>('main') ?? document.querySelector<HTMLElement>('.app-main')
        if (!main) return
        if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1')
        main.focus()
        main.scrollIntoView({ block: 'start' })
      }}>{t('xtell.site.skip')}</a>
      <div className="xcs-top-inner">
        <Link href="/" className="xcs-home" aria-label={t('xcreate.site.brand')}><XCreateMark /></Link>
        <Suspense fallback={<Views view={null} />}><LiveViews /></Suspense>
        <div className="xcs-actions">
          <select className="xcs-lang" value={lang} onChange={e => setLang(e.target.value as Lang)} aria-label={t('xtell.site.language')}>
            {LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
          {user
            ? <Link href="/profile" className="xcs-avatar" aria-label={t('profile.account')}>{photo ? <img src={photo} alt="" referrerPolicy="no-referrer" /> : <span aria-hidden="true">{initial}</span>}</Link>
            : <button type="button" className="xcs-signin" onClick={() => show()}>{t('auth.signin')}</button>}
        </div>
      </div>
    </header>
  )
}

export function XCreateFooter() {
  const { t } = useLang()
  return <footer className="xcs-footer">
    <div className="xcs-footer-inner">
      <p>{t('xcreate.site.tagline')} <span className="xcs-maker">by <a href="https://www.modelxd.com" target="_blank" rel="noopener">ModelXD <span aria-hidden="true">↗</span></a></span></p>
      <nav aria-label={t('xtell.site.legal')}>
        <span>{t('xcreate.site.footnote')}</span>
        <Link href="/terms">{t('nav.terms')}</Link>
        <Link href="/privacy">{t('nav.privacy')}</Link>
      </nav>
    </div>
  </footer>
}

/** One line on the shared legal pages, on the XCreate host only: the text
 *  below names ModelXD, and a visitor who came in through XCreate should
 *  know it covers them. Renders nothing on the other doors. */
export function XCreateLegalNote() {
  const { t } = useLang()
  if (useSite() !== 'xcreate') return null
  return <p className="xcs-legal-note">{t('xcreate.site.legalNote')}</p>
}
