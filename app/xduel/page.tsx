'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'

type Vote = 'A' | 'B' | 'T' | null
type Step = 1 | 2 | 3 | 4 | 5 | 6

const RESPONSES = {
  A: `GPT-4o delivers a comprehensive and well-structured response here. The answer covers the key concepts with clarity, appropriate depth, and useful examples. This is the kind of quality output you'd expect from a frontier model — articulate, accurate, and well-reasoned throughout.`,
  B: `Gemini Flash cuts straight to the point with a crisp, efficient answer. The core concepts are explained clearly without unnecessary padding. In blind testing, this response rated comparably to Model A on most quality metrics — at a fraction of the cost.`,
}

const MODEL_A = { name: 'GPT-4o',       provider: 'OpenAI', price: 10.0  }
const MODEL_B = { name: 'Gemini Flash', provider: 'Google', price: 0.075 }

export default function XDuel() {
  const cursorRef  = useRef<HTMLDivElement>(null)
  const ringRef    = useRef<HTMLDivElement>(null)
  const [step,   setStep]   = useState<Step>(1)
  const [mode,   setMode]   = useState<'text'|'image'|'video'>('text')
  const [prompt, setPrompt] = useState('')
  const [vote1,  setVote1]  = useState<Vote>(null)
  const [vote2,  setVote2]  = useState<Vote>(null)
  const [loadingA, setLoadingA] = useState(true)
  const [loadingB, setLoadingB] = useState(true)

  // Cursor
  useEffect(() => {
    let mx = 0, my = 0, rx = 0, ry = 0, id: number
    const onMove = (e: MouseEvent) => {
      mx = e.clientX; my = e.clientY
      if (cursorRef.current) { cursorRef.current.style.left = mx+'px'; cursorRef.current.style.top = my+'px' }
    }
    const anim = () => {
      rx += (mx-rx)*0.12; ry += (my-ry)*0.12
      if (ringRef.current) { ringRef.current.style.left = rx+'px'; ringRef.current.style.top = ry+'px' }
      id = requestAnimationFrame(anim)
    }
    document.addEventListener('mousemove', onMove)
    id = requestAnimationFrame(anim)
    return () => { document.removeEventListener('mousemove', onMove); cancelAnimationFrame(id) }
  }, [])

  const goStep = (n: Step) => { setStep(n); window.scrollTo({ top: 0, behavior: 'smooth' }) }

  const startBattle = () => {
    setLoadingA(true); setLoadingB(true)
    setVote1(null); setVote2(null)
    goStep(2)
    setTimeout(() => setLoadingA(false), 1200)
    setTimeout(() => setLoadingB(false), 1800)
  }

  const castVote = (choice: Vote) => {
    setVote1(choice)
    setTimeout(() => goStep(3), 700)
  }

  const castRevote = (choice: Vote) => {
    setVote2(choice)
    setTimeout(() => goStep(5), 600)
  }

  const approxTokens = Math.round(prompt.length / 3)

  const cheaper = MODEL_A.price < MODEL_B.price ? 'A' : 'B'
  const expModel   = cheaper === 'A' ? MODEL_B : MODEL_A
  const cheapModel = cheaper === 'A' ? MODEL_A : MODEL_B
  const ratio = Math.round(expModel.price / cheapModel.price)
  const monthlySave = Math.round((expModel.price - cheapModel.price) * 10)
  const userChoseCheaper = vote2 === cheaper
  const savingsEmoji = vote2 === 'T' ? '🤝' : userChoseCheaper ? '🎉' : '😂'

  const steps = ['Battle','Vote Blind','Price Reveal','Re-Vote','Savings','Reveal']

  return (
    <>
      <div className="cursor" ref={cursorRef} />
      <div className="cursor-ring" ref={ringRef} />

      {/* Nav */}
      <nav className="nav">
        <div className="nav-logo">
          <Image src="/logo.png" alt="ModelXD" width={72} height={72} style={{ objectFit:'contain' }} />
        </div>
        <div className="nav-links">
          <Link href="/">Home</Link>
          <Link href="/xduel" className="active">XDuel</Link>
          <Link href="/vote">Vote</Link>
          <Link href="/leaderboard">Leaderboard</Link>
          <Link href="/create">Create</Link>
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

      <div className="xduel-page">

        {/* Step bar */}
        <div className="step-bar">
          {steps.map((label, i) => {
            const s = i + 1
            const isActive = s === step
            const isDone   = s < step
            return (
              <>
                <div key={s} className={`step-item ${isActive ? 'active' : ''} ${isDone ? 'done' : ''}`}>
                  <div className="step-num">{s}</div>
                  {label}
                </div>
                {i < steps.length - 1 && (
                  <div key={`c${s}`} className={`step-connector ${isDone ? 'done' : ''}`} />
                )}
              </>
            )
          })}
        </div>

        <div className="arena">

          {/* ── STEP 1: Battle ── */}
          {step === 1 && (
            <div className="step-section">
              <div className="prompt-header">
                <div className="prompt-label">Step 01 — Enter Your Prompt</div>
                <h1 className="prompt-title">Start the <span>XDuel</span></h1>
                <div className="prompt-sub">Two anonymous models will respond. You vote blind. Then the truth drops.</div>
              </div>

              <div className="mode-selector">
                {(['text','image','video'] as const).map(m => (
                  <button key={m} className={`mode-btn ${mode===m?'active':''}`} onClick={() => setMode(m)}>
                    <span className="mode-dot" />
                    {m.charAt(0).toUpperCase()+m.slice(1)}
                  </button>
                ))}
              </div>

              <div className="prompt-box">
                <textarea
                  className="prompt-textarea"
                  placeholder="Ask anything..."
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                />
                <div className="prompt-actions">
                  <span className="prompt-counter">{approxTokens > 0 ? `~${approxTokens} tokens` : ''}</span>
                  <button className="btn-battle" onClick={startBattle} disabled={prompt.trim().length < 3}>
                    ⚔️ Start XDuel →
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── STEP 2: Vote Blind ── */}
          {step === 2 && (
            <div className="step-section">
              <div className="prompt-header">
                <div className="prompt-label">Step 02 — Vote Blind</div>
                <h1 className="prompt-title">Which is <span>Better?</span></h1>
                <div className="prompt-sub">&ldquo;{prompt.substring(0,80)}{prompt.length>80?'…':''}&rdquo;</div>
              </div>
              <BattleArena
                loadingA={loadingA} loadingB={loadingB}
                vote={vote1} onVote={castVote}
                showPrices={false}
              />
              <div className="action-bar">
                <span className="action-hint">Pick the response you prefer — identities are hidden</span>
                <button className="btn-secondary" onClick={() => goStep(1)}>← Change Prompt</button>
              </div>
            </div>
          )}

          {/* ── STEP 3: Price Reveal ── */}
          {step === 3 && (
            <div className="step-section">
              <div className="prompt-header">
                <div className="prompt-label">Step 03 — Price Reveal</div>
                <h1 className="prompt-title">Now You Know the <span>Cost</span></h1>
                <div className="prompt-sub">
                  You picked <strong style={{ color:'var(--white)' }}>{vote1 === 'T' ? 'a Tie' : `Model ${vote1}`}</strong> — now vote again knowing the price ↓
                </div>
              </div>
              <BattleArena
                loadingA={false} loadingB={false}
                vote={null} onVote={castRevote}
                showPrices={true}
                revoteLabels
              />
            </div>
          )}

          {/* ── STEP 4: Re-Vote (same as step 3 but with revote labels) ── */}
          {step === 4 && null /* merged into step 3 */ }

          {/* ── STEP 5: Savings ── */}
          {step === 5 && (
            <div className="step-section">
              <div className="prompt-header">
                <div className="prompt-label">Step 05 — Your Savings</div>
                <h1 className="prompt-title">Here&apos;s What You <span>Could Save</span></h1>
              </div>
              <div className="savings-reveal">
                <span className="savings-reveal-emoji">{savingsEmoji}</span>
                <div className="savings-reveal-amount">${monthlySave.toLocaleString()}</div>
                <div className="savings-reveal-period">per month · at 10M tokens</div>
                <p className="savings-reveal-desc">
                  Switching from the expensive model to the cheaper one saves{' '}
                  <strong style={{ color:'var(--green)' }}>{ratio}× in API costs</strong> per month
                  at 10M tokens — with no measurable quality difference on most tasks.
                </p>
              </div>
              <div className="action-bar">
                <span className="action-hint">Based on your vote + current API pricing</span>
                <button className="btn-next" onClick={() => goStep(6)}>Reveal the Models →</button>
              </div>
            </div>
          )}

          {/* ── STEP 6: Reveal ── */}
          {step === 6 && (
            <div className="step-section">
              <div className="prompt-header">
                <div className="prompt-label">Step 06 — The Reveal</div>
                <h1 className="prompt-title">
                  {userChoseCheaper
                    ? <>Great Value <span>Choice! 🎉</span></>
                    : <>Were You <span>Overpaying? 😂</span></>}
                </h1>
                <div className="prompt-sub">The identities are unmasked.</div>
              </div>
              <div className="model-reveal">
                {[MODEL_A, MODEL_B].map((m, i) => {
                  const isWinner = m.price < (i === 0 ? MODEL_B : MODEL_A).price
                  return (
                    <div key={m.name} className={`reveal-card ${isWinner ? 'winner' : ''} ${i===0?'border-right':''}`}>
                      <div className="reveal-verdict">{isWinner ? '🎉' : '😬'}</div>
                      <div className="reveal-model-name">{m.name}</div>
                      <div className="reveal-provider">{m.provider.toUpperCase()}</div>
                      <div className="reveal-price" style={{ color: isWinner ? 'var(--green)' : 'var(--red)' }}>
                        ${m.price.toFixed(3)} / 1M tokens
                      </div>
                      <div className="reveal-stat">
                        {isWinner ? `${ratio}× cheaper · community preferred` : 'More expensive option'}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="action-bar">
                <span className="action-hint">
                  {userChoseCheaper ? 'You picked the cheaper model. Smart.' : vote2 === 'T' ? 'You called it a tie. Fair enough.' : 'You consistently preferred the pricier model. XD.'}
                </span>
                <div style={{ display:'flex', gap:12 }}>
                  <button className="btn-secondary" onClick={() => { setPrompt(''); goStep(1) }}>New XDuel</button>
                  <button className="btn-next" onClick={() => goStep(1)}>Duel Again →</button>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </>
  )
}

// ── Battle Arena Component ────────────────────────────────────────────
function BattleArena({ loadingA, loadingB, vote, onVote, showPrices, revoteLabels }: {
  loadingA: boolean; loadingB: boolean
  vote: Vote; onVote: (v: Vote) => void
  showPrices: boolean; revoteLabels?: boolean
}) {
  const label = revoteLabels ? '👆 Still prefer this' : '👆 This one is better'
  return (
    <div className="battle-arena">
      {/* Model A */}
      <div className={`battle-card ${vote==='A'?'voted-this':''} ${vote&&vote!=='A'?'voted-other':''}`}>
        <div className="battle-card-header">
          <div className="battle-model-id a">Model A</div>
          {showPrices
            ? <span className="price-badge expensive">$10.00 / 1M tokens</span>
            : <span className="battle-anon">IDENTITY HIDDEN</span>}
        </div>
        <div className={`battle-response ${loadingA?'loading':''}`}>
          {loadingA ? (<><div className="loading-dot"/><div className="loading-dot"/><div className="loading-dot"/></>) : RESPONSES.A}
        </div>
        {showPrices && (
          <div className="price-reveal-bar">
            <span className="price-label">Estimated cost this prompt</span>
            <span style={{ fontFamily:'var(--mono)', fontSize:12, color:'var(--red)' }}>~$0.0042</span>
          </div>
        )}
        <div className="battle-footer">
          <button
            className={`btn-vote a ${vote==='A'?'voted a-voted':''}`}
            onClick={() => !vote && onVote('A')}
            disabled={!!vote}
          >
            {vote==='A' ? '✓ Your pick' : label}
          </button>
        </div>
      </div>

      {/* Model B */}
      <div className={`battle-card ${vote==='B'?'voted-this':''} ${vote&&vote!=='B'?'voted-other':''}`}>
        <div className="battle-card-header">
          <div className="battle-model-id b">Model B</div>
          {showPrices
            ? <span className="price-badge cheap">$0.075 / 1M tokens</span>
            : <span className="battle-anon">IDENTITY HIDDEN</span>}
        </div>
        <div className={`battle-response ${loadingB?'loading':''}`}>
          {loadingB ? (<><div className="loading-dot"/><div className="loading-dot"/><div className="loading-dot"/></>) : RESPONSES.B}
        </div>
        {showPrices && (
          <div className="price-reveal-bar">
            <span className="price-label">Estimated cost this prompt</span>
            <span style={{ fontFamily:'var(--mono)', fontSize:12, color:'var(--green)' }}>~$0.000031</span>
          </div>
        )}
        <div className="battle-footer">
          <button
            className={`btn-vote b ${vote==='B'?'voted':''}`}
            onClick={() => !vote && onVote('B')}
            disabled={!!vote}
          >
            {vote==='B' ? '✓ Your pick' : label}
          </button>
        </div>
      </div>

      {/* Tie */}
      <div className="tie-row">
        <button
          className={`btn-tie ${vote==='T'?'voted':''}`}
          onClick={() => !vote && onVote('T')}
          disabled={!!vote}
        >
          {vote==='T' ? '✓ Tied' : revoteLabels ? '🤝 Still a Tie' : '🤝 It\'s a Tie'}
        </button>
      </div>
    </div>
  )
}
