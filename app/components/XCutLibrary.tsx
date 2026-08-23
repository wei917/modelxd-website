'use client'
// app/components/XCutLibrary.tsx — the Library: everything the user has ever
// made or uploaded on ModelXD, browsable and searchable, multi-select, add
// to the cut (owner, Aug 23: "users should be able to pick anyone from
// their existing library"). A full-width overlay inside the editor; the
// narrow bin stays as the quick strip.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useT } from '../../lib/i18n'
import type { MediaSrc } from '../../lib/xcut-timeline'

export type LibraryItem = {
  id: string; kind: 'video' | 'image' | 'audio'
  src: MediaSrc; url: string | null; label: string; model?: string; cost?: number; createdAt: string
  source: 'xdirect' | 'xcreate' | 'xduel' | 'uploads'; boardId?: string; boardTitle?: string
}
type BoardRow = { id: string; title: string; updatedAt: string; scenes: number }
type Source = 'all' | 'xdirect' | 'xcreate' | 'xduel' | 'uploads'
type Kind = '' | 'video' | 'image' | 'audio'

const BG = '#141518', PANEL = '#1c1e23', LINE = '#2a2c31', TEXT = '#e2e3e7', MUTED = '#8a8c93', ACCENT = 'var(--red)'

export default function XCutLibrary({ open, onClose, onAdd, defaultBoard }: {
  open: boolean
  onClose: () => void
  onAdd: (items: LibraryItem[]) => void | Promise<void>
  defaultBoard?: string | null
}) {
  const t = useT()
  const [source, setSource] = useState<Source>('all')
  const [kind, setKind] = useState<Kind>('')
  const [q, setQ] = useState('')
  const [board, setBoard] = useState<string>('')
  const [boards, setBoards] = useState<BoardRow[]>([])
  const [items, setItems] = useState<LibraryItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(false)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState(false)
  const debounce = useRef<any>(null)
  const [qLive, setQLive] = useState('')

  useEffect(() => { if (open && boards.length === 0) fetch('/api/xcut/assets?source=boards').then(r => r.json()).then(d => setBoards(Array.isArray(d?.boards) ? d.boards : [])).catch(() => {}) }, [open, boards.length])
  useEffect(() => { clearTimeout(debounce.current); debounce.current = setTimeout(() => setQLive(q), 300); return () => clearTimeout(debounce.current) }, [q])

  const load = useCallback(async (p: number, append: boolean) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ source, page: String(p) })
      if (kind) params.set('kind', kind)
      if (qLive) params.set('q', qLive)
      if (board && (source === 'all' || source === 'xdirect')) params.set('board', board)
      const d = await fetch(`/api/xcut/assets?${params}`).then(r => r.json())
      const list: LibraryItem[] = Array.isArray(d?.items) ? d.items : []
      setItems(prev => append ? [...prev, ...list] : list)
      setTotal(Number(d?.total) || 0)
      setPage(p)
    } catch { if (!append) setItems([]) }
    finally { setLoading(false) }
  }, [source, kind, qLive, board])
  useEffect(() => { if (open) void load(0, false) }, [open, load])

  // Auto-page when the grid's end comes into view.
  const endRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open || !endRef.current) return
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting) && !loading && (page + 1) * 24 < total) void load(page + 1, true) }, { rootMargin: '200px' })
    io.observe(endRef.current)
    return () => io.disconnect()
  }, [open, loading, page, total, load])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  const mono: React.CSSProperties = { fontFamily: 'var(--font-mono), monospace', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: MUTED }
  const chip = (on: boolean): React.CSSProperties => ({ padding: '4px 10px', borderRadius: 999, border: `1px solid ${on ? ACCENT : LINE}`, background: on ? 'rgba(229,57,53,0.18)' : 'transparent', color: on ? '#fff' : TEXT, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' })
  const toggle = (id: string) => setSel(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const addSelected = async () => {
    const chosen = items.filter(i => sel.has(i.id))
    if (chosen.length === 0) return
    setAdding(true)
    try { await onAdd(chosen); setSel(new Set()); onClose() } finally { setAdding(false) }
  }

  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 20, display: 'flex', alignItems: 'stretch', justifyContent: 'center', padding: 24 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 1280, background: BG, border: `1px solid ${LINE}`, borderRadius: 14, display: 'flex', flexDirection: 'column', overflow: 'hidden', color: TEXT }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: `1px solid ${LINE}`, flexWrap: 'wrap' }}>
          <span style={{ ...mono, color: ACCENT }}>{t('xcut.library')}</span>
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={t('xcut.search')} style={{ flex: '1 1 260px', minWidth: 200, padding: '7px 10px', borderRadius: 8, border: `1px solid ${LINE}`, background: PANEL, color: TEXT, fontSize: 13 }} />
          <span style={{ display: 'flex', gap: 4 }}>
            {(['all', 'xdirect', 'xcreate', 'xduel', 'uploads'] as Source[]).map(s => <button key={s} onClick={() => { setSource(s); setSel(new Set()) }} style={chip(source === s)}>{s === 'all' ? t('xcut.src.all') : t(`xcut.src.${s}`)}</button>)}
          </span>
          <span style={{ display: 'flex', gap: 4 }}>
            {([['', 'xcut.kind.all'], ['video', 'xcut.kind.video'], ['image', 'xcut.kind.image'], ['audio', 'xcut.kind.audio']] as Array<[Kind, string]>).map(([k, key]) => <button key={k || 'all'} onClick={() => setKind(k)} style={chip(kind === k)}>{t(key)}</button>)}
          </span>
          {(source === 'all' || source === 'xdirect') && (
            <select value={board} onChange={e => setBoard(e.target.value)} style={{ padding: '6px 8px', borderRadius: 8, border: `1px solid ${LINE}`, background: PANEL, color: TEXT, fontSize: 11.5, maxWidth: 260 }}>
              <option value="">{t('xcut.allboards')} ({boards.length})</option>
              {boards.map(b => <option key={b.id} value={b.id}>{(b.title || t('xcut.untitled')).slice(0, 48)}{b.scenes ? ` · ${b.scenes}` : ''}</option>)}
            </select>
          )}
          <span style={{ flex: 1 }} />
          <span style={mono}>{items.length} / {total}</span>
          <button onClick={onClose} style={{ ...chip(false), padding: '4px 10px' }}>✕</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))', gap: 10, alignContent: 'start' }}>
          {items.map(a => {
            const on = sel.has(a.id)
            return (
              <div key={a.id} onClick={() => toggle(a.id)} onDoubleClick={() => { void onAdd([a]); onClose() }} style={{ border: `2px solid ${on ? ACCENT : LINE}`, borderRadius: 10, padding: 5, background: PANEL, cursor: 'pointer', position: 'relative' }} title={`${a.boardTitle ? a.boardTitle + ' — ' : ''}${a.label}`}>
                <div style={{ aspectRatio: '16 / 9', background: '#0e0f12', borderRadius: 6, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {a.kind === 'image' && a.url && <img src={a.url} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                  {a.kind === 'video' && a.url && <video src={`${a.url}#t=0.1`} muted preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                  {a.kind === 'audio' && <span style={{ fontSize: 26 }}>🎵</span>}
                </div>
                <div style={{ fontSize: 11, marginTop: 5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 700 }}>{a.label || a.kind}</div>
                <div style={{ ...mono, textTransform: 'none', fontSize: 9.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {a.kind}{a.model ? ` · ${a.model}` : ''}{typeof a.cost === 'number' ? ` · $${a.cost.toFixed(2)}` : ''}{a.boardTitle ? ` · ${a.boardTitle}` : ''}
                </div>
                <div style={{ position: 'absolute', top: 9, left: 9, width: 18, height: 18, borderRadius: 5, border: `1.5px solid ${on ? ACCENT : 'rgba(255,255,255,0.5)'}`, background: on ? ACCENT : 'rgba(0,0,0,0.45)', color: '#fff', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{on ? '✓' : ''}</div>
              </div>
            )
          })}
          {!loading && items.length === 0 && <div style={{ ...mono, textTransform: 'none', gridColumn: '1 / -1' }}>{t('xcut.noassets')}</div>}
          <div ref={endRef} style={{ gridColumn: '1 / -1', height: 1 }} />
          {loading && <div style={{ ...mono, gridColumn: '1 / -1' }}>…</div>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderTop: `1px solid ${LINE}` }}>
          <span style={{ ...mono, textTransform: 'none' }}>{t('xcut.libhint')}</span>
          <span style={{ flex: 1 }} />
          <button onClick={() => setSel(new Set())} disabled={sel.size === 0} style={{ ...chip(false), opacity: sel.size ? 1 : 0.4 }}>{t('xcut.clearsel')}</button>
          <button onClick={addSelected} disabled={sel.size === 0 || adding} style={{ ...chip(true), background: ACCENT, opacity: sel.size && !adding ? 1 : 0.5 }}>＋ {t('xcut.addsel').replace('{n}', String(sel.size))}</button>
        </div>
      </div>
    </div>
  )
}
