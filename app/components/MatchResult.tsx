'use client'
// app/components/MatchResult.tsx
//
// 傳說對決-style match report, light theme (CC: match the site, not a dark
// takeover). Shared by XCreate (post-pick) and XDuel (step 5 reveal).
//
//   ┌────────────────────────────────────────────┐
//   │        RUN COMPLETE · 4 MODELS             │
//   │        Nano Banana 2 wins                  │
//   │        [ XDRating 1180 → 1186  +6 ]        │
//   │  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐           │
//   │  │13.0*│ │ 8.4 │ │ 6.1 │ │ 0.0 │  ← score  │
//   │  └─────┘ └─────┘ └─────┘ └─────┘           │
//   └────────────────────────────────────────────┘
//
// Per-run score ≠ XDRating: see lib/matchScore.ts. MVP = highest score.
// The rating delta arrives async (refit round-trip) — chip renders once
// `ratingDelta` flips from undefined to a value; null hides it for good.

import { useEffect, useState } from 'react'
import ProviderLogo from './ProviderLogo'

export interface MatchResultEntry {
  name: string
  provider: string
  score: number          // 0-15, one decimal (computeMatchScores)
  responseTime: number   // ms
  cost: number           // USD
  isPick: boolean        // the user's vote
  error?: boolean
  priceLabel?: string    // XDuel: per-unit price string
  note?: string          // XDuel: savings line under the card
  /** Web searches this model ran. Billed per call ON TOP of tokens, so a
   *  model can lose on cost purely by having looked things up more. */
  searches?: number
}

export interface RatingDelta {
  before: number
  after: number
}

/** Real spend is fractions of a cent on text and dollars on video — one
 *  fixed precision would print either "$0.00" or "$1.230000". */
function fmtSpend(c: number): string {
  if (!Number.isFinite(c) || c <= 0) return '$0'
  if (c >= 1)    return `$${c.toFixed(2)}`
  if (c >= 0.01) return `$${c.toFixed(3)}`
  if (c >= 0.0001) return `$${c.toFixed(4)}`
  return '<$0.0001'
}

export default function MatchResult({
  eyebrow,
  title,
  winnerProvider,  // provider of the model named in the title → logo beside it
  entries,
  ratingDelta,   // undefined = loading, null = unavailable
  children,      // CTA row
}: {
  eyebrow: string
  title: string
  winnerProvider?: string | null
  entries: MatchResultEntry[]
  ratingDelta?: RatingDelta | null
  children?: React.ReactNode
}) {
  const maxScore = Math.max(...entries.map(e => e.score))
  // What the run ACTUALLY cost, not the list price. The two can disagree:
  // a cheaper-per-token model that writes four sentences against a dearer
  // one that writes two ends up spending more. The score's cost component
  // (lib/matchScore.ts) grades on this number, so the card has to show it
  // or the grade looks arbitrary. (CC, July 29)
  const spends = entries.filter(e => !e.error).map(e => e.cost)
  const minSpend = spends.length ? Math.min(...spends) : 0
  const spendsDiffer = spends.length > 1 && Math.max(...spends) > minSpend
  // "MVP" implies a field to be most-valuable IN — with only two
  // competitors the natural word is "WINNER", and a solo run gets no
  // badge at all (CC, July 16-17).
  const topBadge = entries.length >= 3 ? 'MVP' : entries.length === 2 ? 'WINNER' : null
  const [shown, setShown] = useState(false)
  useEffect(() => { const t = setTimeout(() => setShown(true), 30); return () => clearTimeout(t) }, [])

  const delta = ratingDelta ? ratingDelta.after - ratingDelta.before : 0

  return (
    <div style={{
      border: '1px solid var(--border2)', borderRadius: 16, background: 'var(--bg)',
      padding: '28px 24px 24px', margin: '18px 0',
      opacity: shown ? 1 : 0, transform: shown ? 'translateY(0)' : 'translateY(14px)',
      transition: 'opacity .45s ease, transform .45s cubic-bezier(.2,1,.3,1)',
    }}>
      {/* Banner */}
      <div style={{ textAlign: 'center', marginBottom: 18 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, letterSpacing: '.35em', color: 'var(--muted)', textTransform: 'uppercase' }}>
          {eyebrow}
        </div>
        <h2 style={{
          fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 'clamp(26px, 4.5vw, 40px)',
          lineHeight: 1.1, margin: '6px 0 0',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          {winnerProvider && <ProviderLogo provider={winnerProvider} size={34} />}
          <span>{title}</span>
        </h2>
        {/* thin red slash under the title — the X motif, kept subtle */}
        <div style={{ width: 180, height: 2, margin: '12px auto 0', background: 'linear-gradient(90deg, transparent, var(--red), transparent)' }} />

        {/* XDRating movement chip */}
        {ratingDelta !== null && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 12,
            fontFamily: 'var(--mono)', fontSize: 12.5,
            border: '1px solid var(--border2)', borderRadius: 999, padding: '6px 14px',
            background: 'var(--surface2)',
            opacity: ratingDelta === undefined ? 0.55 : 1, transition: 'opacity .3s',
          }}>
            <span style={{ letterSpacing: '.14em', fontSize: 10, color: 'var(--muted)' }}>XDRATING</span>
            {ratingDelta === undefined ? (
              <span style={{ color: 'var(--muted)' }}>updating…</span>
            ) : (
              <>
                <span>{ratingDelta.before}</span>
                <span style={{ color: 'var(--muted)' }}>→</span>
                <b>{ratingDelta.after}</b>
                <b style={{ color: delta >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {delta >= 0 ? `+${delta}` : delta}
                </b>
              </>
            )}
          </div>
        )}
      </div>

      {/* Model cards */}
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', alignItems: 'stretch' }}>
        {entries.map((e, i) => {
          const mvp = !e.error && e.score === maxScore
          return (
            <div key={i} style={{
              position: 'relative', width: 200, borderRadius: 12, padding: '16px 16px 14px',
              border: `1.5px solid ${mvp ? 'var(--red)' : 'var(--border2)'}`,
              background: mvp ? 'var(--red-dim)' : 'var(--surface)',
              boxShadow: mvp ? '0 8px 26px var(--red-glow)' : 'none',
              opacity: shown ? (e.error ? 0.62 : 1) : 0,
              transform: shown ? 'translateY(0)' : 'translateY(12px)',
              transition: `opacity .4s ease ${.12 + i * .09}s, transform .4s cubic-bezier(.2,1,.3,1) ${.12 + i * .09}s`,
            }}>
              {mvp && topBadge && (
                <span style={{
                  position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)',
                  background: 'var(--red)', color: '#fff', borderRadius: 999,
                  fontFamily: 'var(--mono)', fontSize: 9.5, letterSpacing: '.22em',
                  padding: '3px 12px', textTransform: 'uppercase',
                }}>{topBadge}</span>
              )}

              {/* Per-run score — the big AoV-style number */}
              <div style={{
                fontFamily: 'var(--font-display)', fontWeight: 900, textAlign: 'center',
                fontSize: 38, lineHeight: 1, marginTop: mvp ? 6 : 2,
                color: e.error ? 'var(--muted)' : mvp ? 'var(--red)' : 'var(--white)',
              }}>
                {e.error ? 'DNF' : e.score.toFixed(1)}
              </div>
              <div style={{ textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '.2em', color: 'var(--muted)', marginTop: 3, textTransform: 'uppercase' }}>
                match score
              </div>

              <div style={{ textAlign: 'center', marginTop: 11 }}>
                {/* Post-reveal surface — provider logos are fine here (the
                    blind-phase ban only covers XDuel votes 1-2). */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
                  <ProviderLogo provider={e.provider} size={18} />
                  <div style={{ fontWeight: 700, fontSize: 13.5, lineHeight: 1.25 }}>{e.name}</div>
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 9.5, letterSpacing: '.16em', color: 'var(--muted)', marginTop: 3, textTransform: 'uppercase' }}>
                  {e.provider}
                </div>
              </div>

              <div style={{
                display: 'flex', justifyContent: 'center', alignItems: 'center',
                gap: 9, marginTop: 11, flexWrap: 'wrap',
                fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--muted2)',
              }}>
                <span>⏱ {(e.responseTime / 1000).toFixed(1)}s</span>
                {/* Rate and total sit on ONE line. Spend on its own row
                    below read as a footnote — the whole point is that you
                    see what a model charges and what it just cost you in the
                    same glance. (CC, July 29) */}
                <span>{e.priceLabel ?? fmtSpend(e.cost)}</span>
                <span style={{
                  color: e.error ? 'var(--muted)'
                       : spendsDiffer && e.cost === minSpend ? 'var(--green)'
                       : 'var(--muted2)',
                  fontWeight: 700,
                }}>
                  {e.error ? '—' : `${fmtSpend(e.cost)} total`}
                </span>
                {/* Deliberately language-neutral: the count IS the message,
                    and it explains a total that would otherwise look wrong
                    next to the per-token rate. */}
                {!e.error && (e.searches ?? 0) > 0 && (
                  <span
                    title={`${e.searches} web search${e.searches === 1 ? '' : 'es'} — billed per search, on top of tokens`}
                    style={{ color: 'var(--muted2)' }}
                  >
                    🌐 {e.searches}
                  </span>
                )}
              </div>

              {e.note && (
                <div style={{ textAlign: 'center', fontSize: 10.5, color: 'var(--muted2)', marginTop: 8, lineHeight: 1.35 }}>
                  {e.note}
                </div>
              )}

              <div style={{
                marginTop: 11, textAlign: 'center', borderRadius: 7, padding: '5px 0',
                fontFamily: 'var(--mono)', fontSize: 9.5, letterSpacing: '.18em', textTransform: 'uppercase',
                border: e.isPick ? 'none' : '1px dashed var(--border2)',
                background: e.isPick ? 'var(--red)' : 'transparent',
                color: e.isPick ? '#fff' : 'var(--muted)',
              }}>
                {e.isPick ? '★ your pick' : e.error ? 'failed' : '—'}
              </div>
            </div>
          )
        })}
      </div>

      {children && (
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 22, flexWrap: 'wrap' }}>
          {children}
        </div>
      )}
    </div>
  )
}
