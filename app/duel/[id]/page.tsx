'use client'
// app/duel/[id]/page.tsx
// Mirrors XDuel flow: Step 2 (blind vote) → Step 4 (price reveal + revote) → Step 5 (model reveal)
// Step 1 (prompt) is skipped — duel already exists

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
const createSupabaseBrowser = () => createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)
import ReactMarkdown from 'react-markdown'

type VoteChoice = number | 'T' | null

interface SlotData {
  id: string
  name: string
  provider: string
  priceLabel: string
  outputPrice: number
  text: string
  isImage: boolean
  isVideo: boolean
  responseTime: number
  cost: number
}

interface Duel {
  id: string
  mode: string
  prompt: string
  slots: SlotData[]
  vote1: string | null
  vote2: string | null
  user_id: string
  created_at: string
}

const STEPS = [
  { n:1, label:'Task' },
  { n:2, label:'Vote' },
  { n:3, label:'Reveal Price' },
  { n:4, label:'Vote Again' },
  { n:5, label:'Meet the Model' },
]

const LABELS = ['A', 'B', 'C', 'D']

export default function DuelPage() {
  const { id } = useParams<{ id: string }>()
  const router  = useRouter()

  const cursorRef = useRef<HTMLDivElement>(null)
  const ringRef   = useRef<HTMLDivElement>(null)
  const setCursor = (color: string) => {
    if (cursorRef.current) cursorRef.current.style.background = color
    if (ringRef.current)   ringRef.current.style.borderColor  = color + '66'
  }

  const [step,        setStep]        = useState(2)
  const [duel,        setDuel]        = useState<Duel | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [notFound,    setNotFound]    = useState(false)
  const [userId,      setUserId]      = useState<string | null>(null)
  const [vote1,       setVote1]       = useState<VoteChoice>(null)
  const [vote2,       setVote2]       = useState<VoteChoice>(null)
  const [showPrices,  setShowPrices]  = useState(false)
  const [showReveal,  setShowReveal]  = useState(false)
  const [alreadyVoted, setAlreadyVoted] = useState(false)
  const [lightbox,    setLightbox]    = useState<string | null>(null)

  // Cursor tracking with ring lag
  useEffect(() => {
    let mx = 0, my = 0, rx = 0, ry = 0, rafId: number
    const move = (e: MouseEvent) => {
      mx = e.clientX; my = e.clientY
      if (cursorRef.current) { cursorRef.current.style.left = mx+'px'; cursorRef.current.style.top = my+'px' }
    }
    const tick = () => {
      rx += (mx-rx)*0.12; ry += (my-ry)*0.12
      if (ringRef.current) { ringRef.current.style.left = rx+'px'; ringRef.current.style.top = ry+'px' }
      rafId = requestAnimationFrame(tick)
    }
    document.addEventListener('mousemove', move)
    rafId = requestAnimationFrame(tick)
    return () => { document.removeEventListener('mousemove', move); cancelAnimationFrame(rafId) }
  }, [])

  useEffect(() => {
    const sb = createSupabaseBrowser()
    sb.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null))
  }, [])

  useEffect(() => {
    if (!id) return
    const sb = createSupabaseBrowser()
    sb.from('duels').select('*').eq('id', id).single()
      .then(({ data, error }) => {
        if (error || !data) { setNotFound(true); setLoading(false); return }
        setDuel(data)
        setLoading(false)
        const votedKey = `voted_duels_${data.user_id ?? 'anon'}`
        const voted = JSON.parse(localStorage.getItem(votedKey) ?? '[]') as string[]
        if (voted.includes(id)) {
          setAlreadyVoted(true)
          setShowPrices(true)
          setShowReveal(true)
          setStep(5)
        }
      })
  }, [id])

  const goStep = (n: number) => { setStep(n); window.scrollTo({ top: 0, behavior: 'smooth' }) }

  const castVote1 = (choice: VoteChoice) => {
    setVote1(choice)
    fetch('/api/duel/vote', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        duelId: duel!.id,
        vote1: choice === 'T' ? 'T' : String(choice),
        vote1ModelId: typeof choice === 'number' ? duel!.slots[choice]?.id ?? null : null,
      }),
    }).catch(console.error)
    setTimeout(() => { setShowPrices(true); goStep(4) }, 500)
  }

  const castVote2 = async (choice: VoteChoice) => {
    setVote2(choice)
    await fetch('/api/duel/vote', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        duelId: duel!.id,
        vote2: choice === 'T' ? 'T' : String(choice),
        vote2ModelId: typeof choice === 'number' ? duel!.slots[choice]?.id ?? null : null,
      }),
    }).catch(console.error)
    // Mark voted
    const votedKey = `voted_duels_${userId ?? 'anon'}`
    const voted = JSON.parse(localStorage.getItem(votedKey) ?? '[]') as string[]
    if (!voted.includes(duel!.id)) localStorage.setItem(votedKey, JSON.stringify([...voted, duel!.id]))
    setTimeout(() => { goStep(5); setTimeout(() => setShowReveal(true), 600) }, 600)
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <div style={{ textAlign: 'center', color: 'var(--muted)', paddingTop: 160 }}>Loading duel…</div>
    </div>
  )

  if (notFound || !duel) return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <div style={{ textAlign: 'center', color: 'var(--muted)', paddingTop: 160 }}>Duel not found.</div>
    </div>
  )

  const slots = duel.slots.filter(Boolean)
  const cheapestIdx = slots.reduce((minI, s, i, arr) =>
    (s.outputPrice ?? 0) < (arr[minI].outputPrice ?? 0) ? i : minI, 0)
  const cheapestModel = slots[cheapestIdx]
  const mostExpensive = slots.reduce((maxS, s) => (s.outputPrice ?? 0) > (maxS.outputPrice ?? 0) ? s : maxS, slots[0])
  const ratio   = cheapestModel && mostExpensive && cheapestModel.outputPrice > 0
    ? Math.round(mostExpensive.outputPrice / cheapestModel.outputPrice) : 0
  const isMediaMode = duel.mode === 'image' || duel.mode === 'video'
  const monthly = cheapestModel && mostExpensive
    ? isMediaMode
      ? Math.round((mostExpensive.outputPrice - cheapestModel.outputPrice) * 1000)
      : Math.round((mostExpensive.outputPrice - cheapestModel.outputPrice) * 10)
    : 0
  const monthlyLabel = isMediaMode ? '1K generations' : '10M tokens'
  const userChoseCheaper = typeof vote2 === 'number' && vote2 === cheapestIdx
  const savingsEmoji = vote2 === 'T' ? '⚖' : userChoseCheaper ? '🎉' : '😂'
  const voteLabel = (v: VoteChoice) => v === 'T' ? 'a Tie' : v !== null ? `Model ${LABELS[v as number]}` : ''
  const currentVote = step === 2 ? vote1 : vote2
  const cardColorHex = (i: number) => i === 0 ? '#4a9eff' : i === 1 ? '#e8453c' : i === 2 ? '#a78bfa' : '#34d399'
  const cardColor    = (i: number) => i === 0 ? '#4a9eff' : i === 1 ? 'var(--red)' : i === 2 ? '#a78bfa' : '#34d399'

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

      <div className="xduel-page">

        {/* Step bar */}
        <div className="step-bar">
          {STEPS.map((s, i) => (
            <span key={s.n} style={{display:'contents'}}>
              <div className={`step-item ${step===s.n?'active':''} ${step>s.n?'done':''} ${s.n===1?'disabled':''}`}
                style={s.n===1?{opacity:0.3,pointerEvents:'none'}:{}}>
                <div className="step-num">{s.n}</div>{s.label}
              </div>
              {i < STEPS.length-1 && <div className={`step-connector ${step>s.n?'done':''}`} />}
            </span>
          ))}
        </div>

        <div className="arena">

          {/* ── Prompt header (shared) ── */}
          <div className="prompt-header" style={{marginBottom:24}}>
            <ModeBadge mode={duel.mode} />
            <h1 className="prompt-title" style={{marginTop:8}}>
              {step === 2 ? <>Which is <span>Better?</span></> :
               step === 4 ? <>Now You Know the <span>Cost</span></> :
               <>The <span>Reveal</span></>}
            </h1>
            <div className="prompt-sub" style={{marginTop:6}}>
              {step === 2
                ? `"${duel.prompt.substring(0,100)}${duel.prompt.length>100?'…':''}"`
                : step === 4
                ? <span>You picked <strong style={{color:'var(--white)'}}>{voteLabel(vote1)}</strong> — vote again knowing the price</span>
                : <span style={{color:'#555',fontSize:13}}>{duel.prompt.substring(0,120)}{duel.prompt.length>120?'…':''}</span>
              }
            </div>
          </div>

          {/* ── STEPS 2 & 4: Battle cards ── */}
          {(step === 2 || step === 4) && (
            <>
              <div className="battle-arena" style={{gridTemplateColumns:`repeat(${slots.length}, 1fr)`}}>
                {slots.map((slot, i) => {
                  const isVoted = currentVote === i
                  const isOther = currentVote !== null && currentVote !== 'T' && currentVote !== i
                  const cheapest = i === cheapestIdx
                  return (
                    <div key={i}
                      className={`battle-card ${isVoted?'voted-this':''} ${isOther?'voted-other':''}`}
                      onMouseEnter={() => setCursor(cardColorHex(i))}
                      onMouseLeave={() => setCursor('#e8453c')}
                    >
                      <div className={`battle-card-header ${duel.mode==='image'?'image-mode':''}`}>
                        <div className="battle-model-id" style={{color: cardColor(i)}}>Model {LABELS[i]}</div>
                        <div style={{display:'flex',alignItems:'center',gap:10}}>
                          <span style={{fontFamily:'var(--mono)',fontSize:11,color:'var(--muted2)'}}>
                            ⏱ {(slot.responseTime/1000).toFixed(2)}s
                          </span>
                          <div style={{opacity:showPrices?1:0,transition:'opacity 0.5s'}}>
                            <span className="price-badge" style={{color: cheapest ? '#34d399' : 'var(--red)'}}>
                              {slot.priceLabel}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className={`battle-response ${(duel.mode==='image'||duel.mode==='video')?'image-response':''}`}>
                        {slot.isVideo
                          ? <video src={slot.text} autoPlay loop muted playsInline controls style={{width:'100%',display:'block'}} />
                          : slot.isImage
                          ? <img src={slot.text} alt="Generated" onClick={() => setLightbox(slot.text)} style={{width:'100%',borderRadius:4,display:'block',cursor:'zoom-in'}} />
                          : <div className="markdown-body"><ReactMarkdown components={{a: ({href, children}) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>}}>{slot.text}</ReactMarkdown></div>
                        }
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Stats row */}
              {showPrices && (
                <div className="stats-row" style={{gridTemplateColumns:`repeat(${slots.length},1fr)`}}>
                  {slots.map((slot, i) => {
                    const cheapest  = i === cheapestIdx
                    const maxTime   = Math.max(...slots.map(s => s.responseTime))
                    const pct       = slot.responseTime < maxTime ? Math.round((maxTime - slot.responseTime) / maxTime * 100) : null
                    return (
                      <div key={i} className="stats-cell">
                        <div className="stats-line">
                          <span className="stats-label">Response Time</span>
                          <span className="stats-value" style={{color: cardColor(i)}}>
                            {(slot.responseTime/1000).toFixed(2)}s
                            {pct !== null && <span style={{marginLeft:6,fontSize:9,color:cardColor(i)}}>⚡ {pct}% faster</span>}
                          </span>
                        </div>
                        <div className="stats-line" style={{animation:'slideDown 0.35s ease forwards'}}>
                          <span className="stats-label">Estimated Cost</span>
                          <span className="stats-value" style={{display:'flex',alignItems:'center',gap:8}}>
                            <span style={{color: cheapest ? '#34d399' : 'var(--muted2)'}}>
                              {slot.cost < 0.0001 ? slot.cost.toExponential(2) : '$' + slot.cost.toFixed(5)}
                            </span>
                            {cheapest && mostExpensive && cheapestModel && mostExpensive.outputPrice > cheapestModel.outputPrice && (
                              <span style={{fontSize:9,color:'#34d399',letterSpacing:'0.1em'}}>
                                💰 {Math.round((mostExpensive.outputPrice - cheapestModel.outputPrice) / mostExpensive.outputPrice * 100)}% saving
                              </span>
                            )}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Vote row */}
              {!alreadyVoted && (
                <div className="vote-row">
                  {(() => {
                    const total = slots.length
                    const half  = Math.ceil(total / 2)
                    const allLabels = LABELS.slice(0, total)
                    const left  = allLabels.slice(0, half)
                    const right = allLabels.slice(half)
                    const makeBtn = (label: string, i: number) => {
                      const voted = currentVote === i
                      return (
                        <button key={i}
                          className={`btn-vote ${voted?'voted':''}`}
                          style={voted
                            ? {borderColor: cardColor(i), color: cardColor(i), background: `${cardColorHex(i)}18`}
                            : {'--hover-color': cardColor(i)} as React.CSSProperties}
                          onClick={() => step===2 ? castVote1(i) : castVote2(i)}
                          disabled={currentVote !== null}
                          onMouseEnter={() => setCursor(cardColorHex(i))}
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
                        onClick={() => step===2 ? castVote1('T') : castVote2('T')}
                        disabled={currentVote !== null}
                        onMouseEnter={() => setCursor('#888888')}
                        onMouseLeave={() => setCursor('#e8453c')}
                      >
                        {currentVote==='T' ? '✓ Tied' : '⚖ Tie'}
                      </button>
                      {right.map((label, i) => makeBtn(label, half + i))}
                    </>
                  })()}
                </div>
              )}

              <div className="action-bar">
                <span className="action-hint">
                  {step === 2
                    ? 'Pick the response you prefer — identities are hidden'
                    : 'Now you know the cost — cast your final vote'}
                </span>
                <button className="btn-secondary" onClick={() => router.back()}>← Back</button>
              </div>
            </>
          )}

          {/* ── STEP 5: Reveal ── */}
          {step === 5 && (
            <>
              <div style={{
                opacity: showReveal ? 1 : 0,
                transform: showReveal ? 'translateY(0)' : 'translateY(16px)',
                transition: 'opacity 0.5s ease, transform 0.5s ease',
              }}>
                <div className="model-reveal" style={{gridTemplateColumns:`repeat(${slots.length},1fr)`}}>
                  {slots.map((slot, i) => {
                    const wins = i === cheapestIdx
                    const maxTime = Math.max(...slots.map(s => s.responseTime))
                    const pct = slot.responseTime < maxTime ? Math.round((maxTime - slot.responseTime) / maxTime * 100) : null
                    return (
                      <div key={i} className={`reveal-card ${wins?'winner':''} ${i<slots.length-1?'border-right':''}`}>
                        <div style={{fontFamily:'var(--mono)',fontSize:10,color:'var(--muted2)',marginBottom:4}}>
                          MODEL {LABELS[i]}
                        </div>
                        <div className="reveal-model-name">{slot.name}</div>
                        <div className="reveal-provider">{slot.provider.toUpperCase()}</div>
                        <div className="reveal-price" style={{color:wins?'#34d399':'var(--red)'}}>
                          {slot.priceLabel}
                        </div>
                        <div style={{fontFamily:'var(--mono)',fontSize:11,color:'var(--muted2)',marginTop:4}}>
                          <span style={{color:'var(--white)'}}>⏱ {(slot.responseTime/1000).toFixed(2)}s</span>
                          {pct !== null && <span style={{marginLeft:6,color:'#4a9eff'}}>⚡ {pct}% faster</span>}
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

                {/* Show responses in reveal */}
                <div className="battle-arena" style={{gridTemplateColumns:`repeat(${slots.length}, 1fr)`, marginTop:24}}>
                  {slots.map((slot, i) => (
                    <div key={i} className="battle-card"
                      onMouseEnter={() => setCursor(cardColorHex(i))}
                      onMouseLeave={() => setCursor('#e8453c')}
                    >
                      <div className="battle-card-header">
                        <div className="battle-model-id" style={{color: cardColor(i)}}>
                          {slot.name} <span style={{color:'var(--muted2)',fontWeight:400,fontSize:11}}>· {slot.provider.toUpperCase()}</span>
                        </div>
                      </div>
                      <div className={`battle-response ${(duel.mode==='image'||duel.mode==='video')?'image-response':''}`}>
                        {slot.isVideo
                          ? <video src={slot.text} autoPlay loop muted playsInline controls style={{width:'100%',display:'block'}} />
                          : slot.isImage
                          ? <img src={slot.text} alt="Generated" onClick={() => setLightbox(slot.text)} style={{width:'100%',borderRadius:4,display:'block',cursor:'zoom-in'}} />
                          : <div className="markdown-body"><ReactMarkdown>{slot.text}</ReactMarkdown></div>
                        }
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="action-bar" style={{marginTop:32}}>
                <span className="action-hint">
                  {alreadyVoted
                    ? 'You already voted on this duel.'
                    : userChoseCheaper ? 'Smart call. You saved money without sacrificing quality.'
                    : vote2==='T'     ? 'Interesting. The cheaper model held its own.'
                    :                   'The cheaper model was right there. XD.'}
                </span>
                <button className="btn-secondary" onClick={() => router.back()}>← Back to Feed</button>
              </div>
            </>
          )}

        </div>
      </div>
    </>
  )
}

function ModeBadge({ mode }: { mode: string }) {
  const color = mode === 'video' ? '#34d399' : mode === 'image' ? '#a78bfa' : '#4a9eff'
  return (
    <span style={{
      padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700,
      background: `${color}22`, color, textTransform: 'uppercase', letterSpacing: '0.5px',
    }}>
      {mode}
    </span>
  )
}
