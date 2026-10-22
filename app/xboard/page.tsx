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
import { MAKER_LABELS, makerKey } from '../../lib/model-maker'
import { useT } from '../../lib/i18n'
import XDuelBar, { type DuelKind } from '../xduel/XDuelBar'
import RecipeBar from '../xduel/RecipeBar'

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
  /** The maker's own list price when we buy through a reseller (migration 121). */
  official_pricing?: ModelPricing | null
  /** The reseller; null = the maker directly. */
  via?: string | null
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

/** A rating pool, one per board. Speech and music rate apart (Oct 21) and
 *  share the bar's 音訊. */
type FilterMode = 'text' | 'image' | 'video' | 'audio' | 'music'

/**
 * Video's subtypes (CC, Aug 2: every special view is a subtype of its
 * modality). Since Oct 22 only video has them: text, image and audio have
 * too few votes to split (owner: "only keep the output type"), so the
 * text-search pool and the Werewolf scoreboard left the page with text's
 * chips. A subtype filters the CATALOG by declared modes; the numbers are
 * the video pool's either way.
 */
type Subtype = string

/**
 * Video's subtype groups, in display order: chip key (labelled by its
 * recipe.* string) → the catalog modes it covers. A group appears when any
 * of its modes exists in the catalog.
 */
const SUBTYPE_GROUPS: [string, string[]][] = [
  ['text_to_video',  ['text_to_video']],
  ['image_to_video', ['image_to_video', 'reference_frames', 'start_end_frames']],
  ['video_edit',     ['video_edit', 'video_to_video']],
]

/** Each subtype's words on the Mode row (its catalog names, not X創作's
 *  short From names: a board names what the models do). */
const SUBTYPE_NAMES: Record<string, string> = {
  all: 'common.all',
  ...Object.fromEntries(SUBTYPE_GROUPS.map(([k]) => [k, 'recipe.' + k])),
}

/** All has no input icon of its own; the rest take their recipe's input
 *  icon, as XDuel's row does. */
const ALL_GLYPH = (
  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
  </svg>
)

/** Modes covered by a subtype chip. */
const subtypeModes = (key: string): string[] =>
  SUBTYPE_GROUPS.find(([k]) => k === key)?.[1] ?? [key]

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Who made it: the board's provider column, filter and sort use this, so
 *  a model bought through a reseller sits with its maker (Oct 1). */
const makerOfRow = (m: { provider: string; model_name: string }) => makerKey(m.provider, m.model_name)

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
  // Music is its own board (Oct 21): XDuel's 音樂 duels rate apart from speech.
  if (out.includes('audio')) return (m.modes ?? []).includes('text_to_music') ? 'music' : 'audio'
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
  return headlineOf(mode, p)
}

/** The headline rate of any pricing object, by the model's primary mode. */
function headlineOf(mode: string, p: ModelPricing): number | null {
  // Speech: $ per minute, so character- and token-billed models compare
  // (900 characters or 1,500 audio tokens a minute, as lib/providers/
  // pricing.ts speechPricePerMinute).
  if (mode === 'audio') {
    const q = p as any
    if (typeof q.per_1m_characters === 'number') return (900 / 1_000_000) * q.per_1m_characters
    const audioOut = rateNum(q.tokens?.audio_output)
    if (audioOut != null) return (1500 / 1_000_000) * audioOut
    if (typeof q.per_audio_second === 'number') return q.per_audio_second * 60
    return null
  }
  // Music: $ per song of a minute, as XDuel's 音樂 duels are priced (Lyria
  // bills per song and always makes about a minute; ElevenLabs per second).
  if (mode === 'music') {
    const q = p as any
    if (typeof q.per_song === 'number') return q.per_song
    if (typeof q.per_audio_second === 'number') return q.per_audio_second * 60
    return null
  }
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
  else if (mode === 'audio')                                       unit = 'min'
  else if (mode === 'music')                                       unit = 'song'
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
    case 'provider': return makerOfRow(m).toLowerCase() || null
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
    case 'audio': return { label: 'Speech', color: '#06b6d4', bg: 'rgba(6,182,212,0.08)' }
    case 'music': return { label: 'Music', color: '#ec4899', bg: 'rgba(236,72,153,0.08)' }
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
  // The top bar's type, as XDuel's.
  const [kind, setKind] = useState<DuelKind>('text')
  const [subtype, setSubtype] = useState<Subtype>('all')
  const [early, setEarly] = useState<Record<string, boolean>>({})
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

  // The type's boards: one, or speech then music under 音訊 (their scores
  // come from separate pools and never share a ranking).
  const pools: FilterMode[] = useMemo(() => kind === 'audio' ? ['audio', 'music'] : [kind], [kind])

  // Scores load separately from the catalog: switching pools swaps the
  // numbers, not the model list, so the catalog must not be re-fetched. A
  // model sits in one pool, so the pools' maps merge by model id.
  useEffect(() => {
    let stale = false
    Promise.all(pools.map(p =>
      fetch(`/api/xboard?mode=${p}`)
        .then(r => r.ok ? r.json() as Promise<LeaderboardEntry[]> : [])
        .catch(() => [] as LeaderboardEntry[]),
    )).then(lists => {
      if (stale) return
      const map: Record<string, number> = {}
      const qmap: Record<string, number> = {}
      const vmap: Record<string, boolean> = {}
      for (const e of lists.flat()) {
        map[e.modelId] = e.xdScore
        vmap[e.modelId] = e.early
        if (e.qualityScore != null) qmap[e.modelId] = e.qualityScore
      }
      setScores(map)
      setQualityScores(qmap)
      setEarly(vmap)
    })
    return () => { stale = true }
  }, [pools])

  const merged: MergedRow[] = useMemo(
    () => models.map(m => ({ ...m, qualityScore: qualityScores[m.id] ?? null, xdScore: scores[m.id] ?? null, early: early[m.id] ?? false })),
    [models, scores, qualityScores, early],
  )

  // Each pool's rows, filtered and sorted.
  const boards = useMemo(() => {
    let list = merged
    // A chip is a GROUP: any covered mode counts.
    if (kind === 'video' && subtype !== 'all') {
      const covered = subtypeModes(subtype)
      list = list.filter(m => (m.modes ?? []).some(x => covered.includes(x)))
    }
    if (selectedProviders.length > 0) list = list.filter(m => selectedProviders.includes(makerOfRow(m)))
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(m =>
        m.display_name.toLowerCase().includes(q) ||
        m.model_name.toLowerCase().includes(q) ||
        makerOfRow(m).toLowerCase().includes(q) ||
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
    return pools.map(pool => ({ pool, rows: list.filter(m => primaryMode(m) === pool).sort(cmp) }))
  }, [merged, selectedProviders, pools, kind, search, sortBy, sortDir, subtype])
  const shown = boards.reduce((n, b) => n + b.rows.length, 0)

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
    for (const m of models) c[makerOfRow(m)] = (c[makerOfRow(m)] ?? 0) + 1
    return c
  }, [models])

  // Every provider present in the catalog, alphabetical — new companies
  // show up in the dropdown automatically.
  const providerList = useMemo(
    () => [...new Set(models.map(m => makerOfRow(m)))].sort(),
    [models],
  )

  // Video's subtype chips, discovered from the catalog's declared modes so
  // a new recipe shows up here without a code change.
  const subtypeChips = useMemo((): Subtype[] => {
    const present = new Set(
      models.filter(m => primaryMode(m) === 'video').flatMap(m => m.modes ?? []),
    )
    return [
      'all',
      ...SUBTYPE_GROUPS
        .filter(([, covered]) => covered.some(x => present.has(x)))
        .map(([k]) => k),
    ]
  }, [models])

  // Picking a type resets the subtype, so a video chip can't linger.
  const pickKind = (k: DuelKind) => { setKind(k); setSubtype('all') }

  // The board in the address, as XDuel's ?mode= (Oct 22): read once, then
  // kept in step, so a shared link opens the same board.
  const [addressRead, setAddressRead] = useState(false)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const mode = q.get('mode'), sub = q.get('sub')
    if (mode === 'text' || mode === 'image' || mode === 'video' || mode === 'audio') {
      setKind(mode)
      if (mode === 'video' && sub) setSubtype(sub)
    }
    setAddressRead(true)
  }, [])
  useEffect(() => {
    if (!addressRead) return
    const sub = kind === 'video' && subtype !== 'all' ? subtype : null
    const url = `/xboard?mode=${kind}${sub ? `&sub=${sub}` : ''}`
    if (url !== window.location.pathname + window.location.search) window.history.replaceState(null, '', url)
  }, [addressRead, kind, subtype])

  const poolName = (p: FilterMode) => p === 'audio' ? t('xduel.audio.speech') : t('xduel.audio.music')
  const countLine = (n: number) => t('xboard.modelcount').replace('{n}', String(n))

  return (
    <>
      <div className="cursor" ref={cursorRef} />
      <div className="cursor-ring" ref={ringRef} />

      {/* XDuel's look (owner, Oct 22: "XBoard is from XDuel"): its top bar
          with the four types, then the page on its paper (.xduel-xt). The
          bar sits outside .xduel-page, whose overflow would swallow its
          sticky. */}
      <div className="xduel-xt xb">
      <XDuelBar current={kind} onPick={pickKind} base="/xboard" />
      <div className="xduel-page">
        <div className="arena">

          {/* XDuel's header: the headline alone (no eyebrow since Oct 17),
              then one paragraph on what the two columns are (TGS audit,
              Sep 14). Weights from lib/xdrating.ts. */}
          <div className="prompt-header">
            <h1 className="page-headline">{t('xboard.subtitle')}</h1>
            <p className="xb-explain">
              {t('xboard.explain')}{' '}
              <Link href="/methodology">{t('xboard.how')} →</Link>
            </p>
          </div>

          {/* Video's subtypes as XDuel's Mode row (was a rail beside the board). */}
          {kind === 'video' && (
            <RecipeBar recipe={subtype} kinds={subtypeChips} names={SUBTYPE_NAMES} glyphs={{ all: ALL_GLYPH }}
              onPick={setSubtype} t={t} />
          )}

          <div className="xb-tools">
            <input
              type="search"
              className="xb-search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('xboard.search')}
            />
            {/* Provider filter — multi-select dropdown (empty = all). */}
            <div ref={providerMenuRef} className="xb-prov">
              <button
                onClick={() => setProviderMenuOpen(o => !o)}
                className="provider-filter-btn"
                aria-expanded={providerMenuOpen}
              >
                <span className="xb-prov-label">{t('xboard.providers')}</span>
                <span className="xb-prov-value">
                  {selectedProviders.length === 0
                    ? t('common.all')
                    : selectedProviders.length <= 2
                      ? selectedProviders.map(p => PROVIDER_LABELS[p] ?? MAKER_LABELS[p] ?? p).join(', ')
                      : `${selectedProviders.length} selected`}
                </span>
                <span aria-hidden className="xb-caret">▾</span>
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
                        {PROVIDER_LABELS[p] ?? MAKER_LABELS[p] ?? p}
                        <span className="provider-filter-count">{counts[p] ?? 0}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Results count; on phones the sort the table header gives. */}
          <div className="xb-count">
            <span>{countLine(shown)}</span>
            <span className="xb-sort">
              <label>
                <span>{t('xboard.sort')}</span>
                <select value={sortBy} onChange={e => handleSort(e.target.value as SortKey)}>
                  <option value="xdScore">XD Score</option>
                  <option value="quality">{t('xboard.col.quality')}</option>
                  <option value="price">{t('xboard.col.price')}</option>
                  <option value="released">{t('xboard.col.released')}</option>
                  <option value="name">{t('xboard.col.model')}</option>
                  <option value="provider">{t('xboard.col.provider')}</option>
                </select>
              </label>
              <button type="button" onClick={() => handleSort(sortBy)} aria-label={t('xboard.sortdir')} title={t('xboard.sortdir')}>
                {sortDir === 'asc' ? '↑' : '↓'}
              </button>
            </span>
          </div>

          {loading ? (
            <div className="xb-empty">Loading...</div>
          ) : shown === 0 ? (
            <div className="xb-empty">No models match your filters.</div>
          ) : boards.map(({ pool, rows }) => rows.length > 0 && (
            <section key={pool}>
              {/* 音訊's two boards, each named, one under the other. */}
              {boards.length > 1 && (
                <h2 className="xb-board-title">{poolName(pool)} <span>{countLine(rows.length)}</span></h2>
              )}
              <LeaderboardTable
                rows={rows}
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={handleSort}
              />
            </section>
          ))}

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
      <span className="xb-name">{name}</span>
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
//
// One grid, two layouts (globals.css, .xb-row): the table's seven columns on
// a desktop, a card on a phone (name and XD score, maker and date with the
// Score, inputs with the price), so nothing scrolls sideways at 360 px.

function ModelRow({ model: m }: { model: MergedRow }) {
  const t = useT()
  return (
    <div className="xb-row">
      {/* Model name — one line, always. Smaller face + a wider column
          beats a taller row of wrapped text (CC, Aug 2). */}
      <div className="xb-c-name">
        <NameCell name={m.display_name} />
      </div>

      {/* Quality — blind-vote-only rating (price never seen). Plain mono
          number: the XD chip next door keeps the colour weight. */}
      <div className="xb-c-q">
        <span className="xb-lbl">{t('xboard.col.quality')}</span>
        {m.qualityScore != null ? m.qualityScore : '—'}
      </div>

      {/* XD Score — rendered as a heatmap chip when present. Scores carry
          most of the page's information density, so the colour weight goes
          here rather than on surrounding chrome. */}
      <div className="xb-c-xd">
        {m.xdScore != null ? (
          <span className="xb-xd">
            {/* Low-sample honesty (owner, Aug 18): a thin rating must not
                read as a verdict. Under 10 blind votes, say so right where
                the score is — but NOT how many (owner, Aug 26: the vote
                counts are ours, not the public's). "Early" carries the
                caveat; the number carried our sample size. */}
            {m.early && (
              <span className="xb-early" title={t('xboard.early.title')}>{t('xboard.early')}</span>
            )}
            <span className={`xd-chip ${scoreTier(m.xdScore)}`}>
              {m.xdScore}
            </span>
          </span>
        ) : (
          <span className="xb-dash">—</span>
        )}
      </div>

      {/* Provider */}
      <div className="xb-c-maker">
        <ProviderLogo provider={m.provider} model={m.model_name} size={14} />
        <span>{PROVIDER_LABELS[makerOfRow(m)] ?? MAKER_LABELS[makerOfRow(m)] ?? makerOfRow(m)}</span>
      </div>

      {/* Released */}
      <div className="xb-c-date">
        {fmtDate(m.released_at)}
      </div>

      {/* Input modalities */}
      <div className="xb-c-in">
        {(m.input_modalities ?? []).map(mod => {
          const b = modalityBadge(mod)
          return (
            <span key={mod} className="xb-badge" style={{ color: b.color, background: b.bg }}>
              {b.label}
            </span>
          )
        })}
      </div>

      {/* Price (industry-standard rate, slash-aligned across rows) */}
      <div className="xb-c-price">
        {(() => {
          const p = priceParts(m)
          if (!p) return '-'
          // Bought through a reseller (owner, Oct 1: two prices): say so,
          // and show the maker's own price when ours differs from it.
          const official = m.via && m.official_pricing ? headlineOf(primaryMode(m), m.official_pricing) : null
          const ours = headlinePrice(m)
          return (
            <>
              <span className="xb-amount">{p.amount}</span>
              <span className="xb-unit">/ {p.unit}</span>
              {m.via && (
                <div className="xb-via">
                  via {m.via.charAt(0).toUpperCase() + m.via.slice(1)}
                  {official != null && ours != null && Math.abs(official - ours) > 1e-9 && <> · official {fmtPrice(official)}</>}
                </div>
              )}
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
    // A white box on the paper. Desktop: the ~820 px table scrolls inside
    // it on a narrow window; phones get cards and no header (sort is the
    // count line's picker there).
    <div className="xb-table">
      <div className="xb-grid">
        <div className="xb-head">
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
    // The XD Score and Price cells keep a 32px right padding so the chip /
    // number doesn't kiss the next column; the right-aligned headers mirror
    // it (.xb-sh.right) so labels stay above their data.
    <button
      onClick={() => onSort(sortKey)}
      className={`xb-sh${align === 'right' ? ' right' : ''}${isActive ? ' on' : ''}`}
    >
      <span>{label}</span>
      <span className="xb-sh-arrow">
        {isActive ? (dir === 'asc' ? '▲' : '▼') : '▲'}
      </span>
    </button>
  )
}
