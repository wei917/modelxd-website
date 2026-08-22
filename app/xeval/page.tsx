'use client'
// app/xeval/page.tsx
// XEval — published benchmark replication results. Separate from XBoard by
// design: XBoard is ModelXD's own signal (human blind votes on this
// platform); XEval is our independently-operated run of public benchmarks
// (pilot: OpenAI's GDPval gold tasks) with a fully disclosed judge protocol
// and (model, effort) as the unit — the effort/cost axis no other
// leaderboard publishes. Reads the xeval_* tables (migration 83), which the
// owner-triggered publish script fills from the local pilot store.

import { useEffect, useMemo, useRef, useState } from 'react'

const TOP_N = 10
import Link from 'next/link'
import { createBrowserClient } from '@supabase/ssr'
import ProviderLogo from '../components/ProviderLogo'
import { useT } from '../../lib/i18n'

interface RatingRow {
  fit_id: string
  ts: string
  entry: string
  model_id: string | null
  model_name: string
  effort: string | null
  rating: number
  games: number
  wins: number
  judge_filter: string
  params: string
}

interface RunRow {
  run_id: string
  task_id: string
  occupation: string | null
  model_name: string
  display_name: string
  provider: string
  effort: string | null
  cost_usd: number | null
  model_s: number | null
}

export default function XEvalPage() {
  const t = useT()
  const [ratings, setRatings] = useState<RatingRow[]>([])
  const [verdicts, setVerdicts] = useState(0)
  const [runs, setRuns] = useState<RunRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const sb = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    )
    ;(async () => {
      // Latest fit only: rating rows share a fit_id; newest ts wins.
      const { data: r } = await sb
        .from('xeval_ratings')
        .select('*')
        .order('ts', { ascending: false })
        .limit(50)
      const latestFit = r?.[0]?.fit_id
      // retired entries keep their games in the fit but leave the display
      setRatings((r ?? []).filter(row => row.fit_id === latestFit && !(row as any).retired))
      const { count } = await sb.from('xeval_judgments').select('id', { count: 'exact', head: true })
      setVerdicts(count ?? 0)
      const { data: rr } = await sb
        .from('xeval_runs')
        .select('run_id, task_id, occupation, model_name, display_name, provider, effort, cost_usd, model_s')
        .eq('status', 'finished')
      setRuns(rr ?? [])
      setLoading(false)
    })()
  }, [])

  // Per-entry aggregates from the runs behind the ratings.
  const perEntry = useMemo(() => {
    const m = new Map<string, { display: string; provider: string; costs: number[]; times: number[] }>()
    for (const r of runs) {
      const key = `${r.model_name}|${r.effort ?? ''}`
      if (!m.has(key)) m.set(key, { display: r.display_name, provider: r.provider, costs: [], times: [] })
      const e = m.get(key)!
      if (r.cost_usd != null) e.costs.push(Number(r.cost_usd))
      if (r.model_s != null) e.times.push(Number(r.model_s))
    }
    return m
  }, [runs])

  const taskCount = useMemo(() => new Set(runs.map(r => r.task_id)).size, [runs])
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
  // judge_filter is the fit's machine label, e.g. "panel(3 judges)@high+rules+tasks:enabled".
  // Render the panel form as prose; anything else falls back to the raw label.
  const judge = useMemo(() => {
    const raw = ratings[0]?.judge_filter ?? ''
    const m = raw.match(/^panel\((\d+) judges?\)@(\w+)/)
    return m ? t('xeval.judge.panel').replace('{n}', m[1]).replace('{effort}', m[2]) : raw
  }, [ratings, t])

  // View filter. 'best' collapses each model to its highest reasoning effort —
  // a pure display filter: BT ratings are global, so hiding rows changes
  // nothing about the numbers shown.
  const [view, setView] = useState<'all' | 'best'>('all')
  // Display cap: whatever the filters + sort produce, show the top TOP_N rows
  // (and the same rows on the chart) until the reader asks for the rest.
  const [showAll, setShowAll] = useState(false)

  // Column sorting — XBoard's pattern: click a header to sort, click again
  // to flip. Numeric columns default desc (rating/wins) or asc (cost/time).
  type SortKey = 'model' | 'effort' | 'rating' | 'wins' | 'cost' | 'time'
  const [sortBy, setSortBy] = useState<SortKey>('rating')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const onSort = (k: SortKey) => {
    if (k === sortBy) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortBy(k)
      setSortDir(k === 'rating' || k === 'wins' ? 'desc' : 'asc')
    }
  }
  const EFFORT_ORDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

  // Page-level filters (provider / effort / family) drive BOTH the chart and
  // the table. Empty selection = no filter. Family is derived from the model
  // name by pattern — ai_models has no family column; if one is added this
  // becomes a plain read.
  const familyOf = (modelName: string, display: string): string => {
    // Family = the product line that persists across versions/variants
    // (owner's taxonomy, Aug 21): "Claude Opus" spans 4.8 → 5; "GPT-5.6"
    // spans Sol/Luna/Terra; "Gemini Flash" spans 3.x.
    const m = modelName
    let r: RegExpMatchArray | null
    if ((r = m.match(/^claude-(opus|sonnet|fable|haiku)/))) return `Claude ${r[1][0].toUpperCase()}${r[1].slice(1)}`
    if ((r = m.match(/^gpt-(\d+(?:\.\d+)?)/))) return `GPT-${r[1]}`
    if (/^gemini-.*flash-lite/.test(m)) return 'Gemini Flash-Lite'
    if (/^gemini-.*flash/.test(m)) return 'Gemini Flash'
    if (/^gemini-.*pro/.test(m)) return 'Gemini Pro'
    if (/^grok-/.test(m)) return 'Grok'
    if (/^kimi-/.test(m)) return 'Kimi'
    if ((r = m.match(/^qwen[\d.]*-(max|plus|flash|turbo)/))) return `Qwen ${r[1][0].toUpperCase()}${r[1].slice(1)}`
    return display.split(' ')[0]
  }
  const [selProv, setSelProv] = useState<Set<string>>(new Set())
  const [selEffort, setSelEffort] = useState<Set<string>>(new Set())
  const [selFamily, setSelFamily] = useState<Set<string>>(new Set())
  const flip = (set: Set<string>, setter: (s: Set<string>) => void, k: string) => {
    const n = new Set(set); n.has(k) ? n.delete(k) : n.add(k); setter(n)
  }
  const provOf = (r: RatingRow) => perEntry.get(`${r.model_name}|${r.effort ?? ''}`)?.provider ?? ''
  const famOf = (r: RatingRow) => familyOf(r.model_name, perEntry.get(`${r.model_name}|${r.effort ?? ''}`)?.display ?? r.model_name)
  const allProviders = useMemo(() => [...new Set(ratings.map(provOf).filter(Boolean))].sort(), [ratings, perEntry])
  const allEfforts = useMemo(() => [...new Set(ratings.map(r => r.effort ?? ''))].sort((a, b) => EFFORT_ORDER.indexOf(a) - EFFORT_ORDER.indexOf(b)), [ratings])
  const allFamilies = useMemo(() => [...new Set(ratings.map(famOf))].sort(), [ratings, perEntry])
  const filtered = useMemo(() => ratings.filter(r =>
    (selProv.size === 0 || selProv.has(provOf(r))) &&
    (selEffort.size === 0 || selEffort.has(r.effort ?? '')) &&
    (selFamily.size === 0 || selFamily.has(famOf(r)))
  ), [ratings, selProv, selEffort, selFamily, perEntry])

  const visible = useMemo(() => {
    let list = [...filtered].sort((a, b) => b.rating - a.rating)
    if (view === 'best') {
      // One row per model: its HIGHEST reasoning effort (the owner's "best
      // effort" reading), not its highest rating. Ties on effort → higher rating.
      const best = new Map<string, RatingRow>()
      for (const r of list) {
        const cur = best.get(r.model_name)
        const e = EFFORT_ORDER.indexOf(r.effort ?? ''), ce = cur ? EFFORT_ORDER.indexOf(cur.effort ?? '') : -1
        if (!cur || e > ce || (e === ce && r.rating > cur.rating)) best.set(r.model_name, r)
      }
      list = list.filter(r => best.get(r.model_name) === r)
    }
    const dir = sortDir === 'asc' ? 1 : -1
    const entryOf = (r: RatingRow) => perEntry.get(`${r.model_name}|${r.effort ?? ''}`)
    const val = (r: RatingRow): string | number => {
      switch (sortBy) {
        case 'model': return (entryOf(r)?.display ?? r.model_name).toLowerCase()
        case 'effort': return EFFORT_ORDER.indexOf(r.effort ?? '')
        case 'rating': return r.rating
        case 'wins': return r.wins
        case 'cost': return avg(entryOf(r)?.costs ?? []) ?? Number.MAX_VALUE
        case 'time': return avg(entryOf(r)?.times ?? []) ?? Number.MAX_VALUE
      }
    }
    return list.sort((a, b) => {
      const va = val(a), vb = val(b)
      return (va < vb ? -1 : va > vb ? 1 : 0) * dir
    })
  }, [filtered, view, sortBy, sortDir, perEntry])
  const shown = useMemo(() => (showAll ? visible : visible.slice(0, TOP_N)), [visible, showAll])

  // Brand casing for provider chips (slugs are lowercase in the DB).
  const PROVIDER_LABEL: Record<string, string> = { openai: 'OpenAI', xai: 'xAI', google: 'Google', anthropic: 'Anthropic', moonshot: 'Moonshot', alibaba: 'Alibaba', minimax: 'MiniMax', runway: 'Runway' }
  const FilterGroup = ({ label, items, sel, setter, cap, swatch }: { label: string; items: string[]; sel: Set<string>; setter: (s: Set<string>) => void; cap?: boolean; swatch?: (item: string) => React.ReactNode }) => (
    items.length > 1 ? (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.1em', marginRight: 2 }}>{label.toUpperCase()}</span>
        {items.map(it => {
          const on = sel.size === 0 || sel.has(it)
          return (
            <button key={it} onClick={() => flip(sel, setter, it)} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '3px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font-mono)',
              border: `1px solid ${sel.has(it) ? 'var(--red)' : 'var(--border)'}`,
              background: sel.has(it) ? 'var(--red-dim)' : 'transparent',
              color: on ? (sel.has(it) ? 'var(--red)' : 'var(--white)') : 'var(--muted)',
              opacity: on ? 1 : 0.55,
            }}>{swatch?.(it)}{(cap ? PROVIDER_LABEL[it] ?? it : it) || '—'}</button>
          )
        })}
      </div>
    ) : null
  )

  function SortHeader({ label, k, align = 'left' }: { label: string; k: SortKey; align?: 'left' | 'right' }) {
    const isActive = sortBy === k
    return (
      <th style={{ padding: '8px 12px', textAlign: align }}>
        <button
          onClick={() => onSort(k)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
            fontFamily: 'inherit', fontSize: 'inherit', letterSpacing: 'inherit',
            color: isActive ? 'var(--white)' : 'var(--muted)', transition: 'color 0.12s',
          }}
        >
          <span>{label}</span>
          <span style={{ fontSize: 8, opacity: isActive ? 1 : 0.3, color: isActive ? 'var(--green)' : 'inherit' }}>
            {isActive ? (sortDir === 'asc' ? '▲' : '▼') : '▲'}
          </span>
        </button>
      </th>
    )
  }

  // XBoard's five-tier heatmap buckets — one house language for "how good".
  const tier = (x: number) => (x < 950 ? 'poor' : x < 1000 ? 'fair' : x < 1050 ? 'mid' : x < 1100 ? 'good' : 'elite')
  const judgeCount = ((ratings[0]?.judge_filter ?? '').match(/panel\((\d+)/)?.[1]) ?? '1'
  const updated = ratings[0]?.ts?.slice(0, 10) ?? ''

  return (
    <div className="xduel-page">
      <div className="arena">
        {/* In-page header — XBoard's pattern: eyebrow + big headline + method link. */}
        <Link href="/xeval" className="prompt-label eyebrow" style={{ textDecoration: 'none', display: 'inline-block' }}>{t('xeval.eyebrow')}</Link>
        <h1 className="page-headline">
          {t('xeval.subtitle')}
          <a href="#xeval-methodology" style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 12, color: 'var(--red)', letterSpacing: '0.08em', textDecoration: 'none', marginLeft: 14, whiteSpace: 'nowrap' }}>
            {t('xeval.how').toUpperCase()} →
          </a>
        </h1>

      {loading ? (
        <p style={{ color: 'var(--muted)' }}>…</p>
      ) : ratings.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>{t('xeval.empty')}</p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', margin: '0 0 20px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)' }}>
            <span><strong style={{ color: 'var(--white)' }}>{ratings.length}</strong> {t('xeval.stat.entries')}</span>
            <span><strong style={{ color: 'var(--white)' }}>{taskCount}</strong> {t('xeval.stat.tasks')}</span>
            <span><strong style={{ color: 'var(--white)' }}>{judgeCount}</strong> {t('xeval.stat.judges')}</span>
            <span><strong style={{ color: 'var(--white)' }}>{verdicts}</strong> {t('xeval.stat.verdicts')}</span>
            {updated && <span>{t('xeval.stat.updated')} {updated}</span>}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
            <FilterGroup label={t('xeval.filter.provider')} items={allProviders} sel={selProv} setter={setSelProv} cap
              swatch={pv => <svg width={12} height={12} viewBox="0 0 14 14"><Mark shape={shapeOf(pv)} cx={7} cy={7} r={4.2} fill="currentColor" /></svg>} />
            <FilterGroup label={t('xeval.filter.effort')} items={allEfforts} sel={selEffort} setter={setSelEffort}
              swatch={ef => <span style={{ width: 9, height: 9, borderRadius: '50%', background: colorOf(ef), display: 'inline-block' }} />} />
            <FilterGroup label={t('xeval.filter.family')} items={allFamilies} sel={selFamily} setter={setSelFamily} />
          </div>

          <FrontierChart rows={shown} domainRows={ratings} perEntry={perEntry} avg={avg} />

          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {(['all', 'best'] as const).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                style={{
                  padding: '6px 14px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                  fontFamily: 'var(--font-mono)', letterSpacing: '0.04em',
                  border: `1px solid ${view === v ? 'var(--red)' : 'var(--border)'}`,
                  background: view === v ? 'var(--red-dim)' : 'transparent',
                  color: view === v ? 'var(--red)' : 'var(--muted)',
                }}
              >
                {t(v === 'all' ? 'xeval.filter.all' : 'xeval.filter.best')}
              </button>
            ))}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '8px 12px' }}>#</th>
                  <SortHeader label={t('xeval.col.model')} k="model" />
                  <SortHeader label={t('xeval.col.effort')} k="effort" />
                  <SortHeader label={t('xeval.col.rating')} k="rating" align="right" />
                  <SortHeader label="W / G" k="wins" align="right" />
                  <SortHeader label={t('xeval.col.cost')} k="cost" align="right" />
                  <SortHeader label={t('xeval.col.time')} k="time" align="right" />
                </tr>
              </thead>
              <tbody>
                {shown.map((row, i) => {
                    const e = perEntry.get(`${row.model_name}|${row.effort ?? ''}`)
                    const cost = e ? avg(e.costs) : null
                    const time = e ? avg(e.times) : null
                    return (
                      <tr key={row.entry} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '8px 12px', color: 'var(--muted)' }}>{i + 1}</td>
                        <td style={{ padding: '8px 12px' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                            {e && <ProviderLogo provider={e.provider} size={16} />}
                            {e?.display ?? row.model_name}
                          </span>
                        </td>
                        <td style={{ padding: '8px 12px', color: 'var(--muted)' }}>{row.effort ?? '—'}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                          <span className={`xd-chip ${tier(row.rating)}`}>{row.rating}</span>
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--muted)' }}>
                          {row.wins} / {row.games}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                          {cost != null ? `$${cost.toFixed(3)}` : '—'}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--muted)' }}>
                          {time != null ? `${Math.round(time)}s` : '—'}
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
            {visible.length > TOP_N && (
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: 10 }}>
                <button onClick={() => setShowAll(s => !s)} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, padding: '4px 12px', border: '1px solid var(--border)', borderRadius: 6, background: 'transparent', color: 'var(--muted2)', cursor: 'pointer' }}>
                  {showAll ? t('xeval.showtop').replace('{n}', String(TOP_N)) : t('xeval.showall').replace('{n}', String(visible.length))}
                </button>
              </div>
            )}
          </div>

          {/* Methodology — the disclosure IS the differentiator. */}
          <section id="xeval-methodology" style={{ marginTop: 32, padding: 16, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, color: 'var(--muted)', lineHeight: 1.7 }}>
            <strong style={{ color: 'var(--white)' }}>{t('xeval.method.title')}</strong>
            <p style={{ margin: '8px 0 0' }}>
              {t('xeval.method.body')
                .replace('{tasks}', String(taskCount))
                .replace('{judge}', judge)}
            </p>
          </section>
        </>
      )}
      </div>
    </div>
  )
}

/** Cost-vs-rating frontier — price on a log axis, rating linear, one
 *  labeled mark per entry. Encoding: COLOR = provider, SHAPE = effort, so
 *  the legend is just those two keys; hiding/showing is the page filters'
 *  job. Hovering an entry lifts it to the top layer (SVG z-order = render
 *  order), enlarges it, and dims the rest. Inline SVG, no deps. */
// Encoding (owner, Aug 21): SHAPE = provider, COLOR = effort. Effort colors
// run cool → warm so "more thinking" reads hotter at a glance.
const PROVIDER_SHAPE: Record<string, string> = {
  anthropic: 'circle', openai: 'square', google: 'diamond', xai: 'triangle', moonshot: 'star', alibaba: 'hexagon', minimax: 'cross',
}
const EFFORT_COLOR: Record<string, string> = {
  none: '#888780', minimal: '#5b9bd5', low: '#2a78d6', medium: '#1baf7a', high: '#eda100', xhigh: '#eb6834', max: '#d03b3b',
}
const shapeOf = (prov: string) => PROVIDER_SHAPE[prov] ?? 'circle'
const colorOf = (effort: string) => EFFORT_COLOR[effort] ?? 'var(--red)'

function Mark({ shape, cx, cy, r, fill }: { shape: string; cx: number; cy: number; r: number; fill: string }) {
  const common = { fill, stroke: 'var(--bg)', strokeWidth: 1.5 }
  switch (shape) {
    case 'square':   return <rect x={cx - r} y={cy - r} width={2 * r} height={2 * r} {...common} />
    case 'diamond':  return <polygon points={`${cx},${cy - r * 1.2} ${cx + r * 1.2},${cy} ${cx},${cy + r * 1.2} ${cx - r * 1.2},${cy}`} {...common} />
    case 'triangle': return <polygon points={`${cx},${cy - r * 1.25} ${cx + r * 1.15},${cy + r * 0.9} ${cx - r * 1.15},${cy + r * 0.9}`} {...common} />
    case 'star': {
      const pts = Array.from({ length: 10 }, (_, i) => {
        const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.55 : r * 1.3
        return `${cx + rr * Math.cos(a)},${cy + rr * Math.sin(a)}`
      }).join(' ')
      return <polygon points={pts} {...common} />
    }
    case 'hexagon': {
      const pts = Array.from({ length: 6 }, (_, i) => {
        const a = -Math.PI / 2 + (i * Math.PI) / 3, rr = r * 1.15
        return `${cx + rr * Math.cos(a)},${cy + rr * Math.sin(a)}`
      }).join(' ')
      return <polygon points={pts} {...common} />
    }
    case 'cross': {
      const w = r * 0.45, R = r * 1.2
      return <polygon points={`${cx - w},${cy - R} ${cx + w},${cy - R} ${cx + w},${cy - w} ${cx + R},${cy - w} ${cx + R},${cy + w} ${cx + w},${cy + w} ${cx + w},${cy + R} ${cx - w},${cy + R} ${cx - w},${cy + w} ${cx - R},${cy + w} ${cx - R},${cy - w} ${cx - w},${cy - w}`} {...common} />
    }
    default:         return <circle cx={cx} cy={cy} r={r} {...common} />
  }
}

function FrontierChart({ rows, domainRows, perEntry, avg }: {
  rows: { model_name: string; effort: string | null; rating: number }[]
  domainRows: { model_name: string; effort: string | null; rating: number }[]
  perEntry: Map<string, { display: string; provider: string; costs: number[]; times: number[] }>
  avg: (xs: number[]) => number | null
}) {
  const t = useT()
  const [hover, setHover] = useState<string | null>(null)
  // Visible window in data units (x = avg $/task, linear; y = rating).
  // null = fit everything. Zoom (buttons / wheel around the cursor) and
  // pan (drag / trackpad scroll) move this window on BOTH axes; data,
  // colors and labels are untouched.
  type Win = { x0: number; x1: number; y0: number; y1: number }
  const [win, setWin] = useState<Win | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const drag = useRef<{ startX: number; startY: number; w: Win } | null>(null)

  const toPts = (src: { model_name: string; effort: string | null; rating: number }[]) => src
    .map(r => {
      const e = perEntry.get(`${r.model_name}|${r.effort ?? ''}`)
      const c = e ? avg(e.costs) : null
      return c != null && c > 0
        ? { x: c, y: r.rating, label: `${e!.display} @ ${r.effort ?? ''}`, provider: e!.provider, effort: r.effort ?? '' }
        : null
    })
    .filter(Boolean) as { x: number; y: number; label: string; provider: string; effort: string }[]
  const pts = toPts(rows)
  const domain = toPts(domainRows)

  const W = 940, H = 260, PL = 46, PR = 16, PT = 14, PB = 30
  const PW = W - PL - PR, PH = H - PT - PB
  const xmax = domain.length ? Math.max(...domain.map(p => p.x)) : 1
  const ys = domain.length ? domain.map(p => p.y) : [1000]
  const full: Win = { x0: 0, x1: xmax * 1.12, y0: Math.min(...ys) - 40, y1: Math.max(...ys) + 40 }
  const view = win ?? full
  const minX = (full.x1 - full.x0) / 200, minY = (full.y1 - full.y0) / 50
  const clampWin = (w: Win): Win => {
    const sx = Math.max(minX, Math.min(full.x1 - full.x0, w.x1 - w.x0))
    const sy = Math.max(minY, Math.min(full.y1 - full.y0, w.y1 - w.y0))
    const x0 = Math.max(full.x0, Math.min(w.x0, full.x1 - sx))
    const y0 = Math.max(full.y0, Math.min(w.y0, full.y1 - sy))
    return { x0, x1: x0 + sx, y0, y1: y0 + sy }
  }
  const isFull = (w: Win) => w.x1 - w.x0 >= full.x1 - full.x0 - 1e-9 && w.y1 - w.y0 >= full.y1 - full.y0 - 1e-9
  const commit = (w: Win) => { const c = clampWin(w); setWin(isFull(c) ? null : c) }
  const zoomAt = (factor: number, fx?: number, fy?: number) => {
    const cx = fx ?? (view.x0 + view.x1) / 2, cy = fy ?? (view.y0 + view.y1) / 2
    const sx = (view.x1 - view.x0) * factor, sy = (view.y1 - view.y0) * factor
    const rx = (cx - view.x0) / (view.x1 - view.x0), ry = (cy - view.y0) / (view.y1 - view.y0)
    commit({ x0: cx - sx * rx, x1: cx - sx * rx + sx, y0: cy - sy * ry, y1: cy - sy * ry + sy })
  }
  const panBy = (dx: number, dy: number) => commit({ x0: view.x0 + dx, x1: view.x1 + dx, y0: view.y0 + dy, y1: view.y1 + dy })
  const dataAt = (clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect()
    const px = ((clientX - rect.left) / rect.width) * W, py = ((clientY - rect.top) / rect.height) * H
    return { x: view.x0 + ((px - PL) / PW) * (view.x1 - view.x0), y: view.y0 + ((H - PB - py) / PH) * (view.y1 - view.y0) }
  }
  // Wheel must be non-passive so the page doesn't scroll under the chart.
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault()
      if (Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) panBy((ev.deltaX / PW) * (view.x1 - view.x0), 0)
      else { const f = dataAt(ev.clientX, ev.clientY); zoomAt(ev.deltaY > 0 ? 1.25 : 0.8, f.x, f.y) }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })
  if (domain.length === 0) return null

  const X = (c: number) => PL + ((c - view.x0) / (view.x1 - view.x0)) * PW
  const Y = (v: number) => H - PB - ((v - view.y0) / (view.y1 - view.y0)) * PH
  const niceStep = (span: number, n: number) => {
    const raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw)))
    return [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) ?? mag * 10
  }
  const ticks = (a: number, b: number, step: number) => {
    const out: number[] = []
    for (let v = Math.ceil(a / step - 1e-9) * step; v <= b + 1e-9; v += step) out.push(+v.toFixed(6))
    return out
  }
  const xstep = niceStep(view.x1 - view.x0, 6), ystep = niceStep(view.y1 - view.y0, 5)
  const xticks = ticks(view.x0, view.x1, xstep), yticks = ticks(view.y0, view.y1, ystep)
  const fmt = (v: number) => '$' + (v >= 1 ? v.toFixed(v >= 10 ? 0 : 1) : v.toFixed(xstep < 0.01 ? 3 : 2))
  const visible = pts.filter(p => p.x >= view.x0 && p.x <= view.x1 && p.y >= view.y0 && p.y <= view.y1)
  const ordered = [...visible.filter(p => p.label !== hover), ...visible.filter(p => p.label === hover)]
  const zoomed = win != null
  const btn: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 11, padding: '2px 8px', border: '1px solid var(--border)', borderRadius: 5, background: 'transparent', color: 'var(--muted2)', cursor: 'pointer' }

  return (
    <div style={{ margin: '0 0 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', letterSpacing: '0.06em' }}>{t('xeval.chart.title')}</span>
        <span style={{ flex: 1 }} />
        {/* fixed-width readout so the buttons never move when the range text changes length */}
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', minWidth: 250, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
          {fmt(view.x0)} – {fmt(view.x1)} · {Math.round(view.y0)} – {Math.round(view.y1)} · {visible.length}/{pts.length}
        </span>
        <button style={{ ...btn, minWidth: 28 }} onClick={() => zoomAt(0.6)} title="zoom in">+</button>
        <button style={{ ...btn, minWidth: 28 }} onClick={() => zoomAt(1.6)} title="zoom out">−</button>
        <button style={{ ...btn, opacity: zoomed ? 1 : 0.45, minWidth: 58 }} onClick={() => setWin(null)} disabled={!zoomed}>{t('xeval.chart.reset')}</button>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <svg ref={svgRef} width="100%" viewBox={`0 0 ${W} ${H}`} style={{ minWidth: 640, display: 'block', cursor: drag.current ? 'grabbing' : 'grab', userSelect: 'none' }}
             onMouseLeave={() => { setHover(null); drag.current = null }}
             onMouseDown={ev => { drag.current = { startX: ev.clientX, startY: ev.clientY, w: view } }}
             onMouseUp={() => { drag.current = null }}
             onMouseMove={ev => {
               const d = drag.current
               if (!d || !svgRef.current) return
               const rect = svgRef.current.getBoundingClientRect()
               const dx = ((ev.clientX - d.startX) / rect.width) * W / PW * (d.w.x1 - d.w.x0)
               const dy = ((ev.clientY - d.startY) / rect.height) * H / PH * (d.w.y1 - d.w.y0)
               commit({ x0: d.w.x0 - dx, x1: d.w.x1 - dx, y0: d.w.y0 + dy, y1: d.w.y1 + dy })
             }}>
          <defs><clipPath id="xeval-plot"><rect x={PL} y={PT} width={PW} height={PH} /></clipPath></defs>
          {xticks.map(v => (
            <g key={'x' + v}>
              <line x1={X(v)} y1={PT} x2={X(v)} y2={H - PB} stroke="var(--border)" strokeWidth={1} />
              <text x={X(v)} y={H - 10} textAnchor="middle" fontSize={10} fill="var(--muted)" fontFamily="var(--font-mono)">{fmt(v)}</text>
            </g>
          ))}
          {yticks.map(v => (
            <g key={'y' + v}>
              <line x1={PL} y1={Y(v)} x2={W - PR} y2={Y(v)} stroke="var(--border)" strokeWidth={1} />
              <text x={PL - 6} y={Y(v) + 3} textAnchor="end" fontSize={10} fill="var(--muted)" fontFamily="var(--font-mono)">{Math.round(v)}</text>
            </g>
          ))}
          <g clipPath="url(#xeval-plot)">
          {ordered.map(p => {
            const isHover = hover === p.label
            const dim = hover != null && !isHover
            const rightHalf = X(p.x) > W * 0.72
            return (
              <g key={p.label} opacity={dim ? 0.25 : 1} style={{ cursor: 'default', transition: 'opacity 0.12s' }}
                 onMouseEnter={() => setHover(p.label)} onMouseLeave={() => setHover(null)}>
                <Mark shape={shapeOf(p.provider)} cx={X(p.x)} cy={Y(p.y)} r={isHover ? 8 : 5.5} fill={colorOf(p.effort)} />
                <text
                  x={X(p.x) + (rightHalf ? -12 : 12)} y={Y(p.y) + 4}
                  textAnchor={rightHalf ? 'end' : 'start'}
                  fontSize={isHover ? 12 : 10.5} fontWeight={isHover ? 700 : 400}
                  fill={isHover ? 'var(--white)' : 'var(--muted2)'}
                  stroke="var(--bg)" strokeWidth={isHover ? 4 : 3} paintOrder="stroke"
                  fontFamily="var(--font-mono)"
                >
                  {p.label}{isHover ? `  ·  ${p.y}  ·  $${p.x.toFixed(3)}` : ''}
                </text>
              </g>
            )
          })}
          </g>
        </svg>
      </div>
    </div>
  )
}
