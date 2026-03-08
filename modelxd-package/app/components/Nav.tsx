'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createSupabaseBrowser } from '../../lib/supabase-client'
import type { User } from '@supabase/supabase-js'

const NAV_LINKS = [
  { href: '/',             label: 'Home' },
  { href: '/xduel',       label: 'XDuel' },
  { href: '/vote',        label: 'Vote' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/create',      label: 'Create' },
]

export default function Nav() {
  const pathname = usePathname()
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const supabase = createSupabaseBrowser()

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

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.refresh()
  }

  return (
    <nav className="nav">
      <Link href="/" className="nav-logo-text">
        Model<span className="x">X</span><span className="d">D</span>
      </Link>
      <div className="nav-links">
        {NAV_LINKS.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className={pathname === href ? 'active' : ''}
          >
            {label}
          </Link>
        ))}
      </div>
      <div className="nav-auth">
        {user ? (
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <img
              src={user.user_metadata?.avatar_url}
              alt={user.user_metadata?.full_name}
              style={{width:28,height:28,borderRadius:'50%',border:'1px solid rgba(255,255,255,0.15)'}}
            />
            <button className="nav-login" onClick={handleLogout}>Log Out</button>
          </div>
        ) : (
          <button className="nav-login" onClick={handleLogin}>Log In</button>
        )}
      </div>
    </nav>
  )
}
