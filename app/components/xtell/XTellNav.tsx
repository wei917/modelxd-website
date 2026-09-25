'use client'

import Link from 'next/link'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { useAuthModal } from '../../../lib/AuthModalContext'
import { LANGS, useLang, type Lang } from '../../../lib/i18n'
import { DISPLAY_TEMPLES, type TempleKey } from './TempleArtwork'

/** The wordmark per language (owner, Sep 24): XTell in English, X先知 in
 *  Chinese, X占い / X운세 in Japanese / Korean. The leading X keeps its accent. */
export function XTellMark() {
  const { t } = useLang()
  const brand = t('xtell.site.brand')
  return <span className="xtell-brand xtell-focus-brand"><span>{brand.slice(0, 1)}</span>{brand.slice(1)}</span>
}

export default function XTellNav({ user }: { user: User | null }) {
  const { lang, setLang, t } = useLang()
  const { show } = useAuthModal()
  const pathname = usePathname()
  // The tab title follows the language and the place: the explorer, a
  // temple (from the hash), the account page, the legal pages. Their own
  // metadata (server, English) is the fallback the first paint shows.
  // Next 16 streams the metadata <title> in after the shell has hydrated, so
  // a title set once at mount gets overwritten — set it again shortly after.
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
    const timers = [setTimeout(apply, 800), setTimeout(apply, 2500)]
    window.addEventListener('hashchange', apply)
    return () => { timers.forEach(clearTimeout); window.removeEventListener('hashchange', apply) }
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
        <a href="/" aria-label="XTell"><XTellMark /></a>
        {/* The avatar on the right IS the account link; a second text link
            said the same thing twice (owner, Sep 24). */}
        <nav className="xtell-nav-links" aria-label={t('xtell.site.navigation')}>
          <a href="/" aria-current={pathname === '/' || pathname === '/xtell' ? 'page' : undefined}
            onClick={e => {
              // Inside a temple, 探索殿堂 is the back link: clear the hash in
              // place so the explorer keeps the selected temple instead of
              // reloading to the default one.
              const p = window.location.pathname
              if ((p === '/' || p === '/xtell') && window.location.hash) { e.preventDefault(); window.location.hash = ''; window.scrollTo({ top: 0 }) }
            }}>{t('xtell.site.street')}</a>
        </nav>
        <div className="xtell-nav-actions">
          <select value={lang} onChange={e => setLang(e.target.value as Lang)} aria-label={t('xtell.site.language')}>
            {LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
          {user ? <Link href="/profile" className="xtell-account-link" aria-label={t('xtell.site.account')}>
            <span aria-hidden="true">{(user.user_metadata?.full_name || user.email || 'X').slice(0, 1).toUpperCase()}</span>
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
    <nav aria-label={t('xtell.site.legal')}><Link href="/terms">{t('nav.terms')}</Link><Link href="/privacy">{t('nav.privacy')}</Link><span className="xtell-footer-maker">by <a href="https://www.modelxd.com" target="_blank" rel="noopener"><img src="/logo.png" alt="" width={18} height={18} />ModelXD</a></span></nav>
  </footer>
}
