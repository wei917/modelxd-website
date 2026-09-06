'use client'

// app/components/RouterTuner.tsx — the routing panel on XDev.
//
// Three sliders and four preset chips. Move them and the panel shows which
// model would answer, and WHY: the axis values behind the score, not just a
// name. The router is the one part of this API a developer has to take on
// trust, so it gets a window rather than a paragraph.
//
// It calls /api/v1/router/preview, which ranks the same candidates through the
// same scoring function the live routes use. A panel that scored its own way
// would be a tool for being confidently wrong about the thing it explains.
//
// The presets are not descriptions of the routes — they ARE the routes. Each
// chip sends `preset=xd/…` and the server answers with that route's own
// weights, so what you see here is what /v1 will do.

import { useCallback, useEffect, useRef, useState } from 'react'
import ProviderLogo from './ProviderLogo'

type Axis = 'quality' | 'cost' | 'speed'
type Weights = Record<Axis, number>

type Row = {
  id: string
  display_name: string | null
  provider: string | null
  score: number
  quality: number | null
  price_per_1m: number | null
  ttft_s: number | null
  parts: Weights
}

const PRESETS: { id: string; label: string; weights: Weights }[] = [
  { id: 'xd/auto',   label: 'auto',   weights: { quality: 0.5, cost: 0.3, speed: 0.2 } },
  { id: 'xd/fast',   label: 'fast',   weights: { quality: 0.2, cost: 0.1, speed: 0.7 } },
  { id: 'xd/budget', label: 'budget', weights: { quality: 0.2, cost: 0.7, speed: 0.1 } },
  { id: 'xd/max',    label: 'max',    weights: { quality: 1.0, cost: 0.0, speed: 0.0 } },
]

const AXES: { key: Axis; label: string; hint: string }[] = [
  { key: 'quality', label: 'Quality', hint: 'blind-vote rating' },
  { key: 'cost',    label: 'Cost',    hint: 'price per 1M' },
  { key: 'speed',   label: 'Speed',   hint: 'first token' },
]

const money = (v: number | null) => (v == null ? '—' : `$${v < 10 ? v.toFixed(2) : v.toFixed(0)}`)
const secs = (v: number | null) => (v == null ? '—' : `${v < 10 ? v.toFixed(2) : v.toFixed(1)}s`)

export default function RouterTuner() {
  const [weights, setWeights] = useState<Weights>(PRESETS[0].weights)
  const [preset, setPreset] = useState<string | null>('xd/auto')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const seq = useRef(0)

  const load = useCallback(async (w: Weights, presetId: string | null) => {
    const mine = ++seq.current
    const qs = presetId
      ? `preset=${encodeURIComponent(presetId)}`
      : `quality=${w.quality}&cost=${w.cost}&speed=${w.speed}`
    try {
      const r = await fetch(`/api/v1/router/preview?${qs}`)
      const d = await r.json()
      // Drop a stale answer: dragging a slider fires several of these and they
      // do not necessarily come back in order.
      if (mine !== seq.current) return
      if (!r.ok) { setErr(d?.error?.message ?? 'Could not resolve.'); return }
      setErr(null); setRows(d.data ?? [])
    } catch {
      if (mine === seq.current) setErr('Could not reach the router.')
    }
  }, [])

  useEffect(() => { load(weights, preset) }, [weights, preset, load])

  const move = (axis: Axis, v: number) => {
    setPreset(null)                      // hand-tuned now; no chip is active
    setWeights(w => ({ ...w, [axis]: v }))
  }

  const winner = rows?.[0]

  return (
    <div style={{ border: '1px solid var(--border2)', borderRadius: 10, padding: '18px 20px 20px', background: 'var(--surface)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
        <strong style={{ fontSize: 14 }}>Tune the router</strong>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          Move the weights and see what would answer.
        </span>
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6, margin: '0 0 14px', maxWidth: 660 }}>
        The four routing verbs are presets on these same three axes. Nothing here reads your prompt —
        the router weights the axes you choose, it does not try to guess your task.
      </p>

      {/* Presets */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {PRESETS.map(p => {
          const on = preset === p.id
          return (
            <button key={p.id}
              onClick={() => { setPreset(p.id); setWeights(p.weights) }}
              style={{
                fontFamily: 'var(--font-mono), monospace', fontSize: 11.5, letterSpacing: '0.04em',
                padding: '6px 12px', borderRadius: 999, cursor: 'pointer',
                border: `1px solid ${on ? 'var(--red)' : 'var(--border2)'}`,
                background: on ? 'var(--red)' : 'transparent',
                color: on ? '#fff' : 'var(--muted)',
              }}>xd/{p.label}</button>
          )
        })}
        {!preset && (
          <span style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 11, color: 'var(--muted2)', alignSelf: 'center' }}>
            custom
          </span>
        )}
      </div>

      {/* Sliders */}
      <div style={{ display: 'grid', gap: 12, marginBottom: 18 }}>
        {AXES.map(a => (
          <label key={a.key} style={{ display: 'grid', gridTemplateColumns: '92px 1fr 42px', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 12.5 }}>
              {a.label}
              <span style={{ display: 'block', fontSize: 10.5, color: 'var(--muted2)' }}>{a.hint}</span>
            </span>
            <input type="range" min={0} max={1} step={0.05} value={weights[a.key]}
              onChange={e => move(a.key, Number(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--red)' }} />
            <span style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 11.5, color: 'var(--muted)', textAlign: 'right' }}>
              {weights[a.key].toFixed(2)}
            </span>
          </label>
        ))}
      </div>

      {err && <div style={{ color: 'var(--red)', fontSize: 12.5 }}>⚠ {err}</div>}

      {!err && winner && (
        <div style={{ borderTop: '1px solid var(--border2)', paddingTop: 14 }}>
          <div style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--muted2)', marginBottom: 8 }}>
            would answer
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            {winner.provider && <ProviderLogo provider={winner.provider} size={15} />}
            <code style={{ fontSize: 14, fontWeight: 700 }}>{winner.id}</code>
            <span style={{ flex: 1 }} />
            <span style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 11.5, color: 'var(--muted)' }}>
              {money(winner.price_per_1m)}/1M · {secs(winner.ttft_s)} to first token
            </span>
          </div>

          {/* The runners-up, so a developer can see the decision was close or
              not — a single name gives no sense of how much the weights matter. */}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ color: 'var(--muted2)', textAlign: 'left' }}>
                {['model', 'score', '$/1M', 'first token'].map((h, i) => (
                  <th key={h} style={{
                    fontFamily: 'var(--font-mono), monospace', fontSize: 9.5, letterSpacing: '0.1em',
                    textTransform: 'uppercase', fontWeight: 400, padding: '4px 0',
                    textAlign: i === 0 ? 'left' : 'right',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows!.slice(0, 5).map((r, i) => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--border2)', opacity: i === 0 ? 1 : 0.72 }}>
                  <td style={{ padding: '6px 0' }}>
                    <code style={{ fontSize: 11.5 }}>{r.id}</code>
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono), monospace', fontSize: 11.5, color: i === 0 ? 'var(--red)' : 'var(--muted)' }}>
                    {r.score.toFixed(3)}
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono), monospace', fontSize: 11.5, color: 'var(--muted)' }}>
                    {money(r.price_per_1m)}
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono), monospace', fontSize: 11.5, color: 'var(--muted)' }}>
                    {secs(r.ttft_s)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <p style={{ fontSize: 11.5, color: 'var(--muted2)', lineHeight: 1.6, marginTop: 10 }}>
            Call it with <code>model: &quot;{preset ?? 'xd/auto'}&quot;</code>. Price and latency are scored on a log
            scale, because 20× cheaper is the interesting fact, not 20 dollars. Latency is each model&apos;s
            slowest thinking setting, so the speed holds however you call it.
          </p>
        </div>
      )}

      {!err && rows && rows.length === 0 && (
        <div style={{ fontSize: 12.5, color: 'var(--muted)', borderTop: '1px solid var(--border2)', paddingTop: 14 }}>
          No model has the data these weights need yet. Lower the axis that has no measurements, or name a model explicitly.
        </div>
      )}
    </div>
  )
}
