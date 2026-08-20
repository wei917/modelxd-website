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
      setRatings((r ?? []).filter(row => row.fit_id === latestFit))
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

  return (
    <main style={{ maxWidth: 980, margin: '0 auto', padding: '32px 24px' }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, marginBottom: 4 }}>
        {t('xeval.title')}
      </h1>
      <p style={{ color: 'var(--muted)', marginBottom: 24, maxWidth: 700 }}>{t('xeval.sub')}</p>

      {loading ? (
        <p style={{ color: 'var(--muted)' }}>…</p>
      ) : ratings.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>{t('xeval.empty')}</p>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '8px 12px' }}>#</th>
                  <th style={{ padding: '8px 12px' }}>{t('xeval.col.model')}</th>
                  <th style={{ padding: '8px 12px' }}>{t('xeval.col.effort')}</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right' }}>{t('xeval.col.rating')}</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right' }}>W / G</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right' }}>{t('xeval.col.cost')}</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right' }}>{t('xeval.col.time')}</th>
                </tr>
              </thead>
              <tbody>
                {[...ratings]
                  .sort((a, b) => b.rating - a.rating)
                  .map((row, i) => {
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
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>{row.rating}</td>
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
          <section style={{ marginTop: 32, padding: 16, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, color: 'var(--muted)', lineHeight: 1.7 }}>
            <strong style={{ color: 'var(--white)' }}>{t('xeval.method.title')}</strong>
            <p style={{ margin: '8px 0 0' }}>
              {t('xeval.method.body')
                .replace('{tasks}', String(taskCount))
                .replace('{judge}', judge)}
            </p>
          </section>
        </>
      )}
    </main>
  )
}
