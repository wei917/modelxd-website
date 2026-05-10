'use client'
// app/admin/models/AdminModelsClient.tsx
//
// Catalog editor with row-card UI:
//   • Each row shows all the at-a-glance info: provider / model_name /
//     display_name / mode / pricing / tags / released / flags.
//   • Click any row to expand it inline; multiple rows may be expanded
//     simultaneously.
//   • Expanded row has tabs: Edit (full form) and Test (mini playground).
//   • Test tab calls /api/admin/test-model and renders streaming text or
//     a returned image / video data URL.

import { useEffect, useMemo, useRef, useState } from 'react'

// ── Types ────────────────────────────────────────────────────────────────────

export type TokenRate = number | { default: number; by_level?: Record<string, number> }

export interface ModelPricing {
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

export type ModelMode =
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

export interface InputModalityConfig {
  count?:         number       // override for reference_frames; otherwise unused
  capabilities?:  string[]
}
export interface InputConfig {
  text?:  InputModalityConfig
  image?: InputModalityConfig
  video?: InputModalityConfig
  audio?: InputModalityConfig
}

export type DurationSpec = number[] | { min: number; max: number }

export interface OutputModalityConfig {
  sizes?:                   string[]
  aspect_ratios?:           string[]
  /** Per-resolution durations: discrete list OR { min, max } range (video only). */
  durations_by_resolution?: Record<string, DurationSpec>
  /** Available thinking / reasoning levels (e.g. Gemini ['minimal','low','high']). */
  thinking_levels?:         string[]
  /** Available image quality tiers (e.g. ['low','medium','high']) when the
   *  model supports them but isn't per-quality priced. Token-billed image
   *  models like gpt-image-2 declare them here. */
  qualities?:               string[]
  /** Max outputs per request — image models that can generate N images at once. */
  max_count?:               number
  capabilities?:            string[]
}
export interface OutputConfig {
  text?:  OutputModalityConfig
  image?: OutputModalityConfig
  video?: OutputModalityConfig
  audio?: OutputModalityConfig
}

export interface AdminModel {
  id?:                string
  provider:           string
  model_name:         string
  display_name:       string
  enabled:            boolean
  is_popular:         boolean
  released_at:        string | null
  modes:              ModelMode[]
  input_modalities:   string[]
  output_modalities:  string[]
  tags:               string[]
  model_pricing:      ModelPricing | null
  input_config:       InputConfig  | null
  output_config:      OutputConfig | null
  created_at?:        string
  updated_at?:        string
}

// Providers known to have a runtime implementation in lib/providers/.
// Used only as a hint in the filter dropdown and the form placeholder —
// the column itself is free-form so you can stage new providers in the
// catalog before their runtime support exists.
const KNOWN_PROVIDERS = ['openai', 'google', 'alibaba', 'anthropic']
const MODALITIES      = ['text', 'image', 'video', 'audio']

// Pretty display labels for provider keys. The key in the DB stays lowercase
// (it's the routing identifier matching lib/providers/<name>.ts); only the
// label changes for UI. Anything not in the map title-cases the raw key.
const PROVIDER_LABELS: Record<string, string> = {
  openai:    'OpenAI',
  google:    'Google',
  alibaba:   'Alibaba',
  anthropic: 'Anthropic',
}
function providerLabel(p: string): string {
  return PROVIDER_LABELS[p] ?? (p.charAt(0).toUpperCase() + p.slice(1))
}

const EMPTY: AdminModel = {
  provider:          'openai',
  model_name:        '',
  display_name:      '',
  enabled:           true,
  is_popular:        false,
  released_at:       null,
  modes:             [],
  input_modalities:  ['text'],
  output_modalities: ['text'],
  tags:              [],
  model_pricing:     null,
  input_config:      null,
  output_config:     null,
}

type SortKey = 'provider' | 'model_name' | 'display_name' | 'pricing' | 'released' | 'enabled'
type SortDir = 'asc' | 'desc'

// ── Top-level component ──────────────────────────────────────────────────────

export default function AdminModelsClient({ initialModels }: { initialModels: AdminModel[] }) {
  const [models,        setModels]        = useState<AdminModel[]>(initialModels)
  const [providerFilt,  setProviderFilt]  = useState<string>('all')
  const [search,        setSearch]        = useState<string>('')
  // Set of model ids currently expanded. Multiple rows can be open at once.
  const [expanded,      setExpanded]      = useState<Set<string>>(new Set())
  // The "+ Add" form is its own pseudo-row at the top; null when closed.
  const [newRow,        setNewRow]        = useState<AdminModel | null>(null)
  const [busy,          setBusy]          = useState(false)
  const [flash,         setFlash]         = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)
  // Sorting. Defaults to provider asc, then model_name asc as tie-breaker.
  const [sortBy,        setSortBy]        = useState<SortKey>('provider')
  const [sortDir,       setSortDir]       = useState<SortDir>('asc')

  function handleSort(k: SortKey) {
    if (sortBy === k) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(k)
      // Sensible default direction per column:
      // alphabetical → asc, dates / prices / booleans → desc.
      setSortDir(k === 'provider' || k === 'model_name' || k === 'display_name' ? 'asc' : 'desc')
    }
  }

  // Populate the provider filter from whatever's actually in the data,
  // so newly-staged providers (typed into the form) show up here too.
  const providersInData = useMemo(
    () => Array.from(new Set(models.map(m => m.provider))).sort(),
    [models],
  )

  const filtered = useMemo(() => {
    let list = models
    if (providerFilt !== 'all') list = list.filter(m => m.provider === providerFilt)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(m =>
        m.model_name.toLowerCase().includes(q) ||
        m.display_name.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q)
      )
    }
    // Sort. Nulls always go to the bottom regardless of direction.
    const dir = sortDir === 'asc' ? 1 : -1
    const cmp = (a: AdminModel, b: AdminModel): number => {
      const va = sortValue(a, sortBy)
      const vb = sortValue(b, sortBy)
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
      return String(va).localeCompare(String(vb)) * dir
    }
    return [...list].sort(cmp)
  }, [models, providerFilt, search, sortBy, sortDir])

  function toggle(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else              next.add(id)
      return next
    })
  }

  function showFlash(kind: 'ok' | 'err', msg: string) {
    setFlash({ kind, msg })
    setTimeout(() => setFlash(null), 4000)
  }

  async function save(row: AdminModel): Promise<void> {
    setBusy(true)
    try {
      const r = await fetch('/api/admin/models', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify(row),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? `${r.status}`)
      setModels(prev => {
        const idx = prev.findIndex(x =>
          x.provider === j.model.provider && x.model_name === j.model.model_name
        )
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = j.model
          return next
        }
        return [...prev, j.model].sort((a, b) =>
          (a.provider + a.model_name).localeCompare(b.provider + b.model_name)
        )
      })
      // If we just created a new row, close the +Add panel.
      if (!row.id) setNewRow(null)
      showFlash('ok', 'Saved.')
    } catch (e) {
      showFlash('err', `Save failed: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  async function remove(m: AdminModel): Promise<void> {
    if (!m.id) return
    if (!confirm(`Delete ${m.provider}/${m.model_name} permanently? This cannot be undone.`)) return
    setBusy(true)
    try {
      const r = await fetch(`/api/admin/models/${m.id}`, { method: 'DELETE' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error ?? `${r.status}`)
      setModels(prev => prev.filter(x => x.id !== m.id))
      setExpanded(prev => { const n = new Set(prev); n.delete(m.id!); return n })
      showFlash('ok', 'Deleted.')
    } catch (e) {
      showFlash('err', `Delete failed: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="admin-page" style={{
      padding: '96px 32px 48px',
      maxWidth: 1500, margin: '0 auto', fontFamily: 'var(--font-body), sans-serif',
    }}>
      <style>{`
        .admin-page input:not([type="checkbox"]):focus,
        .admin-page textarea:focus,
        .admin-page select:focus {
          outline: none;
          border-color: var(--red) !important;
          box-shadow: 0 0 0 3px rgba(214,59,50,0.15);
        }
        .admin-page .mod-chip { transition: all 140ms ease; }
        .admin-page .mod-chip:hover { transform: translateY(-1px); }
        .admin-page .ax-checkbox-wrap:hover .ax-checkbox-box { border-color: var(--red); }
      `}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <h1 style={{
          fontSize: 32, color: 'var(--white)', margin: 0,
          fontFamily: 'var(--font-display), var(--font-body), sans-serif',
          letterSpacing: '-0.02em', fontWeight: 700,
        }}>Admin · Models</h1>
        <span style={{ fontSize: 15, color: 'var(--muted2)', fontFamily: 'var(--font-mono), monospace' }}>
          {filtered.length} of {models.length} rows
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={() => setNewRow({ ...EMPTY })} disabled={busy || !!newRow}
          style={{ padding: '11px 18px', background: '#86efac', color: '#064e3b', border: '1px solid #4ade80', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 15 }}>
          + Add Model
        </button>
      </div>

      {flash && (
        <div style={{
          padding: '11px 18px', borderRadius: 6, marginBottom: 14,
          background: flash.kind === 'ok' ? 'rgba(52,211,153,0.1)' : 'rgba(232,69,60,0.1)',
          color: flash.kind === 'ok' ? 'var(--green)' : 'var(--red)',
          border: `1px solid ${flash.kind === 'ok' ? 'var(--green)' : 'var(--red)'}33`,
          fontSize: 15,
        }}>
          {flash.msg}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
        <select value={providerFilt} onChange={e => setProviderFilt(e.target.value)} style={inp}>
          <option value="all">All providers</option>
          {providersInData.map(p => <option key={p} value={p}>{providerLabel(p)}</option>)}
        </select>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="search…"
          style={{ ...inp, flex: 1 }} />
      </div>

      {/* Header row */}
      <div style={GRID_HEADER}>
        <span></span>
        <SortHeader label="Provider"     sortKey="provider"     sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
        <SortHeader label="Model name"   sortKey="model_name"   sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
        <SortHeader label="Display name" sortKey="display_name" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
        <span>Output</span>
        <SortHeader label="Pricing"      sortKey="pricing"      sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
        <SortHeader label="Released"     sortKey="released"     sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
        <SortHeader label="Enabled"      sortKey="enabled"      sortBy={sortBy} sortDir={sortDir} onSort={handleSort} align="center" />
        <span style={{ textAlign: 'right' }}>Actions</span>
      </div>

      {/* +Add new model — appears as a card at the top of the list */}
      {newRow && (
        <ExpandedCard
          row={newRow}
          onSave={save}
          onCancel={() => setNewRow(null)}
          onDelete={null}
          busy={busy}
        />
      )}

      {/* Existing rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {filtered.map(m => (
          <ModelRowCard
            key={m.id}
            row={m}
            expanded={!!m.id && expanded.has(m.id)}
            onToggle={() => m.id && toggle(m.id)}
            onSave={save}
            onDelete={() => remove(m)}
            busy={busy}
          />
        ))}
        {filtered.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
            No models match your filter.
          </div>
        )}
      </div>
    </div>
  )
}

// ── Per-row card ─────────────────────────────────────────────────────────────

function ModelRowCard({
  row, expanded, onToggle, onSave, onDelete, busy,
}: {
  row:      AdminModel
  expanded: boolean
  onToggle: () => void
  onSave:   (m: AdminModel) => Promise<void>
  onDelete: () => Promise<void>
  busy:     boolean
}) {
  return (
    <div style={{
      border: `1px solid ${expanded ? 'var(--red)' : 'var(--border)'}`,
      borderRadius: 8,
      background: 'var(--bg)',
      overflow: 'hidden',
    }}>
      {/* Collapsed summary row — clickable. */}
      <div
        onClick={onToggle}
        style={{ ...GRID_BODY, cursor: 'pointer' }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
      >
        <span style={{ color: 'var(--muted)', fontSize: 20 }}>{expanded ? '▾' : '▸'}</span>
        <span style={cellMono}>{providerLabel(row.provider)}</span>
        <span style={cellMono} title={row.model_name}>{truncate(row.model_name, 30)}</span>
        <span style={{ color: 'var(--white)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {row.display_name}
        </span>
        <span style={cellSmall}>{(row.output_modalities ?? []).join(', ') || '—'}</span>
        <span style={{ ...cellSmall, color: 'var(--white)' }}>{fmtPricing(row)}</span>
        <span style={cellMono}>{fmtMonth(row.released_at)}</span>
        {/* Read-only enabled indicator. Editing happens in the expanded form. */}
        <span style={{
          textAlign: 'center',
          color: row.enabled ? 'var(--green)' : 'var(--muted)',
          fontSize: 20,
        }}
          title={row.enabled ? 'Enabled' : 'Disabled (edit form to change)'}
        >
          {row.enabled ? '●' : '○'}
        </span>
        <span style={{ textAlign: 'right', display: 'flex', gap: 6, justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
          <button onClick={onDelete} disabled={busy} style={{ ...btnSm, color: 'var(--red)' }}>Delete</button>
        </span>
      </div>

      {/* Expanded body */}
      {expanded && <ExpandedCard row={row} onSave={onSave} onCancel={onToggle} onDelete={onDelete} busy={busy} />}
    </div>
  )
}

// ── Expanded body: tabs (Edit | Test) ────────────────────────────────────────

function ExpandedCard({
  row, onSave, onCancel, onDelete, busy,
}: {
  row:      AdminModel
  onSave:   (m: AdminModel) => Promise<void>
  onCancel: () => void
  onDelete: (() => Promise<void>) | null   // null when this is the +Add panel
  busy:     boolean
}) {
  const [tab, setTab] = useState<'edit' | 'test'>('edit')
  return (
    <div style={{ borderTop: '2px solid rgba(0,0,0,0.18)', background: '#ffffff' }}>
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid rgba(0,0,0,0.10)' }}>
        <TabBtn active={tab === 'edit'} onClick={() => setTab('edit')}>Edit</TabBtn>
        {row.id && <TabBtn active={tab === 'test'} onClick={() => setTab('test')}>Test</TabBtn>}
        <div style={{ flex: 1 }} />
        <button onClick={onCancel} disabled={busy} style={{ ...btnSm, margin: 8 }}>Close</button>
      </div>
      <div style={{ padding: 16 }}>
        {tab === 'edit' && <ModelForm row={row} onSave={onSave} onCancel={onCancel} busy={busy} />}
        {tab === 'test' && row.id && <Playground model={row} />}
      </div>
    </div>
  )
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      style={{
        padding: '14px 22px',
        background: 'transparent',
        border: 'none',
        borderBottom: active ? '2px solid var(--red)' : '2px solid transparent',
        color: active ? 'var(--white)' : 'var(--muted)',
        fontFamily: 'var(--font-mono), monospace',
        fontSize: 14, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600,
        cursor: 'pointer',
      }}>
      {children}
    </button>
  )
}

// ── Edit form ────────────────────────────────────────────────────────────────

function ModelForm({ row, onSave, onCancel, busy }: {
  row:      AdminModel
  onSave:   (m: AdminModel) => Promise<void>
  onCancel: () => void
  busy:     boolean
}) {
  const [m, setM] = useState<AdminModel>(row)

  function setOutput(mods: string[]) {
    setM(prev => ({ ...prev, output_modalities: mods }))
  }

  // Helpers to patch the unified model_pricing jsonb without losing
  // sibling fields. Each setter runs through `cleanPricing` to drop empty
  // sub-objects so the row stays tidy in the DB.
  function patchTokens(t: NonNullable<ModelPricing['tokens']>): void {
    setM(prev => {
      const next: ModelPricing = { ...(prev.model_pricing ?? {}), tokens: { ...(prev.model_pricing?.tokens ?? {}), ...t } }
      return { ...prev, model_pricing: cleanPricing(next) }
    })
  }
  // Read the default rate from a polymorphic TokenRate.
  function rateDefault(r: TokenRate | undefined): number | '' {
    if (r == null) return ''
    if (typeof r === 'number') return r
    return r.default ?? ''
  }
  // Update the default while preserving any existing by_level overrides.
  function setRateDefault(r: TokenRate | undefined, n: number | undefined): TokenRate | undefined {
    if (n == null) {
      // clearing the default: drop the whole field unless by_level had data
      if (r && typeof r === 'object' && r.by_level && Object.keys(r.by_level).length > 0) {
        return { default: 0, by_level: r.by_level }
      }
      return undefined
    }
    if (r && typeof r === 'object' && r.by_level && Object.keys(r.by_level).length > 0) {
      return { default: n, by_level: r.by_level }
    }
    return n   // collapse to flat number when no overrides exist
  }

  function patchPerImage(rates: Record<string, number>): void {
    setM(prev => {
      const next: ModelPricing = { ...(prev.model_pricing ?? {}), per_image: rates }
      return { ...prev, model_pricing: cleanPricing(next) }
    })
  }
  function patchPerVideoSecond(rates: Record<string, number>): void {
    setM(prev => {
      const next: ModelPricing = { ...(prev.model_pricing ?? {}), per_video_second: rates }
      return { ...prev, model_pricing: cleanPricing(next) }
    })
  }

  return (
    <div>
      <Section title="Basics" accent="#475569">
        <div style={{ display: 'grid', gridTemplateColumns: '140px 140px minmax(180px, 1fr) minmax(180px, 1fr) auto', gap: 12 }}>
          <Field label="Provider" hint={`Known: ${KNOWN_PROVIDERS.join(', ')}.`}>
            <input value={m.provider} onChange={e => setM({ ...m, provider: e.target.value })}
              style={inp} placeholder="openai" list="known-providers" />
            <datalist id="known-providers">
              {KNOWN_PROVIDERS.map(p => <option key={p} value={p} />)}
            </datalist>
          </Field>
          <Field label="Released">
            <input
              type="date"
              value={m.released_at ? m.released_at.slice(0, 10) : ''}
              // Clamp the picker to (today − 3 years … today + 1 year).
              // Slight forward window covers preview / announced models that
              // get an effective release date a bit ahead of now.
              min={(() => { const d = new Date(); d.setFullYear(d.getFullYear() - 3); return d.toISOString().slice(0, 10) })()}
              max={(() => { const d = new Date(); d.setFullYear(d.getFullYear() + 1); return d.toISOString().slice(0, 10) })()}
              onChange={e => setM({
                ...m,
                // Stored as a full ISO timestamp; we anchor to UTC midnight.
                released_at: e.target.value ? `${e.target.value}T00:00:00Z` : null,
              })}
              style={inp}
            />
          </Field>
          <Field label="Model name (API id)" hint="Unique with provider. Locked on edit.">
            <input value={m.model_name} onChange={e => setM({ ...m, model_name: e.target.value })}
              disabled={!!row.id} style={inp} placeholder="gpt-5.4-pro" />
          </Field>
          <Field label="Display name (UI label)">
            <input value={m.display_name} onChange={e => setM({ ...m, display_name: e.target.value })} style={inp} placeholder="GPT-5.4 Pro" />
          </Field>
          <Field label="Flags">
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', minHeight: 38, paddingTop: 4 }}>
              <Checkbox checked={m.enabled} onChange={v => setM({ ...m, enabled: v })} label="enabled" />
            </div>
          </Field>
        </div>
      </Section>

      <Section title="Modalities" accent="#7c3aed">
        <Row>
          <Field label="input_modalities">
            <ModSelect value={m.input_modalities} onChange={mods => setM({ ...m, input_modalities: mods })} />
          </Field>
          <Field label="output_modalities" hint="Picks which pricing sections show below.">
            <ModSelect value={m.output_modalities} onChange={setOutput} />
          </Field>
        </Row>
      </Section>

      <Section title="Pricing" accent="var(--green)">
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 4px', lineHeight: 1.45 }}>
          Two billing flavours. Fill in whichever the provider uses:
          <strong> token rates</strong> ($/1M tokens) for any model that surfaces token usage, and
          <strong> flat rates</strong> ($/image or $/video-sec) for providers that bill per unit.
        </p>

        {/* Token rates */}
        <Row>
          <Field label="text input" hint="$/1M text input tokens.">
            <input type="number" step="any" value={rateDefault(m.model_pricing?.tokens?.text_input)} onChange={e =>
              patchTokens({ text_input: setRateDefault(m.model_pricing?.tokens?.text_input, numOrUndef(e.target.value)) })
            } style={inp} />
          </Field>
          <Field label="cached input" hint="$/1M cached text input tokens.">
            <input type="number" step="any" value={rateDefault(m.model_pricing?.tokens?.cached_input)} onChange={e =>
              patchTokens({ cached_input: setRateDefault(m.model_pricing?.tokens?.cached_input, numOrUndef(e.target.value)) })
            } style={inp} />
          </Field>
          <Field label="image input" hint="$/1M image input tokens.">
            <input type="number" step="any" value={rateDefault(m.model_pricing?.tokens?.image_input)} onChange={e =>
              patchTokens({ image_input: setRateDefault(m.model_pricing?.tokens?.image_input, numOrUndef(e.target.value)) })
            } style={inp} />
          </Field>
          <Field label="video input" hint="$/1M video input tokens.">
            <input type="number" step="any" value={rateDefault(m.model_pricing?.tokens?.video_input)} onChange={e =>
              patchTokens({ video_input: setRateDefault(m.model_pricing?.tokens?.video_input, numOrUndef(e.target.value)) })
            } style={inp} />
          </Field>
          <Field label="audio input" hint="$/1M audio input tokens.">
            <input type="number" step="any" value={rateDefault(m.model_pricing?.tokens?.audio_input)} onChange={e =>
              patchTokens({ audio_input: setRateDefault(m.model_pricing?.tokens?.audio_input, numOrUndef(e.target.value)) })
            } style={inp} />
          </Field>
        </Row>
        <Row>
          <Field label="text output" hint="$/1M text output tokens. Use the per-level overrides below for thinking-mode pricing.">
            <input type="number" step="any" value={rateDefault(m.model_pricing?.tokens?.text_output)} onChange={e =>
              patchTokens({ text_output: setRateDefault(m.model_pricing?.tokens?.text_output, numOrUndef(e.target.value)) })
            } style={inp} />
          </Field>
          <Field label="image output" hint="$/1M image output tokens.">
            <input type="number" step="any" value={rateDefault(m.model_pricing?.tokens?.image_output)} onChange={e =>
              patchTokens({ image_output: setRateDefault(m.model_pricing?.tokens?.image_output, numOrUndef(e.target.value)) })
            } style={inp} />
          </Field>
          <Field label="audio output" hint="$/1M audio output tokens.">
            <input type="number" step="any" value={rateDefault(m.model_pricing?.tokens?.audio_output)} onChange={e =>
              patchTokens({ audio_output: setRateDefault(m.model_pricing?.tokens?.audio_output, numOrUndef(e.target.value)) })
            } style={inp} />
          </Field>
        </Row>
        {/* Per-thinking-level text output rates (only when thinking_levels declared). */}
        {(() => {
          const levels = m.output_config?.text?.thinking_levels ?? []
          if (levels.length === 0) return null
          const cur     = m.model_pricing?.tokens?.text_output
          const byLevel = (cur && typeof cur === 'object') ? (cur.by_level ?? {}) : {}
          const defaultVal = (cur && typeof cur === 'object') ? (cur.default ?? 0) : (typeof cur === 'number' ? cur : 0)
          function setLevelRate(level: string, n: number | undefined) {
            const next: Record<string, number> = { ...byLevel }
            if (n == null) delete next[level]
            else           next[level] = n
            const hasAny = Object.keys(next).length > 0
            if (hasAny) {
              patchTokens({ text_output: { default: defaultVal, by_level: next } })
            } else {
              // No level overrides remain → collapse back to flat number
              patchTokens({ text_output: defaultVal > 0 ? defaultVal : undefined })
            }
          }
          return (
            <Row>
              {levels.map(lvl => (
                <Field key={lvl} label={`text output @ ${lvl}`} hint={`$/1M text output tokens when thinking level = ${lvl}`}>
                  <input type="number" step="any" value={byLevel[lvl] ?? ''} onChange={e =>
                    setLevelRate(lvl, numOrUndef(e.target.value))
                  } style={inp} />
                </Field>
              ))}
            </Row>
          )
        })()}

        {/* Flat per-image — only relevant when image is in output_modalities */}
        {m.output_modalities.includes('image') && (
          <RatesEditor
            label="flat per-image rates ($/image, by quality)"
            hint="Imagen and other flat-rate per-image models use 'default'. Leave empty for token-billed models like gpt-image-2."
            suggestions={['default']}
            valuePlaceholder="$ per image"
            datalistId={`image-rate-keys-${m.provider}-${m.model_name}`}
            rates={m.model_pricing?.per_image ?? {}}
            onChange={r => patchPerImage(r)}
          />
        )}

        {/* Flat per-video-second — only relevant when video is in output_modalities */}
        {m.output_modalities.includes('video') && (
          <RatesEditor
            label="flat per-video-second rates ($/sec, by resolution)"
            hint="Veo / Wan / Sora. Common keys: 720p / 1080p / 4k. Or 'default' if there's only one rate."
            suggestions={['720p', '1080p', '4k', 'default']}
            valuePlaceholder="$ per sec"
            datalistId={`video-rate-keys-${m.provider}-${m.model_name}`}
            rates={m.model_pricing?.per_video_second ?? {}}
            onChange={r => patchPerVideoSecond(r)}
          />
        )}
      </Section>

      {/* Modes — set of input shapes this model supports. User picks one at generation time. */}
      <Section title="Modes" accent="var(--green)">
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 2px', lineHeight: 1.45 }}>
          Which input shapes this model supports. The XCreate UI shows a mode picker from this set
          and renders attachment slots based on the user's choice. Pick all that apply — Veo 3
          supports text_to_video, image_to_video, video_to_video, and start_end_frames in the same model.
        </p>
        <Field label="Supported modes">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {modeOptionsForOutput(m.output_modalities).filter(o => o.id).map(o => {
              const checked = m.modes.includes(o.id as ModelMode)
              return (
                <button key={o.id} type="button" className="mod-chip"
                  onClick={() => setM({
                    ...m,
                    modes: checked
                      ? m.modes.filter(x => x !== o.id)
                      : [...m.modes, o.id as ModelMode],
                  })}
                  style={{
                    padding: '8px 14px',
                    background: checked ? 'rgba(0,153,112,0.10)' : '#ffffff',
                    border: `1.5px solid ${checked ? 'var(--green)' : 'rgba(0,0,0,0.18)'}`,
                    borderRadius: 8, fontSize: 14, cursor: 'pointer',
                    color: checked ? 'var(--green)' : 'var(--muted2)',
                    fontWeight: 600, fontFamily: 'inherit',
                  }}>
                  {checked && <span style={{ marginRight: 6, fontWeight: 800 }}>✓</span>}
                  {o.label}
                </button>
              )
            })}
          </div>
        </Field>

        {m.modes.includes('reference_frames') && (
          <Field label="Reference image count" hint="How many reference image slots to expose when the user picks reference_frames mode.">
            <input type="number" min={1} step={1}
              value={m.input_config?.image?.count ?? 3}
              onChange={e => {
                const n = parseInt(e.target.value, 10)
                if (Number.isFinite(n) && n >= 1) {
                  setM({
                    ...m,
                    input_config: {
                      ...(m.input_config ?? {}),
                      image: { ...(m.input_config?.image ?? {}), count: n },
                    },
                  })
                }
              }}
              style={inp} />
          </Field>
        )}
      </Section>

      {/* Output config — per output modality, the supported sizes / aspect ratios / durations / capability flags. */}
      <Section title="Output capabilities" accent="#d97706">
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 2px', lineHeight: 1.45 }}>
          What the model produces — pixel sizes, aspect ratios (16:9, 9:16), durations, capability flags
          (<code>extension</code>, <code>frame_specific</code>, etc.).
        </p>
        {(() => {
          // Always include 'text' so thinking levels can be set on text-output
          // models even though they have no sizes / aspect ratios / durations.
          const editable = (['text', 'image', 'video'] as const).filter(mod => m.output_modalities.includes(mod))
          if (editable.length === 0) {
            return (
              <EmptyHint>
                Tick at least one output modality (<code>text</code>, <code>image</code>, or <code>video</code>) in
                {' '}<strong>output_modalities</strong> above to configure it here.
              </EmptyHint>
            )
          }
          return editable.map(mod => (
            <OutputModalityEditor key={mod} mod={mod}
              value={m.output_config?.[mod] ?? null}
              resolutionKeys={mod === 'video' ? Object.keys(m.model_pricing?.per_video_second ?? {}) : []}
              onChange={cfg => setM({
                ...m,
                output_config: writeModality(m.output_config, mod, cfg),
              })}
            />
          ))
        })()}
      </Section>

      <Section title="Tags" accent="rgba(0,0,0,0.18)">
        <Field label="Tags (comma-separated)" hint="Optional metadata. Used for filtering / badging.">
          <CsvStringInput value={m.tags ?? []} onChange={v => setM({ ...m, tags: v })}
            style={inp} placeholder="vision, reasoning" />
        </Field>
      </Section>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button onClick={onCancel} disabled={busy} style={btn}>Cancel</button>
        <button onClick={() => onSave(m)} disabled={busy}
          style={{ ...btn, background: '#86efac', color: '#064e3b', borderColor: '#4ade80' }}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

// ── Test playground ──────────────────────────────────────────────────────────

function Playground({ model }: { model: AdminModel }) {
  const [prompt, setPrompt] = useState('')
  const [running, setRunning] = useState(false)
  const [text, setText] = useState('')
  const [result, setResult] = useState<{
    kind: 'image' | 'video'
    dataUrl: string
    cost?: number
    latency_ms?: number
  } | null>(null)
  const [meta, setMeta] = useState<{ inputTokens?: number; outputTokens?: number; cost?: number; latency_ms?: number } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const mode: 'text' | 'image' | 'video' =
    model.output_modalities.includes('video') ? 'video' :
    model.output_modalities.includes('image') ? 'image' :
    'text'

  async function run() {
    if (!prompt.trim() || running) return
    setRunning(true)
    setText('')
    setResult(null)
    setMeta(null)
    setErr(null)

    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      if (mode === 'text') {
        // SSE
        const r = await fetch('/api/admin/test-model', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body:    JSON.stringify({ model_id: model.id, prompt }),
          signal:  ctrl.signal,
        })
        if (!r.ok) throw new Error(await r.text())
        const reader = r.body!.getReader()
        const dec = new TextDecoder()
        let buf = ''
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          for (const evt of parseSse(buf)) {
            if (evt.event === 'delta') {
              setText(t => t + (evt.data?.text ?? ''))
            } else if (evt.event === 'done') {
              setMeta(evt.data)
            } else if (evt.event === 'error') {
              setErr(evt.data?.message ?? 'unknown error')
            }
          }
          buf = sliceConsumed(buf)
        }
      } else {
        const r = await fetch('/api/admin/test-model', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body:    JSON.stringify({ model_id: model.id, prompt }),
          signal:  ctrl.signal,
        })
        const j = await r.json()
        if (!r.ok) throw new Error(j.error ?? `${r.status}`)
        setResult({ kind: mode, dataUrl: j.dataUrl, cost: j.cost, latency_ms: j.latency_ms })
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setErr((e as Error).message)
    } finally {
      setRunning(false)
      abortRef.current = null
    }
  }

  function cancel() {
    abortRef.current?.abort()
  }

  return (
    <div>
      <div style={{ marginBottom: 10, fontSize: 13, color: 'var(--muted)' }}>
        Testing <span style={{ color: 'var(--white)', fontFamily: 'var(--font-mono), monospace' }}>{model.provider}/{model.model_name}</span>
        {' · mode = '}<span style={{ color: 'var(--white)' }}>{mode}</span>
      </div>
      <textarea
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
        placeholder={mode === 'text'
          ? 'Type a prompt...'
          : mode === 'image'
            ? 'Describe the image...'
            : 'Describe the video...'}
        style={{ ...inp, height: 80, fontFamily: 'inherit' }}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button onClick={run} disabled={running || !prompt.trim()}
          style={{ ...btn, background: 'var(--green)', color: 'var(--white)', borderColor: 'var(--green)' }}>
          {running ? 'Running…' : `Run ${mode}`}
        </button>
        {running && <button onClick={cancel} style={btn}>Cancel</button>}
      </div>

      {/* Results */}
      {err && (
        <div style={{ marginTop: 14, padding: '11px 14px', background: 'rgba(232,69,60,0.12)', border: '1px solid var(--red)', borderRadius: 6, color: 'var(--red)', fontSize: 14 }}>
          {err}
        </div>
      )}

      {mode === 'text' && (text || meta) && (
        <div style={{ marginTop: 14 }}>
          {text && (
            <pre style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: 14, color: 'var(--white)', fontFamily: 'var(--font-mono), monospace', fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 400, overflow: 'auto' }}>
              {text}
            </pre>
          )}
          {meta && <Meta inputTokens={meta.inputTokens} outputTokens={meta.outputTokens} cost={meta.cost} latency_ms={meta.latency_ms} />}
        </div>
      )}

      {result && (
        <div style={{ marginTop: 14 }}>
          {result.kind === 'image'
            ? <img src={result.dataUrl} alt="generated" style={{ maxWidth: '100%', maxHeight: 600, borderRadius: 6, border: '1px solid var(--border)' }} />
            : <video src={result.dataUrl} controls style={{ maxWidth: '100%', maxHeight: 600, borderRadius: 6, border: '1px solid var(--border)' }} />}
          <Meta cost={result.cost} latency_ms={result.latency_ms} />
        </div>
      )}
    </div>
  )
}

function Meta({ inputTokens, outputTokens, cost, latency_ms }:
  { inputTokens?: number; outputTokens?: number; cost?: number; latency_ms?: number }) {
  const parts: string[] = []
  if (latency_ms != null) parts.push(`${(latency_ms / 1000).toFixed(2)}s`)
  if (inputTokens != null && outputTokens != null) parts.push(`${inputTokens} in / ${outputTokens} out tokens`)
  if (cost != null && cost > 0) parts.push(`$${cost.toFixed(6)}`)
  if (parts.length === 0) return null
  return (
    <div style={{ marginTop: 8, fontSize: 13, color: 'var(--muted)', fontFamily: 'var(--font-mono), monospace' }}>
      {parts.join('  ·  ')}
    </div>
  )
}

// ── SSE parser (minimal) ─────────────────────────────────────────────────────

interface SseEvent { event: string; data: any }
function parseSse(buf: string): SseEvent[] {
  const out: SseEvent[] = []
  const blocks = buf.split('\n\n')
  for (let i = 0; i < blocks.length - 1; i++) {
    const block = blocks[i]
    if (!block.trim()) continue
    let event = 'message', data = ''
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data += line.slice(5).trim()
    }
    let parsed: any
    try { parsed = JSON.parse(data) } catch { parsed = { raw: data } }
    out.push({ event, data: parsed })
  }
  return out
}
function sliceConsumed(buf: string): string {
  const last = buf.lastIndexOf('\n\n')
  return last >= 0 ? buf.slice(last + 2) : buf
}

// ── Subcomponents ────────────────────────────────────────────────────────────

function Section({ title, accent = 'var(--red)', children }: {
  title: string; accent?: string; children: React.ReactNode
}) {
  return (
    <div style={{ marginBottom: 18 }}>
      <h3 style={{
        fontSize: 16, color: 'var(--white)', textTransform: 'uppercase', letterSpacing: '0.12em',
        margin: '0 0 12px', paddingLeft: 12, borderLeft: `4px solid ${accent}`,
        fontFamily: 'var(--font-display), var(--font-body), sans-serif', fontWeight: 700,
        lineHeight: 1.1,
      }}>{title}</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>
    </div>
  )
}
function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>{children}</div>
}
function Field({ label, hint, children }: { label: React.ReactNode; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 15, color: 'var(--white)' }}>
      <span style={{
        fontFamily: 'var(--font-mono), monospace', fontSize: 12, textTransform: 'uppercase',
        letterSpacing: '0.1em', color: 'var(--muted2)', fontWeight: 700,
      }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 12, color: 'var(--muted2)', lineHeight: 1.4 }}>{hint}</span>}
    </label>
  )
}

function Checkbox({ checked, onChange, label }: {
  checked: boolean; onChange: (v: boolean) => void; label?: string
}) {
  // Toggle-switch style: pill track + sliding thumb. Green gradient when on.
  return (
    <label style={{
      display: 'inline-flex', alignItems: 'center', gap: 10, cursor: 'pointer',
      userSelect: 'none',
    }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        style={{ position: 'absolute', opacity: 0, width: 0, height: 0, margin: 0 }} />
      <span style={{
        width: 42, height: 24, borderRadius: 999, position: 'relative', flexShrink: 0,
        background: checked
          ? 'linear-gradient(135deg, #00c094 0%, #009970 100%)'
          : '#e8e8e3',
        border: `1.5px solid ${checked ? '#009970' : 'rgba(0,0,0,0.16)'}`,
        transition: 'background 220ms ease, border-color 220ms ease, box-shadow 220ms ease',
        boxShadow: checked
          ? '0 2px 8px rgba(0,153,112,0.35), inset 0 1px 0 rgba(255,255,255,0.25)'
          : 'inset 0 1px 2px rgba(0,0,0,0.08)',
      }}>
        <span style={{
          position: 'absolute',
          left: checked ? 20 : 2,
          top: 2,
          width: 17, height: 17, borderRadius: '50%',
          background: '#ffffff',
          transition: 'left 220ms cubic-bezier(0.34, 1.56, 0.64, 1)',
          boxShadow: '0 2px 4px rgba(0,0,0,0.20), 0 1px 1px rgba(0,0,0,0.10)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {checked && (
            <svg width="9" height="9" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M2.5 7.2 L6 10.5 L11.5 4" stroke="#009970" strokeWidth="2.6"
                strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
      </span>
      {label && (
        <span style={{
          fontFamily: 'var(--font-mono), monospace', fontSize: 12,
          fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em',
          color: checked ? '#009970' : 'var(--muted2)',
          transition: 'color 220ms ease',
        }}>{label}</span>
      )}
    </label>
  )
}

// CSV inputs that hold their own raw text state. Splitting + filtering on
// every keystroke (the old behavior) ate trailing commas before the user
// could type the next item, so we keep the raw text local and only push
// the parsed array up to the parent.
function CsvStringInput({ value, onChange, ...rest }: {
  value:    string[]
  onChange: (v: string[]) => void
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [text, setText] = useState(() => value.join(', '))
  const lastSig = useRef<string>(value.join(' '))
  useEffect(() => {
    const sig = value.join(' ')
    if (sig !== lastSig.current) {
      lastSig.current = sig
      setText(value.join(', '))
    }
  }, [value])
  return <input {...rest} value={text} onChange={e => {
    setText(e.target.value)
    const next = e.target.value.split(',').map(s => s.trim()).filter(Boolean)
    lastSig.current = next.join(' ')
    onChange(next)
  }} />
}

function CsvNumberInput({ value, onChange, ...rest }: {
  value:    number[]
  onChange: (v: number[]) => void
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [text, setText] = useState(() => value.join(', '))
  const lastSig = useRef<string>(value.join(' '))
  useEffect(() => {
    const sig = value.join(' ')
    if (sig !== lastSig.current) {
      lastSig.current = sig
      setText(value.join(', '))
    }
  }, [value])
  return <input {...rest} value={text} onChange={e => {
    setText(e.target.value)
    const next = e.target.value.split(',').map(s => parseInt(s.trim(), 10)).filter(Number.isFinite)
    lastSig.current = next.join(' ')
    onChange(next)
  }} />
}

const MOD_COLORS: Record<string, { tint: string; ink: string; line: string }> = {
  text:  { tint: 'rgba(71,85,105,0.10)',  ink: '#334155', line: '#64748b' },
  image: { tint: 'rgba(124,58,237,0.10)', ink: '#6d28d9', line: '#8b5cf6' },
  video: { tint: 'rgba(217,119,6,0.12)',  ink: '#b45309', line: '#f59e0b' },
  audio: { tint: 'rgba(8,145,178,0.10)',  ink: '#0e7490', line: '#06b6d4' },
}

function ModSelect({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      {MODALITIES.map(mod => {
        const checked = value.includes(mod)
        const c = MOD_COLORS[mod] ?? { tint: 'rgba(0,0,0,0.05)', ink: 'var(--white)', line: 'rgba(0,0,0,0.22)' }
        return (
          <button key={mod} type="button" className="mod-chip"
            onClick={() => onChange(checked ? value.filter(v => v !== mod) : [...value, mod])}
            style={{
              padding: '7px 14px',
              borderRadius: 999,
              border: `1.5px solid ${checked ? c.line : 'rgba(0,0,0,0.18)'}`,
              background: checked ? c.tint : '#ffffff',
              color: checked ? c.ink : 'var(--muted2)',
              fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono), monospace',
              textTransform: 'uppercase', letterSpacing: '0.08em',
              cursor: 'pointer',
            }}
          >{mod}</button>
        )
      })}
    </div>
  )
}
/**
 * Free-form key/value rates editor. Each row has an editable key (e.g.
 * "medium", "720p", "1024px", or whatever the provider uses) and a numeric
 * value. The displayed keys are a suggestion list shown as autocomplete via
 * <datalist>, but the field itself is plain text — pick anything.
 *
 * Internal state holds the entries as `[key, value]` tuples so the user can
 * type in a partial key without it being committed/dropped on every keystroke.
 * onChange fires after each edit with the current parseable subset.
 */
function RatesEditor({ label, hint, suggestions, rates, onChange, valuePlaceholder, datalistId }: {
  label:             string
  hint?:             string
  suggestions:       string[]                                 // key autocomplete hints
  rates:             Record<string, number>
  onChange:          (r: Record<string, number>) => void
  valuePlaceholder?: string
  datalistId:        string                                   // unique per usage so datalists don't collide
}) {
  // Initialize once from the incoming rates. We don't sync from `rates`
  // back into local state — the editor owns the entries; the parent just
  // observes via onChange.
  const [entries, setEntries] = useState<Array<[string, string]>>(() => {
    const init = Object.entries(rates).map<[string, string]>(([k, v]) => [k, String(v)])
    return init.length > 0 ? init : [['', '']]
  })

  function commit(next: Array<[string, string]>) {
    setEntries(next)
    const out: Record<string, number> = {}
    for (const [k, v] of next) {
      const key = k.trim()
      if (!key) continue
      const n = parseFloat(v)
      if (!Number.isFinite(n)) continue
      out[key] = n
    }
    onChange(out)
  }

  return (
    <Field label={label} hint={hint ?? 'Add as many rate tiers as the provider has — keys are free-form.'}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {entries.map(([k, v], i) => (
          <div key={i} style={{
            display: 'inline-flex', alignItems: 'center',
            border: '1.5px solid rgba(0,0,0,0.22)', borderRadius: 6, background: '#ffffff',
            overflow: 'hidden',
            boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
          }}>
            <input value={k} onChange={e => commit(entries.map((row, j) => j === i ? [e.target.value, row[1]] : row))}
              placeholder="key" list={datalistId}
              style={{ ...inp, width: 110, border: 'none', borderRight: '1.5px solid rgba(0,0,0,0.18)', borderRadius: 0,
                       fontFamily: 'var(--font-mono), monospace', fontWeight: 600 }} />
            <input type="number" step="any" value={v}
              onChange={e => commit(entries.map((row, j) => j === i ? [row[0], e.target.value] : row))}
              placeholder={valuePlaceholder ?? 'rate'}
              style={{ ...inp, width: 100, border: 'none', borderRadius: 0,
                       fontFamily: 'var(--font-mono), monospace', color: 'var(--green)', fontWeight: 700 }} />
            <button
              onClick={() => commit(entries.filter((_, j) => j !== i))}
              disabled={entries.length === 1}
              title="Remove"
              style={{
                background: 'transparent', border: 'none', borderLeft: '1.5px solid rgba(0,0,0,0.18)',
                color: 'var(--red)', cursor: 'pointer', padding: '0 10px', fontSize: 18, lineHeight: 1,
                height: 38, fontWeight: 800,
              }}
            >×</button>
          </div>
        ))}
        <button onClick={() => commit([...entries, ['', '']])} style={btnSm}>
          + Add rate
        </button>
      </div>
      <datalist id={datalistId}>
        {suggestions.map(s => <option key={s} value={s} />)}
      </datalist>
    </Field>
  )
}

// ── Sorting ──────────────────────────────────────────────────────────────────

// Single-number headline price (mode-aware) used as the sort key for the
// Pricing column. Mirrors fmtPricing's lookup order — text uses output rate,
// image uses medium then default then any, video uses 720p then default then any.
/** Resolve a polymorphic TokenRate to its default rate. */
function rateNum(r: TokenRate | undefined): number | null {
  if (r == null) return null
  if (typeof r === 'number') return r
  return r.default ?? null
}

function headlinePriceValue(m: AdminModel): number | null {
  const p = m.model_pricing ?? {}
  if (p.per_video_second) {
    const r = p.per_video_second
    return r['720p'] ?? r.default ?? Object.values(r)[0] ?? null
  }
  const imgOut = rateNum(p.tokens?.image_output); if (imgOut != null) return imgOut
  if (p.per_image) {
    const r = p.per_image
    return r.medium ?? r.default ?? Object.values(r)[0] ?? null
  }
  const textOut = rateNum(p.tokens?.text_output); if (textOut != null) return textOut
  return null
}

function sortValue(m: AdminModel, key: SortKey): string | number | null {
  switch (key) {
    case 'provider':     return m.provider?.toLowerCase()     ?? null
    case 'model_name':   return m.model_name?.toLowerCase()   ?? null
    case 'display_name': return m.display_name?.toLowerCase() ?? null
    case 'pricing':      return headlinePriceValue(m)
    case 'released':     return m.released_at
    case 'enabled':      return m.enabled    ? 1 : 0
  }
}

function SortHeader({
  label, sortKey, sortBy, sortDir, onSort, align = 'left',
}: {
  label:   string
  sortKey: SortKey
  sortBy:  SortKey
  sortDir: SortDir
  onSort:  (k: SortKey) => void
  align?:  'left' | 'center' | 'right'
}) {
  const active = sortBy === sortKey
  return (
    <button onClick={() => onSort(sortKey)} style={{
      display: 'flex', alignItems: 'center', gap: 4,
      justifyContent: align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start',
      background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
      // Inherit the GRID_HEADER text styling so the buttons look identical to <span>s.
      fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 'inherit',
      letterSpacing: 'inherit', textTransform: 'inherit',
      color: active ? 'var(--white)' : 'var(--muted)',
      transition: 'color 0.12s',
      width: '100%',
    }}>
      <span>{label}</span>
      <span style={{
        fontSize: 10,
        opacity: active ? 1 : 0.25,
        color: active ? 'var(--green)' : 'inherit',
      }}>
        {active ? (sortDir === 'asc' ? '▲' : '▼') : '▲'}
      </span>
    </button>
  )
}

// ── Mode picker helpers ──────────────────────────────────────────────────────

/** Map output modalities → list of mode-checkbox options. */
function modeOptionsForOutput(output: string[]): { id: ModelMode; label: string }[] {
  // Mixed text+image (e.g. Nano Banana) is treated as image-output.
  if (output.includes('video')) return [
    { id: 'text_to_video',    label: 'Text → Video' },
    { id: 'image_to_video',   label: 'Image → Video' },
    { id: 'video_to_video',   label: 'Video → Video' },
    { id: 'start_end_frames', label: 'Start + End Frames → Video' },
    { id: 'reference_frames', label: 'Reference Frames → Video' },
  ]
  if (output.includes('image')) return [
    { id: 'text_to_image',    label: 'Text → Image' },
    { id: 'image_edit',       label: 'Image Edit' },
    { id: 'reference_frames', label: 'Reference Frames → Image' },
  ]
  return [
    { id: 'text_to_text',  label: 'Text → Text' },
    { id: 'image_to_text', label: 'Image → Text' },
    { id: 'video_to_text', label: 'Video → Text' },
    { id: 'audio_to_text', label: 'Audio → Text' },
    { id: 'pdf_to_text',   label: 'PDF → Text' },
  ]
}

// Helper used by Output capabilities section below — same pattern as before.
function writeModality<C extends Record<string, any>>(
  parent: C | null, mod: string, value: any,
): C | null {
  const next: any = { ...(parent ?? {}) }
  if (value == null) delete next[mod]
  else               next[mod] = value
  return Object.keys(next).length === 0 ? null : (next as C)
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: '10px 12px', background: 'var(--bg)',
      border: '1px dashed var(--border2)', borderRadius: 6,
      fontSize: 13, color: 'var(--muted2)', lineHeight: 1.5,
    }}>{children}</div>
  )
}

/**
 * Per-resolution duration editor. Renders BOTH the LIST and RANGE inputs
 * always-visible, with two radio buttons that pick which shape is the
 * "active" (saved) one. Default = LIST.
 *
 * Local state preserves both shapes' values across radio toggles, so
 * switching back and forth doesn't lose the user's typing.
 */
function DurationEditor({ resKey, value, onChange }: {
  resKey:   string
  value:    DurationSpec | undefined
  onChange: (spec: DurationSpec | null) => void
}) {
  const incomingIsRange = !!value && !Array.isArray(value)

  // Local UI state holds both shapes. The "active" one (per radio) is
  // what gets pushed up via onChange.
  const [active,    setActive]    = useState<'list' | 'range'>(
    incomingIsRange ? 'range' : 'list',
  )
  const [listVals,  setListVals]  = useState<number[]>(
    Array.isArray(value) ? value : [],
  )
  const [rangeMin,  setRangeMin]  = useState<number>(
    !Array.isArray(value) && value ? value.min : 1,
  )
  const [rangeMax,  setRangeMax]  = useState<number>(
    !Array.isArray(value) && value ? value.max : 8,
  )

  // Sync if the parent resets us (e.g. opening a different row).
  useEffect(() => {
    if (Array.isArray(value)) {
      setActive('list')
      setListVals(value)
    } else if (value) {
      setActive('range')
      setRangeMin(value.min)
      setRangeMax(value.max)
    } else {
      setActive('list')
    }
    // We deliberately depend only on the resKey (which row this is for) so
    // mid-typing edits don't bounce back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resKey])

  function commit(next: 'list' | 'range', list = listVals, min = rangeMin, max = rangeMax) {
    setActive(next)
    if (next === 'list') {
      onChange(list.length === 0 ? null : list)
    } else {
      onChange({ min, max: Math.max(min, max) })
    }
  }

  const radioStyle = (selected: boolean): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 6,
    fontFamily: 'var(--font-mono), monospace', fontSize: 11,
    color: selected ? 'var(--white)' : 'var(--muted2)',
    fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em',
    cursor: 'pointer', userSelect: 'none' as const,
  })

  const wrap: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', gap: 4,
    transition: 'opacity 120ms',
  }

  return (
    <div style={{
      border: '1px solid rgba(0,0,0,0.14)', borderRadius: 6, padding: 10,
      display: 'flex', flexDirection: 'column', gap: 8, background: '#fff',
    }}>
      <div style={{
        fontFamily: 'var(--font-mono), monospace', fontSize: 12, fontWeight: 700,
        color: 'var(--white)', textTransform: 'uppercase', letterSpacing: '0.1em',
      }}>{resKey}</div>

      {/* LIST row */}
      <div style={{ ...wrap, opacity: active === 'list' ? 1 : 0.45 }}>
        <label style={radioStyle(active === 'list')}>
          <input type="radio" checked={active === 'list'}
            onChange={() => commit('list')} />
          List
        </label>
        <CsvNumberInput
          value={listVals}
          onChange={v => {
            setListVals(v)
            if (active === 'list') onChange(v.length === 0 ? null : v)
          }}
          onFocus={() => { if (active !== 'list') commit('list', listVals) }}
          style={inp} placeholder="4, 6, 8"
        />
      </div>

      {/* RANGE row */}
      <div style={{ ...wrap, opacity: active === 'range' ? 1 : 0.45 }}>
        <label style={radioStyle(active === 'range')}>
          <input type="radio" checked={active === 'range'}
            onChange={() => commit('range')} />
          Range
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 6, alignItems: 'center' }}>
          <input type="number" min={1} step={1} value={rangeMin}
            onFocus={() => { if (active !== 'range') commit('range', listVals, rangeMin, rangeMax) }}
            onChange={e => {
              const v = parseInt(e.target.value, 10)
              if (!Number.isFinite(v)) return
              setRangeMin(v)
              if (active === 'range') onChange({ min: v, max: Math.max(v, rangeMax) })
            }}
            style={inp} placeholder="3" />
          <span style={{ color: 'var(--muted2)', fontFamily: 'var(--font-mono), monospace', fontSize: 14 }}>–</span>
          <input type="number" min={1} step={1} value={rangeMax}
            onFocus={() => { if (active !== 'range') commit('range', listVals, rangeMin, rangeMax) }}
            onChange={e => {
              const v = parseInt(e.target.value, 10)
              if (!Number.isFinite(v)) return
              setRangeMax(v)
              if (active === 'range') onChange({ min: Math.min(rangeMin, v), max: v })
            }}
            style={inp} placeholder="15" />
        </div>
      </div>
    </div>
  )
}

function OutputModalityEditor({ mod, value, onChange, resolutionKeys }: {
  mod:             'text' | 'image' | 'video'
  value:           OutputModalityConfig | null
  onChange:        (v: OutputModalityConfig | null) => void
  resolutionKeys?: string[]      // video only — derived from video_pricing.rates
}) {
  const v = value ?? {}
  const sizes = v.sizes ?? []
  const ars   = v.aspect_ratios ?? []
  const dbr   = v.durations_by_resolution ?? {}
  const tl    = v.thinking_levels ?? []
  const qual  = v.qualities ?? []

  function patch(p: Partial<OutputModalityConfig>) {
    const next: OutputModalityConfig = { ...v, ...p }
    if (next.sizes           && next.sizes.length           === 0) delete next.sizes
    if (next.aspect_ratios   && next.aspect_ratios.length   === 0) delete next.aspect_ratios
    if (next.thinking_levels && next.thinking_levels.length === 0) delete next.thinking_levels
    if (next.qualities       && next.qualities.length       === 0) delete next.qualities
    if (next.durations_by_resolution && Object.keys(next.durations_by_resolution).length === 0) {
      delete next.durations_by_resolution
    }
    // max_count: drop unset / 1 (single-output models don't need to declare it)
    if (next.max_count == null || next.max_count <= 1) delete next.max_count
    onChange(Object.keys(next).length === 0 ? null : next)
  }

  function patchDurationSpec(resKey: string, spec: DurationSpec | null) {
    const nextMap: Record<string, DurationSpec> = { ...dbr }
    if (!spec) delete nextMap[resKey]
    else       nextMap[resKey] = spec
    patch({ durations_by_resolution: nextMap })
  }

  return (
    <div style={cfgBox}>
      <div style={cfgTitle}>{mod}</div>
      {mod !== 'text' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 8 }}>
          <Field label="sizes (comma-separated)">
            <CsvStringInput value={sizes} onChange={v => patch({ sizes: v })}
              style={inp} placeholder={mod === 'image' ? '1024x1024' : '1280x720, 720x1280'} />
          </Field>
          <Field label="aspect ratios">
            <CsvStringInput value={ars} onChange={v => patch({ aspect_ratios: v })}
              style={inp} placeholder={mod === 'image' ? '1:1' : '16:9, 9:16'} />
          </Field>
        </div>
      )}
      {mod === 'text' && (
        <Field label="thinking levels (comma-separated)" hint="Reasoning levels the model accepts at generation time. Leave empty for models without thinking. Gemini: minimal, low, high. OpenAI o-series: low, medium, high.">
          <CsvStringInput value={tl} onChange={v => patch({ thinking_levels: v })}
            style={inp} placeholder="minimal, low, high" />
        </Field>
      )}
      {mod === 'image' && (
        <>
          <Field label="qualities (comma-separated)" hint="Image quality tiers (e.g. low, medium, high). Declared by the model when it supports a quality control. Leave empty if the model has no quality knob.">
            <CsvStringInput value={qual} onChange={v => patch({ qualities: v })}
              style={inp} placeholder="low, medium, high" />
          </Field>
          <Field label="max output count" hint="Maximum images per request. Leave empty / 1 for single-output models.">
            <input type="number" min={1} max={20} step={1}
              value={v.max_count ?? ''}
              onChange={e => {
                const n = parseInt(e.target.value, 10)
                patch({ max_count: Number.isFinite(n) && n > 0 ? n : undefined })
              }}
              style={inp} placeholder="1" />
          </Field>
        </>
      )}
      {mod === 'video' && (
        <>
          <div style={{
            marginTop: 4, paddingTop: 10,
            borderTop: '1px dashed rgba(0,0,0,0.12)',
          }}>
            <div style={{
              fontSize: 12, fontFamily: 'var(--font-mono), monospace',
              textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted2)',
              fontWeight: 700, marginBottom: 8,
            }}>
              durations per resolution (sec)
            </div>
            {(resolutionKeys ?? []).length === 0 ? (
              <EmptyHint>
                Set <strong>Video pricing</strong> rates above first — the resolution keys
                ({' '}<code>720p</code>, <code>1080p</code>, …) come from there.
              </EmptyHint>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8,
              }}>
                {(resolutionKeys ?? []).map(k => (
                  <DurationEditor key={k} resKey={k} value={dbr[k]}
                    onChange={spec => patchDurationSpec(k, spec)} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

const cfgBox: React.CSSProperties = {
  border: '1.5px solid rgba(0,0,0,0.18)', borderRadius: 8, padding: 12, marginBottom: 10,
  display: 'flex', flexDirection: 'column', gap: 10, background: '#ffffff',
  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
}
const cfgTitle: React.CSSProperties = {
  fontSize: 13, color: '#d97706', fontFamily: 'var(--font-mono), monospace',
  textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 2, fontWeight: 800,
}

// ── Display helpers ──────────────────────────────────────────────────────────

function fmtMonth(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return `${(d.getUTCMonth() + 1).toString().padStart(2, '0')}/${d.getUTCFullYear()}`
}
function fmtMode(m: AdminModel): string {
  const inA  = (m.input_modalities  ?? []).join(', ') || '?'
  const outA = (m.output_modalities ?? []).join(', ') || '?'
  return `${inA} → ${outA}`
}
function fmtPricing(m: AdminModel): string {
  const p = m.model_pricing ?? {}
  if (p.per_video_second) {
    const r = p.per_video_second
    const v = r['720p'] ?? r.default ?? Object.values(r)[0]
    if (typeof v === 'number') return `$${fmt$(v)} / sec`
  }
  const imgOut = rateNum(p.tokens?.image_output)
  if (imgOut != null) return `$${fmt$(imgOut)} / 1M out`
  if (p.per_image) {
    const r = p.per_image
    const v = r.medium ?? r.default ?? Object.values(r)[0]
    if (typeof v === 'number') return `$${fmt$(v)} / img`
  }
  const ti = rateNum(p.tokens?.text_input)
  const to = rateNum(p.tokens?.text_output)
  if (ti != null && to != null) return `$${fmt$(ti)} / $${fmt$(to)}`
  if (to != null)               return `$${fmt$(to)} / 1M`
  return '—'
}

// Drop empty sub-objects so we don't store noise in the DB.
function cleanPricing(p: ModelPricing): ModelPricing | null {
  const out: ModelPricing = { ...p }
  if (out.tokens) {
    const t: any = { ...out.tokens }
    for (const k of Object.keys(t)) if (t[k] == null) delete t[k]
    if (Object.keys(t).length === 0) delete out.tokens
    else                              out.tokens = t
  }
  if (out.per_image && Object.keys(out.per_image).length === 0)        delete out.per_image
  if (out.per_video_second && Object.keys(out.per_video_second).length === 0) delete out.per_video_second
  return Object.keys(out).length === 0 ? null : out
}
function fmt$(n: number): string {
  if (n < 0.01) return n.toFixed(4)
  if (n < 1)    return n.toFixed(3)
  return n.toFixed(2)
}
function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}
function parseLines(s: string): string[] {
  return s.split('\n').map(x => x.trim()).filter(Boolean)
}
function numOrUndef(s: string): number | undefined {
  if (s === '') return undefined
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : undefined
}

// ── Inline styles ────────────────────────────────────────────────────────────

const GRID = '32px 100px 1.4fr 1.6fr 150px 140px 90px 60px 120px'
const GRID_HEADER: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: GRID, gap: 12,
  padding: '16px 20px',
  fontSize: 16, color: 'var(--muted)', fontWeight: 700,
  letterSpacing: '0.08em', textTransform: 'uppercase',
  fontFamily: 'var(--font-mono), monospace',
}
const GRID_BODY: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: GRID, gap: 12,
  padding: '16px 20px',
  fontSize: 17, alignItems: 'center',
  transition: 'background 0.12s',
}
const cellMono: React.CSSProperties = {
  color: 'var(--muted2)', fontFamily: 'var(--font-mono), monospace', fontSize: 16,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}
const cellSmall: React.CSSProperties = {
  color: 'var(--muted2)', fontSize: 16,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}
const inp: React.CSSProperties = {
  padding: '9px 12px', background: '#ffffff', color: 'var(--white)',
  border: '1.5px solid rgba(0,0,0,0.22)', borderRadius: 6, fontSize: 15, fontFamily: 'inherit',
  width: '100%', boxSizing: 'border-box', transition: 'border-color 120ms, box-shadow 120ms',
}
const btn: React.CSSProperties = {
  padding: '9px 15px', background: '#ffffff', color: 'var(--white)',
  border: '1.5px solid rgba(0,0,0,0.20)', borderRadius: 6, cursor: 'pointer',
  fontSize: 15, fontFamily: 'inherit', fontWeight: 600,
}
const btnSm: React.CSSProperties = {
  padding: '7px 12px', background: '#ffffff', color: 'var(--white)',
  border: '1.5px solid rgba(0,0,0,0.20)', borderRadius: 6, cursor: 'pointer',
  fontSize: 14, fontFamily: 'inherit', fontWeight: 600,
}
const lbl: React.CSSProperties = {
  fontSize: 15, color: 'var(--white)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
}
