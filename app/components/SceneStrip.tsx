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

import { useRef, useState } from 'react'
import { useT } from '../../lib/i18n'
import ModelPickerDialog from './ModelPickerDialog'
import { pendingAttachment, commitAttachments } from './AttachmentButton'

/** A committed reference on a scene card (owner ask, Aug 8): serializable
 *  descriptor only — the storyboard jsonb persists it, and generation for
 *  THAT scene uses these files instead of the conversation's attachments.
 *  previewUrl is a session-local object URL; dead after reload (chip shows
 *  the filename instead). */
export type SceneRef = {
  storagePath: string
  bucket: string
  mediaType: string
  fileName: string
  fileSize: number
  previewUrl?: string
}

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
  refs?: SceneRef[]
  status?: 'draft' | 'generating' | 'done' | 'error'
  row_id?: string
  url?: string
  cost?: number
  error?: string
}

const MAX_SCENE_REFS = 4

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
  // Per-scene reference upload + per-scene model picker (owner ask, Aug 8).
  const refInputRef = useRef<HTMLInputElement>(null)
  const refSceneId = useRef<string | null>(null)
  const [uploadingRef, setUploadingRef] = useState<string | null>(null)
  const [pickerFor, setPickerFor] = useState<string | null>(null)

  if (scenes.length === 0) return null

  const patch = (id: string, p: Partial<Scene>) =>
    onChange(scenes.map(s => s.id === id ? { ...s, ...p } : s))

  const addRef = async (file: File) => {
    const id = refSceneId.current
    refSceneId.current = null
    if (!id) return
    setUploadingRef(id)
    try {
      const pending = pendingAttachment(file, 'xcreate')
      const [committed] = await commitAttachments([pending])
      if (!committed?.storagePath) return
      const sc = scenes.find(s => s.id === id)
      const refs: SceneRef[] = [...(sc?.refs ?? []), {
        storagePath: committed.storagePath, bucket: committed.bucket,
        mediaType: committed.mediaType, fileName: committed.fileName,
        fileSize: committed.fileSize, previewUrl: pending.previewUrl,
      }].slice(0, MAX_SCENE_REFS)
      // First reference flips the scene to a reference-consuming recipe.
      // The old model was picked for text-only, so it resets to '—' and the
      // picker (now filtered to image_to_video models) chooses honestly.
      const first = (sc?.refs ?? []).length === 0
      patch(id, {
        refs,
        ...(first && (!sc?.recipe || sc.recipe === 'text_to_video')
          ? { recipe: 'image_to_video', model_id: undefined, model_name: undefined, estimate: undefined }
          : {}),
      })
    } catch { /* failed upload leaves the card unchanged */ }
    finally { setUploadingRef(null) }
  }

  const removeRef = (id: string, storagePath: string) => {
    const sc = scenes.find(s => s.id === id)
    const rest = (sc?.refs ?? []).filter(r => r.storagePath !== storagePath)
    patch(id, {
      refs: rest,
      // Last reference gone: an image_to_video recipe has no input any
      // more — fall back to text_to_video (i2v models speak t2v too).
      ...(rest.length === 0 && sc?.recipe === 'image_to_video' ? { recipe: 'text_to_video' } : {}),
    })
  }
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

            {/* References — this scene's own visual anchors (Aug 8). */}
            <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
              {(s.refs ?? []).map(r => (
                <span key={r.storagePath} title={r.fileName} style={{ position: 'relative', display: 'inline-flex' }}>
                  {r.previewUrl && r.mediaType.startsWith('image/') ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.previewUrl} alt="" style={{ width: 34, height: 34, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} />
                  ) : (
                    <span style={{ width: 34, height: 34, borderRadius: 6, border: '1px solid var(--border)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, background: 'var(--surface2)' }}>
                      {r.mediaType.startsWith('video/') ? '🎞' : '🖼'}
                    </span>
                  )}
                  <button onClick={() => removeRef(s.id, r.storagePath)} aria-label="remove reference"
                    style={{ position: 'absolute', top: -5, right: -5, width: 15, height: 15, borderRadius: 999, border: 'none', background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 8, cursor: 'pointer', lineHeight: 1, padding: 0 }}>✕</button>
                </span>
              ))}
              {(s.refs ?? []).length < MAX_SCENE_REFS && (
                <button
                  onClick={() => { refSceneId.current = s.id; refInputRef.current?.click() }}
                  disabled={uploadingRef === s.id}
                  title={t('xd.sb.addref')} aria-label={t('xd.sb.addref')}
                  style={{ width: 34, height: 34, borderRadius: 6, border: '1px dashed var(--border2)', background: 'none', color: 'var(--muted)', fontSize: 13, cursor: 'pointer' }}
                >{uploadingRef === s.id ? '…' : '📎'}</button>
              )}
              {(s.refs ?? []).length > 0 && (
                <span style={{ ...label, color: 'var(--muted2)' }}>{s.recipe ?? 'image_to_video'}</span>
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
              <button
                onClick={() => setPickerFor(s.id)}
                title={s.model_name ?? t('xd.sb.pickmodel')}
                style={{
                  fontSize: 10.5, color: s.model_name ? 'var(--muted2)' : 'var(--red)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
                  border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left',
                  textDecoration: 'underline dotted', textUnderlineOffset: 3, padding: 0,
                }}
              >
                {s.model_name ?? `☰ ${t('xd.sb.pickmodel')}`}
              </button>
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

      {/* One shared file input serves every card's 📎. */}
      <input
        ref={refInputRef} type="file" style={{ display: 'none' }}
        accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm"
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void addRef(f) }}
      />

      {/* Per-scene model picker: refs present → only models that can eat
          them; none → text_to_video models. Same dialog as everywhere. */}
      {pickerFor && (() => {
        const sc = scenes.find(s => s.id === pickerFor)
        if (!sc) return null
        // Any scene that consumes images — card refs OR a chained cut —
        // offers BOTH families (owner override, Aug 9: excluding reference
        // models from 🔗 scenes read as a bug). The nuance lives in the
        // recipe resolution below: a cut PREFERS image_to_video (locks the
        // opening frame), a refs scene PREFERS reference recipes (keeps
        // the subject); picking a model that only speaks the other family
        // is allowed — the user's call outranks the doctrine.
        const hasRefs = (sc.refs ?? []).length > 0
        const recipeMode: any = (sc.continues || hasRefs)
          ? ['image_to_video', 'reference_frames']
          : 'text_to_video'
        return (
          <ModelPickerDialog
            mode="video" recipeMode={recipeMode as any} slotIds={[]}
            onClose={() => setPickerFor(null)}
            onSelect={(m: any) => {
              // Cheapest listed per-second rate — same estimate rule the
              // director itself uses.
              const ps = m.model_pricing?.per_video_second
              const perSec = ps && typeof ps === 'object'
                ? Math.min(...Object.values(ps).map(Number).filter((n: any) => Number.isFinite(n)))
                : null
              // The union resolves to whatever the picked model speaks:
              // a cut prefers image_to_video (locks the opening frame), a
              // refs scene prefers reference recipes (keeps the subject) —
              // and either falls back to what the model actually supports.
              const modes: string[] = m.modes ?? []
              const recipe = Array.isArray(recipeMode)
                ? (sc.continues
                  ? (modes.includes('image_to_video') ? 'image_to_video' : 'reference_frames')
                  : (modes.includes('reference_frames') ? 'reference_frames' : 'image_to_video'))
                : recipeMode
              patch(sc.id, {
                model_id: m.id, model_name: m.display_name, recipe,
                ...(Number.isFinite(perSec as number) ? { estimate: (perSec as number) * (sc.duration_s || 6) } : {}),
              })
              setPickerFor(null)
            }}
          />
        )
      })()}
    </div>
  )
}
