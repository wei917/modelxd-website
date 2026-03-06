'use client'

import { useEffect, useRef, useState } from 'react'
import Nav from '../components/Nav'

type Vote = 'A' | 'B' | 'T' | null
type Mode = 'text' | 'image' | 'video'
type ArenaPhase = 'vote' | 'revote'

type ModelResult = {
  name: string
  provider: string
  outputPrice: number
  response: string
  tokens: number
  cost: number
  priceLabel: string
  responseTime: number  // milliseconds
}

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
  const [loading,    setLoading]    = useState(false)
  const [apiError,   setApiError]   = useState<string | null>(null)
  const [modelA,     setModelA]     = useState<ModelResult | null>(null)
  const [modelB,     setModelB]     = useState<ModelResult | null>(null)
  const [vote1,      setVote1]      = useState<Vote>(null)
  const [vote2,      setVote2]      = useState<Vote>(null)
  const [phase,      setPhase]      = useState<ArenaPhase>('vote')
  const [showPrices, setShowPrices] = useState(false)
  const [showReveal, setShowReveal] = useState(false)

  // Derived from real API data
  const cheaper    = modelA && modelB ? (modelA.outputPrice < modelB.outputPrice ? 'A' : 'B') : null
  const expModel   = cheaper === 'A' ? modelB : modelA
  const cheapModel = cheaper === 'A' ? modelA : modelB
  const ratio      = expModel && cheapModel ? Math.round(expModel.outputPrice / cheapModel.outputPrice) : 0
  const monthly    = expModel && cheapModel ? Math.round((expModel.outputPrice - cheapModel.outputPrice) * 10) : 0

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

  const startDuel = async () => {
    setLoading(true)
    setApiError(null)
    setModelA(null); setModelB(null)
    setVote1(null); setVote2(null)
    setPhase('vote'); setShowPrices(false); setShowReveal(false)
    goStep(2)

    try {
      const res = await fetch('/api/duel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'API error')
      setModelA(data.modelA)
      setModelB(data.modelB)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setApiError(msg)
    } finally {
      setLoading(false)
    }
  }

  const castVote = (choice: Vote) => {
    setVote1(choice)
    // Show prices immediately, skip step 3 pause — go straight to revote (step 4)
    setTimeout(() => { setShowPrices(true); setPhase('revote'); setStep(4) }, 500)
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
    setModelA(null); setModelB(null); setApiError(null)
  }

  const approxTokens     = Math.round(prompt.length / 3)
  const userChoseCheaper = vote2 === cheaper
  const savingsEmoji     = vote2 === 'T' ? '⚖' : userChoseCheaper ? '🎉' : '😂'

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

          {/* ── STEPS 2/3/4: arena view ── */}
          {(step === 2 || step === 3 || step === 4) && (
            <div className="step-section">
              <div className="prompt-header" style={{marginBottom:24}}>
                <div className="prompt-label">
                  {phase==='vote' ? 'Step 02 — Vote' : 'Step 04 — Vote Again'}
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

              {/* Error state */}
              {apiError && (
                <div style={{background:'rgba(232,69,60,0.1)',border:'1px solid rgba(232,69,60,0.4)',borderRadius:6,padding:'16px 20px',marginBottom:24,fontFamily:'var(--mono)',fontSize:13,color:'var(--red)'}}>
                  ⚠️ {apiError}
                  <button className="btn-secondary" style={{marginLeft:16}} onClick={() => goStep(1)}>← Try again</button>
                </div>
              )}

              <div className="battle-arena">
                {/* Model A */}
                <div className={`battle-card
                  ${(phase==='vote'?vote1:vote2)==='A'?'voted-this':''}
                  ${(phase==='vote'?vote1:vote2)&&(phase==='vote'?vote1:vote2)!=='A'?'voted-other':''}`}>
                  <div className="battle-card-header">
                    <div className="battle-model-id a">Model A</div>
                    <div style={{opacity:showPrices?1:0,transition:'opacity 0.5s'}}>
                      <span className="price-badge expensive">{modelA?.priceLabel ?? '…'}</span>
                    </div>
                  </div>
                  <div className={`battle-response ${loading?'loading':''}`}>
                    {loading
                      ? <><div className="loading-dot"/><div className="loading-dot"/><div className="loading-dot"/></>
                      : (modelA?.response ?? '')}
                  </div>
                  {modelA && modelB && !loading && (
                    <div className="response-time-bar">
                      <span className="response-time-label">Response time</span>
                      <span className="response-time-value" style={{color: modelA.responseTime <= modelB.responseTime ? '#4a9eff' : 'var(--muted2)'}}>
                        {(modelA.responseTime / 1000).toFixed(2)}s
                        {modelA.responseTime < modelB.responseTime && (
                          <span style={{marginLeft:6,fontSize:9,color:'#4a9eff',letterSpacing:'0.1em'}}>
                            ⚡ {((modelB.responseTime - modelA.responseTime) / 1000).toFixed(2)}s faster
                          </span>
                        )}
                      </span>
                    </div>
                  )}
                  {showPrices && modelA && (
                    <div className="price-reveal-bar" style={{animation:'slideDown 0.35s ease forwards'}}>
                      <span className="price-label">Estimated cost this prompt</span>
                      <span style={{fontFamily:'var(--mono)',fontSize:12,color:'var(--red)'}}>
                        ~${modelA.cost < 0.0001 ? modelA.cost.toExponential(2) : modelA.cost.toFixed(5)}
                      </span>
                    </div>
                  )}
                </div>

                {/* Model B */}
                <div className={`battle-card
                  ${(phase==='vote'?vote1:vote2)==='B'?'voted-this':''}
                  ${(phase==='vote'?vote1:vote2)&&(phase==='vote'?vote1:vote2)!=='B'?'voted-other':''}`}>
                  <div className="battle-card-header">
                    <div className="battle-model-id b">Model B</div>
                    <div style={{opacity:showPrices?1:0,transition:'opacity 0.5s'}}>
                      <span className="price-badge cheap">{modelB?.priceLabel ?? '…'}</span>
                    </div>
                  </div>
                  <div className={`battle-response ${loading?'loading':''}`}>
                    {loading
                      ? <><div className="loading-dot"/><div className="loading-dot"/><div className="loading-dot"/></>
                      : (modelB?.response ?? '')}
                  </div>
                  {modelA && modelB && !loading && (
                    <div className="response-time-bar">
                      <span className="response-time-label">Response time</span>
                      <span className="response-time-value" style={{color: modelB.responseTime <= modelA.responseTime ? 'var(--red)' : 'var(--muted2)'}}>
                        {(modelB.responseTime / 1000).toFixed(2)}s
                        {modelB.responseTime < modelA.responseTime && (
                          <span style={{marginLeft:6,fontSize:9,color:'var(--red)',letterSpacing:'0.1em'}}>
                            ⚡ {((modelA.responseTime - modelB.responseTime) / 1000).toFixed(2)}s faster
                          </span>
                        )}
                      </span>
                    </div>
                  )}
                  {showPrices && modelB && (
                    <div className="price-reveal-bar" style={{animation:'slideDown 0.35s ease forwards'}}>
                      <span className="price-label">Estimated cost this prompt</span>
                      <span style={{fontFamily:'var(--mono)',fontSize:12,color:'var(--green)'}}>
                        ~${modelB.cost < 0.0001 ? modelB.cost.toExponential(2) : modelB.cost.toFixed(5)}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Vote row — 3 buttons in one line */}
              <div className="vote-row">
                <button
                  className={`btn-vote a ${(phase==='vote'?vote1:vote2)==='A'?'voted a-voted':''}`}
                  onClick={() => phase==='vote' ? castVote('A') : castRevote('A')}
                  disabled={loading || !modelA || (phase==='vote' ? !!vote1 : !!vote2)}
                >
                  {(phase==='vote'?vote1:vote2)==='A'
                    ? '✓ Picked A'
                    : <><span>←</span><span>A is better</span></>}
                </button>
                <button
                  className={`btn-tie ${(phase==='vote'?vote1:vote2)==='T'?'voted':''}`}
                  onClick={() => phase==='vote' ? castVote('T') : castRevote('T')}
                  disabled={loading || (!modelA && !modelB) || (phase==='vote' ? !!vote1 : !!vote2)}
                >
                  {(phase==='vote'?vote1:vote2)==='T'
                    ? '✓ Tied'
                    : '⚖ Tie'}
                </button>
                <button
                  className={`btn-vote b ${(phase==='vote'?vote1:vote2)==='B'?'voted':''}`}
                  onClick={() => phase==='vote' ? castVote('B') : castRevote('B')}
                  disabled={loading || !modelB || (phase==='vote' ? !!vote1 : !!vote2)}
                >
                  {(phase==='vote'?vote1:vote2)==='B'
                    ? '✓ Picked B'
                    : <><span>B is better</span><span>→</span></>}
                </button>
              </div>

              <div className="action-bar">
                <span className="action-hint">
                  {loading
                    ? 'Calling both models…'
                    : phase==='vote'
                    ? 'Pick the response you prefer — identities are hidden'
                    : 'Now you know the cost — cast your final vote'}
                </span>
                {phase==='vote' && !loading && (
                  <button className="btn-secondary" onClick={() => goStep(1)}>← Change Prompt</button>
                )}
              </div>
            </div>
          )}

          {/* ── STEP 5: Reveal ── */}
          {step === 5 && (
            <div className="step-section">
              <div className="prompt-header" style={{marginBottom:32}}>
                <div className="prompt-label">Step 05 — Meet the Model</div>
                <h1 className="prompt-title">The <span>Reveal</span></h1>
              </div>

              {/* Model reveal */}
              <div style={{
                opacity: showReveal ? 1 : 0,
                transform: showReveal ? 'translateY(0)' : 'translateY(16px)',
                transition: 'opacity 0.5s ease, transform 0.5s ease',
              }}>
                <div className="model-reveal">
                  {modelA && modelB && [
                    { m: modelA, id: 'A' },
                    { m: modelB, id: 'B' },
                  ].map(({ m, id }, i) => {
                    const wins = id === cheaper
                    return (
                      <div key={m.name} className={`reveal-card ${wins?'winner':''} ${i===0?'border-right':''}`}>
                        <div className="reveal-model-name">{m.name}</div>
                        <div className="reveal-provider">{m.provider.toUpperCase()}</div>
                        <div className="reveal-price" style={{color:wins?'var(--green)':'var(--red)'}}>
                          {m.priceLabel}
                        </div>
                        <div className="reveal-stat" style={{color:wins?'var(--green)':'var(--muted2)'}}>
                          {wins
                            ? `${savingsEmoji} ${ratio}× cheaper — saves $${monthly.toLocaleString()}/mo at 10M tokens`
                            : 'More expensive option'}
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
