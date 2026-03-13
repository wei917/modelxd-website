'use client'
// app/vote/page.tsx
// Netflix-style vote feed: Video row, Image row, Text row
// Hides duels the user already voted on

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '../components/Nav'
import { createBrowserClient } from '@supabase/ssr'
const createSupabaseBrowser = () => createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)

type Mode = 'video' | 'image' | 'text'

interface SlotData {
  id: string
  name: string
  provider: string
  priceLabel: string
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
  vote2: string | null
  created_at: string
}

const MODE_ROWS: { mode: Mode; label: string; emoji: string }[] = [
  { mode: 'video', label: 'Video Duels',  emoji: '🎬' },
  { mode: 'image', label: 'Image Duels',  emoji: '🖼️' },
  { mode: 'text',  label: 'Text Duels',   emoji: '💬' },
]

const CARD_W = 280
const CARD_GAP = 14

export default function VotePage() {
  const router = useRouter()
  const [rows, setRows] = useState<Record<Mode, Duel[]>>({ video: [], image: [], text: [] })
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const cursorRef = useRef<HTMLDivElement>(null)
  const ringRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (cursorRef.current) { cursorRef.current.style.left = e.clientX+'px'; cursorRef.current.style.top = e.clientY+'px' }
      if (ringRef.current)   { ringRef.current.style.left   = e.clientX+'px'; ringRef.current.style.top   = e.clientY+'px' }
    }
    window.addEventListener('mousemove', move)
    return () => window.removeEventListener('mousemove', move)
  }, [])

  useEffect(() => {
    const sb = createSupabaseBrowser()
    sb.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null))
  }, [])

  const loadRow = useCallback(async (mode: Mode, uid: string | null) => {
    const sb = createSupabaseBrowser()

    // Load recent duels for this mode, excluding own duels
    let q = sb
      .from('duels')
      .select('id, mode, prompt, slots, vote2, created_at')
      .eq('mode', mode)
      .order('created_at', { ascending: false })
      .limit(30)

    // Exclude own duels
    if (uid) q = q.neq('user_id', uid)

    const { data, error } = await q
    if (error || !data) return []

    // Filter out duels user already voted on (vote2 set means they voted after reveal)
    // We track this client-side via localStorage for anonymous + logged-in
    const votedKey = `voted_duels_${uid ?? 'anon'}`
    const voted = JSON.parse(localStorage.getItem(votedKey) ?? '[]') as string[]
    return data.filter(d => !voted.includes(d.id))
  }, [])

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const [video, image, text] = await Promise.all([
        loadRow('video', userId),
        loadRow('image', userId),
        loadRow('text',  userId),
      ])
      setRows({ video, image, text })
      setLoading(false)
    }
    load()
  }, [userId, loadRow])

  const handleClick = (duel: Duel) => {
    router.push(`/duel/${duel.id}`)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#080808', color: '#fff' }}>
      <div className="cursor" ref={cursorRef} />
      <div className="cursor-ring" ref={ringRef} />
      <Nav />

      <div style={{ paddingTop: 80 }}>
        {/* Hero */}
        <div style={{ padding: '48px 32px 32px', maxWidth: 1200, margin: '0 auto' }}>
          <h1 style={{ fontSize: 32, fontWeight: 800, margin: 0, letterSpacing: '-1px' }}>
            Vote on <span style={{ color: '#e8453c' }}>Duels</span>
          </h1>
          <p style={{ color: '#555', marginTop: 8, fontSize: 15 }}>
            Pick the better AI response — blind voting, no model names shown until you vote.
          </p>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', color: '#444', padding: 80 }}>Loading duels…</div>
        ) : (
          MODE_ROWS.map(({ mode, label, emoji }) => (
            <ModeRow
              key={mode}
              label={`${emoji} ${label}`}
              duels={rows[mode]}
              onSelect={handleClick}
            />
          ))
        )}
      </div>
    </div>
  )
}

function ModeRow({ label, duels, onSelect }: {
  label: string
  duels: Duel[]
  onSelect: (d: Duel) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canLeft,  setCanLeft]  = useState(false)
  const [canRight, setCanRight] = useState(false)

  const checkScroll = () => {
    const el = scrollRef.current
    if (!el) return
    setCanLeft(el.scrollLeft > 0)
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }

  useEffect(() => { checkScroll() }, [duels])

  const scroll = (dir: 'left' | 'right') => {
    scrollRef.current?.scrollBy({ left: dir === 'left' ? -(CARD_W + CARD_GAP) * 3 : (CARD_W + CARD_GAP) * 3, behavior: 'smooth' })
  }

  return (
    <div style={{ marginBottom: 48 }}>
      {/* Row header */}
      <div style={{ padding: '0 32px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 16, maxWidth: 1200, margin: '0 auto 16px' }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{label}</h2>
        <span style={{ color: '#444', fontSize: 13 }}>{duels.length} duels</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <ScrollBtn dir="left"  disabled={!canLeft}  onClick={() => scroll('left')}  />
          <ScrollBtn dir="right" disabled={!canRight} onClick={() => scroll('right')} />
        </div>
      </div>

      {duels.length === 0 ? (
        <div style={{ padding: '0 32px', color: '#333', fontSize: 14 }}>No duels to vote on yet.</div>
      ) : (
        <div
          ref={scrollRef}
          onScroll={checkScroll}
          style={{
            display: 'flex',
            gap: CARD_GAP,
            overflowX: 'auto',
            padding: '4px 32px 12px',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
          }}
        >
          {duels.map(duel => (
            <DuelCard key={duel.id} duel={duel} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  )
}

function DuelCard({ duel, onSelect }: { duel: Duel; onSelect: (d: Duel) => void }) {
  const slot0 = duel.slots?.[0]
  const slot1 = duel.slots?.[1]

  const preview = slot0?.isVideo
    ? <VideoPreview src={slot0.text} />
    : slot0?.isImage
    ? <img src={slot0.text} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    : <TextPreview text={slot0?.text ?? ''} />

  return (
    <div
      onClick={() => onSelect(duel)}
      style={{
        flexShrink: 0,
        width: CARD_W,
        background: '#0d0d0d',
        border: '1px solid #1a1a1a',
        borderRadius: 12,
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'border-color 0.15s, transform 0.15s',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#e8453c'; (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#1a1a1a'; (e.currentTarget as HTMLElement).style.transform = 'translateY(0)' }}
    >
      {/* Preview — top half */}
      <div style={{ height: 160, background: '#111', position: 'relative', overflow: 'hidden' }}>
        {preview}
        {/* VS badge */}
        <div style={{
          position: 'absolute', top: 8, right: 8,
          background: '#e8453c', color: '#fff',
          fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 20,
          letterSpacing: '0.5px',
        }}>VS</div>
      </div>

      {/* Info — bottom half */}
      <div style={{ padding: '12px 14px' }}>
        <div style={{ fontSize: 12, color: '#ddd', lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
          {duel.prompt}
        </div>
        <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 10, color: '#444' }}>
            {slot0?.name ?? '?'} vs {slot1?.name ?? '?'}
          </div>
          <div style={{
            fontSize: 10, fontWeight: 700, color: '#e8453c',
            background: 'rgba(232,69,60,0.1)', padding: '3px 8px', borderRadius: 10,
          }}>
            VOTE
          </div>
        </div>
      </div>
    </div>
  )
}

function VideoPreview({ src }: { src: string }) {
  return (
    <video
      src={src} muted loop autoPlay playsInline
      style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
    />
  )
}

function TextPreview({ text }: { text: string }) {
  return (
    <div style={{
      padding: 14, fontSize: 12, color: '#666', lineHeight: 1.6,
      overflow: 'hidden', height: '100%',
      maskImage: 'linear-gradient(to bottom, black 60%, transparent 100%)',
    }}>
      {text.slice(0, 300)}
    </div>
  )
}

function ScrollBtn({ dir, disabled, onClick }: { dir: 'left' | 'right'; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 30, height: 30, borderRadius: '50%',
        border: '1px solid #222', background: disabled ? '#111' : '#1a1a1a',
        color: disabled ? '#333' : '#888', cursor: disabled ? 'default' : 'pointer',
        fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {dir === 'left' ? '←' : '→'}
    </button>
  )
}
