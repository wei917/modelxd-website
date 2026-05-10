'use client'

import { useEffect, useRef } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { useAuthModal } from '../lib/AuthModalContext'

const FEATURES = [
  { key: 'xduel',  num: '01', label: 'XDUEL',    title: 'Blind Duel',   desc: 'Two anonymous models respond to your prompt. You vote blind. Then prices drop. Were you overpaying?' },
  { key: 'vote',   num: '02', label: 'VOTE',      title: 'Community',    desc: 'Vote on archived duels. Every vote strengthens the leaderboard. Community-powered truth about every model.' },
  { key: 'rating', num: '03', label: 'XDRATING',  title: 'Rankings',     desc: 'Quality, Value, and Stickiness — three scores per model. No benchmarks. Just real user preferences.' },
  { key: 'create', num: '04', label: 'XCREATE',   title: 'Studio',       desc: 'One prompt. Up to 4 models. Side by side. Pick the winner and keep chatting. Stop reading reviews — see for yourself.' },
]

const STEPS = [
  { num: '01', title: 'Duel',          desc: 'Enter any prompt — text, image, or video' },
  { num: '02', title: 'Vote Blind',    desc: 'Pick the better response. No names, no bias' },
  { num: '03', title: 'Reveal Price',  desc: 'See what each model costs. Does it change things?' },
  { num: '04', title: 'Vote Again',    desc: 'Vote again with full price visibility' },
  { num: '05', title: 'Unmask',        desc: 'Models revealed. See your savings' },
]

const MODES = [
  { title: 'Text',  desc: 'Prompts, code, reasoning, summarization', models: ['GPT-5.4', 'Gemini 3.1', 'Claude 4', 'Llama 4'] },
  { title: 'Image', desc: 'Generation quality vs cost, side by side', models: ['GPT Image', 'Imagen 4', 'FLUX'] },
  { title: 'Video', desc: 'The most expensive AI call — is it worth it?', models: ['Sora 2', 'Veo 3.1'] },
]

export default function Home() {
  const cursorRef = useRef<HTMLDivElement>(null)
  const ringRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const { show } = useAuthModal()

  const handleNav = async (path: string) => {
    const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)
    const { data } = await supabase.auth.getUser()
    if (data.user) router.push(path)
    else show(path)
  }

  useEffect(() => {
    let mx = 0, my = 0, rx = 0, ry = 0
    let animId: number
    const onMove = (e: MouseEvent) => {
      mx = e.clientX; my = e.clientY
      if (cursorRef.current) { cursorRef.current.style.left = mx + 'px'; cursorRef.current.style.top = my + 'px' }
    }
    const animRing = () => {
      rx += (mx - rx) * 0.12; ry += (my - ry) * 0.12
      if (ringRef.current) { ringRef.current.style.left = rx + 'px'; ringRef.current.style.top = ry + 'px' }
      animId = requestAnimationFrame(animRing)
    }
    document.addEventListener('mousemove', onMove)
    animId = requestAnimationFrame(animRing)
    return () => { document.removeEventListener('mousemove', onMove); cancelAnimationFrame(animId) }
  }, [])

  useEffect(() => {
    const els = document.querySelectorAll('.reveal')
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target) } })
    }, { threshold: 0.1 })
    els.forEach(el => obs.observe(el))
    return () => obs.disconnect()
  }, [])

  return (
    <>
      <div className="cursor" ref={cursorRef} />
      <div className="cursor-ring" ref={ringRef} />

      {/* ── Hero ── */}
      <div className="xduel-page" style={{ minHeight: 'auto' }}>
        <div className="arena" style={{ paddingBottom: 0 }}>
          <div className="prompt-header">
            <div className="prompt-label">Model<span style={{ color: 'var(--red)' }}>XD</span></div>
            <h1 className="prompt-title">
              Overpaying for <span>AI?!</span>
            </h1>
            <div className="prompt-sub" style={{ maxWidth: 640, marginTop: 16 }}>
              Blind-test AI models with XDuel. Compare 4 outputs side by side with XCreate. Find the best model for you.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 40, marginBottom: 60, flexWrap: 'wrap' }}>
            <button onClick={() => handleNav('/xduel')} className="btn-primary">Start XDuel →</button>
            <button onClick={() => handleNav('/xcreate')} className="btn-outline">Try XCreate →</button>
          </div>
        </div>
      </div>

      {/* ── Features ── */}
      <div className="home-section">
        <div className="home-inner">
          <div className="prompt-header">
            <div className="prompt-label">What You Can Do</div>
            <h1 className="prompt-title">Four <span>Tools</span></h1>
          </div>
          <div className="home-features-grid">
            {FEATURES.map(f => (
              <div className="home-feature" key={f.key}>
                <div className="home-feature-num">
                  <span style={{ color: 'var(--red)' }}>{f.num}</span>
                  <span style={{ opacity: 0.4 }}>/</span>
                  <span>{f.label}</span>
                </div>
                <div className="home-feature-title">{f.title}</div>
                <div className="home-feature-desc">{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── How XDuel Works ── */}
      <div className="home-section surface reveal">
        <div className="home-inner">
          <div className="prompt-header">
            <div className="prompt-label">XDuel Flow</div>
            <h1 className="prompt-title">How It <span>Works</span></h1>
          </div>
          <div className="home-steps">
            {STEPS.map((s, i) => (
              <div className="home-step" key={s.num}>
                <div className="home-step-row">
                  <div className="home-step-num">{s.num}</div>
                  <div style={{ flex: 1 }}>
                    <div className="home-step-title">{s.title}</div>
                    <div className="home-step-desc">{s.desc}</div>
                  </div>
                </div>
                {i < STEPS.length - 1 && <div className="home-step-line" />}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Savings ── */}
      <div className="home-section reveal">
        <div className="home-inner">
          <div className="prompt-header">
            <div className="prompt-label">Savings</div>
            <h1 className="prompt-title">Stop <span>Overpaying</span></h1>
          </div>
          <div className="home-savings">
            <div className="home-savings-left">
              <div className="home-savings-amount">Up to 133×</div>
              <div className="home-savings-period">cheaper per million tokens</div>
              <div className="home-savings-detail">
                Most users pick the expensive model out of habit. XDuel reveals when a <strong style={{ color: 'var(--green)' }}>cheaper model wins blind</strong> — so you only pay more when it actually matters.
              </div>
            </div>
            <div className="home-savings-right">
              <div className="home-compare-row loser">
                <span className="home-compare-badge">POPULAR</span>
                <span className="home-compare-name">Premium Model</span>
                <span className="home-compare-price" style={{ color: 'var(--red)' }}>$$$</span>
              </div>
              <div className="home-compare-vs">VS</div>
              <div className="home-compare-row winner">
                <span className="home-compare-badge">UNDERDOG</span>
                <span className="home-compare-name">You&apos;d Be Surprised</span>
                <span className="home-compare-price" style={{ color: 'var(--green)' }}>$</span>
              </div>
              <div className="home-compare-result">
                <span style={{ color: 'var(--green)', fontWeight: 700 }}>Blind-tested by the community</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Modes ── */}
      <div className="home-section surface reveal">
        <div className="home-inner">
          <div className="prompt-header">
            <div className="prompt-label">Supported Modes</div>
            <h1 className="prompt-title">Text. Image. <span>Video.</span></h1>
          </div>
          <div className="home-modes">
            {MODES.map(m => (
              <div className="home-mode" key={m.title}>
                <div className="home-mode-title">{m.title}</div>
                <div className="home-mode-desc">{m.desc}</div>
                <div className="home-mode-models">
                  {m.models.map(name => <span key={name} className="home-mode-tag">{name}</span>)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Audience ── */}
      <div className="home-section reveal">
        <div className="home-inner">
          <div className="prompt-header">
            <div className="prompt-label">Who Is This For</div>
            <h1 className="prompt-title">Users & <span>Developers</span></h1>
          </div>
          <div className="home-audience">
            <div className="home-audience-card">
              <div className="home-audience-label">FOR USERS</div>
              <div className="home-audience-stat" style={{ color: 'var(--green)' }}>$12</div>
              <div className="home-audience-period">avg. monthly savings</div>
              <div className="home-audience-desc">You don&apos;t need GPT-4o for everything. XDuel shows you which cheaper models beat it on your tasks.</div>
            </div>
            <div className="home-audience-card">
              <div className="home-audience-label">FOR DEVELOPERS</div>
              <div className="home-audience-stat" style={{ color: 'var(--green)' }}>$8,400</div>
              <div className="home-audience-period">avg. monthly savings at 10M tokens</div>
              <div className="home-audience-desc">Token costs compound fast. ModelXD gives you community-validated data on which models deliver value.</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Footer ── */}
      <footer className="home-footer">
        <div className="home-inner" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="footer-copy">© 2026 MODELXD</div>
        </div>
      </footer>
    </>
  )
}
