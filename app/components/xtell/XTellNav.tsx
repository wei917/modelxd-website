'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { useAuthModal } from '../../../lib/AuthModalContext'
import { LANGS, useLang, type Lang } from '../../../lib/i18n'

export function XTellMark() {
  return <span className="xtell-brand"><span className="xtell-seal" aria-hidden="true">卜</span><span>XTell<span className="xtell-brand-note">X算命</span></span></span>
}

export default function XTellNav({ user }: { user: User | null }) {
  const { lang, setLang, t } = useLang()
  const { show } = useAuthModal()
  const pathname = usePathname()
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
        <nav className="xtell-nav-links" aria-label={t('xtell.site.navigation')}>
          <a href="/" aria-current={pathname === '/' || pathname === '/xtell' ? 'page' : undefined}>{t('xtell.site.street')}</a>
          <Link href="/profile" aria-current={pathname === '/profile' ? 'page' : undefined}>{t('xtell.site.account')}</Link>
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
    <div><span className="xtell-footer-brand">XTell</span><span>{t('xtell.site.entertainment')}</span></div>
    <nav aria-label={t('xtell.site.legal')}><Link href="/terms">{t('nav.terms')}</Link><Link href="/privacy">{t('nav.privacy')}</Link><span>by ModelXD</span></nav>
  </footer>
}
