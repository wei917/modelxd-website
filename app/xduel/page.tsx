'use client'

import { useEffect, useRef, useState } from 'react'
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
  // When a slot errors out, we carry the message here so the render path
  // can show a proper error block instead of stuffing it into <video src>
  // or <img src>, which the browser silently treats as a broken asset.
  errorMessage: string | null
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
  const [attachments, setAttachments] = useState<Attachment[]>([])

  const bothDone    = models.length > 0 && models.every(m => m.done)
  const anyStreaming = models.some(m => m.streaming)

  // Cheapest model index — use actual generation cost if available, otherwise list price
  const cheapestIdx = models.length > 0 && models.every(m => m.done)
    ? models.reduce((minI, m, i, arr) => {
        const mCost = m.cost > 0 ? m.cost : m.meta.outputPrice
        const minCost = arr[minI].cost > 0 ? arr[minI].cost : arr[minI].meta.outputPrice
        return mCost < minCost ? i : minI
      }, 0)
    : models.length > 0
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
        body: JSON.stringify({ prompt, mode, count, attachment: attachments[0] ? { storagePath: attachments[0].storagePath, bucket: attachments[0].bucket, mediaType: attachments[0].mediaType, fileName: attachments[0].fileName, fileSize: attachments[0].fileSize } : null }),
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
                  errorMessage: null,
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
                  i === idx ? {
                    ...m,
                    text: payload.text != null ? (payload.isImage || payload.isVideo ? payload.text : m.text + payload.text) : m.text,
                    isImage: payload.isImage ?? m.isImage,
                    isVideo: payload.isVideo ?? m.isVideo,
                  } : m
                ))

              } else if (currentEvent.startsWith('done:')) {
                const idx = payload.index
                setModels(prev => prev.map((m, i) => {
                  if (i !== idx) return m
                  const realCost = payload.cost != null ? Number(payload.cost) : m.isImage ? m.meta.outputPrice : (payload.tokens / 1_000_000) * m.meta.outputPrice
                  // Update priceLabel to reflect actual cost
                  const realPriceLabel = m.isImage
                    ? `$${parseFloat(realCost.toFixed(4))} / image`
                    : m.isVideo
                    ? `$${parseFloat(realCost.toFixed(4))} / video`
                    : m.meta.priceLabel
                  // Image/video models that are token-billed (e.g. gpt-image-2)
                  // have a headline outputPrice of 0 because calcImageCost
                  // can't compute without a usage block. Once the real cost
                  // comes back from the API, fold it back into meta.outputPrice
                  // so the reveal-page savings math (cheapest vs most expensive)
                  // has the actual numbers to work with. For text models, keep
                  // outputPrice as the per-1M-token rate from the catalog.
                  const realOutputPrice = (m.isImage || m.isVideo) && realCost > 0
                    ? realCost
                    : m.meta.outputPrice
                  return {
                    ...m,
                    tokens:       payload.tokens,
                    responseTime: payload.responseTime,
                    cost:         realCost,
                    meta:         { ...m.meta, priceLabel: realPriceLabel, outputPrice: realOutputPrice },
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
                  i === idx
                    ? {
                        ...m,
                        // Clear text/isImage/isVideo so the render path
                        // doesn't try to stuff the error string into a
                        // <video src>/<img src> attribute. We carry the
                        // message in a dedicated errorMessage slot.
                        text: '',
                        isImage: false,
                        isVideo: false,
                        errorMessage: payload.message || 'Unknown error',
                        streaming: false,
                        done: true,
                      }
                    : m
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
    if (!keepPrompt) { setPrompt(''); setAttachments([]) }
  }

  const approxTokens = Math.round(prompt.length / 3)

  // Cheapest model for savings calc
  const cheapestModel = cheapestIdx >= 0 ? models[cheapestIdx] : null
  const mostExpensive = models.length > 0
    ? models.reduce((maxM, m) => m.meta.outputPrice > maxM.meta.outputPrice ? m : maxM, models[0])
    : null
  // Ratio shown as e.g. "1.4× cheaper" or "2× cheaper". Math.round() collapsed
  // anything between 1.0 and 1.5 into "1× cheaper" which read as "no
  // difference" — keep one decimal until we cross 10×, then drop it.
  const rawRatio = cheapestModel && mostExpensive && cheapestModel.meta.outputPrice > 0
    ? mostExpensive.meta.outputPrice / cheapestModel.meta.outputPrice
    : 0
  const ratio = rawRatio >= 10
    ? Math.round(rawRatio).toString()
    : rawRatio > 0
      ? (Math.round(rawRatio * 10) / 10).toString()
      : '0'
  // text:  savings per 10M tokens
  // image/video: savings per 1000 generations
  const isMediaMode = mode === 'image' || mode === 'video'
  // Image / video models are billed per generation in fractional dollars
  // (e.g. $0.04). Math.round() on a $14.10 figure was fine, but the previous
  // version used Math.round on $0.04, which floored to $0. Switch to two-
  // decimal precision and let toLocaleString format it.
  const monthlyRaw = cheapestModel && mostExpensive
    ? isMediaMode
      ? (mostExpensive.meta.outputPrice - cheapestModel.meta.outputPrice) * 1000
      : (mostExpensive.meta.outputPrice - cheapestModel.meta.outputPrice) * 10
    : 0
  const monthly = isMediaMode
    ? Math.round(monthlyRaw * 100) / 100   // keep cents, e.g. $14.10
    : Math.round(monthlyRaw)               // text: integer dollars at 10M tokens
  const monthlyLabel = isMediaMode ? '1K generations' : '10M tokens'

  const userChoseCheaper = typeof vote2 === 'number' && vote2 === cheapestIdx
  const savingsEmoji = vote2 === 'T' ? '⚖' : userChoseCheaper ? '🎉' : '😂'

  const voteLabel = (v: Vote) => v === 'T' ? 'a Tie' : v !== null ? `Model ${LABELS[v as number]}` : ''

  return (
    <>
      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{position:'fixed',inset:0,zIndex:99000,background:'rgba(0,0,0,0.92)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer'}}>
          <img src={lightbox} alt="Full size" onClick={() => setLightbox(null)} style={{maxWidth:'90vw',maxHeight:'90vh',borderRadius:8,boxShadow:'0 0 80px rgba(0,0,0,0.8)',cursor:'pointer'}} />
          <div onClick={e => e.stopPropagation()} style={{position:'fixed',top:20,right:24,zIndex:99100,display:'flex',gap:10}}>
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

      <div className="xduel-page">
        <div className="arena">

          {/* ── Page header — always top of arena ── */}
          <div className="prompt-header">
            <div className="prompt-label">XDuel</div>
            <h1 className="prompt-title">
              {step === 1 ? <>Start the <span>XDuel</span></> :
               step === 5 ? <>The <span>Reveal</span></> :
               phase === 'vote' ? <>Vote <span>Blind</span></> :
               <>Vote <span>Again</span></>}
            </h1>
            <div className="prompt-sub">
              {step === 1 ? "Create a task for two anonymous models. You vote the result you like and we will reveal the best model for you." :
               step === 5 ? null :
               phase === 'vote'
                ? `"${prompt.substring(0,80)}${prompt.length>80?'…':''}"`
                : <span>You picked <strong style={{color:'var(--white)'}}>{voteLabel(vote1)}</strong> — now you know the price. Does it change your mind?</span>}
            </div>
          </div>

          {/* Step progress bar */}
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

          {/* ── STEP 1 ── */}
          {step === 1 && (
            <div className="step-section">
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
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault()
                      if (prompt.trim().length >= 3) startDuel()
                    }
                  }}
                />
                <div className="prompt-actions">
                  <AttachmentButton attachments={attachments} onChange={setAttachments} context="xduel" />
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
                          {!cheapest && models.length > 1 && <span style={{marginLeft:8,fontSize:10,fontWeight:500,opacity:0.7}}>💸 more expensive</span>}
                        </div>
                      )}
                      <div className={`battle-response ${loading||!m?'loading':''} ${(mode==='image'||mode==='video')?'image-response':''}`}>
                        {loading || !m
                          ? <><div className="loading-dot"/><div className="loading-dot"/><div className="loading-dot"/></>
                          : m?.errorMessage
                          ? <div style={{
                              display:'flex',
                              flexDirection:'column',
                              alignItems:'center',
                              justifyContent:'center',
                              padding:'40px 24px',
                              gap:12,
                              color:'var(--red)',
                              textAlign:'center',
                            }}>
                              <div style={{fontSize:28,lineHeight:1}}>⚠️</div>
                              <div style={{fontFamily:'var(--font-mono)',fontSize:12,fontWeight:700,letterSpacing:1,textTransform:'uppercase',opacity:0.8}}>Generation failed</div>
                              <div style={{fontSize:13,lineHeight:1.5,maxWidth:460,color:'var(--muted)',wordBreak:'break-word'}}>{m.errorMessage}</div>
                            </div>
                          : m.isVideo && m.text
                          ? <video src={m.text} autoPlay loop muted playsInline controls style={{width:'100%',display:'block'}} />
                          : m.isImage && m.text
                          ? <img src={m.text} alt="Generated" onClick={() => setLightbox(m.text)} style={{width:'100%',borderRadius:4,display:'block',cursor:'zoom-in'}} />
                          : (m.isImage || m.isVideo) && !m.text
                          ? <div style={{display:'flex',alignItems:'center',justifyContent:'center',padding:'60px 20px',color:'var(--muted2)',fontSize:13,gap:8}}>
                              <div className="loading-dot"/><div className="loading-dot"/><div className="loading-dot"/>
                              <span style={{marginLeft:8}}>Generating{m.isImage ? ' image' : ' video'}…</span>
                            </div>
                          : <><div className="markdown-body"><ReactMarkdown skipHtml components={{a: ({href, children}) => { if (!href || (!href.startsWith('http://') && !href.startsWith('https://'))) return <span>{children}</span>; return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}}>{m.text}</ReactMarkdown></div>{m.streaming && <span className="stream-cursor">▋</span>}</>
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
                            <span className="stats-label">Price</span>
                            <span className="stats-value" style={{display:'flex',alignItems:'center',gap:8}}>
                              <span style={{color: cheapest ? '#34d399' : 'var(--muted2)'}}>
                                {m.meta.priceLabel}
                              </span>
                              {cheapest && models.length > 1 && (() => {
                                const otherCosts = models.filter((_, j) => j !== i).map(o => o.cost > 0 ? o.cost : o.meta.outputPrice)
                                const myCost = m.cost > 0 ? m.cost : m.meta.outputPrice
                                const maxOther = Math.max(...otherCosts)
                                if (maxOther > myCost && maxOther > 0) {
                                  const savingPct = Math.round((maxOther - myCost) / maxOther * 100)
                                  return <span style={{fontSize:9,color:'#34d399',letterSpacing:'0.1em'}}>💰 {savingPct}% cheaper</span>
                                }
                                return null
                              })()}
                              {!cheapest && models.length > 1 && (() => {
                                const cheapestCost = cheapestModel ? (cheapestModel.cost > 0 ? cheapestModel.cost : cheapestModel.meta.outputPrice) : 0
                                const myCost = m.cost > 0 ? m.cost : m.meta.outputPrice
                                if (myCost > cheapestCost && myCost > 0) {
                                  const morePct = Math.round((myCost - cheapestCost) / myCost * 100)
                                  return <span style={{fontSize:9,color:'var(--red)',letterSpacing:'0.1em'}}>{morePct}% more expensive</span>
                                }
                                return null
                              })()}
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
                            ? (monthly > 0
                                ? `${savingsEmoji} ${ratio}× cheaper — saves $${monthly.toLocaleString()}/mo at ${monthlyLabel}`
                                : '⚖ Same price as the other')
                            : (monthly > 0 ? 'More expensive option' : 'Same price')}
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
