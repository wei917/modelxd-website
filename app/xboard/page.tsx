'use client'
// app/leaderboard/page.tsx
// Leaderboard — unified catalog + ranking. Every enabled model from
// ai_models is listed; XD scores from /api/xboard are merged in by
// model id. Models with no votes show "—" for XD Score and sort to the
// bottom regardless of direction.

import { useEffect, useState, useRef, useMemo } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import Link from 'next/link'
import ProviderLogo from '../components/ProviderLogo'

// ── Types ────────────────────────────────────────────────────────────────────

type TokenRate = number | { default: number; by_level?: Record<string, number> }

interface ModelPricing {
  tokens?: {
    text_input?:    TokenRate
    cached_input?:  TokenRate
    image_input?:   TokenRate
    video_input?:   TokenRate
    audio_input?:   TokenRate
    text_output?:   TokenRate
    image_output?:  TokenRate
    audio_output?:  TokenRate
  }
  per_image?:        Record<string, number>
  per_video_second?: Record<string, number>
}

interface AIModel {
  id: string
  provider: string
  model_name: string
  display_name: string
  input_modalities: string[]
  output_modalities: string[]
  model_pricing: ModelPricing | null
  tags: string[]
  is_popular: boolean | null
  enabled: boolean
  released_at: string | null
}

interface LeaderboardEntry {
  modelId: string
  xdScore: number
  totalVotes: number
}

type FilterProvider = 'all' | 'openai' | 'google' | 'alibaba'
type FilterMode = 'all' | 'text' | 'image' | 'video'

// ── Helpers ──────────────────────────────────────────────────────────────────

const PROVIDER_LABELS: Record<string, string> = {
  openai:    'OpenAI',
  google:    'Google',
  alibaba:   'Alibaba',
  anthropic: 'Anthropic',
}

function fmtPrice(p: number | null): string {
  if (p == null) return '-'
  if (p < 0.01) return `$${p.toFixed(4)}`
  if (p < 1) return `$${p.toFixed(3)}`
  return `$${p.toFixed(2)}`
}

function fmtDate(iso: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

function primaryMode(m: AIModel): string {
  const out = m.output_modalities ?? []
  if (out.includes('video')) return 'video'
  if (out.includes('image')) return 'image'
  return 'text'
}

// Headline (rate-based) price — what providers publish.
// Reads from the unified `model_pricing` jsonb. Mode determines the
// preferred path: video → per_video_second; image → tokens.image_output
// then per_image; text → tokens.text_output.
/** Resolve a polymorphic TokenRate to its default rate for display. */
function rateNum(r: TokenRate | undefined): number | null {
  if (r == null) return null
  if (typeof r === 'number') return r
  return r.default ?? null
}

function headlinePrice(m: AIModel): number | null {
  const mode = primaryMode(m)
  const p = m.model_pricing ?? {}
  if (mode === 'video' && p.per_video_second) {
    const r = p.per_video_second
    return r['720p'] ?? r['default'] ?? Object.values(r)[0] ?? null
  }
  if (mode === 'image') {
    const imgOut = rateNum(p.tokens?.image_output)
    if (imgOut != null) return imgOut
    if (p.per_image) {
      const r = p.per_image
      return r['medium'] ?? r['default'] ?? Object.values(r)[0] ?? null
    }
    return null
  }
  return rateNum(p.tokens?.text_output)
}

// Industry-standard rate display, split into amount + unit so the
// slash separator can be vertically aligned across rows.
//   text                          → $X / 1M output tokens
//   image (token-billed)          → $X / 1M output image tokens
//   image (per-image flat-billed) → $X / image (medium quality)
//   video                         → $X / sec at 720p
function priceParts(m: AIModel): { amount: string; unit: string } | null {
  const mode = primaryMode(m)
  const v = headlinePrice(m)
  if (v == null) return null
  const p = m.model_pricing ?? {}
  let unit: string
  if (mode === 'video')                                            unit = 'sec'
  else if (mode === 'image' && rateNum(p.tokens?.image_output) != null) unit = '1M'
  else if (mode === 'image')                                       unit = 'image'
  else                                                             unit = '1M'
  return { amount: fmtPrice(v), unit }
}

type SortKey = 'name' | 'provider' | 'released' | 'price' | 'xdScore'
type SortDir = 'asc' | 'desc'

interface MergedRow extends AIModel {
  xdScore: number | null
}

function sortValue(m: MergedRow, key: SortKey): string | number | null {
  switch (key) {
    case 'name':     return m.display_name?.toLowerCase() ?? null
    case 'provider': return m.provider?.toLowerCase() ?? null
    case 'released': return m.released_at ?? null
    case 'price':    return headlinePrice(m)
    case 'xdScore':  return m.xdScore
  }
}

function modalityBadge(mod: string): { label: string; color: string; bg: string } {
  switch (mod) {
    case 'text':  return { label: 'Text',  color: '#6b6860', bg: 'rgba(107,104,96,0.1)' }
    case 'image': return { label: 'Image', color: '#8b5cf6', bg: 'rgba(139,92,246,0.08)' }
    case 'video': return { label: 'Video', color: '#f59e0b', bg: 'rgba(245,158,11,0.08)' }
    case 'audio': return { label: 'Audio', color: '#06b6d4', bg: 'rgba(6,182,212,0.08)' }
    default:      return { label: mod,     color: '#6b6860', bg: 'rgba(107,104,96,0.1)' }
  }
}

function scoreColor(score: number | null): string {
  if (score == null) return 'var(--muted)'
  if (score > 1000) return 'var(--green)'
  if (score < 1000) return 'var(--red)'
  return 'var(--muted2)'
}

/** Heatmap tier for the XD score chip. Five buckets:
 *    poor   < 950
 *    fair   950–1000
 *    mid    1000–1050
 *    good   1050–1100
 *    elite  > 1100   */
function scoreTier(score: number | null): 'poor' | 'fair' | 'mid' | 'good' | 'elite' | null {
  if (score == null) return null
  if (score < 950)  return 'poor'
  if (score < 1000) return 'fair'
  if (score < 1050) return 'mid'
  if (score < 1100) return 'good'
  return 'elite'
}

// ── Component ────────────────────────────────────────────────────────────────

export default function LeaderboardPage() {
  const [models, setModels] = useState<AIModel[]>([])
  const [scores, setScores] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [filterProvider, setFilterProvider] = useState<FilterProvider>('all')
  const [filterMode, setFilterMode] = useState<FilterMode>('all')
  const [search, setSearch] = useState('')
  // Default: highest XD score first.
  const [sortBy, setSortBy] = useState<SortKey>('xdScore')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
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

  // Load enabled models + XD scores in parallel.
  useEffect(() => {
    const sb = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    )
    const modelsP = sb.from('ai_models')
      .select('*')
      .eq('enabled', true)
      .then(({ data }) => (data as AIModel[]) ?? [])

    const scoresP = fetch('/api/xboard?mode=all')
      .then(r => r.ok ? r.json() as Promise<LeaderboardEntry[]> : [])
      .catch(() => [] as LeaderboardEntry[])

    Promise.all([modelsP, scoresP]).then(([ms, ss]) => {
      setModels(ms)
      const map: Record<string, number> = {}
      for (const e of ss) map[e.modelId] = e.xdScore
      setScores(map)
      setLoading(false)
    })
  }, [])

  const merged: MergedRow[] = useMemo(
    () => models.map(m => ({ ...m, xdScore: scores[m.id] ?? null })),
    [models, scores],
  )

  const filtered = useMemo(() => {
    let list = merged
    if (filterProvider !== 'all') list = list.filter(m => m.provider === filterProvider)
    if (filterMode !== 'all') list = list.filter(m => primaryMode(m) === filterMode)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(m =>
        m.display_name.toLowerCase().includes(q) ||
        m.model_name.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q) ||
        (m.tags ?? []).some(t => t.toLowerCase().includes(q))
      )
    }
    const dir = sortDir === 'asc' ? 1 : -1
    // Nulls always sort to the bottom regardless of direction.
    const cmp = (a: MergedRow, b: MergedRow): number => {
      const va = sortValue(a, sortBy)
      const vb = sortValue(b, sortBy)
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
      return String(va).localeCompare(String(vb)) * dir
    }
    return [...list].sort(cmp)
  }, [merged, filterProvider, filterMode, search, sortBy, sortDir])

  const handleSort = (k: SortKey) => {
    if (sortBy === k) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(k)
      // Score and price feel right starting DESC; alphabetical fields ASC.
      setSortDir(k === 'xdScore' || k === 'price' || k === 'released' ? 'desc' : 'asc')
    }
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: models.length }
    for (const m of models) c[m.provider] = (c[m.provider] ?? 0) + 1
    return c
  }, [models])

  const modeCounts = useMemo(() => {
    const c: Record<string, number> = { all: models.length }
    for (const m of models) {
      const mode = primaryMode(m)
      c[mode] = (c[mode] ?? 0) + 1
    }
    return c
  }, [models])

  return (
    <>
      <div className="cursor" ref={cursorRef} />
      <div className="cursor-ring" ref={ringRef} />

      <div className="xduel-page">
        <div className="arena">

          {/* Eyebrow + big title live in the content TopBar (TITLES map,
              accentX renders the leading X in red). */}
          <div className="prompt-sub">
            The ModelXD leaderboard — every model, ranked by XDRating from community blind comparisons.
            <Link href="/methodology" style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 11, color: 'var(--red)', letterSpacing: '0.08em', textDecoration: 'none', marginLeft: 12 }}>
              HOW SCORING WORKS →
            </Link>
          </div>

          {/* Search bar */}
          <div style={{ marginTop: 24, marginBottom: 20 }}>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search models..."
              style={{
                width: '100%', maxWidth: 400, padding: '10px 16px',
                background: 'var(--surface)', border: '1px solid var(--border2)',
                borderRadius: 6, color: 'var(--white)',
                fontFamily: 'var(--font-body), sans-serif', fontSize: 14,
                outline: 'none', transition: 'border-color 0.2s',
              }}
              onFocus={e => e.currentTarget.style.borderColor = 'var(--red)'}
              onBlur={e => e.currentTarget.style.borderColor = ''}
            />
          </div>

          {/* Filters */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
            {/* Provider filter */}
            <div style={{ display: 'flex', gap: 1, background: 'var(--border)', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', width: 'fit-content' }}>
              {(['all', 'openai', 'google', 'alibaba'] as FilterProvider[]).map(p => (
                <button key={p} onClick={() => setFilterProvider(p)}
                  style={{
                    fontFamily: 'var(--font-mono), monospace', fontSize: 11, padding: '8px 16px',
                    background: filterProvider === p ? 'var(--bg)' : 'var(--surface)',
                    color: filterProvider === p ? 'var(--white)' : 'var(--muted2)',
                    border: 'none', cursor: 'pointer', letterSpacing: '0.08em', textTransform: 'uppercase',
                    transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                  {p === 'all' ? 'All' : PROVIDER_LABELS[p] ?? p}
                  <span style={{
                    fontSize: 9, color: filterProvider === p ? 'var(--muted2)' : 'var(--muted)',
                    fontWeight: 600,
                  }}>
                    {counts[p] ?? 0}
                  </span>
                </button>
              ))}
            </div>

            {/* Mode filter */}
            <div className="mode-selector" style={{ marginBottom: 0 }}>
              {(['all', 'text', 'image', 'video'] as FilterMode[]).map(m => (
                <button key={m} onClick={() => setFilterMode(m)}
                  className={`mode-btn${filterMode === m ? ' active' : ''}`}>
                  <span className={`mode-dot${filterMode === m ? ' active' : ''}`} />
                  {m === 'all' ? 'all' : m}
                  <span style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 600 }}>
                    {modeCounts[m] ?? 0}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Results count */}
          <div style={{
            fontFamily: 'var(--font-mono), monospace', fontSize: 11, color: 'var(--muted)',
            letterSpacing: '0.08em', marginBottom: 16, marginTop: 20,
          }}>
            {filtered.length} MODEL{filtered.length !== 1 ? 'S' : ''}
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 80 }}>Loading...</div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 80 }}>
              No models match your filters.
            </div>
          ) : filterMode === 'all' ? (
            // ── Mixing text / image / video on one ranked list isn't useful
            // — a text model and a video model can't be compared. When the
            // user has the "All" filter on, group rows into three sections
            // (text, image, video). Each section gets its own header so it
            // stays sortable. Sections with zero rows are hidden.
            <>
              {(['text', 'image', 'video'] as const).map(group => {
                const rows = filtered.filter(m => primaryMode(m) === group)
                if (rows.length === 0) return null
                const groupAccent = group === 'video'
                  ? 'var(--mode-video)'
                  : group === 'image'
                    ? 'var(--mode-image)'
                    : 'var(--mode-text)'
                return (
                  <div key={group} style={{ marginBottom: 28 }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '0 4px 10px',
                      fontFamily: 'var(--font-mono), monospace',
                      fontSize: 11, fontWeight: 700, letterSpacing: '0.18em',
                      textTransform: 'uppercase', color: 'var(--muted2)',
                    }}>
                      <span style={{ color: groupAccent }}>● {group}</span>
                      <span style={{ color: 'var(--muted)', fontWeight: 500 }}>
                        {rows.length} model{rows.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <LeaderboardTable
                      rows={rows}
                      sortBy={sortBy}
                      sortDir={sortDir}
                      onSort={handleSort}
                    />
                  </div>
                )
              })}
            </>
          ) : (
            <LeaderboardTable
              rows={filtered}
              sortBy={sortBy}
              sortDir={sortDir}
              onSort={handleSort}
            />
          )}

        </div>
      </div>
    </>
  )
}

// ── Row ──────────────────────────────────────────────────────────────────────

function ModelRow({ model: m }: { model: MergedRow }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '2fr 130px 100px 100px 130px 90px 140px',
        gap: 0, padding: '12px 20px',
        background: 'var(--bg)',
        alignItems: 'center',
        transition: 'background 0.12s',
      }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface)'}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'var(--bg)'}
    >
      {/* Model name */}
      <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 17, fontWeight: 400, color: 'var(--white)', fontFamily: 'var(--font-body), sans-serif' }}>
          {m.display_name}
        </span>
      </div>

      {/* XD Score — rendered as a heatmap chip when present. Scores carry
          most of the page's information density, so the colour weight goes
          here rather than on surrounding chrome. */}
      <div style={{ textAlign: 'right', paddingRight: 32 }}>
        {m.xdScore != null ? (
          <span className={`xd-chip ${scoreTier(m.xdScore)}`}>
            {m.xdScore}
          </span>
        ) : (
          <span style={{
            fontSize: 13, color: 'var(--muted)',
            fontFamily: 'var(--font-mono), monospace', fontWeight: 600,
          }}>—</span>
        )}
      </div>

      {/* Provider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <ProviderLogo provider={m.provider} size={14} />
        <span style={{
          fontSize: 12, color: 'var(--muted2)', fontFamily: 'var(--font-body), sans-serif',
          fontWeight: 600, textTransform: 'capitalize',
        }}>
          {PROVIDER_LABELS[m.provider] ?? m.provider}
        </span>
      </div>

      {/* Released */}
      <div style={{
        fontSize: 12, color: m.released_at ? 'var(--muted2)' : 'var(--muted)',
        fontFamily: 'var(--font-mono), monospace', fontWeight: 500,
      }}>
        {fmtDate(m.released_at)}
      </div>

      {/* Input modalities */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {(m.input_modalities ?? []).map(mod => {
          const b = modalityBadge(mod)
          return (
            <span key={mod} style={{
              fontSize: 10, color: b.color, background: b.bg,
              padding: '2px 7px', borderRadius: 4, fontWeight: 600,
              fontFamily: 'var(--font-mono), monospace',
            }}>
              {b.label}
            </span>
          )
        })}
      </div>

      {/* Output modalities */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {(m.output_modalities ?? []).map(mod => {
          const b = modalityBadge(mod)
          return (
            <span key={mod} style={{
              fontSize: 10, color: b.color, background: b.bg,
              padding: '2px 7px', borderRadius: 4, fontWeight: 600,
              fontFamily: 'var(--font-mono), monospace',
            }}>
              {b.label}
            </span>
          )
        })}
      </div>

      {/* Price (industry-standard rate, slash-aligned across rows) */}
      <div style={{
        textAlign: 'right', fontSize: 12, color: 'var(--white)',
        fontFamily: 'var(--font-mono), monospace', fontWeight: 600,
      }}>
        {(() => {
          const p = priceParts(m)
          if (!p) return '-'
          return (
            <>
              <span style={{ display: 'inline-block', minWidth: 56, textAlign: 'right' }}>
                {p.amount}
              </span>
              <span style={{ display: 'inline-block', minWidth: 56, textAlign: 'left', color: 'var(--muted)', paddingLeft: 6 }}>
                / {p.unit}
              </span>
            </>
          )
        })()}
      </div>
    </div>
  )
}

// ── Table renderer (header + rows) ──────────────────────────────────────────
//
// Pulled into its own component so the page can render multiple instances
// stacked, one per output-modality group, without duplicating the header
// template. Each instance keeps the same sort state and column widths.

function LeaderboardTable({
  rows, sortBy, sortDir, onSort,
}: {
  rows:    MergedRow[]
  sortBy:  SortKey
  sortDir: SortDir
  onSort:  (k: SortKey) => void
}) {
  return (
    // Outer scroller — the table needs ~790px of width to render cleanly.
    // On mobile (≤760px), horizontal scroll preserves the dense layout
    // rather than mangling the column alignment.
    <div style={{ overflowX: 'auto' as const, WebkitOverflowScrolling: 'touch' as const, border: '1px solid var(--border)', borderRadius: 8 }}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: 'var(--border)', minWidth: 790 }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '2fr 130px 100px 100px 130px 90px 140px',
        gap: 0, padding: '10px 20px',
        fontSize: 10, color: 'var(--muted)', fontWeight: 700,
        letterSpacing: '0.12em', textTransform: 'uppercase',
        fontFamily: 'var(--font-mono), monospace',
        background: 'var(--surface)',
      }}>
        <SortHeader label="Model"     sortKey="name"     active={sortBy} dir={sortDir} onSort={onSort} />
        <SortHeader label="XD Score"  sortKey="xdScore"  active={sortBy} dir={sortDir} onSort={onSort} align="right" />
        <SortHeader label="Provider"  sortKey="provider" active={sortBy} dir={sortDir} onSort={onSort} />
        <SortHeader label="Released"  sortKey="released" active={sortBy} dir={sortDir} onSort={onSort} />
        <span>Input</span>
        <span>Output</span>
        <SortHeader label="Price"     sortKey="price"    active={sortBy} dir={sortDir} onSort={onSort} align="right" />
      </div>
      {rows.map(m => <ModelRow key={m.id} model={m} />)}
    </div>
    </div>
  )
}

// ── Sortable header ──────────────────────────────────────────────────────────

function SortHeader({
  label, sortKey, active, dir, onSort, align = 'left',
}: {
  label: string
  sortKey: SortKey
  active: SortKey
  dir: SortDir
  onSort: (k: SortKey) => void
  align?: 'left' | 'right'
}) {
  const isActive = active === sortKey
  return (
    <button
      onClick={() => onSort(sortKey)}
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
        background: 'transparent', border: 'none', padding: 0,
        // The XD Score and Price row cells use a 32px right padding so the
        // chip / number doesn't kiss the next column. Mirror it on the
        // right-aligned headers so labels stay above their data.
        paddingRight: align === 'right' ? 32 : 0,
        cursor: 'pointer',
        fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 'inherit',
        letterSpacing: 'inherit', textTransform: 'inherit',
        color: isActive ? 'var(--white)' : 'var(--muted)',
        transition: 'color 0.12s',
      }}
      onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.color = 'var(--muted2)' }}
      onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.color = 'var(--muted)' }}
    >
      <span>{label}</span>
      <span style={{
        fontSize: 8,
        opacity: isActive ? 1 : 0.3,
        color: isActive ? 'var(--green)' : 'inherit',
      }}>
        {isActive ? (dir === 'asc' ? '▲' : '▼') : '▲'}
      </span>
    </button>
  )
}
