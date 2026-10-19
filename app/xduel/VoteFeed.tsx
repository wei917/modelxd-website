'use client'
// app/xduel/VoteFeed.tsx
// Other people's duels to vote on, under XDuel's composer for the chosen
// type. It was its own page, XVote (/xvote), which nobody used; the owner
// folded it in here on Oct 17 in place of the 熱門 starter prompts ("remove
// the popular section at the bottom and replace it with XVote content by
// content type"). A card opens the duel's permalink, /xduel/<id>, where the
// vote happens as before. Voted duels are hidden; the order is blended.

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useT, useLang } from '../../lib/i18n'
import { createBrowserClient } from '@supabase/ssr'
const createSupabaseBrowser = () => createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)

type Mode = 'video' | 'image' | 'text' | 'audio'

/** What a voter is allowed to know. The feed has no reveal step — the
 *  models are never named here — so the feed route strips identity, price,
 *  cost and timing before they leave the server (app/api/xduel/feed). */
interface SlotData {
  text: string
  isImage: boolean
  isVideo: boolean
  isAudio?: boolean
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
  lang?: string | null   // the starter's page language (migration 141)
}

const PAGE_SIZE = 12
const MAX_PER_TAB = 100

// Two orders (owner, Oct 17: "add a sorting option dropdown"). Latest is
// the newest two pages of duels in a fresh random order each visit, then
// the rest as the blended draw below: new duels come first, but their
// order says nothing about when each was made, so the feed cannot be read
// as a count of how many duels people make ("I don't want people use the
// 'latest' sorting to predict how many users I have"; "random 2 pages").
// Popular is most votes first, newest first among equals.
type FeedSort = 'latest' | 'popular'
const LATEST_POOL = 2 * PAGE_SIZE

/** Fisher-Yates, on a copy. */
function shuffled<T>(xs: T[]): T[] {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** The newest LATEST_POOL shuffled, then everything else blended. */
function latestOrder(duels: Duel[]): Duel[] {
  const byNew = [...duels].sort((a, b) => b.created_at.localeCompare(a.created_at))
  return [...shuffled(byNew.slice(0, LATEST_POOL)), ...blendedOrder(byNew.slice(LATEST_POOL))]
}

export default function VoteFeed({ mode }: { mode: Mode }) {
  const t = useT()
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [votedIds, setVotedIds] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<FeedSort>('latest')
  const [ready, setReady] = useState(false)

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
          try {
            const lsVoted = JSON.parse(localStorage.getItem(`voted_duels_${uid}`) ?? '[]') as string[]
            setVotedIds(new Set(lsVoted))
          } catch { /* storage blocked */ }
        }
      }
      setReady(true)
    })
  }, [])

  return (
    <section className="xduel-feed">
      <div className="xduel-feed-head">
        <h2>{t('xduel.feed.title')}</h2>
        <div className="xduel-feed-tools">
        <div className="xduel-feed-search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('xvote.search')}
            aria-label={t('xvote.search')}
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} aria-label="Clear search">×</button>
          )}
        </div>
        <select className="xduel-feed-sort" value={sort} onChange={e => setSort(e.target.value as FeedSort)} aria-label={t('xduel.feed.sort')}>
          <option value="latest">{t('xduel.feed.sort.latest')}</option>
          <option value="popular">{t('xduel.feed.sort.popular')}</option>
        </select>
        </div>
      </div>
      {!ready ? (
        <div style={{ color: 'var(--muted)', fontSize: 13, padding: '40px 0' }}>{t('common.loading')}</div>
      ) : (
        <FeedSection
          key={mode}
          mode={mode}
          userId={userId}
          votedIds={votedIds}
          search={search}
          sort={sort}
          onSelect={d => router.push(`/xduel/${d.id}`)}
        />
      )}
    </section>
  )
}

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
//   needsVotes  1 / (1 + votes) — the deliberate counterweight. The feed
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

function FeedSection({ mode, userId, votedIds, search, sort, onSelect }: {
  mode: Mode
  userId: string | null
  votedIds: Set<string>
  search: string
  sort: FeedSort
  onSelect: (d: Duel) => void
}) {
  const { t, lang } = useLang()
  const [duels, setDuels] = useState<Duel[]>([])
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)

  // Fetch duels for this mode. We fetch a bigger batch and paginate
  // client-side after filtering voted + search. This avoids complex
  // server-side offset math when rows are being filtered out.
  const fetchDuels = useCallback(async () => {
    setLoading(true)
    // Redacted server-side: a direct `duels` select from the browser would
    // hand every voter the model names it is about to hide from them.
    try {
      const res = await fetch(`/api/xduel/feed?mode=${mode}`)
      const json = await res.json()
      setDuels(latestOrder((json?.duels ?? []) as Duel[]))
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

  // Reset to page 0 when search or the order changes
  useEffect(() => { setPage(0) }, [search, sort])

  // Filter voted + search. `duels` holds this visit's latest order, drawn
  // once per fetch; popular reorders it by votes, and switching back
  // restores the same draw rather than reshuffling.
  const sorted = sort === 'popular'
    ? [...duels].sort((a, b) => (b.community_vote_count || 0) - (a.community_vote_count || 0) || b.created_at.localeCompare(a.created_at))
    : duels
  // The viewer's language first (owner, Oct 19), each part in the chosen
  // order; the rest (other languages, and duels from before migration 141)
  // follow, so the feed never runs dry while there are few duels.
  const ordered = [...sorted.filter(d => d.lang === lang), ...sorted.filter(d => d.lang !== lang)]
  let filtered = ordered.filter(d => !votedIds.has(d.id))
  if (search.trim()) {
    const q = search.trim().toLowerCase()
    // Prompt only. Filtering by MODEL NAME leaked the answer by
    // construction — a search for "gemini" returning five duels tells you
    // Gemini is in all five — and moving it server-side would not have
    // changed that, so it is gone rather than relocated.
    filtered = filtered.filter(d => d.prompt.toLowerCase().includes(q))
  }

  // A visit shows at most MAX_PER_TAB duels per type (owner, Aug 22):
  // enough to vote for a while, never a scrollable census of the archive.
  filtered = filtered.slice(0, MAX_PER_TAB)
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages - 1)
  const pageDuels = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)

  return (
    <div style={{ marginBottom: 48 }}>
      {loading ? (
        <div style={{ color: 'var(--muted)', fontSize: 13, padding: '40px 0' }}>{t('common.loading')}</div>
      ) : filtered.length === 0 ? (
        <div style={{ color: 'var(--muted)', fontSize: 14, padding: '24px 0' }}>{t('xvote.empty')}</div>
      ) : (
        <>
          <div className="xduel-feed-grid">
            {pageDuels.map(duel => (
              <DuelCard key={duel.id} duel={duel} onSelect={onSelect} />
            ))}
          </div>

          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 20 }}>
              <PageBtn
                label={t('xvote.prev')}
                disabled={safePage === 0}
                onClick={() => setPage(p => Math.max(0, p - 1))}
              />
              <span style={{ fontSize: 13, color: 'var(--muted2)', padding: '0 8px' }}>
                {safePage + 1} / {totalPages}
              </span>
              <PageBtn
                label={t('xvote.next')}
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
        padding: '8px 18px', borderRadius: 999,
        border: '1px solid var(--border2)',
        background: 'var(--surface)',
        color: disabled ? 'var(--muted)' : 'var(--white)',
        opacity: disabled ? 0.55 : 1,
        fontSize: 13.5, fontWeight: 500, cursor: disabled ? 'default' : 'pointer',
        fontFamily: 'var(--font-body), sans-serif',
        transition: 'all 0.15s',
      }}
    >
      {label}
    </button>
  )
}

function SlotPreview({ slot }: { slot: SlotData | undefined }) {
  if (!slot) return null
  // A speech duel: a player in the card. Clicks on it stay on the player
  // instead of opening the duel.
  if (slot.isAudio) return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', padding: '20px 10px 14px' }} onClick={e => e.stopPropagation()}>
      <audio src={slot.text} controls preload="none" style={{ width: '100%' }} />
    </div>
  )
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
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 7,
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'border-color 0.2s, box-shadow 0.2s, transform 0.2s',
        display: 'flex',
        flexDirection: 'column',
      }}
      onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'var(--red)'; el.style.boxShadow = '0 10px 26px rgb(41 43 41 / 7%)'; el.style.transform = 'translateY(-2px)' }}
      onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'var(--border)'; el.style.boxShadow = 'none'; el.style.transform = 'translateY(0)' }}
    >
      {/* Prompt — large, prominent. The duel's input, if it has one, sits
          beside it: a voter judging "animate this photo" needs the photo
          (owner, Sep 14). */}
      <div style={{ padding: '18px 20px 16px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{
          flex: 1, minWidth: 0,
          fontSize: 16, fontWeight: 500, color: 'var(--white)', lineHeight: 1.45,
          fontFamily: 'var(--font-body), sans-serif',
          overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          height: `calc(16px * 1.45 * 2)`,
        }}>
          {duel.prompt}
        </div>
        {duel.input_media?.url && /^(image|video)\//.test(duel.input_media.mediaType) && (
          <div title="Original input" style={{
            width: 48, height: 48, flexShrink: 0, borderRadius: 7, overflow: 'hidden',
            border: '1px solid var(--border2)', background: 'var(--surface2)',
          }}>
            {duel.input_media.mediaType.startsWith('image/')
              ? <img src={duel.input_media.url} alt="Original input" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              : <video src={duel.input_media.url} muted playsInline preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
          </div>
        )}
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
            // Older 3-model duels: the odd slot spans the bottom row
            // instead of leaving an empty cell (CC, July 19).
            gridColumn: slotCount === 3 && i === 2 ? '1 / -1' : undefined,
          }}>
            <SlotPreview slot={slot} />
            <div style={{
              position: 'absolute', top: 6, left: 6,
              background: 'var(--surface)', color: 'var(--muted2)',
              fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 3,
              fontFamily: 'var(--font-mono), monospace',
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
        }}>{slotCount <= 2 ? 'VS' : `${slotCount}-WAY`}</div>
      </div>

      {/* Footer — the CTA only. No vote count (owner, Oct 17): "1 票" and
          "2 票" told any visitor how few people vote; 最熱門 still sorts by
          votes without showing them. The type is the section's. */}
      <div style={{
        padding: '11px 20px', borderTop: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
        background: 'var(--surface)', fontFamily: 'var(--font-body), sans-serif',
      }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--red)' }}>
          {t('xvote.votebtn')} →
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
      padding: 14, fontSize: 12.5, color: 'var(--muted2)', lineHeight: 1.6,
      overflow: 'hidden', height: '100%',
      maskImage: 'linear-gradient(to bottom, black 60%, transparent 100%)',
    }}>
      {text.slice(0, 300)}
    </div>
  )
}
