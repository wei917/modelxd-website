'use client'
// app/xmind/page.tsx — XMind: what personality instruments say about models.
//
// Two instruments, deliberately shown side by side, because the disagreement
// IS the finding. The forced-choice set produces stable, differentiated types;
// the Likert set produces a flat midpoint for nearly every model, which is
// what acquiescence bias looks like — agreeing with a statement and with its
// reverse cancels the dimension out. Publishing the second as a personality
// would be a good headline and a false one.
//
// Every type is shown with its margin. A dimension decided 13-2 and one
// decided 8-7 are not the same claim.

import { useEffect, useMemo, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useT } from '../../lib/i18n'
import ProviderLogo from '../components/ProviderLogo'

const sb = () => createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)

type Row = {
  model_name: string; display_name: string; provider: string; effort: string | null
  run_index: number; mbti_type: string; tally: any; question_set: string; cost_usd: number | null
}

const AB = 'ab', LIKERT = 'likert'
const kindOf = (qs: string) => (qs?.startsWith('Type Scale') ? LIKERT : AB)
const PAIRS: Array<[string, string]> = [['E', 'I'], ['S', 'N'], ['T', 'F'], ['J', 'P']]

/** 13 stays 13; 10.666… becomes 10.7. */
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))
const DIMS = ['IE', 'SN', 'FT', 'JP'] as const

/** One dimension of the forced-choice instrument: which side won, and by how much. */
function MarginBar({ a, b, av, bv }: { a: string; b: string; av: number; bv: number }) {
  const total = Math.max(1, av + bv)
  const aWins = av >= bv
  const pct = Math.round((Math.max(av, bv) / total) * 100)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5 }}>
      <span style={{ fontFamily: 'var(--font-mono), monospace', fontWeight: aWins ? 800 : 400, color: aWins ? 'var(--white)' : 'var(--muted2)', width: 12 }}>{a}</span>
      <span style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--surface2)', overflow: 'hidden', display: 'flex' }}>
        <span style={{ width: `${(av / total) * 100}%`, background: aWins ? 'var(--red)' : 'var(--border2)' }} />
        <span style={{ width: `${(bv / total) * 100}%`, background: !aWins ? 'var(--red)' : 'var(--border2)' }} />
      </span>
      <span style={{ fontFamily: 'var(--font-mono), monospace', fontWeight: !aWins ? 800 : 400, color: !aWins ? 'var(--white)' : 'var(--muted2)', width: 12 }}>{b}</span>
      {/* Averaged across runs, so these are fractional — one decimal, and a
          whole number when it lands on one (13 not 13.0). */}
      <span style={{ fontFamily: 'var(--font-mono), monospace', color: 'var(--muted2)', width: 62, textAlign: 'right' }}>{fmt(Math.max(av, bv))}–{fmt(Math.min(av, bv))}</span>
      <span style={{ fontFamily: 'var(--font-mono), monospace', color: pct >= 80 ? 'var(--green)' : pct >= 65 ? 'var(--muted)' : 'var(--muted2)', width: 34, textAlign: 'right' }}>{pct}%</span>
    </div>
  )
}

export default function XMindPage() {
  const t = useT()
  const [rows, setRows] = useState<Row[] | null>(null)

  useEffect(() => {
    sb().from('mbti_results')
      .select('model_name, display_name, provider, effort, run_index, mbti_type, tally, question_set, cost_usd')
      .eq('subject_kind', 'model')
      .then(({ data }) => setRows((data ?? []) as Row[]))
  }, [])

  // One card per (model, instrument): the majority type across runs, how many
  // runs agreed, and the averaged margins.
  const cards = useMemo(() => {
    if (!rows) return null
    const by = new Map<string, Row[]>()
    for (const r of rows) {
      const k = `${r.model_name}|${kindOf(r.question_set)}`
      by.set(k, [...(by.get(k) ?? []), r])
    }
    return [...by.entries()].map(([k, rs]) => {
      const kind = k.split('|')[1]
      const counts: Record<string, number> = {}
      for (const r of rs) counts[r.mbti_type] = (counts[r.mbti_type] ?? 0) + 1
      const [type, agree] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
      const avg: Record<string, number> = {}
      if (kind === AB) {
        for (const [a, b] of PAIRS) for (const L of [a, b]) {
          avg[L] = rs.reduce((s, r) => s + (Number(r.tally?.[L]) || 0), 0) / rs.length
        }
      }
      const clarity = kind === LIKERT
        ? DIMS.map(d => Number(rs[0]?.tally?.[d]?.clarity ?? 0))
        : []
      return {
        kind, type, agree, runs: rs.length, avg, clarity,
        model: rs[0].display_name, provider: rs[0].provider, effort: rs[0].effort,
        // The instrument's own rule: clarity under 12 on ANY dimension makes the
        // letter undetermined — so the four-letter code is only meaningful when
        // all four clear the bar. `every` was wrong here: it let a model print
        // a type on the strength of one resolved dimension out of four.
        undetermined: kind === LIKERT && clarity.some(c => c < 12),
        types: rs.map(r => r.mbti_type),
      }
    }).sort((a, b) => a.model.localeCompare(b.model))
  }, [rows])

  const mono = { fontFamily: 'var(--font-mono), monospace', fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase' as const }

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '48px 24px 96px' }}>
      <div style={{ ...mono, color: 'var(--muted2)', marginBottom: 8 }}>{t('xmind.eyebrow')}</div>
      <h1 style={{ fontFamily: 'var(--font-display), inherit', fontWeight: 800, fontSize: 'clamp(26px, 4vw, 38px)', margin: '0 0 12px' }}>
        {t('xmind.title')}
      </h1>
      <p style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.65, maxWidth: 720, margin: '0 0 40px' }}>
        {t('xmind.sub')}
      </p>

      {!cards ? <div style={{ color: 'var(--muted)', padding: 60, textAlign: 'center' }}>Loading…</div> : (
        <>
          {/* ── Forced choice ── */}
          <h2 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 4px' }}>{t('xmind.ab.title')}</h2>
          <p style={{ color: 'var(--muted)', fontSize: 12.5, lineHeight: 1.6, margin: '0 0 18px' }}>{t('xmind.ab.note')}</p>
          <div style={{ display: 'grid', gap: 12, marginBottom: 48 }}>
            {cards.filter(c => c.kind === AB).map(c => (
              <div key={c.model + c.kind} style={{ border: '1px solid var(--border2)', borderRadius: 12, padding: '16px 18px', background: 'var(--surface)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                  <ProviderLogo provider={c.provider} size={18} />
                  <span style={{ fontWeight: 800, fontSize: 15 }}>{c.model}</span>
                  {c.effort && <span style={{ ...mono, color: 'var(--muted2)' }}>{c.effort}</span>}
                  <span style={{ flex: 1 }} />
                  <span style={{ fontFamily: 'var(--font-display), inherit', fontWeight: 800, fontSize: 24, letterSpacing: '0.06em', color: 'var(--red)' }}>{c.type}</span>
                  <span style={{ ...mono, color: c.agree === c.runs ? 'var(--green)' : 'var(--muted)' }}>
                    {c.agree}/{c.runs} {t('xmind.runs')}
                  </span>
                </div>
                <div style={{ display: 'grid', gap: 6 }}>
                  {PAIRS.map(([a, b]) => (
                    <MarginBar key={a} a={a} b={b} av={c.avg[a] ?? 0} bv={c.avg[b] ?? 0} />
                  ))}
                </div>
                {c.agree < c.runs && (
                  <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--muted)' }}>
                    {t('xmind.flipped').replace('{types}', c.types.join(', '))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* ── Likert ── */}
          <h2 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 4px' }}>{t('xmind.likert.title')}</h2>
          <p style={{ color: 'var(--muted)', fontSize: 12.5, lineHeight: 1.6, margin: '0 0 18px' }}>{t('xmind.likert.note')}</p>
          <div style={{ display: 'grid', gap: 10, marginBottom: 40 }}>
            {cards.filter(c => c.kind === LIKERT).map(c => (
              <div key={c.model + c.kind} style={{
                border: '1px solid var(--border2)', borderRadius: 12, padding: '14px 18px',
                background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
              }}>
                <ProviderLogo provider={c.provider} size={18} />
                <span style={{ fontWeight: 800, fontSize: 14 }}>{c.model}</span>
                <span style={{ flex: 1 }} />
                {c.undetermined ? (
                  <span style={{ ...mono, color: 'var(--muted)' }}>{t('xmind.undetermined')}</span>
                ) : (
                  <span style={{ fontFamily: 'var(--font-display), inherit', fontWeight: 800, fontSize: 18, color: 'var(--muted)' }}>{c.types.join(' / ')}</span>
                )}
                <span style={{ ...mono, color: 'var(--muted2)' }}>
                  {t('xmind.clarity')} {c.clarity.map(x => Math.round(x)).join(' · ')}
                </span>
              </div>
            ))}
          </div>

          <div style={{ border: '1px solid var(--border2)', borderRadius: 10, padding: '14px 18px', background: 'var(--surface2)', fontSize: 12, lineHeight: 1.7, color: 'var(--muted)' }}>
            <div style={{ ...mono, color: 'var(--muted2)', marginBottom: 6 }}>{t('xmind.method.title')}</div>
            {t('xmind.method')}
          </div>
        </>
      )}
    </div>
  )
}
