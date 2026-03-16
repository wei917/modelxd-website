'use client'
// app/feed/page.tsx
// Public feed of all duels, filterable by mode

import { useEffect, useState, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'
const createSupabaseBrowser = () => createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)

type Mode = 'all' | 'text' | 'image' | 'video'

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
  vote1: string | null
  vote2: string | null
  created_at: string
}

const PAGE_SIZE = 20

export default function FeedPage() {
  const [mode,     setMode]     = useState<Mode>('all')
  const [duels,    setDuels]    = useState<Duel[]>([])
  const [loading,  setLoading]  = useState(true)
  const [hasMore,  setHasMore]  = useState(false)
  const [page,     setPage]     = useState(0)
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async (m: Mode, p: number, append = false) => {
    setLoading(true)
    const sb = createSupabaseBrowser()
    let q = sb
      .from('duels')
      .select('id, mode, prompt, slots, vote1, vote2, created_at')
      .order('created_at', { ascending: false })
      .range(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE - 1)

    if (m !== 'all') q = q.eq('mode', m)

    const { data, error } = await q
    if (!error && data) {
      setDuels(prev => append ? [...prev, ...data] : data)
      setHasMore(data.length === PAGE_SIZE)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    setPage(0)
    setDuels([])
    load(mode, 0)
  }, [mode, load])

  const loadMore = () => {
    const next = page + 1
    setPage(next)
    load(mode, next, true)
  }

  const voteLabel = (v: string | null) =>
    v === null ? '—' : v === 'T' ? 'Tie' : `Model ${String.fromCharCode(65 + parseInt(v))}`

  return (
    <div style={{ minHeight: '100vh', background: '#080808', color: '#fff', fontFamily: 'var(--sans, sans-serif)' }}>
      {/* Header */}
      <div style={{ borderBottom: '1px solid #1a1a1a', padding: '20px 32px', display: 'flex', alignItems: 'center', gap: 24 }}>
        <a href="/xduel" style={{ color: '#e8453c', fontWeight: 700, fontSize: 18, textDecoration: 'none', letterSpacing: '-0.5px' }}>
          ← XDuel
        </a>
        <span style={{ color: '#333' }}>|</span>
        <span style={{ color: '#888', fontSize: 14 }}>Public Feed</span>

        {/* Mode filter */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {(['all', 'text', 'image', 'video'] as Mode[]).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                padding: '6px 14px',
                borderRadius: 20,
                border: 'none',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                background: mode === m ? '#e8453c' : '#1a1a1a',
                color: mode === m ? '#fff' : '#666',
                textTransform: 'capitalize',
                transition: 'all 0.15s',
              }}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Feed */}
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '32px 24px' }}>
        {loading && duels.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#444', padding: 80 }}>Loading…</div>
        ) : duels.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#444', padding: 80 }}>No duels yet in this mode.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {duels.map(duel => (
              <DuelCard
                key={duel.id}
                duel={duel}
                expanded={expanded === duel.id}
                onToggle={() => setExpanded(expanded === duel.id ? null : duel.id)}
                voteLabel={voteLabel}
              />
            ))}
          </div>
        )}

        {hasMore && !loading && (
          <div style={{ textAlign: 'center', marginTop: 32 }}>
            <button
              onClick={loadMore}
              style={{
                background: 'transparent', border: '1px solid #333',
                color: '#888', borderRadius: 8, padding: '10px 24px',
                fontSize: 13, cursor: 'pointer',
              }}
            >
              Load more
            </button>
          </div>
        )}

        {loading && duels.length > 0 && (
          <div style={{ textAlign: 'center', color: '#444', padding: 24 }}>Loading…</div>
        )}
      </div>
    </div>
  )
}

function DuelCard({ duel, expanded, onToggle, voteLabel }: {
  duel: Duel
  expanded: boolean
  onToggle: () => void
  voteLabel: (v: string | null) => string
}) {
  const modeColor = duel.mode === 'image' ? '#a78bfa' : duel.mode === 'video' ? '#34d399' : '#4a9eff'
  const date = new Date(duel.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <div style={{
      background: '#0d0d0d',
      border: '1px solid #1a1a1a',
      borderRadius: 12,
      overflow: 'hidden',
    }}>
      {/* Card header — always visible */}
      <div
        onClick={onToggle}
        style={{
          padding: '16px 20px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 14,
        }}
      >
        {/* Mode badge */}
        <span style={{
          padding: '3px 9px', borderRadius: 12, fontSize: 10, fontWeight: 700,
          background: `${modeColor}22`, color: modeColor, flexShrink: 0, marginTop: 2,
          textTransform: 'uppercase', letterSpacing: '0.5px',
        }}>
          {duel.mode}
        </span>

        {/* Prompt */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, color: '#ddd', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: expanded ? 'normal' : 'nowrap' }}>
            {duel.prompt}
          </div>
          <div style={{ marginTop: 6, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {duel.slots.filter(Boolean).map((s, i) => (
              <span key={i} style={{ fontSize: 11, color: '#555' }}>
                {String.fromCharCode(65 + i)}: {s.name}
              </span>
            ))}
          </div>
        </div>

        {/* Votes + date */}
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          {duel.vote2 && (
            <div style={{ fontSize: 11, color: '#e8453c', fontWeight: 600 }}>
              {voteLabel(duel.vote2)}
            </div>
          )}
          <div style={{ fontSize: 11, color: '#444', marginTop: 2 }}>{date}</div>
        </div>

        <span style={{ color: '#333', fontSize: 12, flexShrink: 0, marginTop: 2 }}>
          {expanded ? '▲' : '▼'}
        </span>
      </div>

      {/* Expanded: show responses */}
      {expanded && (
        <div style={{ borderTop: '1px solid #1a1a1a', padding: '20px', display: 'grid', gridTemplateColumns: `repeat(${duel.slots.length}, 1fr)`, gap: 16 }}>
          {duel.slots.filter(Boolean).map((slot, i) => (
            <div key={i}>
              <div style={{ fontSize: 10, color: '#555', marginBottom: 6, fontFamily: 'monospace' }}>
                MODEL {String.fromCharCode(65 + i)}
              </div>
              <div style={{ fontSize: 13, color: '#fff', fontWeight: 600, marginBottom: 2 }}>{slot.name}</div>
              <div style={{ fontSize: 11, color: '#555', marginBottom: 10 }}>{slot.provider.toUpperCase()} · {slot.priceLabel}</div>

              {slot.isVideo ? (
                <video
                  src={slot.text}
                  controls muted loop playsInline
                  style={{ width: '100%', borderRadius: 8, display: 'block' }}
                />
              ) : slot.isImage ? (
                <img
                  src={slot.text}
                  alt="Generated"
                  style={{ width: '100%', borderRadius: 8, display: 'block' }}
                />
              ) : (
                <div style={{ fontSize: 13, color: '#aaa', lineHeight: 1.6, whiteSpace: 'pre-wrap', maxHeight: 300, overflow: 'auto' }}>
                  {slot.text}
                </div>
              )}

              <div style={{ marginTop: 8, fontSize: 11, color: '#444' }}>
                ⏱ {(slot.responseTime / 1000).toFixed(2)}s · ${Number(slot.cost).toFixed(4)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Vote summary footer */}
      {(duel.vote1 || duel.vote2) && (
        <div style={{ borderTop: '1px solid #1a1a1a', padding: '10px 20px', display: 'flex', gap: 20, fontSize: 11, color: '#555' }}>
          {duel.vote1 && <span>Blind vote: <span style={{ color: '#888' }}>{voteLabel(duel.vote1)}</span></span>}
          {duel.vote2 && <span>Final vote: <span style={{ color: '#e8453c' }}>{voteLabel(duel.vote2)}</span></span>}
        </div>
      )}
    </div>
  )
}
