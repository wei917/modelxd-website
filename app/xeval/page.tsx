'use client'
// app/xeval/page.tsx
// XEval — published benchmark replication results. Separate from XBoard by
// design: XBoard is ModelXD's own signal (human blind votes on this
// platform); XEval is our independently-operated run of public benchmarks
// (pilot: OpenAI's GDPval gold tasks) with a fully disclosed judge protocol
// and (model, effort) as the unit — the effort/cost axis no other
// leaderboard publishes. Reads the xeval_* tables (migration 83), which the
// owner-triggered publish script fills from the local pilot store.

import { useEffect, useMemo, useState } from 'react'
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
  const judge = ratings[0]?.judge_filter ?? ''

  // View filter. 'best' collapses each model to its highest-rated effort —
  // a pure display filter: BT ratings are global, so hiding rows changes
  // nothing about the numbers shown.
  const [view, setView] = useState<'all' | 'best'>('all')

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
    const m = modelName
    let r: RegExpMatchArray | null
    if ((r = m.match(/^gpt-(\d+(?:\.\d+)?)/))) return `GPT-${r[1]}`
    if ((r = m.match(/^claude-[a-z]+-(\d+(?:\.\d+)?)/))) return `Claude ${r[1]}`
    if ((r = m.match(/^gemini-(\d+(?:\.\d+)?)/))) return `Gemini ${r[1]}`
    if ((r = m.match(/^grok-(\d+(?:\.\d+)?)/))) return `Grok ${r[1]}`
    if ((r = m.match(/^kimi-k(\d+)/))) return `Kimi K${r[1]}`
    if ((r = m.match(/^qwen(\d+(?:\.\d+)?)/))) return `Qwen ${r[1]}`
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
      const seen = new Set<string>()
      list = list.filter(r => (seen.has(r.model_name) ? false : (seen.add(r.model_name), true)))
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

  const FilterGroup = ({ label, items, sel, setter, cap }: { label: string; items: string[]; sel: Set<string>; setter: (s: Set<string>) => void; cap?: boolean }) => (
    items.length > 1 ? (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.1em', marginRight: 2 }}>{label.toUpperCase()}</span>
        {items.map(it => {
          const on = sel.size === 0 || sel.has(it)
          return (
            <button key={it} onClick={() => flip(sel, setter, it)} style={{
              padding: '3px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font-mono)',
              textTransform: cap ? 'capitalize' : 'none',
              border: `1px solid ${sel.has(it) ? 'var(--red)' : 'var(--border)'}`,
              background: sel.has(it) ? 'var(--red-dim)' : 'transparent',
              color: on ? (sel.has(it) ? 'var(--red)' : 'var(--white)') : 'var(--muted)',
              opacity: on ? 1 : 0.55,
            }}>{it || '—'}</button>
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
  const judgeCount = (judge.match(/panel\((\d+)/)?.[1]) ?? '1'
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
            <FilterGroup label={t('xeval.filter.provider')} items={allProviders} sel={selProv} setter={setSelProv} cap />
            <FilterGroup label={t('xeval.filter.effort')} items={allEfforts} sel={selEffort} setter={setSelEffort} />
            <FilterGroup label={t('xeval.filter.family')} items={allFamilies} sel={selFamily} setter={setSelFamily} />
          </div>

          <FrontierChart rows={visible} domainRows={ratings} perEntry={perEntry} avg={avg} />

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
                {visible.map((row, i) => {
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

/** Cost-vs-rating frontier — the page's signature: price on a log axis,
 *  rating on linear, one labeled dot per entry. Labels may crowd; hovering
 *  an entry lifts it to the top layer (SVG z-order = render order) and dims
 *  the rest. Legend chips toggle whole provider series; entry chips toggle
 *  single dots. Inline SVG, no deps. */
function FrontierChart({ rows, domainRows, perEntry, avg }: {
  rows: { model_name: string; effort: string | null; rating: number }[]
  domainRows: { model_name: string; effort: string | null; rating: number }[]
  perEntry: Map<string, { display: string; provider: string; costs: number[]; times: number[] }>
  avg: (xs: number[]) => number | null
}) {
  const t = useT()
  const [hover, setHover] = useState<string | null>(null)
  const [hiddenProv, setHiddenProv] = useState<Set<string>>(new Set())
  const [hiddenEntry, setHiddenEntry] = useState<Set<string>>(new Set())
  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, k: string) => {
    const n = new Set(set)
    n.has(k) ? n.delete(k) : n.add(k)
    setter(n)
  }

  const toPts = (src: { model_name: string; effort: string | null; rating: number }[]) => src
    .map(r => {
      const e = perEntry.get(`${r.model_name}|${r.effort ?? ''}`)
      const c = e ? avg(e.costs) : null
      return c != null && c > 0 ? { x: c, y: r.rating, label: `${e!.display} @ ${r.effort ?? ''}`, provider: e!.provider } : null
    })
    .filter(Boolean) as { x: number; y: number; label: string; provider: string }[]
  const all = toPts(rows)          // what the page filters let through
  const domain = toPts(domainRows) // everything — axes stay put while filtering
  if (domain.length === 0) return null

  const PROVIDER_COLOR: Record<string, string> = {
    openai: 'var(--provider-openai)', google: 'var(--provider-google)', anthropic: 'var(--provider-anthropic)',
    alibaba: 'var(--provider-alibaba)', xai: 'var(--provider-xai)', moonshot: '#6b4fbb', minimax: '#c2185b',
  }
  const colorOf = (prov: string) => PROVIDER_COLOR[prov] ?? 'var(--red)'
  const providers = [...new Set(all.map(p => p.provider))]
  const pts = all.filter(p => !hiddenProv.has(p.provider) && !hiddenEntry.has(p.label))
  const anyHidden = hiddenProv.size > 0 || hiddenEntry.size > 0

  // Axes fit the FULL dataset so neither page filters nor chart toggles rescale the picture.
  const W = 940, H = 260, PL = 46, PR = 16, PT = 14, PB = 30
  const lx = (c: number) => Math.log10(c)
  const xs = domain.map(p => lx(p.x)), ys = domain.map(p => p.y)
  const x0 = Math.min(...xs) - 0.15, x1 = Math.max(...xs) + 0.25
  const y0 = Math.min(...ys) - 40, y1 = Math.max(...ys) + 40
  const X = (c: number) => PL + ((lx(c) - x0) / (x1 - x0)) * (W - PL - PR)
  const Y = (v: number) => H - PB - ((v - y0) / (y1 - y0)) * (H - PT - PB)
  const xticks = [0.01, 0.03, 0.1, 0.3, 1, 3].filter(v => lx(v) >= x0 && lx(v) <= x1)
  // Hovered entry renders last = on top.
  const ordered = [...pts.filter(p => p.label !== hover), ...pts.filter(p => p.label === hover)]

  const chip = (active: boolean, color?: string): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
    border: `1px solid ${active ? (color ?? 'var(--border2)') : 'var(--border)'}`,
    color: active ? 'var(--white)' : 'var(--muted)', opacity: active ? 1 : 0.5,
    textDecoration: active ? 'none' : 'line-through', letterSpacing: 0, userSelect: 'none',
  })

  return (
    <div style={{ margin: '0 0 20px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', letterSpacing: '0.06em', marginBottom: 6 }}>
        <span>{t('xeval.chart.title')}</span>
        {providers.map(pv => (
          <span key={pv} onClick={() => toggle(hiddenProv, setHiddenProv, pv)} style={{ ...chip(!hiddenProv.has(pv), colorOf(pv)), textTransform: 'capitalize' }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: colorOf(pv), display: 'inline-block' }} />{pv}
          </span>
        ))}
        {anyHidden && (
          <span onClick={() => { setHiddenProv(new Set()); setHiddenEntry(new Set()) }} style={{ cursor: 'pointer', color: 'var(--red)', letterSpacing: '0.08em' }}>
            {t('xeval.chart.reset').toUpperCase()}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 11, marginBottom: 8 }}>
        {all.map(p => (
          <span
            key={p.label}
            onClick={() => toggle(hiddenEntry, setHiddenEntry, p.label)}
            onMouseEnter={() => setHover(p.label)}
            onMouseLeave={() => setHover(null)}
            style={chip(!hiddenEntry.has(p.label) && !hiddenProv.has(p.provider), colorOf(p.provider))}
          >
            {p.label}
          </span>
        ))}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ minWidth: 640, display: 'block' }} onMouseLeave={() => setHover(null)}>
          {xticks.map(v => (
            <g key={v}>
              <line x1={X(v)} y1={PT} x2={X(v)} y2={H - PB} stroke="var(--border)" strokeWidth={1} />
              <text x={X(v)} y={H - 10} textAnchor="middle" fontSize={10} fill="var(--muted)" fontFamily="var(--font-mono)">{'$' + v}</text>
            </g>
          ))}
          {[800, 900, 1000, 1100, 1200, 1300].filter(v => v > y0 && v < y1).map(v => (
            <g key={v}>
              <line x1={PL} y1={Y(v)} x2={W - PR} y2={Y(v)} stroke="var(--border)" strokeWidth={1} />
              <text x={PL - 6} y={Y(v) + 3} textAnchor="end" fontSize={10} fill="var(--muted)" fontFamily="var(--font-mono)">{v}</text>
            </g>
          ))}
          {ordered.map(p => {
            const isHover = hover === p.label
            const dim = hover != null && !isHover
            const rightHalf = X(p.x) > W * 0.72
            return (
              <g key={p.label} opacity={dim ? 0.25 : 1} style={{ cursor: 'pointer', transition: 'opacity 0.12s' }}
                 onMouseEnter={() => setHover(p.label)} onMouseLeave={() => setHover(null)}
                 onClick={() => toggle(hiddenEntry, setHiddenEntry, p.label)}>
                <circle cx={X(p.x)} cy={Y(p.y)} r={isHover ? 8 : 5.5} fill={colorOf(p.provider)} stroke="var(--bg)" strokeWidth={1.5} />
                <text
                  x={X(p.x) + (rightHalf ? -11 : 11)} y={Y(p.y) + 4}
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
        </svg>
      </div>
    </div>
  )
}
