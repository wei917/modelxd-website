'use client'
// app/duel/[id]/page.tsx
// Full duel page — blind vote then reveal, same mechanic as XDuel

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Nav from '../../components/Nav'
import { createSupabaseBrowser } from '@/lib/supabase-client'
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
  created_at: string
}

const LABELS = ['A', 'B', 'C', 'D']
const COLORS = ['#4a9eff', '#e8453c', '#a78bfa', '#34d399']

export default function DuelPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [duel,        setDuel]        = useState<Duel | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [notFound,    setNotFound]    = useState(false)
  const [userId,      setUserId]      = useState<string | null>(null)
  const [vote1,       setVote1]       = useState<VoteChoice>(null)
  const [vote2,       setVote2]       = useState<VoteChoice>(null)
  const [showReveal,  setShowReveal]  = useState(false)
  const [alreadyVoted, setAlreadyVoted] = useState(false)
  const [lightbox,    setLightbox]    = useState<string | null>(null)

  useEffect(() => {
    const sb = createSupabaseBrowser()
    sb.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null))
  }, [])

  useEffect(() => {
    if (!id) return
    const sb = createSupabaseBrowser()
    sb.from('duels')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        if (error || !data) { setNotFound(true); setLoading(false); return }
        setDuel(data)
        setLoading(false)

        // Check if already voted (localStorage)
        const votedKey = `voted_duels_${data.user_id ?? 'anon'}`
        const voted = JSON.parse(localStorage.getItem(votedKey) ?? '[]') as string[]
        if (voted.includes(id)) setAlreadyVoted(true)
      })
  }, [id])

  const castVote1 = (choice: VoteChoice) => {
    setVote1(choice)
    setTimeout(() => setShowReveal(true), 400)
  }

  const castVote2 = async (choice: VoteChoice) => {
    setVote2(choice)
    if (!duel) return

    // Save votes to DB
    const slot = typeof choice === 'number' ? duel.slots[choice] : null
    await fetch('/api/duel/vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        duelId: duel.id,
        vote1: vote1 === 'T' ? 'T' : String(vote1),
        vote2: choice === 'T' ? 'T' : String(choice),
        vote1ModelId: typeof vote1 === 'number' ? duel.slots[vote1]?.id ?? null : null,
        vote2ModelId: slot?.id ?? null,
      }),
    }).catch(console.error)

    // Mark as voted in localStorage
    const votedKey = `voted_duels_${userId ?? 'anon'}`
    const voted = JSON.parse(localStorage.getItem(votedKey) ?? '[]') as string[]
    if (!voted.includes(duel.id)) {
      localStorage.setItem(votedKey, JSON.stringify([...voted, duel.id]))
    }
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#080808' }}>
      <Nav />
      <div style={{ textAlign: 'center', color: '#444', paddingTop: 160 }}>Loading duel…</div>
    </div>
  )

  if (notFound || !duel) return (
    <div style={{ minHeight: '100vh', background: '#080808' }}>
      <Nav />
      <div style={{ textAlign: 'center', color: '#444', paddingTop: 160 }}>Duel not found.</div>
    </div>
  )

  const slots = duel.slots.filter(Boolean)
  const cheapestIdx = slots.reduce((minI, s, i, arr) =>
    (s.outputPrice ?? 0) < (arr[minI].outputPrice ?? 0) ? i : minI, 0)

  return (
    <div style={{ minHeight: '100vh', background: '#080808', color: '#fff' }}>
      <Nav />

      {/* Lightbox */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out' }}
        >
          <img src={lightbox} alt="" style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', borderRadius: 8 }} />
        </div>
      )}

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '100px 24px 60px' }}>

        {/* Header */}
        <div style={{ marginBottom: 32, display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => router.back()}
            style={{ background: 'transparent', border: '1px solid #222', color: '#555', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 13 }}
          >
            ← Back
          </button>
          <ModeBadge mode={duel.mode} />
          <span style={{ color: '#333', fontSize: 13 }}>
            {new Date(duel.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
        </div>

        {/* Prompt */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 11, color: '#444', fontFamily: 'monospace', marginBottom: 8 }}>PROMPT</div>
          <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.4, color: '#fff' }}>{duel.prompt}</div>
        </div>

        {alreadyVoted ? (
          <AlreadyVoted slots={slots} duel={duel} cheapestIdx={cheapestIdx} setLightbox={setLightbox} />
        ) : (
          <>
            {/* Blind vote phase */}
            {!showReveal && (
              <>
                <div style={{ fontSize: 13, color: '#555', marginBottom: 20, textAlign: 'center' }}>
                  Which response is better? Models are hidden — vote blind.
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${slots.length}, 1fr)`, gap: 16, marginBottom: 32 }}>
                  {slots.map((slot, i) => (
                    <ResponseCard
                      key={i}
                      slot={slot}
                      index={i}
                      label={LABELS[i]}
                      color={COLORS[i]}
                      showMeta={false}
                      selected={vote1 === i}
                      onVote={() => castVote1(i)}
                      onLightbox={setLightbox}
                    />
                  ))}
                </div>
                <div style={{ textAlign: 'center' }}>
                  <button
                    onClick={() => castVote1('T')}
                    style={{ background: 'transparent', border: '1px solid #333', color: '#666', borderRadius: 8, padding: '8px 20px', cursor: 'pointer', fontSize: 13 }}
                  >
                    It's a Tie
                  </button>
                </div>
              </>
            )}

            {/* Reveal + revote phase */}
            {showReveal && (
              <>
                <div style={{ fontSize: 13, color: '#555', marginBottom: 8, textAlign: 'center' }}>
                  You voted: <span style={{ color: '#fff' }}>{vote1 === 'T' ? 'Tie' : `Model ${LABELS[vote1 as number]}`}</span>
                  {' · '}Now you know the models — vote again.
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${slots.length}, 1fr)`, gap: 16, marginBottom: 32 }}>
                  {slots.map((slot, i) => (
                    <ResponseCard
                      key={i}
                      slot={slot}
                      index={i}
                      label={LABELS[i]}
                      color={COLORS[i]}
                      showMeta={true}
                      selected={vote2 === i}
                      isCheapest={i === cheapestIdx}
                      onVote={vote2 === null ? () => castVote2(i) : undefined}
                      onLightbox={setLightbox}
                    />
                  ))}
                </div>
                {vote2 === null && (
                  <div style={{ textAlign: 'center' }}>
                    <button
                      onClick={() => castVote2('T')}
                      style={{ background: 'transparent', border: '1px solid #333', color: '#666', borderRadius: 8, padding: '8px 20px', cursor: 'pointer', fontSize: 13 }}
                    >
                      It's a Tie
                    </button>
                  </div>
                )}
                {vote2 !== null && (
                  <div style={{ textAlign: 'center', marginTop: 24 }}>
                    <div style={{ color: '#34d399', fontSize: 16, fontWeight: 700, marginBottom: 16 }}>
                      Vote recorded ✓
                    </div>
                    <button
                      onClick={() => router.back()}
                      style={{ background: '#e8453c', border: 'none', color: '#fff', borderRadius: 8, padding: '10px 24px', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}
                    >
                      Back to Vote Feed
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function ResponseCard({ slot, index, label, color, showMeta, selected, isCheapest, onVote, onLightbox }: {
  slot: SlotData
  index: number
  label: string
  color: string
  showMeta: boolean
  selected?: boolean
  isCheapest?: boolean
  onVote?: () => void
  onLightbox: (src: string) => void
}) {
  return (
    <div style={{
      border: `1px solid ${selected ? color : '#1a1a1a'}`,
      borderRadius: 12,
      overflow: 'hidden',
      background: '#0d0d0d',
      transition: 'border-color 0.2s',
    }}>
      {/* Card header */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #1a1a1a', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 24, height: 24, borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#fff', flexShrink: 0 }}>
          {label}
        </span>
        {showMeta ? (
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{slot.name}</div>
            <div style={{ fontSize: 11, color: '#555' }}>{slot.provider.toUpperCase()} · {slot.priceLabel}</div>
          </div>
        ) : (
          <span style={{ fontSize: 12, color: '#444' }}>Model {label}</span>
        )}
        {isCheapest && showMeta && (
          <span style={{ marginLeft: 'auto', fontSize: 10, color: '#34d399', background: 'rgba(52,211,153,0.1)', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>
            CHEAPEST
          </span>
        )}
      </div>

      {/* Response */}
      <div style={{ minHeight: 200, maxHeight: 480, overflow: 'auto' }}>
        {slot.isVideo ? (
          <video src={slot.text} controls muted loop playsInline style={{ width: '100%', display: 'block' }} />
        ) : slot.isImage ? (
          <img
            src={slot.text} alt="Generated"
            onClick={() => onLightbox(slot.text)}
            style={{ width: '100%', display: 'block', cursor: 'zoom-in' }}
          />
        ) : (
          <div style={{ padding: 16, fontSize: 14, color: '#ccc', lineHeight: 1.7 }}>
            <ReactMarkdown>{slot.text}</ReactMarkdown>
          </div>
        )}
      </div>

      {/* Vote button */}
      {onVote && (
        <div style={{ padding: 12, borderTop: '1px solid #111' }}>
          <button
            onClick={onVote}
            style={{
              width: '100%', padding: '9px 0', borderRadius: 8,
              background: selected ? color : 'transparent',
              border: `1px solid ${selected ? color : '#2a2a2a'}`,
              color: selected ? '#fff' : '#666',
              fontWeight: 700, fontSize: 13, cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {selected ? `✓ Voted ${label}` : `Vote ${label}`}
          </button>
        </div>
      )}
    </div>
  )
}

function AlreadyVoted({ slots, duel, cheapestIdx, setLightbox }: {
  slots: SlotData[]
  duel: Duel
  cheapestIdx: number
  setLightbox: (s: string) => void
}) {
  return (
    <div>
      <div style={{ textAlign: 'center', color: '#555', fontSize: 14, marginBottom: 24 }}>
        You already voted on this duel.
        {duel.vote2 && (
          <span style={{ color: '#e8453c', fontWeight: 600 }}>
            {' '}Your pick: {duel.vote2 === 'T' ? 'Tie' : `Model ${LABELS[parseInt(duel.vote2)]}`}
          </span>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${slots.length}, 1fr)`, gap: 16 }}>
        {slots.map((slot, i) => (
          <ResponseCard
            key={i} slot={slot} index={i}
            label={LABELS[i]} color={COLORS[i]}
            showMeta={true} isCheapest={i === cheapestIdx}
            onLightbox={setLightbox}
          />
        ))}
      </div>
    </div>
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
