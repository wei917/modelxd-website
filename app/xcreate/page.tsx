'use client'
// app/xcreate/page.tsx
// Private AI studio:
// 1. Pick up to 4 models + prompt → generate side by side
// 2. Pick one to continue → this is the vote, others dismissed
// 3. Multi-turn chat with chosen model

import { useEffect, useRef, useState } from 'react'
import { useRequireAuth } from '../../lib/useRequireAuth'
import { createBrowserClient } from '@supabase/ssr'
const createSupabaseBrowser = () => createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)
import ReactMarkdown from 'react-markdown'
import AttachmentButton, { type Attachment } from '../components/AttachmentButton'

type Mode = 'text' | 'image' | 'video'
type Phase = 'setup' | 'generating' | 'picking' | 'chatting'

interface DBModel {
  id: string          // uuid
  provider: string
  model_name: string
  name: string
  modes: string[]
  tags: string[]
  is_flagship: boolean | null
  released_at: string | null   // ISO timestamp — populated from OpenRouter `created`
  // Pricing — used for upfront cost estimation. All USD.
  input_price: number | null          // per 1M input tokens
  cached_input_price: number | null   // per 1M cached input tokens
  output_price: number | null         // per 1M output tokens
  image_pricing: Record<string, number> | null
  video_pricing: Record<string, number> | null
  image_sizes: string[] | null
  video_sizes: string[] | null
  video_durations: number[] | null
}

interface SlotModel {
  id: string          // uuid
  provider: string
  model_name: string
  name: string
  // Pricing — USD, used for upfront cost estimation.
  input_price: number | null          // per 1M input tokens
  cached_input_price: number | null   // per 1M cached input tokens
  output_price: number | null         // per 1M output tokens
  image_pricing: Record<string, number> | null
  video_pricing: Record<string, number> | null
  image_sizes: string[] | null
  video_sizes: string[] | null
  video_durations: number[] | null
}

interface SlotOptions {
  quality: string | null    // 'low' | 'medium' | 'high' for image
  size: string | null       // e.g. '1024x1024' for image, '1280x720' for video
  duration: number | null   // seconds for video
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

function estimateSlotDollars(
  model: SlotModel,
  m: Mode,
  opts: SlotOptions | null,
  promptLen: number,
): number | null {
  if (m === 'text') {
    if (model.input_price == null && model.output_price == null) return null
    const inTokens  = Math.max(1, Math.ceil(promptLen / 4))
    const outTokens = 500
    return (inTokens * (model.input_price ?? 0) + outTokens * (model.output_price ?? 0)) / 1_000_000
  }
  if (m === 'image') {
    const q = opts?.quality ?? null
    const price = q && model.image_pricing?.[q] != null ? model.image_pricing[q] : null
    return price ?? null
  }
  if (m === 'video') {
    const size = opts?.size ?? null
    const key  = size ? resolutionKeyForSize(size) : null
    const vp = model.video_pricing
    let perSecond: number | null = null
    if (key && vp?.[key] != null)                                 perSecond = vp[key]
    else if (vp?.['720p'] != null)                                perSecond = vp['720p']
    else if (vp && Object.values(vp).length > 0)                  perSecond = Object.values(vp)[0] as number
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
// Model names from OpenRouter look like "company/model-id". We split on the
// first slash to get a company id — used both for the chip row and for
// filtering. Falls back to "other" for anything unexpected.
function companyOf(m: DBModel): string {
  const [company] = (m.model_name ?? '').split('/')
  return company || 'other'
}

// Human-friendly display name for a company id. Anything not in this map
// gets titlecased on the fly.
const COMPANY_LABELS: Record<string, string> = {
  openai:              'OpenAI',
  anthropic:           'Anthropic',
  google:              'Google',
  'meta-llama':        'Meta',
  deepseek:            'DeepSeek',
  'x-ai':              'xAI',
  mistralai:           'Mistral',
  qwen:                'Qwen',
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
  // "Popular only" defaults ON — the whole point of this picker redesign is
  // that dumping 300+ models on the user is overwhelming. Users can flip it
  // off to see everything.
  const [popularOnly, setPopularOnly] = useState(true)
  // null = "All" (no company filter active).
  const [company,     setCompany]     = useState<string | null>(null)

  useEffect(() => {
    // Order by release date, newest first. Rows with a null released_at
    // (currently video models — OpenRouter's video endpoint doesn't return
    // a created timestamp) fall to the bottom, then tie-break by name.
    createSupabaseBrowser()
      .from('ai_models')
      .select('*')
      .eq('enabled', true)
      .contains('output_modalities', [mode])
      .order('released_at', { ascending: false, nullsFirst: false })
      .order('name', { ascending: true })
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

  // Apply filters in order: flagship → company → text search. Flagship first
  // because it's the coarsest cut and keeps downstream work cheap.
  const q = search.trim().toLowerCase()
  const filtered = models.filter(m => {
    if (popularOnly && !m.is_flagship) return false
    if (company && companyOf(m) !== company) return false
    if (q) {
      return (
        m.name.toLowerCase().includes(q) ||
        m.model_name.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q)
      )
    }
    return true
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

          {/* Popular / all toggle. When ON we restrict to is_flagship rows. */}
          <button
            onClick={() => setPopularOnly(v => !v)}
            style={{
              padding: '4px 11px',
              borderRadius: 12,
              fontSize: 11,
              fontWeight: 700,
              textTransform: 'uppercase' as const,
              letterSpacing: '0.5px',
              cursor: 'pointer',
              border: `1px solid ${popularOnly ? '#f59e0b66' : 'var(--border2)'}`,
              background: popularOnly ? '#f59e0b22' : 'transparent',
              color:      popularOnly ? '#f59e0b'   : 'var(--muted)',
              fontFamily: 'inherit',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
            title={popularOnly ? 'Showing flagship models only — click to show all' : 'Showing all models — click to show flagships only'}
          >
            <span>★</span>
            <span>Popular</span>
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
              {(popularOnly || company) && (
                <button
                  onClick={() => { setPopularOnly(false); setCompany(null) }}
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
            const already = selectedIds.includes(m.id)
            return (
              <div key={m.id}
                onClick={() => !already && onSelect({ id: m.id, provider: m.provider, model_name: m.model_name, name: m.name, input_price: m.input_price, cached_input_price: m.cached_input_price, output_price: m.output_price, image_pricing: m.image_pricing, video_pricing: m.video_pricing, image_sizes: m.image_sizes, video_sizes: m.video_sizes, video_durations: m.video_durations })}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--border)', cursor: already ? 'default' : 'pointer', opacity: already ? 0.4 : 1 }}
                onMouseEnter={e => { if (!already) (e.currentTarget as HTMLElement).style.background = 'var(--surface2)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: already ? 'var(--muted)' : 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {m.name}
                  </div>
                  {/* Internal id (company/model) — useful to disambiguate
                      variants like gpt-5 vs gpt-5-mini in the picker. The
                      "openrouter ·" prefix was dropped since every model
                      routes through openrouter. */}
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
                {already && <span style={{ fontSize: 11, color: 'var(--muted)' }}>Added</span>}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Gallery ───────────────────────────────────────────────────────────────────
function Gallery({ userId }: { userId: string }) {
  const [items,    setItems]    = useState<GalleryItem[]>([])
  const [loading,  setLoading]  = useState(true)
  const [lightbox, setLightbox] = useState<string | null>(null)

  useEffect(() => {
    createSupabaseBrowser().from('xcreates').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(40)
      .then(({ data }) => { setItems(data ?? []); setLoading(false) })
  }, [userId])

  if (loading) return <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 40 }}>Loading gallery…</div>
  if (items.length === 0) return <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 60, fontSize: 13 }}>Your creations will appear here.</div>

  return (
    <>
      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{position:'fixed',inset:0,zIndex:99999,background:'rgba(0,0,0,0.92)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer'}}>
          <img src={lightbox} alt="Full size" onClick={() => setLightbox(null)} style={{maxWidth:'90vw',maxHeight:'90vh',borderRadius:8,boxShadow:'0 0 80px rgba(0,0,0,0.8)',cursor:'pointer'}} />
          <div onClick={e => e.stopPropagation()} style={{position:'fixed',top:20,right:24,zIndex:100000,display:'flex',gap:10}}>
            <a href={lightbox} download target="_blank" rel="noreferrer" title="Download"
              style={{display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(255,255,255,0.15)',border:'1px solid rgba(255,255,255,0.3)',borderRadius:8,width:36,height:36,color:'#fff',fontSize:16,textDecoration:'none',cursor:'pointer',boxShadow:'0 2px 12px rgba(0,0,0,0.4)'}}
            >↓</a>
            <button onClick={() => setLightbox(null)} title="Close"
              style={{display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(255,255,255,0.15)',border:'1px solid rgba(255,255,255,0.3)',borderRadius:8,width:36,height:36,color:'#fff',fontSize:16,cursor:'pointer',boxShadow:'0 2px 12px rgba(0,0,0,0.4)'}}
            >✕</button>
          </div>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
        {items.map(item => {
          const slots     = (item.slots ?? []).filter(Boolean)
          const mode      = item.mode as Mode
          const modeColor = mode === 'video' ? '#34d399' : mode === 'image' ? '#a78bfa' : '#4a9eff'
          const chosen    = slots.find((s: any) => s.id === item.chosen_model_id)
          const preview   = chosen ?? slots[0]
          return (
            <div key={item.id} style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 12, overflow: 'hidden' }}>
              {preview && (
                preview.isVideo ? <video src={preview.text} muted loop playsInline style={{ width: '100%', display: 'block', maxHeight: 160, objectFit: 'cover' }} />
                : preview.isImage ? <img src={preview.text} alt="" onClick={() => setLightbox(preview.text)} style={{ width: '100%', display: 'block', maxHeight: 160, objectFit: 'cover', cursor: 'zoom-in' }} />
                : <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, maxHeight: 90, overflow: 'hidden', maskImage: 'linear-gradient(to bottom, black 50%, transparent 100%)' }}>{preview.text?.slice(0, 200)}</div>
              )}
              <div style={{ padding: '10px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, color: modeColor, background: modeColor + '18', padding: '2px 7px', borderRadius: 8, textTransform: 'uppercase' as const }}>{mode}</span>
                  {item.chosen_model_id && <span style={{ fontSize: 9, color: 'var(--green)', background: '#34d39918', padding: '2px 7px', borderRadius: 8, fontWeight: 700 }}>CHOSEN</span>}
                  <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>{new Date(item.created_at).toLocaleDateString()}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted2)', marginBottom: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.prompt}</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' as const }}>
                  {slots.map((s: any, i: number) => (
                    <span key={i} style={{
                      fontSize: 10, padding: '2px 7px', borderRadius: 6, fontFamily: 'var(--mono)',
                      maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
                      color: s.id === item.chosen_model_id ? 'var(--green)' : 'var(--muted)',
                      background: s.id === item.chosen_model_id ? 'var(--green-dim)' : 'var(--surface2)',
                      textDecoration: s.id !== item.chosen_model_id && item.chosen_model_id ? 'line-through' : 'none',
                    }}>
                      {s.model_name ?? s.name}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )
        })}
      </div>
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
  const [mode,           setMode]           = useState<Mode>('text')
  const [prompt,         setPrompt]         = useState('')
  const [selectedModels, setSelectedModels] = useState<(SlotModel | null)[]>([null, null, null, null])
  const [slots,          setSlots]          = useState<SlotState[]>([])
  const [pickerSlot,     setPickerSlot]     = useState<number | null>(null)
  const [phase,          setPhase]          = useState<Phase>('setup')
  const [tab,            setTab]            = useState<'create' | 'gallery'>('create')
  const [lightbox,       setLightbox]       = useState<string | null>(null)
  const [attachment,     setAttachment]     = useState<Attachment | null>(null)
  const [slotOptions,   setSlotOptions]    = useState<(SlotOptions | null)[]>([null, null, null, null])

  const defaultOptions = (model: SlotModel | null, m: Mode): SlotOptions => {
    if (!model) return { quality: null, size: null, duration: null }
    if (m === 'image') {
      const qualities = model.image_pricing ? Object.keys(model.image_pricing) : []
      const defaultQuality = qualities.length > 0 ? (qualities.includes('medium') ? 'medium' : qualities[0]) : null
      const sizes = model.image_sizes ?? []
      return { quality: defaultQuality, size: sizes[0] ?? null, duration: null }
    }
    if (m === 'video') {
      const sizes = model.video_sizes ?? []
      const durations = model.video_durations ?? []
      return { quality: null, size: sizes[0] ?? null, duration: durations[0] ?? null }
    }
    return { quality: null, size: null, duration: null }
  }

  // Post-pick state
  const [chosenIdx,      setChosenIdx]      = useState<number | null>(null)
  const [chatHistory,    setChatHistory]    = useState<ChatMessage[]>([])
  const [chatInput,      setChatInput]      = useState('')
  const [chatStreaming,  setChatStreaming]  = useState(false)
  const [xcreateId,       setXcreateId]       = useState<string | null>(null)

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

  useEffect(() => {
    // When resuming an in-progress job, the mode is restored from the job
    // row — don't clobber the restored state.
    if (modeClearedRef.current) { modeClearedRef.current = false; return }
    setSelectedModels([null, null, null, null]); setSlots([]); setPhase('setup')
    setChosenIdx(null); setChatHistory([]); setXcreateId(null); setAttachment(null)
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
        const { data: modelRows } = await sb.from('ai_models').select('id, provider, model_name, name, input_price, cached_input_price, output_price, image_pricing, video_pricing, image_sizes, video_sizes, video_durations').in('id', modelIds)
        const byId: Record<string, SlotModel> = {}
        ;(modelRows ?? []).forEach((m: any) => {
          byId[m.id] = {
            id: m.id, provider: m.provider, model_name: m.model_name, name: m.name,
            input_price: m.input_price, cached_input_price: m.cached_input_price, output_price: m.output_price,
            image_pricing: m.image_pricing, video_pricing: m.video_pricing,
            image_sizes: m.image_sizes, video_sizes: m.video_sizes, video_durations: m.video_durations,
          }
        })
        const restoredModels: (SlotModel | null)[] = [null, null, null, null]
        const restoredOptions: (SlotOptions | null)[] = [null, null, null, null]
        data.slots.forEach((s: any, i: number) => {
          const m = byId[s.modelId]
          if (m) restoredModels[i] = m
          const opts = s.options ?? {}
          restoredOptions[i] = {
            quality:  opts.quality ?? null,
            size:     opts.size ?? null,
            duration: opts.duration ?? null,
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
    if (!prompt.trim() || activeModels.length === 0 || phase === 'generating') return
    setPhase('generating')
    setSlots(activeModels.map(() => ({ text: '', isImage: false, isVideo: false, streaming: true, done: false, cost: 0, responseTime: 0, error: null })))
    setChosenIdx(null); setChatHistory([]); setXcreateId(null)

    // Client-generated job id so we can start polling before POST returns.
    const newJobId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`

    // Fire POST but don't await its body — it runs for the full generation
    // duration and we read progress from the polling endpoint instead.
    fetch('/api/xcreate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobId: newJobId,
        prompt, mode,
        modelIds: activeModels.map(m => m.id),
        modelOptions: activeModels.map((m) => {
          const origIdx = selectedModels.indexOf(m)
          const opts = slotOptions[origIdx]
          return opts ? { quality: opts.quality, size: opts.size, duration: opts.duration } : {}
        }),
        attachment: attachment ? { storagePath: attachment.storagePath, bucket: attachment.bucket, mediaType: attachment.mediaType, fileName: attachment.fileName, fileSize: attachment.fileSize } : null,
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

    // Save to DB with chosen model recorded
    const sb = createSupabaseBrowser()
    const { data } = await sb.from('xcreates').insert({
      user_id: userId, mode, prompt,
      chosen_model_id: chosen.id,
      slots: slots.map((s, i) => ({
        id: activeModels[i]?.id, name: activeModels[i]?.name, provider: activeModels[i]?.provider,
        model_name: activeModels[i]?.model_name,
        text: s.text, isImage: s.isImage, isVideo: s.isVideo, cost: s.cost, responseTime: s.responseTime,
        chosen: i === idx,
      })),
    }).select('id').single()
    if (data?.id) setXcreateId(data.id)
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
        body: JSON.stringify({ modelId: chosen.id, messages: newHistory, mode }),
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
  }

  const reset = () => {
    setPhase('setup'); setSlots([]); setChosenIdx(null)
    setChatHistory([]); setChatInput(''); setXcreateId(null)
    setPrompt(''); setAttachment(null); setSlotOptions([null, null, null, null])
  }

  const canGenerate = prompt.trim().length >= 3 && activeModels.length > 0 && phase !== 'generating'

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
        <div onClick={() => setLightbox(null)} style={{position:'fixed',inset:0,zIndex:99999,background:'rgba(0,0,0,0.92)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer'}}>
          <img src={lightbox} alt="Full size" onClick={() => setLightbox(null)} style={{maxWidth:'90vw',maxHeight:'90vh',borderRadius:8,boxShadow:'0 0 80px rgba(0,0,0,0.8)',cursor:'pointer'}} />
          <div onClick={e => e.stopPropagation()} style={{position:'fixed',top:20,right:24,zIndex:100000,display:'flex',gap:10}}>
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
        <div className="arena" style={{ maxWidth: 1100 }}>

          {/* Header + tabs */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--muted2)', fontFamily: 'var(--mono)', marginBottom: 6 }}>MODELXD — XCREATE</div>
              <h1 style={{ fontSize: 32, fontWeight: 800, lineHeight: 1.1, margin: 0 }}>
                Your Private <span style={{ color: 'var(--red)' }}>Studio</span>
              </h1>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['create', 'gallery'] as const).map(t => (
                <button key={t} onClick={() => setTab(t)} style={{
                  padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  background: tab === t ? 'var(--red)' : 'transparent',
                  border: `1px solid ${tab === t ? 'var(--red)' : '#222'}`,
                  color: tab === t ? '#fff' : 'var(--muted)',
                }}>{t === 'create' ? '✦ XCreate' : '⊞ Gallery'}</button>
              ))}
            </div>
          </div>

          {tab === 'gallery' ? (
            userId ? <Gallery userId={userId} /> : <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 40 }}>Sign in to view your gallery.</div>
          ) : (

            /* ── CHATTING PHASE ── */
            phase === 'chatting' && chosenIdx !== null ? (
              <div>
                {/* Chosen model header — single line: name + run cost. The
                    provider row was dropped because everything routes through
                    openrouter and the prefix was redundant. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, padding: '14px 18px', background: 'var(--surface)', border: `1px solid ${SLOT_COLORS[chosenIdx]}44`, borderRadius: 12 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--white)' }}>
                    {stripModelVariant(activeModels[chosenIdx].name)}
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
                        {m.model_name ?? m.name}
                      </span>
                    ))}
                  </div>
                )}

                {/* Chat messages */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 20, minHeight: 200 }}>
                  {chatHistory.map((msg, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                      {/* Provider avatar circle dropped — all models share
                          the same openrouter provider so the "O" badge was
                          redundant noise. */}
                      <div style={{
                        maxWidth: '72%', padding: '12px 16px', borderRadius: msg.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                        background: msg.role === 'user' ? 'var(--surface2)' : 'var(--surface)',
                        border: `1px solid var(--border2)`,
                        fontSize: 14, lineHeight: 1.7, color: msg.role === 'user' ? 'var(--muted2)' : 'var(--white)',
                      }}>
                        {msg.isVideo ? <video src={msg.content} autoPlay loop muted playsInline controls style={{ width: '100%', borderRadius: 6 }} />
                        : msg.isImage ? <img src={msg.content} alt="" onClick={() => setLightbox(msg.content)} style={{ maxWidth: '100%', borderRadius: 6, cursor: 'zoom-in' }} />
                        : <div className="markdown-body"><ReactMarkdown>{msg.content}</ReactMarkdown></div>}
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
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat() } }}
                    placeholder="Continue the conversation…"
                    rows={2}
                    style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 10, padding: '12px 16px', color: 'var(--white)', fontSize: 14, fontFamily: 'inherit', resize: 'none', outline: 'none' }}
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
                {/* Mode — always clickable except while a request is in flight.
                    Switching modes nukes any prior selection/results via the
                    mode-change useEffect above, which is intentional. */}
                <div className="mode-selector" style={{ marginBottom: 24 }}>
                  {(['text', 'image', 'video'] as Mode[]).map(m => (
                    <button key={m} className={`mode-btn ${mode === m ? 'active' : ''}`} onClick={() => { if (phase !== 'generating') setMode(m) }}>
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
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columnCount}, 220px)`, gap: 10, marginBottom: 20, alignItems: 'start', justifyContent: 'start' }}>
                  {slotsToShow.map(i => {
                    const model = selectedModels[i]
                    const color = SLOT_COLORS[i]
                    const opts = slotOptions[i]

                    if (!model) return (
                      <button key={i} onClick={() => phase !== 'generating' && setPickerSlot(i)}
                        disabled={phase === 'generating'}
                        style={{ background: 'var(--surface)', border: '1px dashed var(--border2)', borderRadius: 10, padding: '0 14px', height: 56, boxSizing: 'border-box', color: 'var(--muted)', fontSize: 12, cursor: phase !== 'generating' ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'all 0.2s', opacity: phase === 'generating' ? 0.4 : 1 }}
                        onMouseEnter={e => { if (phase !== 'generating') { const el = e.currentTarget as HTMLElement; el.style.borderColor = color; el.style.color = color } }}
                        onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'var(--border2)'; el.style.color = 'var(--muted)' }}
                      >
                        <span style={{ fontSize: 18 }}>+</span> Model {LABELS[i]}
                      </button>
                    )

                    // Determine which options this model has
                    const imgQualities = mode === 'image' && model.image_pricing ? Object.keys(model.image_pricing) : []
                    const imgSizes = mode === 'image' ? (model.image_sizes ?? []) : []
                    const vidSizes = mode === 'video' ? (model.video_sizes ?? []) : []
                    const vidDurations = mode === 'video' ? (model.video_durations ?? []) : []
                    const hasOptions = phase !== 'generating' && opts && (imgQualities.length > 0 || imgSizes.length > 0 || vidSizes.length > 0 || vidDurations.length > 0)

                    // Upfront USD estimate for this slot given its current
                    // options + the live prompt length. Recomputed every render.
                    const estDollars = estimateSlotDollars(model, mode, opts, prompt.length)

                    return (
                      <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {/* Model card — name + remove only. Cost estimate lives
                            in the summary row right above the prompt box, not
                            here, so the grid stays clean. */}
                        <div style={{ background: 'var(--surface)', border: `1px solid ${color}44`, borderRadius: 10, padding: '0 14px', height: 56, display: 'flex', alignItems: 'center', gap: 10, boxSizing: 'border-box' }}>
                          {/* Split a name like "GPT-5.4 (free)" into a bold
                              main line and a smaller muted sub-line for the
                              parenthetical variant. The sub-line may truncate
                              since the card is fixed-width. */}
                          {(() => {
                            const match = model.name.match(/^(.*?)\s*(\([^)]*\))\s*$/)
                            const main = (match?.[1] ?? model.name).trim()
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
                          {phase !== 'generating' && <button onClick={() => removeModel(i)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 0, flexShrink: 0 }}>×</button>}
                        </div>

                        {/* Options panel directly below this model's card */}
                        {hasOptions && opts && (
                          <div style={{ background: 'var(--surface)', border: `1px solid ${color}22`, borderRadius: 10, padding: '10px 12px' }}>
                            {/* Image: Quality */}
                            {imgQualities.length > 0 && (
                              <div style={{ marginBottom: imgSizes.length > 0 ? 8 : 0 }}>
                                <div style={{ fontSize: 11, color: 'var(--muted2)', marginBottom: 6, fontWeight: 600 }}>Quality</div>
                                <div style={{ display: 'flex', gap: 4 }}>
                                  {imgQualities.map(q => {
                                    const active = opts.quality === q
                                    return (
                                      <button key={q} onClick={() => setSlotOptions(prev => prev.map((o, idx) => idx === i && o ? { ...o, quality: q } : o))}
                                        style={{
                                          flex: 1, padding: '8px 6px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                                          background: active ? color + '22' : 'transparent',
                                          border: `1px solid ${active ? color + '66' : 'var(--border2)'}`,
                                          color: active ? color : 'var(--muted)',
                                          transition: 'all 0.15s',
                                        }}
                                      >
                                        {q.charAt(0).toUpperCase() + q.slice(1)}
                                      </button>
                                    )
                                  })}
                                </div>
                              </div>
                            )}
                            {/* Image: Size */}
                            {imgSizes.length > 0 && (
                              <div>
                                <div style={{ fontSize: 11, color: 'var(--muted2)', marginBottom: 6, fontWeight: 600 }}>Size</div>
                                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' as const }}>
                                  {imgSizes.map(s => {
                                    const active = opts.size === s
                                    const isSquare = s.includes('x') && s.split('x')[0] === s.split('x')[1]
                                    const isLandscape = s.includes('x') && parseInt(s.split('x')[0]) > parseInt(s.split('x')[1])
                                    const label = isSquare ? '1:1' : isLandscape ? '▬' : '▮'
                                    return (
                                      <button key={s} onClick={() => setSlotOptions(prev => prev.map((o, idx) => idx === i && o ? { ...o, size: s } : o))}
                                        style={{
                                          flex: 1, padding: '7px 6px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                                          background: active ? color + '22' : 'transparent',
                                          border: `1px solid ${active ? color + '66' : 'var(--border2)'}`,
                                          color: active ? color : 'var(--muted)',
                                          transition: 'all 0.15s', textAlign: 'center' as const,
                                        }}
                                      >
                                        <div style={{ fontSize: 13 }}>{label}</div>
                                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, fontFamily: 'var(--mono)' }}>{s}</div>
                                      </button>
                                    )
                                  })}
                                </div>
                              </div>
                            )}
                            {/* Video: Resolution */}
                            {vidSizes.length > 0 && (
                              <div style={{ marginBottom: vidDurations.length > 1 ? 8 : 0 }}>
                                <div style={{ fontSize: 11, color: 'var(--muted2)', marginBottom: 6, fontWeight: 600 }}>Resolution</div>
                                <div style={{ display: 'flex', gap: 4 }}>
                                  {vidSizes.map(s => {
                                    const active = opts.size === s
                                    const shortLabel = s.includes('x') ? s.split('x')[1] + 'p' : s
                                    return (
                                      <button key={s} onClick={() => setSlotOptions(prev => prev.map((o, idx) => idx === i && o ? { ...o, size: s } : o))}
                                        style={{
                                          flex: 1, padding: '8px 6px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                                          background: active ? color + '22' : 'transparent',
                                          border: `1px solid ${active ? color + '66' : 'var(--border2)'}`,
                                          color: active ? color : 'var(--muted)',
                                          transition: 'all 0.15s',
                                        }}
                                      >
                                        {shortLabel}
                                      </button>
                                    )
                                  })}
                                </div>
                              </div>
                            )}
                            {/* Video: Duration */}
                            {vidDurations.length > 0 && (
                              <div>
                                <div style={{ fontSize: 11, color: 'var(--muted2)', marginBottom: 6, fontWeight: 600 }}>Duration</div>
                                <div style={{ display: 'flex', gap: 4 }}>
                                  {vidDurations.map(d => {
                                    const active = opts.duration === d
                                    return (
                                      <button key={d} onClick={() => setSlotOptions(prev => prev.map((o, idx) => idx === i && o ? { ...o, duration: d } : o))}
                                        style={{
                                          flex: 1, padding: '7px 6px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                                          background: active ? color + '22' : 'transparent',
                                          border: `1px solid ${active ? color + '66' : 'var(--border2)'}`,
                                          color: active ? color : 'var(--muted)',
                                          transition: 'all 0.15s',
                                        }}
                                      >
                                        {d}s
                                      </button>
                                    )
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
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
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 220px)', gap: 10, marginBottom: 14, alignItems: 'center', justifyContent: 'start' }}>
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
                <div className="prompt-box">
                  <textarea className="prompt-textarea"
                    placeholder={mode === 'image' ? "Describe an image…" : mode === 'video' ? "Describe a video…" : "Ask anything…"}
                    value={prompt} onChange={e => setPrompt(e.target.value)}
                    disabled={phase === 'generating'}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (canGenerate) generate() } }}
                  />
                  <div className="prompt-actions">
                    <AttachmentButton attachment={attachment} onChange={setAttachment} disabled={phase === 'generating'} context="xcreate" />
                    <span className="prompt-counter">{activeModels.length === 0 ? 'Pick at least one model' : `${activeModels.length} model${activeModels.length > 1 ? 's' : ''} selected`}</span>
                    {(phase === 'picking' || phase === 'chatting') && (
                      <button className="btn-secondary" onClick={reset}>← Start Over</button>
                    )}
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
                    <button className="btn-battle" onClick={generate} disabled={!canGenerate}>
                      {phase === 'generating' ? '⏳ Generating…' : '✦ Generate →'}
                    </button>
                  </div>
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
                            onMouseEnter={() => setCursor(color)}
                            onMouseLeave={() => setCursor('#e8453c')}
                          >
                            <div className={`battle-card-header ${mode !== 'text' ? 'image-mode' : ''}`}>
                              <div className="battle-model-id" style={{ color, fontSize: 12 }}>{stripModelVariant(model.name)}</div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                {slot.done && <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted2)' }}>⏱ {(slot.responseTime / 1000).toFixed(2)}s</span>}
                                {slot.done && slot.cost > 0 && <span className="price-badge" style={{ color }}>{fmtDollars(slot.cost)}</span>}
                              </div>
                            </div>
                            <div className={`battle-response ${mode !== 'text' ? 'image-response' : ''} ${slot.streaming && !slot.text ? 'loading' : ''}`}>
                              {slot.streaming && !slot.text
                                ? <><div className="loading-dot" /><div className="loading-dot" /><div className="loading-dot" /></>
                                : slot.error ? <div style={{ padding: 16, color: 'var(--red)', fontSize: 13 }}>⚠️ {slot.error}</div>
                                : slot.isVideo ? <video src={slot.text} autoPlay loop muted playsInline controls style={{ width: '100%', display: 'block' }} />
                                : slot.isImage ? <img src={slot.text} alt="Generated" onClick={() => setLightbox(slot.text)} style={{ width: '100%', display: 'block', cursor: 'zoom-in' }} />
                                : <><div className="markdown-body"><ReactMarkdown>{slot.text}</ReactMarkdown></div>{slot.streaming && <span className="stream-cursor">▋</span>}</>
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
                                  {mode === 'image' || mode === 'video' ? `Generate more with ${stripModelVariant(model.name)} →` : `Select ${stripModelVariant(model.name)} →`}
                                </button>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </>
            )
          )}
        </div>
      </div>
    </>
  )
}
