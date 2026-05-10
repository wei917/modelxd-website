'use client'
// app/vote/page.tsx
// Vote feed with paginated grid per mode (video / image / text).
// Features: hides voted duels, popularity sorting, search, pagination.

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireAuth } from '../../lib/useRequireAuth'
import { createBrowserClient } from '@supabase/ssr'
const createSupabaseBrowser = () => createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)

type Mode = 'video' | 'image' | 'text'
type SortMode = 'recent' | 'popular'

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
  community_vote_count: number
  created_at: string
}

const PAGE_SIZE = 12

export default function VotePage() {
  useRequireAuth()
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [votedIds, setVotedIds] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<Mode>('image')
  const [sortMode, setSortMode] = useState<SortMode>('recent')
  const [search, setSearch] = useState('')
  const [ready, setReady] = useState(false)
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

  // Load user + voted IDs
  useEffect(() => {
    const sb = createSupabaseBrowser()
    sb.auth.getUser().then(async ({ data }) => {
      const uid = data.user?.id ?? null
      setUserId(uid)
      if (uid) {
        try {
          const res = await fetch('/api/duel/community-vote')
          if (res.ok) {
            const { votedDuelIds } = await res.json()
            const serverIds = new Set<string>(votedDuelIds ?? [])
            const lsKey = `voted_duels_${uid}`
            const lsVoted = JSON.parse(localStorage.getItem(lsKey) ?? '[]') as string[]
            lsVoted.forEach(id => serverIds.add(id))
            setVotedIds(serverIds)
          }
        } catch {
          const lsKey = `voted_duels_${uid}`
          const lsVoted = JSON.parse(localStorage.getItem(lsKey) ?? '[]') as string[]
          setVotedIds(new Set(lsVoted))
        }
      }
      setReady(true)
    })
  }, [])

  const handleClick = (duel: Duel) => {
    router.push(`/duel/${duel.id}`)
  }

  return (
    <>
      <div className="cursor" ref={cursorRef} />
      <div className="cursor-ring" ref={ringRef} />

      <div className="xduel-page">
        <div className="arena">

          <div className="prompt-header">
            <div className="prompt-label">XVote</div>
            <h1 className="prompt-title">
              Vote on <span>Duels</span>
            </h1>
            <div className="prompt-sub">
              Pick the better AI response — blind voting, no model names shown until you vote.
            </div>
          </div>

          {/* Controls row */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'stretch', flexWrap: 'wrap', marginBottom: 32 }}>
            {/* Mode selector */}
            <div className="mode-selector" style={{ marginBottom: 0 }}>
              {(['text', 'image', 'video'] as Mode[]).map(m => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`mode-btn${mode === m ? ' active' : ''}`}
                >
                  <span className={`mode-dot${mode === m ? ' active' : ''}`} />
                  {m}
                </button>
              ))}
            </div>

            {/* Search */}
            <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: 420, display: 'flex' }}>
              <span style={{
                position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
                color: 'var(--muted)', fontSize: 14, pointerEvents: 'none',
              }}>⌕</span>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search duels…"
                style={{
                  width: '100%',
                  padding: '0 16px 0 38px',
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  color: 'var(--white)',
                  fontSize: 12,
                  outline: 'none',
                  fontFamily: 'var(--font-mono), monospace',
                  letterSpacing: '0.06em',
                  transition: 'border-color 0.2s, background 0.2s',
                }}
                onFocus={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'var(--red)'; el.style.background = 'var(--bg)' }}
                onBlur={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'var(--border)'; el.style.background = 'var(--surface)' }}
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                  style={{
                    position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                    width: 20, height: 20, borderRadius: '50%',
                    background: 'var(--border2)', color: 'var(--bg)',
                    border: 'none', cursor: 'pointer',
                    fontSize: 11, fontWeight: 700, lineHeight: 1,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >×</button>
              )}
            </div>

            {/* Sort toggle */}
            <div className="mode-selector" style={{ marginBottom: 0 }}>
              {(['recent', 'popular'] as SortMode[]).map(s => (
                <button
                  key={s}
                  onClick={() => setSortMode(s)}
                  className={`mode-btn${sortMode === s ? ' active' : ''}`}
                >
                  <span className={`mode-dot${sortMode === s ? ' active' : ''}`} />
                  {s === 'recent' ? 'Recent' : 'Popular'}
                </button>
              ))}
            </div>
          </div>

          {!ready ? (
            <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 80 }}>Loading duels…</div>
          ) : (
            <ModeSection
              key={mode}
              mode={mode}
              userId={userId}
              votedIds={votedIds}
              sortMode={sortMode}
              search={search}
              onSelect={handleClick}
            />
          )}

        </div>
      </div>
    </>
  )
}

/* ── Paginated mode section ──────────────────────────────────────────── */

function ModeSection({ mode, userId, votedIds, sortMode, search, onSelect }: {
  mode: Mode
  userId: string | null
  votedIds: Set<string>
  sortMode: SortMode
  search: string
  onSelect: (d: Duel) => void
}) {
  const [duels, setDuels] = useState<Duel[]>([])
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)

  // Fetch duels for this mode. We fetch a bigger batch and paginate
  // client-side after filtering voted + search. This avoids complex
  // server-side offset math when rows are being filtered out.
  const fetchDuels = useCallback(async () => {
    setLoading(true)
    const sb = createSupabaseBrowser()

    // Try with new columns first; fall back to old schema if migration
    // hasn't been run yet (community_vote_count / deleted_at missing).
    let q = sb
      .from('duels')
      .select('id, mode, prompt, slots, vote2, community_vote_count, created_at', { count: 'exact' })
      .eq('mode', mode)
      .is('deleted_at', null)

    if (sortMode === 'popular') {
      q = q.order('community_vote_count', { ascending: false }).order('created_at', { ascending: false })
    } else {
      q = q.order('created_at', { ascending: false })
    }

    q = q.limit(200)

    let { data, error, count } = await q

    // Fallback: if the new columns don't exist yet, query without them.
    if (error) {
      let q2 = sb
        .from('duels')
        .select('id, mode, prompt, slots, vote2, created_at', { count: 'exact' })
        .eq('mode', mode)
        .order('created_at', { ascending: false })
        .limit(200)

      const fallback = await q2
      if (fallback.error || !fallback.data) { setDuels([]); setTotal(0); setLoading(false); return }
      const normalized = (fallback.data as any[]).map(d => ({ ...d, community_vote_count: 0 })) as Duel[]
      setDuels(normalized)
      setTotal(fallback.count ?? fallback.data.length)
      setLoading(false)
      return
    }

    if (!data) { setDuels([]); setTotal(0); setLoading(false); return }
    // Ensure community_vote_count defaults to 0 for old rows
    const normalized = (data as any[]).map(d => ({ ...d, community_vote_count: d.community_vote_count ?? 0 })) as Duel[]
    setDuels(normalized)
    setTotal(count ?? data.length)
    setLoading(false)
  }, [mode, userId, sortMode])

  useEffect(() => { fetchDuels() }, [fetchDuels])

  // Reset to page 0 when search/sort changes
  useEffect(() => { setPage(0) }, [search, sortMode])

  // Filter voted + search
  let filtered = duels.filter(d => !votedIds.has(d.id))
  if (search.trim()) {
    const q = search.trim().toLowerCase()
    filtered = filtered.filter(d =>
      d.prompt.toLowerCase().includes(q) ||
      d.slots?.some(s => s.name?.toLowerCase().includes(q))
    )
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages - 1)
  const pageDuels = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)

  return (
    <div style={{ marginBottom: 48 }}>
      {/* Duel count */}
      <div style={{ marginBottom: 16, color: 'var(--muted)', fontSize: 13 }}>
        {filtered.length} duel{filtered.length !== 1 ? 's' : ''}
      </div>

      {loading ? (
        <div style={{ color: 'var(--muted)', fontSize: 13, padding: '40px 0' }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ color: 'var(--muted)', fontSize: 14, padding: '24px 0' }}>No duels to vote on yet.</div>
      ) : (
        <>
          {/* Card grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 16,
          }}>
            {pageDuels.map(duel => (
              <DuelCard key={duel.id} duel={duel} onSelect={onSelect} />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 8, marginTop: 20,
            }}>
              <PageBtn
                label="← Prev"
                disabled={safePage === 0}
                onClick={() => setPage(p => Math.max(0, p - 1))}
              />
              <span style={{
                fontSize: 12, color: 'var(--muted2)',
                fontFamily: 'var(--font-mono), monospace',
                letterSpacing: '0.06em',
                padding: '0 8px',
              }}>
                {safePage + 1} / {totalPages}
              </span>
              <PageBtn
                label="Next →"
                disabled={safePage >= totalPages - 1}
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}

/* ── Components ──────────────────────────────────────────────────────── */

function PageBtn({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '7px 16px', borderRadius: 6,
        border: '1px solid var(--border2)',
        background: disabled ? 'var(--surface)' : 'var(--surface2)',
        color: disabled ? 'var(--muted)' : 'var(--white)',
        fontSize: 11, fontWeight: 600, cursor: disabled ? 'default' : 'pointer',
        fontFamily: 'var(--font-mono), monospace',
        letterSpacing: '0.08em',
        transition: 'all 0.15s',
      }}
    >
      {label}
    </button>
  )
}

function SlotPreview({ slot }: { slot: SlotData | undefined }) {
  if (!slot) return null
  if (slot.isVideo) return <VideoPreview src={slot.text} />
  if (slot.isImage) return <img src={slot.text} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
  return <TextPreview text={slot.text ?? ''} />
}

function DuelCard({ duel, onSelect }: { duel: Duel; onSelect: (d: Duel) => void }) {
  const slots = (duel.slots ?? []).filter(Boolean)
  const slotCount = slots.length
  const hasMedia = slots.some(s => s.isImage || s.isVideo)

  return (
    <div
      onClick={() => onSelect(duel)}
      style={{
        background: 'var(--bg)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'border-color 0.2s, box-shadow 0.2s, transform 0.2s',
        display: 'flex',
        flexDirection: 'column',
      }}
      onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'var(--red)'; el.style.boxShadow = '0 6px 24px rgba(214,59,50,0.12)'; el.style.transform = 'translateY(-2px)' }}
      onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'var(--border)'; el.style.boxShadow = 'none'; el.style.transform = 'translateY(0)' }}
    >
      {/* Prompt — large, prominent */}
      <div style={{ padding: '20px 20px 18px' }}>
        <div style={{
          fontSize: 17, fontWeight: 500, color: 'var(--white)', lineHeight: 1.4,
          fontFamily: 'var(--font-body), sans-serif',
          letterSpacing: '-0.005em',
          overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          height: `calc(17px * 1.4 * 2)`,
        }}>
          {duel.prompt}
        </div>
      </div>

      {/* Preview — response snippets */}
      <div style={{
        flex: 1, position: 'relative', overflow: 'hidden',
        borderTop: '1px solid var(--border)',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gridTemplateRows: slotCount <= 2 ? '1fr' : '1fr 1fr',
        gap: 1, background: 'var(--border)',
        minHeight: hasMedia ? 140 : 100,
      }}>
        {slots.slice(0, 4).map((slot, i) => (
          <div key={i} style={{ overflow: 'hidden', position: 'relative', background: 'var(--surface)' }}>
            <SlotPreview slot={slot} />
            <div style={{
              position: 'absolute', top: 6, left: 6,
              background: 'var(--bg)', color: 'var(--muted2)',
              fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 3,
              letterSpacing: '0.08em', fontFamily: 'var(--font-mono), monospace',
              border: '1px solid var(--border)',
            }}>
              {String.fromCharCode(65 + i)}
            </div>
          </div>
        ))}

        {/* VS badge */}
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          background: 'var(--red)', color: '#fff',
          fontSize: 9, fontWeight: 800, padding: '3px 8px', borderRadius: 20,
          letterSpacing: '0.08em', zIndex: 2,
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        }}>VS</div>
      </div>

      {/* Footer — mode + vote count + CTA */}
      <div style={{
        padding: '11px 20px', borderTop: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'var(--surface)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            fontFamily: 'var(--font-mono), monospace',
            fontSize: 10, color: 'var(--muted2)', letterSpacing: '0.12em',
            fontWeight: 700, textTransform: 'uppercase',
          }}>
            {duel.mode}
          </span>
          {duel.community_vote_count > 0 && (
            <>
              <span style={{ color: 'var(--border2)' }}>·</span>
              <span style={{
                fontFamily: 'var(--font-mono), monospace',
                fontSize: 10, color: 'var(--muted)', letterSpacing: '0.08em',
              }}>
                {duel.community_vote_count} vote{duel.community_vote_count !== 1 ? 's' : ''}
              </span>
            </>
          )}
        </div>
        <span style={{
          fontFamily: 'var(--font-mono), monospace',
          fontSize: 10, fontWeight: 700, color: 'var(--red)',
          letterSpacing: '0.12em',
        }}>
          VOTE →
        </span>
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
      padding: 14, fontSize: 12, color: 'var(--muted2)', lineHeight: 1.6,
      overflow: 'hidden', height: '100%',
      maskImage: 'linear-gradient(to bottom, black 60%, transparent 100%)',
    }}>
      {text.slice(0, 300)}
    </div>
  )
}
