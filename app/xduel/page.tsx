'use client'

import { useEffect, useRef, useState } from 'react'
import Nav from '../components/Nav'

type Vote = 'A' | 'B' | 'T' | null
type Mode = 'text' | 'image' | 'video'
type ArenaPhase = 'vote' | 'revote'

const MODEL_A = { name: 'GPT-4o',       provider: 'OpenAI', price: 10.0  }
const MODEL_B = { name: 'Gemini Flash', provider: 'Google', price: 0.075 }

const RESP_A = `GPT-4o delivers a comprehensive and well-structured response here. The answer covers the key concepts with clarity, appropriate depth, and useful examples. This is the kind of quality output you'd expect from a frontier model — articulate, accurate, and well-reasoned throughout.`
const RESP_B = `Gemini Flash cuts straight to the point with a crisp, efficient answer. The core concepts are explained clearly without unnecessary padding. In blind testing, this response rated comparably to Model A on most quality metrics — at a fraction of the cost.`

const CHEAPER    = MODEL_A.price < MODEL_B.price ? 'A' : 'B'
const EXP_MODEL  = CHEAPER === 'A' ? MODEL_B : MODEL_A
const RATIO      = Math.round(EXP_MODEL.price / (CHEAPER === 'A' ? MODEL_A : MODEL_B).price)
const MONTHLY    = Math.round((EXP_MODEL.price - (CHEAPER === 'A' ? MODEL_A : MODEL_B).price) * 10)

const STEPS = [
  { n:1, label:'Duel' },
  { n:2, label:'Vote' },
  { n:3, label:'Reveal Price' },
  { n:4, label:'Vote Again' },
  { n:5, label:'Meet the Model' },
]

export default function XDuel() {
  const cursorRef = useRef<HTMLDivElement>(null)
  const ringRef   = useRef<HTMLDivElement>(null)

  const [step,       setStep]       = useState(1)
  const [mode,       setMode]       = useState<Mode>('text')
  const [prompt,     setPrompt]     = useState('')
  const [loadingA,   setLoadingA]   = useState(true)
  const [loadingB,   setLoadingB]   = useState(true)
  const [vote1,      setVote1]      = useState<Vote>(null)
  const [vote2,      setVote2]      = useState<Vote>(null)
  const [phase,      setPhase]      = useState<ArenaPhase>('vote')
  const [showPrices, setShowPrices] = useState(false)
  const [showReveal, setShowReveal] = useState(false)

  useEffect(() => {
    let mx = 0, my = 0, rx = 0, ry = 0, id: number
    const move = (e: MouseEvent) => {
      mx = e.clientX; my = e.clientY
      if (cursorRef.current) { cursorRef.current.style.left = mx+'px'; cursorRef.current.style.top = my+'px' }
    }
    const tick = () => {
      rx += (mx-rx)*0.12; ry += (my-ry)*0.12
      if (ringRef.current) { ringRef.current.style.left = rx+'px'; ringRef.current.style.top = ry+'px' }
      id = requestAnimationFrame(tick)
    }
    document.addEventListener('mousemove', move)
    id = requestAnimationFrame(tick)
    return () => { document.removeEventListener('mousemove', move); cancelAnimationFrame(id) }
  }, [])

  const goStep = (n: number) => { setStep(n); window.scrollTo({ top:0, behavior:'smooth' }) }

  const startDuel = () => {
    setLoadingA(true); setLoadingB(true)
    setVote1(null); setVote2(null)
    setPhase('vote'); setShowPrices(false); setShowReveal(false)
    goStep(2)
    setTimeout(() => setLoadingA(false), 1200)
    setTimeout(() => setLoadingB(false), 1800)
  }

  const castVote = (choice: Vote) => {
    setVote1(choice)
    setTimeout(() => { setShowPrices(true); setPhase('revote'); setStep(3) }, 500)
  }

  const castRevote = (choice: Vote) => {
    setVote2(choice)
    setStep(4)
    setTimeout(() => {
      goStep(5)
      setTimeout(() => setShowReveal(true), 600)
    }, 600)
  }

  const reset = () => {
    setStep(1); setVote1(null); setVote2(null)
    setPhase('vote'); setShowPrices(false); setShowReveal(false); setPrompt('')
  }

  const approxTokens     = Math.round(prompt.length / 3)
  const userChoseCheaper = vote2 === CHEAPER
  const savingsEmoji     = vote2 === 'T' ? '🤝' : userChoseCheaper ? '🎉' : '😂'

  return (
    <>
      <div className="cursor" ref={cursorRef} />
      <div className="cursor-ring" ref={ringRef} />
      <Nav />

      <div className="xduel-page">

        {/* Step bar */}
        <div className="step-bar">
          {STEPS.map((s, i) => (
            <span key={s.n} style={{display:'contents'}}>
              <div className={`step-item ${step===s.n?'active':''} ${step>s.n?'done':''}`}>
                <div className="step-num">{s.n}</div>{s.label}
              </div>
              {i < STEPS.length-1 && <div className={`step-connector ${step>s.n?'done':''}`} />}
            </span>
          ))}
        </div>

        <div className="arena">

          {/* ── STEP 1 ── */}
          {step === 1 && (
            <div className="step-section">
              <div className="prompt-header">
                <div className="prompt-label">Step 01 — Duel</div>
                <h1 className="prompt-title">Start the <span>XDuel</span></h1>
                <div className="prompt-sub">Two anonymous models will respond. You vote blind. Then the truth drops.</div>
              </div>
              <div className="mode-selector">
                {(['text','image','video'] as Mode[]).map(m => (
                  <button key={m} className={`mode-btn ${mode===m?'active':''}`} onClick={() => setMode(m)}>
                    <span className="mode-dot" />{m.charAt(0).toUpperCase()+m.slice(1)}
                  </button>
                ))}
              </div>
              <div className="prompt-box">
                <textarea
                  className="prompt-textarea"
                  placeholder="Ask anything... e.g. 'Explain quantum entanglement in simple terms'"
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                />
                <div className="prompt-actions">
                  <span className="prompt-counter">{approxTokens > 0 ? `~${approxTokens} tokens` : ''}</span>
                  <button className="btn-battle" onClick={startDuel} disabled={prompt.trim().length < 3}>
                    ⚔️ Start XDuel →
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── STEPS 2/3/4: single arena view ── */}
          {(step === 2 || step === 3 || step === 4) && (
            <div className="step-section">
              <div className="prompt-header" style={{marginBottom:24}}>
                <div className="prompt-label">
                  {phase==='vote' ? 'Step 02 — Vote' : 'Step 03 — Reveal Price'}
                </div>
                <h1 className="prompt-title">
                  {phase==='vote' ? <>Which is <span>Better?</span></> : <>Now You Know the <span>Cost</span></>}
                </h1>
                <div className="prompt-sub">
                  {phase==='vote'
                    ? `"${prompt.substring(0,80)}${prompt.length>80?'…':''}"`
                    : <span>You picked <strong style={{color:'var(--white)'}}>{vote1==='T'?'a Tie':`Model ${vote1}`}</strong> — vote again knowing the price</span>}
                </div>
              </div>

              <div className="battle-arena">
                {/* Model A */}
                <div className={`battle-card
                  ${(phase==='vote'?vote1:vote2)==='A'?'voted-this':''}
                  ${(phase==='vote'?vote1:vote2)&&(phase==='vote'?vote1:vote2)!=='A'?'voted-other':''}`}>
                  <div className="battle-card-header">
                    <div className="battle-model-id a">Model A</div>
                    <div style={{opacity:showPrices?1:0,transition:'opacity 0.5s'}}>
                      <span className="price-badge expensive">$10.00 / 1M tokens</span>
                    </div>
                  </div>
                  <div className={`battle-response ${loadingA?'loading':''}`}>
                    {loadingA ? <><div className="loading-dot"/><div className="loading-dot"/><div className="loading-dot"/></> : RESP_A}
                  </div>
                  {showPrices && (
                    <div className="price-reveal-bar" style={{animation:'slideDown 0.35s ease forwards'}}>
                      <span className="price-label">Estimated cost this prompt</span>
                      <span style={{fontFamily:'var(--mono)',fontSize:12,color:'var(--red)'}}>~$0.0042</span>
                    </div>
                  )}
                  <div className="battle-footer">
                    <button
                      className={`btn-vote a ${(phase==='vote'?vote1:vote2)==='A'?'voted a-voted':''}`}
                      onClick={() => phase==='vote' ? castVote('A') : castRevote('A')}
                      disabled={phase==='vote' ? !!vote1 : !!vote2}
                    >
                      {(phase==='vote'?vote1:vote2)==='A'
                        ? (phase==='revote'?'✓ Final pick':'✓ Your pick')
                        : (phase==='revote'?'👆 Prefer this':'👆 This one is better')}
                    </button>
                  </div>
                </div>

                {/* Model B */}
                <div className={`battle-card
                  ${(phase==='vote'?vote1:vote2)==='B'?'voted-this':''}
                  ${(phase==='vote'?vote1:vote2)&&(phase==='vote'?vote1:vote2)!=='B'?'voted-other':''}`}>
                  <div className="battle-card-header">
                    <div className="battle-model-id b">Model B</div>
                    <div style={{opacity:showPrices?1:0,transition:'opacity 0.5s'}}>
                      <span className="price-badge cheap">$0.075 / 1M tokens</span>
                    </div>
                  </div>
                  <div className={`battle-response ${loadingB?'loading':''}`}>
                    {loadingB ? <><div className="loading-dot"/><div className="loading-dot"/><div className="loading-dot"/></> : RESP_B}
                  </div>
                  {showPrices && (
                    <div className="price-reveal-bar" style={{animation:'slideDown 0.35s ease forwards'}}>
                      <span className="price-label">Estimated cost this prompt</span>
                      <span style={{fontFamily:'var(--mono)',fontSize:12,color:'var(--green)'}}>~$0.000031</span>
                    </div>
                  )}
                  <div className="battle-footer">
                    <button
                      className={`btn-vote b ${(phase==='vote'?vote1:vote2)==='B'?'voted':''}`}
                      onClick={() => phase==='vote' ? castVote('B') : castRevote('B')}
                      disabled={phase==='vote' ? !!vote1 : !!vote2}
                    >
                      {(phase==='vote'?vote1:vote2)==='B'
                        ? (phase==='revote'?'✓ Final pick':'✓ Your pick')
                        : (phase==='revote'?'👆 Prefer this':'👆 This one is better')}
                    </button>
                  </div>
                </div>

                {/* Tie */}
                <div className="tie-row">
                  <button
                    className={`btn-tie ${(phase==='vote'?vote1:vote2)==='T'?'voted':''}`}
                    onClick={() => phase==='vote' ? castVote('T') : castRevote('T')}
                    disabled={phase==='vote' ? !!vote1 : !!vote2}
                  >
                    {(phase==='vote'?vote1:vote2)==='T'
                      ? (phase==='revote'?'✓ Final: Tie':'✓ Tied')
                      : (phase==='revote'?"🤝 A Tie":"🤝 It's a Tie")}
                  </button>
                </div>
              </div>

              <div className="action-bar">
                <span className="action-hint">
                  {phase==='vote' ? 'Pick the response you prefer — identities are hidden' : 'Now you know the cost — cast your final vote'}
                </span>
                {phase==='vote' && (
                  <button className="btn-secondary" onClick={() => goStep(1)}>← Change Prompt</button>
                )}
              </div>
            </div>
          )}

          {/* ── STEP 5: Savings + Reveal ── */}
          {step === 5 && (
            <div className="step-section">
              <div className="prompt-header" style={{marginBottom:32}}>
                <div className="prompt-label">Step 05 — Meet the Model</div>
                <h1 className="prompt-title">
                  {userChoseCheaper ? <>Great Value <span>Choice! 🎉</span></>
                  : vote2==='T'     ? <>You Called It a <span>Tie</span></>
                  :                   <>Were You <span>Overpaying? 😂</span></>}
                </h1>
                <div className="prompt-sub">
                  {userChoseCheaper ? 'You picked the cheaper model — and it held up in quality.'
                  : vote2==='T'     ? 'One was significantly cheaper — but quality felt equal to you.'
                  : vote1===vote2   ? 'You consistently preferred the pricier model. Classic. XD.'
                  :                   'You switched but still picked the expensive one. XD.'}
                </div>
              </div>

              <div className="savings-reveal">
                <span className="savings-reveal-emoji">{savingsEmoji}</span>
                <div className="savings-reveal-amount">${MONTHLY.toLocaleString()}</div>
                <div className="savings-reveal-period">per month · at 10M tokens</div>
                <p className="savings-reveal-desc">
                  Switching to the cheaper model saves{' '}
                  <strong style={{color:'var(--green)'}}>{RATIO}× in API costs</strong>{' '}
                  per month at 10M tokens — with no measurable quality difference on most tasks.
                </p>
              </div>

              {/* Model reveal slides in */}
              <div style={{
                marginTop: 32,
                opacity: showReveal ? 1 : 0,
                transform: showReveal ? 'translateY(0)' : 'translateY(16px)',
                transition: 'opacity 0.5s ease, transform 0.5s ease',
              }}>
                <div className="model-reveal">
                  {[MODEL_A, MODEL_B].map((m, i) => {
                    const wins = m.price < (i===0 ? MODEL_B : MODEL_A).price
                    return (
                      <div key={m.name} className={`reveal-card ${wins?'winner':''} ${i===0?'border-right':''}`}>
                        <div className="reveal-verdict">{wins ? '🎉' : '😬'}</div>
                        <div className="reveal-model-name">{m.name}</div>
                        <div className="reveal-provider">{m.provider.toUpperCase()}</div>
                        <div className="reveal-price" style={{color:wins?'var(--green)':'var(--red)'}}>
                          ${m.price.toFixed(3)} / 1M tokens
                        </div>
                        <div className="reveal-stat">
                          {wins ? `${RATIO}× cheaper · community preferred` : 'More expensive option'}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="action-bar">
                <span className="action-hint">
                  {userChoseCheaper ? 'Smart call. You saved money without sacrificing quality.'
                  : vote2==='T'     ? 'Interesting. The cheaper model held its own.'
                  :                   'The cheaper model was right there. XD.'}
                </span>
                <div style={{display:'flex',gap:12}}>
                  <button className="btn-secondary" onClick={reset}>New XDuel</button>
                  <button className="btn-next" onClick={reset}>Duel Again →</button>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </>
  )
}
