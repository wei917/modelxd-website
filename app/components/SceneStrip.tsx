'use client'
// app/components/SceneStrip.tsx
// The storyboard lane of the XDirect stage (CC, Aug 6).
//
// The director drafts scenes here with set_storyboard; the user EDITS them
// here — script, shot prompt, duration, order — and generates from here.
// This strip is sequence (what plays, in what order); the canvas below it is
// derivation (how each artifact was made). Same stage, two grammars.
//
// Editing is optimistic and local: every change flows up through onChange
// and the page/chat owns persistence. Generation is delegated upward too —
// the ▶ on a card arms that scene and asks the director to run it, so the
// spend still goes through the one billing pipeline and the agent stays in
// the loop on what happened.

import { useState } from 'react'
import { useT } from '../../lib/i18n'

export type Scene = {
  id: string
  title: string
  script: string
  shot: string
  duration_s: number
  /** This card is a CUT — it continues the previous card's action and is
   *  chained from its final frame at generation. */
  continues?: boolean
  model_id?: string
  model_name?: string
  recipe?: string
  estimate?: number
  status?: 'draft' | 'generating' | 'done' | 'error'
  row_id?: string
  url?: string
  cost?: number
  error?: string
}

const card: React.CSSProperties = {
  width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8,
  padding: '12px 12px 10px', borderRadius: 12,
  border: '1px solid var(--border2)', background: 'var(--surface)',
}
const label: React.CSSProperties = {
  fontSize: 9, fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.09em',
  textTransform: 'uppercase', color: 'var(--muted)',
}
const area: React.CSSProperties = {
  width: '100%', resize: 'none', border: '1px solid transparent', borderRadius: 7,
  background: 'transparent', color: 'var(--white)', fontFamily: 'inherit',
  fontSize: 13, lineHeight: 1.6, padding: '6px 8px', outline: 'none',
}
const iconBtn: React.CSSProperties = {
  border: 'none', background: 'none', cursor: 'pointer', padding: '2px 4px',
  color: 'var(--muted)', fontSize: 12, lineHeight: 1,
}

export default function SceneStrip({ scenes, busy, onChange, onGenerate, onGenerateAll, onPreview }: {
  scenes: Scene[]
  /** true while the director is mid-turn — generation buttons pause. */
  busy: boolean
  onChange: (next: Scene[]) => void
  onGenerate: (sceneId: string) => void
  onGenerateAll: () => void
  onPreview: (url: string, isVideo: boolean) => void
}) {
  const t = useT()
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  // Shot prompts are long; cards stay scannable with them folded.
  const [openShot, setOpenShot] = useState<Record<string, boolean>>({})

  if (scenes.length === 0) return null

  const patch = (id: string, p: Partial<Scene>) =>
    onChange(scenes.map(s => s.id === id ? { ...s, ...p } : s))
  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir
    if (j < 0 || j >= scenes.length) return
    const next = [...scenes]
    ;[next[idx], next[j]] = [next[j], next[idx]]
    onChange(next)
  }
  const remove = (id: string) => { setConfirmDel(null); onChange(scenes.filter(s => s.id !== id)) }
  const addScene = () => {
    const n = scenes.length + 1
    // Fresh ids must not collide with director-issued s1..s8 after deletes.
    const id = `u${Date.now().toString(36)}`
    onChange([...scenes, { id, title: `${t('xd.sb.scene')} ${n}`, script: '', shot: '', duration_s: 6, status: 'draft' }])
  }

  // Film numbering (owner's correction, Aug 6): EVERY card is a cut within
  // its scene, the opener included — S1·C1, S1·C2, S2·C1... A fresh setup
  // starts a new scene at cut 1; a continues card increments the cut. A
  // continues card with nothing before it opens scene 1 regardless.
  const labels: string[] = []
  {
    let sc = 0, cut = 0
    for (const sn of scenes) {
      if (sn.continues && sc > 0) cut += 1
      else { sc += 1; cut = 1 }
      labels.push(`S${sc}\u00b7C${cut}`)
    }
  }

  const drafts = scenes.filter(s => !s.status || s.status === 'draft' || s.status === 'error')
  const totalEst = scenes.reduce((sum, s) => sum + (s.status === 'done' ? (s.cost ?? 0) : (s.estimate ?? 0)), 0)
  const totalDur = scenes.reduce((sum, s) => sum + (s.duration_s || 0), 0)

  return (
    <div style={{ borderBottom: '1px solid var(--border)', padding: '10px 14px 12px', background: 'var(--bg)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 9 }}>
        <span style={{ ...label, color: 'var(--red)', fontWeight: 700 }}>{t('xd.sb.title')}</span>
        <span style={{ ...label }}>{scenes.length} · {totalDur}s</span>
        <span style={{ flex: 1 }} />
        {totalEst > 0 && (
          <span style={{ ...label, color: 'var(--muted2)' }}>{t('xd.sb.total')} ${totalEst.toFixed(2)}</span>
        )}
        {drafts.length > 1 && (
          <button
            onClick={onGenerateAll} disabled={busy}
            style={{
              padding: '4px 12px', borderRadius: 999, border: '1px solid var(--red)',
              background: 'var(--red-dim)', color: 'var(--red)', cursor: busy ? 'default' : 'pointer',
              fontFamily: 'var(--font-mono), monospace', fontSize: 10, fontWeight: 700,
              letterSpacing: '0.07em', opacity: busy ? 0.5 : 1,
            }}
          >▶▶ {t('xd.sb.genall')}</button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
        {scenes.map((s, i) => (
          <div key={s.id} style={{ ...card, borderColor: s.status === 'generating' ? 'var(--red)' : 'var(--border2)' }}>
            {/* Header: number, editable title, reorder / delete */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {s.continues && i > 0 && (
                <span title="continues the previous card (chained cut)" aria-label="cut" style={{ flexShrink: 0, fontSize: 11, color: 'var(--muted)' }}>🔗</span>
              )}
              <span style={{ ...label, color: 'var(--red)', flexShrink: 0 }}>{labels[i]}</span>
              <input
                value={s.title}
                onChange={e => patch(s.id, { title: e.target.value.slice(0, 80) })}
                style={{ ...area, padding: '2px 4px', fontWeight: 700, fontSize: 13, flex: 1, minWidth: 0 }}
              />
              <button style={iconBtn} aria-label="move left"  onClick={() => move(i, -1)} disabled={i === 0}>◀</button>
              <button style={iconBtn} aria-label="move right" onClick={() => move(i, 1)}  disabled={i === scenes.length - 1}>▶</button>
              {confirmDel === s.id ? (
                <button style={{ ...iconBtn, color: 'var(--red)', fontWeight: 700 }} onClick={() => remove(s.id)}>{t('xd.sb.confirmdel')}</button>
              ) : (
                <button style={iconBtn} aria-label="delete scene" onClick={() => { setConfirmDel(s.id); setTimeout(() => setConfirmDel(c => c === s.id ? null : c), 3500) }}>✕</button>
              )}
            </div>

            {/* Output, once there is one — clicking previews it full size. */}
            {s.url && s.status === 'done' && (
              <button
                onClick={() => onPreview(s.url!, true)}
                style={{ border: 'none', padding: 0, cursor: 'pointer', borderRadius: 8, overflow: 'hidden', background: '#000', height: 150 }}
              >
                <video src={s.url} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </button>
            )}

            {/* Script — the user-facing sentence(s). */}
            <div>
              <div style={label}>{t('xd.sb.script')}</div>
              <textarea
                rows={5} value={s.script}
                onChange={e => patch(s.id, { script: e.target.value.slice(0, 500) })}
                style={{ ...area, border: '1px solid var(--border)' }}
              />
            </div>

            {/* Shot prompt — folded by default. */}
            <div>
              <button
                onClick={() => setOpenShot(o => ({ ...o, [s.id]: !o[s.id] }))}
                style={{ ...iconBtn, ...label, padding: 0, cursor: 'pointer' }}
              >{openShot[s.id] ? '▾' : '▸'} {t('xd.sb.shot')}</button>
              {openShot[s.id] && (
                <textarea
                  rows={8} value={s.shot}
                  onChange={e => patch(s.id, { shot: e.target.value.slice(0, 1200) })}
                  style={{ ...area, border: '1px solid var(--border)', fontSize: 11.5, marginTop: 4 }}
                />
              )}
            </div>

            {/* Footer: duration · model · price · generate */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 'auto' }}>
              <input
                type="number" min={2} max={15} value={s.duration_s}
                onChange={e => patch(s.id, { duration_s: Math.min(Math.max(Math.round(Number(e.target.value) || 0), 2), 15) })}
                style={{ ...area, border: '1px solid var(--border)', width: 44, textAlign: 'center', padding: '2px 2px', fontSize: 11.5, flexShrink: 0 }}
              />
              <span style={{ ...label, flexShrink: 0 }}>s</span>
              <span style={{ fontSize: 10.5, color: 'var(--muted2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }} title={s.model_name ?? ''}>
                {s.model_name ?? '—'}
              </span>
              {s.status === 'generating' ? (
                <span className="nav-history-spin" aria-label="generating" style={{ flexShrink: 0 }} />
              ) : s.status === 'done' ? (
                <span style={{ ...label, color: 'var(--green)', flexShrink: 0 }}>${(s.cost ?? 0).toFixed(2)}</span>
              ) : (
                <button
                  onClick={() => onGenerate(s.id)} disabled={busy || !s.shot.trim()}
                  title={s.error ? `${s.error} — ${t('xd.sb.gen')}` : t('xd.sb.gen')}
                  style={{
                    padding: '3px 10px', borderRadius: 999, flexShrink: 0,
                    border: '1px solid ' + (s.status === 'error' ? 'var(--red)' : 'var(--border2)'),
                    background: 'transparent', cursor: (busy || !s.shot.trim()) ? 'default' : 'pointer',
                    color: s.status === 'error' ? 'var(--red)' : 'var(--white)',
                    fontFamily: 'var(--font-mono), monospace', fontSize: 10, fontWeight: 700,
                    opacity: (busy || !s.shot.trim()) ? 0.45 : 1,
                  }}
                >{s.status === 'error' ? '⚠ ' : '▶ '}{s.estimate != null ? `$${s.estimate.toFixed(2)}` : t('xd.sb.gen')}</button>
              )}
            </div>
          </div>
        ))}

        {/* Ghost card: add a scene by hand. */}
        <button
          onClick={addScene}
          style={{
            ...card, width: 140, alignItems: 'center', justifyContent: 'center',
            border: '1px dashed var(--border2)', background: 'transparent',
            color: 'var(--muted)', cursor: 'pointer', fontSize: 12, gap: 4,
          }}
        >
          <span style={{ fontSize: 18 }}>+</span>
          <span>{t('xd.sb.add')}</span>
        </button>
      </div>
    </div>
  )
}
