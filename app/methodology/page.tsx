'use client'
// app/methodology/page.tsx
// XDRating methodology — high-level only, deliberately vague on math.

import { useEffect, useRef } from 'react'
import Link from 'next/link'

const RATINGS = [
  {
    code: 'XD',
    name: 'Overall Score',
    color: 'var(--red)',
    icon: '🏆',
    source: 'Composite of Q + V + S',
    desc: 'The XD score is the single number that answers "how good is this model, all things considered?" It blends quality, value, and stickiness into one ranking.',
    detail: 'XD combines all three signals with weighted importance — quality and value contribute equally as the primary factors, with stickiness as a secondary signal. This means a model needs to be both good AND reasonably priced to rank high overall.',
  },
  {
    code: 'XDR-Q',
    name: 'Quality',
    color: 'var(--red)',
    icon: '⚔️',
    source: 'Blind vote (vote 1)',
    desc: 'Pure quality signal. Before any price information is shown, users vote on which model produced the better output. This captures raw preference uncontaminated by cost anchoring.',
    detail: 'Every XDuel blind vote and XCreate selection contributes to XDR-Q. Models are compared pairwise — each matchup produces a winner, loser, or tie. The rating reflects how often a model wins head-to-head matchups across the community.',
  },
  {
    code: 'XDR-V',
    name: 'Value',
    color: 'var(--green)',
    icon: '💰',
    source: 'Informed vote (vote 2)',
    desc: 'Quality adjusted for price. After prices are revealed, users vote again. This second vote captures the real decision people face: is the better model worth the price difference?',
    detail: 'XDR-V is derived from post-reveal votes where users can see both model quality and cost. A model that wins informed votes despite being expensive has strong Value. A cheap model that gains votes after price reveal has even stronger Value.',
  },
  {
    code: 'XDR-S',
    name: 'Stickiness',
    color: '#6366f1',
    icon: '🧲',
    source: 'Vote retention',
    desc: 'How often a model keeps its vote after the price reveal. If you picked Model A blind and still picked it knowing prices — that model is sticky.',
    detail: 'Stickiness measures the gap between perceived quality and price sensitivity. A model with high Stickiness is genuinely valued by users regardless of cost. Low Stickiness means the model\'s appeal drops once people see the bill.',
  },
]

const FLOW_STEPS = [
  { num: '01', title: 'Prompt',        desc: 'User enters a prompt. Two random models are selected.' },
  { num: '02', title: 'Blind Vote',    desc: 'Both models respond anonymously. User picks the better output.', signal: 'XDR-Q' },
  { num: '03', title: 'Price Reveal',  desc: 'Per-token and per-image costs are shown on each card.' },
  { num: '04', title: 'Informed Vote', desc: 'User votes again with full price context. Did knowing the cost change anything?', signal: 'XDR-V + XDR-S' },
  { num: '05', title: 'Reveal',        desc: 'Model identities unmasked. Savings calculated. Data logged.' },
]

export default function MethodologyPage() {
  const cursorRef = useRef<HTMLDivElement>(null)
  const ringRef   = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (cursorRef.current) { cursorRef.current.style.left = e.clientX+'px'; cursorRef.current.style.top = e.clientY+'px' }
      if (ringRef.current)   { ringRef.current.style.left   = e.clientX+'px'; ringRef.current.style.top   = e.clientY+'px' }
    }
    window.addEventListener('mousemove', move)
    return () => window.removeEventListener('mousemove', move)
  }, [])

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
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--white)' }}>
      <div className="cursor" ref={cursorRef} />
      <div className="cursor-ring" ref={ringRef} />

      <div style={{ maxWidth: 800, margin: '0 auto', padding: '100px 24px 80px' }}>
        {/* Header */}
        <div className="reveal" style={{ marginBottom: 56 }}>
          <div style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--red)' }}>//</span> METHODOLOGY
          </div>
          <h1 style={{ fontFamily: 'var(--font-display), sans-serif', fontSize: 'clamp(36px, 5vw, 52px)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '-0.01em', lineHeight: 1, margin: '0 0 16px' }}>
            How <span style={{ color: 'var(--red)' }}>XDRating</span> Works
          </h1>
          <p style={{ fontSize: 16, color: 'var(--muted2)', lineHeight: 1.7, fontWeight: 300, maxWidth: 600 }}>
            XDRating is a community-powered ranking system built on blind comparisons.
            Every vote feeds three independent scores that capture different dimensions
            of model performance.
          </p>
        </div>

        {/* The three ratings */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 64 }}>
          {RATINGS.map((r, i) => (
            <div
              key={r.code}
              className="reveal"
              style={{
                padding: '32px 28px',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: i === 0 ? '10px 10px 0 0' : i === RATINGS.length - 1 ? '0 0 10px 10px' : 0,
                borderTop: i > 0 ? 'none' : undefined,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <span style={{ fontSize: 24 }}>{r.icon}</span>
                <div>
                  <div style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 10, color: r.color, letterSpacing: '0.15em', fontWeight: 700 }}>
                    {r.code}
                  </div>
                  <div style={{ fontFamily: 'var(--font-display), sans-serif', fontSize: 22, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.02em' }}>
                    {r.name}
                  </div>
                </div>
              </div>
              <div style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.1em', marginBottom: 12, textTransform: 'uppercase' }}>
                Source: {r.source}
              </div>
              <p style={{ fontSize: 15, color: 'var(--white)', lineHeight: 1.7, fontWeight: 400, marginBottom: 12 }}>
                {r.desc}
              </p>
              <p style={{ fontSize: 13, color: 'var(--muted2)', lineHeight: 1.65, fontWeight: 300 }}>
                {r.detail}
              </p>
            </div>
          ))}
        </div>

        {/* Data collection flow */}
        <div className="reveal" style={{ marginBottom: 64 }}>
          <h2 style={{ fontFamily: 'var(--font-display), sans-serif', fontSize: 28, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.02em', marginBottom: 8 }}>
            Data Collection
          </h2>
          <p style={{ fontSize: 14, color: 'var(--muted2)', lineHeight: 1.7, fontWeight: 300, marginBottom: 32 }}>
            Every XDuel generates two votes from the same user on the same matchup.
            The difference between those votes is the signal.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {FLOW_STEPS.map((step, i) => (
              <div
                key={step.num}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '48px 1fr auto',
                  gap: 16,
                  padding: '20px 0',
                  borderBottom: i < FLOW_STEPS.length - 1 ? '1px solid var(--border)' : 'none',
                  alignItems: 'center',
                }}
              >
                <div style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 11, color: 'var(--red)', fontWeight: 700 }}>
                  {step.num}
                </div>
                <div>
                  <div style={{ fontFamily: 'var(--font-display), sans-serif', fontSize: 15, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>
                    {step.title}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--muted2)', fontWeight: 300 }}>
                    {step.desc}
                  </div>
                </div>
                {step.signal && (
                  <div style={{
                    fontFamily: 'var(--font-mono), monospace', fontSize: 10,
                    color: 'var(--red)', letterSpacing: '0.1em', fontWeight: 600,
                    padding: '4px 10px', border: '1px solid var(--red-dim)',
                    borderRadius: 3, background: 'var(--red-dim)', whiteSpace: 'nowrap',
                  }}>
                    → {step.signal}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Philosophy */}
        <div className="reveal" style={{ marginBottom: 64 }}>
          <h2 style={{ fontFamily: 'var(--font-display), sans-serif', fontSize: 28, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.02em', marginBottom: 16 }}>
            Why Three Rankings?
          </h2>
          <div style={{ fontSize: 15, color: 'var(--muted2)', lineHeight: 1.8, fontWeight: 300, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p style={{ margin: 0 }}>
              Benchmarks measure capability. Chatbot Arena measures preference.
              Neither tells you what matters most: <strong style={{ color: 'var(--white)', fontWeight: 500 }}>is this model worth the money for your use case?</strong>
            </p>
            <p style={{ margin: 0 }}>
              By collecting two votes per matchup — one blind, one price-informed — we can
              separate pure quality judgment from price-adjusted value. The gap between those
              two votes reveals Stickiness: the models people genuinely prefer regardless of cost.
            </p>
            <p style={{ margin: 0 }}>
              A model with high XDR-Q but low XDR-V is impressive but overpriced.
              A model with moderate XDR-Q but high XDR-V is a hidden gem.
              A model with high XDR-S is the real deal — people pick it and don't look back.
            </p>
          </div>
        </div>

        {/* CTA */}
        <div className="reveal" style={{ textAlign: 'center', padding: '48px 0' }}>
          <p style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 11, color: 'var(--muted)', letterSpacing: '0.15em', marginBottom: 20, textTransform: 'uppercase' }}>
            Every vote makes the rankings smarter
          </p>
          <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
            <Link href="/xduel" className="btn-primary" style={{ textDecoration: 'none' }}>Start XDuel →</Link>
            <Link href="/leaderboard" className="btn-outline" style={{ textDecoration: 'none' }}>View XDRating →</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
