'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import type { User } from '@supabase/supabase-js'
import { useAuthModal } from '../../lib/AuthModalContext'
import { useLang } from '../../lib/i18n'
import { XCREATE_TEMPLATES } from '../xcreate/templates'

// The logo doubles as the home link, so the explicit "Home" item is gone.
const NAV_LINKS = [
  { href: '/xduel',       i18n: 'nav.xduel',       protected: true,  icon: 'duel'   },
  { href: '/xcreate',     i18n: 'nav.xcreate',     protected: true,  icon: 'create' },
  { href: '/xvote',       i18n: 'nav.xvote',       protected: true,  icon: 'vote'   },
  { href: '/xboard',      i18n: 'nav.xboard',      protected: false, icon: 'board'  },
]

// Inline SVG icons (no icon-font dependency). 18px, inherit color via
// currentColor so the active/hover states tint them automatically.
function NavIcon({ name }: { name: string }) {
  const p = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, style: { flexShrink: 0 } }
  switch (name) {
    case 'duel':   return (<svg {...p}><path d="M21 3v5l-11 9l-4 4l-3-3l4-4l9-11z"/><path d="M5 13l6 6"/><path d="M14.32 17.32l3.68 3.68l3-3l-3.68-3.68"/><path d="M10 5.5l-2-2.5h-5v5l3 2.5"/></svg>)
    case 'create': return (<svg {...p}><path d="M6 21l15-15l-3-3l-15 15l3 3z"/><path d="M15 6l3 3"/><path d="M9 3a2 2 0 0 0 2 2a2 2 0 0 0-2 2a2 2 0 0 0-2-2a2 2 0 0 0 2-2"/></svg>)
    case 'vote':   return (<svg {...p}><path d="M7 11v8a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3a4 4 0 0 0 4-4v-1a2 2 0 0 1 4 0v5h3a2 2 0 0 1 2 2l-1 5a2 3 0 0 1-2 2h-7a3 3 0 0 1-3-3"/></svg>)
    case 'board':  return (<svg {...p}><path d="M4 20h16"/><path d="M5 12h2v7H5z"/><path d="M10.5 8h2v11h-2z"/><path d="M16 4h2v15h-2z"/></svg>)
    default:       return null
  }
}

// Output-mode glyphs for history rows — same shapes as ModeIcon in
// app/xcreate/page.tsx (the Mode Selection tabs); keep in sync. 14px,
// monochrome via currentColor (CC: no color emoji in history rows).
function HistoryModeIcon({ m }: { m: string }) {
  const p = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, style: { flexShrink: 0 } }
  if (m === 'text')  return (<svg {...p}><path d="M4 6h16"/><path d="M4 12h10"/><path d="M4 18h14"/></svg>)
  if (m === 'image') return (<svg {...p}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>)
  return (<svg {...p}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9l5 3l-5 3z"/></svg>)
}

// History row title: template name when the prompt came from a template
// (matched by the prompt prefix up to the template's first {{placeholder}}),
// else the first few words of the prompt. Zero-cost "summary" — real LLM
// titles would be a paid call per run (post-launch idea).
function historyTitle(prompt: string): string {
  const clean = (s: string) => s.replace(/\{\{|\}\}/g, '').trim()
  const p = clean(prompt)
  for (const tpl of XCREATE_TEMPLATES) {
    const braceAt = tpl.starterPrompt.indexOf('{{')
    const prefix = clean(braceAt >= 0 ? tpl.starterPrompt.slice(0, braceAt) : tpl.starterPrompt).slice(0, 60)
    if (prefix.length >= 10 && p.startsWith(prefix.slice(0, Math.min(prefix.length, 40)))) return tpl.title
  }
  const words = p.split(/\s+/)
  return words.slice(0, 7).join(' ') + (words.length > 7 ? '…' : '')
}

export default function Nav() {
  const pathname = usePathname()
  const { show } = useAuthModal()
  const { lang, t } = useLang()
  const [menuOpen, setMenuOpen] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  // XCreate history (chat-history pattern): shown under the menu — with a
  // divider so it reads as a separate layer, not more menu items — only
  // while the user is in XCreate. Collapsible, persisted.
  const [recent, setRecent] = useState<Array<{ id: string; prompt: string; mode: string; created_at: string }>>([])
  const [recentCollapsed, setRecentCollapsed] = useState(false)
  const [authLoaded, setAuthLoaded] = useState(false)
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  )

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user)
      setAuthLoaded(true)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      setAuthLoaded(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    try { setRecentCollapsed(localStorage.getItem('xcreate.history.collapsed') === '1') } catch { /* private mode */ }
  }, [])

  // Fetch the last 10 runs whenever the user lands on /xcreate (also
  // refreshes after a generation → the page URL gains ?id= → pathname
  // stays but a re-nav elsewhere and back re-fetches; good enough v1).
  const onXcreate = pathname?.startsWith('/xcreate') ?? false
  useEffect(() => {
    if (!onXcreate || !user) { setRecent([]); return }
    let cancelled = false
    supabase.from('xcreates')
      .select('id, prompt, mode, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(10)
      .then(({ data }) => { if (!cancelled) setRecent((data ?? []) as any[]) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onXcreate, user?.id])

  const toggleRecent = () => {
    setRecentCollapsed(c => {
      try { localStorage.setItem('xcreate.history.collapsed', c ? '0' : '1') } catch { /* private mode */ }
      return !c
    })
  }

  // Auto-close the mobile menu whenever the route changes — otherwise
  // tapping a link leaves the overlay covering the page you just
  // navigated to.
  useEffect(() => { setMenuOpen(false) }, [pathname])

  // Daily $1 grant — fire once per UTC day per browser. The server
  // grant_daily_credits function is idempotent so duplicate POSTs are
  // safe, but we gate on localStorage to keep the chatter down on
  // every page load. The key is per-user so a different account on
  // the same browser still gets its grant. Cleared automatically on
  // logout (different user.id → fresh check).
  useEffect(() => {
    if (!user) return
    if (typeof window === 'undefined') return
    const todayUtc = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
    const key = `modelxd:dailyGrant:${user.id}`
    const last = window.localStorage.getItem(key)
    if (last === todayUtc) return
    fetch('/api/credits/ensure-daily', { method: 'POST' })
      .then(r => r.ok ? window.localStorage.setItem(key, todayUtc) : null)
      .catch(() => {})
  }, [user?.id])

  // Hide the Nav on the password gate. The links would just redirect
  // back to /coming-soon (no cookie yet) and the "Log in" button would
  // try to start an OAuth flow that lands in the same loop.
  // NOTE: this early return MUST stay below every hook above — React
  // requires the same hooks to run in the same order on every render,
  // or you get "Rendered fewer hooks than expected".
  if (pathname === '/coming-soon') return null

  const handleLogout = async () => {
    await supabase.auth.signOut()
    window.location.reload()
  }

  const handleProtectedClick = (e: React.MouseEvent, href: string, isProtected: boolean) => {
    if (isProtected && !user) {
      e.preventDefault()
      show(href)
    }
  }

  return (
    <nav className="nav">
      <Link href="/" className="nav-logo-text" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <img src="/logo.png" alt="ModelXD" style={{ width: 36, height: 36, borderRadius: 8 }} />
        <span>{lang === 'zh' ? '模型大對決' : <>Model<span className="x">XD</span></>}</span>
      </Link>
      <div className="nav-links">
        {NAV_LINKS.map(({ href, i18n, protected: isProtected, icon }) => (
          <Link
            key={href}
            href={href}
            className={pathname === href ? 'active' : ''}
            onClick={(e) => handleProtectedClick(e, href, isProtected)}
          >
            <NavIcon name={icon} />{t(i18n)}
          </Link>
        ))}
      </div>
      {/* XCreate history — under the menu with a divider line so it reads
          as a distinct layer (CC), like every AI chat app's history list.
          Rows are lowercase / smaller than the uppercase menu items. */}
      {onXcreate && recent.length > 0 && (
        <div className="nav-history">
          {/* Whole header row toggles collapse (CC) — not just the chevron. */}
          <button
            type="button"
            className="nav-history-head"
            onClick={toggleRecent}
            aria-expanded={!recentCollapsed}
            aria-label={recentCollapsed ? 'Expand history' : 'Collapse history'}
          >
            <span className="nav-history-cap">{t('xcreate.recent')}</span>
            <span className="nav-history-toggle" aria-hidden>{recentCollapsed ? '»' : '«'}</span>
          </button>
          {!recentCollapsed && recent.map(item => (
            <Link key={item.id} href={`/xcreate?id=${item.id}`} className="nav-history-item" title={item.prompt}>
              <HistoryModeIcon m={item.mode} />
              <span className="nav-history-text">{item.prompt ? historyTitle(item.prompt) : '(no prompt)'}</span>
            </Link>
          ))}
        </div>
      )}

      {/* Auth (profile + sign in/out) moved to the content-area TopBar on
          desktop. On mobile it lives in the hamburger overlay below. */}

      {/* Mobile hamburger — only shown under 760px viewport via CSS. */}
      <button
        type="button"
        className="nav-burger"
        aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen(v => !v)}
      >
        <span />
      </button>

      {/* Mobile overlay — slides down from below the nav bar when
          menuOpen is true. Closes on route change via the useEffect
          above. Includes all the nav links, plus the auth action. */}
      <div className={`nav-mobile-overlay ${menuOpen ? 'open' : ''}`}>
        {NAV_LINKS.map(({ href, i18n, protected: isProtected, icon }) => (
          <Link
            key={href}
            href={href}
            className={pathname === href ? 'active' : ''}
            onClick={(e) => handleProtectedClick(e, href, isProtected)}
          >
            <NavIcon name={icon} />{t(i18n)}
          </Link>
        ))}
        {authLoaded && (user ? (
          <>
            <Link href="/profile">{t('nav.profile')}</Link>
            <button type="button" onClick={handleLogout}>{t('auth.signout')}</button>
          </>
        ) : (
          <button type="button" onClick={() => { setMenuOpen(false); show() }}>{t('auth.signin')}</button>
        ))}
      </div>
    </nav>
  )
}
