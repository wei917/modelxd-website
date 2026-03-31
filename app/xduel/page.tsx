'use client'

import { useEffect, useRef, useState } from 'react'
import Nav from '../components/Nav'
import { useRequireAuth } from '../../lib/useRequireAuth'
import ReactMarkdown from 'react-markdown'
import AttachmentButton, { type Attachment } from '../components/AttachmentButton'

type Vote = number | 'T' | null   // index of chosen model, or 'T' for tie
type Mode = 'text' | 'image' | 'video'
type ArenaPhase = 'vote' | 'revote'

type ModelMeta = {
  id?: string
  name: string
  provider: string
  outputPrice: number
  priceLabel: string
}

type ModelState = {
  meta: ModelMeta
  text: string
  isImage: boolean
  isVideo: boolean
  tokens: number
  responseTime: number
  streaming: boolean
  done: boolean
  cost: number
}

const STEPS = [
  { n:1, label:'Task' },
  { n:2, label:'Vote' },
  { n:3, label:'Reveal Price' },
  { n:4, label:'Vote Again' },
  { n:5, label:'Meet the Model' },
]

const LABELS = ['A','B','C','D']

/** Format a per-call cost as a readable dollar amount (never scientific notation) */
function formatCost(cost: number, isImage: boolean, isVideo: boolean): string {
  if (isImage) return `$${parseFloat(cost.toFixed(4))} / image`
  if (isVideo) return `$${parseFloat(cost.toFixed(4))} / video`
  if (cost === 0) return '$0.00'
  if (cost < 0.01) return `$${cost.toFixed(6)}`
  return `$${cost.toFixed(4)}`
}

export default function XDuel() {
  useRequireAuth()
  const cursorRef = useRef<HTMLDivElement>(null)
  const ringRef   = useRef<HTMLDivElement>(null)
  const setCursor = (color: string) => {
    if (cursorRef.current) cursorRef.current.style.background = color
    if (ringRef.current)   ringRef.current.style.borderColor  = color + '66'
  }

  const [step,       setStep]       = useState(1)
  const [mode,       setMode]       = useState<Mode>('text')
  const [count,      setCount]      = useState(2)
  const [duelId,     setDuelId]     = useState<string | null>(null)
  const [prompt,     setPrompt]     = useState('')
  const [loading,    setLoading]    = useState(false)
  const [apiError,   setApiError]   = useState<string | null>(null)
  const [models,     setModels]     = useState<ModelState[]>([])
  const [vote1,      setVote1]      = useState<Vote>(null)
  const [lightbox,   setLightbox]   = useState<string | null>(null)
  const [vote2,      setVote2]      = useState<Vote>(null)
  const [phase,      setPhase]      = useState<ArenaPhase>('vote')
  const [showPrices, setShowPrices] = useState(false)
  const [showReveal, setShowReveal] = useState(false)
  const [attachment,  setAttachment]  = useState<Attachment | null>(null)

  const bothDone    = models.length > 0 && models.every(m => m.done)
  const anyStreaming = models.some(m => m.streaming)

  // Cheapest model index
  const cheapestIdx = models.length > 0
    ? models.reduce((minI, m, i, arr) => m.meta.outputPrice < arr[minI].meta.outputPrice ? i : minI, 0)
    : -1

  const currentVote = phase === 'vote' ? vote1 : vote2

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
    setModels([])
    setVote1(null); setVote2(null)
    setDuelId(null)
    setPhase('vote'); setShowPrices(false); setShowReveal(false)
    goStep(2)

    try {
      const res = await fetch('/api/duel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, mode, count, attachment: attachment ? { storagePath: attachment.storagePath, bucket: attachment.bucket, mediaType: attachment.mediaType, fileName: attachment.fileName, fileSize: attachment.fileSize } : null }),
      })

      if (!res.ok || !res.body) {
        const err = await res.text()
        throw new Error(err || `Server error ${res.status}`)
      }

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let currentEvent = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim()
          } else if (line.startsWith('data: ')) {
            try {
              const payload = JSON.parse(line.slice(6))

              if (currentEvent === 'meta') {
                if (payload.duelId) setDuelId(payload.duelId)
                // Initialize slots with model info from meta (includes price data)
                const initialModels: ModelState[] = payload.models.map((pm: any) => ({
                  meta: {
                    id:          pm.id ?? '',
                    name:        pm.name,
                    provider:    pm.provider,
                    outputPrice: pm.outputPrice ?? 0,
                    priceLabel:  pm.priceLabel ?? '…',
                  },
                  text:         '',
                  isImage:      false,
                  isVideo:      false,
                  tokens:       0,
                  responseTime: 0,
                  streaming:    true,
                  done:         false,
                  cost:         0,
                }))
                setModels(initialModels)
                setLoading(false)

              } else if (currentEvent.startsWith('trying:')) {
                // Worker picked a model — update that slot's meta
                const idx = payload.index
                setModels(prev => prev.map((m, i) =>
                  i === idx ? { ...m, meta: { id: payload.id ?? '', name: payload.name, provider: payload.provider, outputPrice: payload.outputPrice, priceLabel: payload.priceLabel }, text: '', streaming: true, done: false } : m
                ))

              } else if (currentEvent.startsWith('delta:')) {
                const idx = payload.index
                setModels(prev => prev.map((m, i) =>
                  i === idx ? { ...m, text: m.text + payload.text, isImage: payload.isImage ?? m.isImage, isVideo: payload.isVideo ?? m.isVideo } : m
                ))

              } else if (currentEvent.startsWith('done:')) {
                const idx = payload.index
                setModels(prev => prev.map((m, i) => {
                  if (i !== idx) return m
                  const realCost = payload.cost != null ? Number(payload.cost) : m.isImage ? m.meta.outputPrice : (payload.tokens / 1_000_000) * m.meta.outputPrice
                  return {
                    ...m,
                    tokens:       payload.tokens,
                    responseTime: payload.responseTime,
                    cost:         realCost,
                    streaming:    false,
                    done:         true,
                  }
                }))

              } else if (currentEvent === 'resolved') {
                                // Update with actually-used models after any fallbacks
                                setModels(prev => prev.map((m, i) => ({
                                  ...m,
                                  meta: payload.models[i] ?? m.meta,
                                })))

              } else if (currentEvent.startsWith('error:')) {
                const idx = payload.index
                setModels(prev => prev.map((m, i) =>
                  i === idx ? { ...m, text: `⚠️ ${payload.message}`, streaming: false, done: true } : m
                ))
              }
            } catch {}
          }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setApiError(msg)
      setLoading(false)
    }
  }

  const castVote = (choice: Vote) => {
    setVote1(choice)
    setTimeout(() => { setShowPrices(true); setPhase('revote'); setStep(4) }, 500)
    if (duelId) fetch('/api/duel/vote', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        duelId,
        vote1: choice === 'T' ? 'T' : String(choice),
        vote1ModelId: choice === 'T' ? null : models[choice as number]?.meta?.id ?? null,
      }),
    }).catch(console.error)
  }

  const castRevote = (choice: Vote) => {
    setVote2(choice)
    if (duelId) fetch('/api/duel/vote', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        duelId,
        vote2: choice === 'T' ? 'T' : String(choice),
        vote2ModelId: choice === 'T' ? null : models[choice as number]?.meta?.id ?? null,
      }),
    }).catch(console.error)
    setTimeout(() => {
      goStep(5)
      setTimeout(() => setShowReveal(true), 600)
    }, 600)
  }

  const clearState = (keepPrompt = false) => {
    setVote1(null); setVote2(null)
    setPhase('vote'); setShowPrices(false); setShowReveal(false)
    setModels([]); setApiError(null)
    if (!keepPrompt) { setPrompt(''); setAttachment(null) }
  }

  const approxTokens = Math.round(prompt.length / 3)

  // Cheapest model for savings calc
  const cheapestModel = cheapestIdx >= 0 ? models[cheapestIdx] : null
  const mostExpensive = models.length > 0
    ? models.reduce((maxM, m) => m.meta.outputPrice > maxM.meta.outputPrice ? m : maxM, models[0])
    : null
  const ratio   = cheapestModel && mostExpensive && cheapestModel.meta.outputPrice > 0
    ? Math.round(mostExpensive.meta.outputPrice / cheapestModel.meta.outputPrice)
    : 0
  // text:  savings per 10M tokens
  // image/video: savings per 1000 generations
  const isMediaMode = mode === 'image' || mode === 'video'
  const monthly = cheapestModel && mostExpensive
    ? isMediaMode
      ? Math.round((mostExpensive.meta.outputPrice - cheapestModel.meta.outputPrice) * 1000)
      : Math.round((mostExpensive.meta.outputPrice - cheapestModel.meta.outputPrice) * 10)
    : 0
  const monthlyLabel = isMediaMode ? '1K generations' : '10M tokens'

  const userChoseCheaper = typeof vote2 === 'number' && vote2 === cheapestIdx
  const savingsEmoji = vote2 === 'T' ? '⚖' : userChoseCheaper ? '🎉' : '😂'

  const voteLabel = (v: Vote) => v === 'T' ? 'a Tie' : v !== null ? `Model ${LABELS[v as number]}` : ''

  return (
    <>
      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{position:'fixed',inset:0,zIndex:99999,background:'rgba(0,0,0,0.92)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer'}}>
          <img src={lightbox} alt="Full size" onClick={() => setLightbox(null)} style={{maxWidth:'90vw',maxHeight:'90vh',borderRadius:8,boxShadow:'0 0 80px rgba(0,0,0,0.8)',cursor:'pointer'}} />
          <div onClick={e => e.stopPropagation()} style={{position:'fixed',top:20,right:24,zIndex:100000,display:'flex',gap:10}}>
            <a href={lightbox} download target="_blank" rel="noreferrer" title="Download"
              style={{display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(255,255,255,0.15)',border:'1px solid rgba(255,255,255,0.3)',borderRadius:8,width:36,height:36,color:'#fff',fontSize:16,textDecoration:'none',cursor:'pointer',boxShadow:'0 2px 12px rgba(0,0,0,0.4)'}}
            >↓</a>
            <button onClick={() => setLightbox(null)} title="Close"
              style={{display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(255,255,255,0.15)',border:'1px solid rgba(255,255,255,0.3)',borderRadius:8,width:36,height:36,color:'#fff',fontSize:16,cursor:'pointer',boxShadow:'0 2px 12px rgba(0,0,0,0.4)'}}
            >✕</button>
          </div>
        </div>
      )}
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
                  placeholder={
                    mode === 'image' ? "Describe an image... e.g. 'A cinematic photo of a red panda in a snowy forest at dusk'" :
                    mode === 'video' ? "Describe a video... e.g. 'A timelapse of a thunderstorm rolling over a mountain range'" :
                    "Ask anything... e.g. 'Explain quantum entanglement in simple terms'"
                  }
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      if (prompt.trim().length >= 3) startDuel()
                    }
                  }}
                />
                <div className="prompt-actions">
                  <AttachmentButton attachment={attachment} onChange={setAttachment} context="xduel" />
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
                    : <span>You picked <strong style={{color:'var(--white)'}}>{voteLabel(vote1)}</strong> — vote again knowing the price</span>}
                </div>
              </div>

              {/* Error state */}
              {apiError && (
                <div style={{background:'rgba(232,69,60,0.1)',border:'1px solid rgba(232,69,60,0.4)',borderRadius:6,padding:'16px 20px',marginBottom:24,fontFamily:'var(--mono)',fontSize:13,color:'var(--red)'}}>
                  ⚠️ {apiError}
                  <button className="btn-secondary" style={{marginLeft:16}} onClick={() => goStep(1)}>← Try again</button>
                </div>
              )}

              {/* Battle cards — responsive grid */}
              <div className="battle-arena" style={{
                gridTemplateColumns: `repeat(${models.length || count}, 1fr)`
              }}>
                {(loading ? Array(count).fill(null) : models).map((m: ModelState | null, i: number) => {
                  const isVoted   = currentVote === i
                  const isOther   = currentVote !== null && currentVote !== 'T' && currentVote !== i
                  const cheapest  = i === cheapestIdx
                  const cardColor    = i === 0 ? '#4a9eff' : i === 1 ? 'var(--red)' : i === 2 ? '#a78bfa' : '#34d399'
                  const cardColorHex = i === 0 ? '#4a9eff' : i === 1 ? '#e8453c' : i === 2 ? '#a78bfa' : '#34d399'
                  return (
                    <div key={i}
                      className={`battle-card ${isVoted?'voted-this':''} ${isOther?'voted-other':''}`}
                      onMouseEnter={() => setCursor(cardColorHex)}
                      onMouseLeave={() => setCursor('#e8453c')}
                    >
                      <div className={`battle-card-header ${mode==='image'?'image-mode':''}`}>
                        <div className="battle-model-id" style={{color: cardColor}}>Model {LABELS[i]}</div>
                        <div style={{display:'flex',alignItems:'center',gap:10}}>
                          {m?.done && bothDone && (
                            <span style={{fontFamily:'var(--mono)',fontSize:11,color:'var(--muted2)',opacity:1,transition:'opacity 0.3s'}}>
                              ⏱ {(m.responseTime/1000).toFixed(2)}s
                              {(() => {
                                const maxTime = Math.max(...models.map(x => x.responseTime))
                                if (m.responseTime < maxTime) {
                                  const pct = Math.round((maxTime - m.responseTime) / maxTime * 100)
                                  return <span style={{marginLeft:4,fontSize:9,color:cardColor}}>⚡ {pct}% faster</span>
                                }
                                return null
                              })()}
                            </span>
                          )}
                        </div>
                      </div>
                      {showPrices && m && (
                        <div style={{
                          padding:'8px 16px',
                          background: cheapest ? 'rgba(0,200,150,0.08)' : 'rgba(232,69,60,0.08)',
                          borderBottom:'1px solid var(--border)',
                          fontFamily:'var(--font-mono)',
                          fontSize:13,
                          fontWeight:700,
                          color: cheapest ? '#34d399' : 'var(--red)',
                          textAlign:'center',
                          transition:'opacity 0.5s',
                        }}>
                          {m.meta.priceLabel}
                          {cheapest && models.length > 1 && <span style={{marginLeft:8,fontSize:10,fontWeight:500,opacity:0.7}}>💰 cheapest</span>}
                        </div>
                      )}
                      <div className={`battle-response ${loading||!m?'loading':''} ${(mode==='image'||mode==='video')?'image-response':''}`}>
                        {loading || !m
                          ? <><div className="loading-dot"/><div className="loading-dot"/><div className="loading-dot"/></>
                          : m.isVideo
                          ? <video src={m.text} autoPlay loop muted playsInline controls style={{width:'100%',display:'block'}} />
                          : m.isImage
                          ? <img src={m.text} alt="Generated" onClick={() => setLightbox(m.text)} style={{width:'100%',borderRadius:4,display:'block',cursor:'zoom-in'}} />
                          : <><div className="markdown-body"><ReactMarkdown components={{a: ({href, children}) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>}}>{m.text}</ReactMarkdown></div>{m.streaming && <span className="stream-cursor">▋</span>}</>
                        }
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Stats row — response time + cost, one column per model */}
              {bothDone && (
                <div className="stats-row" style={{gridTemplateColumns:`repeat(${models.length},1fr)`}}>
                  {models.map((m, i) => {
                    const cheapest  = i === cheapestIdx
                    const cardColor = i === 0 ? '#4a9eff' : i === 1 ? 'var(--red)' : i === 2 ? '#a78bfa' : '#34d399'
                    const maxTime   = Math.max(...models.map(x => x.responseTime))
                    const pct       = m.responseTime < maxTime ? Math.round((maxTime - m.responseTime) / maxTime * 100) : null
                    return (
                      <div key={i} className="stats-cell">
                        <div className="stats-line">
                          <span className="stats-label">Response Time</span>
                          <span className="stats-value" style={{color: cardColor}}>
                            {(m.responseTime / 1000).toFixed(2)}s
                            {pct !== null && (
                              <span style={{marginLeft:6,fontSize:9,letterSpacing:'0.1em',color:cardColor}}>⚡ {pct}% faster</span>
                            )}
                          </span>
                        </div>
                        {showPrices && (
                          <div className="stats-line" style={{animation:'slideDown 0.35s ease forwards'}}>
                            <span className="stats-label">Estimated Cost</span>
                            <span className="stats-value" style={{display:'flex',alignItems:'center',gap:8}}>
                              <span style={{color: cheapest ? '#34d399' : 'var(--muted2)'}}>
                                {formatCost(m.cost, m.isImage, m.isVideo)}
                              </span>
                              {cheapest && mostExpensive && cheapestModel && mostExpensive.meta.outputPrice > cheapestModel.meta.outputPrice && (
                                <span style={{fontSize:9,color:'#34d399',letterSpacing:'0.1em'}}>
                                  💰 {Math.round((mostExpensive.meta.outputPrice - cheapestModel.meta.outputPrice) / mostExpensive.meta.outputPrice * 100)}% saving
                                </span>
                              )}
                            </span>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Vote row — A | ... | Tie | ... | B */}
              <div className="vote-row">
                {(() => {
                  const total = models.length || count
                  const half = Math.ceil(total / 2)
                  const allLabels = LABELS.slice(0, total)
                  const left = allLabels.slice(0, half)
                  const right = allLabels.slice(half)
                  const cardColorHex2 = (i: number) => i === 0 ? '#4a9eff' : i === 1 ? '#e8453c' : i === 2 ? '#a78bfa' : '#34d399'
                  const makeBtn = (label: string, i: number) => {
                    const cardColor = i === 0 ? '#4a9eff' : i === 1 ? 'var(--red)' : i === 2 ? '#a78bfa' : '#34d399'
                    const voted = currentVote === i
                    return (
                      <button
                        key={i}
                        className={`btn-vote ${voted ? 'voted' : ''}`}
                        style={voted
                          ? {borderColor: cardColor, color: cardColor, background: `${cardColor}18`}
                          : {'--hover-color': cardColor} as React.CSSProperties}
                        onClick={() => phase==='vote' ? castVote(i) : castRevote(i)}
                        disabled={!bothDone || currentVote !== null}
                        onMouseEnter={() => setCursor(cardColorHex2(i))}
                        onMouseLeave={() => setCursor('#e8453c')}
                      >
                        {voted ? `✓ Picked ${label}` : `${label} is better`}
                      </button>
                    )
                  }
                  return <>
                    {left.map((label, i) => makeBtn(label, i))}
                    <button
                      className={`btn-tie ${currentVote==='T'?'voted':''}`}
                      onClick={() => phase==='vote' ? castVote('T') : castRevote('T')}
                      disabled={!bothDone || currentVote !== null}
                      onMouseEnter={() => setCursor('#888888')}
                      onMouseLeave={() => setCursor('#e8453c')}
                    >
                  {currentVote==='T' ? '✓ Tied' : '⚖ Tie'}
                    </button>
                    {right.map((label, i) => makeBtn(label, half + i))}
                  </>
                })()}
              </div>

              <div className="action-bar">
                <span className="action-hint">
                  {loading
                    ? 'Connecting…'
                    : anyStreaming
                    ? 'Models are responding…'
                    : phase==='vote'
                    ? 'Pick the response you prefer — identities are hidden'
                    : 'Now you know the cost — cast your final vote'}
                </span>
                {phase==='vote' && bothDone && (
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

              <div style={{
                opacity: showReveal ? 1 : 0,
                transform: showReveal ? 'translateY(0)' : 'translateY(16px)',
                transition: 'opacity 0.5s ease, transform 0.5s ease',
              }}>
                <div className="model-reveal" style={{gridTemplateColumns:`repeat(${models.length},1fr)`}}>
                  {models.map((m, i) => {
                    const wins = i === cheapestIdx
                    return (
                      <div key={i} className={`reveal-card ${wins?'winner':''} ${i<models.length-1?'border-right':''}`}>
                        <div style={{fontFamily:'var(--mono)',fontSize:10,color:'var(--muted2)',marginBottom:4}}>
                          MODEL {LABELS[i]}
                        </div>
                        <div className="reveal-model-name">{m.meta.name}</div>
                        <div className="reveal-provider">{m.meta.provider.toUpperCase()}</div>
                        <div className="reveal-price" style={{color:wins?'#34d399':'var(--red)'}}>
                          {m.meta.priceLabel}
                        </div>
                        <div style={{fontFamily:'var(--mono)',fontSize:11,color:'var(--muted2)',marginTop:4}}>
                          {(() => {
                            const maxTime = Math.max(...models.map(x => x.responseTime))
                            const pct = m.responseTime < maxTime ? Math.round((maxTime - m.responseTime) / maxTime * 100) : null
                            return <>
                              <span style={{color:'var(--white)'}}>⏱ {(m.responseTime/1000).toFixed(2)}s</span>
                              {pct !== null && <span style={{marginLeft:6,color:'#4a9eff'}}>⚡ {pct}% faster</span>}
                            </>
                          })()}
                        </div>
                        <div className="reveal-stat" style={{color:wins?'#34d399':'var(--muted2)'}}>
                          {wins
                            ? `${savingsEmoji} ${ratio}× cheaper — saves $${monthly.toLocaleString()}/mo at ${monthlyLabel}`
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
                <button className="btn-next" onClick={() => { clearState(true); goStep(1) }}>Next Duel →</button>
              </div>
            </div>
          )}

        </div>
      </div>
    </>
  )
}
