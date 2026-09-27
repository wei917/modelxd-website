'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { useAuthModal } from '../../../lib/AuthModalContext'
import { useLang } from '../../../lib/i18n'
import { TempleArtwork, DISPLAY_TEMPLES, type TempleKey } from './TempleArtwork'

/** The wordmark per language (owner, Sep 24): XTell in English, X先知 in
 *  Chinese, X占い / X운세 in Japanese / Korean. The leading X keeps its accent. */
export function XTellMark() {
  const { t } = useLang()
  const brand = t('xtell.site.brand')
  // The ModelXD logo beside the name, as XCreate's mark does it (owner,
  // Sep 26). The logo file has a white plate, so it sits only on white
  // surfaces: the top bar and the sign-in card are white for that reason.
  return <span className="xtell-brand xtell-focus-brand">
    <img className="xtell-logo" src="/logo.png" alt="" width={30} height={30} />
    <span><span className="xtell-accent">{brand.slice(0, 1)}</span>{brand.slice(1)}</span>
  </span>
}

export default function XTellNav({ user }: { user: User | null }) {
  const { lang, t } = useLang()
  const { show } = useAuthModal()
  const pathname = usePathname()
  const [activeTemple, setActiveTemple] = useState<TempleKey | null>(null)
  useEffect(() => {
    const sync = () => {
      const key = window.location.hash.slice(1) as TempleKey
      setActiveTemple((pathname === '/' || pathname === '/xtell') && DISPLAY_TEMPLES.includes(key) ? key : null)
    }
    sync()
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [pathname])
  // The tab title follows the language and the place: the explorer, a
  // temple (from the hash), the account page, the legal pages. The server's
  // metadata is already this language's explorer title (lib/xtell-meta.ts)
  // and sits in <head> before first paint (next.config htmlLimitedBots), so
  // nothing overwrites a title set here; no timed re-sets are needed.
  useEffect(() => {
    const brand = t('xtell.site.brand')
    const compute = () => {
      if (pathname === '/' || pathname === '/xtell') {
        const key = window.location.hash.slice(1) as TempleKey
        return DISPLAY_TEMPLES.includes(key) ? `${t('xtell.site.focus.' + key + '.name')} | ${brand}` : t('xtell.site.tab')
      }
      if (pathname === '/profile') return `${t('xtell.site.account')} | ${brand}`
      if (pathname === '/terms') return `${t('xtell.site.title.terms')} | ${brand}`
      if (pathname === '/privacy') return `${t('xtell.site.title.privacy')} | ${brand}`
      return null
    }
    const apply = () => { const title = compute(); if (title) document.title = title }
    apply()
    window.addEventListener('hashchange', apply)
    return () => window.removeEventListener('hashchange', apply)
  }, [lang, t, pathname])
  return (
    <header className="xtell-nav">
      <a href="#xtell-main" className="xtell-skip" onClick={event => {
        event.preventDefault()
        // The explorer and the account page carry #xtell-main; shared pages
        // (terms, privacy) are reached through their <main> landmark.
        const main = document.getElementById('xtell-main') ?? document.querySelector<HTMLElement>('main') ?? document.querySelector<HTMLElement>('.app-main')
        if (!main) return
        if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1')
        main.focus()
        main.scrollIntoView({ block: 'start' })
      }}>{t('xtell.site.skip')}</a>
      <div className="xtell-nav-inner">
        {/* The wordmark is the way back to the street. Inside a temple it
            clears the hash in place, so the street keeps showing the temple
            just left instead of reloading to the default one. */}
        <a href="/" aria-label="XTell" onClick={e => {
          const p = window.location.pathname
          if ((p === '/' || p === '/xtell') && window.location.hash) { e.preventDefault(); window.location.hash = ''; window.scrollTo({ top: 0 }) }
        }}><XTellMark /></a>
        {/* Every temple, one compact row after the wordmark (owner, Sep 27).
            The avatar on the right IS the account link (owner, Sep 24). */}
        <nav className="xtell-temple-nav" aria-label={t('xtell.site.navigation')}>
          {DISPLAY_TEMPLES.map(key => <a key={key} href={'/#' + key}
            aria-label={t('xtell.site.focus.' + key + '.name')}
            aria-current={activeTemple === key ? 'page' : undefined}>
            <TempleArtwork temple={key} kind="icon" clear className="xtell-nav-icon" />
            <span>{t('xtell.site.focus.' + key + '.short')}</span>
          </a>)}
        </nav>
        <div className="xtell-nav-actions">
          {/* The Google photo, as XCreate's and www's navs show it; the
              initial only without one (owner, Sep 26). no-referrer: Google's
              avatar host can refuse hotlinks that carry a referrer. */}
          {user ? <Link href="/profile" className="xtell-account-link" aria-label={t('xtell.site.account')}>
            {typeof user.user_metadata?.avatar_url === 'string' && user.user_metadata.avatar_url
              ? <img src={user.user_metadata.avatar_url} alt="" referrerPolicy="no-referrer" />
              : <span aria-hidden="true">{(user.user_metadata?.full_name || user.email || 'X').slice(0, 1).toUpperCase()}</span>}
          </Link> : <button className="xtell-button" onClick={() => show()}>{t('auth.signin')}</button>}
        </div>
      </div>
    </header>
  )
}

export function XTellFooter() {
  const { t } = useLang()
  return <footer className="xtell-footer">
    <div><span className="xtell-footer-brand">{t('xtell.site.brand')}</span><span>{t('xtell.site.entertainment')}</span></div>
    <nav aria-label={t('xtell.site.legal')}><Link href="/terms">{t('nav.terms')}</Link><Link href="/privacy">{t('nav.privacy')}</Link><span className="xtell-footer-maker">by <a href="https://www.modelxd.com" target="_blank" rel="noopener">ModelXD</a></span></nav>
  </footer>
}
