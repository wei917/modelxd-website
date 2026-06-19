'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import type { User } from '@supabase/supabase-js'
import { useAuthModal } from '../../lib/AuthModalContext'

// The logo doubles as the home link, so the explicit "Home" item is gone.
const NAV_LINKS = [
  { href: '/xduel',       label: 'XDuel',        protected: true  },
  { href: '/xcreate',     label: 'XCreate',      protected: true  },
  { href: '/xvote',       label: 'XVote',        protected: true  },
  { href: '/leaderboard', label: 'Leaderboard',  protected: false },
]

export default function Nav() {
  const pathname = usePathname()
  const { show } = useAuthModal()

  // Hide the Nav on the password gate. The links would just redirect
  // back to /coming-soon (no cookie yet) and the "Log in" button would
  // try to start an OAuth flow that lands in the same loop.
  if (pathname === '/coming-soon') return null
  const [user, setUser] = useState<User | null>(null)
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
        <span>Model<span className="x">XD</span></span>
      </Link>
      <div className="nav-links">
        {NAV_LINKS.map(({ href, label, protected: isProtected }) => (
          <Link
            key={href}
            href={href}
            className={pathname === href ? 'active' : ''}
            onClick={(e) => handleProtectedClick(e, href, isProtected)}
          >
            {label}
          </Link>
        ))}
      </div>
      {/*
        Auth slot has a reserved min-width via CSS so the logged-in
        (avatar + Log Out) and logged-out (Log In) variants don't push the
        center nav links around. Until auth resolves we render an invisible
        placeholder of the same shape to reserve space.
      */}
      <div className="nav-auth">
        {!authLoaded ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, visibility: 'hidden' }} aria-hidden>
            <div style={{ width: 28, height: 28, borderRadius: '50%' }} />
            <button className="nav-login" tabIndex={-1}>Log Out</button>
          </div>
        ) : user ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Link href="/profile">
              {user.user_metadata?.avatar_url ? (
                <img
                  src={user.user_metadata.avatar_url}
                  alt={user.user_metadata?.full_name}
                  style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid var(--border)', cursor: 'pointer' }}
                />
              ) : (
                <div style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: 'var(--red)', color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  border: '1px solid var(--border)',
                }}>
                  {(user.user_metadata?.full_name || user.email || '?')
                    .split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)}
                </div>
              )}
            </Link>
            <button className="nav-login" onClick={handleLogout}>Log Out</button>
          </div>
        ) : (
          <button className="nav-login" onClick={() => show()}>Log In</button>
        )}
      </div>
    </nav>
  )
}
