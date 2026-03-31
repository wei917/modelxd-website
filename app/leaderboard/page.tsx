'use client'
// app/leaderboard/page.tsx
// Model leaderboard based on informed votes (vote2) across all duels

import { useEffect, useState, useRef } from 'react'
import Nav from '../components/Nav'
import { createBrowserClient } from '@supabase/ssr'
const createSupabaseBrowser = () => createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)

type Mode = 'all' | 'text' | 'image' | 'video'

interface ModelStats {
  modelId: string
  name: string
  provider: string
  wins: number
  losses: number
  ties: number
  total: number
  winRate: number
  priceLabel: string
}

export default function LeaderboardPage() {
  const [mode,    setMode]    = useState<Mode>('all')
  const [stats,   setStats]   = useState<ModelStats[]>([])
  const [loading, setLoading] = useState(true)
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
    const load = async () => {
      setLoading(true)
      const sb = createSupabaseBrowser()

      let q = sb
        .from('duels')
        .select('mode, slots, vote2, vote2_model_id')
        .not('vote2', 'is', null)

      if (mode !== 'all') q = q.eq('mode', mode)
      const { data, error } = await q

      if (error || !data) { setLoading(false); return }

      // Tally wins/losses/ties per model
      const tally: Record<string, { name: string; provider: string; priceLabel: string; wins: number; losses: number; ties: number }> = {}

      const ensure = (id: string, slot: { name: string; provider: string; priceLabel: string }) => {
        if (!tally[id]) tally[id] = { name: slot.name, provider: slot.provider, priceLabel: slot.priceLabel, wins: 0, losses: 0, ties: 0 }
      }

      for (const duel of data) {
        const slots = (duel.slots as any[]).filter(Boolean)
        if (slots.length < 2) continue

        const isTie = duel.vote2 === 'T'
        const winnerModelId = duel.vote2_model_id

        for (const slot of slots) {
          if (!slot.id) continue
          ensure(slot.id, slot)
          if (isTie) {
            tally[slot.id].ties++
          } else if (slot.id === winnerModelId) {
            tally[slot.id].wins++
          } else {
            tally[slot.id].losses++
          }
        }
      }

      const result: ModelStats[] = Object.entries(tally)
        .map(([modelId, t]) => {
          const total = t.wins + t.losses + t.ties
          return {
            modelId,
            name:      t.name,
            provider:  t.provider,
            priceLabel: t.priceLabel,
            wins:      t.wins,
            losses:    t.losses,
            ties:      t.ties,
            total,
            winRate:   total > 0 ? (t.wins + t.ties * 0.5) / total : 0,
          }
        })
        .filter(m => m.total >= 1)
        .sort((a, b) => b.winRate - a.winRate || b.total - a.total)

      setStats(result)
      setLoading(false)
    }
    load()
  }, [mode])

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--white)' }}>
      <div className="cursor" ref={cursorRef} />
      <div className="cursor-ring" ref={ringRef} />
      <Nav />

      <div style={{ maxWidth: 860, margin: '0 auto', padding: '100px 24px 60px' }}>
        {/* Header */}
        <div style={{ marginBottom: 40 }}>
          <h1 style={{ fontSize: 32, fontWeight: 800, margin: 0, letterSpacing: '-1px' }}>
            <span style={{ color: 'var(--red)' }}>Leader</span>board
          </h1>
          <p style={{ color: 'var(--muted)', marginTop: 8, fontSize: 15 }}>
            Model rankings based on community votes — informed vote (after reveal) only.
          </p>
        </div>

        {/* Mode filter */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 32 }}>
          {(['all', 'text', 'image', 'video'] as Mode[]).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                padding: '7px 16px', borderRadius: 20, border: 'none',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
                background: mode === m ? 'var(--red)' : 'var(--surface)',
                color: mode === m ? '#fff' : 'var(--muted)',
                textTransform: 'capitalize', transition: 'all 0.15s',
              }}
            >
              {m}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 80 }}>Loading…</div>
        ) : stats.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 80 }}>
            No votes yet{mode !== 'all' ? ` for ${mode} mode` : ''}.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {/* Table header */}
            <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr 80px 80px 80px 100px', gap: 12, padding: '8px 16px', fontSize: 10, color: 'var(--muted)', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase' }}>
              <span>#</span>
              <span>Model</span>
              <span style={{ textAlign: 'right' }}>Wins</span>
              <span style={{ textAlign: 'right' }}>Losses</span>
              <span style={{ textAlign: 'right' }}>Ties</span>
              <span style={{ textAlign: 'right' }}>Win Rate</span>
            </div>

            {stats.map((m, i) => (
              <LeaderboardRow key={m.modelId} rank={i + 1} model={m} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function LeaderboardRow({ rank, model }: { rank: number; model: ModelStats }) {
  const pct = Math.round(model.winRate * 100)
  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null
  const barColor = pct >= 60 ? 'var(--green)' : pct >= 40 ? 'var(--red)' : 'var(--muted)'

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '40px 1fr 80px 80px 80px 100px',
      gap: 12,
      padding: '14px 16px',
      background: rank <= 3 ? 'var(--surface)' : 'transparent',
      border: `1px solid ${rank <= 3 ? 'var(--border2)' : 'transparent'}`,
      borderRadius: 10,
      alignItems: 'center',
      transition: 'background 0.15s',
    }}
    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface)'}
    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = rank <= 3 ? 'var(--surface)' : 'transparent'}
    >
      {/* Rank */}
      <div style={{ fontSize: 14, color: rank <= 3 ? 'var(--white)' : 'var(--muted)', fontWeight: 700, textAlign: 'center' }}>
        {medal ?? rank}
      </div>

      {/* Model info */}
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--white)' }}>{model.name}</div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
          {model.provider.toUpperCase()} · {model.priceLabel}
        </div>
      </div>

      {/* W / L / T */}
      <div style={{ textAlign: 'right', fontSize: 13, color: 'var(--green)', fontWeight: 600 }}>{model.wins}</div>
      <div style={{ textAlign: 'right', fontSize: 13, color: 'var(--red)', fontWeight: 600 }}>{model.losses}</div>
      <div style={{ textAlign: 'right', fontSize: 13, color: 'var(--muted2)' }}>{model.ties}</div>

      {/* Win rate bar */}
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: barColor, marginBottom: 4 }}>{pct}%</div>
        <div style={{ height: 3, background: 'var(--surface2)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: barColor, borderRadius: 2, transition: 'width 0.5s ease' }} />
        </div>
        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{model.total} battles</div>
      </div>
    </div>
  )
}
