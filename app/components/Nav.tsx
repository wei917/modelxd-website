'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import type { User } from '@supabase/supabase-js'
import { useAuthModal } from '../../lib/AuthModalContext'

const NAV_LINKS = [
  { href: '/',             label: 'Home',       protected: false },
  { href: '/xduel',       label: 'XDuel',       protected: true  },
  { href: '/vote',        label: 'Vote',        protected: true  },
  { href: '/leaderboard', label: 'Leaderboard', protected: false },
  { href: '/xcreate',     label: 'XCreate',     protected: true  },
]

export default function Nav() {
  const pathname = usePathname()
  const { show } = useAuthModal()
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
        {'Model'}<span className="x">XD</span>
      </Link>
      <div className="nav-links">
        {NAV_LINKS.map(({ href, label, protected: isProtected }) => (
          <Link
            key={href}
            href={href}
            className={pathname === href ? 'active' : ''}
            onClick={(e) => handleProtectedClick(e, href, isProtected)}
            // Only dim protected links once we know the user is logged out.
            // Before authLoaded fires we can't know yet, so keep full opacity
            // to avoid a flash.
            style={authLoaded && isProtected && !user ? { opacity: 0.5 } : {}}
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
              <img
                src={user.user_metadata?.avatar_url}
                alt={user.user_metadata?.full_name}
                style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.15)', cursor: 'pointer' }}
              />
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
