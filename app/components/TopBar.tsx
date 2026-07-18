'use client'

// Content-area top bar (desktop only). Shows the page title on the left and
// the account controls (language toggle + profile avatar + Sign In/Out) on the
// right. On mobile this bar is hidden and the nav's hamburger overlay carries
// the auth actions instead.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import type { User } from '@supabase/supabase-js'
import { useAuthModal } from '../../lib/AuthModalContext'
import { useLang } from '../../lib/i18n'
import { usePageTitle } from '../../lib/PageTitleContext'

// Page titles shown in the bar (a red `//` eyebrow on top, title below),
// keyed by i18n string keys. Every page's big title lives HERE, not in the
// page body (CC, July 16) — only contextual sub-lines stay in content.
// Pages with dynamic titles (XDuel's wizard steps) override via
// PageTitleContext; the entry below is their SSR/first-paint fallback.
const TITLES: Record<string, { labelKey: string; titleKey: string; accentX?: boolean }> = {
  '/xcreate': { labelKey: 'xcreate.eyebrow', titleKey: 'xcreate.title' },
  '/xduel':   { labelKey: 'xduel.eyebrow',   titleKey: 'xduel.start' },
  '/xvote':   { labelKey: 'xvote.eyebrow',   titleKey: 'xvote.title' },
  '/xboard':  { labelKey: 'xboard.eyebrow',  titleKey: 'xboard.title', accentX: true },
}

export default function TopBar() {
  const pathname = usePathname()
  const { show } = useAuthModal()
  const { override } = usePageTitle()
  const { lang, setLang, t } = useLang()
  const [user, setUser] = useState<User | null>(null)
  const [authLoaded, setAuthLoaded] = useState(false)
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  )

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => { setUser(data.user); setAuthLoaded(true) })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null); setAuthLoaded(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  // Hidden on the password gate (same rule as the nav).
  if (pathname === '/coming-soon') return null

  const handleLogout = async () => { await supabase.auth.signOut(); window.location.reload() }
  const staticEntry = TITLES[pathname] ?? null
  const shown = override
    ?? (staticEntry ? { eyebrow: t(staticEntry.labelKey), title: t(staticEntry.titleKey), accentX: staticEntry.accentX } : null)

  return (
    <header className="topbar">
      <div className="topbar-title">
        {shown && (
          <>
            <span className="topbar-eyebrow">{shown.eyebrow}</span>
            <span className="topbar-h">
              {shown.accentX
                ? <><span className="tb-accent">{shown.title.slice(0, 1)}</span>{shown.title.slice(1)}</>
                : shown.title}
            </span>
          </>
        )}
      </div>
      <div className="topbar-auth">
        {/* Language toggle — shows the language you'd switch TO. */}
        <button
          className="lang-toggle"
          onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}
          aria-label={lang === 'en' ? 'Switch to Chinese' : 'Switch to English'}
        >
          {lang === 'en' ? '中文' : 'EN'}
        </button>
        {!authLoaded ? (
          <div style={{ width: 30, height: 30 }} aria-hidden />
        ) : user ? (
          <>
            <Link href="/profile" aria-label={t('nav.profile')}>
              {user.user_metadata?.avatar_url ? (
                <img src={user.user_metadata.avatar_url} alt="" style={{ width: 30, height: 30, borderRadius: '50%', border: '1px solid var(--border)', display: 'block' }} />
              ) : (
                <div className="topbar-avatar">
                  {(user.user_metadata?.full_name || user.email || '?').split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)}
                </div>
              )}
            </Link>
            <button className="nav-login" onClick={handleLogout}>{t('auth.signout')}</button>
          </>
        ) : (
          <button className="nav-login" onClick={() => show()}>{t('auth.signin')}</button>
        )}
      </div>
    </header>
  )
}
