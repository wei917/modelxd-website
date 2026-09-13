'use client'
// app/xarch/client.tsx — XArch (X建築設計): your projects, and the studio for one.
//
// The studio is the owner's layout (Sep 13): the blueprint and each room's
// photos/videos side by side, either can take focus; click any part of the
// blueprint for a menu (edit it, or open that room's media); and a design
// agent to talk to, like XDirect. Architects return ops, code applies them
// (lib/xarch.ts), every change is undoable.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import { useT } from '../../lib/i18n'
import { useRequireAuth } from '../../lib/useRequireAuth'
import { pendingAttachment, commitAttachments } from '../components/AttachmentButton'
import PlanCanvas, { type PlanClick } from '../components/PlanCanvas'
import { ARCHITECTS, labelMismatches, roomSize, fmtFt, type ArchitectId, type Kind, type Media, type Plan, type Selection } from '../../lib/xarch'

const MaskEditor = dynamic(() => import('../components/MaskEditor'), { ssr: false })

type SignedMedia = Media & { url: string | null }
type ChatTurn = { role: 'user' | 'assistant'; text: string; at: string; architect?: string; action?: any }
type Project = {
  id: string; title: string; status: 'reading' | 'ready' | 'failed'; error: string | null; architect: string
  plan: Plan | null; can_undo: boolean; media: SignedMedia[]; chat: ChatTurn[]
  plan_image_url: string | null; spent_cents: number; is_sample: boolean; updated_at: string
}
type ListRow = { id: string; title: string; status: string; is_sample: boolean; spent_cents: number; updated_at: string; thumb_url: string | null }
type EditResult = { changed: string[]; notes: string; warnings: string[]; errors: string[]; issues: { id: string; issue: string }[]; cost_cents: number }

const QUICK: Record<Kind, string[]> = {
  walls: ['xarch.q.removeWall', 'xarch.q.moveWall', 'xarch.q.addDoorway'],
  rooms: ['xarch.q.larger', 'xarch.q.split', 'xarch.q.rename'],
  doors: ['xarch.q.moveDoor', 'xarch.q.removeDoor', 'xarch.q.widen'],
  windows: ['xarch.q.removeWindow', 'xarch.q.widerWindow'],
  stairs: ['xarch.q.moveStairs'],
}

const money = (c: number) => `$${(c / 100).toFixed(2)}`

export default function XArchClient() {
  const t = useT()
  const router = useRouter()
  const params = useSearchParams()
  useRequireAuth()
  const pid = params.get('p')

  // ── List ────────────────────────────────────────────────────────────
  const [list, setList] = useState<ListRow[] | null>(null)
  const [listErr, setListErr] = useState<string | null>(null)
  const [readArchitect, setReadArchitect] = useState<ArchitectId>('astra')
  const [starting, setStarting] = useState(false)
  const planInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (pid) return
    fetch('/api/xarch/projects').then(async r => {
      const d = await r.json().catch(() => null)
      if (!r.ok) { setListErr(d?.error ?? `HTTP ${r.status}`); setList([]); return }
      setList(d.projects ?? [])
    })
  }, [pid])

  const start = async (body: object) => {
    setStarting(true); setListErr(null)
    try {
      const r = await fetch('/api/xarch/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await r.json().catch(() => null)
      if (r.status === 402) throw new Error(t('xarch.nocredits'))
      if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`)
      router.push(`/xarch?p=${d.id}`)
    } catch (e: any) { setListErr(e?.message ?? 'Failed') } finally { setStarting(false) }
  }
  const uploadPlan = async (files: FileList | null) => {
    const f = files?.[0]; if (!f) return
    setStarting(true)
    try {
      const [att] = await commitAttachments([pendingAttachment(f, 'xcreate')])
      await start({ upload: { bucket: att.bucket, storagePath: att.storagePath, mediaType: att.mediaType }, architect: readArchitect, title: f.name.replace(/\.[^.]+$/, '') })
    } catch (e: any) { setListErr(e?.message ?? 'Upload failed'); setStarting(false) }
    if (planInput.current) planInput.current.value = ''
  }

  // ── Studio ──────────────────────────────────────────────────────────
  const [project, setProject] = useState<Project | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [selection, setSelection] = useState<Selection>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; sel: NonNullable<Selection> } | null>(null)
  const [editText, setEditText] = useState('')
  const [architect, setArchitect] = useState<ArchitectId>('fable')
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<EditResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [highlight, setHighlight] = useState<Set<string>>(new Set())
  const [focus, setFocus] = useState<'both' | 'plan' | 'media'>('both')
  const [panel, setPanel] = useState<'media' | 'agent'>('media')
  const [roomId, setRoomId] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [photoPrompt, setPhotoPrompt] = useState('')
  const [mask, setMask] = useState<{ file: File; preview: string } | null>(null)
  const [maskOpen, setMaskOpen] = useState(false)
  const [showDrawing, setShowDrawing] = useState(true)
  const [chatText, setChatText] = useState('')
  const mediaInput = useRef<HTMLInputElement>(null)
  const chatEnd = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    if (!pid) return
    const r = await fetch(`/api/xarch/projects/${pid}`)
    const d = await r.json().catch(() => null)
    if (!r.ok) { setLoadErr(d?.error ?? `HTTP ${r.status}`); return }
    setProject(d.project)
  }, [pid])
  useEffect(() => { setProject(null); setSelection(null); setResult(null); load() }, [load])

  // A plan being read polls itself (hidden tabs don't — Common Pitfall #9).
  useEffect(() => {
    if (project?.status !== 'reading') return
    const h = setInterval(() => { if (!document.hidden) load() }, 5000)
    return () => clearInterval(h)
  }, [project?.status, load])

  // The scan underneath shows the ORIGINAL layout. Once the plan has been
  // edited it contradicts the geometry (the old kitchen wall stays drawn),
  // which made a successful edit look like nothing happened — so it starts
  // hidden on an edited plan.
  const editedOnLoad = useRef<string | null>(null)
  useEffect(() => {
    if (project && editedOnLoad.current !== project.id) { editedOnLoad.current = project.id; setShowDrawing(!project.can_undo) }
  }, [project])

  useEffect(() => { chatEnd.current?.scrollIntoView({ block: 'end' }) }, [project?.chat?.length, panel])

  const plan = project?.plan ?? null
  const mismatches = useMemo(() => plan ? labelMismatches(plan) : [], [plan])
  const flagged = useMemo(() => new Set(mismatches.map(m => m.id)), [mismatches])
  const roomName = (id: string | null) => plan?.rooms.find(r => r.id === id)?.name ?? t('xarch.wholeHouse')
  const nameOf = (s: Selection) => {
    if (!s || !plan) return ''
    if (s.kind === 'rooms') return roomName(s.id)
    return `${t(`xarch.kind.${s.kind}`)} ${s.id}`
  }

  const flash = (ids: string[]) => {
    setHighlight(new Set(ids))
    setTimeout(() => setHighlight(new Set()), 6000)
  }

  const call = async (label: string, url: string, body: object, method = 'POST') => {
    setBusy(label); setError(null)
    try {
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await r.json().catch(() => null)
      if (r.status === 402) throw new Error(t('xarch.nocredits'))
      if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`)
      if (d?.project) setProject(d.project)
      return d
    } catch (e: any) { setError(e?.message ?? 'Failed'); return null } finally { setBusy(null) }
  }

  const runEdit = async (instruction: string, sel: Selection) => {
    // One architect call at a time: two in flight used to race and the
    // later write erased the earlier edit (Sep 13).
    if (!project || !instruction.trim() || busy) return
    setMenu(null); setResult(null)
    const d = await call('edit', `/api/xarch/projects/${project.id}/edit`, { instruction, selection: sel, architect })
    if (d?.result) {
      setResult(d.result); flash(d.result.changed); setEditText('')
      if (d.result.changed.length) setShowDrawing(false)
    }
  }
  const undo = async () => { if (project) { await call('undo', `/api/xarch/projects/${project.id}`, { undo: true }, 'PATCH'); setResult(null) } }

  const onPick = (c: PlanClick) => {
    setSelection(c.selection)
    const rect = document.getElementById('xarch-stage')?.getBoundingClientRect()
    setMenu({ x: c.clientX - (rect?.left ?? 0), y: c.clientY - (rect?.top ?? 0), sel: c.selection })
    setEditText('')
    if (c.selection.kind === 'rooms') setRoomId(c.selection.id)
  }

  const addMedia = async (files: FileList | null) => {
    if (!project || !files?.length) return
    setBusy('upload')
    try {
      const atts = await commitAttachments(Array.from(files).slice(0, 10).map(f => pendingAttachment(f, 'xcreate')))
      await call('upload', `/api/xarch/projects/${project.id}/media`, { room_id: roomId, items: atts.map(a => ({ bucket: a.bucket, storagePath: a.storagePath, mediaType: a.mediaType })) })
    } catch (e: any) { setError(e?.message ?? 'Upload failed') } finally { setBusy(null) }
    if (mediaInput.current) mediaInput.current.value = ''
  }

  const editPhotoNow = async () => {
    if (!project || !open || !photoPrompt.trim()) return
    let maskRef: { bucket: string; storagePath: string } | null = null
    if (mask) {
      const [m] = await commitAttachments([pendingAttachment(mask.file, 'xcreate')])
      maskRef = { bucket: m.bucket, storagePath: m.storagePath }
    }
    const d = await call('photo', `/api/xarch/projects/${project.id}/photo`, { media_id: open, prompt: photoPrompt, mask: maskRef })
    if (d?.media_id) { setOpen(d.media_id); setPhotoPrompt(''); setMask(null) }
  }

  const sendChat = async () => {
    if (!project || !chatText.trim() || busy) return
    const message = chatText
    setChatText('')
    setProject(p => p ? { ...p, chat: [...p.chat, { role: 'user', text: message, at: new Date().toISOString() }] } : p)
    const d = await call('chat', `/api/xarch/projects/${project.id}/chat`, { message, selection, architect })
    if (!d) setProject(p => p ? { ...p, chat: p.chat.slice(0, -1) } : p)
    if (d?.action?.type === 'edit_plan') { flash(d.action.changed ?? []); setShowDrawing(false) }
    if (d?.action?.type === 'edit_photo' && d.action.media_id) { setRoomId(d.action.room_id ?? null); setOpen(d.action.media_id) }
  }

  const mono: React.CSSProperties = { fontSize: 10.5, fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)' }
  const chip = (active = false): React.CSSProperties => ({
    padding: '6px 12px', borderRadius: 999, fontSize: 12.5, cursor: 'pointer', whiteSpace: 'nowrap',
    border: `1px solid ${active ? 'var(--red)' : 'var(--border2)'}`, background: active ? 'var(--surface2)' : 'var(--surface)', color: 'var(--white)',
  })
  const primary = (on: boolean): React.CSSProperties => ({
    padding: '8px 16px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 600,
    background: on ? 'var(--red)' : 'var(--border2)', color: '#fff', cursor: on ? 'pointer' : 'default',
  })
  const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '9px 11px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--white)', fontSize: 13.5, fontFamily: 'var(--font-body)' }

  // ── List view ───────────────────────────────────────────────────────
  if (!pid) {
    return (
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '36px 24px 60px' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 34, margin: 0, color: 'var(--white)' }}>{t('nav.xarch')}</h1>
        <p style={{ color: 'var(--muted)', fontSize: 15, margin: '6px 0 24px', maxWidth: 720 }}>{t('xarch.sub')}</p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14 }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--white)' }}>🏠 {t('xarch.sample.title')}</div>
            <p style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.5 }}>{t('xarch.sample.body')}</p>
            <button disabled={starting} onClick={() => start({ sample: true })} style={primary(!starting)}>{t('xarch.sample.open')}</button>
          </div>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--white)' }}>📐 {t('xarch.upload.title')}</div>
            <p style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.5 }}>{t('xarch.upload.body')}</p>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
              {(Object.keys(ARCHITECTS) as ArchitectId[]).map(a => (
                <button key={a} onClick={() => setReadArchitect(a)} style={chip(readArchitect === a)}>
                  {ARCHITECTS[a].label} <span style={{ color: 'var(--muted)' }}>~{money(ARCHITECTS[a].readEstimateCents)} · {t(`xarch.read.${a}`)}</span>
                </button>
              ))}
            </div>
            <button disabled={starting} onClick={() => planInput.current?.click()} style={primary(!starting)}>{starting ? '…' : t('xarch.upload.button')}</button>
            <input ref={planInput} type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={e => uploadPlan(e.target.files)} />
          </div>
        </div>
        {listErr && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 12 }}>{listErr}</div>}

        <div style={{ ...mono, margin: '32px 0 12px' }}>{t('xarch.mine')}</div>
        {list === null ? <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
          : list.length === 0 ? <div style={{ color: 'var(--muted)', fontSize: 13 }}>{t('xarch.empty')}</div>
          : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 14 }}>
              {list.map(p => (
                <a key={p.id} href={`/xarch?p=${p.id}`} style={{ textDecoration: 'none', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{ aspectRatio: '16 / 10', background: '#fff', display: 'grid', placeItems: 'center' }}>
                    {p.thumb_url ? <img src={p.thumb_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : null}
                  </div>
                  <div style={{ padding: '10px 12px' }}>
                    <div style={{ fontSize: 13, color: 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.title}</div>
                    <div style={{ ...mono, fontSize: 9.5, marginTop: 4 }}>{p.status === 'ready' ? money(p.spent_cents) : t(`xarch.status.${p.status}`)} · {new Date(p.updated_at).toLocaleDateString()}</div>
                  </div>
                </a>
              ))}
            </div>}
      </div>
    )
  }

  // ── Studio view ─────────────────────────────────────────────────────
  if (loadErr) return <div style={{ padding: 40, color: 'var(--red)' }}>{loadErr} <a href="/xarch">←</a></div>
  if (!project) return <div style={{ padding: 40, color: 'var(--muted)' }}>Loading…</div>

  const roomMedia = project.media.filter(m => roomId === null || m.room_id === roomId)
  const openItem = project.media.find(m => m.id === open) ?? null
  const openSource = openItem?.source_id ? project.media.find(m => m.id === openItem.source_id) : null
  const cols = focus === 'plan' ? '1fr 0px' : focus === 'media' ? '0px 1fr' : 'minmax(0, 1.35fr) minmax(360px, 1fr)'

  return (
    <div style={{ height: 'calc(100vh - 20px)', display: 'flex', flexDirection: 'column', padding: '14px 18px', boxSizing: 'border-box', gap: 10 }}>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <a href="/xarch" style={{ ...mono, textDecoration: 'none' }}>← {t('nav.xarch')}</a>
        <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--white)', marginRight: 'auto' }}>{project.title}</div>
        <span style={mono}>{t('xarch.architect')}</span>
        {(Object.keys(ARCHITECTS) as ArchitectId[]).map(a => (
          <button key={a} onClick={() => setArchitect(a)} style={chip(architect === a)}>{ARCHITECTS[a].label}</button>
        ))}
        <span style={{ width: 1, height: 22, background: 'var(--border2)' }} />
        {(['both', 'plan', 'media'] as const).map(f => (
          <button key={f} onClick={() => setFocus(f)} style={chip(focus === f)}>{t(`xarch.focus.${f}`)}</button>
        ))}
        <button disabled={!project.can_undo || !!busy} onClick={undo} style={chip()}>↶ {t('xarch.undo')}</button>
        <span style={mono}>{t('xarch.spent')} {money(project.spent_cents)}</span>
      </div>

      {project.status === 'reading' && (
        <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--muted)', textAlign: 'center' }}>
          <div>
            <div style={{ fontSize: 16, color: 'var(--white)', marginBottom: 6 }}>📐 {t('xarch.reading')}</div>
            <div style={{ fontSize: 13 }}>{t('xarch.readingNote')}</div>
            {project.plan_image_url && <img src={project.plan_image_url} alt="" style={{ maxWidth: 560, maxHeight: 360, marginTop: 16, opacity: 0.6, background: '#fff' }} />}
          </div>
        </div>
      )}
      {project.status === 'failed' && <div style={{ color: 'var(--red)', padding: 30 }}>{t('xarch.readFailed')}: {project.error}</div>}

      {project.status === 'ready' && plan && (
        <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: cols, gap: focus === 'both' ? 12 : 0 }}>
          {/* ── Blueprint ── */}
          <div id="xarch-stage" style={{ position: 'relative', minWidth: 0, minHeight: 0, display: focus === 'media' ? 'none' : 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ ...mono, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={showDrawing} onChange={e => setShowDrawing(e.target.checked)} /> {t('xarch.showDrawing')}
              </label>
              {project.can_undo && showDrawing && <span style={{ fontSize: 11.5, color: '#b45309' }}>{t('xarch.drawingOld')}</span>}
              <span style={mono}>
                {plan.scale ? `${t('xarch.scale')} ${plan.scale.px_per_ft.toFixed(1)} px/ft` : t('xarch.noScale')}
                {plan.overall_ft?.width && plan.overall_ft?.depth ? ` · ${fmtFt(plan.overall_ft.width)} × ${fmtFt(plan.overall_ft.depth)}` : ''}
              </span>
              <span style={{ ...mono, marginLeft: 'auto' }}>{t('xarch.clickHint')}</span>
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <PlanCanvas plan={plan} imageUrl={project.plan_image_url} selection={selection} highlight={highlight} flagged={flagged} showDrawing={showDrawing}
                onPick={onPick} onClear={() => { setMenu(null); setSelection(null) }} />
            </div>

            {/* Result of the last edit */}
            {(result || busy === 'edit' || error) && (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: 'var(--white)' }}>
                {busy === 'edit' && <div style={{ color: 'var(--muted)' }}>{t('xarch.working')} ({ARCHITECTS[architect].label})…</div>}
                {error && <div style={{ color: 'var(--red)' }}>{error}</div>}
                {result && <>
                  <div>{result.changed.length ? '✓ ' : ''}{result.notes || t('xarch.noChange')} <span style={{ ...mono, marginLeft: 6 }}>{money(result.cost_cents)}</span></div>
                  {result.warnings.map((w, i) => <div key={i} style={{ color: '#b45309', marginTop: 4 }}>⚠ {w}</div>)}
                  {result.errors.map((w, i) => <div key={`e${i}`} style={{ color: 'var(--red)', marginTop: 4 }}>✕ {w}</div>)}
                  {result.issues.length > 0 && <div style={{ color: '#a21caf', marginTop: 4, fontSize: 12 }}>◇ {t('xarch.checkJoints')}: {result.issues.map(i => i.id).join(', ')}</div>}
                </>}
              </div>
            )}
            {mismatches.length > 0 && !result && (
              <div style={{ fontSize: 12, color: '#a21caf' }}>
                {mismatches.map(m => `${roomName(m.id)}: ${t('xarch.label')} ${m.label}, ${t('xarch.drawn')} ${m.measured}`).join(' · ')} — {t('xarch.checkOutline')}
              </div>
            )}

            {/* Click menu */}
            {menu && (
              <div onClick={e => e.stopPropagation()} style={{
                position: 'absolute', left: Math.min(menu.x + 8, 9999), top: menu.y + 8, zIndex: 20, width: 330,
                background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 12, padding: 12, boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ fontWeight: 600, color: 'var(--white)', fontSize: 14 }}>{nameOf(menu.sel)}</div>
                  {menu.sel.kind === 'rooms' && plan && (() => { const s = roomSize(plan, plan.rooms.find(r => r.id === menu.sel.id)!); return s ? <span style={{ ...mono, marginLeft: 8 }}>{fmtFt(s.w)} × {fmtFt(s.d)}</span> : null })()}
                  <button onClick={() => setMenu(null)} style={{ marginLeft: 'auto', border: 'none', background: 'none', color: 'var(--muted)', cursor: 'pointer' }}>✕</button>
                </div>
                <div style={mono}>1 · {t('xarch.menu.edit')}</div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', margin: '6px 0' }}>
                  {QUICK[menu.sel.kind].map(k => <button key={k} onClick={() => setEditText(t(k))} style={{ ...chip(), fontSize: 11.5, padding: '4px 9px' }}>{t(k)}</button>)}
                </div>
                <textarea value={editText} onChange={e => setEditText(e.target.value)} rows={2} placeholder={t('xarch.menu.placeholder')} style={{ ...input, resize: 'vertical' }}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); runEdit(editText, menu.sel) } }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                  <button disabled={!editText.trim() || !!busy} onClick={() => runEdit(editText, menu.sel)} style={primary(!!editText.trim() && !busy)}>{t('xarch.menu.apply')}</button>
                  <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{ARCHITECTS[architect].label} · ~{money(ARCHITECTS[architect].editEstimateCents)}</span>
                </div>
                <div style={{ ...mono, marginTop: 12 }}>2 · {t('xarch.menu.media')}</div>
                <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                  <button onClick={() => { setRoomId(menu.sel.kind === 'rooms' ? menu.sel.id : null); setPanel('media'); setFocus(f => f === 'plan' ? 'both' : f); setOpen(null); setMenu(null) }} style={chip()}>
                    🖼 {menu.sel.kind === 'rooms' ? `${project.media.filter(m => m.room_id === menu.sel.id).length} · ${t('xarch.menu.openMedia')}` : t('xarch.menu.allMedia')}
                  </button>
                  <button onClick={() => { setPanel('agent'); setFocus(f => f === 'plan' ? 'both' : f); setMenu(null) }} style={chip()}>💬 {t('xarch.menu.ask')}</button>
                </div>
              </div>
            )}
          </div>

          {/* ── Right panel: media / agent ── */}
          <div style={{ minWidth: 0, minHeight: 0, display: focus === 'plan' ? 'none' : 'flex', flexDirection: 'column', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border2)' }}>
              {(['media', 'agent'] as const).map(p => (
                <button key={p} onClick={() => setPanel(p)} style={{ flex: 1, padding: '11px 0', border: 'none', background: 'transparent', cursor: 'pointer', color: panel === p ? 'var(--white)' : 'var(--muted)', borderBottom: panel === p ? '2px solid var(--red)' : '2px solid transparent', fontSize: 13, fontWeight: 600 }}>
                  {p === 'media' ? `🖼 ${t('xarch.panel.media')}` : `💬 ${t('xarch.panel.agent')}`}
                </button>
              ))}
            </div>

            {panel === 'media' && (
              <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 14 }}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                  <button onClick={() => { setRoomId(null); setOpen(null) }} style={chip(roomId === null)}>{t('xarch.allRooms')} · {project.media.length}</button>
                  {plan.rooms.map(r => {
                    const n = project.media.filter(m => m.room_id === r.id).length
                    return <button key={r.id} onClick={() => { setRoomId(r.id); setOpen(null); setSelection({ kind: 'rooms', id: r.id }) }} style={chip(roomId === r.id)}>{r.name} · {n}</button>
                  })}
                </div>

                {openItem ? (
                  <div>
                    <button onClick={() => { setOpen(null); setMask(null) }} style={{ ...mono, border: 'none', background: 'none', cursor: 'pointer', padding: 0, marginBottom: 8 }}>← {roomName(openItem.room_id)}</button>
                    {openItem.mediaType.startsWith('video/')
                      ? <video src={openItem.url ?? undefined} controls style={{ width: '100%', borderRadius: 8, background: '#000' }} />
                      : <img src={openItem.url ?? undefined} alt="" style={{ width: '100%', borderRadius: 8 }} />}
                    {openItem.kind === 'edit' && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>✨ {openItem.prompt}{openSource && <> · <button onClick={() => setOpen(openSource.id)} style={{ border: 'none', background: 'none', color: 'var(--blue)', cursor: 'pointer', padding: 0, fontSize: 12 }}>{t('xarch.original')}</button></>}</div>}
                    {openItem.mediaType.startsWith('image/') && (
                      <div style={{ marginTop: 12 }}>
                        <div style={mono}>{t('xarch.photo.title')}</div>
                        <textarea value={photoPrompt} onChange={e => setPhotoPrompt(e.target.value)} rows={2} placeholder={t('xarch.photo.placeholder')} style={{ ...input, marginTop: 6, resize: 'vertical' }} />
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '6px 0' }}>
                          {['xarch.p.sofa', 'xarch.p.style', 'xarch.p.walls', 'xarch.p.floor', 'xarch.p.declutter'].map(k => <button key={k} onClick={() => setPhotoPrompt(t(k))} style={{ ...chip(), fontSize: 11.5, padding: '4px 9px' }}>{t(k)}</button>)}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <button onClick={() => setMaskOpen(true)} style={chip(!!mask)}>◐ {mask ? t('xarch.photo.maskSet') : t('xarch.photo.mask')}</button>
                          {mask && <button onClick={() => setMask(null)} style={{ ...chip(), fontSize: 11 }}>✕</button>}
                          <button disabled={!photoPrompt.trim() || !!busy} onClick={editPhotoNow} style={primary(!!photoPrompt.trim() && !busy)}>{busy === 'photo' ? t('xarch.working') + '…' : t('xarch.photo.apply')}</button>
                          <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>GPT Image 2 · ~$0.06</span>
                        </div>
                        {error && busy === null && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 6 }}>{error}</div>}
                      </div>
                    )}
                    {maskOpen && openItem.url && (
                      <MaskEditor imageUrl={openItem.url} onClose={() => setMaskOpen(false)} onSave={(file, preview) => { setMask({ file, preview }); setMaskOpen(false) }} />
                    )}
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
                      {roomMedia.map(m => (
                        <button key={m.id} onClick={() => setOpen(m.id)} style={{ padding: 0, border: '1px solid var(--border2)', borderRadius: 8, overflow: 'hidden', cursor: 'pointer', background: 'var(--surface2)', position: 'relative', aspectRatio: '4 / 3' }}>
                          {m.mediaType.startsWith('video/')
                            ? <video src={m.url ?? undefined} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            : <img src={m.url ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                          <span style={{ position: 'absolute', left: 4, bottom: 4, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 10, padding: '1px 6px', borderRadius: 4 }}>
                            {m.kind === 'edit' ? '✨ ' : ''}{roomName(m.room_id)}
                          </span>
                        </button>
                      ))}
                      <button onClick={() => mediaInput.current?.click()} disabled={!!busy} style={{ border: '1px dashed var(--border2)', borderRadius: 8, background: 'transparent', color: 'var(--muted)', cursor: 'pointer', aspectRatio: '4 / 3', fontSize: 12 }}>
                        {busy === 'upload' ? '…' : `+ ${t('xarch.addMedia')}${roomId ? `\n${roomName(roomId)}` : ''}`}
                      </button>
                    </div>
                    {roomMedia.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 12.5, marginTop: 10 }}>{t('xarch.noMedia')}</div>}
                  </>
                )}
                <input ref={mediaInput} type="file" hidden multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" onChange={e => addMedia(e.target.files)} />
              </div>
            )}

            {panel === 'agent' && (
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                <div style={{ flex: 1, overflow: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {project.chat.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.55 }}>{t('xarch.agent.intro')}</div>}
                  {project.chat.map((m, i) => (
                    <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '88%' }}>
                      <div style={{ background: m.role === 'user' ? 'var(--surface2)' : 'transparent', border: m.role === 'user' ? 'none' : '1px solid var(--border2)', borderRadius: 10, padding: '8px 11px', fontSize: 13.5, color: 'var(--white)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{m.text}</div>
                      {m.action?.type === 'edit_plan' && (
                        <div style={{ fontSize: 11.5, marginTop: 4, color: 'var(--muted)' }}>
                          📐 {m.action.notes} {(m.action.warnings ?? []).map((w: string, j: number) => <div key={j} style={{ color: '#b45309' }}>⚠ {w}</div>)}
                        </div>
                      )}
                      {m.action?.type === 'edit_photo' && (
                        m.action.error
                          ? <div style={{ fontSize: 11.5, marginTop: 4, color: 'var(--red)' }}>✕ {m.action.error}</div>
                          : <button onClick={() => { setPanel('media'); setRoomId(m.action.room_id ?? null); setOpen(m.action.media_id) }} style={{ ...chip(), fontSize: 11.5, marginTop: 4 }}>✨ {t('xarch.agent.seePhoto')}</button>
                      )}
                    </div>
                  ))}
                  {busy === 'chat' && <div style={{ color: 'var(--muted)', fontSize: 12.5 }}>{ARCHITECTS[architect].label} {t('xarch.agent.thinking')}…</div>}
                  <div ref={chatEnd} />
                </div>
                {error && panel === 'agent' && <div style={{ color: 'var(--red)', fontSize: 12, padding: '0 14px' }}>{error}</div>}
                <div style={{ borderTop: '1px solid var(--border2)', padding: 10 }}>
                  {selection && <div style={{ ...mono, marginBottom: 6 }}>{t('xarch.agent.about')}: {nameOf(selection)} <button onClick={() => setSelection(null)} style={{ border: 'none', background: 'none', color: 'var(--muted)', cursor: 'pointer' }}>✕</button></div>}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <textarea value={chatText} onChange={e => setChatText(e.target.value)} rows={2} placeholder={t('xarch.agent.placeholder')} style={{ ...input, resize: 'none' }}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); sendChat() } }} />
                    <button disabled={!chatText.trim() || !!busy} onClick={sendChat} style={primary(!!chatText.trim() && !busy)}>↑</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      <div style={{ fontSize: 11, color: 'var(--muted2)' }}>{t('xarch.disclaimer')}</div>
    </div>
  )
}
