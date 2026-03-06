'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import Nav from './components/Nav'

export default function Home() {
  const cursorRef = useRef<HTMLDivElement>(null)
  const ringRef = useRef<HTMLDivElement>(null)
  const [savings, setSavings] = useState(2_847_293)

  // Custom cursor
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

    const hoverEls = document.querySelectorAll('button, a, .feature, .mode-card, .flow-step')
    hoverEls.forEach(el => {
      el.addEventListener('mouseenter', () => {
        if (cursorRef.current) { cursorRef.current.style.width = '12px'; cursorRef.current.style.height = '12px' }
        if (ringRef.current)   { ringRef.current.style.width  = '48px'; ringRef.current.style.height  = '48px' }
      })
      el.addEventListener('mouseleave', () => {
        if (cursorRef.current) { cursorRef.current.style.width = '8px';  cursorRef.current.style.height = '8px'  }
        if (ringRef.current)   { ringRef.current.style.width  = '32px'; ringRef.current.style.height  = '32px' }
      })
    })

    return () => {
      document.removeEventListener('mousemove', onMove)
      cancelAnimationFrame(animId)
    }
  }, [])

  // Savings counter
  useEffect(() => {
    const rate = Math.floor(Math.random() * 40) + 15
    const tick = setInterval(() => setSavings(v => v + rate), 1000)
    const burst = setInterval(() => setSavings(v => v + Math.floor(Math.random() * 500) + 100), 7000)
    return () => { clearInterval(tick); clearInterval(burst) }
  }, [])

  // Scroll reveal
  useEffect(() => {
    const els = document.querySelectorAll('.reveal')
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible')
          observer.unobserve(entry.target)
        }
      })
    }, { threshold: 0.12 })
    els.forEach(el => observer.observe(el))
    return () => observer.disconnect()
  }, [])

  return (
    <>
      {/* Cursor */}
      <div className="cursor" ref={cursorRef} />
      <div className="cursor-ring" ref={ringRef} />

      {/* Nav */}
      <Nav />

      {/* Hero */}
      <section className="hero">
        <div className="hero-line" style={{ top: '20%' }} />
        <div className="hero-line" style={{ top: '80%' }} />
        <div className="hero-vline" style={{ left: '48px' }} />
        <div className="hero-vline" style={{ right: '48px' }} />
        <div className="corner corner-tl" />
        <div className="corner corner-tr" />
        <div className="corner corner-bl" />
        <div className="corner corner-br" />
        <div className="hero-inner">
          <div className="hero-eyebrow">AI Model Intelligence Platform · Est. 2026</div>
          <h1 className="hero-headline">
            <span className="line1">Overpaying AI?! <span className="xd" style={{ color: 'var(--red)' }}>XD</span></span>
            <span className="line3">XDuel to Find Your Best Models</span>
          </h1>
          <div className="hero-ctas">
            <Link href="/xduel" className="btn-primary">Start XDuel →</Link>
          </div>
        </div>
      </section>

      {/* Savings Strip */}
      <div className="savings-strip">
        <div className="savings-label">Community Savings</div>
        <div className="live-dot" />
        <div className="savings-number">${savings.toLocaleString()}</div>
        <div className="savings-unit">SAVED SO FAR</div>
      </div>

      {/* 4 Features */}
      <div className="features">
        <div className="feature reveal">
          <div className="feature-num">01 / XDUEL</div>
          <span className="feature-icon">⚔️</span>
          <div className="feature-title">Live<br />XDuel</div>
          <p className="feature-desc">Enter your prompt. Two anonymous models respond. <strong>You vote blind.</strong> Then prices are revealed. Did you pick the cheaper one? <strong>XD.</strong></p>
        </div>
        <div className="feature reveal">
          <div className="feature-num">02 / VOTE</div>
          <span className="feature-icon">🗳️</span>
          <div className="feature-title">Community<br />Voting</div>
          <p className="feature-desc">Browse archived battles. <strong>Vote on existing results.</strong> Every vote strengthens the leaderboard rankings.</p>
        </div>
        <div className="feature reveal">
          <div className="feature-num">03 / RANKINGS</div>
          <span className="feature-icon">🏆</span>
          <div className="feature-title">Leader<br />board</div>
          <p className="feature-desc">Quality vs cost scatter plot. Win rates, blind preference scores, <strong>Value Score rankings.</strong> Community-powered truth about every model.</p>
          <div className="feature-tag">Live Rankings</div>
        </div>
        <div className="feature reveal">
          <div className="feature-num">04 / CREATE</div>
          <span className="feature-icon">✨</span>
          <div className="feature-title">Create<br />Mode</div>
          <p className="feature-desc">Already know what you want? Run your prompt across <strong>multiple models simultaneously.</strong> Text, image, video — side by side.</p>
          <div className="feature-tag">Multi-Model</div>
        </div>
      </div>

      {/* XDuel Flow */}
      <section className="xduel-section reveal">
        <div className="section-label">XDuel Flow</div>
        <div className="section-title">How <span>XDuel</span> Works</div>
        <div className="flow-steps">
          {[
            { emoji: '⚔️', num: '01', title: 'Duel',           desc: 'Enter any prompt across text, image, or video' },
            { emoji: '🔒', num: '02', title: 'Vote Blind',      desc: 'Two anonymous responses. Pick the better one' },
            { emoji: '💰', num: '03', title: 'Reveal Price',    desc: 'Prices drop. Tension builds. Does it change things?' },
            { emoji: '🔄', num: '04', title: 'Vote Again',      desc: 'Vote again with full price visibility. Did you switch?' },
            { emoji: '💡', num: '05', title: 'Meet the Model',  desc: 'Identities unmasked. See your savings. Were you overpaying?' },
          ].map(step => (
            <div className="flow-step" key={step.num}>
              <div className="step-dot">{step.emoji}</div>
              <div className="step-num">{step.num}</div>
              <div className="step-title">{step.title}</div>
              <div className="step-desc">{step.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Savings Proof */}
      <section className="savings-section reveal">
        <div className="savings-left">
          <div className="section-label">Savings Calculator</div>
          <div className="savings-stat-big">
            <span className="amount">$8,400</span>
            <span className="label">per month</span>
          </div>
          <p className="savings-desc">
            At 10M tokens/month, switching from GPT-4o to Gemini Flash saves developers{' '}
            <strong style={{ color: 'var(--green)' }}>$8,400 every month</strong> — with no measurable quality difference on most tasks.
            ModelXD shows you the data so you can decide.
          </p>
        </div>
        <div className="savings-right">
          <div className="model-compare">
            <div className="model-card loser">
              <div className="model-badge openai">OpenAI</div>
              <div className="model-name">GPT-4o</div>
              <div className="model-icon">😬</div>
              <div className="model-price expensive">$10 / 1M tokens</div>
            </div>
            <div className="vs-divider">VS</div>
            <div className="model-card winner">
              <div className="model-badge google">Google</div>
              <div className="model-name">Gemini Flash</div>
              <div className="model-icon">✅</div>
              <div className="model-price cheap">$0.075 / 1M tokens</div>
            </div>
            <div className="savings-reveal-card">
              <div className="savings-reveal-emoji">🎉</div>
              <div>
                <div className="savings-reveal-title">You save $8,400/month</div>
                <div className="savings-reveal-sub">133× cheaper · Community preferred Gemini in blind tests · XD</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Modes */}
      <section className="modes-section reveal">
        <div className="section-label">Supported Modes</div>
        <div className="section-title">Text. Image. <span>Video.</span></div>
        <div className="modes-grid">
          {[
            { emoji: '✏️', title: 'Text',  desc: 'Prompts, code, reasoning, summarization. Battle the frontier language models.', models: ['GPT-4o', 'Claude 3.5', 'Gemini 1.5', 'Grok 3', 'Llama 3.1'] },
            { emoji: '🎨', title: 'Image', desc: 'Image generation quality vs cost. Does DALL-E 3 justify the premium over Imagen?', models: ['DALL-E 3', 'Imagen 3', 'Grok Imagine', 'Flux'] },
            { emoji: '🎬', title: 'Video', desc: "Video generation is the most expensive AI call. XDuel tells you if it's worth it.", models: ['Sora', 'Veo 2', 'Kling', 'Runway'] },
          ].map(mode => (
            <div className="mode-card" key={mode.title}>
              <span className="mode-emoji">{mode.emoji}</span>
              <div className="mode-title">{mode.title}</div>
              <div className="mode-desc">{mode.desc}</div>
              <div className="mode-models">
                {mode.models.map(m => <span className="mode-model-tag" key={m}>{m}</span>)}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Audience */}
      <div className="audience-section reveal">
        <div className="audience-card">
          <div className="audience-type">For Users</div>
          <div className="audience-title">Stop Paying For Hype</div>
          <div className="audience-saving">$12</div>
          <div className="audience-saving-label">avg. monthly savings · switch from ChatGPT Plus</div>
          <p className="audience-desc">You don&apos;t need GPT-4o for everything. XDuel shows you which free or cheaper models actually beat it on your tasks.</p>
        </div>
        <div className="audience-card dark">
          <div className="audience-type">For Developers</div>
          <div className="audience-title">Cut Your API Bill</div>
          <div className="audience-saving">$8,400</div>
          <div className="audience-saving-label">avg. monthly savings · at 10M tokens/mo</div>
          <p className="audience-desc">Token costs compound fast at scale. ModelXD gives you community-validated data on which models deliver value — not just benchmark scores.</p>
        </div>
      </div>

      {/* Footer */}
      <footer>
        <div className="footer-logo">
          <Image src="/logo.png" alt="ModelXD" width={32} height={32} style={{ objectFit: 'contain' }} />
        </div>
        <div className="footer-copy">STOP OVERPAYING FOR AI · XDUEL TO FIND THE BEST MODEL FOR YOUR MONEY</div>
        <div className="footer-copy">© 2026 MODELXD</div>
      </footer>
    </>
  )
}
