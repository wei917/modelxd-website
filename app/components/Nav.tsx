'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_LINKS = [
  { href: '/',             label: 'Home' },
  { href: '/xduel',       label: 'XDuel' },
  { href: '/vote',        label: 'Vote' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/create',      label: 'Create' },
]

export default function Nav() {
  const pathname = usePathname()

  return (
    <nav className="nav">
      <Link href="/" className="nav-logo-text">
        Model<em>XD</em>
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
        <button className="nav-login">Log In</button>
        <div className="nav-avatar">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="5.5" r="2.5" stroke="#6e7a8a" strokeWidth="1.2"/>
            <path d="M2.5 13.5c0-3.038 2.462-5.5 5.5-5.5s5.5 2.462 5.5 5.5" stroke="#6e7a8a" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
        </div>
      </div>
    </nav>
  )
}
