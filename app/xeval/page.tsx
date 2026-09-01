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
  avg_cost_usd?: number | null
  avg_time_s?: number | null
  avg_spec_pct?: number | null
  params: string
}

interface RunRow {
  run_id: string
  task_id: string
  task_set?: string | null
  score?: number | null
  spec_pct?: number | null
  harness?: string | null
  occupation: string | null
  sector: string | null
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
        // No status filter: verifier benchmarks publish failed trials too (a
        // timeout IS the cell's result). GDPval aggregates stay finished-only
        // because only finished GDPval runs are published.
        .select('run_id, task_id, task_set, score, spec_pct, harness, sector, occupation, model_name, display_name, provider, effort, cost_usd, model_s, started_at')
      setRuns(rr ?? [])
      setLoading(false)
    })()
  }, [])

  // Multi-benchmark: GDPval (BT ladder) plus verifier-scored sets like
  // Terminal-Bench 2.1. Tabs come from the data, so a new benchmark appears
  // the moment its runs are published. Aggregates are scoped per benchmark —
  // TB costs must never blend into a GDPval entry's average.
  const BENCH_LABEL: Record<string, string> = { gdpval: 'GDPval', 'terminal-bench-2-1': 'Terminal-Bench 2.1', 'harvey-lab': 'Harvey LAB', 'text-rendering': 'Text Rendering' }
  const benches = useMemo(() => {
    const bs = [...new Set(runs.map(r => r.task_set ?? 'gdpval'))]
    return bs.sort((a, b) => (a === 'gdpval' ? -1 : b === 'gdpval' ? 1 : a.localeCompare(b)))
  }, [runs])
  const [bench, setBench] = useState('gdpval')
  // Shareable tab links: /xeval?b=lab. Short slugs, because 'terminal-bench-2-1'
  // is an internal task_set key and a URL should outlive our naming. The tab
  // must NOT initialise from the URL — SSR renders on every host and would
  // disagree with the client on first paint — so the URL is applied in an
  // effect, once, after the data that decides which tabs exist has arrived.
  const BENCH_SLUG: Record<string, string> = { gdpval: 'gdpval', 'terminal-bench-2-1': 'tb', 'harvey-lab': 'lab', 'text-rendering': 'text' }
  const urlApplied = useRef(false)
  useEffect(() => {
    if (urlApplied.current || !benches.length) return
    urlApplied.current = true
    const want = new URLSearchParams(window.location.search).get('b')
    if (!want) return
    // Accept the slug or the raw task_set; ignore anything not actually published.
    const hit = benches.find(b => BENCH_SLUG[b] === want || b === want)
    if (hit) setBench(hit)
  }, [benches])
  const pickBench = (b: string) => {
    setBench(b)
    const q = new URLSearchParams(window.location.search)
    b === 'gdpval' ? q.delete('b') : q.set('b', BENCH_SLUG[b] ?? b)
    const qs = q.toString()
    // replace, not push: three tabs should not bury the back button.
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname)
  }
  const gdpvalRuns = useMemo(() => runs.filter(r => (r.task_set ?? 'gdpval') === 'gdpval'), [runs])
  const tbRuns = useMemo(() => runs.filter(r => r.task_set === bench), [runs, bench])

  // Per-entry aggregates from the runs behind the ratings (GDPval only).
  const perEntry = useMemo(() => {
    const m = new Map<string, { display: string; provider: string; costs: number[]; times: number[]; specs: number[] }>()
    for (const r of gdpvalRuns) {
      const key = `${r.model_name}|${r.effort ?? ''}`
      if (!m.has(key)) m.set(key, { display: r.display_name, provider: r.provider, costs: [], times: [], specs: [] })
      const e = m.get(key)!
      if (r.cost_usd != null) e.costs.push(Number(r.cost_usd))
      if (r.model_s != null) e.times.push(Number(r.model_s))
      if (r.spec_pct != null) e.specs.push(Number(r.spec_pct))
    }
    return m
  }, [gdpvalRuns])

  const taskCount = useMemo(() => new Set(gdpvalRuns.map(r => r.task_id)).size, [gdpvalRuns])
  // The lead line quotes the ladder itself — top entry and the human anchor —
  // so a republish updates the prose with the numbers.
  const topRow = useMemo(() => [...ratings].sort((a, b) => b.rating - a.rating)[0], [ratings])
  const anchorRow = useMemo(() => ratings.find(r => r.model_name === 'human-expert'), [ratings])
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
  // judge_filter is the fit's machine label, e.g. "panel(3 judges)@high+rules+tasks:enabled".
  // Render the panel form as prose; anything else falls back to the raw label.
  const judge = useMemo(() => {
    const raw = ratings[0]?.judge_filter ?? ''
    const m = raw.match(/^panel\((\d+) judges?[^)]*\)@(\w+)/)
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
  type SortKey = 'model' | 'effort' | 'rating' | 'spec' | 'cost' | 'time'
  const [sortBy, setSortBy] = useState<SortKey>('rating')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const onSort = (k: SortKey) => {
    if (k === sortBy) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortBy(k)
      setSortDir(k === 'rating' || k === 'spec' ? 'desc' : 'asc')
    }
  }
  const EFFORT_ORDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

  // Page-level filters (provider / effort / tier) drive BOTH the chart and
  // the table. Empty selection = no filter. TIER is the official vocabulary
  // (owner check, Aug 25): OpenAI — "the number identifies a model's
  // generation, while Sol, Terra, and Luna identify durable capability
  // tiers"; Anthropic uses "Opus-tier" the same way. One level everywhere:
  // Sol/Terra/Luna ↔ Opus/Sonnet/Fable ↔ Flash; single-line vendors keep
  // their line name. Derived by pattern — ai_models has no tier column.
  const tierOf = (modelName: string, display: string): string => {
    const m = modelName
    let r: RegExpMatchArray | null
    if (m === 'modelxd-router') return 'ModelXD'
    if (m === 'human-expert') return 'Human'
    if ((r = m.match(/^claude-(opus|sonnet|fable|haiku)/))) return `${r[1][0].toUpperCase()}${r[1].slice(1)}`
    if ((r = m.match(/^gpt-[\d.]+-(sol|luna|terra)/))) return `${r[1][0].toUpperCase()}${r[1].slice(1)}`
    if (/^gemini-.*flash-lite/.test(m)) return 'Flash-Lite'
    if (/^gemini-.*flash/.test(m)) return 'Flash'
    if (/^gemini-.*pro/.test(m)) return 'Pro'
    if (/^grok-/.test(m)) return 'Grok'
    if (/^kimi-/.test(m)) return 'Kimi'
    if ((r = m.match(/^qwen[\d.]*-(max|plus|flash|turbo)/))) return `Qwen ${r[1][0].toUpperCase()}${r[1].slice(1)}`
    return display.split(' ')[0]
  }
  const [selProv, setSelProv] = useState<Set<string>>(new Set())
  const [selEffort, setSelEffort] = useState<Set<string>>(new Set())
  const [selTier, setSelTier] = useState<Set<string>>(new Set())
  const flip = (set: Set<string>, setter: (s: Set<string>) => void, k: string) => {
    const n = new Set(set); n.has(k) ? n.delete(k) : n.add(k); setter(n)
  }
  const provOf = (r: RatingRow) => r.model_name === 'modelxd-router' ? 'modelxd' : (perEntry.get(`${r.model_name}|${r.effort ?? ''}`)?.provider ?? '')
  const tierChip = (r: RatingRow) => tierOf(r.model_name, perEntry.get(`${r.model_name}|${r.effort ?? ''}`)?.display ?? r.model_name)
  const allProviders = useMemo(() => [...new Set(ratings.map(provOf).filter(Boolean))].sort(), [ratings, perEntry])
  const allEfforts = useMemo(() => [...new Set(ratings.map(r => r.effort ?? ''))].sort((a, b) => EFFORT_ORDER.indexOf(a) - EFFORT_ORDER.indexOf(b)), [ratings])
  const allTiers = useMemo(() => [...new Set(ratings.map(tierChip))].sort(), [ratings, perEntry])
  const filtered = useMemo(() => ratings.filter(r =>
    (selProv.size === 0 || selProv.has(provOf(r))) &&
    (selEffort.size === 0 || selEffort.has(r.effort ?? '')) &&
    (selTier.size === 0 || selTier.has(tierChip(r)))
  ), [ratings, selProv, selEffort, selTier, perEntry])

  const visible = useMemo(() => {
    let list = [...ratings].sort((a, b) => b.rating - a.rating)
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
        case 'spec': return avg(entryOf(r)?.specs ?? []) ?? -1
        case 'cost': return avg(entryOf(r)?.costs ?? []) ?? Number.MAX_VALUE
        case 'time': return avg(entryOf(r)?.times ?? []) ?? Number.MAX_VALUE
      }
    }
    return list.sort((a, b) => {
      const va = val(a), vb = val(b)
      return (va < vb ? -1 : va > vb ? 1 : 0) * dir
    })
  }, [ratings, view, sortBy, sortDir, perEntry])
  const shown = useMemo(() => (showAll ? visible : visible.slice(0, TOP_N)), [visible, showAll])

  // Brand casing for provider chips (slugs are lowercase in the DB).
  const PROVIDER_LABEL: Record<string, string> = { openai: 'OpenAI', xai: 'xAI', google: 'Google', anthropic: 'Anthropic', moonshot: 'Moonshot', alibaba: 'Alibaba', minimax: 'MiniMax', runway: 'Runway', modelxd: 'ModelXD' }
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
  // Heatmap buckets are RELATIVE to this fit's own spread. The ladder is
  // anchored (1000 = the human professional), so every model sits in the
  // 1100-2000 band and the old absolute cutoffs painted the whole table
  // 'elite'. Quintiles of the live range keep the five-tier house language
  // meaningful whatever the scale.
  const band = useMemo(() => {
    const rs = ratings.map(r => r.rating)
    return rs.length ? { lo: Math.min(...rs), hi: Math.max(...rs) } : { lo: 0, hi: 1 }
  }, [ratings])
  const tier = (x: number) => {
    const t = (x - band.lo) / Math.max(1, band.hi - band.lo)
    return t < 0.2 ? 'poor' : t < 0.4 ? 'fair' : t < 0.6 ? 'mid' : t < 0.8 ? 'good' : 'elite'
  }
  const judgeCount = ((ratings[0]?.judge_filter ?? '').match(/panel\((\d+)/)?.[1]) ?? '1'
  const updated = ratings[0]?.ts?.slice(0, 10) ?? ''

  return (
    <div className="xduel-page">
      <div className="arena">
        {/* In-page header — XBoard's pattern: eyebrow + big headline + method link. */}
        <Link href="/xeval" className="prompt-label eyebrow" style={{ textDecoration: 'none', display: 'inline-block' }}>{t('xeval.eyebrow')}</Link>
        <h1 className="page-headline" style={{ marginBottom: 10 }}>{t('xeval.subtitle')}</h1>
        <a href="#xeval-methodology" style={{ display: 'inline-block', fontFamily: 'var(--font-mono), monospace', fontSize: 11.5, color: 'var(--red)', letterSpacing: '0.08em', textDecoration: 'none', marginBottom: 30, whiteSpace: 'nowrap' }}>
          {t('xeval.how').toUpperCase()} →
        </a>

      {loading ? (
        <p style={{ color: 'var(--muted)' }}>…</p>
      ) : ratings.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>{t('xeval.empty')}</p>
      ) : (
        <>
          {benches.length > 1 && (
            <div style={{ margin: '0 0 26px' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.14em', marginBottom: 10 }}>
                {t('xeval.bench').toUpperCase()}
              </div>
              <div style={{ display: 'flex', gap: 0, flexWrap: 'wrap', borderBottom: '1px solid var(--border)' }}>
                {benches.map(b => {
                  const on = bench === b
                  return (
                    <button key={b} onClick={() => pickBench(b)} style={{
                      padding: '10px 20px 12px', fontSize: 13.5, cursor: 'pointer',
                      fontFamily: 'var(--font-body)', fontWeight: on ? 600 : 400,
                      border: 'none', background: 'transparent',
                      color: on ? 'var(--white)' : 'var(--muted)',
                      borderBottom: `2px solid ${on ? 'var(--red)' : 'transparent'}`,
                      marginBottom: -1, transition: 'color 0.12s',
                    }}>{BENCH_LABEL[b] ?? b}</button>
                  )
                })}
              </div>
            </div>
          )}
          {bench !== 'gdpval' ? (
            <TBSection runs={tbRuns} label={BENCH_LABEL[bench] ?? bench} />
          ) : (
          <>
          <p style={{ fontSize: 14.5, color: 'var(--muted2)', lineHeight: 1.7, maxWidth: 760, margin: '0 0 22px' }}>
            {t('xeval.lead.gdpval')
              .replace('{top}', topRow ? (perEntry.get(`${topRow.model_name}|${topRow.effort ?? ''}`)?.display ?? SPECIAL_DISPLAY[topRow.model_name] ?? topRow.model_name) : '')
              .replace('{rating}', String(topRow?.rating ?? ''))
              .replace('{anchor}', String(anchorRow?.rating ?? 1000))}
          </p>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', margin: '0 0 24px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)' }}>
            <span><strong style={{ color: 'var(--white)' }}>{ratings.length}</strong> {t('xeval.stat.entries')}</span>
            <span><strong style={{ color: 'var(--white)' }}>{taskCount}</strong> {t('xeval.stat.tasks')}</span>
            <span><strong style={{ color: 'var(--white)' }}>{judgeCount}</strong> {t('xeval.stat.judges')}</span>
            <span><strong style={{ color: 'var(--white)' }}>{verdicts}</strong> {t('xeval.stat.verdicts')}</span>
            {updated && <span>{t('xeval.stat.updated')} {updated}</span>}
          </div>

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
                  <SortHeader label={t('xeval.col.spec')} k="spec" align="right" />
                  <SortHeader label={t('xeval.col.cost')} k="cost" align="right" />
                  <SortHeader label={t('xeval.col.time')} k="time" align="right" />
                </tr>
              </thead>
              <tbody>
                {shown.map((row, i) => {
                    const e = perEntry.get(`${row.model_name}|${row.effort ?? ''}`)
                    const cost = (e ? avg(e.costs) : null) ?? row.avg_cost_usd ?? null
                    const spec = (e && e.specs.length ? avg(e.specs) : null) ?? row.avg_spec_pct ?? null
                    const time = (e ? avg(e.times) : null) ?? row.avg_time_s ?? null
                    return (
                      <tr key={row.entry} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '8px 12px', color: 'var(--muted)' }}>{i + 1}</td>
                        <td style={{ padding: '8px 12px' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                            <ProviderLogo provider={e?.provider ?? (row.model_name === 'modelxd-router' ? 'modelxd' : null)} size={row.model_name === 'modelxd-router' ? 22 : 16} />
                            {e?.display ?? SPECIAL_DISPLAY[row.model_name] ?? row.model_name}
                          </span>
                        </td>
                        <td style={{ padding: '8px 12px', color: 'var(--muted)' }}>{row.effort ?? '—'}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                          <span className={`xd-chip ${tier(row.rating)}`} title={`${row.wins}W / ${row.games - row.wins}L of ${row.games} verdicts`}>{row.rating}</span>
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--muted)' }} title={t('xeval.col.spec.tip')}>
                          {spec != null ? `${Math.round(spec * 100)}%` : '—'}
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


          {/* Chart under the table: the ranking is the answer, the
              cost-vs-rating frontier is the explanation. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
            <FilterGroup label={t('xeval.filter.provider')} items={allProviders} sel={selProv} setter={setSelProv} cap
              swatch={pv => <svg width={15} height={15} viewBox="0 0 14 14"><Mark shape={shapeOf(pv)} cx={7} cy={7} r={5.2} fill="currentColor" /></svg>} />
            <FilterGroup label={t('xeval.filter.effort')} items={allEfforts} sel={selEffort} setter={setSelEffort}
              swatch={ef => <span style={{ width: 9, height: 9, borderRadius: '50%', background: colorOf(ef), display: 'inline-block' }} />} />
            <FilterGroup label={t('xeval.filter.tier')} items={allTiers} sel={selTier} setter={setSelTier} />
          </div>

          <FrontierChart rows={filtered} domainRows={ratings} perEntry={perEntry} avg={avg} />

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
        </>
      )}
      </div>
    </div>
  )
}

/** Verifier-scored benchmark section (Terminal-Bench 2.1 …): pass rate and
 *  $/solved per (model × effort) — the tasks' own tests decide, no judges.
 *  Latest finished run per (task, entry) counts, mirroring the ladder rule. */
function TBSection({ runs, label }: { runs: RunRow[]; label: string }) {
  const t = useT()
  const latest = new Map<string, RunRow>()
  for (const r of [...runs].sort((a, b) => String((a as any).started_at ?? '').localeCompare(String((b as any).started_at ?? '')))) {
    latest.set(`${r.task_id}|${r.model_name}|${r.effort ?? ''}`, r)
  }
  const by = new Map<string, { display: string; provider: string; effort: string; n: number; solved: number; cost: number; secs: number[]; scoreSum: number; specs: number[] }>()
  for (const r of latest.values()) {
    const k = `${r.model_name}|${r.effort ?? ''}`
    if (!by.has(k)) by.set(k, { display: r.display_name, provider: r.provider, effort: r.effort ?? '', n: 0, solved: 0, cost: 0, secs: [], scoreSum: 0, specs: [] as number[] })
    const e = by.get(k)!
    e.n += 1
    e.solved += (r.score ?? 0) >= 1 ? 1 : 0
    e.scoreSum += r.score ?? 0
    if (r.spec_pct != null) e.specs.push(Number(r.spec_pct))
    e.cost += r.cost_usd ?? 0
    if (r.model_s != null) e.secs.push(Number(r.model_s))
  }
  const rows = [...by.values()].sort((a, b) => b.scoreSum / b.n - a.scoreSum / a.n || a.cost - b.cost)
  const anyCost = rows.some(r => r.cost > 0)
  const anySpec = rows.some(r => r.specs.length > 0)
  // Pass rate is ABSOLUTE (unlike Elo, which is scale-relative), so these
  // cutoffs are fixed — normalising to the field painted the lowest of four
  // close entries 'poor' at 67%, which is a strong score on hard terminal
  // tasks. Calibrated to Terminal-Bench, where frontier agents land 50-70%.
  const rateTier = (x: number) =>
    x >= 0.8 ? 'elite' : x >= 0.7 ? 'good' : x >= 0.55 ? 'mid' : x >= 0.4 ? 'fair' : 'poor'
  const taskN = new Set([...latest.values()].map(r => r.task_id)).size
  // ModelXD Autopilot: the library serving each task's cheapest SOLVER
  // (cheapest attempt where nobody solves). Derived from the same runs —
  // a measured selection, disclosed in the methodology like the GDPval row.
  // The Autopilot row is a per-task SELECTION over completed runs, so it only
  // belongs where the owner approved it (GDPval, Terminal-Bench). Not on LAB:
  // serving the winner presupposes classifying an incoming task to a
  // benchmarked one, and the similarity test says we cannot do that yet
  // (nearest-neighbour winner transfer 30% vs a 52% baseline).
  // Category-best applies to every verifier/rubric benchmark, LAB included:
  // its tasks carry practice areas, so the rule is the same measurement as
  // GDPval's sectors. (Most LAB areas hold one task today — the methodology
  // says the strength depends on tasks per category.)
  if (by.size > 1) {
    const byTask = new Map<string, RunRow[]>()
    for (const r of latest.values()) {
      if (!byTask.has(r.task_id)) byTask.set(r.task_id, [])
      byTask.get(r.task_id)!.push(r)
    }
    // Autopilot is CATEGORY-BEST, the same rule as GDPval's sector row: for
    // each of the benchmark's own categories, measure every entry across that
    // category's tasks and serve the category's best (cheaper on ties). It is
    // a measurement of the category, not a prediction — so it is read on the
    // same tasks it is measured from, and the task count per category is what
    // makes it strong or weak.
    const byCat = new Map<string, RunRow[]>()
    for (const r of latest.values()) {
      const c = r.sector ?? r.task_id
      if (!byCat.has(c)) byCat.set(c, [])
      byCat.get(c)!.push(r)
    }
    const catPick = new Map<string, string>()
    for (const [c, runs_] of byCat) {
      const agg = new Map<string, { sum: number; n: number; cost: number }>()
      for (const r of runs_) {
        const k = `${r.model_name}|${r.effort ?? ''}`
        const a = agg.get(k) ?? { sum: 0, n: 0, cost: 0 }
        a.sum += r.score ?? 0; a.n += 1; a.cost += r.cost_usd ?? 0
        agg.set(k, a)
      }
      let best: [string, number, number] | null = null
      for (const [k, a] of agg) {
        const mean = a.sum / a.n
        if (!best || mean > best[1] || (mean === best[1] && a.cost < best[2])) best = [k, mean, a.cost]
      }
      if (best) catPick.set(c, best[0])
    }
    let apSolved = 0, apCost = 0, apScore = 0
    const apSpecs: number[] = []
    for (const runs_ of byTask.values()) {
      const cat = runs_[0].sector ?? runs_[0].task_id
      const want = catPick.get(cat)
      const pick = runs_.find(r => `${r.model_name}|${r.effort ?? ''}` === want) ?? runs_[0]
      if ((pick.score ?? 0) >= 1) apSolved += 1
      apScore += pick.score ?? 0
      apCost += pick.cost_usd ?? 0
      if (pick.spec_pct != null) apSpecs.push(Number(pick.spec_pct))
    }
    rows.unshift({ display: 'ModelXD Autopilot', provider: 'modelxd', effort: 'auto', n: byTask.size,
                   solved: apSolved, cost: apCost, secs: [], scoreSum: apScore, specs: apSpecs })
  }
  const harness = [...latest.values()].map(r => r.harness).find(Boolean) ?? 'terminus-2'
  const money = (v: number) => '$' + (v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toFixed(2))
  return (
    <>
      <p style={{ fontSize: 14.5, color: 'var(--muted2)', lineHeight: 1.7, maxWidth: 760, margin: '0 0 22px' }}>
        {(label === 'Harvey LAB' ? t('xeval.lead.lab') : label === 'Text Rendering' ? t('xeval.lead.textrender') : t('xeval.lead.tb'))
          .replace('{set}', label)
          .replace('{harness}', String(harness))
          .replace('{top}', rows[0]?.display ?? '')
          .replace('{pass}', rows[0]?.n ? `${Math.round((rows[0].solved / rows[0].n) * 100)}%` : '')
          .replace('{cost}', rows[0] ? money(rows[0].cost / rows[0].n) : '')}
      </p>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', margin: '0 0 24px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)' }}>
        <span><strong style={{ color: 'var(--white)' }}>{rows.length}</strong> {t('xeval.stat.entries')}</span>
        <span><strong style={{ color: 'var(--white)' }}>{taskN}</strong> {t('xeval.stat.tasks')}</span>
        <span>{t(label === 'Harvey LAB' ? 'xeval.lab.scored' : 'xeval.tb.verifier')}</span>
      </div>
      <div style={{ overflowX: 'auto', marginBottom: 24 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 640, fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border2)', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', textAlign: 'left' }}>
              <th style={{ padding: '8px 12px' }}>#</th>
              <th style={{ padding: '8px 12px' }}>{t('xeval.col.model')}</th>
              <th style={{ padding: '8px 12px' }}>{t('xeval.col.effort')}</th>
              <th style={{ padding: '8px 12px', textAlign: 'right' }}>{t('xeval.tb.passrate')}</th>
              {anySpec && <th style={{ padding: '8px 12px', textAlign: 'right' }}>{t('xeval.col.spec')}</th>}
              {anyCost && <th style={{ padding: '8px 12px', textAlign: 'right' }}>{t('xeval.col.cost')}</th>}
              {anyCost && <th style={{ padding: '8px 12px', textAlign: 'right' }}>{t('xeval.tb.persolved')}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.display + r.effort} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '8px 12px', color: 'var(--muted)' }}>{i + 1}</td>
                <td style={{ padding: '8px 12px' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <ProviderLogo provider={r.provider} size={r.provider === 'modelxd' ? 22 : 16} />{r.display}
                  </span>
                </td>
                <td style={{ padding: '8px 12px', color: 'var(--muted)' }}>{r.effort || '—'}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right' }} title={`${r.solved} of ${r.n} tasks fully passed`}>
                  <span className={`xd-chip ${rateTier(r.scoreSum / r.n)}`}>{Math.round((r.scoreSum / r.n) * 100)}%</span>
                </td>
                {anySpec && <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--muted)' }} title={t('xeval.col.spec.tip')}>
                  {r.specs.length ? `${Math.round((r.specs.reduce((a, b) => a + b, 0) / r.specs.length) * 100)}%` : '—'}
                </td>}
                {anyCost && <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--muted)' }}>{money(r.cost / r.n)}</td>}
                {anyCost && <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--muted)' }}>{r.solved ? money(r.cost / r.solved) : '—'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section style={{ fontSize: 12.5, color: 'var(--muted2)', lineHeight: 1.65, borderTop: '1px solid var(--border)', paddingTop: 14, maxWidth: 860 }}>
        <strong style={{ color: 'var(--white)' }}>{t('xeval.method.title')}</strong>
        <p style={{ margin: '8px 0 0' }}>
          {(label === 'Harvey LAB' ? t('xeval.lab.method.body') : t('xeval.tb.method.body'))
            .replace('{n}', String(taskN)).replace('{set}', label).replace('{harness}', String(harness))}
        </p>
      </section>
    </>
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
  modelxd: 'sparkle',  // the ✦ — ModelXD's own row gets the one shape nobody else has
}
const EFFORT_COLOR: Record<string, string> = {
  none: '#888780', minimal: '#5b9bd5', low: '#2a78d6', medium: '#1baf7a', high: '#eda100', xhigh: '#eb6834', max: '#d03b3b',
}
// Entries with no catalog run behind them (ModelXD's own row, the human
// anchor) have no display_name in xeval_runs — name them here.
const SPECIAL_DISPLAY: Record<string, string> = { 'modelxd-router': 'ModelXD Autopilot', 'human-expert': 'Human expert' }
const shapeOf = (prov: string) => PROVIDER_SHAPE[prov] ?? 'circle'
const colorOf = (effort: string) => EFFORT_COLOR[effort] ?? 'var(--red)'

function Mark({ shape, cx, cy, r, fill }: { shape: string; cx: number; cy: number; r: number; fill: string }) {
  const common = { fill, stroke: 'var(--bg)', strokeWidth: 1.5 }
  switch (shape) {
    case 'square':   return <rect x={cx - r} y={cy - r} width={2 * r} height={2 * r} {...common} />
    case 'diamond':  return <polygon points={`${cx},${cy - r * 1.2} ${cx + r * 1.2},${cy} ${cx},${cy + r * 1.2} ${cx - r * 1.2},${cy}`} {...common} />
    case 'triangle': return <polygon points={`${cx},${cy - r * 1.25} ${cx + r * 1.15},${cy + r * 0.9} ${cx - r * 1.15},${cy + r * 0.9}`} {...common} />
    case 'sparkle': {
      // Four-point concave star (the AI sparkle). Concave shapes read small,
      // so it draws at 1.45x the nominal radius.
      const R = r * 1.45, i = R * 0.26
      const d = `M ${cx} ${cy - R} Q ${cx + i} ${cy - i} ${cx + R} ${cy} Q ${cx + i} ${cy + i} ${cx} ${cy + R} Q ${cx - i} ${cy + i} ${cx - R} ${cy} Q ${cx - i} ${cy - i} ${cx} ${cy - R} Z`
      return <path d={d} {...common} />
    }
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
  // Visible window in data units (x = avg $/task — LOG by default, the
  // frontier-chart convention (cf. OpenAI's GPT-5.6 frontier post), with a
  // LIN toggle; y = rating). In log mode the window coordinates are
  // log10($), so the zoom/pan machinery needs no changes.
  // null = fit everything. Zoom (buttons / wheel around the cursor) and
  // pan (drag / trackpad scroll) move this window on BOTH axes; data,
  // colors and labels are untouched.
  type Win = { x0: number; x1: number; y0: number; y1: number }
  const [win, setWin] = useState<Win | null>(null)
  const [logX, setLogX] = useState(true)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const drag = useRef<{ startX: number; startY: number; w: Win } | null>(null)

  const toPts = (src: { model_name: string; effort: string | null; rating: number }[]) => src
    .map(r => {
      const e = perEntry.get(`${r.model_name}|${r.effort ?? ''}`)
      const c = (e ? avg(e.costs) : null) ?? (r as any).avg_cost_usd ?? null
      return c != null && c > 0
        ? { x: logX ? Math.log10(c) : c, c, y: r.rating, label: `${e?.display ?? SPECIAL_DISPLAY[r.model_name] ?? r.model_name}${r.effort ? ` @ ${r.effort}` : ''}`, provider: e?.provider ?? (r.model_name === 'modelxd-router' ? 'modelxd' : ''), effort: r.effort ?? '' }
        : null
    })
    .filter(Boolean) as { x: number; c: number; y: number; label: string; provider: string; effort: string }[]
  const pts = toPts(rows)
  const domain = toPts(domainRows)

  const W = 940, H = 420, PL = 46, PR = 16, PT = 14, PB = 30
  const PW = W - PL - PR, PH = H - PT - PB
  const xmax = domain.length ? Math.max(...domain.map(p => p.x)) : 1
  const xmin = domain.length ? Math.min(...domain.map(p => p.x)) : 0
  const ys = domain.length ? domain.map(p => p.y) : [1000]
  const full: Win = logX
    ? { x0: xmin - 0.12, x1: xmax + 0.12, y0: Math.min(...ys) - 40, y1: Math.max(...ys) + 40 }
    : { x0: 0, x1: xmax * 1.12, y0: Math.min(...ys) - 40, y1: Math.max(...ys) + 40 }
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
  // Log mode: ticks at {1,2,5}x10^k mantissas, thinned as the window widens.
  const logTicks = () => {
    const span = view.x1 - view.x0
    const mant = span > 2.5 ? [1] : span > 1.2 ? [1, 3] : span > 0.6 ? [1, 2, 5] : [1, 1.5, 2, 3, 5, 7]
    const out: number[] = []
    for (let k = Math.floor(view.x0) - 1; k <= Math.ceil(view.x1); k++)
      for (const m of mant) {
        const u = k + Math.log10(m)
        if (u >= view.x0 - 1e-9 && u <= view.x1 + 1e-9) out.push(u)
      }
    return out
  }
  const xticks = logX ? logTicks() : ticks(view.x0, view.x1, xstep), yticks = ticks(view.y0, view.y1, ystep)
  const fmtReal = (c: number) => '$' + (c >= 10 ? c.toFixed(0) : c >= 1 ? c.toFixed(1) : c >= 0.095 ? c.toFixed(2) : c.toFixed(3))
  const fmt = (v: number) => (logX ? fmtReal(Math.pow(10, v)) : '$' + (v >= 1 ? v.toFixed(v >= 10 ? 0 : 1) : v.toFixed(xstep < 0.01 ? 3 : 2)))
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
        <button style={{ ...btn, minWidth: 40 }} onClick={() => { setWin(null); setLogX(v => !v) }} title="cost axis scale">{logX ? 'LOG' : 'LIN'}</button>
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
            const rightHalf = X(p.x) > W * 0.72
            return (
              <g key={p.label} style={{ cursor: 'default' }}
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
                  {p.label}{isHover ? `  ·  ${p.y}  ·  ${fmtReal(p.c)}` : ''}
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
