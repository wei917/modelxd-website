'use client'
// app/xboard/page.tsx
// XBoard — unified catalog + ranking. Every enabled model from
// ai_models is listed; XD scores from /api/xboard are merged in by
// model id. Models with no votes show "—" for XD Score and sort to the
// bottom regardless of direction.

import { useEffect, useState, useRef, useMemo } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import Link from 'next/link'
import ProviderLogo from '../components/ProviderLogo'
import { useT } from '../../lib/i18n'

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
  modes: string[] | null
  output_config: { text?: { capabilities?: string[] } } | null
  tags: string[]
  is_popular: boolean | null
  enabled: boolean
  released_at: string | null
}

interface LeaderboardEntry {
  modelId: string
  qualityScore: number
  xdScore: number
  early: boolean
  provisional: boolean
}

type FilterMode = 'text' | 'image' | 'video'

/**
 * Subtype of the selected category (CC, Aug 2: no separate boards — every
 * special view is a subtype of its modality, the way video has text-to-video
 * and video-edit).
 *
 *   text  → 'text_to_text' | 'search' | 'werewolf'
 *   image → 'all' | any image recipe mode present in the catalog
 *   video → 'all' | any video recipe mode present in the catalog
 *
 * Three different mechanics behind one row of chips: image/video subtypes
 * filter the CATALOG by declared modes (same pool of numbers); 'search'
 * swaps in the text_search rating pool (supabase/62 — answering from memory
 * and answering after eight searches are different skills, so the scores
 * never mix); 'werewolf' swaps the table itself for the XTalk game
 * scoreboard, which is not a rating at all.
 */
type Subtype = string

/**
 * Subtype groups for image/video, in display order: chip key (labelled by
 * its recipe.* string) → the catalog modes it covers. A group appears when
 * any of its modes exists in the category.
 */
const SUBTYPE_GROUPS: [string, string[]][] = [
  ['text_to_image',  ['text_to_image']],
  ['image_edit',     ['image_edit']],
  ['text_to_video',  ['text_to_video']],
  ['image_to_video', ['image_to_video', 'reference_frames', 'start_end_frames']],
  ['video_edit',     ['video_edit', 'video_to_video']],
]

/** Modes covered by a subtype chip ('text_to_text' covers itself). */
const subtypeModes = (key: string): string[] =>
  SUBTYPE_GROUPS.find(([k]) => k === key)?.[1] ?? [key]

/** One aggregate row from /api/xboard/werewolf. */
type WWRow = {
  modelId: string
  games: number
  wins: number
  wolfGames: number
  wolfWins: number
  villageGames: number
  villageWins: number
  survived: number
}

const canSearch = (m: AIModel) =>
  (m.output_config?.text?.capabilities ?? []).includes('web_search')

// Below this many rating signals the search board is labelled provisional.
// Counted in VOTES, not duels: one duel contributes two signals per seat
// (quality and value), and a user who votes in round one but not round two
// contributes one — so votes cannot be divided back into a reliable duel
// count. Showing the number we actually have beats showing a tidier one we
// would be guessing. 60 signals is roughly 30 duels.
const PROVISIONAL_BELOW = 60

// ── Helpers ──────────────────────────────────────────────────────────────────

const PROVIDER_LABELS: Record<string, string> = {
  openai:    'OpenAI',
  google:    'Google',
  alibaba:   'Alibaba',
  anthropic: 'Anthropic',
  xai:       'xAI',
  runway:    'Runway',
  moonshot:  'Moonshot',
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

type SortKey = 'name' | 'provider' | 'released' | 'price' | 'quality' | 'xdScore'
type SortDir = 'asc' | 'desc'

interface MergedRow extends AIModel {
  qualityScore: number | null
  xdScore: number | null
  /** Rating rests on very few votes. The count itself stays server-side. */
  early: boolean
}

function sortValue(m: MergedRow, key: SortKey): string | number | null {
  switch (key) {
    case 'name':     return m.display_name?.toLowerCase() ?? null
    case 'provider': return m.provider?.toLowerCase() ?? null
    case 'released': return m.released_at ?? null
    case 'price':    return headlinePrice(m)
    case 'quality':  return m.qualityScore
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
  const t = useT()
  const [models, setModels] = useState<AIModel[]>([])
  const [scores, setScores] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  // Multi-select provider filter (CC, July 19): empty = all providers.
  // A dropdown, not buttons — the provider list will keep growing.
  const [selectedProviders, setSelectedProviders] = useState<string[]>([])
  const [providerMenuOpen, setProviderMenuOpen] = useState(false)
  const providerMenuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!providerMenuOpen) return
    const close = (e: MouseEvent) => {
      if (!providerMenuRef.current?.contains(e.target as Node)) setProviderMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [providerMenuOpen])
  const [filterMode, setFilterMode] = useState<FilterMode>('text')
  const [subtype, setSubtype] = useState<Subtype>('all')
  const [ww, setWw] = useState<{ totalGames: number; rows: WWRow[] } | null>(null)
  const [early, setEarly] = useState<Record<string, boolean>>({})
  const [poolProvisional, setPoolProvisional] = useState(false)
  const [search, setSearch] = useState('')
  // Default: highest XD score first.
  const [qualityScores, setQualityScores] = useState<Record<string, number>>({})
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

    modelsP.then(ms => { setModels(ms); setLoading(false) })
  }, [])

  // The search pool and the werewolf scoreboard only exist inside text.
  const searchPool = filterMode === 'text' && subtype === 'search'
  const wolfBoard  = filterMode === 'text' && subtype === 'werewolf'

  // Scores load separately from the catalog: switching pools swaps the
  // numbers, not the model list, so the catalog must not be re-fetched.
  useEffect(() => {
    let stale = false
    fetch(`/api/xboard?mode=${searchPool ? 'text_search' : filterMode}`)
      .then(r => r.ok ? r.json() as Promise<LeaderboardEntry[]> : [])
      .catch(() => [] as LeaderboardEntry[])
      .then((ss: LeaderboardEntry[]) => {
        if (stale) return
        const map: Record<string, number> = {}
        const qmap: Record<string, number> = {}
        const vmap: Record<string, boolean> = {}
        for (const e of ss) {
          map[e.modelId] = e.xdScore
          vmap[e.modelId] = e.early
          if (e.qualityScore != null) qmap[e.modelId] = e.qualityScore
        }
        setScores(map)
        setQualityScores(qmap)
        setEarly(vmap)
        setPoolProvisional(ss.some(e => e.provisional))
      })
    return () => { stale = true }
  }, [searchPool, filterMode])

  // Werewolf standings — fetched on first visit to the subtype.
  useEffect(() => {
    if (!wolfBoard || ww !== null) return
    fetch('/api/xboard/werewolf')
      .then(r => r.ok ? r.json() : { totalGames: 0, rows: [] })
      .catch(() => ({ totalGames: 0, rows: [] }))
      .then(setWw)
  }, [wolfBoard, ww])

  const merged: MergedRow[] = useMemo(
    () => models.map(m => ({ ...m, qualityScore: qualityScores[m.id] ?? null, xdScore: scores[m.id] ?? null, early: early[m.id] ?? false })),
    [models, scores, qualityScores, early],
  )

  const filtered = useMemo(() => {
    let list = merged
    // The search sub-board lists only models that CAN search. Showing the
    // rest with a dash would read as "ranked last", not "not eligible".
    if (searchPool) list = list.filter(canSearch)
    // Recipe-mode subtypes filter the catalog by declared modes ('search'
    // and 'werewolf' are not recipe modes — they swap pools/tables instead).
    // A chip is a GROUP: any covered mode counts.
    if (subtype !== 'all' && subtype !== 'search' && subtype !== 'werewolf') {
      const covered = subtypeModes(subtype)
      list = list.filter(m => (m.modes ?? []).some(x => covered.includes(x)))
    }
    if (selectedProviders.length > 0) list = list.filter(m => selectedProviders.includes(m.provider))
    list = list.filter(m => primaryMode(m) === filterMode)
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
  }, [merged, selectedProviders, filterMode, search, sortBy, sortDir, searchPool, subtype])

  const handleSort = (k: SortKey) => {
    if (sortBy === k) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(k)
      // Score and price feel right starting DESC; alphabetical fields ASC.
      setSortDir(k === 'xdScore' || k === 'quality' || k === 'price' || k === 'released' ? 'desc' : 'asc')
    }
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: models.length }
    for (const m of models) c[m.provider] = (c[m.provider] ?? 0) + 1
    return c
  }, [models])

  // Every provider present in the catalog, alphabetical — new companies
  // show up in the dropdown automatically.
  const providerList = useMemo(
    () => [...new Set(models.map(m => m.provider))].sort(),
    [models],
  )

  const modeCounts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const m of models) {
      const mode = primaryMode(m)
      c[mode] = (c[mode] ?? 0) + 1
    }
    return c
  }, [models])

  // Which subtype chips the selected category offers. Image/video chips are
  // discovered from the catalog's declared modes so a new recipe shows up
  // here without a code change; text's three are fixed by design.
  const subtypeChips = useMemo((): [Subtype, string][] => {
    const all: [Subtype, string] = ['all', t('common.all')]
    if (filterMode === 'text') {
      return [
        all,
        ['text_to_text', t('recipe.text_to_text')],
        ['search',       t('xboard.text.search')],
        ['werewolf',     t('xt.tpl.werewolf.name')],
      ]
    }
    const present = new Set(
      models.filter(m => primaryMode(m) === filterMode).flatMap(m => m.modes ?? []),
    )
    return [
      all,
      ...SUBTYPE_GROUPS
        .filter(([, covered]) => covered.some(x => present.has(x)))
        .map(([k]) => [k, t('recipe.' + k)] as [Subtype, string]),
    ]
  }, [filterMode, models, t])

  return (
    <>
      <div className="cursor" ref={cursorRef} />
      <div className="cursor-ring" ref={ringRef} />

      <div className="xduel-page">
        <div className="arena">

          {/* In-page header: "// XBOARD" eyebrow + big headline (CC, July 20). */}
          <Link href="/xboard" className="prompt-label eyebrow" style={{ textDecoration: 'none', display: 'inline-block' }}>{t('xboard.eyebrow')}</Link>
          <h1 className="page-headline">
            {t('xboard.subtitle')}
            <Link href="/methodology" style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 12, color: 'var(--red)', letterSpacing: '0.08em', textDecoration: 'none', marginLeft: 14, whiteSpace: 'nowrap' }}>
              {t('xboard.how').toUpperCase()} →
            </Link>
          </h1>

          {/* Page-local layout: subtype rail + content. NOT the app nav —
              a second, in-page menu (CC, Aug 2): subtypes will multiply, and
              a vertical list scales where a chip row wraps into soup. */}
          <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', marginTop: 24 }}>
            <aside style={{
              width: 148, flexShrink: 0, position: 'sticky', top: 24,
              borderLeft: '1px solid var(--border2)',
            }}>
              <div style={{
                fontFamily: 'var(--font-mono), monospace', fontSize: 9, fontWeight: 700,
                letterSpacing: '0.18em', textTransform: 'uppercase',
                color: 'var(--muted)', padding: '2px 0 9px 14px',
              }}>
                {t('mode.' + filterMode)}
              </div>
              {subtypeChips.map(([key, label]) => {
                const active = subtype === key
                return (
                  <button key={key} onClick={() => setSubtype(key)} style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '6px 0 6px 13px', border: 'none', borderRadius: 0,
                    borderLeft: `2px solid ${active ? 'var(--red)' : 'transparent'}`,
                    marginLeft: -1, cursor: 'none', fontFamily: 'inherit', fontSize: 12.5,
                    background: 'transparent',
                    color: active ? 'var(--red)' : 'var(--muted2)',
                    fontWeight: active ? 700 : 400,
                    transition: 'color 0.12s, border-color 0.12s',
                  }}
                    onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.color = 'var(--white)' }}
                    onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.color = 'var(--muted2)' }}
                  >{label}</button>
                )
              })}
            </aside>

            <div style={{ flex: 1, minWidth: 0 }}>

          {/* Search bar */}
          <div style={{ marginBottom: 20 }}>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('xboard.search')}
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
            {/* Provider filter — multi-select dropdown (empty = all). */}
            <div ref={providerMenuRef} style={{ position: 'relative' }}>
              <button
                onClick={() => setProviderMenuOpen(o => !o)}
                className="provider-filter-btn"
              >
                {t('xboard.providers')}
                <span style={{ color: 'var(--white)' }}>
                  {selectedProviders.length === 0
                    ? t('common.all')
                    : selectedProviders.length <= 2
                      ? selectedProviders.map(p => PROVIDER_LABELS[p] ?? p).join(', ')
                      : `${selectedProviders.length} selected`}
                </span>
                <span style={{ fontSize: 8 }}>▼</span>
              </button>
              {providerMenuOpen && (
                <div className="provider-filter-menu">
                  <button
                    className={`provider-filter-item ${selectedProviders.length === 0 ? 'active' : ''}`}
                    onClick={() => setSelectedProviders([])}
                  >
                    <span className="provider-filter-check">{selectedProviders.length === 0 ? '✓' : ''}</span>
                    {t('xboard.allproviders')}
                    <span className="provider-filter-count">{counts.all ?? 0}</span>
                  </button>
                  {providerList.map(p => {
                    const on = selectedProviders.includes(p)
                    return (
                      <button
                        key={p}
                        className={`provider-filter-item ${on ? 'active' : ''}`}
                        onClick={() => setSelectedProviders(prev =>
                          on ? prev.filter(x => x !== p) : [...prev, p],
                        )}
                      >
                        <span className="provider-filter-check">{on ? '✓' : ''}</span>
                        <ProviderLogo provider={p} size={13} />
                        {PROVIDER_LABELS[p] ?? p}
                        <span className="provider-filter-count">{counts[p] ?? 0}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Category filter. Picking a category resets its subtype to
                the default so a leftover 'werewolf' can't leak into video. */}
            <div className="mode-seg">
              {(['text', 'image', 'video'] as FilterMode[]).map(m => (
                <button key={m}
                  onClick={() => { setFilterMode(m); setSubtype('all') }}
                  className={`mode-seg-btn${filterMode === m ? ' active' : ''}`}>
                  <span className={`mode-dot${filterMode === m ? ' active' : ''}`} />
                  {t('mode.' + m)}
                  <span style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 600 }}>
                    {modeCounts[m] ?? 0}
                  </span>
                </button>
              ))}
            </div>

          </div>

          {!wolfBoard ? <>
          {/* Results count */}
          <div style={{
            fontFamily: 'var(--font-mono), monospace', fontSize: 11, color: 'var(--muted)',
            letterSpacing: '0.08em', marginBottom: 16, marginTop: 20,
          }}>
            {t('xboard.modelcount').replace('{n}', String(filtered.length)).toUpperCase()}
          </div>

          {searchPool && (() => {
            // Whether the pool is still thin. The API decides this and sends a
            // boolean — the counts themselves never reach the browser
            // (owner, Aug 26: "that's our secret").
            return (
              <div style={{
                border: '1px solid var(--border2)', borderRadius: 9, padding: '10px 13px',
                marginBottom: 16, fontSize: 12, lineHeight: 1.5, color: 'var(--muted2)',
                background: 'var(--surface)',
              }}>
                {poolProvisional && (
                  <strong style={{ color: 'var(--red)', marginRight: 6 }}>
                    {t('xboard.provisional')}
                  </strong>
                )}
                {t('xboard.board.search.note')}
              </div>
            )
          })()}

          {loading ? (
            <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 80 }}>Loading...</div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 80 }}>
              No models match your filters.
            </div>
          ) : (
            <LeaderboardTable
              rows={filtered}
              sortBy={sortBy}
              sortDir={sortDir}
              onSort={handleSort}
            />
          )}
          </> : (
            <WerewolfBoard
              ww={ww}
              models={models}
              providers={selectedProviders}
              search={search}
            />
          )}

            </div>
          </div>

        </div>
      </div>
    </>
  )
}

// ── Model name with instant overflow tooltip ────────────────────────────────

function NameCell({ name }: { name: string }) {
  const [tip, setTip] = useState(false)
  return (
    <span
      style={{ position: 'relative', minWidth: 0, flex: 1, display: 'block' }}
      onMouseEnter={e => {
        const s = e.currentTarget.firstElementChild as HTMLElement | null
        if (s && s.scrollWidth > s.clientWidth) setTip(true)
      }}
      onMouseLeave={() => setTip(false)}
    >
      <span style={{
        display: 'block', fontSize: 14, fontWeight: 500, color: 'var(--white)',
        fontFamily: 'var(--font-body), sans-serif',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{name}</span>
      {tip && (
        <span style={{
          position: 'absolute', left: 0, top: 'calc(100% + 5px)', zIndex: 60,
          background: '#141310', color: '#fff', padding: '4px 9px',
          borderRadius: 6, fontSize: 12, whiteSpace: 'nowrap',
          boxShadow: '0 4px 14px rgba(0,0,0,.25)', pointerEvents: 'none',
        }}>{name}</span>
      )}
    </span>
  )
}

// ── Row ──────────────────────────────────────────────────────────────────────

function ModelRow({ model: m }: { model: MergedRow }) {
  const t = useT()
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '2fr 100px 130px 100px 100px 130px 140px',
        gap: 0, padding: '12px 20px',
        background: 'var(--bg)',
        alignItems: 'center',
        transition: 'background 0.12s',
      }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface)'}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'var(--bg)'}
    >
      {/* Model name — one line, always. Smaller face + a wider column
          beats a taller row of wrapped text (CC, Aug 2). */}
      <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        <NameCell name={m.display_name} />
      </div>

      {/* Quality — blind-vote-only rating (price never seen). Plain mono
          number: the XD chip next door keeps the colour weight. */}
      <div style={{ textAlign: 'right', paddingRight: 32, fontSize: 13, fontFamily: 'var(--font-mono), monospace', fontWeight: 600, color: 'var(--muted2)' }}>
        {m.qualityScore != null ? m.qualityScore : '—'}
      </div>

      {/* XD Score — rendered as a heatmap chip when present. Scores carry
          most of the page's information density, so the colour weight goes
          here rather than on surrounding chrome. */}
      <div style={{ textAlign: 'right', paddingRight: 32 }}>
        {m.xdScore != null ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            {/* Low-sample honesty (owner, Aug 18): a thin rating must not
                read as a verdict. Under 10 blind votes, say so right where
                the score is — but NOT how many (owner, Aug 26: the vote
                counts are ours, not the public's). "Early" carries the
                caveat; the number carried our sample size. */}
            {m.early && (
              <span
                title={t('xboard.early.title')}
                style={{
                  fontSize: 10, fontFamily: 'var(--font-mono), monospace', fontWeight: 600,
                  color: 'var(--muted)', border: '1px dashed var(--border2)',
                  borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap',
                }}
              >{t('xboard.early')}</span>
            )}
            <span className={`xd-chip ${scoreTier(m.xdScore)}`}>
              {m.xdScore}
            </span>
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
  const t = useT()
  return (
    // Outer scroller — the table needs ~790px of width to render cleanly.
    // On mobile (≤760px), horizontal scroll preserves the dense layout
    // rather than mangling the column alignment.
    <div style={{ overflowX: 'auto' as const, WebkitOverflowScrolling: 'touch' as const, border: '1px solid var(--border)', borderRadius: 8 }}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: 'var(--border)', minWidth: 820 }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '2fr 100px 130px 100px 100px 130px 140px',
        gap: 0, padding: '10px 20px',
        fontSize: 10, color: 'var(--muted)', fontWeight: 700,
        letterSpacing: '0.12em', textTransform: 'uppercase',
        fontFamily: 'var(--font-mono), monospace',
        background: 'var(--surface)',
      }}>
        <SortHeader label={t('xboard.col.model')}     sortKey="name"     active={sortBy} dir={sortDir} onSort={onSort} />
        <SortHeader label={t('xboard.col.quality')} sortKey="quality" active={sortBy} dir={sortDir} onSort={onSort} align="right" />
        <SortHeader label="XD Score"  sortKey="xdScore"  active={sortBy} dir={sortDir} onSort={onSort} align="right" />
        <SortHeader label={t('xboard.col.provider')}  sortKey="provider" active={sortBy} dir={sortDir} onSort={onSort} />
        <SortHeader label={t('xboard.col.released')}  sortKey="released" active={sortBy} dir={sortDir} onSort={onSort} />
        <span>{t('xboard.col.input')}</span>
        <SortHeader label={t('xboard.col.price')}     sortKey="price"    active={sortBy} dir={sortDir} onSort={onSort} align="right" />
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

// ── Werewolf scoreboard ──────────────────────────────────────────────────────
//
// Game results, not ratings. Rows come pre-aggregated from
// /api/xboard/werewolf; the model catalog the page already holds supplies
// names and logos, so a model that was disabled since its games simply
// drops off — same rule the ranking board applies.

// Below this many finished games the whole board is labelled provisional.
const WW_PROVISIONAL_BELOW = 30

function WerewolfBoard({
  ww, models, providers, search,
}: {
  ww: { totalGames: number; rows: WWRow[] } | null
  models: AIModel[]
  providers: string[]
  search: string
}) {
  const t = useT()
  const byId = useMemo(() => new Map(models.map(m => [m.id, m])), [models])

  // XD scores from the 'werewolf' rating pool (supabase/65): each game's
  // team result is decomposed into winner-beats-loser pairs and fitted with
  // the same Bradley-Terry as every other board. Win rate stays as a detail
  // column — the score is comparable across the site, the fractions say how
  // it was earned.
  const [scores, setScores] = useState<Record<string, number> | null>(null)
  useEffect(() => {
    let stale = false
    fetch('/api/xboard?mode=werewolf')
      .then(r => r.ok ? r.json() as Promise<LeaderboardEntry[]> : [])
      .catch(() => [] as LeaderboardEntry[])
      .then(ss => {
        if (stale) return
        const map: Record<string, number> = {}
        for (const e of ss) map[e.modelId] = e.xdScore
        setScores(map)
      })
    return () => { stale = true }
  }, [])

  const rows = useMemo(() => {
    let list = (ww?.rows ?? [])
      .map(r => ({ r, m: byId.get(r.modelId)!, score: scores?.[r.modelId] ?? null }))
      .filter(x => !!x.m)
    if (providers.length > 0) list = list.filter(x => providers.includes(x.m.provider))
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(x => x.m.display_name.toLowerCase().includes(q) || x.m.provider.toLowerCase().includes(q))
    }
    // Score decides the order (unrated last); win rate then games break ties.
    return list.sort((a, b) =>
      (b.score ?? -1) - (a.score ?? -1) ||
      (b.r.wins / b.r.games) - (a.r.wins / a.r.games) ||
      b.r.games - a.r.games,
    )
  }, [ww, byId, providers, search, scores])

  if (ww === null) {
    return <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 80 }}>Loading...</div>
  }

  const pct = (w: number, g: number) => g === 0 ? '—' : `${Math.round(100 * w / g)}%`
  // Was `${w} / ${g}` — which restated the sample size we removed from the
  // games column (owner, Aug 26). A percentage answers the same question
  // without publishing how many games it rests on.
  const frac = (w: number, g: number) => g === 0 ? '—' : `${Math.round(100 * w / g)}%`

  return (
    <>
      <div style={{
        border: '1px solid var(--border2)', borderRadius: 9, padding: '10px 13px',
        marginBottom: 16, fontSize: 12, lineHeight: 1.5, color: 'var(--muted2)',
        background: 'var(--surface)',
      }}>
        {/* Sample size is ours, not the public's (owner, Aug 26) — say the
            standings are provisional, never how many games that rests on. */}
        {ww.totalGames < WW_PROVISIONAL_BELOW && (
          <strong style={{ color: 'var(--red)', marginRight: 6 }}>
            {t('xboard.ww.provisional')}
          </strong>
        )}
        {t('xboard.ww.note')}
      </div>

      {rows.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 80 }}>
          No games recorded yet.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' as const, WebkitOverflowScrolling: 'touch' as const, border: '1px solid var(--border)', borderRadius: 8 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: 'var(--border)', minWidth: 830 }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '2fr 110px 110px 130px 130px 110px',
              gap: 0, padding: '10px 20px',
              fontSize: 10, color: 'var(--muted)', fontWeight: 700,
              letterSpacing: '0.12em', textTransform: 'uppercase',
              fontFamily: 'var(--font-mono), monospace',
              background: 'var(--surface)',
            }}>
              <span>{t('xboard.col.model')}</span>
              <span style={{ textAlign: 'right' }}>XD Score</span>
              <span style={{ textAlign: 'right' }}>{t('xboard.ww.col.winrate')}</span>
              <span style={{ textAlign: 'right' }}>{t('xboard.ww.col.wolf')}</span>
              <span style={{ textAlign: 'right' }}>{t('xboard.ww.col.village')}</span>
              <span style={{ textAlign: 'right' }}>{t('xboard.ww.col.survival')}</span>
            </div>
            {rows.map(({ r, m, score }) => (
              <div key={r.modelId} style={{
                display: 'grid',
                gridTemplateColumns: '2fr 110px 110px 130px 130px 110px',
                gap: 0, padding: '12px 20px',
                background: 'var(--bg)', alignItems: 'center',
                transition: 'background 0.12s',
              }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'var(--bg)'}
              >
                <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ProviderLogo provider={m.provider} size={14} />
                  <NameCell name={m.display_name} />
                </div>
                <div style={{ textAlign: 'right' }}>
                  {score != null ? (
                    <span className={`xd-chip ${scoreTier(score)}`}>{score}</span>
                  ) : (
                    <span style={{ fontSize: 13, color: 'var(--muted)', fontFamily: 'var(--font-mono), monospace', fontWeight: 600 }}>—</span>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{
                    fontFamily: 'var(--font-mono), monospace', fontSize: 13, fontWeight: 700,
                    color: r.wins * 2 > r.games ? 'var(--green)' : r.wins * 2 < r.games ? 'var(--red)' : 'var(--muted2)',
                  }}>
                    {pct(r.wins, r.games)}
                  </span>
                </div>
                <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono), monospace', fontSize: 12, color: 'var(--muted2)' }}>
                  {frac(r.wolfWins, r.wolfGames)}
                </div>
                <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono), monospace', fontSize: 12, color: 'var(--muted2)' }}>
                  {frac(r.villageWins, r.villageGames)}
                </div>
                <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono), monospace', fontSize: 12, color: 'var(--muted2)' }}>
                  {frac(r.survived, r.games)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
