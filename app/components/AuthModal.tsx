'use client'

import { useState } from 'react'
import Image from 'next/image'
import { createBrowserClient } from '@supabase/ssr'
import { useAuthModal } from '../../lib/AuthModalContext'
import { useT } from '../../lib/i18n'

// Same glyphs as Nav's NavIcon (app/components/Nav.tsx) — keep in sync.
function AuthFeatureIcon({ name }: { name: string }) {
  const p = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, style: { flexShrink: 0 } }
  switch (name) {
    case 'duel':   return (<svg {...p}><path d="M21 3v5l-11 9l-4 4l-3-3l4-4l9-11z"/><path d="M5 13l6 6"/><path d="M14.32 17.32l3.68 3.68l3-3l-3.68-3.68"/><path d="M10 5.5l-2-2.5h-5v5l3 2.5"/></svg>)
    case 'create': return (<svg {...p}><path d="M6 21l15-15l-3-3l-15 15l3 3z"/><path d="M15 6l3 3"/><path d="M9 3a2 2 0 0 0 2 2a2 2 0 0 0-2 2a2 2 0 0 0-2-2a2 2 0 0 0 2-2"/></svg>)
    case 'vote':   return (<svg {...p}><path d="M7 11v8a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3a4 4 0 0 0 4-4v-1a2 2 0 0 1 4 0v5h3a2 2 0 0 1 2 2l-1 5a2 3 0 0 1-2 2h-7a3 3 0 0 1-3-3"/></svg>)
    case 'board':  return (<svg {...p}><path d="M4 20h16"/><path d="M5 12h2v7H5z"/><path d="M10.5 8h2v11h-2z"/><path d="M16 4h2v15h-2z"/></svg>)
    default:       return null
  }
}

export default function AuthModal() {
  const { open, nextPath, hide } = useAuthModal()
  const t = useT()
  const [loading, setLoading] = useState(false)

  const handleLogin = async () => {
    setLoading(true)
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    if (!url || !key) {
      console.error('[AuthModal] Supabase env vars missing')
      setLoading(false)
      return
    }
    const supabase = createBrowserClient(url, key)
    const destination = nextPath ?? window.location.pathname
    document.cookie = `auth_redirect=${destination}; path=/; max-age=600; SameSite=Lax`
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
  }

  if (!open) return null

  return (
    <>
      <style>{`
        .auth-overlay {
          position: fixed; inset: 0; z-index: 1000;
          background: rgba(0,0,0,0.75);
          backdrop-filter: blur(12px);
          display: flex; align-items: center; justify-content: center;
          padding: 24px;
          animation: overlayIn 0.2s ease forwards;
        }
        @keyframes overlayIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        .auth-card {
          background: var(--surface);
          border: 1px solid var(--border2);
          border-radius: 8px;
          width: 100%; max-width: 400px;
          padding: 48px 40px 40px;
          text-align: center;
          position: relative;
          animation: cardIn 0.3s cubic-bezier(0.34,1.56,0.64,1) forwards;
        }
        @keyframes cardIn {
          from { opacity: 0; transform: scale(0.94) translateY(12px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        .auth-close {
          position: absolute; top: 16px; right: 16px;
          width: 28px; height: 28px;
          background: transparent; border: 1px solid var(--border2);
          border-radius: 4px; color: var(--muted2);
          font-size: 14px; cursor: none;
          display: flex; align-items: center; justify-content: center;
          transition: all 0.2s;
        }
        .auth-close:hover { border-color: var(--white); color: var(--white); }
        .auth-logo {
          display: flex; align-items: center; justify-content: center;
          gap: 8px; margin-bottom: 32px;
        }
        .auth-logo-text {
          font-family: var(--font-display), sans-serif;
          font-size: 22px; font-weight: 900; text-transform: uppercase;
          color: var(--white); letter-spacing: -0.01em;
        }
        .auth-logo-text .xd { color: var(--red); }
        .auth-divider { width: 32px; height: 1px; background: var(--border2); margin: 0 auto 28px; }
        .auth-title {
          font-family: var(--font-display), sans-serif;
          font-size: 26px; font-weight: 900; text-transform: uppercase;
          letter-spacing: 0.02em; line-height: 1.1;
          margin-bottom: 10px; color: var(--white);
        }
        .auth-title .accent { color: var(--red); }
        .auth-sub { font-size: 13px; color: var(--muted2); line-height: 1.6; margin-bottom: 32px; }
        .auth-google-btn {
          width: 100%;
          display: flex; align-items: center; justify-content: center; gap: 12px;
          padding: 14px 24px;
          background: var(--white); border: none; border-radius: 4px;
          color: var(--bg);
          font-family: var(--font-display), sans-serif;
          font-size: 14px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
          cursor: none; transition: all 0.2s; margin-bottom: 16px;
        }
        .auth-google-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 8px 24px rgba(0,0,0,0.3); }
        .auth-google-btn:disabled { opacity: 0.5; }
        .auth-note {
          font-family: var(--font-mono), monospace;
          font-size: 10px; color: var(--muted); letter-spacing: 0.1em;
          text-transform: uppercase; margin-bottom: 28px;
        }
        .auth-features {
          display: flex; flex-direction: column; gap: 10px;
          border-top: 1px solid var(--border); padding-top: 24px; text-align: left;
        }
        .auth-feature-row { display: flex; align-items: center; gap: 12px; }
        .auth-feature-icon { flex-shrink: 0; width: 28px; display: flex; align-items: center; justify-content: center; color: var(--muted2); }
        .auth-feature-text { font-size: 12px; color: var(--muted2); line-height: 1.4; }
        .auth-feature-text strong { color: var(--white); font-weight: 500; }
      `}</style>

      <div className="auth-overlay" onClick={(e) => { if (e.target === e.currentTarget) hide() }}>
        <div className="auth-card">
          <button className="auth-close" onClick={hide}>✕</button>

          <div className="auth-logo">
            <Image src="/logo.png" alt="ModelXD" width={28} height={28} style={{ borderRadius: 6 }} />
            <span className="auth-logo-text">Model<span className="xd">XD</span></span>
          </div>

          <div className="auth-divider" />

          <div className="auth-title">{t('auth.titleprefix')} Model<span className="accent">XD</span></div>

          <button className="auth-google-btn" onClick={handleLogin} disabled={loading}>
            <svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            {loading ? t('auth.signingin') : t('auth.google')}
          </button>


          <div className="auth-features">
            {[
              { icon: 'duel',   text: <><strong>XDuel</strong> — {t('auth.f.xduel')}</> },
              { icon: 'create', text: <><strong>XCreate</strong> — {t('auth.f.xcreate')}</> },
              { icon: 'vote',   text: <><strong>XVote</strong> — {t('auth.f.xvote')}</> },
              { icon: 'board',  text: <><strong>XBoard</strong> — {t('auth.f.xboard')}</> },
            ].map((f, i) => (
              <div className="auth-feature-row" key={i}>
                <span className="auth-feature-icon"><AuthFeatureIcon name={f.icon} /></span>
                <span className="auth-feature-text">{f.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
