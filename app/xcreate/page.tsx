'use client'
// app/xcreate/page.tsx
// Private AI studio:
// 1. Pick up to 4 models + prompt → generate side by side
// 2. Pick one to continue → this is the vote, others dismissed
// 3. Multi-turn chat with chosen model

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRequireAuth } from '../../lib/useRequireAuth'
import { createBrowserClient } from '@supabase/ssr'
const createSupabaseBrowser = () => createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)
import ReactMarkdown from 'react-markdown'
import AttachmentButton, { type Attachment } from '../components/AttachmentButton'

type Mode = 'text' | 'image' | 'video'
type Phase = 'setup' | 'generating' | 'picking' | 'chatting'

// Pricing + capabilities — see docs/ai_models-schema.md.
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

type DurationSpec = number[] | { min: number; max: number }

interface OutputModalityConfig {
  sizes?:                   string[]
  aspect_ratios?:           string[]
  /** Per-resolution durations: discrete list OR { min, max } range (video only). */
  durations_by_resolution?: Record<string, DurationSpec>
  /** Available thinking / reasoning levels (e.g. ['minimal','low','high']). */
  thinking_levels?:         string[]
  /** Available image quality tiers (e.g. ['low','medium','high']). Image
   *  models like gpt-image-2 declare them here. */
  qualities?:               string[]
  /** Max outputs per request — image models that can generate N images at once. */
  max_count?:               number
  capabilities?:            string[]
}

/** Expand a duration spec to the explicit integer list for runtime use. */
function expandDurations(spec: DurationSpec | undefined): number[] {
  if (!spec) return []
  if (Array.isArray(spec)) return spec
  const out: number[] = []
  for (let i = spec.min; i <= spec.max; i++) out.push(i)
  return out
}
interface OutputConfig {
  text?:  OutputModalityConfig
  image?: OutputModalityConfig
  video?: OutputModalityConfig
  audio?: OutputModalityConfig
}

/** Which top-level mode a `ModelMode` pattern produces. Used to filter the
 *  per-slot Mode picker so a video-mode card only shows video modes, etc.
 *  `reference_frames` is dual-use — it produces an image output when the
 *  model's output_modalities include 'image' (Nano Banana / Gemini 3 Image
 *  with reference shots) and a video output for video-output models. */
function modeMatchesMode(modePattern: string, m: 'text' | 'image' | 'video'): boolean {
  if (m === 'text')  return (
    modePattern === 'text_to_text'  ||
    modePattern === 'image_to_text' ||
    modePattern === 'video_to_text' ||
    modePattern === 'audio_to_text' ||
    modePattern === 'pdf_to_text'
  )
  if (m === 'image') return (
    modePattern === 'text_to_image' ||
    modePattern === 'image_edit'    ||
    modePattern === 'reference_frames'
  )
  if (m === 'video') return (
    modePattern === 'text_to_video' ||
    modePattern === 'image_to_video' ||
    modePattern === 'video_to_video' ||
    modePattern === 'start_end_frames' ||
    modePattern === 'reference_frames'
  )
  return false
}

/** Human-readable label for a mode pattern (matches the admin form). */
function modeLabel(modePattern: string): string {
  switch (modePattern) {
    case 'text_to_text':     return 'Text → Text'
    case 'image_to_text':    return 'Image → Text'
    case 'video_to_text':    return 'Video → Text'
    case 'audio_to_text':    return 'Audio → Text'
    case 'pdf_to_text':      return 'PDF → Text'
    case 'text_to_image':    return 'Text → Image'
    case 'image_edit':       return 'Image Edit'
    case 'text_to_video':    return 'Text → Video'
    case 'image_to_video':   return 'Image → Video'
    case 'video_to_video':   return 'Video → Video'
    case 'start_end_frames': return 'Start + End Frames'
    case 'reference_frames': return 'Reference Frames'
    default:                 return modePattern
  }
}

/**
 * Infer the aspect-ratio label (e.g. '16:9', '21:9', '9:16', '1:1') from
 * a pixel size string. Compares the W/H ratio against a candidate list
 * with a small tolerance so e.g. 1536×672 (≈ 2.286) still matches '21:9'
 * (≈ 2.333). Returns null if no candidate is close enough.
 */
function aspectFromSize(size: string | null | undefined): string | null {
  if (!size) return null
  const m = size.match(/(\d+)\s*[x×*]\s*(\d+)/i)
  if (!m) return null
  const w = parseInt(m[1], 10), h = parseInt(m[2], 10)
  if (!w || !h) return null
  const r = w / h
  const candidates: Array<[string, number]> = [
    ['1:1',   1],
    ['4:3',   4 / 3],
    ['3:4',   3 / 4],
    ['3:2',   3 / 2],
    ['2:3',   2 / 3],
    ['16:9',  16 / 9],
    ['9:16',  9 / 16],
    ['21:9',  21 / 9],
    ['9:21',  9 / 21],
    ['5:4',   5 / 4],
    ['4:5',   4 / 5],
  ]
  let best: [string, number] | null = null
  let bestDiff = Infinity
  for (const c of candidates) {
    const diff = Math.abs(r - c[1])
    if (diff < bestDiff) { bestDiff = diff; best = c }
  }
  // 5% tolerance — generous enough that 1536×672 → 21:9 still matches.
  return best && bestDiff / best[1] < 0.06 ? best[0] : null
}

/** Returns sizes whose inferred aspect ratio matches `aspect`. */
function sizesMatchingAspect(sizes: string[], aspect: string): string[] {
  return sizes.filter(s => aspectFromSize(s) === aspect)
}

/**
 * Map a pixel size string (e.g. '1280x720') to the closest resolution key
 * that the model declared in `durations_by_resolution` (e.g. '720p', '1080p',
 * '4k'). We compare on the smaller of width/height since portrait/landscape
 * variants of the same resolution share a duration bucket.
 */
function inferResolutionKey(size: string, available: string[]): string | null {
  if (!size || available.length === 0) return null
  const m = size.match(/(\d+)\s*[x×*]\s*(\d+)/i)
  if (!m) return null
  const minDim = Math.min(parseInt(m[1], 10), parseInt(m[2], 10))
  // Common video resolution heights. Falls back to numeric prefix parsing
  // for unusual keys (e.g. '540p').
  const dimByKey: Record<string, number> = {
    '480p': 480, '540p': 540, '720p': 720, '1080p': 1080, '1440p': 1440,
    '2k': 1440, '4k': 2160, '8k': 4320,
  }
  let best: string | null = null
  let bestDiff = Infinity
  for (const k of available) {
    const lk = k.toLowerCase()
    const dim = dimByKey[lk] ?? (() => {
      const pm = lk.match(/^(\d+)/)
      return pm ? parseInt(pm[1], 10) : NaN
    })()
    if (!Number.isFinite(dim)) continue
    const diff = Math.abs(dim - minDim)
    if (diff < bestDiff) { bestDiff = diff; best = k }
  }
  return best
}

interface DBModel {
  id: string          // uuid
  provider: string
  model_name: string
  display_name: string
  input_modalities: string[]
  tags: string[]
  is_popular: boolean | null
  released_at: string | null   // ISO timestamp
  modes:         string[]
  model_pricing: ModelPricing | null
  output_config: OutputConfig | null
}

type ModelMode =
  | 'text_to_text'
  | 'image_to_text'
  | 'video_to_text'
  | 'audio_to_text'
  | 'pdf_to_text'
  | 'text_to_image'
  | 'image_edit'
  | 'text_to_video'
  | 'image_to_video'
  | 'video_to_video'
  | 'start_end_frames'
  | 'reference_frames'

interface SlotModel {
  id: string          // uuid
  provider: string
  model_name: string
  display_name: string
  modes:         ModelMode[]
  model_pricing: ModelPricing | null
  output_config: OutputConfig | null
}

interface SlotOptions {
  mode: ModelMode | null    // pattern picked from the model's `modes` set
  quality: string | null    // 'low' | 'medium' | 'high' for image
  size: string | null       // e.g. '1024x1024' for image, '1280x720' for video
  duration: number | null   // seconds for video
  aspect_ratio: string | null // e.g. '16:9' for video, '1:1' for image
  /** Watermark for video. null = unset (provider's default, don't send); true = on; false = off. */
  watermark: boolean | null
  /** Number of outputs to generate. Only meaningful for image models that
   *  declare `output_config.image.max_count > 1`. Defaults to 1. */
  count: number | null
}

interface SlotState {
  text: string
  isImage: boolean
  isVideo: boolean
  streaming: boolean
  done: boolean
  cost: number
  responseTime: number
  error: string | null
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  isImage?: boolean
  isVideo?: boolean
}

interface GalleryItem {
  id: string
  mode: string
  prompt: string
  slots: any[]
  chosen_model_id: string | null
  chat_history: ChatMessage[] | null
  created_at: string
}

const LABELS = ['A', 'B', 'C', 'D']
const SLOT_COLORS = ['#4a9eff', '#e8453c', '#a78bfa', '#34d399']

// ── Cost estimation ──────────────────────────────────────────────────────────
// We estimate upfront USD cost so users can see what a Generate run will cost
// before they commit. Actual cost is reconciled from the provider response
// once generation completes.
//
// Text: charge = (inTokens × input_price + outTokens × output_price) / 1M.
//   We assume ~4 chars/token for the prompt and a conservative 500-token
//   response. Cached input is ignored here — the estimator is a ceiling.
// Image: per-image price from image_pricing[quality]. One image per slot.
// Video: per-second price from video_pricing[resolutionKey] × duration.
function resolutionKeyForSize(size: string): string | null {
  if (!size.includes('x')) return null
  const [w, h] = size.split('x').map(Number)
  if (!w || !h) return null
  const shortSide = Math.min(w, h)
  if (shortSide >= 2000) return '4K'
  if (shortSide >= 1000) return '1080p'
  if (shortSide >= 700)  return '720p'
  return '480p'
}

// Resolve a polymorphic TokenRate to a number using the slot's chosen
// thinking level (if any). Mirrors `resolveTokenRate` in pricing.ts.
function rateOf(r: TokenRate | undefined, level?: string | null): number {
  if (r == null) return 0
  if (typeof r === 'number') return r
  if (level && r.by_level && typeof r.by_level[level] === 'number') {
    return r.by_level[level] as number
  }
  return r.default ?? 0
}

function estimateSlotDollars(
  model: SlotModel,
  m: Mode,
  opts: SlotOptions | null,
  promptLen: number,
): number | null {
  const p = model.model_pricing ?? {}
  const t = p.tokens ?? {}
  // Note: SlotOptions doesn't yet carry a thinking_level field — pass null
  // for now. When we wire the thinking-level picker, swap in opts.thinking_level.
  const lvl: string | null = null
  if (m === 'text') {
    const tin  = rateOf(t.text_input,  lvl)
    const tout = rateOf(t.text_output, lvl)
    if (tin === 0 && tout === 0) return null
    const inTokens  = Math.max(1, Math.ceil(promptLen / 4))
    const outTokens = 500
    return (inTokens * tin + outTokens * tout) / 1_000_000
  }
  if (m === 'image') {
    const imgOut = rateOf(t.image_output, lvl)
    if (imgOut > 0) {
      const inTokens     = Math.max(1, Math.ceil(promptLen / 4))
      const outImageTok  = 1290
      const tin = rateOf(t.text_input, lvl)
      return (inTokens * tin + outImageTok * imgOut) / 1_000_000
    }
    // Per-image flat rate by quality tier
    const r = p.per_image
    if (!r) return null
    const q = opts?.quality ?? null
    return (q && r[q] != null) ? r[q] : (r.medium ?? r.default ?? Object.values(r)[0] ?? null)
  }
  if (m === 'video') {
    const r = p.per_video_second
    if (!r) return null
    const size = opts?.size ?? null
    const key  = size ? resolutionKeyForSize(size) : null
    let perSecond: number | null = null
    if (key && r[key] != null)                          perSecond = r[key]
    else if (r['720p'] != null)                         perSecond = r['720p']
    else if (Object.values(r).length > 0)               perSecond = Object.values(r)[0] as number
    if (perSecond == null) return null
    const seconds = opts?.duration ?? 1
    return perSecond * seconds
  }
  return null
}

// Format a USD amount for display. Picks a decimal count that keeps sub-cent
// values legible without scientific notation.
// Strip a trailing parenthetical variant from a model name — e.g.
// "GPT-5.4 (free)" → "GPT-5.4" — so result cards and chat headers stay
// compact. The model card in the setup grid still shows the variant on a
// second muted line; everything post-generation hides it entirely.
function stripModelVariant(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, '').trim() || name
}

function fmtDollars(dollars: number | null): string {
  if (dollars == null) return '—'
  if (dollars === 0)   return '$0'
  if (dollars >= 1)    return `$${dollars.toFixed(2)}`
  if (dollars >= 0.01) return `$${dollars.toFixed(3)}`
  return `$${dollars.toFixed(4)}`
}

// ── Model Picker Dialog ───────────────────────────────────────────────────────
// Group models by company using the provider field.
// Falls back to "other" for anything unexpected.
function companyOf(m: DBModel): string {
  return m.provider || 'other'
}

// Human-friendly display name for a company id. Anything not in this map
// gets titlecased on the fly.
const COMPANY_LABELS: Record<string, string> = {
  openai:              'OpenAI',
  anthropic:           'Anthropic',
  google:              'Google',
  'meta-llama':        'Meta',
  deepseek:            'DeepSeek',
  mistralai:           'Mistral',
  alibaba:             'Alibaba',
  moonshotai:          'Moonshot',
  'z-ai':              'Z.AI',
  'black-forest-labs': 'Black Forest',
  'stability-ai':      'Stability',
  runway:              'Runway',
  perplexity:          'Perplexity',
  nvidia:              'NVIDIA',
  amazon:              'Amazon',
  nousresearch:        'Nous',
  minimax:             'MiniMax',
  'bytedance-seed':    'ByteDance',
  'aion-labs':         'Aion',
  baidu:               'Baidu',
  'arcee-ai':          'Arcee',
  sao10k:              'Sao10K',
}
function companyLabel(id: string): string {
  if (COMPANY_LABELS[id]) return COMPANY_LABELS[id]
  return id
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function ModelPickerDialog({ mode, onSelect, onClose, selectedIds }: {
  mode: Mode; onSelect: (m: SlotModel) => void; onClose: () => void; selectedIds: string[]
}) {
  const [search,      setSearch]      = useState('')
  const [models,      setModels]      = useState<DBModel[]>([])
  const [loading,     setLoading]     = useState(true)
  // null = "All" (no company filter active).
  const [company,     setCompany]     = useState<string | null>(null)
  // Sort direction for release date. 'desc' = newest first.
  const [sortDir,     setSortDir]     = useState<'desc' | 'asc'>('desc')

  useEffect(() => {
    // Order by release date, newest first. Rows with a null released_at
    // fall to the bottom, then tie-break by name.
    createSupabaseBrowser()
      .from('ai_models')
      .select('*')
      .eq('enabled', true)
      .contains('output_modalities', [mode])
      .order('released_at', { ascending: false, nullsFirst: false })
      .then(({ data }) => { setModels(data ?? []); setLoading(false) })
  }, [mode])

  // Count models per company in the current mode so we can show the top
  // companies as chips. We show at most ~10 chips to keep the row tidy.
  const companyCounts = (() => {
    const counts: Record<string, number> = {}
    for (const m of models) {
      const c = companyOf(m)
      counts[c] = (counts[c] ?? 0) + 1
    }
    return counts
  })()
  const topCompanies = Object.entries(companyCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([c]) => c)

  // Apply filters in order: company → text search.
  const q = search.trim().toLowerCase()
  const filteredUnsorted = models.filter(m => {
    if (company && companyOf(m) !== company) return false
    if (q) {
      return (
        m.display_name.toLowerCase().includes(q) ||
        m.model_name.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q)
      )
    }
    return true
  })
  // Sort by release date in the chosen direction. Null dates always last.
  const filtered = [...filteredUnsorted].sort((a, b) => {
    const aT = a.released_at ? new Date(a.released_at).getTime() : NaN
    const bT = b.released_at ? new Date(b.released_at).getTime() : NaN
    if (Number.isNaN(aT) && Number.isNaN(bT)) return 0
    if (Number.isNaN(aT)) return 1
    if (Number.isNaN(bT)) return -1
    return sortDir === 'desc' ? bT - aT : aT - bT
  })

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 14, width: 520, maxHeight: '70vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
        <div style={{ padding: '16px 16px 0', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 8, padding: '10px 14px' }}>
            <span style={{ color: 'var(--muted)' }}>⌕</span>
            <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search models…"
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--white)', fontSize: 14, fontFamily: 'inherit' }} />

          </div>
        </div>
        <div style={{ padding: '12px 16px 8px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const, flexShrink: 0 }}>
          <span style={{
            padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.5px',
            background: mode === 'video' ? '#34d39922' : mode === 'image' ? '#a78bfa22' : '#4a9eff22',
            color: mode === 'video' ? '#34d399' : mode === 'image' ? '#a78bfa' : '#4a9eff',
          }}>{mode} models</span>

          {/* Sort by release date — toggle between newest-first / oldest-first. */}
          <button
            onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
            style={{
              padding: '4px 11px',
              borderRadius: 12,
              fontSize: 11,
              fontWeight: 700,
              textTransform: 'uppercase' as const,
              letterSpacing: '0.5px',
              cursor: 'pointer',
              border: '1px solid var(--border2)',
              background: 'transparent',
              color: 'var(--muted2)',
              fontFamily: 'inherit',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
            title={sortDir === 'desc' ? 'Newest first — click for oldest first' : 'Oldest first — click for newest first'}
          >
            <span>{sortDir === 'desc' ? '↓' : '↑'}</span>
            <span>Released</span>
          </button>

          <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>
            {filtered.length} of {models.length}
          </span>
        </div>

        {/* Company chip row — wraps onto multiple lines so the user never
            has to scroll horizontally. Earlier version tried overflow-x:
            auto, but trackpad horizontal scroll is unreliable and the
            scrollbar was almost invisible on macOS, so chips past the
            dialog width were effectively hidden. Wrapping is simpler and
            never loses a chip.

            flexShrink: 0 keeps the flex column above the model list from
            squishing this row when the list is long. */}
        <div
          style={{
            padding: '0 16px 12px',
            display: 'flex',
            gap: 6,
            alignItems: 'center',
            flexWrap: 'wrap' as const,
            flexShrink: 0,
          }}
        >
          {[null, ...topCompanies].map(c => {
            const active = company === c
            const label  = c === null ? 'All' : companyLabel(c)
            return (
              <button
                key={c ?? '__all__'}
                onClick={() => setCompany(c)}
                style={{
                  padding: '4px 10px',
                  borderRadius: 12,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: `1px solid ${active ? 'var(--white)' : 'var(--border2)'}`,
                  background: active ? 'var(--white)' : 'transparent',
                  color:      active ? 'var(--bg)'   : 'var(--muted2)',
                  fontFamily: 'inherit',
                  whiteSpace: 'nowrap' as const,
                  flexShrink: 0,
                }}
              >
                {label}
              </button>
            )
          })}
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {loading ? <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>Loading…</div>
          : filtered.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)', fontSize: 13, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              <div>No models found</div>
              {company && (
                <button
                  onClick={() => setCompany(null)}
                  style={{
                    padding: '5px 12px', borderRadius: 10, fontSize: 11, fontWeight: 700,
                    background: 'transparent', border: '1px solid var(--border2)',
                    color: 'var(--muted2)', cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >Clear filters</button>
              )}
            </div>
          )
          : filtered.map(m => {
            // Note: we used to disable already-picked models, but users may
            // want the same model in multiple slots to compare configs (e.g.
            // gpt-image-2 at low vs high quality side-by-side).
            const dup = selectedIds.includes(m.id)
            return (
              <div key={m.id}
                onClick={() => onSelect({ id: m.id, provider: m.provider, model_name: m.model_name, display_name: m.display_name, modes: (m.modes ?? []) as ModelMode[], model_pricing: m.model_pricing, output_config: m.output_config })}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--surface2)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {m.display_name}
                  </div>
                  {/* Internal id — useful to disambiguate variants like
                      gpt-5 vs gpt-5-mini in the picker. */}
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, fontFamily: 'var(--mono)' }}>{m.model_name}</div>
                </div>
                {/* Release date badge — makes the newest-first sort order
                    visible. Shown as "Mar 2026" style. Null dates (mostly
                    video models) render nothing. */}
                {m.released_at && (
                  <span style={{
                    fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)',
                    whiteSpace: 'nowrap' as const, flexShrink: 0,
                  }}>
                    {new Date(m.released_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                  </span>
                )}
                {m.tags?.includes('reasoning') && <span style={{ fontSize: 9, color: '#a78bfa', background: '#a78bfa18', padding: '2px 6px', borderRadius: 6, fontWeight: 700 }}>REASONING</span>}
                {(() => {
                  // Show NEEDS ATTACHMENT only when EVERY declared mode requires
                  // some non-text input. If the model has any text-only mode
                  // (text_to_text / text_to_image / text_to_video), it can run
                  // without attachments and the badge is misleading.
                  const TEXT_ONLY: ModelMode[] = ['text_to_text', 'text_to_image', 'text_to_video']
                  const declared  = (m.modes ?? []) as ModelMode[]
                  const hasModes  = declared.length > 0
                  const hasTextOnly = declared.some(x => TEXT_ONLY.includes(x))
                  const needsAttach = hasModes && !hasTextOnly
                  return needsAttach
                    ? <span style={{ fontSize: 9, color: '#f59e0b', background: '#f59e0b18', padding: '2px 6px', borderRadius: 6, fontWeight: 700 }}>NEEDS ATTACHMENT</span>
                    : null
                })()}
                {dup && <span style={{ fontSize: 11, color: 'var(--muted)' }}>Added</span>}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Gallery Detail Modal ──────────────────────────────────────────────────────
// Shows all model results for a single saved creation. User can flip between
// model tabs to see each one's output side-by-side. Chosen model is badged
// but non-chosen ones are NOT crossed out — they're all viewable.
function GalleryDetail({ item, onClose, onContinue }: {
  item: GalleryItem,
  onClose: () => void,
  onContinue: (item: GalleryItem, slotIdx: number) => void,
}) {
  const slots = (item.slots ?? []).filter(Boolean)
  const mode  = item.mode as Mode
  const modeColor = mode === 'video' ? '#34d399' : mode === 'image' ? '#a78bfa' : '#4a9eff'
  const chosenIdx = slots.findIndex((s: any) => s.id === item.chosen_model_id)
  const initialIdx = chosenIdx !== -1 ? chosenIdx : 0
  const [activeIdx, setActiveIdx] = useState(initialIdx)
  const active = slots[activeIdx]

  // Close on Esc
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 99000,
      background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 14,
        width: '100%', maxWidth: 980, maxHeight: '90vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: modeColor, background: modeColor + '18', padding: '3px 8px', borderRadius: 8, textTransform: 'uppercase' as const }}>{mode}</span>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{new Date(item.created_at).toLocaleString()}</span>
            </div>
            <div style={{ fontSize: 14, color: 'var(--white)', lineHeight: 1.5, fontWeight: 500 }}>{item.prompt}</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{
            flexShrink: 0, width: 32, height: 32, borderRadius: 8,
            background: 'var(--surface2)', border: '1px solid var(--border2)',
            color: 'var(--muted)', fontSize: 16, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>✕</button>
        </div>

        {/* Model tabs — click to view that model's result */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
          {slots.map((s: any, i: number) => {
            const isActive = i === activeIdx
            const isChosen = s.id === item.chosen_model_id
            return (
              <button key={i} onClick={() => setActiveIdx(i)} style={{
                fontSize: 11, padding: '6px 12px', borderRadius: 8,
                fontFamily: 'var(--mono)', fontWeight: 600,
                cursor: 'pointer',
                border: isActive ? '1px solid var(--red)' : '1px solid var(--border2)',
                background: isActive ? 'var(--red-dim)' : 'var(--surface)',
                color: isActive ? 'var(--red)' : 'var(--muted2)',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, opacity: 0.7 }}>{LABELS[i]}</span>
                <span style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                  {s.model_name ?? s.name}
                </span>
                {isChosen && <span style={{ fontSize: 9, color: 'var(--green)', background: '#34d39928', padding: '1px 6px', borderRadius: 6, fontWeight: 700 }}>CHOSEN</span>}
              </button>
            )
          })}
        </div>

        {/* Active model result */}
        <div style={{ flex: 1, overflow: 'auto', padding: 20, background: 'var(--surface)' }}>
          {active && (
            active.isVideo ? (
              <video src={active.text} controls autoPlay loop playsInline style={{
                width: '100%', maxHeight: '55vh', borderRadius: 10, background: '#000', display: 'block',
              }} />
            ) : active.isImage ? (
              <img src={active.text} alt="" style={{
                width: '100%', maxHeight: '55vh', objectFit: 'contain',
                borderRadius: 10, display: 'block', background: '#000',
              }} />
            ) : (
              <div style={{
                fontSize: 14, lineHeight: 1.7, color: 'var(--white)',
                whiteSpace: 'pre-wrap' as const, wordBreak: 'break-word' as const,
              }}>{active.text || <span style={{ color: 'var(--muted)' }}>(empty)</span>}</div>
            )
          )}

          {/* Stats row */}
          {active && (
            <div style={{ marginTop: 16, display: 'flex', gap: 16, fontSize: 11, color: 'var(--muted)', flexWrap: 'wrap' as const }}>
              {typeof active.cost === 'number' && <span>Cost: <strong style={{ color: 'var(--white)' }}>{fmtDollars(active.cost)}</strong></span>}
              {typeof active.responseTime === 'number' && active.responseTime > 0 && (
                <span>Time: <strong style={{ color: 'var(--white)' }}>{(active.responseTime / 1000).toFixed(2)}s</strong></span>
              )}
              {active.provider && <span>Provider: <strong style={{ color: 'var(--white)' }}>{active.provider}</strong></span>}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10, justifyContent: 'flex-end', background: 'var(--bg)' }}>
          {active?.isImage && (
            <a href={active.text} download target="_blank" rel="noreferrer" style={{
              fontSize: 12, padding: '8px 14px', borderRadius: 8,
              background: 'var(--surface2)', border: '1px solid var(--border2)',
              color: 'var(--muted2)', textDecoration: 'none', cursor: 'pointer',
            }}>↓ Download</a>
          )}
          {active?.isVideo && (
            <a href={active.text} download target="_blank" rel="noreferrer" style={{
              fontSize: 12, padding: '8px 14px', borderRadius: 8,
              background: 'var(--surface2)', border: '1px solid var(--border2)',
              color: 'var(--muted2)', textDecoration: 'none', cursor: 'pointer',
            }}>↓ Download</a>
          )}
          <button onClick={() => onContinue(item, activeIdx)} style={{
            fontSize: 12, padding: '8px 14px', borderRadius: 8,
            background: 'var(--red)', border: '1px solid var(--red)',
            color: '#fff', cursor: 'pointer', fontWeight: 600,
          }}>Continue with {active?.model_name ?? active?.name ?? 'this model'} →</button>
        </div>
      </div>
    </div>
  )
}

// Parse a Supabase signed URL to extract its bucket + storage path.
// The server signs URLs with a 24h TTL at generation time, so any URL stored
// in `xcreates.slots[].text` older than a day is dead. We re-sign on load.
//   /storage/v1/object/sign/{bucket}/{path}?token=...
function parseSupabaseSignedUrl(url: string): { bucket: string, path: string } | null {
  try {
    const u = new URL(url)
    const m = u.pathname.match(/^\/storage\/v1\/object\/sign\/([^/]+)\/(.+)$/)
    if (!m) return null
    return { bucket: m[1], path: decodeURIComponent(m[2]) }
  } catch {
    return null
  }
}

// Re-sign every Supabase signed URL found in `items[].slots[].text`. Batches
// per bucket via createSignedUrls to minimize round trips, then replaces the
// stale URL in-place. URLs that aren't Supabase signed URLs (or can't be
// re-signed, e.g. file deleted) are left untouched.
async function refreshSlotUrls(
  sb: ReturnType<typeof createSupabaseBrowser>,
  items: GalleryItem[],
): Promise<GalleryItem[]> {
  // Collect unique (bucket, path) pairs across all slots.
  const byBucket: Record<string, Set<string>> = {}
  items.forEach(item => {
    (item.slots ?? []).forEach((s: any) => {
      if (!s?.text) return
      const p = parseSupabaseSignedUrl(s.text)
      if (!p) return
      if (!byBucket[p.bucket]) byBucket[p.bucket] = new Set()
      byBucket[p.bucket].add(p.path)
    })
  })

  // Sign each bucket's paths in a single batched call.
  const urlMap: Record<string, Record<string, string>> = {}
  await Promise.all(Object.entries(byBucket).map(async ([bucket, paths]) => {
    const pathArr = Array.from(paths)
    if (pathArr.length === 0) return
    const { data, error } = await sb.storage.from(bucket).createSignedUrls(pathArr, 60 * 60 * 24)
    if (error || !data) return
    urlMap[bucket] = {}
    data.forEach((d, i) => { if (d.signedUrl) urlMap[bucket][pathArr[i]] = d.signedUrl })
  }))

  // Map fresh URLs back onto each slot, leaving everything else intact.
  return items.map(item => ({
    ...item,
    slots: (item.slots ?? []).map((s: any) => {
      if (!s?.text) return s
      const p = parseSupabaseSignedUrl(s.text)
      if (!p) return s
      const fresh = urlMap[p.bucket]?.[p.path]
      return fresh ? { ...s, text: fresh } : s
    }),
  }))
}

// ── Gallery ───────────────────────────────────────────────────────────────────
// Mode filter (text/image/video) is controlled from the parent so the filter
// tabs can live on the right side of the top-level XCreate/Gallery tab row
// — keeps a single selector bar instead of stacking two.
function Gallery({ userId, filterMode, onCounts, onOpen }: {
  userId: string,
  filterMode: Mode,
  onCounts: (c: Record<Mode, number>) => void,
  onOpen: (item: GalleryItem, slotIdx: number) => void,
}) {
  const [items,   setItems]   = useState<GalleryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [detail,  setDetail]  = useState<GalleryItem | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const sb = createSupabaseBrowser()
      const { data } = await sb.from('xcreates').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(40)
      if (cancelled) return
      // Show rows immediately so the UI doesn't block on signing, then
      // swap in refreshed URLs once the batch sign completes.
      const rows = (data ?? []) as GalleryItem[]
      setItems(rows)
      setLoading(false)
      try {
        const refreshed = await refreshSlotUrls(sb, rows)
        if (!cancelled) setItems(refreshed)
      } catch (err) {
        console.warn('[gallery] failed to refresh signed URLs', err)
      }
    })()
    return () => { cancelled = true }
  }, [userId])

  // Recompute per-mode counts whenever items change so the parent's filter tabs
  // can show totals next to each mode.
  useEffect(() => {
    const counts: Record<Mode, number> = { text: 0, image: 0, video: 0 }
    items.forEach(it => { if (it.mode in counts) counts[it.mode as Mode]++ })
    onCounts(counts)
    // Intentionally omit onCounts — it's expected to be stable enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])

  const filteredItems = items.filter(it => it.mode === filterMode)

  if (loading) return <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 40 }}>Loading gallery…</div>

  return (
    <>
      {detail && (
        <GalleryDetail
          item={detail}
          onClose={() => setDetail(null)}
          onContinue={(item, slotIdx) => { setDetail(null); onOpen(item, slotIdx) }}
        />
      )}

      {items.length === 0 ? (
        <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 60, fontSize: 13 }}>Your creations will appear here.</div>
      ) : filteredItems.length === 0 ? (
        <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 60, fontSize: 13 }}>
          No {filterMode} creations yet. Switch to another tab or create one in XCreate.
        </div>
      ) : (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
        {filteredItems.map(item => {
          const slots     = (item.slots ?? []).filter(Boolean)
          const mode      = item.mode as Mode
          const modeColor = mode === 'video' ? '#34d399' : mode === 'image' ? '#a78bfa' : '#4a9eff'
          const chosen    = slots.find((s: any) => s.id === item.chosen_model_id)
          const preview   = chosen ?? slots[0]
          return (
            <div key={item.id}
              onClick={() => setDetail(item)}
              onMouseEnter={e => {
                const el = e.currentTarget
                el.style.transform   = 'translateY(-2px)'
                el.style.borderColor = 'var(--red)'
                el.style.boxShadow   = '0 8px 24px rgba(232,69,60,0.15)'
              }}
              onMouseLeave={e => {
                const el = e.currentTarget
                el.style.transform   = 'translateY(0)'
                el.style.borderColor = 'var(--border2)'
                el.style.boxShadow   = 'none'
              }}
              style={{
                background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 12,
                overflow: 'hidden', cursor: 'pointer',
                transition: 'transform .18s ease, border-color .18s ease, box-shadow .18s ease',
              }}
            >
              {preview && (
                preview.isVideo ? <video src={preview.text} muted loop playsInline autoPlay style={{ width: '100%', display: 'block', maxHeight: 160, objectFit: 'cover', pointerEvents: 'none' }} />
                : preview.isImage ? <img src={preview.text} alt="" style={{ width: '100%', display: 'block', maxHeight: 160, objectFit: 'cover', pointerEvents: 'none' }} />
                : <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, maxHeight: 90, overflow: 'hidden', maskImage: 'linear-gradient(to bottom, black 50%, transparent 100%)' }}>{preview.text?.slice(0, 200)}</div>
              )}
              <div style={{ padding: '10px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, color: modeColor, background: modeColor + '18', padding: '2px 7px', borderRadius: 8, textTransform: 'uppercase' as const }}>{mode}</span>
                  <span style={{ fontSize: 9, color: 'var(--muted2)', background: 'var(--surface2)', padding: '2px 7px', borderRadius: 8, fontWeight: 700 }}>{slots.length} MODEL{slots.length === 1 ? '' : 'S'}</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>{new Date(item.created_at).toLocaleDateString()}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted2)', marginBottom: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.prompt}</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' as const }}>
                  {slots.map((s: any, i: number) => {
                    const isChosen = s.id === item.chosen_model_id
                    return (
                      <span key={i} style={{
                        fontSize: 10, padding: '2px 7px', borderRadius: 6, fontFamily: 'var(--mono)',
                        maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
                        color: isChosen ? 'var(--green)' : 'var(--muted2)',
                        background: isChosen ? 'var(--green-dim)' : 'var(--surface2)',
                        border: isChosen ? '1px solid #34d39940' : '1px solid var(--border2)',
                      }}>
                        {s.model_name ?? s.name}
                      </span>
                    )
                  })}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      )}
    </>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function CreatePage() {
  useRequireAuth()
  const cursorRef = useRef<HTMLDivElement>(null)
  const ringRef   = useRef<HTMLDivElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const setCursor = (color: string) => {
    if (cursorRef.current) cursorRef.current.style.background = color
    if (ringRef.current)   ringRef.current.style.borderColor  = color + '66'
  }

  const [userId,         setUserId]         = useState<string | null>(null)
  // Surface "?id=… not found or not yours" errors as a banner so the
  // user understands why the page didn't open the run they expected.
  // null = no error, string = message to display.
  const [loadError,      setLoadError]      = useState<string | null>(null)
  const [mode,           setMode]           = useState<Mode>('text')
  const [prompt,         setPrompt]         = useState('')
  const [selectedModels, setSelectedModels] = useState<(SlotModel | null)[]>([null, null, null, null])
  const [slots,          setSlots]          = useState<SlotState[]>([])
  const [pickerSlot,     setPickerSlot]     = useState<number | null>(null)
  const [phase,          setPhase]          = useState<Phase>('setup')
  // (Gallery view used to live here; it now lives in /profile under the
  // XCreates tab. XCreate page is single-purpose: the studio.)
  const [lightbox,       setLightbox]       = useState<string | null>(null)
  const [attachments,    setAttachments]    = useState<Attachment[]>([])
  const [slotOptions,   setSlotOptions]    = useState<(SlotOptions | null)[]>([null, null, null, null])
  // (galleryFilter / galleryCounts removed with the in-page Gallery tab.)

  // validateOpts is the single source of truth for "what options are valid
  // for this model in this mode". It accepts a (possibly stale) opts object
  // and returns a sanitized one — any field that no longer points at a
  // declared option falls back to a sensible default. Used both when
  // first selecting a model (with all fields null) and after every
  // user-driven change to one field, so changing resolution auto-clamps
  // duration, etc.
  const validateOpts = (model: SlotModel | null, m: Mode, opts: SlotOptions): SlotOptions => {
    if (!model) return opts
    // Restrict the model's declared modes to those compatible with the
    // current top-level mode (text/image/video). For example, a video
    // model declares `text_to_video` and `image_to_video`; in video mode
    // both are valid here.
    const modeOpts = (model.modes ?? []).filter(x => modeMatchesMode(x, m))
    const mode = opts.mode && modeOpts.includes(opts.mode) ? opts.mode : (modeOpts[0] ?? null)

    // Modes that consume a non-text input file (image_to_video, image_to_image,
    // video_to_video, reference_frames, start_end_frames) inherit aspect ratio
    // from the input. The picker is hidden in those cases and we default
    // aspect_ratio to null rather than the first declared option, so the
    // route handler doesn't pass a conflicting ratio to the provider.
    const isTextOnlyInput = !mode || mode.startsWith('text_to_')

    if (m === 'image') {
      const qualities = model.output_config?.image?.qualities ?? []
      const sizes = model.output_config?.image?.sizes ?? []
      const ars   = model.output_config?.image?.aspect_ratios ?? []
      const maxCount = model.output_config?.image?.max_count ?? 1
      // Clamp count to [1, maxCount]. Default to 1 (single image).
      const count = (() => {
        const n = opts.count ?? 1
        if (!Number.isFinite(n) || n < 1) return 1
        return Math.min(n, maxCount)
      })()
      return {
        mode,
        quality: opts.quality && qualities.includes(opts.quality)
          ? opts.quality
          : (qualities.includes('medium') ? 'medium' : (qualities[0] ?? null)),
        size: opts.size && sizes.includes(opts.size)
          ? opts.size
          : (sizes[0] ?? null),
        duration: null,
        aspect_ratio: !isTextOnlyInput
          ? null
          : opts.aspect_ratio && ars.includes(opts.aspect_ratio)
            ? opts.aspect_ratio
            : (ars[0] ?? null),
        // Watermark: same On/Off semantic as video. Default Off; ignored
        // by non-Alibaba providers in the route handler.
        watermark: opts.watermark === true ? true : false,
        count,
      }
    }
    if (m === 'video') {
      const sizes = model.output_config?.video?.sizes ?? []
      const ars   = model.output_config?.video?.aspect_ratios ?? []
      const dbr = model.output_config?.video?.durations_by_resolution ?? {}
      const size = opts.size && sizes.includes(opts.size) ? opts.size : (sizes[0] ?? null)
      const resKey = size ? inferResolutionKey(size, Object.keys(dbr)) : null
      const validForKey   = resKey ? expandDurations(dbr[resKey]) : []
      const validUnion    = Array.from(new Set(Object.values(dbr).flatMap(expandDurations))).sort((a, b) => a - b)
      let validDurations = validForKey.length > 0 ? validForKey : validUnion
      // Veo 3.1 start+end frame interpolation requires durationSeconds=8.
      // Clamp the valid set so a stale duration from another mode (e.g. 4)
      // gets snapped on switch.
      if (mode === 'start_end_frames' && model.provider === 'google' && validDurations.includes(8)) {
        validDurations = [8]
      }
      const duration = opts.duration != null && validDurations.includes(opts.duration)
        ? opts.duration
        : (validDurations[0] ?? null)
      const aspect_ratio = !isTextOnlyInput
        ? null
        : opts.aspect_ratio && ars.includes(opts.aspect_ratio)
          ? opts.aspect_ratio
          : (ars[0] ?? null)
      // Watermark default = Off. Only ever true/false now.
      return { mode, quality: null, size, duration, aspect_ratio, watermark: opts.watermark === true ? true : false, count: null }
    }
    // Text mode: no watermark concept. Keep it null so the summary line
    // and any future UI gating won't render watermark options for text.
    return { mode, quality: null, size: null, duration: null, aspect_ratio: null, watermark: null, count: null }
  }

  const defaultOptions = (model: SlotModel | null, m: Mode): SlotOptions =>
    validateOpts(model, m, { mode: null, quality: null, size: null, duration: null, aspect_ratio: null, watermark: false, count: null })

  // Apply a partial change to slot i and re-validate against the model's
  // current option set, so e.g. switching resolution downstream-clamps
  // duration to something valid.
  //
  // Also applies cross-field auto-switching:
  //   - patch.aspect_ratio → set size to the (only / first) matching size
  //   - patch.size         → set aspect_ratio to the inferred ratio if declared
  // This way picking '21:9' auto-selects the lone 1536×672 size and vice versa.
  const updateSlotOpts = (i: number, patch: Partial<SlotOptions>) => {
    setSlotOptions(prev => prev.map((o, idx) => {
      if (idx !== i || !o) return o
      const model = selectedModels[idx]
      const next: SlotOptions = { ...o, ...patch }

      if (model && (mode === 'image' || mode === 'video')) {
        const sizes = mode === 'video'
          ? (model.output_config?.video?.sizes ?? [])
          : (model.output_config?.image?.sizes ?? [])
        const ars   = mode === 'video'
          ? (model.output_config?.video?.aspect_ratios ?? [])
          : (model.output_config?.image?.aspect_ratios ?? [])

        // Aspect ratio changed → align the size to it.
        if ('aspect_ratio' in patch && next.aspect_ratio) {
          const matches = sizesMatchingAspect(sizes, next.aspect_ratio)
          if (matches.length > 0 && (!next.size || !matches.includes(next.size))) {
            next.size = matches[0]
          }
        }

        // Size changed → infer aspect ratio (if declared by the model).
        if ('size' in patch && next.size) {
          const inferred = aspectFromSize(next.size)
          if (inferred && ars.includes(inferred)) {
            next.aspect_ratio = inferred
          }
        }
      }

      return validateOpts(model, mode, next)
    }))
  }

  // Post-pick state
  const [chosenIdx,      setChosenIdx]      = useState<number | null>(null)
  const [chatHistory,    setChatHistory]    = useState<ChatMessage[]>([])
  const [chatInput,      setChatInput]      = useState('')
  const [chatStreaming,  setChatStreaming]  = useState(false)
  const [xcreateId,       setXcreateId]       = useState<string | null>(null)
  // Multi-turn image editing context
  const [imageResponseId, setImageResponseId] = useState<string | null>(null)           // OpenAI
  const [imageConvHistory, setImageConvHistory] = useState<any[] | null>(null)           // Google

  // Job polling — persists generation across navigation.
  const [jobId,          setJobId]          = useState<string | null>(null)
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const modeClearedRef = useRef(false)  // skip the mode-change reset on initial resume
  const jobIdRef = useRef<string | null>(null)
  useEffect(() => { jobIdRef.current = jobId }, [jobId])

  // Cursor
  useEffect(() => {
    let mx = 0, my = 0, rx = 0, ry = 0, rafId: number
    const move = (e: MouseEvent) => {
      mx = e.clientX; my = e.clientY
      if (cursorRef.current) { cursorRef.current.style.left = mx+'px'; cursorRef.current.style.top = my+'px' }
    }
    const tick = () => {
      rx += (mx-rx)*0.12; ry += (my-ry)*0.12
      if (ringRef.current) { ringRef.current.style.left = rx+'px'; ringRef.current.style.top = ry+'px' }
      rafId = requestAnimationFrame(tick)
    }
    document.addEventListener('mousemove', move)
    rafId = requestAnimationFrame(tick)
    return () => { document.removeEventListener('mousemove', move); cancelAnimationFrame(rafId) }
  }, [])

  useEffect(() => {
    createSupabaseBrowser().auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null))
  }, [])

  // Open-from-URL: when /xcreate?id=<uuid> is loaded (e.g. clicking an
  // XCreate card in the profile gallery), auto-fetch that row and feed it
  // into loadFromGallery so the studio resumes in the picking/chatting
  // phase.
  //
  // Privacy: we wait for `userId` to resolve before firing — the fetch
  // goes through the authenticated Supabase browser client so RLS
  // enforces ownership server-side. If the row exists but belongs to a
  // different user, .maybeSingle() returns `data: null` and we just log
  // and bail (no leak). If the user isn't logged in at all, we skip the
  // fetch entirely; the auth modal flow (triggered elsewhere) handles
  // the sign-in prompt.
  //
  // The URL is left intact so the user can copy the deep link or refresh
  // and end up back where they were. `galleryLoadedRef` keeps the load
  // from re-firing within the same component lifetime.
  const galleryLoadedRef = useRef(false)
  useEffect(() => {
    if (galleryLoadedRef.current || typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const idParam = params.get('id')
    if (!idParam) return
    if (!userId) return  // wait for auth — RLS would reject unauthenticated
    galleryLoadedRef.current = true
    ;(async () => {
      try {
        const sb = createSupabaseBrowser()
        const { data, error } = await sb.from('xcreates').select('*').eq('id', idParam).maybeSingle()
        if (error || !data) {
          // Two reasons we end up here:
          //   1. The row exists but belongs to another user — RLS hides
          //      it and .maybeSingle() returns null.
          //   2. The row was deleted / id is wrong.
          // We can't distinguish (1) from (2) client-side (that would
          // itself be a leak), so we use a single neutral message.
          console.warn('[xcreate] open-from-url: row not found or no access', error?.message)
          setLoadError("This XCreate doesn't exist or you don't have access. It may belong to another account.")
          return
        }
        await loadFromGallery(data as any)
      } catch (err) {
        console.warn('[xcreate] open-from-url failed:', err instanceof Error ? err.message : err)
        setLoadError('Could not load this XCreate. Please try again.')
      }
    })()
  // Intentionally exhaustive: loadFromGallery is stable enough; we only
  // want this to fire once per fresh page load (after auth resolves).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  useEffect(() => {
    // When resuming an in-progress job, the mode is restored from the job
    // row — don't clobber the restored state.
    if (modeClearedRef.current) { modeClearedRef.current = false; return }
    setSelectedModels([null, null, null, null]); setSlots([]); setPhase('setup')
    setChosenIdx(null); setChatHistory([]); setXcreateId(null); setAttachments([])
    setSlotOptions([null, null, null, null])
  }, [mode])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatHistory, chatStreaming])

  const activeModels = selectedModels.filter(Boolean) as SlotModel[]
  const selectedIds  = activeModels.map(m => m.id)

  const addModel    = (i: number, m: SlotModel) => {
    setSelectedModels(prev => prev.map((v, idx) => idx === i ? m : v))
    setSlotOptions(prev => prev.map((v, idx) => idx === i ? defaultOptions(m, mode) : v))
    setSlots([])  // clear any stale results from previous run
    setPhase('setup')
    setPickerSlot(null)
  }
  const removeModel = (i: number) => {
    setSelectedModels(prev => prev.map((v, idx) => idx === i ? null : v))
    setSlotOptions(prev => prev.map((v, idx) => idx === i ? null : v))
    setSlots([])  // clear any stale results from previous run
    setPhase('setup')
  }

  // ── Polling helpers ─────────────────────────────────────────────────────────
  const stopPolling = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }

  // Apply a /api/xcreate/job/[id] response to local state.
  const applyJobData = (data: { job: any; slots: any[] }) => {
    // Convert server slot format → SlotState
    const nextSlots: SlotState[] = data.slots.map(sl => ({
      text:         sl.text ?? '',
      isImage:      !!sl.isImage,
      isVideo:      !!sl.isVideo,
      streaming:    !!sl.streaming,
      done:         !!sl.done,
      cost:         Number(sl.cost ?? 0),
      responseTime: Number(sl.responseTime ?? 0),
      error:        sl.error ?? null,
    }))
    setSlots(nextSlots)

    if (data.job.status === 'completed') {
      setPhase('picking')
      if (data.job.xcreateId) setXcreateId(data.job.xcreateId)
      setJobId(null)
      stopPolling()
    } else if (data.job.status === 'failed') {
      console.warn('[xcreate] job failed:', data.job.error)
      setPhase('setup')
      setJobId(null)
      stopPolling()
    }
  }

  const pollOnce = async (id: string) => {
    try {
      const res = await fetch(`/api/xcreate/job/${id}`, { cache: 'no-store' })
      if (res.status === 404) return  // job row may not exist yet in the first ~100ms after POST
      if (!res.ok) {
        console.warn('[xcreate] poll failed', res.status)
        stopPolling()
        return
      }
      const data = await res.json()
      applyJobData(data)
    } catch (err) {
      console.error('[xcreate] poll error', err)
    }
  }

  const startPolling = (id: string) => {
    stopPolling()
    setJobId(id)
    // Poll immediately, then every 1s
    pollOnce(id)
    pollTimerRef.current = setInterval(() => pollOnce(id), 1000)
  }

  // Stop polling on unmount
  useEffect(() => () => stopPolling(), [])

  // On mount: if user has an in-progress job, restore state and resume polling.
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    ;(async () => {
      try {
        const activeRes = await fetch('/api/xcreate/jobs/active', { cache: 'no-store' })
        if (!activeRes.ok) return
        const { jobId: activeId } = await activeRes.json()
        if (!activeId || cancelled) return

        const res = await fetch(`/api/xcreate/job/${activeId}`, { cache: 'no-store' })
        if (!res.ok || cancelled) return
        const data = await res.json()

        // Restore prompt + mode + selectedModels + slotOptions
        const jobMode = data.job.mode as Mode
        modeClearedRef.current = true  // prevent the mode-change useEffect from wiping state
        setMode(jobMode)
        setPrompt(data.job.prompt ?? '')

        // Look up SlotModel details for each slot (for the picker / options UI)
        const sb = createSupabaseBrowser()
        const modelIds = data.slots.map((s: any) => s.modelId)
        const { data: modelRows } = await sb.from('ai_models').select('id, provider, model_name, display_name, modes, model_pricing, output_config').in('id', modelIds)
        const byId: Record<string, SlotModel> = {}
        ;(modelRows ?? []).forEach((m: any) => {
          byId[m.id] = {
            id: m.id, provider: m.provider, model_name: m.model_name, display_name: m.display_name,
            modes:         (m.modes ?? []) as ModelMode[],
            model_pricing: m.model_pricing,
            output_config: m.output_config,
          }
        })
        const restoredModels: (SlotModel | null)[] = [null, null, null, null]
        const restoredOptions: (SlotOptions | null)[] = [null, null, null, null]
        data.slots.forEach((s: any, i: number) => {
          const m = byId[s.modelId]
          if (m) restoredModels[i] = m
          const opts = s.options ?? {}
          restoredOptions[i] = {
            mode:         opts.mode ?? null,
            quality:      opts.quality ?? null,
            size:         opts.size ?? null,
            duration:     opts.duration ?? null,
            aspect_ratio: opts.aspect_ratio ?? null,
            watermark:    opts.watermark === true ? true : false,
            count:        opts.count ?? null,
          }
        })
        setSelectedModels(restoredModels)
        setSlotOptions(restoredOptions)
        setPhase('generating')

        applyJobData(data)
        if (data.job.status === 'running') startPolling(activeId)
      } catch (err) {
        console.error('[xcreate] resume failed', err)
      }
    })()
    return () => { cancelled = true }
  }, [userId])

  const generate = async () => {
    // Mirror canGenerate: video / image with an attachment is enough to
    // proceed even if the prompt is empty (image_to_video, image_to_image,
    // reference_frames, etc. animate / transform the input file with no
    // text required).
    const hasAttachmentForGen = attachments.length > 0
    const promptOkForGen = prompt.trim().length >= 1 ||
      ((mode === 'video' || mode === 'image') && hasAttachmentForGen)
    if (!promptOkForGen || activeModels.length === 0 || phase === 'generating') return
    setPhase('generating')
    setSlots(activeModels.map(() => ({ text: '', isImage: false, isVideo: false, streaming: true, done: false, cost: 0, responseTime: 0, error: null })))
    setChosenIdx(null); setChatHistory([]); setXcreateId(null)

    // Client-generated job id so we can start polling before POST returns.
    const newJobId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`

    // Fire POST but don't await its body — it runs for the full generation
    // duration and we read progress from the polling endpoint instead.
    // Build modelIds + modelOptions arrays in lockstep by walking
    // selectedModels directly. Don't use activeModels.map + indexOf — when
    // the same model is picked into two different slots, indexOf collapses
    // them onto the first slot's options.
    const ids: string[] = []
    const optsList: Array<Record<string, unknown>> = []
    for (let i = 0; i < selectedModels.length; i++) {
      const m = selectedModels[i]
      if (!m) continue
      const opts = slotOptions[i]
      ids.push(m.id)
      optsList.push(opts ? {
        quality:      opts.quality,
        size:         opts.size,
        duration:     opts.duration,
        aspect_ratio: opts.aspect_ratio,
        watermark:    opts.watermark,
        count:        opts.count,
        mode:         opts.mode,
      } : {})
    }
    fetch('/api/xcreate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobId: newJobId,
        prompt, mode,
        modelIds: ids,
        modelOptions: optsList,
        attachments: attachments.map(a => ({ storagePath: a.storagePath, bucket: a.bucket, mediaType: a.mediaType, fileName: a.fileName, fileSize: a.fileSize })),
      }),
    }).catch(err => console.warn('[xcreate] POST failed:', err))

    // Begin polling right away. First couple of polls may 404 until the
    // server has inserted the job row — pollOnce handles 404 gracefully.
    startPolling(newJobId)
  }

  const pickModel = async (idx: number) => {
    if (!userId) return
    setChosenIdx(idx)
    const chosen  = activeModels[idx]
    const initial = slots[idx]

    // Seed chat with initial exchange
    setChatHistory([
      { role: 'user',      content: prompt },
      { role: 'assistant', content: initial.text, isImage: initial.isImage, isVideo: initial.isVideo },
    ])
    setPhase('chatting')

    // Fetch multi-turn context from the server-created xcreates row.
    // The server route stores responseId/conversationHistory in slots jsonb.
    const sb = createSupabaseBrowser()
    if (xcreateId) {
      try {
        const { data: xrow } = await sb.from('xcreates').select('slots').eq('id', xcreateId).single()
        if (xrow?.slots?.[idx]) {
          const serverSlot = xrow.slots[idx]
          if (serverSlot.responseId) setImageResponseId(serverSlot.responseId)
          if (serverSlot.conversationHistory) setImageConvHistory(serverSlot.conversationHistory)
        }
      } catch {}
    }

    // Save to DB with chosen model recorded.
    //
    // The server route inserts the xcreates row at the end of /api/xcreate
    // (with chosen_model_id = null) and returns its id via the polling
    // endpoint as `xcreateId`. We therefore *update* that existing row
    // here — inserting a duplicate row was the previous behaviour and
    // had two failure modes:
    //
    //   1. The original server-inserted row stayed at chosen_model_id = null
    //      and got filtered out of the leaderboard's BT calculation,
    //      so HappyHorse I2V / any winner never accumulated votes.
    //   2. RLS / constraint failures on the duplicate insert silently
    //      dropped the vote with no user-visible error.
    //
    // Falls back to insert if xcreateId is missing for some reason
    // (e.g. polling lost the id, gallery-loaded run, etc.).
    //
    // Note: chat_history was previously written here too but it caused
    // failures on dev DBs that haven't run supabase/17_xcreate_chat_history.sql.
    // sendChat() reseeds the chat history once the user actually starts
    // chatting, so dropping it here is safe — the leaderboard only cares
    // about chosen_model_id.
    const slotsPayload = slots.map((s, i) => ({
      id: activeModels[i]?.id, name: activeModels[i]?.display_name, provider: activeModels[i]?.provider,
      model_name: activeModels[i]?.model_name,
      text: s.text, isImage: s.isImage, isVideo: s.isVideo, cost: s.cost, responseTime: s.responseTime,
      chosen: i === idx,
    }))
    if (xcreateId) {
      const { error } = await sb.from('xcreates').update({
        chosen_model_id: chosen.id,
        slots: slotsPayload,
      }).eq('id', xcreateId)
      if (error) {
        console.warn('[xcreate] update chosen_model_id failed:', error.message)
        // Fallback to insert so the vote isn't lost — same payload as before.
        const { data } = await sb.from('xcreates').insert({
          user_id: userId, mode, prompt,
          chosen_model_id: chosen.id,
          slots: slotsPayload,
        }).select('id').single()
        if (data?.id) setXcreateId(data.id)
      }
    } else {
      const { data } = await sb.from('xcreates').insert({
        user_id: userId, mode, prompt,
        chosen_model_id: chosen.id,
        slots: slotsPayload,
      }).select('id').single()
      if (data?.id) setXcreateId(data.id)
    }
  }

  const sendChat = async () => {
    if (!chatInput.trim() || chatStreaming || chosenIdx === null) return
    const userMsg = chatInput.trim()
    setChatInput('')
    const newHistory: ChatMessage[] = [...chatHistory, { role: 'user', content: userMsg }]
    setChatHistory(newHistory)
    setChatStreaming(true)

    const chosen = activeModels[chosenIdx]
    try {
      const res = await fetch('/api/xcreate/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: chosen.id,
          messages: newHistory,
          mode,
          previousResponseId: imageResponseId,       // OpenAI multi-turn
          conversationHistory: imageConvHistory,      // Google multi-turn
        }),
      })
      if (!res.ok || !res.body) throw new Error(await res.text())

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = '', currentEvent = '', assistantText = ''

      // For image/video we add a placeholder immediately; for text we stream into it
      if (mode === 'text') {
        setChatHistory(h => [...h, { role: 'assistant', content: '' }])
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n'); buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (line.startsWith('event: ')) { currentEvent = line.slice(7).trim() }
          else if (line.startsWith('data: ')) {
            try {
              const p = JSON.parse(line.slice(6))
              if (currentEvent === 'delta') {
                // text streaming
                assistantText += p.text ?? ''
                setChatHistory(h => h.map((m, i) => i === h.length - 1 ? { ...m, content: assistantText } : m))
              } else if (currentEvent === 'image') {
                // image done — append as image message
                setChatHistory(h => [...h, { role: 'assistant', content: p.url, isImage: true }])
                // Update multi-turn context for next image edit
                if (p.responseId) setImageResponseId(p.responseId)
                if (p.conversationHistory) setImageConvHistory(p.conversationHistory)
              } else if (currentEvent === 'video') {
                // video done — append as video message
                setChatHistory(h => [...h, { role: 'assistant', content: p.url, isVideo: true }])
              } else if (currentEvent === 'progress') {
                // could show progress in future
              } else if (currentEvent === 'error') {
                setChatHistory(h => [...h, { role: 'assistant', content: `Error: ${p.message}` }])
              }
            } catch {}
          }
        }
      }
    } catch (err) { console.error(err) }
    setChatStreaming(false)

    // Persist updated chat history to DB so it survives navigation.
    // We read from the setter to get the latest state (setChatHistory closures
    // may be stale). Instead, schedule a microtask that reads the ref-like latest.
    setTimeout(() => {
      // Access latest chatHistory via a one-shot state read
      setChatHistory(latest => { saveChatHistory(latest); return latest })
    }, 0)
  }

  // Persist chat history to DB so it survives navigation.
  const saveChatHistory = async (history: ChatMessage[], xid?: string | null) => {
    const id = xid ?? xcreateId
    if (!id || history.length === 0) return
    try {
      const sb = createSupabaseBrowser()
      // Strip large data URLs from persisted content — store a placeholder instead.
      // Images/videos generated by the API are also saved to Supabase storage and
      // referenced via signed URLs on reload, so we only need the URL, not inline data.
      const cleaned = history.map(m => ({
        role: m.role,
        content: m.content,
        ...(m.isImage ? { isImage: true } : {}),
        ...(m.isVideo ? { isVideo: true } : {}),
      }))
      // Also persist multi-turn context so it survives navigation
      const updatePayload: any = { chat_history: cleaned }
      if (imageResponseId) updatePayload.response_id = imageResponseId
      await sb.from('xcreates').update(updatePayload).eq('id', id)
    } catch (err) { console.warn('[xcreate] failed to save chat history:', err) }
  }

  const reset = () => {
    setPhase('setup'); setSlots([]); setChosenIdx(null)
    setChatHistory([]); setChatInput(''); setXcreateId(null)
    setPrompt(''); setAttachments([])
    setSelectedModels([null, null, null, null])
    setSlotOptions([null, null, null, null])
    setImageResponseId(null); setImageConvHistory(null)
    // Strip ?id=... from the URL so refreshing doesn't re-load the
    // run we just abandoned, and so the address bar matches the fresh
    // setup state. galleryLoadedRef stays true so the open-from-URL
    // effect doesn't fire again in this session.
    if (typeof window !== 'undefined' && window.location.search) {
      const url = new URL(window.location.href)
      url.search = ''
      window.history.replaceState({}, '', url.toString())
    }
  }

  // Load a saved creation back into the Create tab so the user can continue
  // chatting with any model from that run. `continueIdx` is the index into the
  // stored slots array for the model they want to continue with. If omitted,
  // we default to the chosen model (or the first slot if none was chosen).
  // Multi-turn chat history isn't persisted yet — only the initial exchange
  // is restored; further conversation starts fresh.
  const loadFromGallery = async (item: GalleryItem, continueIdx?: number) => {
    const rawSlots = (item.slots ?? []).filter(Boolean)
    if (rawSlots.length === 0) return
    const itemMode = item.mode as Mode

    // Fetch current model details for each slot (pricing/options have to be
    // pulled from the live table — the stored slot only keeps id/name/text).
    const sb = createSupabaseBrowser()
    const modelIds = rawSlots.map((s: any) => s.id).filter(Boolean)
    const { data: modelRows } = await sb.from('ai_models')
      .select('id, provider, model_name, display_name, modes, model_pricing, output_config')
      .in('id', modelIds)
    const byId: Record<string, SlotModel> = {}
    ;(modelRows ?? []).forEach((m: any) => {
      byId[m.id] = {
        id: m.id, provider: m.provider, model_name: m.model_name, display_name: m.display_name,
        modes:         (m.modes ?? []) as ModelMode[],
        model_pricing: m.model_pricing,
        output_config: m.output_config,
      }
    })

    // Also index by (provider, model_name) so we can recover if the UUID
    // changed after a sync (the sync script can delete+re-insert rows).
    const byProviderModel: Record<string, SlotModel> = {}
    ;(modelRows ?? []).forEach((m: any) => {
      byProviderModel[`${m.provider}/${m.model_name}`] = byId[m.id]
    })

    // If UUID lookup missed some slots, try a secondary lookup by (provider, model_name)
    const missingSlots = rawSlots.filter((s: any) => s.id && !byId[s.id] && s.provider && s.model_name)
    if (missingSlots.length > 0) {
      // Fetch by provider+model_name pairs
      const orFilters = missingSlots.map((s: any) => `and(provider.eq.${s.provider},model_name.eq.${s.model_name})`).join(',')
      const { data: fallbackRows } = await sb.from('ai_models')
        .select('id, provider, model_name, display_name, modes, model_pricing, output_config')
        .or(orFilters)
      ;(fallbackRows ?? []).forEach((m: any) => {
        const key = `${m.provider}/${m.model_name}`
        const slot = byProviderModel[key] ?? {
          id: m.id, provider: m.provider, model_name: m.model_name, display_name: m.display_name,
          modes:         (m.modes ?? []) as ModelMode[],
          model_pricing: m.model_pricing,
          output_config: m.output_config,
        }
        byProviderModel[key] = slot
        // Map old UUID → new model
        missingSlots.filter((s: any) => s.provider === m.provider && s.model_name === m.model_name)
          .forEach((s: any) => { byId[s.id] = slot })
      })
    }

    // Block the mode-change useEffect from wiping the state we're about to set.
    modeClearedRef.current = true
    setMode(itemMode)
    setPrompt(item.prompt)
    setAttachments([])

    const restoredModels:  (SlotModel | null)[]   = [null, null, null, null]
    const restoredOptions: (SlotOptions | null)[] = [null, null, null, null]
    const restoredSlots:   SlotState[]            = []

    rawSlots.slice(0, 4).forEach((s: any, i: number) => {
      // Try UUID first, then fall back to (provider, model_name), then
      // build a minimal SlotModel from the stored slot data so Continue
      // still works even if the model was removed from the DB entirely.
      let m: SlotModel | null = s.id ? byId[s.id] : null
      if (!m && s.provider && s.model_name) {
        m = byProviderModel[`${s.provider}/${s.model_name}`] ?? null
      }
      if (!m && (s.id || s.model_name)) {
        // Synthetic fallback — enough to render the card and call the API
        m = {
          id: s.id ?? crypto.randomUUID(),
          provider: s.provider ?? 'openai',
          model_name: s.model_name ?? 'unknown',
          display_name: s.name ?? s.model_name ?? 'Unknown Model',
          modes: [],
          model_pricing: null,
          output_config: null,
        }
      }
      if (m) {
        restoredModels[i] = m
        // Restore the exact options the slot ran with (mode/quality/size/
        // duration/aspect_ratio/watermark/count). Passing the saved blob
        // through validateOpts canonicalizes anything that's missing or
        // no longer valid against the current model definition (e.g. a
        // size that's since been removed from the catalog).
        const savedOpts = s.options && typeof s.options === 'object'
          ? {
              mode:         s.options.mode         ?? null,
              quality:      s.options.quality      ?? null,
              size:         s.options.size         ?? null,
              duration:     s.options.duration     ?? null,
              aspect_ratio: s.options.aspect_ratio ?? null,
              watermark:    typeof s.options.watermark === 'boolean' ? s.options.watermark : false,
              count:        s.options.count        ?? null,
            }
          : null
        restoredOptions[i] = savedOpts
          ? validateOpts(m, itemMode, savedOpts)
          : defaultOptions(m, itemMode)
      }
      restoredSlots.push({
        text:         s.text ?? '',
        isImage:      !!s.isImage,
        isVideo:      !!s.isVideo,
        streaming:    false,
        done:         true,
        cost:         Number(s.cost ?? 0),
        responseTime: Number(s.responseTime ?? 0),
        error:        null,
      })
    })

    // Re-sign any expired Supabase signed URLs in slot.text. Stored URLs
    // were minted with a 24h TTL, so anything older than a day comes back
    // as a broken image without this step. Same logic as the profile
    // page's gallery hydrate.
    const refreshedSlots = await Promise.all(restoredSlots.map(async (slot) => {
      if (!slot.text || typeof slot.text !== 'string') return slot
      const parts = slot.text.split('\n')
      const fresh = await Promise.all(parts.map(async (part: string) => {
        const m = part.match(/\/storage\/v1\/object\/sign\/([^/]+)\/([^?]+)/)
        if (!m) return part
        const [, bucket, path] = m
        const { data: signed } = await sb.storage.from(bucket).createSignedUrl(decodeURIComponent(path), 60 * 60 * 24)
        return signed?.signedUrl ?? part
      }))
      return { ...slot, text: fresh.join('\n') }
    }))

    setSelectedModels(restoredModels)
    setSlotOptions(restoredOptions)
    setSlots(refreshedSlots)
    setXcreateId(item.id)

    // Decide which slot to continue with.
    let targetIdx: number | null = null
    if (typeof continueIdx === 'number' && continueIdx >= 0 && continueIdx < rawSlots.length) {
      targetIdx = continueIdx
    } else if (item.chosen_model_id) {
      const idx = rawSlots.findIndex((s: any) => s.id === item.chosen_model_id)
      if (idx !== -1) targetIdx = idx
    }

    if (targetIdx !== null && restoredModels[targetIdx]) {
      setChosenIdx(targetIdx)
      // Restore multi-turn image context from stored slot data
      const targetSlot = rawSlots[targetIdx] as any
      setImageResponseId(targetSlot?.responseId ?? null)
      setImageConvHistory(targetSlot?.conversationHistory ?? null)
      // Restore persisted chat history if available, otherwise seed with initial exchange.
      const saved = Array.isArray(item.chat_history) && item.chat_history.length > 0
        ? item.chat_history
        : null
      if (saved) {
        setChatHistory(saved)
      } else {
        const initial = restoredSlots[targetIdx]
        setChatHistory([
          { role: 'user',      content: item.prompt },
          { role: 'assistant', content: initial.text, isImage: initial.isImage, isVideo: initial.isVideo },
        ])
      }
      setPhase('chatting')
    } else {
      setChosenIdx(null); setChatHistory([]); setPhase('picking')
    }

    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // In video (and image) mode, an attached image alone is enough to drive
  // generation — image_to_video / image_to_image / reference_frames etc. all
  // animate / transform the file with no text needed. The prompt-length gate
  // would otherwise force the user to invent a text caption they don't want.
  // Text mode still requires a prompt (no other input shape exists).
  const hasAttachment = attachments.length > 0
  const promptOk = prompt.trim().length >= 3 ||
    ((mode === 'video' || mode === 'image') && hasAttachment)
  const canGenerate = promptOk && activeModels.length > 0 && phase !== 'generating'

  // Once the user fires a generation, every setup control (mode tabs,
  // model picker, per-slot options, prompt, attachment) freezes — we
  // don't want them mutating state behind already-rendered results.
  // The only way out is the Start Over button (which calls reset()).
  const isLocked = phase !== 'setup'

  // Sum of per-slot USD estimates for the currently-selected models at their
  // currently-selected options. Null if no slot has pricing — in that case
  // we'd rather show nothing than a misleading partial total.
  const totalEstDollars = (() => {
    if (activeModels.length === 0) return null
    let total = 0
    let anyKnown = false
    for (let i = 0; i < selectedModels.length; i++) {
      const m = selectedModels[i]
      if (!m) continue
      const d = estimateSlotDollars(m, mode, slotOptions[i], prompt.length)
      if (d != null) { total += d; anyKnown = true }
    }
    return anyKnown ? total : null
  })()

  return (
    <>
      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{position:'fixed',inset:0,zIndex:99000,background:'rgba(0,0,0,0.92)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer'}}>
          <img src={lightbox} alt="Full size" onClick={() => setLightbox(null)} style={{maxWidth:'90vw',maxHeight:'90vh',borderRadius:8,boxShadow:'0 0 80px rgba(0,0,0,0.8)',cursor:'pointer'}} />
          <div onClick={e => e.stopPropagation()} style={{position:'fixed',top:20,right:24,zIndex:99100,display:'flex',gap:10}}>
            <a href={lightbox} download target="_blank" rel="noreferrer" title="Download"
              style={{display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(255,255,255,0.15)',border:'1px solid rgba(255,255,255,0.3)',borderRadius:8,width:36,height:36,color:'#fff',fontSize:16,textDecoration:'none',cursor:'pointer',boxShadow:'0 2px 12px rgba(0,0,0,0.4)'}}
            >↓</a>
            <button onClick={() => setLightbox(null)} title="Close"
              style={{display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(255,255,255,0.15)',border:'1px solid rgba(255,255,255,0.3)',borderRadius:8,width:36,height:36,color:'#fff',fontSize:16,cursor:'pointer',boxShadow:'0 2px 12px rgba(0,0,0,0.4)'}}
            >✕</button>
          </div>
        </div>
      )}
      {pickerSlot !== null && (
        <ModelPickerDialog mode={mode} selectedIds={selectedIds} onSelect={m => addModel(pickerSlot, m)} onClose={() => setPickerSlot(null)} />
      )}

      <div className="cursor" ref={cursorRef} />
      <div className="cursor-ring" ref={ringRef} />

      <div className="xduel-page">
        <div className="arena">

          {/* Header */}
          <div className="prompt-header">
            <div className="prompt-label">XCreate</div>
            <h1 className="prompt-title">
              Your Private <span>Studio</span>
            </h1>
            <div className="prompt-sub" style={{ marginTop: 8 }}>
              <Link href="/leaderboard" style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 11, color: 'var(--red)', letterSpacing: '0.08em', textDecoration: 'none' }}>
                BROWSE ALL MODELS →
              </Link>
            </div>
          </div>

          {/* (Gallery tab removed — moved to /profile under the XCreates
              tab. XCreate is now single-purpose: the studio.) */}

          {/* Error banner — surfaces ?id= load failures (row not found,
              row belongs to another user) so the user understands why
              the page didn't open the run they expected. Dismissible. */}
          {loadError && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 16px', marginBottom: 24,
              background: 'rgba(232,69,60,0.08)',
              border: '1px solid rgba(232,69,60,0.35)',
              borderRadius: 8,
              color: 'var(--red)', fontSize: 13,
              fontFamily: 'var(--font-body), sans-serif',
            }}>
              <span style={{ fontSize: 16 }}>⚠</span>
              <span style={{ flex: 1 }}>{loadError}</span>
              <button
                onClick={() => {
                  setLoadError(null)
                  // Strip ?id=… so a refresh doesn't re-show the same error.
                  if (typeof window !== 'undefined' && window.location.search) {
                    const url = new URL(window.location.href)
                    url.search = ''
                    window.history.replaceState({}, '', url.toString())
                  }
                }}
                style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 16, opacity: 0.7 }}
                aria-label="Dismiss"
              >×</button>
            </div>
          )}

          {/* ── CHATTING PHASE ── */}
          {phase === 'chatting' && chosenIdx !== null ? (
              <div>
                {/* Chosen model header — single line: name + run cost. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, padding: '14px 18px', background: 'var(--surface)', border: `1px solid ${SLOT_COLORS[chosenIdx]}44`, borderRadius: 12 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--white)' }}>
                    {stripModelVariant(activeModels[chosenIdx].display_name)}
                    {(slots[chosenIdx]?.cost ?? 0) > 0 && (
                      <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)', marginLeft: 10, fontWeight: 500 }}>
                        {fmtDollars(slots[chosenIdx]?.cost ?? 0)}
                      </span>
                    )}
                  </div>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                    <span style={{ fontSize: 11, color: 'var(--green)', background: '#34d39918', padding: '4px 10px', borderRadius: 8 }}>✓ Your pick</span>
                    <button onClick={reset} style={{ background: 'transparent', border: '1px solid var(--border2)', color: 'var(--muted)', borderRadius: 8, padding: '4px 12px', fontSize: 12, cursor: 'pointer' }}>
                      ← New Session
                    </button>
                  </div>
                </div>

                {/* Dismissed models */}
                {activeModels.length > 1 && (
                  <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' as const }}>
                    <span style={{ fontSize: 11, color: 'var(--muted)', alignSelf: 'center' }}>Dismissed:</span>
                    {activeModels.map((m, i) => i === chosenIdx ? null : (
                      <span key={i} style={{ fontSize: 11, color: 'var(--muted)', background: 'var(--surface)', border: '1px solid var(--border2)', padding: '3px 10px', borderRadius: 8, fontFamily: 'var(--mono)', textDecoration: 'line-through' }}>
                        {m.model_name ?? m.display_name}
                      </span>
                    ))}
                  </div>
                )}

                {/* Chat messages */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 20, minHeight: 200 }}>
                  {chatHistory.map((msg, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                      {/* Provider avatar circle dropped — badge was
                          redundant noise. */}
                      <div style={{
                        maxWidth: '72%', padding: '12px 16px', borderRadius: msg.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                        background: msg.role === 'user' ? 'var(--surface2)' : 'var(--surface)',
                        border: `1px solid var(--border2)`,
                        fontSize: 14, lineHeight: 1.7, color: msg.role === 'user' ? 'var(--muted2)' : 'var(--white)',
                      }}>
                        {msg.isVideo ? <video src={msg.content} autoPlay loop muted playsInline controls style={{ width: '100%', borderRadius: 6 }} />
                        : msg.isImage ? <img src={msg.content} alt="" onClick={() => setLightbox(msg.content)} style={{ maxWidth: '100%', borderRadius: 6, cursor: 'zoom-in' }} />
                        : <div className="markdown-body"><ReactMarkdown skipHtml components={{a: ({href, children}) => { if (!href || (!href.startsWith('http://') && !href.startsWith('https://'))) return <span>{children}</span>; return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}}>{msg.content}</ReactMarkdown></div>}
                        {i === chatHistory.length - 1 && msg.role === 'assistant' && chatStreaming && <span className="stream-cursor">▋</span>}
                      </div>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>

                {/* Chat input */}
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                  <textarea
                    value={chatInput} onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendChat() } }}
                    placeholder="Continue the conversation…"
                    rows={2}
                    style={{ flex: 1, background: '#ffffff', border: '1px solid var(--border2)', borderRadius: 10, padding: '12px 16px', color: 'var(--white)', fontSize: 14, fontFamily: 'inherit', resize: 'none', outline: 'none' }}
                  />
                  <button onClick={sendChat} disabled={chatStreaming || !chatInput.trim()} style={{
                    padding: '12px 20px', borderRadius: 10, border: 'none', background: 'var(--red)', color: 'var(--white)',
                    fontWeight: 700, fontSize: 14, cursor: chatStreaming ? 'wait' : 'pointer', flexShrink: 0,
                    opacity: chatStreaming || !chatInput.trim() ? 0.5 : 1,
                  }}>
                    {chatStreaming ? '…' : '→'}
                  </button>
                </div>
              </div>

            ) : (
              /* ── SETUP / GENERATING / PICKING ── */
              <>
                {/* Mode — clickable only during setup. Once a run has started
                    (generating / picking / chatting) the tabs lock; user must
                    Start Over to switch modes. Switching modes nukes any
                    prior selection/results via the mode-change useEffect
                    above, which is intentional. */}
                <div className="mode-selector" style={{ marginBottom: 24, opacity: isLocked ? 0.45 : 1 }}>
                  {(['text', 'image', 'video'] as Mode[]).map(m => (
                    <button key={m} className={`mode-btn ${mode === m ? 'active' : ''}`}
                      disabled={isLocked}
                      onClick={() => { if (!isLocked) setMode(m) }}
                      style={{ cursor: isLocked ? 'default' : undefined }}
                    >
                      <span className="mode-dot" />{m.charAt(0).toUpperCase() + m.slice(1)}
                    </button>
                  ))}
                </div>

                {/* Model slots + per-model options */}
                {/* Once a generation run has started (generating → picking →
                    chatting), drop empty slots from the grid so the model row
                    column-aligns with the results grid below. While still in
                    setup we render all 4 slots so the user can fill them. */}
                {(() => {
                  const isRunning = phase === 'generating' || phase === 'picking' || phase === 'chatting'
                  const slotsToShow = isRunning ? [0, 1, 2, 3].filter(i => selectedModels[i]) : [0, 1, 2, 3]
                  const columnCount = slotsToShow.length
                  return (
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columnCount}, 1fr)`, gap: 10, marginBottom: 20, alignItems: 'start' }}>
                  {slotsToShow.map(i => {
                    const model = selectedModels[i]
                    const color = SLOT_COLORS[i]
                    const opts = slotOptions[i]

                    if (!model) return (
                      <button key={i} onClick={() => !isLocked && setPickerSlot(i)}
                        disabled={isLocked}
                        style={{ background: '#ffffff', border: '1px dashed var(--border2)', borderRadius: 10, padding: '0 14px', height: 56, boxSizing: 'border-box', color: 'var(--muted)', fontSize: 12, cursor: !isLocked ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'all 0.2s', opacity: isLocked ? 0.4 : 1 }}
                        onMouseEnter={e => { if (!isLocked) { const el = e.currentTarget as HTMLElement; el.style.borderColor = color; el.style.color = color } }}
                        onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'var(--border2)'; el.style.color = 'var(--muted)' }}
                      >
                        <span style={{ fontSize: 18 }}>+</span> Model {LABELS[i]}
                      </button>
                    )

                    // Determine which options this model has
                    const imgQualities = mode === 'image' ? (model.output_config?.image?.qualities ?? []) : []
                    const imgSizes     = mode === 'image' ? (model.output_config?.image?.sizes ?? []) : []
                    const imgArs       = mode === 'image' ? (model.output_config?.image?.aspect_ratios ?? []) : []
                    const vidSizes     = mode === 'video' ? (model.output_config?.video?.sizes ?? []) : []
                    const vidArs       = mode === 'video' ? (model.output_config?.video?.aspect_ratios ?? []) : []
                    // Durations now live in `durations_by_resolution`, keyed by resolutions like
                    // '720p' / '1080p'. Pick the bucket matching the currently-selected size; if
                    // the user hasn't picked one yet, fall back to the union so the picker still
                    // renders something.
                    const vidDbr = mode === 'video' ? (model.output_config?.video?.durations_by_resolution ?? {}) : {}
                    const vidResKey = opts?.size ? inferResolutionKey(opts.size, Object.keys(vidDbr)) : null
                    let vidDurations = mode === 'video'
                      ? (vidResKey && vidDbr[vidResKey] ? expandDurations(vidDbr[vidResKey]) : Array.from(new Set(Object.values(vidDbr).flatMap(expandDurations))).sort((a, b) => a - b))
                      : []
                    // Veo 3.1's start+end frame interpolation only accepts
                    // durationSeconds=8 — any other value returns a generic
                    // 400 "use case not supported". Lock the duration picker
                    // to 8s in that combo so the user can't pick something
                    // the API will reject. Other providers / modes unaffected.
                    if (
                      mode === 'video' &&
                      opts?.mode === 'start_end_frames' &&
                      model.provider === 'google'
                    ) {
                      vidDurations = vidDurations.includes(8) ? [8] : vidDurations
                    }
                    const availableModes = (model.modes ?? []).filter(x => modeMatchesMode(x, mode))
                    // Watermark is Alibaba-only — applies to both video (HappyHorse, Wan)
                    // and image (Qwen Image). Hidden for OpenAI / Google / Anthropic.
                    const showWatermark = (mode === 'video' || mode === 'image') && model.provider === 'alibaba'
                    // Image count slider — hidden for now. Qwen Image's batch-n
                    // produces near-identical images and the workaround
                    // (parallel n=1 with seeds) costs the same. Keep schema
                    // (`output_config.image.max_count`) but force count=1 in UI.
                    const imgMaxCount = mode === 'image' ? (model.output_config?.image?.max_count ?? 1) : 1
                    void imgMaxCount  // eslint: keep ref so the catalog field remains discoverable
                    const showCount = false
                    // Per-slot options are interactive only during setup.
                    // Once a run starts they're frozen (no point in changing
                    // a knob after generation is already done) — Start Over
                    // is the only way back. Still rendered when locked so
                    // the user can see what config was used; pointer-events
                    // off + reduced opacity make the "locked" state clear.
                    const hasOptions = !isLocked && opts && (
                      availableModes.length > 1 ||
                      imgQualities.length > 0 || imgSizes.length > 0 || imgArs.length > 0 ||
                      vidSizes.length > 0 || vidDurations.length > 0 || vidArs.length > 0 ||
                      showWatermark || showCount
                    )

                    // Upfront USD estimate for this slot given its current
                    // options + the live prompt length. Recomputed every render.
                    const estDollars = estimateSlotDollars(model, mode, opts, prompt.length)

                    return (
                      <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {/* Model card — name + remove only. Cost estimate lives
                            in the summary row right above the prompt box, not
                            here, so the grid stays clean. */}
                        <div style={{ background: '#ffffff', border: `1px solid ${color}44`, borderRadius: 10, padding: '0 14px', height: 56, display: 'flex', alignItems: 'center', gap: 10, boxSizing: 'border-box' }}>
                          {/* Split a name like "GPT-5.4 (free)" into a bold
                              main line and a smaller muted sub-line for the
                              parenthetical variant. The sub-line may truncate
                              since the card is fixed-width. */}
                          {(() => {
                            const match = model.display_name.match(/^(.*?)\s*(\([^)]*\))\s*$/)
                            const main = (match?.[1] ?? model.display_name).trim()
                            const sub = match?.[2]?.trim()
                            return (
                              <div style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
                                <div style={{ fontSize: 13, color: 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 600 }}>
                                  {main}
                                </div>
                                {sub && (
                                  <div style={{ fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 1 }}>
                                    {sub}
                                  </div>
                                )}
                              </div>
                            )
                          })()}
                          {!isLocked && <button onClick={() => removeModel(i)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 0, flexShrink: 0 }}>×</button>}
                        </div>

                        {/* Options panel directly below this model's card.
                            Order: Mode → Resolution/Size → Duration → Aspect Ratio → Quality. */}
                        {hasOptions && opts && (() => {
                          // Helper to keep all option pills consistent.
                          const Pill = ({ active, onClick, children, narrow }: {
                            active: boolean; onClick: () => void; children: React.ReactNode; narrow?: boolean
                          }) => (
                            <button onClick={onClick}
                              style={{
                                flex: 1, padding: narrow ? '6px 4px' : '7px 6px',
                                borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                                background: active ? color + '22' : 'transparent',
                                border: `1px solid ${active ? color + '66' : 'var(--border2)'}`,
                                color: active ? color : 'var(--muted)',
                                transition: 'all 0.15s', textAlign: 'center' as const,
                              }}>
                              {children}
                            </button>
                          )
                          const Group = ({ label, children, last }: {
                            label: string; children: React.ReactNode; last?: boolean
                          }) => (
                            <div style={{ marginBottom: last ? 0 : 8 }}>
                              <div style={{ fontSize: 11, color: 'var(--muted2)', marginBottom: 6, fontWeight: 600 }}>{label}</div>
                              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' as const }}>{children}</div>
                            </div>
                          )

                          // Decide which groups are visible so we can pass `last` to drop the bottom margin.
                          const showMode  = availableModes.length > 1
                          // When the slot's mode takes a non-text input (image_to_video,
                          // image_to_image, video_to_video, reference_frames, start_end_frames),
                          // the output's aspect ratio is inherited from the input file. Showing
                          // an aspect-ratio picker in that case is misleading — the model will
                          // ignore it. We only show the picker for text_to_* modes where the
                          // user actually needs to pick.
                          const isTextOnlyInput = !opts?.mode || opts.mode.startsWith('text_to_')
                          const showSizeI = mode === 'image' && imgSizes.length > 0
                          const showSizeV = mode === 'video' && vidSizes.length > 0
                          const showDur   = mode === 'video' && vidDurations.length > 0
                          const showArI   = mode === 'image' && imgArs.length > 0 && isTextOnlyInput
                          const showArV   = mode === 'video' && vidArs.length > 0 && isTextOnlyInput
                          const showQual  = mode === 'image' && imgQualities.length > 1
                          const groupsInOrder: Array<'mode' | 'size_i' | 'size_v' | 'dur' | 'ar_i' | 'ar_v' | 'qual' | 'count' | 'wm'> = []
                          if (showMode)      groupsInOrder.push('mode')
                          if (showSizeV)     groupsInOrder.push('size_v')
                          if (showDur)       groupsInOrder.push('dur')
                          if (showArV)       groupsInOrder.push('ar_v')
                          if (showSizeI)     groupsInOrder.push('size_i')
                          if (showArI)       groupsInOrder.push('ar_i')
                          if (showQual)      groupsInOrder.push('qual')
                          if (showCount)     groupsInOrder.push('count')
                          if (showWatermark) groupsInOrder.push('wm')
                          const lastIdx = groupsInOrder.length - 1
                          const isLast = (k: typeof groupsInOrder[number]) => groupsInOrder.indexOf(k) === lastIdx

                          return (
                            <div style={{ background: '#ffffff', border: `1px solid ${color}22`, borderRadius: 10, padding: '10px 12px' }}>
                              {/* Mode (top of config) */}
                              {showMode && (
                                <Group label="Mode" last={isLast('mode')}>
                                  {availableModes.map(mp => (
                                    <Pill key={mp} active={opts.mode === mp} onClick={() => updateSlotOpts(i, { mode: mp })}>
                                      {modeLabel(mp)}
                                    </Pill>
                                  ))}
                                </Group>
                              )}
                              {/* Video: Resolution */}
                              {showSizeV && (
                                <Group label="Resolution" last={isLast('size_v')}>
                                  {vidSizes.map(s => {
                                    const shortLabel = s.includes('x') ? s.split('x')[1] + 'p' : s
                                    return (
                                      <Pill key={s} active={opts.size === s} onClick={() => updateSlotOpts(i, { size: s })}>
                                        {shortLabel}
                                      </Pill>
                                    )
                                  })}
                                </Group>
                              )}
                              {/* Video: Duration */}
                              {showDur && (
                                <Group label="Duration" last={isLast('dur')}>
                                  {(() => {
                                    // Slider rendering when the model declared
                                    // any range. Priority:
                                    //   1. The exact spec for the inferred
                                    //      resolution (when one matches).
                                    //   2. The first range entry across all
                                    //      resolutions (so the slider still
                                    //      shows when no size is selected yet
                                    //      or the inference missed).
                                    // Falls back to the discrete pill row when
                                    // every entry is a fixed list.
                                    const inferredSpec = vidResKey ? vidDbr[vidResKey] : null
                                    const fallbackRangeEntry = Object.entries(vidDbr).find(([, v]) => v && !Array.isArray(v))
                                    const r: { min: number; max: number } | null =
                                      inferredSpec && !Array.isArray(inferredSpec) ? inferredSpec
                                      : fallbackRangeEntry ? fallbackRangeEntry[1] as { min: number; max: number }
                                      : null
                                    if (r) {
                                      const cur = opts.duration ?? r.min
                                      return (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 28 }}>
                                          <input
                                            type="range"
                                            className="xc-slider"
                                            min={r.min} max={r.max} step={1}
                                            value={cur}
                                            onChange={e => updateSlotOpts(i, { duration: parseInt(e.target.value, 10) })}
                                            style={{ flex: 1, ['--xc-slider-color' as any]: color }}
                                          />
                                          <input
                                            type="number"
                                            min={r.min} max={r.max} step={1}
                                            value={cur}
                                            onChange={e => {
                                              const v = parseInt(e.target.value, 10)
                                              if (!Number.isFinite(v)) return
                                              const clamped = Math.max(r.min, Math.min(r.max, v))
                                              updateSlotOpts(i, { duration: clamped })
                                            }}
                                            style={{
                                              width: 56, padding: '4px 6px',
                                              borderRadius: 6, fontSize: 12, fontWeight: 700,
                                              background: '#ffffff',
                                              border: `1px solid ${color}55`,
                                              color: 'var(--white)',
                                              fontFamily: 'var(--mono)',
                                              textAlign: 'center' as const,
                                            }}
                                          />
                                          <span style={{ fontSize: 11, color: 'var(--muted2)', fontFamily: 'var(--mono)', whiteSpace: 'nowrap' as const }}>
                                            s · {r.min}–{r.max}
                                          </span>
                                        </div>
                                      )
                                    }
                                    return vidDurations.map(d => (
                                      <Pill key={d} active={opts.duration === d} onClick={() => updateSlotOpts(i, { duration: d })}>
                                        {d}s
                                      </Pill>
                                    ))
                                  })()}
                                </Group>
                              )}
                              {/* Video: Aspect Ratio */}
                              {showArV && (
                                <Group label="Aspect ratio" last={isLast('ar_v')}>
                                  {vidArs.map(ar => (
                                    <Pill key={ar} active={opts.aspect_ratio === ar} onClick={() => updateSlotOpts(i, { aspect_ratio: ar })}>
                                      {ar}
                                    </Pill>
                                  ))}
                                </Group>
                              )}
                              {/* Image: Size */}
                              {showSizeI && (
                                <Group label="Size" last={isLast('size_i')}>
                                  {imgSizes.map(s => {
                                    const isSquare = s.includes('x') && s.split('x')[0] === s.split('x')[1]
                                    const isLandscape = s.includes('x') && parseInt(s.split('x')[0]) > parseInt(s.split('x')[1])
                                    const label = isSquare ? '1:1' : isLandscape ? '▬' : '▮'
                                    return (
                                      <Pill key={s} active={opts.size === s} onClick={() => updateSlotOpts(i, { size: s })}>
                                        <div style={{ fontSize: 13 }}>{label}</div>
                                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, fontFamily: 'var(--mono)' }}>{s}</div>
                                      </Pill>
                                    )
                                  })}
                                </Group>
                              )}
                              {/* Image: Aspect Ratio */}
                              {showArI && (
                                <Group label="Aspect ratio" last={isLast('ar_i')}>
                                  {imgArs.map(ar => (
                                    <Pill key={ar} active={opts.aspect_ratio === ar} onClick={() => updateSlotOpts(i, { aspect_ratio: ar })}>
                                      {ar}
                                    </Pill>
                                  ))}
                                </Group>
                              )}
                              {/* Image: Quality */}
                              {showQual && (
                                <Group label="Quality" last={isLast('qual')}>
                                  {imgQualities.map(q => (
                                    <Pill key={q} active={opts.quality === q} onClick={() => updateSlotOpts(i, { quality: q })}>
                                      {q.charAt(0).toUpperCase() + q.slice(1)}
                                    </Pill>
                                  ))}
                                </Group>
                              )}
                              {/* Image: Count slider (only for models with max_count > 1) */}
                              {showCount && (
                                <Group label={`Count (${opts.count ?? 1} of ${imgMaxCount})`} last={isLast('count')}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 28 }}>
                                    <input
                                      type="range"
                                      className="xc-slider"
                                      min={1} max={imgMaxCount} step={1}
                                      value={opts.count ?? 1}
                                      onChange={e => updateSlotOpts(i, { count: parseInt(e.target.value, 10) })}
                                      style={{ flex: 1, ['--xc-slider-color' as any]: color }}
                                    />
                                    <input
                                      type="number"
                                      min={1} max={imgMaxCount} step={1}
                                      value={opts.count ?? 1}
                                      onChange={e => {
                                        const v = parseInt(e.target.value, 10)
                                        if (!Number.isFinite(v)) return
                                        const clamped = Math.max(1, Math.min(imgMaxCount, v))
                                        updateSlotOpts(i, { count: clamped })
                                      }}
                                      style={{
                                        width: 56, padding: '4px 6px',
                                        borderRadius: 6, fontSize: 12, fontWeight: 700,
                                        background: '#ffffff',
                                        border: `1px solid ${color}55`,
                                        color: 'var(--white)',
                                        fontFamily: 'var(--mono)',
                                        textAlign: 'center' as const,
                                      }}
                                    />
                                  </div>
                                </Group>
                              )}
                              {/* Video: Watermark (Alibaba only). Two-state On/Off, defaults Off. */}
                              {showWatermark && (
                                <Group label="Watermark" last={isLast('wm')}>
                                  <Pill active={opts.watermark === true}  onClick={() => updateSlotOpts(i, { watermark: true  })}>On</Pill>
                                  <Pill active={opts.watermark !== true}  onClick={() => updateSlotOpts(i, { watermark: false })}>Off</Pill>
                                </Group>
                              )}
                            </div>
                          )
                        })()}
                      </div>
                    )
                  })}
                </div>
                  )
                })()}

                {/* Per-slot cost estimate row — aligned to the 4-column model
                    slot grid above so each estimate sits directly under its
                    model card. The total sits on the far right. Hidden while
                    generating to reduce noise. */}
                {activeModels.length > 0 && phase !== 'generating' && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14, alignItems: 'center' }}>
                    {[0, 1, 2, 3].map(i => {
                      const m = selectedModels[i]
                      if (!m) return <div key={i} />
                      const d = estimateSlotDollars(m, mode, slotOptions[i], prompt.length)
                      const color = SLOT_COLORS[i]
                      return (
                        <div key={i} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '0 4px', gap: 6 }}>
                          <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Est. cost</span>
                          <span
                            title={mode === 'text' ? 'Assumes ~500-token response' : 'Based on your selected options'}
                            style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--mono)', color }}
                          >
                            {d != null ? `~${fmtDollars(d)}` : '—'}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Prompt */}
                <div className="prompt-box" style={{ opacity: isLocked ? 0.55 : 1 }}>
                  <textarea className="prompt-textarea"
                    placeholder={mode === 'image' ? "Describe an image…" : mode === 'video' ? "Describe a video…" : "Ask anything…"}
                    value={prompt} onChange={e => setPrompt(e.target.value)}
                    // Locked once a run starts. The user can still see what
                    // prompt was used, but can't edit it until Start Over.
                    disabled={isLocked}
                    readOnly={isLocked}
                    onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (canGenerate) generate() } }}
                  />
                  {(() => {
                    // Filter the file picker by what the selected slot modes
                    // actually need. If every active slot is on an image-only
                    // mode (image_to_video, image_edit, start_end_frames, etc.)
                    // we hand the input an `image/*` accept string so the OS
                    // dialog only shows images. Same for video-only modes.
                    // Mixed selection = full accept (default).
                    const IMAGE_MODES = ['image_to_text', 'image_edit', 'image_to_video', 'start_end_frames', 'reference_frames']
                    const VIDEO_MODES = ['video_to_video', 'video_to_text']
                    const AUDIO_MODES = ['audio_to_text']
                    const PDF_MODES   = ['pdf_to_text']
                    const activeOpts = slotOptions.filter((o, i) => o && selectedModels[i])
                    const allImage = activeOpts.length > 0 && activeOpts.every(o => o!.mode != null && IMAGE_MODES.includes(o!.mode))
                    const allVideo = activeOpts.length > 0 && activeOpts.every(o => o!.mode != null && VIDEO_MODES.includes(o!.mode))
                    const allAudio = activeOpts.length > 0 && activeOpts.every(o => o!.mode != null && AUDIO_MODES.includes(o!.mode))
                    const allPdf   = activeOpts.length > 0 && activeOpts.every(o => o!.mode != null && PDF_MODES.includes(o!.mode))
                    const attachAccept = allImage ? 'image/jpeg,image/png,image/gif,image/webp'
                                       : allVideo ? 'video/mp4,video/quicktime,video/webm'
                                       : allAudio ? 'audio/mpeg,audio/mp4,audio/wav,audio/webm,audio/ogg'
                                       : allPdf   ? 'application/pdf'
                                       : undefined
                    return (
                  <div className="prompt-actions">
                    {/* Attachments only render outside text mode. In
                        text mode the run is text-in → text-out, so an
                        attachment would be silently ignored by most
                        selected models. Image / video modes still allow
                        attachments per the slot's input shape. */}
                    {mode !== 'text' && (
                      <AttachmentButton attachments={attachments} onChange={setAttachments} disabled={isLocked} context="xcreate" multiple={true} accept={attachAccept} />
                    )}
                    <span className="prompt-counter">{activeModels.length === 0 ? 'Pick at least one model' : `${activeModels.length} model${activeModels.length > 1 ? 's' : ''} selected`}</span>
                    {totalEstDollars != null && phase !== 'generating' && (
                      <span
                        title={mode === 'text' ? 'Estimated total — assumes ~500-token response per model' : 'Estimated total based on your selected options'}
                        style={{
                          fontSize: 13, fontWeight: 700, fontFamily: 'var(--mono)',
                          color: 'var(--muted2)', whiteSpace: 'nowrap' as const,
                        }}
                      >
                        Total ~{fmtDollars(totalEstDollars)}
                      </span>
                    )}
                    {/* Setup phase: real Generate button.
                        Generating phase: disabled "⏳ Generating…" indicator
                          so the user knows the request is in flight.
                        Picking / chatting phase: nothing — Start Over is
                          the only path back to a new generation. */}
                    {phase === 'setup' && (
                      <button className="btn-battle" onClick={generate} disabled={!canGenerate}>
                        ✦ Generate →
                      </button>
                    )}
                    {phase === 'generating' && (
                      <button className="btn-battle" disabled style={{ opacity: 0.7 }}>
                        ⏳ Generating…
                      </button>
                    )}
                  </div>
                    )
                  })()}
                </div>

                {/* Results */}
                {slots.length > 0 && (
                  <div style={{ marginTop: 24 }}>
                    {phase === 'picking' && (
                      <div style={{ textAlign: 'center', marginBottom: 20 }}>
                        <div style={{ fontSize: 13, color: 'var(--red)', fontWeight: 700, marginBottom: 4 }}>Which model do you want to continue with?</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>Pick one — the others will be dismissed</div>
                      </div>
                    )}
                    {/* 4 results → 2×2 grid (readable), otherwise single row.
                        Column count matters more than matching the setup row
                        because the cards are content-heavy. Use a 1px gap
                        with the arena border-color showing through instead
                        of the shared `.battle-card:first-child` right-border
                        rule — that rule only produces the correct divider
                        for 1×2 layouts, not 2×2. */}
                    <div className="battle-arena" style={{ gridTemplateColumns: slots.length === 4 ? '1fr 1fr' : `repeat(${slots.length}, 1fr)`, gap: 1, background: 'var(--border2)' }}>
                      {slots.map((slot, i) => {
                        const model = activeModels[i]
                        const color = SLOT_COLORS[i]
                        if (!model) return null
                        return (
                          <div key={i} className="battle-card"
                            style={{ position: 'relative' }}
                            onMouseEnter={() => setCursor(color)}
                            onMouseLeave={() => setCursor('#e8453c')}
                          >
                            {/* Provider identity stripe — 3px ribbon at the
                                top of the card. Lets you read the provider
                                of every result at a glance without parsing
                                the model name. */}
                            <span className={`provider-stripe ${model.provider}`} aria-hidden="true" />
                            <div className={`battle-card-header ${mode !== 'text' ? 'image-mode' : ''}`}>
                              <div className="battle-model-id" style={{ color, fontSize: 12, display: 'flex', alignItems: 'center' }}>
                                {!slot.done && slot.streaming && (
                                  <span className={`streaming-dot ${model.provider}`} aria-hidden="true" />
                                )}
                                {stripModelVariant(model.display_name)}
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                {slot.done && <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted2)' }}>⏱ {(slot.responseTime / 1000).toFixed(2)}s</span>}
                                {slot.done && slot.cost > 0 && <span className="price-badge" style={{ color }}>{fmtDollars(slot.cost)}</span>}
                              </div>
                            </div>
                            {/* Config summary line — shows the exact options
                                used for this slot so you remember what you
                                generated against. Each field is only included
                                when the model actually exposes that choice
                                (e.g. quality tiers > 1, multiple sizes, etc.),
                                matching the form's picker visibility. */}
                            {(() => {
                              const used = slotOptions[i]
                              if (!used) return null
                              const oc = model.output_config ?? {}
                              const sizes = mode === 'video' ? (oc.video?.sizes ?? []) : mode === 'image' ? (oc.image?.sizes ?? []) : []
                              const ars   = mode === 'video' ? (oc.video?.aspect_ratios ?? []) : mode === 'image' ? (oc.image?.aspect_ratios ?? []) : []
                              const dbr   = mode === 'video' ? (oc.video?.durations_by_resolution ?? {}) : {}
                              const allDurations = Array.from(new Set(Object.values(dbr).flat()))
                              const qualities = mode === 'image' ? (model.output_config?.image?.qualities ?? []) : []
                              const compatibleModes = (model.modes ?? []).filter(x => modeMatchesMode(x, mode))

                              const parts: string[] = []
                              if (used.mode         && compatibleModes.length > 1)         parts.push(modeLabel(used.mode))
                              if (used.size         && sizes.length          > 0)          parts.push(used.size)
                              if (used.duration     && allDurations.length   > 0)          parts.push(`${used.duration}s`)
                              if (used.aspect_ratio && ars.length            > 0)          parts.push(used.aspect_ratio)
                              if (used.quality      && qualities.length      > 1)          parts.push(`${used.quality} quality`)
                              if (mode === 'image' && (model.output_config?.image?.max_count ?? 1) > 1 && (used.count ?? 1) > 0) {
                                parts.push(`${used.count ?? 1} image${(used.count ?? 1) > 1 ? 's' : ''}`)
                              }
                              // Watermark only applies to Alibaba image/video models —
                              // never to text. Skip the line for any other case.
                              const summaryShowsWatermark = (mode === 'video' || mode === 'image') && model.provider === 'alibaba'
                              if (summaryShowsWatermark && used.watermark === true)  parts.push('watermark on')
                              if (summaryShowsWatermark && used.watermark === false) parts.push('watermark off')
                              if (parts.length === 0) return null
                              return (
                                <div style={{
                                  padding: '4px 12px 8px',
                                  fontSize: 11,
                                  fontFamily: 'var(--font-mono), monospace',
                                  color: 'var(--muted2)',
                                  letterSpacing: '0.04em',
                                  display: 'flex', flexWrap: 'wrap', gap: '0 8px',
                                  borderBottom: '1px solid var(--border)',
                                }}>
                                  {parts.join('  ·  ')}
                                </div>
                              )
                            })()}
                            <div className={`battle-response ${mode !== 'text' ? 'image-response' : ''} ${slot.streaming && !slot.text ? 'loading' : ''}`}>
                              {slot.streaming && !slot.text
                                ? <><div className="loading-dot" /><div className="loading-dot" /><div className="loading-dot" /></>
                                : slot.error ? <div style={{ padding: 16, color: 'var(--red)', fontSize: 13 }}>⚠️ {slot.error}</div>
                                : slot.isVideo ? <video src={slot.text} autoPlay loop muted playsInline controls style={{ width: '100%', display: 'block' }} />
                                : slot.isImage ? (() => {
                                    // Multi-image slots store URLs newline-delimited
                                    // in `slot.text`. Single image still renders flush;
                                    // multi-image renders as a 2-col grid.
                                    const urls = (slot.text ?? '').split('\n').filter(Boolean)
                                    if (urls.length <= 1) {
                                      const u = urls[0] ?? ''
                                      return <img src={u} alt="Generated" onClick={() => setLightbox(u)} style={{ display: 'block', cursor: 'zoom-in' }} />
                                    }
                                    const cols = urls.length === 2 ? 2 : urls.length === 3 ? 3 : 2
                                    return (
                                      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 2, background: 'var(--border)' }}>
                                        {urls.map((u, ui) => (
                                          <img key={ui} src={u} alt={`Generated ${ui + 1}`}
                                            onClick={() => setLightbox(u)}
                                            style={{ width: '100%', height: 'auto', display: 'block', cursor: 'zoom-in', background: 'var(--surface)' }} />
                                        ))}
                                      </div>
                                    )
                                  })()
                                : <><div className="markdown-body"><ReactMarkdown skipHtml components={{a: ({href, children}) => { if (!href || (!href.startsWith('http://') && !href.startsWith('https://'))) return <span>{children}</span>; return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}}>{slot.text}</ReactMarkdown></div>{slot.streaming && <span className="stream-cursor">▋</span>}</>
                              }
                            </div>
                            {/* Pick button */}
                            {phase === 'picking' && slot.done && !slot.error && (
                              <div style={{ padding: 12, borderTop: '1px solid var(--border)' }}>
                                <button onClick={() => pickModel(i)} style={{
                                  width: '100%', padding: '10px 0', borderRadius: 8,
                                  background: 'transparent', border: `1px solid ${color}`,
                                  color, fontWeight: 700, fontSize: 13, cursor: 'pointer',
                                  transition: 'all 0.15s',
                                }}
                                  onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = color + '18' }}
                                  onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = 'transparent' }}
                                >
                                  {mode === 'image' || mode === 'video' ? `Generate more with ${stripModelVariant(model.display_name)} →` : `Select ${stripModelVariant(model.display_name)} →`}
                                </button>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                    {(phase === 'picking' || phase === 'chatting') && (() => {
                      const totalActual = slots.reduce((sum, s) => sum + (s.done && s.cost > 0 ? s.cost : 0), 0)
                      return (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 32 }}>
                          <button className="btn-secondary" onClick={reset}>← Start Over</button>
                          {totalActual > 0 && (
                            <span style={{
                              fontSize: 13, fontWeight: 700, fontFamily: 'var(--mono)',
                              color: 'var(--muted2)', whiteSpace: 'nowrap' as const,
                            }}>
                              Total {fmtDollars(totalActual)}
                            </span>
                          )}
                        </div>
                      )
                    })()}
                  </div>
                )}
              </>
            )}
        </div>
      </div>
    </>
  )
}
