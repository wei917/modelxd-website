'use client'
// app/components/XCutEditor.tsx — XCut's editor: preview player, three
// tracks (video sequence / audio / subtitles), the asset bin (XDirect,
// XCreate, XDuel, uploads), an inspector, autosave, export.
//
// The timeline math lives in lib/xcut-timeline.ts (pure); this file is the
// chrome and the playback engine. Playback is a real play-through of the
// sequence: one <video> element plays the current clip from its in-point,
// hands over at the out-point, images are held by the clock, audio clips
// are <audio> elements kept in sync with the playhead, subtitles overlay.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useT } from '../../lib/i18n'
import AttachmentButton, { commitAttachments, type Attachment } from './AttachmentButton'
import XCutLibrary, { type LibraryItem } from './XCutLibrary'
import {
  type Timeline, type VideoClip, type AudioClip, type Subtitle, type MediaSrc,
  clipStarts, clipLength, totalDuration, locate, trimClip, splitAt, moveClip, removeClip, insertClip, newId, cleanTimeline,
} from '../../lib/xcut-timeline'
import { downloadUrl, safeFilename } from '../../lib/download-url'

export type XCutProject = {
  id: string; title: string | null; source_board_id: string | null
  timeline: Timeline | null; duration_s: number | null; render: any; created_at: string; updated_at: string
}

type AssetItem = {
  id: string; kind: 'video' | 'image' | 'audio'
  src: MediaSrc; url: string | null; label: string; model?: string; cost?: number; createdAt: string
  source: 'xdirect' | 'xcreate' | 'xduel' | 'uploads'
  boardId?: string; boardTitle?: string
}
type BoardRow = { id: string; title: string; updatedAt: string; scenes: number }
type Sel = { kind: 'video' | 'audio' | 'sub'; id: string } | null

// Workspace palette — the same dark ground as XCanvas (an editor is a dark room).
const BG = '#141518', PANEL = '#1c1e23', LINE = '#2a2c31', TEXT = '#e2e3e7', MUTED = '#8a8c93', ACCENT = 'var(--red)'
const TRACK_H = 64, AUDIO_H = 44, SUB_H = 34, RULER_H = 22, LABEL_W = 86
const fmt = (s: number) => { const m = Math.floor(s / 60), r = s - m * 60; return `${m}:${r.toFixed(1).padStart(4, '0')}` }

/** Read a media file's duration from its metadata (with a timeout). */
function mediaDuration(url: string, kind: 'video' | 'audio'): Promise<number | null> {
  return new Promise(resolve => {
    const el = document.createElement(kind)
    let done = false
    const finish = (v: number | null) => { if (!done) { done = true; el.src = ''; resolve(v) } }
    el.preload = 'metadata'
    el.onloadedmetadata = () => finish(Number.isFinite(el.duration) ? el.duration : null)
    el.onerror = () => finish(null)
    el.src = url
    setTimeout(() => finish(null), 8000)
  })
}

export default function XCutEditor({ project, onExit }: { project: XCutProject; onExit: () => void }) {
  const t = useT()
  const [tl, setTl] = useState<Timeline>(() => cleanTimeline(project.timeline) ?? { version: 1, aspect: '16:9', fps: 24, video: [], audio: [], subtitles: [], settings: { resolution: '1080p', muteClips: false, dissolve: 0.35, burnSubtitles: true } })
  const [title, setTitle] = useState(project.title ?? '')
  const [sel, setSel] = useState<Sel>(null)
  const [playhead, setPlayhead] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [pps, setPps] = useState(36)          // pixels per second
  const [save, setSave] = useState<'saved' | 'saving' | 'dirty'>('saved')
  const [render, setRender] = useState<any>(project.render ?? null)
  const [rendering, setRendering] = useState(false)
  const [renderErr, setRenderErr] = useState<string | null>(null)
  // asset bin
  const [source, setSource] = useState<AssetItem['source']>(project.source_board_id ? 'xdirect' : 'xcreate')
  const [items, setItems] = useState<AssetItem[]>([])
  const [binLoading, setBinLoading] = useState(false)
  const [binTotal, setBinTotal] = useState(0)
  const [binPage, setBinPage] = useState(0)
  const [boards, setBoards] = useState<BoardRow[]>([])
  const [board, setBoard] = useState<string>(project.source_board_id ?? '')
  const [uploads, setUploads] = useState<Attachment[]>([])
  const [libOpen, setLibOpen] = useState(false)

  const starts = useMemo(() => clipStarts(tl), [tl])
  const total = useMemo(() => totalDuration(tl), [tl])
  const videoLen = useMemo(() => tl.video.reduce((n, c) => n + clipLength(c), 0), [tl])

  // ── Autosave (debounced) ────────────────────────────────────────────────
  const firstRef = useRef(true)
  useEffect(() => {
    if (firstRef.current) { firstRef.current = false; return }
    setSave('dirty')
    const h = setTimeout(async () => {
      setSave('saving')
      try {
        await fetch(`/api/xcut/projects/${project.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, timeline: tl }) })
        setSave('saved')
      } catch { setSave('dirty') }
    }, 800)
    return () => clearTimeout(h)
  }, [tl, title, project.id])

  // ── Playback engine ─────────────────────────────────────────────────────
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const audioEls = useRef<Map<string, HTMLAudioElement>>(new Map())
  const playheadRef = useRef(0)
  const playingRef = useRef(false)
  useEffect(() => { playheadRef.current = playhead }, [playhead])
  useEffect(() => { playingRef.current = playing }, [playing])
  const tlRef = useRef(tl)
  useEffect(() => { tlRef.current = tl }, [tl])

  const current = useMemo(() => locate(tl, Math.min(playhead, Math.max(0, videoLen - 0.001))), [tl, playhead, videoLen])

  // Keep the <video> on the right clip / time whenever the playhead moves by hand.
  useEffect(() => {
    const v = videoRef.current
    if (!v || !current || current.clip.kind !== 'video') return
    const url = current.clip.src.url ?? ''
    if (v.getAttribute('data-src') !== url) { v.setAttribute('data-src', url); v.src = url; v.load() }
    if (!playingRef.current && Math.abs(v.currentTime - current.offset) > 0.05) { try { v.currentTime = current.offset } catch { /* not ready */ } }
    v.muted = tl.settings.muteClips || current.clip.mute === true
    v.volume = Math.min(1, current.clip.gain ?? 1)
  }, [current, tl.settings.muteClips])

  // The clock: drives image holds, hands over between clips, keeps audio clips in sync.
  useEffect(() => {
    if (!playing) {
      videoRef.current?.pause()
      for (const a of audioEls.current.values()) a.pause()
      return
    }
    let raf = 0, last = performance.now()
    const tick = () => {
      const now = performance.now(), dt = (now - last) / 1000; last = now
      const cur = tlRef.current
      const len = cur.video.reduce((n, c) => n + clipLength(c), 0)
      const hit = locate(cur, playheadRef.current)
      if (!hit || playheadRef.current >= len - 0.001) { setPlaying(false); return }
      let next = playheadRef.current
      const v = videoRef.current
      if (hit.clip.kind === 'video' && v) {
        const url = hit.clip.src.url ?? ''
        if (v.getAttribute('data-src') !== url) { v.setAttribute('data-src', url); v.src = url; v.load(); v.currentTime = hit.offset }
        if (v.paused) { if (Math.abs(v.currentTime - hit.offset) > 0.3) v.currentTime = hit.offset; v.play().catch(() => {}) }
        const end = hit.clip.out
        next = v.readyState >= 2 ? hit.start + Math.max(0, v.currentTime - hit.clip.in) : playheadRef.current + dt
        if (v.currentTime >= end - 0.03 || v.ended) next = hit.start + clipLength(hit.clip) + 0.001
      } else {
        v?.pause()
        next = playheadRef.current + dt
      }
      // Audio clips: play the ones under the playhead at the right offset.
      for (const a of cur.audio) {
        const el = audioEls.current.get(a.id); if (!el) continue
        const rel = next - a.start
        const inside = rel >= 0 && rel < clipLength(a)
        if (inside) {
          const want = a.in + rel
          if (el.paused || Math.abs(el.currentTime - want) > 0.35) { el.currentTime = want; el.play().catch(() => {}) }
          el.volume = Math.min(1, a.gain)
        } else if (!el.paused) el.pause()
      }
      playheadRef.current = next
      setPlayhead(next)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  const seek = useCallback((tSec: number) => { setPlaying(false); const v = Math.max(0, Math.min(tSec, Math.max(0, total))); playheadRef.current = v; setPlayhead(v) }, [total])

  // ── Keyboard ────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return
      if (e.code === 'Space') { e.preventDefault(); setPlaying(p => !p) }
      else if (e.key === 's' || e.key === 'S') { setTl(cur => splitAt(cur, playheadRef.current)) }
      else if (e.key === 'Delete' || e.key === 'Backspace') { if (sel) { e.preventDefault(); setTl(cur => removeClip(cur, sel.id)); setSel(null) } }
      else if (e.key === 'Escape') setSel(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sel])

  // ── Asset bin ───────────────────────────────────────────────────────────
  // The bin pages (24 per page, "more" appends) and the XDirect tab can
  // narrow to one board — the owner's history is 29 boards / 260+ rows,
  // and a single page of the newest rows read as "the list is short".
  const loadBin = useCallback(async (page: number, append: boolean) => {
    setBinLoading(true)
    try {
      const q = new URLSearchParams({ source, page: String(page) })
      if (source === 'xdirect' && board) q.set('board', board)
      const d = await fetch(`/api/xcut/assets?${q}`).then(r => r.json())
      const list: AssetItem[] = Array.isArray(d?.items) ? d.items : []
      setItems(prev => append ? [...prev, ...list] : list)
      setBinTotal(Number(d?.total) || 0)
      setBinPage(page)
    } catch { if (!append) setItems([]) }
    finally { setBinLoading(false) }
  }, [source, board])
  useEffect(() => { void loadBin(0, false) }, [loadBin])
  useEffect(() => {
    if (source !== 'xdirect' || boards.length > 0) return
    fetch('/api/xcut/assets?source=boards').then(r => r.json()).then(d => setBoards(Array.isArray(d?.boards) ? d.boards : [])).catch(() => {})
  }, [source, boards.length])
  const binRowsSeen = (binPage + 1) * 24

  const addAsset = useCallback(async (a: AssetItem) => {
    if (!a.url) return
    if (a.kind === 'audio') {
      const d = (await mediaDuration(a.url, 'audio')) ?? 30
      const clip: AudioClip = { id: newId('a'), src: a.src, start: playheadRef.current, in: 0, out: d, srcDuration: d, gain: 1, fadeOut: 1, label: a.label }
      setTl(cur => ({ ...cur, audio: [...cur.audio, clip] }))
      setSel({ kind: 'audio', id: clip.id })
      return
    }
    const d = a.kind === 'video' ? ((await mediaDuration(a.url, 'video')) ?? 6) : 5
    const clip: VideoClip = { id: newId(), kind: a.kind, src: { ...a.src, url: a.url }, in: 0, out: d, srcDuration: a.kind === 'video' ? d : undefined, label: a.label, model: a.model, cost: a.cost, transition: 'cut' }
    setTl(cur => insertClip(cur, clip))
    setSel({ kind: 'video', id: clip.id })
  }, [])

  const onUpload = useCallback(async (atts: Attachment[]) => {
    setUploads(atts)
    const fresh = atts.filter(a => a.file)
    if (fresh.length === 0) return
    try {
      const committed = await commitAttachments(fresh)
      // Signed URLs for what just landed come from the Uploads listing.
      const res = await fetch('/api/xcut/assets?source=uploads')
      const d = await res.json().catch(() => null)
      const list: AssetItem[] = Array.isArray(d?.items) ? d.items : []
      for (const c of committed) {
        const hit = list.find(i => i.src.path === c.storagePath && i.src.bucket === c.bucket)
        if (hit) await addAsset(hit)
      }
      if (source === 'uploads') setItems(list)
      setUploads([])
    } catch (e) { console.warn('[xcut] upload failed', e) }
  }, [addAsset, source])

  // ── Edits from the inspector ─────────────────────────────────────────────
  const patchVideo = (id: string, patch: Partial<VideoClip>) => setTl(cur => ({ ...cur, video: cur.video.map(c => c.id === id ? { ...c, ...patch } : c) }))
  const patchAudio = (id: string, patch: Partial<AudioClip>) => setTl(cur => ({ ...cur, audio: cur.audio.map(c => c.id === id ? { ...c, ...patch } : c) }))
  const patchSub = (id: string, patch: Partial<Subtitle>) => setTl(cur => ({ ...cur, subtitles: cur.subtitles.map(s => s.id === id ? { ...s, ...patch } : s) }))
  const addSubtitle = () => {
    const s: Subtitle = { id: newId('s'), start: playheadRef.current, end: Math.min(total || 2, playheadRef.current + 2) || playheadRef.current + 2, text: '…' }
    setTl(cur => ({ ...cur, subtitles: [...cur.subtitles, s].sort((a, b) => a.start - b.start) }))
    setSel({ kind: 'sub', id: s.id })
  }

  // ── Drag: trim handles, reorder, move ────────────────────────────────────
  type Drag = { kind: 'trimL' | 'trimR' | 'moveV' | 'moveA' | 'trimAL' | 'trimAR' | 'moveS' | 'trimSL' | 'trimSR'; id: string; x0: number; snap: any }
  const dragRef = useRef<Drag | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const startDrag = (e: React.PointerEvent, d: Omit<Drag, 'x0' | 'snap'>) => {
    e.stopPropagation(); e.preventDefault()
    const snap = d.kind.startsWith('trim') || d.kind.startsWith('move')
      ? { tl: tlRef.current } : null
    dragRef.current = { ...d, x0: e.clientX, snap }
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    if (d.kind === 'moveV' || d.kind === 'trimL' || d.kind === 'trimR') setSel({ kind: 'video', id: d.id })
    if (d.kind === 'moveA' || d.kind === 'trimAL' || d.kind === 'trimAR') setSel({ kind: 'audio', id: d.id })
    if (d.kind === 'moveS' || d.kind === 'trimSL' || d.kind === 'trimSR') setSel({ kind: 'sub', id: d.id })
  }
  const onDragMove = (e: React.PointerEvent) => {
    const d = dragRef.current; if (!d) return
    const dx = (e.clientX - d.x0) / pps
    const base: Timeline = d.snap.tl
    if (d.kind === 'trimL' || d.kind === 'trimR') {
      const c = base.video.find(x => x.id === d.id); if (!c) return
      setTl(trimClip(base, d.id, d.kind === 'trimL' ? { in: c.in + dx } : { out: c.out + dx }))
    } else if (d.kind === 'moveV') {
      const from = base.video.findIndex(x => x.id === d.id); if (from < 0) return
      const st = clipStarts(base)
      const center = st[from] + clipLength(base.video[from]) / 2 + dx
      let to = 0
      for (let i = 0; i < base.video.length; i++) { if (i === from) continue; if (center > st[i] + clipLength(base.video[i]) / 2) to = i < from ? i + 1 : i }
      if (to !== from) setTl(moveClip(base, d.id, to))
    } else if (d.kind === 'moveA') {
      const c = base.audio.find(x => x.id === d.id); if (!c) return
      let start = Math.max(0, c.start + dx)
      for (const s of [0, ...clipStarts(base)]) if (Math.abs(s - start) < 0.25) start = s
      patchAudio(d.id, { start })
    } else if (d.kind === 'trimAL' || d.kind === 'trimAR') {
      const c = base.audio.find(x => x.id === d.id); if (!c) return
      const max = c.srcDuration ?? Number.POSITIVE_INFINITY
      if (d.kind === 'trimAL') { const nin = Math.max(0, Math.min(c.in + dx, c.out - 0.2)); patchAudio(d.id, { in: nin, start: Math.max(0, c.start + (nin - c.in)) }) }
      else patchAudio(d.id, { out: Math.max(c.in + 0.2, Math.min(max, c.out + dx)) })
    } else if (d.kind === 'moveS') {
      const s = base.subtitles.find(x => x.id === d.id); if (!s) return
      const len = s.end - s.start, start = Math.max(0, s.start + dx)
      patchSub(d.id, { start, end: start + len })
    } else if (d.kind === 'trimSL' || d.kind === 'trimSR') {
      const s = base.subtitles.find(x => x.id === d.id); if (!s) return
      if (d.kind === 'trimSL') patchSub(d.id, { start: Math.max(0, Math.min(s.start + dx, s.end - 0.2)) })
      else patchSub(d.id, { end: Math.max(s.start + 0.2, s.end + dx) })
    }
  }
  const endDrag = () => { dragRef.current = null }
  const seekFromEvent = (e: React.MouseEvent) => {
    const el = trackRef.current; if (!el) return
    const rect = el.getBoundingClientRect()
    seek((e.clientX - rect.left + el.scrollLeft - LABEL_W) / pps)
  }

  // ── Export ──────────────────────────────────────────────────────────────
  const exportFilm = async () => {
    setRendering(true); setRenderErr(null); setPlaying(false)
    try {
      const res = await fetch('/api/xcut/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: project.id, timeline: tl }) })
      const d = await res.json().catch(() => null)
      if (!res.ok) throw new Error(d?.error ?? `HTTP ${res.status}`)
      setRender(d.render)
    } catch (e: any) { setRenderErr(e?.message ?? 'Render failed') }
    finally { setRendering(false) }
  }

  // ── Render ──────────────────────────────────────────────────────────────
  const selVideo = sel?.kind === 'video' ? tl.video.find(c => c.id === sel.id) ?? null : null
  const selAudio = sel?.kind === 'audio' ? tl.audio.find(c => c.id === sel.id) ?? null : null
  const selSub = sel?.kind === 'sub' ? tl.subtitles.find(s => s.id === sel.id) ?? null : null
  const cues = tl.settings.burnSubtitles ? tl.subtitles.filter(s => playhead >= s.start && playhead < s.end) : []
  const toggleBurn = () => setTl(cur => ({ ...cur, settings: { ...cur.settings, burnSubtitles: !cur.settings.burnSubtitles } }))
  const aspectNum = tl.aspect === '9:16' ? 9 / 16 : tl.aspect === '1:1' ? 1 : 16 / 9
  const width = Math.max(800, (total + 4) * pps + LABEL_W)
  const mono: React.CSSProperties = { fontFamily: 'var(--font-mono), monospace', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: MUTED }
  const small: React.CSSProperties = { fontSize: 12, color: TEXT }
  const input: React.CSSProperties = { width: '100%', padding: '5px 8px', borderRadius: 6, border: `1px solid ${LINE}`, background: BG, color: TEXT, fontSize: 12 }
  const btn = (on = false): React.CSSProperties => ({ padding: '6px 12px', borderRadius: 999, border: `1px solid ${on ? ACCENT : LINE}`, background: on ? 'rgba(229,57,53,0.18)' : 'transparent', color: on ? '#fff' : TEXT, fontSize: 12, fontWeight: 700, cursor: 'pointer' })
  const ticks: number[] = []
  const step = pps >= 80 ? 1 : pps >= 40 ? 2 : pps >= 20 ? 5 : 10
  for (let s = 0; s <= total + 4; s += step) ticks.push(s)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 96px)', minHeight: 620, background: BG, color: TEXT, borderRadius: 12, border: `1px solid ${LINE}`, overflow: 'hidden', position: 'relative' }}>
      <XCutLibrary open={libOpen} onClose={() => setLibOpen(false)} defaultBoard={project.source_board_id}
        onAdd={async (picked: LibraryItem[]) => { for (const a of picked) await addAsset(a as any) }} />
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: `1px solid ${LINE}` }}>
        <button onClick={onExit} style={{ ...btn(), padding: '4px 10px' }}>←</button>
        <span style={{ ...mono, color: ACCENT }}>✂ {t('xcut.title')}</span>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder={t('xcut.untitled')} style={{ ...input, width: 320, fontWeight: 700, fontSize: 13 }} />
        <span style={mono}>{fmt(playhead)} / {fmt(total)}</span>
        <span style={{ flex: 1 }} />
        <span style={mono}>{save === 'saved' ? t('xcut.saved') : t('xcut.saving')}</span>
        {project.source_board_id && <a href={`/xdirect?c=${project.source_board_id}`} style={{ ...btn(), textDecoration: 'none' }}>{t('xcut.onboard')}</a>}
        <button onClick={exportFilm} disabled={rendering || tl.video.length === 0} style={{ ...btn(true), background: ACCENT, opacity: rendering || tl.video.length === 0 ? 0.5 : 1 }}>🎬 {t('xcut.export')}</button>
      </div>

      {/* Workspace: bin | preview | inspector */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Asset bin */}
        <div style={{ width: 280, borderRight: `1px solid ${LINE}`, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ padding: '10px 12px 6px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={mono}>{t('xcut.assets')}</span>
            <span style={{ flex: 1 }} />
            <button onClick={() => setLibOpen(true)} style={{ ...btn(true), padding: '4px 10px', fontSize: 11 }}>🗂 {t('xcut.browse')}</button>
          </div>
          <div style={{ display: 'flex', gap: 4, padding: '0 12px 8px', flexWrap: 'wrap' }}>
            {(['xdirect', 'xcreate', 'xduel', 'uploads'] as const).map(s => (
              <button key={s} onClick={() => setSource(s)} style={{ ...btn(source === s), padding: '4px 9px', fontSize: 11 }}>{t(`xcut.src.${s}`)}</button>
            ))}
          </div>
          {source === 'xdirect' && (
            <div style={{ padding: '0 12px 8px' }}>
              <select value={board} onChange={e => setBoard(e.target.value)} style={{ width: '100%', padding: '5px 8px', borderRadius: 6, border: `1px solid ${LINE}`, background: BG, color: TEXT, fontSize: 11.5 }}>
                <option value="">{t('xcut.allboards')} ({boards.length})</option>
                {boards.map(b => <option key={b.id} value={b.id}>{(b.title || t('xcut.untitled')).slice(0, 48)}{b.scenes ? ` · ${b.scenes}` : ''}</option>)}
              </select>
            </div>
          )}
          <div style={{ padding: '0 12px 8px' }}>
            <AttachmentButton attachments={uploads} onChange={a => { void onUpload(a) }} context="xcreate" multiple maxFiles={10} accept="video/mp4,video/quicktime,video/webm,audio/*,.mp3,.m4a,.wav,image/jpeg,image/png,image/webp" />
            <div style={{ ...mono, textTransform: 'none', marginTop: 4 }}>{t('xcut.upload')}</div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px 12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, alignContent: 'start' }}>
            {binLoading && <div style={mono}>…</div>}
            {!binLoading && items.length === 0 && <div style={{ ...mono, textTransform: 'none', gridColumn: '1 / -1' }}>{t('xcut.noassets')}</div>}
            {items.map(a => (
              <button key={a.id} onClick={() => { void addAsset(a) }} title={`${t('xcut.add')} — ${a.label}`} style={{ textAlign: 'left', border: `1px solid ${LINE}`, borderRadius: 8, padding: 4, background: PANEL, cursor: 'pointer', color: TEXT }}>
                <div style={{ aspectRatio: '16 / 9', background: '#0e0f12', borderRadius: 5, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {a.kind === 'image' && a.url && <img src={a.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                  {a.kind === 'video' && a.url && <video src={a.url} muted preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                  {a.kind === 'audio' && <span style={{ fontSize: 22 }}>🎵</span>}
                </div>
                <div style={{ fontSize: 10.5, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={a.boardTitle ? `${a.boardTitle} — ${a.label}` : a.label}>{a.label || a.kind}</div>
                <div style={{ ...mono, textTransform: 'none', fontSize: 9.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.model ?? a.kind}{typeof a.cost === 'number' ? ` · $${a.cost.toFixed(2)}` : ''}{!board && a.boardTitle ? ` · ${a.boardTitle}` : ''}</div>
              </button>
            ))}
            {!binLoading && binRowsSeen < binTotal && (
              <button onClick={() => { void loadBin(binPage + 1, true) }} style={{ ...btn(), gridColumn: '1 / -1', marginTop: 4 }}>{t('xcut.more')} ({Math.max(0, binTotal - binRowsSeen)})</button>
            )}
          </div>
        </div>

        {/* Preview */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, alignItems: 'center', justifyContent: 'center', padding: 16, gap: 10 }}>
          <div style={{ position: 'relative', background: '#000', borderRadius: 8, overflow: 'hidden', aspectRatio: String(aspectNum), maxHeight: '100%', maxWidth: '100%', width: tl.aspect === '9:16' ? 'auto' : '100%', height: tl.aspect === '9:16' ? '100%' : 'auto' }}>
            <video ref={videoRef} playsInline style={{ width: '100%', height: '100%', objectFit: 'contain', display: current?.clip.kind === 'video' ? 'block' : 'none', background: '#000' }} />
            {current?.clip.kind === 'image' && current.clip.src.url && <img src={current.clip.src.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
            {!current && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: MUTED, fontSize: 13, padding: 24, textAlign: 'center' }}>{t('xcut.emptytl')}</div>}
            {cues.length > 0 && (
              <div style={{ position: 'absolute', left: 0, right: 0, bottom: '6%', textAlign: 'center', padding: '0 6%' }}>
                {cues.map(c => <div key={c.id} style={{ display: 'inline-block', color: '#fff', fontSize: 'clamp(12px, 2.2vw, 22px)', fontFamily: 'var(--font-zh), var(--font-body), sans-serif', textShadow: '0 0 4px #000, 0 1px 2px #000, 0 0 8px #000', lineHeight: 1.4 }}>{c.text}</div>)}
              </div>
            )}
            {tl.audio.map(a => <audio key={a.id} src={a.src.url ?? ''} preload="auto" ref={el => { if (el) audioEls.current.set(a.id, el); else audioEls.current.delete(a.id) }} />)}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={() => seek(0)} style={btn()}>⏮</button>
            <button onClick={() => setPlaying(p => !p)} disabled={tl.video.length === 0} style={{ ...btn(true), minWidth: 84 }}>{playing ? `⏸ ${t('xcut.pause')}` : `▶ ${t('xcut.play')}`}</button>
            <button onClick={() => setTl(cur => splitAt(cur, playheadRef.current))} style={btn()}>✂ {t('xcut.split')}</button>
            <button onClick={() => { if (sel) { setTl(cur => removeClip(cur, sel.id)); setSel(null) } }} disabled={!sel} style={{ ...btn(), opacity: sel ? 1 : 0.4 }}>🗑 {t('xcut.delete')}</button>
            <button onClick={addSubtitle} style={btn()}>{t('xcut.addsub')}</button>
            <button onClick={toggleBurn} title={t('xcut.burnsubs')} style={{ ...btn(tl.settings.burnSubtitles), fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.06em' }}>CC {tl.settings.burnSubtitles ? 'ON' : 'OFF'}</button>
            <span style={{ ...mono, marginLeft: 8 }}>{t('xcut.zoom')}</span>
            <input type="range" min={12} max={160} value={pps} onChange={e => setPps(Number(e.target.value))} style={{ width: 110 }} />
          </div>
          {(rendering || render || renderErr) && (
            <div style={{ width: '100%', maxWidth: 720, border: `1px solid ${LINE}`, borderRadius: 10, padding: '10px 14px', background: PANEL, fontSize: 12.5 }}>
              {rendering && <span>⏳ {t('xcut.rendering')}</span>}
              {!rendering && renderErr && <span style={{ color: '#ff7b74' }}>⚠ {renderErr}</span>}
              {!rendering && !renderErr && render?.status === 'done' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <span style={{ ...mono, color: ACCENT }}>{t('xcut.finalcut')}</span>
                  <span>{typeof render.duration === 'number' ? `${render.duration.toFixed(1)}s` : ''} · {render.width}×{render.height}{typeof render.bytes === 'number' ? ` · ${(render.bytes / 1e6).toFixed(1)} MB` : ''}</span>
                  {render.url && (() => {
                    // Supabase storage turns ?download=<name> into a
                    // Content-Disposition attachment, which is the only
                    // reliable cross-origin download: the bare `download`
                    // attribute is IGNORED for cross-origin URLs, so mobile
                    // Chrome just opened the MP4 inline (owner, Aug 24) —
                    // the same bug the XDirect fullscreen player had.
                    const name = safeFilename(title, 'final-cut', 'mp4')
                    return <a href={downloadUrl(render.url, name)} download={name} style={{ ...btn(true), textDecoration: 'none', background: ACCENT }}>⬇ {t('xcut.download')}</a>
                  })()}
                  {render.url && <a href={render.url} target="_blank" rel="noreferrer" style={{ ...btn(), textDecoration: 'none' }}>▶</a>}
                  {Array.isArray(render.warnings) && render.warnings.map((w: string, i: number) => <span key={i} style={{ color: MUTED, width: '100%' }}>· {w}</span>)}
                </div>
              )}
              {!rendering && !renderErr && render?.status === 'error' && <span style={{ color: '#ff7b74' }}>⚠ {render.error}</span>}
            </div>
          )}
        </div>

        {/* Inspector */}
        <div style={{ width: 300, borderLeft: `1px solid ${LINE}`, padding: 14, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {selVideo && (
            <>
              <div style={mono}>{t('xcut.clip')} · {selVideo.kind}</div>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{selVideo.label ?? selVideo.src.fileName ?? '—'}</div>
              {(selVideo.model || typeof selVideo.cost === 'number') && <div style={{ ...mono, textTransform: 'none', color: ACCENT }}>{selVideo.model ?? ''}{typeof selVideo.cost === 'number' ? ` · $${selVideo.cost.toFixed(2)}` : ''}</div>}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                <label style={small}><div style={mono}>{t('xcut.in')}</div><input type="number" step={0.1} min={0} value={selVideo.in.toFixed(2)} onChange={e => setTl(cur => trimClip(cur, selVideo.id, { in: Number(e.target.value) }))} style={input} disabled={selVideo.kind === 'image'} /></label>
                <label style={small}><div style={mono}>{t('xcut.out')}</div><input type="number" step={0.1} min={0} value={selVideo.out.toFixed(2)} onChange={e => setTl(cur => trimClip(cur, selVideo.id, { out: Number(e.target.value) }))} style={input} /></label>
                <div style={small}><div style={mono}>{t('xcut.length')}</div><div style={{ padding: '5px 0' }}>{clipLength(selVideo).toFixed(2)}s</div></div>
              </div>
              <label style={small}><div style={mono}>{t('xcut.transition')}</div>
                <select value={selVideo.transition ?? 'cut'} onChange={e => patchVideo(selVideo.id, { transition: e.target.value as any })} style={input}>
                  <option value="cut">{t('xcut.cut')}</option><option value="dissolve">{t('xcut.dissolve')}</option>
                </select></label>
              {selVideo.kind === 'video' && (
                <>
                  <label style={{ ...small, display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={!!selVideo.mute} onChange={e => patchVideo(selVideo.id, { mute: e.target.checked })} />{t('xcut.mute')}</label>
                  <label style={small}><div style={mono}>{t('xcut.gain')} · {Math.round((selVideo.gain ?? 1) * 100)}%</div><input type="range" min={0} max={200} value={Math.round((selVideo.gain ?? 1) * 100)} onChange={e => patchVideo(selVideo.id, { gain: Number(e.target.value) / 100 })} style={{ width: '100%' }} /></label>
                </>
              )}
            </>
          )}
          {selAudio && (
            <>
              <div style={mono}>{t('xcut.track.audio')}</div>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{selAudio.label ?? selAudio.src.fileName ?? '—'}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                <label style={small}><div style={mono}>{t('xcut.start')}</div><input type="number" step={0.1} min={0} value={selAudio.start.toFixed(2)} onChange={e => patchAudio(selAudio.id, { start: Math.max(0, Number(e.target.value)) })} style={input} /></label>
                <label style={small}><div style={mono}>{t('xcut.in')}</div><input type="number" step={0.1} min={0} value={selAudio.in.toFixed(2)} onChange={e => patchAudio(selAudio.id, { in: Math.max(0, Math.min(Number(e.target.value), selAudio.out - 0.2)) })} style={input} /></label>
                <label style={small}><div style={mono}>{t('xcut.out')}</div><input type="number" step={0.1} min={0} value={selAudio.out.toFixed(2)} onChange={e => patchAudio(selAudio.id, { out: Math.max(selAudio.in + 0.2, Math.min(selAudio.srcDuration ?? Infinity, Number(e.target.value))) })} style={input} /></label>
              </div>
              <label style={small}><div style={mono}>{t('xcut.gain')} · {Math.round(selAudio.gain * 100)}%</div><input type="range" min={0} max={200} value={Math.round(selAudio.gain * 100)} onChange={e => patchAudio(selAudio.id, { gain: Number(e.target.value) / 100 })} style={{ width: '100%' }} /></label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <label style={small}><div style={mono}>{t('xcut.fadein')}</div><input type="number" step={0.1} min={0} max={10} value={selAudio.fadeIn ?? 0} onChange={e => patchAudio(selAudio.id, { fadeIn: Math.max(0, Number(e.target.value)) })} style={input} /></label>
                <label style={small}><div style={mono}>{t('xcut.fadeout')}</div><input type="number" step={0.1} min={0} max={10} value={selAudio.fadeOut ?? 0} onChange={e => patchAudio(selAudio.id, { fadeOut: Math.max(0, Number(e.target.value)) })} style={input} /></label>
              </div>
            </>
          )}
          {selSub && (
            <>
              <div style={mono}>{t('xcut.subtitle')}</div>
              <textarea value={selSub.text} onChange={e => patchSub(selSub.id, { text: e.target.value })} rows={3} style={{ ...input, resize: 'vertical', fontFamily: 'inherit', fontSize: 13 }} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <label style={small}><div style={mono}>{t('xcut.start')}</div><input type="number" step={0.1} min={0} value={selSub.start.toFixed(2)} onChange={e => patchSub(selSub.id, { start: Math.max(0, Math.min(Number(e.target.value), selSub.end - 0.2)) })} style={input} /></label>
                <label style={small}><div style={mono}>{t('xcut.out')}</div><input type="number" step={0.1} min={0} value={selSub.end.toFixed(2)} onChange={e => patchSub(selSub.id, { end: Math.max(selSub.start + 0.2, Number(e.target.value)) })} style={input} /></label>
              </div>
            </>
          )}
          {!sel && (
            <>
              <div style={mono}>{t('xcut.settings')}</div>
              <label style={small}><div style={mono}>{t('xcut.aspect')}</div>
                <select value={tl.aspect} onChange={e => setTl(cur => ({ ...cur, aspect: e.target.value as any }))} style={input}><option>16:9</option><option>9:16</option><option>1:1</option></select></label>
              <label style={small}><div style={mono}>{t('xcut.resolution')}</div>
                <select value={tl.settings.resolution} onChange={e => setTl(cur => ({ ...cur, settings: { ...cur.settings, resolution: e.target.value as any } }))} style={input}><option value="1080p">1080p</option><option value="720p">720p</option></select></label>
              <label style={small}><div style={mono}>{t('xcut.dissolvelen')} · {tl.settings.dissolve.toFixed(2)}s</div><input type="range" min={0} max={200} value={Math.round(tl.settings.dissolve * 100)} onChange={e => setTl(cur => ({ ...cur, settings: { ...cur.settings, dissolve: Number(e.target.value) / 100 } }))} style={{ width: '100%' }} /></label>
              <label style={{ ...small, display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={tl.settings.muteClips} onChange={e => setTl(cur => ({ ...cur, settings: { ...cur.settings, muteClips: e.target.checked } }))} />{t('xcut.muteall')}</label>
              <label style={{ ...small, display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={tl.settings.burnSubtitles} onChange={e => setTl(cur => ({ ...cur, settings: { ...cur.settings, burnSubtitles: e.target.checked } }))} />{t('xcut.burnsubs')}</label>
              <div style={{ ...mono, textTransform: 'none', lineHeight: 1.6, marginTop: 8 }}>{t('xcut.keys')}</div>
            </>
          )}
        </div>
      </div>

      {/* Timeline */}
      <div ref={trackRef} onPointerMove={onDragMove} onPointerUp={endDrag} onPointerCancel={endDrag}
           style={{ height: RULER_H + TRACK_H + AUDIO_H + SUB_H + 28, borderTop: `1px solid ${LINE}`, background: PANEL, overflowX: 'auto', overflowY: 'hidden', position: 'relative', userSelect: 'none' }}>
        <div style={{ position: 'relative', width, height: '100%' }} onClick={e => { if ((e.target as HTMLElement).dataset.clip) return; seekFromEvent(e) }}>
          {/* ruler */}
          <div style={{ position: 'absolute', left: LABEL_W, top: 0, right: 0, height: RULER_H, borderBottom: `1px solid ${LINE}` }}>
            {ticks.map(s => <span key={s} style={{ position: 'absolute', left: s * pps, top: 3, ...mono, fontSize: 9 }}>{fmt(s)}</span>)}
          </div>
          {/* track labels */}
          {[[t('xcut.track.video'), RULER_H + 4], [t('xcut.track.audio'), RULER_H + TRACK_H + 12], [t('xcut.track.subs'), RULER_H + TRACK_H + AUDIO_H + 20]].map(([lab, top]) => (
            <div key={String(lab)} style={{ position: 'absolute', left: 10, top: Number(top) + 4, ...mono, color: MUTED }}>{lab}</div>
          ))}
          {/* video track */}
          <div style={{ position: 'absolute', left: LABEL_W, top: RULER_H + 6, height: TRACK_H, right: 0 }}>
            {tl.video.map((c, i) => {
              const on = sel?.kind === 'video' && sel.id === c.id
              return (
                <div key={c.id} data-clip="1" onPointerDown={e => startDrag(e, { kind: 'moveV', id: c.id })} onClick={e => { e.stopPropagation(); setSel({ kind: 'video', id: c.id }) }}
                     style={{ position: 'absolute', left: starts[i] * pps, width: Math.max(6, clipLength(c) * pps), height: TRACK_H, borderRadius: 6, overflow: 'hidden', cursor: 'grab',
                              border: `1.5px solid ${on ? ACCENT : LINE}`, background: c.kind === 'image' ? '#2b2419' : '#1f2a38', boxSizing: 'border-box' }}>
                  {c.kind === 'image' && c.src.url && <img src={c.src.url} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.55 }} />}
                  <div data-clip="1" style={{ position: 'absolute', left: 6, top: 5, right: 6, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textShadow: '0 1px 2px #000' }}>
                    {c.transition === 'dissolve' && i > 0 ? '⟋ ' : ''}{c.label ?? c.src.fileName ?? c.kind}
                  </div>
                  <div data-clip="1" style={{ position: 'absolute', left: 6, bottom: 5, ...mono, textTransform: 'none', fontSize: 9.5, color: '#cfd1d6', textShadow: '0 1px 2px #000', whiteSpace: 'nowrap' }}>
                    {clipLength(c).toFixed(1)}s{c.model ? ` · ${c.model}` : ''}{typeof c.cost === 'number' ? ` · $${c.cost.toFixed(2)}` : ''}{c.mute || tl.settings.muteClips ? ' · 🔇' : ''}
                  </div>
                  <div data-clip="1" onPointerDown={e => startDrag(e, { kind: 'trimL', id: c.id })} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 8, cursor: 'ew-resize', background: on ? ACCENT : 'rgba(255,255,255,0.12)' }} />
                  <div data-clip="1" onPointerDown={e => startDrag(e, { kind: 'trimR', id: c.id })} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 8, cursor: 'ew-resize', background: on ? ACCENT : 'rgba(255,255,255,0.12)' }} />
                </div>
              )
            })}
          </div>
          {/* audio track */}
          <div style={{ position: 'absolute', left: LABEL_W, top: RULER_H + TRACK_H + 14, height: AUDIO_H, right: 0 }}>
            {tl.audio.map(a => {
              const on = sel?.kind === 'audio' && sel.id === a.id
              return (
                <div key={a.id} data-clip="1" onPointerDown={e => startDrag(e, { kind: 'moveA', id: a.id })} onClick={e => { e.stopPropagation(); setSel({ kind: 'audio', id: a.id }) }}
                     style={{ position: 'absolute', left: a.start * pps, width: Math.max(6, clipLength(a) * pps), height: AUDIO_H, borderRadius: 6, cursor: 'grab', border: `1.5px solid ${on ? ACCENT : LINE}`, background: '#1f3326', boxSizing: 'border-box', overflow: 'hidden' }}>
                  <div data-clip="1" style={{ position: 'absolute', left: 8, top: 6, right: 8, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>🎵 {a.label ?? a.src.fileName ?? 'audio'}</div>
                  <div data-clip="1" style={{ position: 'absolute', left: 8, bottom: 4, ...mono, textTransform: 'none', fontSize: 9.5, color: '#cfd1d6' }}>{clipLength(a).toFixed(1)}s · {Math.round(a.gain * 100)}%</div>
                  <div data-clip="1" onPointerDown={e => startDrag(e, { kind: 'trimAL', id: a.id })} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 8, cursor: 'ew-resize', background: on ? ACCENT : 'rgba(255,255,255,0.12)' }} />
                  <div data-clip="1" onPointerDown={e => startDrag(e, { kind: 'trimAR', id: a.id })} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 8, cursor: 'ew-resize', background: on ? ACCENT : 'rgba(255,255,255,0.12)' }} />
                </div>
              )
            })}
          </div>
          {/* subtitle track */}
          <div style={{ position: 'absolute', left: LABEL_W, top: RULER_H + TRACK_H + AUDIO_H + 22, height: SUB_H, right: 0 }}>
            {tl.subtitles.map(s => {
              const on = sel?.kind === 'sub' && sel.id === s.id
              return (
                <div key={s.id} data-clip="1" onPointerDown={e => startDrag(e, { kind: 'moveS', id: s.id })} onClick={e => { e.stopPropagation(); setSel({ kind: 'sub', id: s.id }) }}
                     style={{ position: 'absolute', left: s.start * pps, width: Math.max(6, (s.end - s.start) * pps), height: SUB_H, borderRadius: 6, cursor: 'grab', border: `1.5px solid ${on ? ACCENT : LINE}`, background: '#2d2640', boxSizing: 'border-box', overflow: 'hidden' }}>
                  <div data-clip="1" style={{ position: 'absolute', left: 8, top: 8, right: 8, fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.text}</div>
                  <div data-clip="1" onPointerDown={e => startDrag(e, { kind: 'trimSL', id: s.id })} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 7, cursor: 'ew-resize', background: on ? ACCENT : 'rgba(255,255,255,0.12)' }} />
                  <div data-clip="1" onPointerDown={e => startDrag(e, { kind: 'trimSR', id: s.id })} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 7, cursor: 'ew-resize', background: on ? ACCENT : 'rgba(255,255,255,0.12)' }} />
                </div>
              )
            })}
          </div>
          {/* playhead */}
          <div style={{ position: 'absolute', left: LABEL_W + playhead * pps, top: 0, bottom: 0, width: 2, background: ACCENT, pointerEvents: 'none' }}>
            <div style={{ position: 'absolute', top: 0, left: -5, width: 12, height: 12, background: ACCENT, clipPath: 'polygon(0 0, 100% 0, 50% 100%)' }} />
          </div>
        </div>
      </div>
    </div>
  )
}
