'use client'

// The review screen for the trending list: weeks newest first, each post
// with its likes, models, our summary and whether it carries a preset.
// Tick up to 20 per kind and Publish: ticked rows go live ranked by likes,
// the rest of that week is hidden. "Run search now" is the Monday job on
// demand (paid, same monthly budget).

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

export type AdminTrendRow = {
  id: string
  platform: string
  post_id: string
  handle: string
  url: string
  kind: 'video' | 'image'
  models: string[]
  likes: number | null
  summary: Record<string, string>
  prompt: string | null
  preset: { model: string; recipe: string; duration?: number; aspect?: string; needsImage?: boolean } | null
  week: string
  rank: number | null
  status: 'pending' | 'live' | 'hidden'
  created_at: string
}

const MAX_LIVE = 20
const STATUS_COLOR: Record<AdminTrendRow['status'], string> = { live: 'var(--green)', pending: 'var(--red)', hidden: 'var(--muted)' }

export default function AdminTrendingClient({ rows, spent, budget }: { rows: AdminTrendRow[]; spent: number; budget: number }) {
  const router = useRouter()
  const weeks = useMemo(() => [...new Set(rows.map(r => r.week))], [rows])
  const [picked, setPicked] = useState<Set<string>>(() => new Set(rows.filter(r => r.status === 'live').map(r => r.id)))
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const toggle = (id: string) => setPicked(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const publish = async (week: string) => {
    const ids = rows.filter(r => r.week === week && picked.has(r.id)).map(r => r.id)
    setBusy(`publish:${week}`); setNote(null)
    const res = await fetch('/api/admin/trending', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'publish', week, ids }) })
    const j = await res.json().catch(() => ({}))
    setBusy(null)
    setNote(res.ok ? `Week of ${week}: ${j.live} live, ${j.hidden} hidden.` : `Publish failed: ${j.error ?? res.status}`)
    if (res.ok) router.refresh()
  }

  const run = async (kind: 'video' | 'image') => {
    if (!confirm(`Run the ${kind} search now? Grok costs about $1–2 a run and can't be capped. This month: $${spent.toFixed(2)} of $${budget}.`)) return
    setBusy(`run:${kind}`); setNote('Searching X… this takes a few minutes.')
    const res = await fetch('/api/admin/trending', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'run', kind }) })
    const j = await res.json().catch(() => ({}))
    setBusy(null)
    if (!res.ok) { setNote(`Search failed: ${j.error ?? res.status}`); return }
    const r = j.report
    setNote(`Found ${r.found}, added ${r.inserted} as pending, ${r.alreadyListed} already listed, ${r.dropped.length} dropped. Cost $${r.costUsd.toFixed(2)}.`
      + (r.dropped.length ? ` Dropped: ${r.dropped.map((d: any) => `${d.url.split('/')[3] ?? d.url} (${d.reason})`).join('; ')}` : ''))
    router.refresh()
  }

  return <div style={{ maxWidth: 1100, margin: '0 auto', padding: '90px 24px 80px', fontFamily: 'var(--font-body), sans-serif', color: 'var(--white)' }}>
    <div style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 10 }}>
      <span style={{ color: 'var(--red)' }}>//</span> Admin
    </div>
    <h1 style={{ fontFamily: 'var(--font-display), sans-serif', fontSize: 34, fontWeight: 800, margin: '0 0 8px' }}>Trending on social media</h1>
    <p style={{ color: 'var(--muted2)', fontSize: 14, margin: '0 0 20px', lineHeight: 1.6 }}>
      The Monday search adds candidates as pending. Tick up to {MAX_LIVE} per kind and publish; the rest of that week is hidden.
      XCreate shows the newest week that has live posts. Search spend this month: <b>${spent.toFixed(2)}</b> of ${budget}.
    </p>
    <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
      <button onClick={() => run('video')} disabled={!!busy} style={btn(false)}>{busy === 'run:video' ? 'Searching…' : 'Run video search now'}</button>
      <button onClick={() => run('image')} disabled={!!busy} style={btn(false)}>{busy === 'run:image' ? 'Searching…' : 'Run image search now'}</button>
    </div>
    {note && <div style={{ padding: '10px 14px', border: '1px solid var(--border2)', borderRadius: 8, fontSize: 13, marginBottom: 20, lineHeight: 1.5 }}>{note}</div>}

    {weeks.length === 0 && <p style={{ color: 'var(--muted2)' }}>No posts yet.</p>}
    {weeks.map(week => {
      const ofWeek = rows.filter(r => r.week === week)
      const count = (k: string) => ofWeek.filter(r => r.kind === k && picked.has(r.id)).length
      return <section key={week} style={{ marginBottom: 36 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
          <h2 style={{ fontSize: 18, margin: 0 }}>Week of {week}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13, color: 'var(--muted2)' }}>
            <span>Picked: {count('video')} video, {count('image')} image</span>
            <button onClick={() => publish(week)} disabled={!!busy || count('video') > MAX_LIVE || count('image') > MAX_LIVE} style={btn(true)}>
              {busy === `publish:${week}` ? 'Publishing…' : 'Publish this week'}
            </button>
          </div>
        </div>
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          {ofWeek.map(r => <label key={r.id} style={{ display: 'grid', gridTemplateColumns: '28px 70px 1fr 220px', gap: 12, alignItems: 'start', padding: '12px 14px', borderTop: '1px solid var(--border)', fontSize: 13, cursor: 'pointer', background: picked.has(r.id) ? 'var(--surface2)' : 'transparent' }}>
            <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} style={{ marginTop: 3 }} />
            <div style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 11 }}>
              <div style={{ color: STATUS_COLOR[r.status], fontWeight: 700 }}>{r.status}{r.rank ? ` #${r.rank}` : ''}</div>
              <div style={{ color: 'var(--muted2)', marginTop: 4 }}>{r.kind}</div>
              <div style={{ color: 'var(--muted2)' }}>♥ {r.likes ?? '?'}</div>
            </div>
            <div style={{ minWidth: 0 }}>
              <a href={r.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--red)', textDecoration: 'none', fontWeight: 600 }}>@{r.handle} ↗</a>
              <span style={{ color: 'var(--muted2)' }}> · {r.models.join(' + ')}</span>
              <div style={{ marginTop: 4, lineHeight: 1.5 }}>{r.summary?.en}</div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted2)', lineHeight: 1.5 }}>
              {r.preset
                ? <>Preset: {r.preset.model} · {r.preset.recipe}{r.preset.duration ? ` · ${r.preset.duration}s` : ''}{r.preset.needsImage ? ' · needs a picture' : ''}</>
                : <>No preset{r.prompt ? (r.prompt.length > 8000 ? ' (prompt over 8,000 chars)' : '') : ' (no prompt)'}</>}
              {r.prompt && <div>Prompt: {r.prompt.length.toLocaleString()} chars</div>}
            </div>
          </label>)}
        </div>
      </section>
    })}
  </div>
}

function btn(primary: boolean): React.CSSProperties {
  return {
    padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
    border: `1px solid ${primary ? 'var(--red)' : 'var(--border2)'}`, background: primary ? 'var(--red)' : 'var(--surface)', color: primary ? '#fff' : 'var(--white)',
  }
}
