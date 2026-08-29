'use client'
// app/vote/page.tsx
// Vote feed with paginated grid per mode (video / image / text).
// Features: hides voted duels, popularity sorting, search, pagination.

import Link from 'next/link'
import { useEffect, useState, useRef, useCallback } from 'react'
import ModeIcon from '../components/ModeIcon'
import { useRouter } from 'next/navigation'
import { useRequireAuth } from '../../lib/useRequireAuth'
import { useT } from '../../lib/i18n'
import { createBrowserClient } from '@supabase/ssr'
const createSupabaseBrowser = () => createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)

type Mode = 'video' | 'image' | 'text'

/** What a voter is allowed to know. XVote has no reveal step — the models
 *  are never named here — so the feed route strips identity, price, cost and
 *  timing before they leave the server (app/api/xvote/feed/route.ts). The
 *  card drew none of them; the browser used to receive all of them. */
interface SlotData {
  text: string
  isImage: boolean
  isVideo: boolean
}

interface Duel {
  id: string
  mode: string
  prompt: string
  slots: SlotData[]
  input_media?: { url: string; mediaType: string } | null
  vote2: string | null
  community_vote_count: number
  created_at: string
}

const PAGE_SIZE = 12
const MAX_PER_TAB = 100

export default function VotePage() {
  const t = useT()
  useRequireAuth()
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [votedIds, setVotedIds] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<Mode>('image')
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
          const res = await fetch('/api/xduel/community-vote')
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
    router.push(`/xduel/${duel.id}`)
  }

  return (
    <>
      <div className="cursor" ref={cursorRef} />
      <div className="cursor-ring" ref={ringRef} />

      <div className="xduel-page">
        <div className="arena">

          {/* In-page header: "// XVOTE" eyebrow + big headline (CC, July 20). */}
          <div className="prompt-header">
            <Link href="/xvote" className="prompt-label eyebrow" style={{ textDecoration: 'none', display: 'inline-block' }}>{t('xvote.eyebrow')}</Link>
            <h1 className="page-headline">{t('xvote.subtitle')}</h1>
          </div>

          {/* Controls row */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'stretch', flexWrap: 'wrap', marginBottom: 32 }}>
            {/* Mode selector */}
            <div className="mode-seg">
              {(['text', 'image', 'video'] as Mode[]).map(m => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`mode-seg-btn${mode === m ? ' active' : ''}`}
                >
                  <ModeIcon m={m} />{t('mode.' + m)}
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
                placeholder={t('xvote.search')}
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
          </div>

          {!ready ? (
            <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 80 }}>Loading duels…</div>
          ) : (
            <ModeSection
              key={mode}
              mode={mode}
              userId={userId}
              votedIds={votedIds}
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


// ── Blended feed ranking (CC, July 25) ───────────────────────────────
// Replaces the Recent / Popular toggle. Every duel gets a weight from
// three signals, then the feed order is drawn by weighted random sampling
// without replacement (Efraimidis-Spirakis: key = U^(1/w), sort by key
// desc). Heavier duels land near the top on *most* loads without ever
// being pinned there, so the feed genuinely reshuffles per visit instead
// of showing one fixed ranking.
//
//   recency     exp(-ageHours / HALF_LIFE_H) — smooth decay, no cliff at
//               an arbitrary "new" cutoff.
//   popularity  log1p(votes) / log1p(maxVotes) — logarithmic so a 40-vote
//               duel edges ahead of a 4-vote one instead of burying it.
//   needsVotes  1 / (1 + votes) — the deliberate counterweight. XVote
//               exists to COLLECT votes, and a popularity-led feed starves
//               exactly the duels the leaderboard is waiting on. That is
//               why models sat at "—" on XBoard with no score.
//
// The randomness also preserves the July 17 rule that this grid must not
// read as a precise timeline — a strict created_at order would let
// visitors gauge how many duels get played and when.
const HALF_LIFE_H = 72     // a 3-day-old duel keeps half its recency weight
const W_RECENCY   = 1.0
const W_POPULAR   = 0.8
const W_NEEDS     = 0.6
const W_FLOOR     = 0.15   // nothing is ever weight 0, so the tail still surfaces

function blendedOrder(duels: Duel[]): Duel[] {
  if (duels.length === 0) return []
  const now = Date.now()
  const maxVotes = Math.max(1, ...duels.map(d => d.community_vote_count || 0))
  const logMax = Math.log1p(maxVotes)
  return duels
    .map(d => {
      const ageH  = Math.max(0, (now - new Date(d.created_at).getTime()) / 3_600_000)
      const votes = d.community_vote_count || 0
      const recency    = Math.exp(-ageH / HALF_LIFE_H)
      const popularity = logMax > 0 ? Math.log1p(votes) / logMax : 0
      const needsVotes = 1 / (1 + votes)
      const w = W_FLOOR + W_RECENCY * recency + W_POPULAR * popularity + W_NEEDS * needsVotes
      // Math.random() can return exactly 0, which would zero every key
      // regardless of weight — nudge it off the boundary.
      const u = Math.random() || Number.MIN_VALUE
      return { d, key: Math.pow(u, 1 / w) }
    })
    .sort((a, b) => b.key - a.key)
    .map(x => x.d)
}

function ModeSection({ mode, userId, votedIds, search, onSelect }: {
  mode: Mode
  userId: string | null
  votedIds: Set<string>
  search: string
  onSelect: (d: Duel) => void
}) {
  const t = useT()
  const [duels, setDuels] = useState<Duel[]>([])
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)

  // Fetch duels for this mode. We fetch a bigger batch and paginate
  // client-side after filtering voted + search. This avoids complex
  // server-side offset math when rows are being filtered out.
  const fetchDuels = useCallback(async () => {
    setLoading(true)
    // Redacted server-side. This used to be a direct `duels` select from
    // the browser, which handed every voter the model names it was about to
    // hide from them.
    try {
      const res = await fetch(`/api/xvote/feed?mode=${mode}`)
      const json = await res.json()
      setDuels(blendedOrder((json?.duels ?? []) as Duel[]))
    } catch {
      setDuels([])
    }
    setLoading(false)
    // votedIds is deliberately NOT a dependency: the route already excludes
    // what this user has voted on, and the render filters the rest, so
    // keeping it here would refetch and reshuffle the whole feed on every
    // single vote. userId stays — the feed needs an authenticated read.
  }, [mode, userId])

  useEffect(() => { fetchDuels() }, [fetchDuels])

  // Reset to page 0 when search changes
  useEffect(() => { setPage(0) }, [search])

  // Filter voted + search
  let filtered = duels.filter(d => !votedIds.has(d.id))
  if (search.trim()) {
    const q = search.trim().toLowerCase()
    // Prompt only. Filtering by MODEL NAME leaked the answer by
    // construction — a search for "gemini" returning five duels tells you
    // Gemini is in all five — and moving it server-side would not have
    // changed that, so it is gone rather than relocated.
    filtered = filtered.filter(d => d.prompt.toLowerCase().includes(q))
  }

  // A visit shows at most MAX_PER_TAB duels per tab (owner, Aug 22): enough
  // to vote for a while, never a scrollable census of the archive.
  filtered = filtered.slice(0, MAX_PER_TAB)
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages - 1)
  const pageDuels = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)

  return (
    <div style={{ marginBottom: 48 }}>
      {loading ? (
        <div style={{ color: 'var(--muted)', fontSize: 13, padding: '40px 0' }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ color: 'var(--muted)', fontSize: 14, padding: '24px 0' }}>No duels to vote on yet.</div>
      ) : (
        <>
          {/* Card grid */}
          <div className="xvote-grid">
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
  const t = useT()
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
        // Media rows get a FIXED height so tall/spanning images crop
        // (objectFit cover) instead of stretching the tile — a 3-slot
        // image duel was ballooning to ~1200px (CC, July 19). Text
        // previews keep flexible rows.
        gridTemplateRows: hasMedia
          ? (slotCount <= 2 ? '220px' : '150px 150px')
          : (slotCount <= 2 ? '1fr' : '1fr 1fr'),
        gap: 1, background: 'var(--border)',
        minHeight: hasMedia ? 140 : 100,
      }}>
        {slots.slice(0, 4).map((slot, i) => (
          <div key={i} style={{
            overflow: 'hidden', position: 'relative', background: 'var(--surface)',
            // 3-model duels: the odd slot spans the bottom row instead of
            // leaving an empty cell (CC, July 19).
            gridColumn: slotCount === 3 && i === 2 ? '1 / -1' : undefined,
          }}>
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

        {/* NOTE: no input thumb here (CC, July 19) — user uploads are
            unmoderated, so they only ever display to their owner (see
            /xduel/[id]). */}

        {/* VS badge */}
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          background: 'var(--red)', color: '#fff',
          fontSize: 9, fontWeight: 800, padding: '3px 8px', borderRadius: 20,
          letterSpacing: '0.08em', zIndex: 2,
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        }}>{slotCount <= 2 ? 'VS' : `${slotCount}-WAY`}</div>
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
          {t('xvote.votebtn').toUpperCase()} →
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
