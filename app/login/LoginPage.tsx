'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Nav from '../components/Nav'
import { createBrowserClient } from '@supabase/ssr'

const FEATURES = [
  {
    num: '01',
    emoji: '⚔️',
    label: 'XDUEL',
    title: 'Run Live XDuels',
    desc: 'Submit prompts and vote blind across competing models. Your vote contributes to community rankings.',
  },
  {
    num: '02',
    emoji: '🗳️',
    label: 'VOTE',
    title: 'Vote on Battles',
    desc: 'Browse archived duels and cast your vote. Every vote strengthens the leaderboard data.',
  },
  {
    num: '03',
    emoji: '✨',
    label: 'CREATE',
    title: 'Multi-Model Create',
    desc: 'Run your prompt across multiple models simultaneously — text, image, video — side by side.',
  },
]

const WHY = [
  { icon: '📊', title: 'Track Your Votes', desc: 'See your full voting history and how your picks compare to the community.' },
  { icon: '💰', title: 'Calculate Your Savings', desc: 'We show your personal savings based on the models you preferred vs what you were using.' },
  { icon: '🏆', title: 'Build Your Profile', desc: 'Your XDuel record, accuracy score, and contribution to community rankings.' },
  { icon: '🔒', title: 'Prevent Ballot Stuffing', desc: 'One vote per person keeps the leaderboard honest and the data trustworthy.' },
]

export default function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirect = searchParams.get('from') || '/'
  const cursorRef = useRef<HTMLDivElement>(null)
  const ringRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(false)

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  )

  useEffect(() => {
    let mx = 0, my = 0, rx = 0, ry = 0
    let animId: number
    const onMove = (e: MouseEvent) => {
      mx = e.clientX; my = e.clientY
      if (cursorRef.current) {
        cursorRef.current.style.left = mx + 'px'
        cursorRef.current.style.top  = my + 'px'
      }
    }
    const animRing = () => {
      rx += (mx - rx) * 0.12
      ry += (my - ry) * 0.12
      if (ringRef.current) {
        ringRef.current.style.left = rx + 'px'
        ringRef.current.style.top  = ry + 'px'
      }
      animId = requestAnimationFrame(animRing)
    }
    document.addEventListener('mousemove', onMove)
    animId = requestAnimationFrame(animRing)
    return () => { document.removeEventListener('mousemove', onMove); cancelAnimationFrame(animId) }
  }, [])

  useEffect(() => {
    const els = document.querySelectorAll('.reveal')
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) { entry.target.classList.add('visible'); observer.unobserve(entry.target) }
      })
    }, { threshold: 0.12 })
    els.forEach(el => observer.observe(el))
    return () => observer.disconnect()
  }, [])

  const handleLogin = async () => {
    setLoading(true)
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${redirect}` },
    })
  }

  const GoogleIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: 20, height: 20 }}>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#fff" fillOpacity="0.9"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#fff" fillOpacity="0.9"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#fff" fillOpacity="0.9"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#fff" fillOpacity="0.9"/>
    </svg>
  )

  return (
    <>
      <div className="cursor" ref={cursorRef} />
      <div className="cursor-ring" ref={ringRef} />
      <Nav />

      <style>{`
        .login-hero {
          min-height: calc(100vh - 60px);
          display: flex; flex-direction: column;
          justify-content: center; align-items: center;
          padding: 100px 48px 60px;
          position: relative; overflow: hidden; text-align: center;
        }
        .login-hero::before {
          content: '';
          position: absolute; inset: 0;
          background: radial-gradient(ellipse 80% 60% at 50% 40%, rgba(232,69,60,0.07) 0%, transparent 70%);
          pointer-events: none;
        }
        .login-grid-line { position: absolute; background: var(--border); }
        .login-eyebrow {
          font-family: var(--font-mono), monospace;
          font-size: 11px; color: var(--muted2);
          letter-spacing: 0.2em; text-transform: uppercase;
          display: flex; align-items: center; gap: 12px;
          margin-bottom: 32px;
          opacity: 0; animation: fadeUp 0.8s 0.1s forwards;
        }
        .login-eyebrow::before, .login-eyebrow::after {
          content: ''; flex: 1; max-width: 40px; height: 1px; background: var(--red);
        }
        .login-headline {
          font-family: var(--font-display), sans-serif;
          font-weight: 900;
          font-size: clamp(42px, 6vw, 80px);
          line-height: 0.92; letter-spacing: -0.01em; text-transform: uppercase;
          opacity: 0; animation: fadeUp 0.8s 0.25s forwards;
          margin-bottom: 24px;
        }
        .login-headline .accent { color: var(--red); }
        .login-sub {
          font-size: clamp(15px, 1.5vw, 18px);
          color: var(--muted2); line-height: 1.6; max-width: 520px;
          opacity: 0; animation: fadeUp 0.8s 0.4s forwards;
          margin-bottom: 48px;
        }
        .login-btn {
          display: inline-flex; align-items: center; gap: 12px;
          padding: 16px 40px;
          background: var(--red); border: none; border-radius: 4px; color: #fff;
          font-family: var(--font-display), sans-serif;
          font-size: 15px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase;
          cursor: none; transition: all 0.2s;
          opacity: 0; animation: fadeUp 0.8s 0.55s forwards;
        }
        .login-btn:hover:not(:disabled) {
          background: #ff5249;
          box-shadow: 0 0 48px var(--red-glow);
          transform: translateY(-2px);
        }
        .login-btn:disabled { opacity: 0.6; }
        .login-note {
          margin-top: 20px;
          font-family: var(--font-mono), monospace;
          font-size: 11px; color: var(--muted); letter-spacing: 0.1em;
          opacity: 0; animation: fadeUp 0.8s 0.65s forwards;
        }
        .login-section-label {
          font-family: var(--font-mono), monospace;
          font-size: 11px; color: var(--red);
          letter-spacing: 0.2em; text-transform: uppercase; margin-bottom: 16px;
        }
        .login-section-title {
          font-family: var(--font-display), sans-serif;
          font-size: clamp(28px, 3vw, 42px);
          font-weight: 900; text-transform: uppercase;
          margin-bottom: 48px; line-height: 1;
        }
        .login-section-title span { color: var(--red); }
        .login-feature-grid {
          display: grid; grid-template-columns: repeat(3, 1fr);
          gap: 1px; background: var(--border); border: 1px solid var(--border);
        }
        .login-feature-card {
          background: var(--surface); padding: 40px 32px;
          position: relative; transition: background 0.2s;
        }
        .login-feature-card:hover { background: var(--surface2); }
        .login-feature-num {
          font-family: var(--font-mono), monospace;
          font-size: 10px; color: var(--muted);
          letter-spacing: 0.2em; text-transform: uppercase; margin-bottom: 20px;
        }
        .login-feature-emoji { font-size: 32px; display: block; margin-bottom: 16px; }
        .login-feature-badge {
          display: inline-block;
          font-family: var(--font-mono), monospace;
          font-size: 9px; letter-spacing: 0.2em;
          padding: 4px 10px; border: 1px solid var(--red);
          color: var(--red); border-radius: 2px; margin-bottom: 16px;
        }
        .login-feature-title {
          font-family: var(--font-display), sans-serif;
          font-size: 22px; font-weight: 900; text-transform: uppercase;
          margin-bottom: 12px; line-height: 1.1;
        }
        .login-feature-desc { font-size: 14px; color: var(--muted2); line-height: 1.6; }

        .login-why-grid {
          display: grid; grid-template-columns: repeat(4, 1fr); gap: 32px;
        }
        .login-why-card { padding: 28px 0; border-top: 1px solid var(--border2); }
        .login-why-icon { font-size: 24px; margin-bottom: 16px; display: block; }
        .login-why-title {
          font-family: var(--font-display), sans-serif;
          font-size: 15px; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.05em; margin-bottom: 10px;
        }
        .login-why-desc { font-size: 13px; color: var(--muted2); line-height: 1.6; }
        .login-cta-tag {
          font-family: var(--font-mono), monospace;
          font-size: 10px; letter-spacing: 0.2em; color: var(--muted);
          text-transform: uppercase; margin-bottom: 24px;
        }
        .login-cta-title {
          font-family: var(--font-display), sans-serif;
          font-size: clamp(32px, 4vw, 56px);
          font-weight: 900; text-transform: uppercase;
          line-height: 0.95; margin-bottom: 40px;
        }
        .login-cta-title span { color: var(--red); }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .reveal { opacity: 0; transform: translateY(24px); transition: opacity 0.7s, transform 0.7s; }
        .reveal.visible { opacity: 1; transform: none; }
        @media (max-width: 900px) {
          .login-feature-grid { grid-template-columns: 1fr; }
          .login-why-grid { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 600px) {
          .login-why-grid { grid-template-columns: 1fr; }
          .login-hero { padding-left: 24px; padding-right: 24px; }
        }
      `}</style>

      {/* Hero */}
      <section className="login-hero">
        <div className="login-grid-line" style={{ top: 0, left: 0, right: 0, height: 1 }} />
        <div className="login-grid-line" style={{ bottom: 0, left: 0, right: 0, height: 1 }} />
        <div className="login-grid-line" style={{ top: 0, bottom: 0, left: 48, width: 1 }} />
        <div className="login-grid-line" style={{ top: 0, bottom: 0, right: 48, width: 1 }} />
        <div className="login-eyebrow">Sign In Required</div>
        <h1 className="login-headline">
          Join the <span className="accent">XD</span>uel<br />
          <span style={{ color: 'rgba(240,242,245,0.45)', fontWeight: 300, fontSize: '0.55em', letterSpacing: '0.04em', textTransform: 'none' }}>
            One login. Every model comparison.
          </span>
        </h1>
        <p className="login-sub">
          XDuel, Vote, and Create require a free account. Your identity keeps the
          leaderboard honest and unlocks your personal savings dashboard.
        </p>
        <button className="login-btn" onClick={handleLogin} disabled={loading}>
          <GoogleIcon />
          {loading ? 'Signing in...' : 'Continue with Google'}
        </button>
        <p className="login-note">Free · No credit card · Takes 10 seconds</p>
      </section>

      {/* What you unlock */}
      <div style={{ borderTop: '1px solid var(--border)', padding: '80px 48px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div className="login-section-label reveal">What you unlock</div>
          <div className="login-section-title reveal">Three Powerful <span>Features</span></div>
          <div className="login-feature-grid">
            {FEATURES.map((f, i) => (
              <div className="login-feature-card reveal" key={f.num} style={{ transitionDelay: `${i * 0.1}s` }}>

                <div className="login-feature-num">{f.num} / {f.label}</div>
                <span className="login-feature-emoji">{f.emoji}</span>
                <div className="login-feature-badge">{f.label}</div>
                <div className="login-feature-title">{f.title}</div>
                <p className="login-feature-desc">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Why sign in */}
      <div style={{ borderTop: '1px solid var(--border)', padding: '80px 48px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div className="login-section-label reveal">Why sign in?</div>
          <div className="login-section-title reveal">Your Account <span>Matters</span></div>
          <div className="login-why-grid">
            {WHY.map((w, i) => (
              <div className="login-why-card reveal" key={w.title} style={{ transitionDelay: `${i * 0.1}s` }}>
                <span className="login-why-icon">{w.icon}</span>
                <div className="login-why-title">{w.title}</div>
                <p className="login-why-desc">{w.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom CTA */}
      <div style={{ borderTop: '1px solid var(--border)', padding: '80px 48px', textAlign: 'center' }}>
        <div className="login-cta-tag reveal">Ready?</div>
        <div className="login-cta-title reveal">
          Stop Guessing.<br />
          Start <span>XDueling.</span>
        </div>
        <button className="login-btn reveal" onClick={handleLogin} disabled={loading} style={{ opacity: 1, animation: 'none' }}>
          <GoogleIcon />
          {loading ? 'Signing in...' : "Continue with Google — It's Free"}
        </button>
        <p className="login-note" style={{ marginTop: 16, opacity: 1, animation: 'none' }}>
          Leaderboard and Feed are always public · No login required
        </p>
      </div>

      {/* Footer */}
      <footer style={{ borderTop: '1px solid var(--border)', padding: '32px 48px', textAlign: 'center' }}>
        <div style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 11, color: 'var(--muted)', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
          © 2026 MODELXD · STOP OVERPAYING FOR AI
        </div>
      </footer>
    </>
  )
}
