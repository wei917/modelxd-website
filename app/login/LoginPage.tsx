'use client'

import { useEffect, useState } from 'react'
import { useT, useLang } from '../../lib/i18n'
import { LINE_CHANNELS, lineChannelHere, rememberLineChannel, markLineTry, type LineChannel } from '../../lib/line-login'
import { useRouter, useSearchParams } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import Image from 'next/image'
import { useSite } from '../../lib/useSite'
import { XCreateMark } from '../components/xcreate/XCreateNav'

export default function LoginPage() {
  const t = useT()
  // On xcreate.modelxd.com the card wears the XCreate mark and copy.
  const isXCreate = useSite() === 'xcreate'
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirect = searchParams.get('from') || '/'
  const [loading, setLoading] = useState<'google' | 'line' | false>(false)
  const { lang } = useLang()
  // LINE (Sep 29): where a channel serves the visitor (lib/line-login.ts).
  const [line, setLine] = useState<LineChannel | null>(null)
  useEffect(() => { setLine(lineChannelHere(lang)) }, [lang])

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  )

  const handleLogin = async (via: 'google' | 'line' = 'google') => {
    setLoading(via)
    document.cookie = `auth_redirect=${redirect}; path=/; max-age=600; SameSite=Lax`
    if (via === 'line' && line) rememberLineChannel(line)
    markLineTry(via === 'line' && line ? line : null)
    await supabase.auth.signInWithOAuth({
      provider: (via === 'line' && line ? LINE_CHANNELS[line].provider : 'google') as any,
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
  }

  return (
    <>
      <style>{`
        .auth-overlay {
          position: fixed; inset: 0; z-index: 1000;
          background: rgba(0,0,0,0.75);
          backdrop-filter: blur(12px);
          display: flex; align-items: center; justify-content: center;
          padding: 24px;
          animation: overlayIn 0.25s ease forwards;
        }
        @keyframes overlayIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        .auth-card {
          background: var(--surface);
          border: 1px solid var(--border2);
          border-radius: 8px;
          width: 100%; max-width: 420px;
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
        .auth-divider {
          width: 32px; height: 1px; background: var(--border2);
          margin: 0 auto 28px;
        }
        .auth-title {
          font-family: var(--font-display), sans-serif;
          font-size: 26px; font-weight: 900; text-transform: uppercase;
          letter-spacing: 0.02em; line-height: 1.1;
          margin-bottom: 10px; color: var(--white);
        }
        .auth-title .accent { color: var(--red); }
        .auth-sub {
          font-size: 13px; color: var(--muted2);
          line-height: 1.6; margin-bottom: 32px;
        }
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
        .auth-google-btn:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 8px 24px rgba(0,0,0,0.3);
        }
        .auth-google-btn:disabled { opacity: 0.5; }
        .auth-line-btn { width: 100%; display: flex; align-items: center; justify-content: center; gap: 10px; padding: 13px 24px; margin: -4px 0 16px; background: #06C755; border: none; border-radius: 4px; color: #fff; font-size: 14px; font-weight: 700; cursor: pointer; }
        .auth-line-btn:hover:not(:disabled) { background: #05b34c; }
        .auth-line-btn:disabled { opacity: 0.5; }
        .auth-google-btn svg { width: 18px; height: 18px; flex-shrink: 0; }
        .auth-note {
          font-family: var(--font-mono), monospace;
          font-size: 10px; color: var(--muted);
          letter-spacing: 0.1em; text-transform: uppercase;
          margin-bottom: 28px;
        }
        .auth-features {
          display: flex; flex-direction: column; gap: 10px;
          border-top: 1px solid var(--border);
          padding-top: 24px; text-align: left;
        }
        .auth-feature-row {
          display: flex; align-items: center; gap: 12px;
        }
        .auth-feature-icon {
          font-size: 16px; flex-shrink: 0; width: 28px; text-align: center;
        }
        .auth-feature-text {
          font-size: 12px; color: var(--muted2); line-height: 1.4;
        }
        .auth-feature-text strong { color: var(--white); font-weight: 500; }
      `}</style>

      <div className={isXCreate ? 'auth-overlay xcreate-auth' : 'auth-overlay'} onClick={(e) => { if (e.target === e.currentTarget) router.back() }}>
        <div className="auth-card">
          <button className="auth-close" onClick={() => router.back()}>✕</button>

          {/* Logo */}
          <div className="auth-logo">
            {isXCreate ? <XCreateMark /> : <>
            <Image src="/logo.png" alt="ModelXD" width={28} height={28} style={{ borderRadius: 6 }} />
            <span className="auth-logo-text">Model<span className="xd">XD</span></span>
            </>}
          </div>

          <div className="auth-divider" />

          <div className="auth-title">{isXCreate ? t('xcreate.site.authTitle') : <>{t('auth.titleprefix')} Model<span className="accent">XD</span></>}</div>
          <p className="auth-sub">{isXCreate ? t('xcreate.site.authCopy') : t('auth.free')}</p>

          {/* Google button */}
          <button className="auth-google-btn" onClick={() => void handleLogin('google')} disabled={!!loading}>
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            {loading === 'google' ? t('auth.signingin') : t('auth.google')}
          </button>
          {line && (
            <button className="auth-line-btn" onClick={() => void handleLogin('line')} disabled={!!loading}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="#fff" d="M12 3C6.48 3 2 6.63 2 11.1c0 4 3.55 7.36 8.35 8 .33.07.77.22.88.5.1.25.07.65.03.9l-.14.86c-.04.25-.2 1 .88.54 1.07-.45 5.78-3.4 7.89-5.83C21.33 14.46 22 12.87 22 11.1 22 6.63 17.52 3 12 3Z"/><path fill="#06C755" d="M8.3 13.3H6.4V9.4a.4.4 0 0 0-.8 0v4.3c0 .2.2.4.4.4h2.3a.4.4 0 0 0 0-.8Zm1.3-4.3a.4.4 0 0 0-.4.4v4.3a.4.4 0 0 0 .8 0V9.4a.4.4 0 0 0-.4-.4Zm5.1 0a.4.4 0 0 0-.4.4v2.6l-2.2-2.8a.4.4 0 0 0-.7.2v4.3a.4.4 0 0 0 .8 0V11l2.2 2.9a.4.4 0 0 0 .7-.2V9.4a.4.4 0 0 0-.4-.4Zm3.4 3.3a.4.4 0 0 0 0-.8h-1.9v-1h1.9a.4.4 0 0 0 0-.8h-2.3a.4.4 0 0 0-.4.4v4.3c0 .2.2.4.4.4h2.3a.4.4 0 0 0 0-.8h-1.9v-1h1.9Z"/></svg>
              {loading === 'line' ? t('auth.signingin') : t('auth.line')}
            </button>
          )}


          {/* Feature list */}
          <div className="auth-features">
            {isXCreate ? <p className="xcs-auth-credit">{t('xtell.site.authCredit')}</p> : [
              { icon: '⚔️', text: <><strong>XDuel</strong> · {t('auth.f.xduel')}</> },
              { icon: '🗳️', text: <><strong>XVote</strong> · {t('auth.f.xvote')}</> },
              { icon: '✨', text: <><strong>XCreate</strong> · {t('auth.f.xcreate')}</> },
            ].map((f, i) => (
              <div className="auth-feature-row" key={i}>
                <span className="auth-feature-icon">{f.icon}</span>
                <span className="auth-feature-text">{f.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
