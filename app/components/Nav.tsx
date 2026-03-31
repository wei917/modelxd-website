'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import type { User } from '@supabase/supabase-js'

const NAV_LINKS = [
  { href: '/',             label: 'Home',        authRequired: false },
  { href: '/xduel',       label: 'XDuel',       authRequired: true },
  { href: '/vote',        label: 'Vote',        authRequired: true },
  { href: '/leaderboard', label: 'Leaderboard', authRequired: false },
  { href: '/create',      label: 'Create',      authRequired: true },
]

export default function Nav() {
  const pathname = usePathname()
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)

  useEffect(() => {
    // Get current session
    supabase.auth.getUser().then(({ data }) => setUser(data.user))

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  const handleLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
  }

  const handleAuthNav = async (href: string) => {
    document.cookie = `auth_redirect=${href}; path=/; max-age=600; SameSite=Lax`
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.refresh()
  }

  return (
    <nav className="nav">
      <Link href="/" className="nav-logo-text" style={{display:'flex',alignItems:'center',gap:8}}>
        <img src="/logo.png" alt="ModelXD" style={{width:36,height:36,borderRadius:8}} />{"Model"}<span className="x">XD</span>
      </Link>
      <div className="nav-links">
        {NAV_LINKS.map(({ href, label, authRequired }) => (
          authRequired && !user ? (
            <a
              key={href}
              onClick={(e) => { e.preventDefault(); handleAuthNav(href) }}
              className={pathname === href ? 'active' : ''}
              style={{ cursor: 'pointer', opacity: 0.5 }}
            >
              {label}
            </a>
          ) : (
            <Link
              key={href}
              href={href}
              className={pathname === href ? 'active' : ''}
            >
              {label}
            </Link>
          )
        ))}
      </div>
      <div className="nav-auth">
        {user ? (
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <Link href="/profile">
              <img
                src={user.user_metadata?.avatar_url}
                alt={user.user_metadata?.full_name}
                style={{width:28,height:28,borderRadius:'50%',border:'1px solid rgba(255,255,255,0.15)',cursor:'pointer'}}
              />
            </Link>
            <button className="nav-login" onClick={handleLogout}>Log Out</button>
          </div>
        ) : (
          <button className="nav-login" onClick={handleLogin}>Log In</button>
        )}
      </div>
    </nav>
  )
}
