'use client'
// app/components/ModelPickerDialog.tsx
//
// The model picker, lifted out of app/xcreate/client.tsx so XTalk can use the
// same one. Not a rewrite — the body below is the dialog XCreate has been
// shipping; only the types it needs came with it.
//
// It filters on `recipeMode`, which is an XCreate idea (which input→output
// shape this run wants). XTalk passes 'text_to_text', which every text model
// declares, so the filter is a no-op there and the dialog behaves as a plain
// list. That is why this could be shared without being generalised first.

import { useEffect, useState } from 'react'
import { allowedFor } from '../../lib/model-features'
import { createBrowserClient } from '@supabase/ssr'
import { useT } from '../../lib/i18n'
import ProviderLogo from './ProviderLogo'

const createSupabaseBrowser = () => createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
)

export type Mode = 'text' | 'image' | 'video'

export type ModelMode =
  | 'text_to_text' | 'image_to_text' | 'video_to_text' | 'audio_to_text' | 'pdf_to_text'
  | 'text_to_image' | 'image_edit' | 'region_edit'
  | 'text_to_video' | 'image_to_video' | 'video_to_video' | 'video_edit' | 'extend_video' | 'audio_to_video'
  | 'start_end_frames' | 'reference_frames'

/** Deliberately loose: both call sites have their own richer row types, and
 *  structural typing lets those satisfy this without either side importing
 *  the other's. */
export interface PickerModel {
  /** Feature keys this model is not offered for — lib/model-features.ts. */
  blocked_features?: string[] | null
  id: string
  provider: string
  model_name: string
  display_name: string
  modes?: string[]
  released_at?: string | null
  is_popular?: boolean | null
  tags?: string[]
  input_modalities?: string[]
  model_pricing?: any
  output_config?: any
  input_config?: { image?: { count?: number }; video?: { count?: number } } | null
}

// ── Model Picker Dialog ───────────────────────────────────────────────────────
// Group models by company using the provider field.
// Falls back to "other" for anything unexpected.
function companyOf(m: PickerModel): string {
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

export default function ModelPickerDialog({ mode, recipeMode, onSelect, onClose, slotIds, feature }: {
  /** One recipe, or a SET — a model qualifies by supporting ANY of them
   *  (canvas re-generate wants image_to_video OR reference_frames). */
  mode: Mode; recipeMode: ModelMode | ModelMode[]; onSelect: (m: PickerModel) => void; onClose: () => void
  /** model_name values this table cannot seat (see WEREWOLF_BANNED_MODELS).
   *  Hidden outright rather than shown-and-disabled: a greyed row invites
   *  "why not?", and the answer — our timeout budget — is not the user's
   *  problem to reason about. */
  /** Surface this picker is choosing for. Models with the key in their
   *  blocked_features are not offered. See lib/model-features.ts. */
  feature?: string
  /** Per-slot selected model ids (null = empty slot) - index maps to A/B/C/D. */
  slotIds: (string | null)[]
}) {
  const t = useT()
  const [search,      setSearch]      = useState('')
  const [allModels,   setAllModels]   = useState<PickerModel[]>([])
  const [loading,     setLoading]     = useState(true)
  // Esc closes the picker (CC, July 19) — same as clicking the backdrop.
  // CAPTURE phase, so no handler between the focused element and document
  // can swallow the key first, and stopPropagation so closing the picker
  // is ALL that Esc does — no other Esc behavior stacks on top of it
  // (owner, Aug 9). Native fullscreen is the one thing we cannot shield:
  // the browser reserves Esc for exiting it, which is why the footer's
  // Cancel button exists.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // null = "All" (no company filter active).
  const [company,     setCompany]     = useState<string | null>(null)
  // Sort direction for release date. 'desc' = newest first.
  const [sortDir,     setSortDir]     = useState<'desc' | 'asc'>('desc')
  // Rank first, by default. This site exists to say which models are worth
  // using; a picker that ordered them by release date was ignoring its own
  // leaderboard at the one moment the answer matters. Release order stays as
  // the alternative — "what's new" is a real question, just not the first one.
  const [sortBy,      setSortBy]      = useState<'rank' | 'released'>('rank')
  const [scores,      setScores]      = useState<Record<string, number>>({})

  useEffect(() => {
    // Same snapshot XBoard reads. A failure here is not worth blocking the
    // picker over — it just falls back to an unranked list.
    fetch(`/api/xboard?mode=${mode}`)
      .then(r => r.ok ? r.json() : [])
      .then((rows: { modelId: string; xdScore: number }[]) => {
        const map: Record<string, number> = {}
        for (const r of rows ?? []) map[r.modelId] = r.xdScore
        setScores(map)
      })
      .catch(() => {})
  }, [mode])

  useEffect(() => {
    // Order by release date, newest first. Rows with a null released_at
    // fall to the bottom, then tie-break by name.
    createSupabaseBrowser()
      .from('ai_models')
      .select('*')
      .eq('enabled', true)
      .contains('output_modalities', [mode])
      .order('released_at', { ascending: false, nullsFirst: false })
      .then(({ data }) => { setAllModels(data ?? []); setLoading(false) })
  }, [mode])

  // Only models that support the run's recipe (Layer 2) — EVERYTHING in
  // the dialog (chips, counts, list) is based on this set, so "All (N)"
  // means N pickable models, not N models in the mode.
  // Feature-level availability, straight off the row (ai_models.blocked_features).
  // Hidden outright rather than shown-and-disabled: a greyed row invites
  // "why not?", and the reason — our per-call timeout budget — is not the
  // user's problem to reason about.
  const models = feature ? allowedFor(allModels, feature) : allModels
  const recipes: ModelMode[] = Array.isArray(recipeMode) ? recipeMode : [recipeMode]
  const eligible = models.filter(m => recipes.some(r => (m.modes ?? []).includes(r)))

  // Count models per company so we can show the top companies as chips.
  // We show at most ~10 chips to keep the row tidy.
  const companyCounts = (() => {
    const counts: Record<string, number> = {}
    for (const m of eligible) {
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
  const filteredUnsorted = eligible.filter(m => {
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
  const byReleased = (a: PickerModel, b: PickerModel) => {
    const aT = a.released_at ? new Date(a.released_at).getTime() : NaN
    const bT = b.released_at ? new Date(b.released_at).getTime() : NaN
    if (Number.isNaN(aT) && Number.isNaN(bT)) return 0
    if (Number.isNaN(aT)) return 1
    if (Number.isNaN(bT)) return -1
    return sortDir === 'desc' ? bT - aT : aT - bT
  }
  // Unrated models sort last rather than to zero: "no votes yet" is not the
  // same claim as "rated lowest", and a new model would otherwise be buried
  // under everything the moment it launched.
  const byRank = (a: PickerModel, b: PickerModel) => {
    const aS = scores[a.id]
    const bS = scores[b.id]
    if (aS == null && bS == null) return byReleased(a, b)
    if (aS == null) return 1
    if (bS == null) return -1
    return sortDir === 'desc' ? bS - aS : aS - bS
  }
  const filtered = [...filteredUnsorted].sort(sortBy === 'rank' ? byRank : byReleased)

  // Models in this mode that DON'T support the current sub-mode. Shown
  // dimmed below the eligible list (same company/search filters), so
  // users can see the rest of the catalog exists and why it's unpickable.
  const hiddenAll = models.filter(m => !recipes.some(r => (m.modes ?? []).includes(r)))
  const hiddenFiltered = [...hiddenAll.filter(m => {
    if (company && companyOf(m) !== company) return false
    if (q) {
      return (
        m.display_name.toLowerCase().includes(q) ||
        m.model_name.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q)
      )
    }
    return true
  })].sort(byReleased)

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 14, width: 520, maxWidth: 'calc(100vw - 32px)', maxHeight: '70vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
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

          {/* Two sort buttons, one per field. A single button that toggled
              WHICH field, plus a second for direction, meant the label under
              your cursor changed meaning depending on hidden state — you had
              to read both to know what one click would do. Two named buttons:
              click to sort by that, click again to reverse. */}
          {([['rank', 'XD score'], ['released', 'Released']] as const).map(([key, label]) => {
            const on = sortBy === key
            return (
              <button
                key={key}
                onClick={() => on ? setSortDir(d => (d === 'desc' ? 'asc' : 'desc')) : setSortBy(key)}
                title={on
                  ? (sortDir === 'desc' ? 'Highest first — click to reverse' : 'Lowest first — click to reverse')
                  : `Sort by ${label.toLowerCase()}`}
                style={{
                  padding: '4px 11px', borderRadius: 12, fontSize: 11, fontWeight: 700,
                  textTransform: 'uppercase' as const, letterSpacing: '0.5px', cursor: 'pointer',
                  border: `1px solid ${on ? 'var(--red)' : 'var(--border2)'}`,
                  background: on ? 'var(--red-dim)' : 'transparent',
                  color: on ? 'var(--red)' : 'var(--muted2)',
                  fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4,
                }}
              >
                {/* The arrow marks the ACTIVE field only — on the idle button
                    it would promise a direction that clicking will not apply. */}
                {on && <span>{sortDir === 'desc' ? '↓' : '↑'}</span>}
                <span>{label}</span>
              </button>
            )
          })}

          <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>
            {filtered.length} of {eligible.length}
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
        {/* Sub-mode filter notice — the list is scoped to the run's
            "Create from" choice; make that visible so a shorter list
            doesn't read as a smaller catalog. */}
        {!loading && hiddenAll.length > 0 && (
          <div style={{ margin: '0 16px 10px', padding: '8px 12px', flexShrink: 0, background: 'rgba(214,59,50,0.05)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11.5, color: 'var(--muted2)', lineHeight: 1.5 }}>
            Showing models that support <b style={{ color: 'var(--white)', fontWeight: 600 }}>{recipes.map(r => t('recipe.' + r)).join(' / ')}</b>
          </div>
        )}
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
            // Slot letters this model already occupies (A/B/C/D) - shown
            // as a status badge at the LEFT edge of the row (CC, July 20).
            const inSlots = slotIds.flatMap((id, i) => id === m.id ? ['ABCD'[i]] : [])
            return (
              <div key={m.id}
                onClick={() => onSelect({ id: m.id, provider: m.provider, model_name: m.model_name, display_name: m.display_name, modes: (m.modes ?? []) as ModelMode[], model_pricing: m.model_pricing, output_config: m.output_config, input_config: m.input_config ?? null })}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--surface2)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
              >
                {/* Left status: the slot letter(s) this model occupies. */}
                <span style={{ width: 18, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
                  {inSlots.length > 0 && (
                    <span style={{ fontSize: 9, fontWeight: 800, color: '#fff', background: 'var(--red)', borderRadius: 5, padding: '2px 5px', fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.05em' }}>
                      {inSlots.join('')}
                    </span>
                  )}
                </span>
                <ProviderLogo provider={m.provider} size={18} />
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
                    {new Date(m.released_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })}
                  </span>
                )}
                {m.tags?.includes('reasoning') && <span style={{ fontSize: 9, color: '#a78bfa', background: '#a78bfa18', padding: '2px 6px', borderRadius: 6, fontWeight: 700 }}>REASONING</span>}
                {/* The score, shown where the choice is made rather than only
                    on XBoard. A number that decides the order should be
                    visible, otherwise the ranking looks arbitrary. */}
                {scores[m.id] != null && (
                  <span style={{
                    fontFamily: 'var(--font-mono), monospace', fontSize: 11, fontWeight: 700,
                    color: 'var(--muted2)', flexShrink: 0, whiteSpace: 'nowrap' as const,
                  }}>{Math.round(scores[m.id])}</span>
                )}
                {(() => {
                  // Image-capacity badge — only meaningful for recipes with
                  // image upload slots. Makes it visible WHY the slot cap
                  // drops when a lower-capacity model joins the run (the run
                  // uses the min across selected models so every model gets
                  // the identical attachment set).
                  if (recipeMode !== 'reference_frames' && recipeMode !== 'image_edit') return null
                  const n = m.input_config?.image?.count ?? (recipeMode === 'reference_frames' ? 2 : 1)
                  if (recipeMode === 'image_edit' && n <= 1) return null  // 1 input is the norm for edit
                  return (
                    <span style={{ fontSize: 9, color: '#a78bfa', background: '#a78bfa18', padding: '2px 6px', borderRadius: 6, fontWeight: 700, whiteSpace: 'nowrap' as const, flexShrink: 0 }}>
                      UP TO {n} {recipeMode === 'reference_frames' ? 'REFS' : 'IMGS'}
                    </span>
                  )
                })()}
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
              </div>
            )
          })}

          {/* Dimmed remainder — exists, just not pickable for this
              sub-mode. Builds trust that the catalog is bigger than the
              current filter. */}
          {!loading && hiddenFiltered.length > 0 && (
            <>
              <div style={{ padding: '10px 16px 6px', fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.12em', textTransform: 'uppercase' as const, borderBottom: '1px solid var(--border)' }}>
                {'Doesn’t support '}{t('recipe.' + recipeMode)} ({hiddenFiltered.length})
              </div>
              {hiddenFiltered.map(m => (
                <div key={m.id}
                  title={`${m.display_name} doesn't support ${t('recipe.' + recipeMode)}`}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--border)', opacity: 0.45, cursor: 'default' }}
                >
                  <span style={{ width: 18, flexShrink: 0 }} />
                  <ProviderLogo provider={m.provider} size={18} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {m.display_name}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, fontFamily: 'var(--mono)' }}>{m.model_name}</div>
                  </div>
                  {m.released_at && (
                    <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)', whiteSpace: 'nowrap' as const, flexShrink: 0 }}>
                      {new Date(m.released_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })}
                    </span>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
        {/* An explicit way out at the bottom (owner, Aug 9) — Esc and the
            backdrop click do the same, but a visible button always works,
            fullscreen included. */}
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', flexShrink: 0, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid var(--border2)', background: 'transparent', color: 'var(--muted2)', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer' }}
          >{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}
