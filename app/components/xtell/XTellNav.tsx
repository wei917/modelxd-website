'use client'

import Link from 'next/link'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { useAuthModal } from '../../../lib/AuthModalContext'
import { LANGS, useLang, type Lang } from '../../../lib/i18n'

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
  // The tab title follows the language; the server can only know the host.
  // Next 16 streams the metadata <title> in after the shell has hydrated, so
  // a title set once at mount gets overwritten — set it again shortly after.
  useEffect(() => {
    const apply = () => { document.title = t('xtell.site.tab') }
    apply()
    const timers = [setTimeout(apply, 800), setTimeout(apply, 2500)]
    return () => timers.forEach(clearTimeout)
  }, [lang, t])
  return (
    <header className="xtell-nav">
      <a href="#xtell-main" className="xtell-skip" onClick={event => {
        event.preventDefault()
        const main = document.getElementById('xtell-main')
        main?.focus()
        main?.scrollIntoView({ block: 'start' })
      }}>{t('xtell.site.skip')}</a>
      <div className="xtell-nav-inner">
        <a href="/" aria-label="XTell"><XTellMark /></a>
        {/* The avatar on the right IS the account link; a second text link
            said the same thing twice (owner, Sep 24). */}
        <nav className="xtell-nav-links" aria-label={t('xtell.site.navigation')}>
          <a href="/" aria-current={pathname === '/' || pathname === '/xtell' ? 'page' : undefined}>{t('xtell.site.street')}</a>
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
    <nav aria-label={t('xtell.site.legal')}><Link href="/terms">{t('nav.terms')}</Link><Link href="/privacy">{t('nav.privacy')}</Link><span>by ModelXD</span></nav>
  </footer>
}
