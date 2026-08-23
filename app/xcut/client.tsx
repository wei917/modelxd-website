'use client'
// app/xcut/client.tsx — the XCut shell: your cuts (list / new / from a
// board) and the editor for one cut. The editor itself is XCutEditor.

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useT } from '../../lib/i18n'
import { useRequireAuth } from '../../lib/useRequireAuth'
import XCutEditor, { type XCutProject } from '../components/XCutEditor'

type ProjectRow = { id: string; title: string | null; source_board_id: string | null; duration_s: number | null; render: any; updated_at: string }

export default function XCutClient() {
  const t = useT()
  const router = useRouter()
  const params = useSearchParams()
  useRequireAuth()   // pops the auth modal for strangers; the API answers 401 meanwhile
  const ready = true, user = true
  const pid = params.get('p')
  const from = params.get('from')

  const [projects, setProjects] = useState<ProjectRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [project, setProject] = useState<XCutProject | null>(null)
  const [busy, setBusy] = useState(false)

  // ?from=<board> → create the rough cut once, then live at ?p=<id>.
  useEffect(() => {
    if (!ready || !user || !from) return
    let cancelled = false
    ;(async () => {
      setBusy(true)
      try {
        const res = await fetch('/api/xcut/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: { board: from } }) })
        const d = await res.json().catch(() => null)
        if (!res.ok) throw new Error(d?.error ?? `HTTP ${res.status}`)
        if (!cancelled) router.replace(`/xcut?p=${d.project.id}`)
      } catch (e: any) { if (!cancelled) setError(e?.message ?? 'Could not start the cut') }
      finally { if (!cancelled) setBusy(false) }
    })()
    return () => { cancelled = true }
  }, [ready, user, from, router])

  // ?p=<id> → load the project.
  useEffect(() => {
    if (!ready || !user || !pid) { setProject(null); return }
    let cancelled = false
    ;(async () => {
      setError(null)
      const res = await fetch(`/api/xcut/projects/${pid}`)
      const d = await res.json().catch(() => null)
      if (cancelled) return
      if (!res.ok) { setError(d?.error ?? `HTTP ${res.status}`); return }
      setProject(d.project)
    })()
    return () => { cancelled = true }
  }, [ready, user, pid])

  // No project → the list.
  useEffect(() => {
    if (!ready || !user || pid || from) return
    let cancelled = false
    ;(async () => {
      const res = await fetch('/api/xcut/projects')
      const d = await res.json().catch(() => null)
      if (cancelled) return
      if (!res.ok) { setError(d?.error ?? `HTTP ${res.status}`); setProjects([]); return }
      setProjects(d.projects ?? [])
    })()
    return () => { cancelled = true }
  }, [ready, user, pid, from])

  const createBlank = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/xcut/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      const d = await res.json().catch(() => null)
      if (!res.ok) throw new Error(d?.error ?? `HTTP ${res.status}`)
      router.push(`/xcut?p=${d.project.id}`)
    } catch (e: any) { setError(e?.message ?? 'Could not create') }
    finally { setBusy(false) }
  }

  if (!ready || !user) return null

  if (pid && project) return <XCutEditor project={project} onExit={() => router.push('/xcut')} />

  const mono: React.CSSProperties = { fontSize: 10.5, fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--muted)' }
  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 24px 60px' }}>
      <div style={mono}>// {t('xcut.title')}</div>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, margin: '6px 0 4px' }}>{t('xcut.title')}</h1>
      <div style={{ color: 'var(--muted)', fontSize: 13.5, marginBottom: 22 }}>{t('xcut.tagline')}</div>
      {error && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 14 }}>⚠ {error}</div>}
      {(pid || from) && !error && <div style={{ color: 'var(--muted)', fontSize: 13 }}>…</div>}
      {!pid && !from && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <span style={mono}>{t('xcut.projects')}</span>
            <span style={{ flex: 1 }} />
            <button onClick={createBlank} disabled={busy} style={{ padding: '8px 18px', borderRadius: 999, border: 'none', background: 'var(--red)', color: '#fff', fontWeight: 800, fontSize: 13, cursor: 'pointer', opacity: busy ? 0.5 : 1 }}>✂ {t('xcut.new')}</button>
          </div>
          {projects && projects.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 13.5, lineHeight: 1.6 }}>{t('xcut.empty')}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
            {(projects ?? []).map(p => (
              <button key={p.id} onClick={() => router.push(`/xcut?p=${p.id}`)} style={{ textAlign: 'left', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px', background: 'var(--surface)', cursor: 'pointer' }}>
                <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 4 }}>{p.title || t('xcut.untitled')}</div>
                <div style={{ ...mono, textTransform: 'none' }}>
                  {typeof p.duration_s === 'number' ? `${p.duration_s.toFixed(1)}s · ` : ''}{new Date(p.updated_at).toLocaleString()}
                  {p.render?.status === 'done' ? ` · ${t('xcut.finalcut')} ✓` : ''}
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
