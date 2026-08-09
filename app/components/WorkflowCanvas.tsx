'use client'
// app/components/WorkflowCanvas.tsx
// The workflow BOARD (CC, July 27 → product pipeline, July 28).
//
// A ComfyUI-style canvas over one board. Nodes are generations (uploaded
// source photos, generated angles, videos); wires are derivations. Unlike
// the first version this is an EDITOR, not a viewer: nodes multi-select,
// delete, and drive the actions in the floating toolbar.
//
// Multi-select is the load-bearing part of the product pipeline. Generating
// a product video means handing a model the original photo AND the
// generated angles as reference images at once, so "which nodes are
// selected" IS the input set — not a cursor.
//
// Hand-rolled on purpose: a dotted-grid pan/zoom surface with bezier wires
// is ~300 lines, needs no dependency, and stays in ModelXD's design
// language instead of fighting a library theme.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useT } from '../../lib/i18n'
import ModelPickerDialog from './ModelPickerDialog'

export type NodeKind = 'source' | 'input' | 'video' | 'shot'

export type CanvasNode = {
  id: string
  thumb: string | null
  isVideo: boolean
  parentId: string | null
  parentIds?: string[]
  label?: string
  cost?: number
  kind?: NodeKind | null
  /** Output nodes carry the row they came from and WHICH slot. A two-model
   *  run is two nodes sharing one rowId — the board shows both outputs the
   *  user paid for instead of collapsing them into one. */
  rowId?: string
  slotIdx?: number
  chosen?: boolean
  /** Set on INPUT nodes: the uploaded reference image behind a generation.
   *  Not a database row, so it can be used as a generation input but never
   *  deleted. Shape matches /api/xcreate's `attachments` parameter. */
  attach?: { bucket: string; storagePath: string; mediaType: string; fileName: string; fileSize: number }
  /** 'running' nodes are client-side placeholders for in-flight jobs —
   *  they have a jobId for an id and no row in the database yet. */
  status?: 'done' | 'running' | 'error'
  error?: string | null
  /** Row creation time — shown in the ⓘ panel. */
  createdAt?: string
  /** A GROUP node: several reference uploads stacked into one block.
   *  Click opens the gallery view instead of selecting. */
  stack?: Array<{ url: string | null; fileName: string; mediaType: string }>
  /** The row's original generation prompt — what a canvas ↻ re-runs. */
  prompt?: string
  /** The EXACT files this generation consumed, in slot order — reference
   *  uploads and chain frames alike (owner ask, Aug 9: "what exact
   *  reference and source files"). Shown in the ⓘ panel. */
  sources?: Array<{ url: string | null; fileName: string; mediaType: string }>
}

// One color per SOURCE: every edge inherits the color of the node it leaves,
// so all lines flowing out of one reference / one scene share a hue and can
// be followed through crossings (owner, Aug 9 — and how ComfyUI colors its
// links by type). Palette picked for a dark board, assigned by stable hash.
const WIRE_COLORS = ['#e8453c', '#3c9ee8', '#43c46b', '#e8a53c', '#a35ce8', '#e85c9e', '#4cc4c4', '#c9b34a']
const wireColor = (sourceId: string) => {
  let h = 0
  for (let i = 0; i < sourceId.length; i++) h = (h * 31 + sourceId.charCodeAt(i)) | 0
  return WIRE_COLORS[Math.abs(h) % WIRE_COLORS.length]
}

/** ⓘ panel: everything known about one node. Resolution, length and file
 *  size aren't stored anywhere — they're probed from the media URL right
 *  here, on demand, which is also the only source that can't go stale. */
function NodeActionPanel({ n, origin, onPlay, onClose, onDelete, onRegen, busy }: {
  n: CanvasNode; origin: string | null
  onPlay?: (n: CanvasNode) => void
  onClose: () => void
  /** single-node delete, straight from the panel */
  onDelete?: (n: CanvasNode) => void
  /** re-generate: same prompt + refs, user-picked model + config */
  onRegen?: (n: CanvasNode, model: { id: string; display_name: string }, opts: { duration?: number; resolution?: string; aspect_ratio?: string }) => void
  busy?: boolean
}) {
  const t = useT()
  const [regenOpen, setRegenOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [dur, setDur] = useState<number | null>(null)   // null = same as original
  // Config step (owner, Aug 9: "I need to config it"): picking a model no
  // longer fires the generation — it opens resolution/aspect/length config
  // with a live price, and the ↻ button is the send.
  const [selModel, setSelModel] = useState<any | null>(null)
  const [res, setRes] = useState<string | null>(null)
  const [aspect, setAspect] = useState<string | null>(null)
  const [confirmDel, setConfirmDel] = useState(false)
  const [meta, setMeta] = useState<{ w?: number; h?: number; dur?: number; size?: number }>({})
  useEffect(() => {
    let dead = false
    setMeta({})
    if (!n.thumb) return
    if (n.isVideo) {
      const v = document.createElement('video')
      v.preload = 'metadata'; v.muted = true
      v.onloadedmetadata = () => { if (!dead) setMeta(m => ({ ...m, w: v.videoWidth, h: v.videoHeight, dur: v.duration })) }
      v.src = n.thumb
    } else {
      const im = new Image()
      im.onload = () => { if (!dead) setMeta(m => ({ ...m, w: im.naturalWidth, h: im.naturalHeight })) }
      im.src = n.thumb
    }
    fetch(n.thumb, { method: 'HEAD' })
      .then(r => {
        const len = Number(r.headers.get('content-length'))
        if (!dead && Number.isFinite(len) && len > 0) setMeta(m => ({ ...m, size: len }))
      })
      .catch(() => {})
    return () => { dead = true }
  }, [n])

  const rows: Array<[string, string]> = []
  if (n.label) rows.push(['model', n.label])
  if (origin) rows.push(['scene', origin])
  if (n.kind) rows.push(['kind', n.kind])
  if (meta.w && meta.h) rows.push(['resolution', `${meta.w}×${meta.h}`])
  if (meta.dur) rows.push(['length', `${meta.dur.toFixed(1)}s`])
  if (typeof meta.size === 'number') rows.push(['size', meta.size > 1048576 ? `${(meta.size / 1048576).toFixed(1)} MB` : `${Math.round(meta.size / 1024)} KB`])
  if (n.attach) rows.push(['file', n.attach.fileName])
  if (n.createdAt) rows.push(['created', new Date(n.createdAt).toLocaleString()])
  if (typeof n.cost === 'number' && n.cost > 0) rows.push(['cost', `$${n.cost.toFixed(3)}`])
  if (n.error) rows.push(['error', n.error])

  // The window moves by its header (owner, Aug 9) — a translate offset on
  // top of the anchored position, so resize and anchoring stay intact.
  // Client-pixel deltas map 1:1: this overlay lives OUTSIDE the board's
  // zoom transform. Offset resets with the panel (unmounts on close).
  const [off, setOff] = useState({ x: 0, y: 0 })
  const winDrag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)

  const isVid = n.isVideo || n.kind === 'video'
  const canRegen = !!onRegen && !!n.rowId && !!n.prompt
  const act = (primary = false): React.CSSProperties => ({
    flex: '1 1 auto', padding: '9px 12px', borderRadius: 9, fontSize: 12.5, fontWeight: 700,
    cursor: 'pointer', border: primary ? 'none' : '1px solid #3a3c42',
    background: primary ? 'var(--red)' : 'transparent',
    color: primary ? '#fff' : '#c9cbd1', whiteSpace: 'nowrap',
  })
  const chip = (on: boolean): React.CSSProperties => ({
    padding: '2px 8px', borderRadius: 999, fontSize: 10, fontFamily: 'var(--mono)', cursor: 'pointer',
    border: '1px solid ' + (on ? 'var(--red)' : '#3a3c42'),
    background: on ? 'var(--red)' : 'none', color: on ? '#fff' : '#9a9ca3',
  })

  return (
    <>
    <div
      data-ui
      // The canvas must never pan, select-clear or node-drag from inside
      // this window — and its text must be COPYABLE (owner, Aug 9).
      onPointerDown={e => e.stopPropagation()}
      onPointerMove={e => e.stopPropagation()}
      onPointerUp={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
      style={{
        position: 'absolute', right: 10, top: 44, zIndex: 5,
        width: 'min(430px, calc(100% - 20px))',
        maxHeight: 'calc(100% - 56px)', overflow: 'auto',
        // Native resize (owner, Aug 9: "too much information there") — the
        // grip is the bottom-right corner; the browser writes the chosen
        // size as inline style, which React's diff never claws back.
        resize: 'both', minWidth: 260, minHeight: 150,
        transform: `translate(${off.x}px, ${off.y}px)`,
        background: 'rgba(20,21,24,0.97)', border: '1px solid var(--border2)',
        borderRadius: 12, padding: '14px 16px', backdropFilter: 'blur(6px)',
        userSelect: 'text', WebkitUserSelect: 'text', cursor: 'auto',
      }}>
      <div
        title="drag to move"
        onPointerDown={e => {
          // The ✕ stays a button; only the bare bar drags.
          if ((e.target as HTMLElement).closest('button')) return
          winDrag.current = { sx: e.clientX, sy: e.clientY, ox: off.x, oy: off.y }
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        }}
        onPointerMove={e => {
          const d = winDrag.current
          if (!d) return
          setOff({ x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) })
        }}
        onPointerUp={() => { winDrag.current = null }}
        style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, cursor: winDrag.current ? 'grabbing' : 'grab', userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'none' }}
      >
        <span style={{ fontSize: 11.5, fontFamily: 'var(--mono)', letterSpacing: '0.08em', color: '#c9cbd1', fontWeight: 700, flex: 1 }}>{t('wf.detail')}</span>
        <button onClick={onClose} aria-label="close" style={{ border: 'none', background: 'none', color: '#9a9ca3', cursor: 'pointer', fontSize: 14, padding: 0 }}>✕</button>
      </div>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', gap: 12, fontSize: 11.5, fontFamily: 'var(--mono)', lineHeight: 2 }}>
          <span style={{ color: '#6a6c73', width: 92, flexShrink: 0 }}>{k}</span>
          <span style={{ color: k === 'error' ? '#c4564e' : '#e2e3e7', wordBreak: 'break-word', minWidth: 0 }}>{v}</span>
        </div>
      ))}
      {n.prompt && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11.5, fontFamily: 'var(--mono)', color: '#6a6c73', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ flex: 1 }}>prompt</span>
            <button
              onClick={() => { try { void navigator.clipboard.writeText(n.prompt!) } catch {} }}
              title="copy prompt" aria-label="copy prompt"
              style={{ border: 'none', background: 'none', color: '#9a9ca3', cursor: 'pointer', fontSize: 12, padding: 0 }}
            >⧉</button>
          </div>
          {/* Scrolls instead of clamping (owner, Aug 9) — the full prompt is
              readable and selectable in place, no hover tricks. */}
          <div style={{
            fontSize: 11.5, fontFamily: 'var(--mono)', color: '#e2e3e7', lineHeight: 1.65,
            maxHeight: 150, overflowY: 'auto', overscrollBehavior: 'contain',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '8px 10px',
          }}>{n.prompt}</div>
        </div>
      )}

      {/* The exact files this run consumed (owner, Aug 9), slot order —
          slot 0 is the start frame for recipes that take one. Thumbnails
          inline so "which photo was that" needs no navigation. */}
      {n.sources && n.sources.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11.5, fontFamily: 'var(--mono)', color: '#6a6c73', marginBottom: 4 }}>sources</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {n.sources.map((s, i) => (
              <div key={`${s.fileName}-${i}`} title={s.fileName}
                style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '4px 8px' }}>
                {s.url && !(s.mediaType || '').startsWith('video/') ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.url} alt="" style={{ width: 28, height: 28, borderRadius: 5, objectFit: 'cover', flexShrink: 0 }} />
                ) : (
                  <span aria-hidden style={{ width: 28, textAlign: 'center', fontSize: 15, flexShrink: 0 }}>{(s.mediaType || '').startsWith('video/') ? '🎞' : '🖼'}</span>
                )}
                <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: '#c9cbd1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                  {`${i + 1} · ${s.fileName}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Every node action lives HERE (owner, Aug 9) — one popup, no
          scattered icons: play, re-generate (model + length), delete. */}
      <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
        {n.thumb && onPlay && (
          <button onClick={() => onPlay(n)} style={act(true)}>▶ {t('wf.play')}</button>
        )}
        {canRegen && (
          <button disabled={busy} onClick={() => setRegenOpen(o => !o)} style={{ ...act(), opacity: busy ? 0.5 : 1 }}>
            ↻ {t('wf.regen')}
          </button>
        )}
        {onDelete && n.rowId && (confirmDel ? (
          <button onClick={() => { onDelete(n); onClose() }} style={{ ...act(), border: '1px solid var(--red)', color: 'var(--red)' }}>
            {t('xd.sb.confirmdel')}
          </button>
        ) : (
          <button onClick={() => { setConfirmDel(true); setTimeout(() => setConfirmDel(false), 3500) }} style={act()}>
            ✕ {t('wf.delete')}
          </button>
        ))}
      </div>

      {regenOpen && canRegen && (() => {
        // Live price for the configured run: chosen resolution's rate ×
        // chosen length (falling back to the original clip's length).
        const pvs = selModel?.model_pricing?.per_video_second
        const resKeys: string[] = pvs && typeof pvs === 'object' ? Object.keys(pvs) : []
        const perSec = pvs ? Number((pvs as any)[res ?? resKeys[0]]) : NaN
        const effDur = dur ?? (meta.dur ? Math.round(meta.dur) : null)
        const est = isVid && Number.isFinite(perSec) && effDur ? perSec * effDur : null
        return (
        <div style={{ marginTop: 9, borderTop: '1px solid #2a2c31', paddingTop: 9 }}>
          <button onClick={() => setPickerOpen(true)} style={{ ...act(!selModel), width: '100%' }}>
            ☰ {selModel ? selModel.display_name : t('gm.choosemodel')}
          </button>
          {selModel && (
            <>
              {isVid && (
                <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
                  <span style={{ fontSize: 9.5, fontFamily: 'var(--mono)', color: '#6a6c73', width: 52 }}>{t('wf.length')}</span>
                  {([null, 3, 5, 6, 8, 10] as Array<number | null>).map(d => (
                    <button key={String(d)} onClick={() => setDur(d)} style={chip(dur === d)}>
                      {d === null ? t('wf.same') : `${d}s`}
                    </button>
                  ))}
                </div>
              )}
              {isVid && resKeys.length > 1 && (
                <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
                  <span style={{ fontSize: 9.5, fontFamily: 'var(--mono)', color: '#6a6c73', width: 52 }}>{t('wf.res')}</span>
                  {resKeys.map(k => (
                    <button key={k} onClick={() => setRes(k)} style={chip((res ?? resKeys[0]) === k)}>{k}</button>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
                <span style={{ fontSize: 9.5, fontFamily: 'var(--mono)', color: '#6a6c73', width: 52 }}>{t('wf.aspect')}</span>
                {([null, '16:9', '9:16', '1:1'] as Array<string | null>).map(a => (
                  <button key={String(a)} onClick={() => setAspect(a)} style={chip(aspect === a)}>
                    {a === null ? t('wf.same') : a}
                  </button>
                ))}
              </div>
              <button
                onClick={() => {
                  onRegen!(n, { id: selModel.id, display_name: selModel.display_name }, {
                    duration: dur ?? undefined,
                    resolution: (res ?? (resKeys.length > 1 ? resKeys[0] : undefined)) || undefined,
                    aspect_ratio: aspect ?? undefined,
                  })
                  onClose()
                }}
                style={{ ...act(true), width: '100%', marginTop: 10 }}
              >
                ↻ {t('wf.regen')}{est != null ? ` — $${est.toFixed(2)}` : ''}
              </button>
            </>
          )}
        </div>
        )
      })()}
    </div>
    {/* OUTSIDE the panel div: its backdropFilter makes it the containing
        block for position:fixed, which squashed the picker to panel width
        (owner, Aug 9: "check the size"). As a sibling it lays out against
        the real viewport — and still lives inside the fullscreen element. */}
    {pickerOpen && canRegen && (
      // data-ui + stopped pointer events: a REAL click begins with
      // pointerdown, which was bubbling to the canvas host, arming a pan,
      // and the pointerup then read as "empty-space click" — clearing the
      // selection and unmounting this whole panel (and the picker with it)
      // before the row's click could land. "The window just closed and
      // nothing happened" (owner, Aug 9). Synthetic .click() tests missed
      // it because they skip pointer events entirely.
      <div
        data-ui
        onPointerDown={e => e.stopPropagation()}
        onPointerMove={e => e.stopPropagation()}
        onPointerUp={e => e.stopPropagation()}
        onClick={e => e.stopPropagation()}
      >
        <ModelPickerDialog
          mode={isVid ? 'video' : 'image'}
          // A node born from references can regenerate on ANY model that eats
          // images — image_to_video AND reference_to_video alike (owner, Aug 9).
          recipeMode={(isVid
            ? ((n.parentIds ?? []).some(id => id.startsWith('att::') || id === 'refs::group')
              ? ['image_to_video', 'reference_frames']
              : 'text_to_video')
            : 'text_to_image') as any}
          slotIds={[]}
          onClose={() => setPickerOpen(false)}
          onSelect={(m: any) => {
            // Picking is not sending (owner, Aug 9): the model lands in the
            // config step — length, resolution, aspect, live price — and
            // the ↻ button below is the actual trigger.
            setSelModel(m); setRes(null)
            setPickerOpen(false)
          }}
        />
      </div>
    )}
    </>
  )
}

const NODE_W = 168
const NODE_H = 138   // 100 thumb + footer
const COL_GAP = 110  // horizontal space for the wires
const ROW_GAP = 28

const KIND_BADGE: Record<NodeKind, { text: string; bg: string }> = {
  source: { text: 'SRC',   bg: '#3c6ee8' },
  input:  { text: 'INPUT', bg: '#5a6472' },
  video:  { text: 'VIDEO', bg: '#e8453c' },
  shot:   { text: 'SHOT',  bg: '#9a5ce8' },
}

export default function WorkflowCanvas({
  nodes, selectedIds, onSelect, onClearSelection,
  onDelete, busy = false, height = 460, onPlay, nodeOrigin, sceneOf, onRerun,
}: {
  nodes: CanvasNode[]
  selectedIds: string[]
  /** additive = shift/cmd-click: add to the selection instead of replacing. */
  onSelect: (n: CanvasNode, additive: boolean) => void
  onClearSelection: () => void
  onDelete?: (nodes: CanvasNode[]) => void
  busy?: boolean
  /** XCreate keeps the compact 460px board; /xdirect runs it as the stage. */
  height?: number | string
  /** ▶ on a node (card or ⓘ panel). Click alone only ever selects —
   *  play is always this explicit button (owner, Aug 9). */
  onPlay?: (n: CanvasNode) => void
  /** Resolves a node to its storyboard origin ("S2·C1 · The Reach"). */
  nodeOrigin?: (n: CanvasNode) => string | null
  /** Resolves a node to its full storyboard scene object — the scene box's
   *  click-through detail window reads title/script/shot/model from it. */
  sceneOf?: (n: CanvasNode) => any
  /** ↻ same prompt, different model + config — the new output lands as a
   *  sibling of the original. */
  onRerun?: (n: CanvasNode, model: { id: string; display_name: string }, opts: { duration?: number; resolution?: string; aspect_ratio?: string }) => void
}) {
  const t = useT()
  const sel = useMemo(() => new Set(selectedIds), [selectedIds])
  const [info, setInfo] = useState<CanvasNode | null>(null)
  // ── Native fullscreen for the whole board (owner, Aug 9) ─────────────
  const [isFs, setIsFs] = useState(false)
  useEffect(() => {
    const onFs = () => setIsFs(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])
  // In-canvas playback + reference gallery. Rendered INSIDE the host
  // element, so they work in native fullscreen — closing them stays
  // fullscreen (owner, Aug 9: playback must never eject you from the board).
  const [innerPlay, setInnerPlay] = useState<{ url: string; isVideo: boolean } | null>(null)
  const [gallery, setGallery] = useState<CanvasNode | null>(null)
  // ⇆ side-by-side compare (owner, Aug 9: "the canvas should be a wiring
  // tool"). Re-generate lives in the node's action panel and delegates to
  // the page — in XDirect the director runs it through the normal billing
  // gate; the new output lands as the original's sibling.
  const [compare, setCompare] = useState<[CanvasNode, CanvasNode] | null>(null)
  // In-canvas status line (owner, Aug 9): in fullscreen the chat rail is
  // invisible, so a ↻ send must SAY it went somewhere — toast on send,
  // then a pill while the director is mid-turn.
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<any>(null)
  const showToast = (s: string) => {
    setToast(s)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 8000)
  }
  const play = (n: CanvasNode) => {
    setInfo(null)
    if (!n.thumb) return
    if (isFs || !onPlay) setInnerPlay({ url: n.thumb, isVideo: n.isVideo })
    else onPlay(n)
  }

  // ── Layout: generation depth → column, siblings stack in rows. ──────────
  const layout = useMemo(() => {
    const byId = new Map(nodes.map(n => [n.id, n]))
    const parentsOf = (n: CanvasNode) =>
      ((n.parentIds && n.parentIds.length > 0) ? n.parentIds : (n.parentId ? [n.parentId] : []))
        .filter(p => byId.has(p))

    // A node sits one column right of its DEEPEST parent, so a video built
    // from the source plus three angles lands after the angles, not beside
    // the source. Memoised, with a visited set so a bad edge can't hang the
    // board.
    const memo = new Map<string, number>()
    const depthOf = (id: string, seen: Set<string>): number => {
      const hit = memo.get(id)
      if (hit !== undefined) return hit
      if (seen.has(id)) return 0
      seen.add(id)
      const n = byId.get(id)
      const ps = n ? parentsOf(n) : []
      const d = ps.length > 0 ? Math.max(...ps.map(p => depthOf(p, seen))) + 1 : 0
      memo.set(id, d)
      return d
    }

    const cols = new Map<number, CanvasNode[]>()
    for (const n of nodes) {
      const d = depthOf(n.id, new Set())
      if (!cols.has(d)) cols.set(d, [])
      cols.get(d)!.push(n)
    }
    const pos = new Map<string, { x: number; y: number }>()
    const maxRows = Math.max(1, ...[...cols.values()].map(c => c.length))
    const fullH = maxRows * (NODE_H + ROW_GAP)
    for (const [d, col] of cols) {
      // Takes of the same shot sit TOGETHER (owner, Aug 9: "it should be
      // grouped with the original one so we can do side by side
      // comparison"). A ↻ re-runs its prompt verbatim, so same-prompt
      // nodes in a column are alternate takes — seat each new take under
      // the first, not at the bottom of the column with the strangers.
      const order: string[] = []
      const clusters = new Map<string, CanvasNode[]>()
      for (const n of col) {
        const key = n.prompt ? 'p:' + n.prompt : 'id:' + n.id
        if (!clusters.has(key)) { clusters.set(key, []); order.push(key) }
        clusters.get(key)!.push(n)
      }
      const seated = order.flatMap(k => clusters.get(k)!)
      const colH = seated.length * (NODE_H + ROW_GAP)
      seated.forEach((n, i) => {
        pos.set(n.id, {
          x: 40 + d * (NODE_W + COL_GAP),
          y: 40 + (fullH - colH) / 2 + i * (NODE_H + ROW_GAP),
        })
      })
    }
    const width = 80 + (Math.max(0, ...[...cols.keys()]) + 1) * (NODE_W + COL_GAP)
    return { pos, byId, parentsOf, height: fullH + 80, width }
  }, [nodes])

  // ── Pan + zoom. Drag empty canvas to pan, wheel to zoom. ────────────────
  // Thumbnails whose signed URL 403'd, keyed BY URL. Keying by url (not by
  // node id) matters: when the board re-signs a stale link the key changes,
  // so the new URL is retried automatically. The first version of this set
  // style.display='none' imperatively in onError, and React reused the same
  // <img> element when the src changed — so a node that had once expired
  // stayed invisible even after a perfectly good URL arrived.
  const [failed, setFailed] = useState<Record<string, true>>({})

  const [view, setView] = useState({ x: 0, y: 0, z: 1 })
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null)
  const hostRef = useRef<HTMLDivElement>(null)

  // Wheel-zoom has to be a MANUAL listener with passive:false. React
  // registers onWheel as passive, so preventDefault() there is ignored and
  // the browser scrolls the page instead of zooming the board — the hint
  // said "scroll to zoom" while the page slid out from under you.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const onWheelRaw = (e: WheelEvent) => {
      // Wheels over any UI layer (action panel, gallery, model picker,
      // toolbars) scroll THAT content, not the board zoom (owner, Aug 9).
      // Only the board layer itself — or the bare host — zooms.
      const el = e.target as HTMLElement | null
      if (el && el !== host && !el.closest('[data-board]')) return
      e.preventDefault()
      // Proportional to the wheel delta, not 10% per EVENT — trackpads fire
      // dozens of small events per flick, which made zoom feel like a
      // rocket (owner, Aug 9). exp keeps it smooth and symmetric; the clamp
      // tames free-spinning mouse wheels that report deltas of 300+.
      const d = Math.max(-100, Math.min(100, e.deltaY))
      setView(v => ({ ...v, z: Math.min(2, Math.max(0.35, v.z * Math.exp(-d * 0.0012))) }))
    }
    host.addEventListener('wheel', onWheelRaw, { passive: false })
    return () => host.removeEventListener('wheel', onWheelRaw)
  }, [])

  const onPointerDown = (e: React.PointerEvent) => {
    // Only pan when grabbing the BACKGROUND. Nodes are their own click
    // targets, and the floating toolbar is chrome sitting on top of the
    // canvas — pressing either must not start a pan, or the toolbar's own
    // buttons arm a drag that then eats the click.
    const el = e.target as HTMLElement
    if (el.closest('[data-node]') || el.closest('[data-ui]')) return
    drag.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) d.moved = true
    // Resolve the origin NOW, not inside the updater. React may run the
    // updater after onPointerUp has already nulled drag.current, and reading
    // drag.current!.ox in there threw "Cannot read properties of null" the
    // first time anyone clicked the toolbar.
    const nx = d.ox + dx, ny = d.oy + dy
    setView(v => ({ ...v, x: nx, y: ny }))
  }
  const onPointerUp = () => {
    // A click on empty space (as opposed to a pan) clears the selection —
    // the standard canvas gesture, and the only way to deselect everything
    // without hunting for a button.
    if (drag.current && !drag.current.moved) { onClearSelection(); setInfo(null); setSceneInfo(null) }
    drag.current = null
  }
  // ── Node dragging (owner ask, Aug 9): auto-layout proposes, the user
  // disposes. Overrides are session-local — a reload re-lays the board out.
  const [nodePos, setNodePos] = useState<Record<string, { x: number; y: number }>>({})
  const nodeDrag = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null)
  const justDraggedRef = useRef(false)   // a finished drag must not click-select
  const posOf = (id: string) => nodePos[id] ?? layout.pos.get(id)
  // Scene boxes drag as a unit (owner, Aug 9): grabbing a box moves every
  // take in it; a still click on it opens the scene's detail window.
  const boxDrag = useRef<{ key: string; sx: number; sy: number; starts: Record<string, { x: number; y: number }>; moved: boolean } | null>(null)
  const [sceneInfo, setSceneInfo] = useState<{ label: string; scene: any } | null>(null)
  // Scene window moves by its header too — offset resets on each open.
  const [sceneOff, setSceneOff] = useState({ x: 0, y: 0 })
  const sceneWinDrag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)

  // ── Wires: routed through a BOTTOM CORRIDOR (owner, Aug 9: "they should
  // not block any box or cards"). Out of the parent, straight down in the
  // column gap, along a corridor below everything, and up into the child —
  // a wire never crosses a card or a scene box. Lanes (hashed per source,
  // like the colors) keep parallel runs from stacking on one line.
  const corridorY = (() => {
    let maxB = 0
    for (const n of nodes) { const p = posOf(n.id); if (p) maxB = Math.max(maxB, p.y + NODE_H) }
    return maxB + 44
  })()
  const laneOf = (id: string) => {
    let h = 0
    for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0
    return Math.abs(h) % 6
  }
  const wires = nodes.flatMap(n => {
    const c = posOf(n.id)
    if (!c) return []
    return layout.parentsOf(n).flatMap(pid => {
      const p = posOf(pid)
      if (!p) return []
      const lane = laneOf(pid)
      const x1 = p.x + NODE_W, y1 = p.y + NODE_H / 2
      const x2 = c.x,          y2 = c.y + NODE_H / 2
      const yB = corridorY + lane * 8
      const xd = x1 + 16 + lane * 7          // drop column, inside the gap
      const xu = x2 - 16 - lane * 7          // rise column, inside the gap
      const r  = 10
      const lit = sel.has(n.id) || sel.has(pid)
      return [{
        key: `${pid}->${n.id}`,
        d: [
          `M ${x1} ${y1}`,
          `L ${xd - r} ${y1}`, `Q ${xd} ${y1} ${xd} ${y1 + r}`,
          `L ${xd} ${yB - r}`, `Q ${xd} ${yB} ${xd + r} ${yB}`,
          `L ${xu - r} ${yB}`, `Q ${xu} ${yB} ${xu} ${yB - r}`,
          `L ${xu} ${y2 + r}`, `Q ${xu} ${y2} ${xu + r} ${y2}`,
          `L ${x2} ${y2}`,
        ].join(' '),
        lit,
        color: wireColor(pid),
      }]
    })
  })

  // ── Scene area boxes (owner ask, Aug 9): every storyboard shot draws a
  // border around its takes, so "which nodes are Scene 1" is read off the
  // board, not deduced. Membership is the seating rule — same verbatim
  // prompt = takes of one shot — and the label comes from whichever take
  // the storyboard claims. Uses posOf, so a dragged node stretches its box.
  const sceneBoxes = (() => {
    if (!nodeOrigin) return []
    const clusters = new Map<string, CanvasNode[]>()
    for (const n of nodes) {
      if (!n.rowId) continue
      const key = n.prompt ? 'p:' + n.prompt : 'id:' + n.id
      if (!clusters.has(key)) clusters.set(key, [])
      clusters.get(key)!.push(n)
    }
    const out: Array<{ key: string; label: string; scene: any; memberIds: string[]; x: number; y: number; w: number; h: number }> = []
    for (const [key, members] of clusters) {
      let label: string | null = null
      for (const m of members) { label = nodeOrigin(m); if (label) break }
      if (!label) continue
      const scene = sceneOf ? (members.map(m => sceneOf(m)).find(Boolean) ?? null) : null
      const ps = members.map(m => posOf(m.id)).filter(Boolean) as Array<{ x: number; y: number }>
      if (ps.length === 0) continue
      const minX = Math.min(...ps.map(p => p.x)), maxX = Math.max(...ps.map(p => p.x))
      const minY = Math.min(...ps.map(p => p.y)), maxY = Math.max(...ps.map(p => p.y))
      out.push({ key, label, scene, memberIds: members.map(m => m.id), x: minX - 12, y: minY - 26, w: maxX - minX + NODE_W + 24, h: maxY - minY + NODE_H + 38 })
    }
    return out
  })()

  const selNodes    = nodes.filter(n => sel.has(n.id))
  const selReady    = selNodes.filter(n => n.status !== 'running')
  // Input nodes are attachments, not rows — there is nothing to soft-delete.
  const selDeletable = selReady.filter(n => !!n.rowId)
  const boardCost   = nodes.reduce((sum, n) => sum + (n.cost ?? 0), 0)

  const btn = (enabled: boolean): React.CSSProperties => ({
    background: 'transparent',
    border: '1px solid ' + (enabled ? 'var(--red)' : '#3a3c42'),
    color: enabled ? 'var(--red)' : '#5a5c63',
    borderRadius: 7, padding: '5px 11px', fontSize: 10.5, fontFamily: 'var(--mono)',
    letterSpacing: '0.07em', textTransform: 'uppercase', whiteSpace: 'nowrap',
    cursor: enabled ? 'pointer' : 'not-allowed',
  })

  return (
    <div
      ref={hostRef}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{
        position: 'relative', height: isFs ? '100vh' : height, marginBottom: isFs ? 0 : 24, borderRadius: 12,
        border: '1px solid var(--border2)', overflow: 'hidden',
        cursor: drag.current ? 'grabbing' : 'grab', touchAction: 'none',
        // ComfyUI-style dotted grid on a dark surface.
        background: '#141518',
        backgroundImage: 'radial-gradient(circle, #2a2c31 1px, transparent 1px)',
        backgroundSize: '22px 22px',
      }}
    >
      <div data-board style={{ position: 'absolute', transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`, transformOrigin: '0 0' }}>
        <svg
          width={Math.max(1200, layout.width)} height={Math.max(600, layout.height, corridorY + 100)}
          style={{ position: 'absolute', pointerEvents: 'none', overflow: 'visible' }}
        >
          {wires.map(w => (
            <path
              key={w.key} d={w.d} fill="none" stroke={w.color}
              strokeWidth={w.lit ? 2.5 : 2} strokeOpacity={w.lit ? 0.95 : 0.55}
            />
          ))}
        </svg>
        {/* Scene boxes render under the nodes, so node clicks/drags still
            win on card area. The box's own surface drags the whole scene;
            a still click opens the scene's detail window (owner, Aug 9). */}
        {sceneBoxes.map(b => (
          <div
            key={b.key}
            title="click: scene details · drag: move scene"
            onPointerDown={e => {
              e.stopPropagation()
              const starts: Record<string, { x: number; y: number }> = {}
              for (const id of b.memberIds) { const p = posOf(id); if (p) starts[id] = p }
              boxDrag.current = { key: b.key, sx: e.clientX, sy: e.clientY, starts, moved: false }
              ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
            }}
            onPointerMove={e => {
              const d = boxDrag.current
              if (!d || d.key !== b.key) return
              const dx = (e.clientX - d.sx) / view.z
              const dy = (e.clientY - d.sy) / view.z
              if (!d.moved && Math.abs(dx) + Math.abs(dy) < 4) return
              d.moved = true
              setNodePos(m => {
                const next = { ...m }
                for (const [id, s] of Object.entries(d.starts)) next[id] = { x: s.x + dx, y: s.y + dy }
                return next
              })
            }}
            onPointerUp={e => {
              e.stopPropagation()
              const d = boxDrag.current
              boxDrag.current = null
              if (!d?.moved && b.scene) { setSceneOff({ x: 0, y: 0 }); setSceneInfo({ label: b.label, scene: b.scene }) }
            }}
            style={{
              position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h,
              border: '1.5px dashed rgba(255,255,255,0.18)', borderRadius: 14,
              background: 'rgba(255,255,255,0.02)',
              cursor: boxDrag.current?.key === b.key ? 'grabbing' : 'grab',
            }}>
            <span style={{
              position: 'absolute', top: 5, left: 10, fontSize: 9.5,
              fontFamily: 'var(--mono)', letterSpacing: '0.08em',
              color: '#9a9ca3', whiteSpace: 'nowrap', pointerEvents: 'none',
            }}>{b.label}</span>
          </div>
        ))}
        {nodes.map(n => {
          const p = posOf(n.id)
          if (!p) return null
          const selected = sel.has(n.id)
          const running  = n.status === 'running'
          const errored  = n.status === 'error'
          const badge    = n.kind ? KIND_BADGE[n.kind] : null
          return (
            <div
              key={n.id} data-node
              onClick={e => {
                e.stopPropagation()
                // A drag that just ended must not read as a click-select.
                if (justDraggedRef.current) { justDraggedRef.current = false; return }
                // The reference stack opens its gallery; everything else selects.
                if (n.stack) { setGallery(n); return }
                const additive = e.shiftKey || e.metaKey || e.ctrlKey
                onSelect(n, additive)
                // Plain click IS the way in (owner, Aug 9): the action panel
                // opens with the node — no extra button to find. Additive
                // clicks only adjust the selection.
                if (!additive) setInfo(n)
              }}
              onPointerDown={e => {
                // Node drags beat canvas pans; plain clicks fall through to
                // onClick because `moved` stays false under the threshold.
                e.stopPropagation()
                nodeDrag.current = { id: n.id, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y, moved: false }
                ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
              }}
              onPointerMove={e => {
                const d = nodeDrag.current
                if (!d || d.id !== n.id) return
                const dx = (e.clientX - d.sx) / view.z
                const dy = (e.clientY - d.sy) / view.z
                if (!d.moved && Math.abs(dx) + Math.abs(dy) < 4) return
                d.moved = true
                setNodePos(m => ({ ...m, [n.id]: { x: d.ox + dx, y: d.oy + dy } }))
              }}
              onPointerUp={() => {
                const d = nodeDrag.current
                nodeDrag.current = null
                justDraggedRef.current = !!d?.moved
              }}
              style={{
                position: 'absolute', left: p.x, top: p.y, width: NODE_W,
                borderRadius: 10, overflow: 'hidden', cursor: nodeDrag.current?.id === n.id ? 'grabbing' : 'pointer',
                border: '2px solid ' + (selected ? 'var(--red)' : errored ? '#7a3a36' : '#33353b'),
                boxShadow: selected ? '0 0 0 4px rgba(232,69,60,0.25)' : '0 2px 10px rgba(0,0,0,0.4)',
                background: '#1d1f24',
                opacity: running ? 0.75 : 1,
              }}
            >
              <div style={{ position: 'relative', height: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000' }}>
                {running
                  ? <span className="nav-history-spin" style={{ color: '#8a8c93', fontSize: 18 }}>◠</span>
                  : errored
                    ? <span style={{ color: '#c4564e', fontSize: 18 }} title={n.error ?? undefined}>⚠</span>
                    : n.stack ? (
                      // The reference pile: up to three fanned thumbnails
                      // and a count — click opens the gallery.
                      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                        {n.stack.slice(0, 3).map((s, si) => s.url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={`${s.fileName}-${si}`} src={s.url} alt="" draggable={false}
                            style={{
                              position: 'absolute', left: 16 + si * 12, top: 8 + si * 5,
                              width: '62%', height: '76%', objectFit: 'cover', borderRadius: 6,
                              border: '1px solid #3a3c42', transform: `rotate(${(si - 1) * 5}deg)`,
                              boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
                            }}
                          />
                        ) : null)}
                        <span style={{
                          position: 'absolute', right: 6, bottom: 4, fontSize: 10,
                          fontFamily: 'var(--mono)', color: '#e6e7ea',
                          background: 'rgba(0,0,0,0.55)', borderRadius: 4, padding: '1px 6px',
                        }}>{n.stack.length}</span>
                      </div>
                    )
                    : (n.thumb && !failed[n.thumb])
                      ? (n.isVideo
                        ? <video
                            src={n.thumb} muted playsInline
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            onError={() => setFailed(f => ({ ...f, [n.thumb!]: true }))}
                          />
                        : <img
                            src={n.thumb} alt="" draggable={false}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            onError={() => setFailed(f => ({ ...f, [n.thumb!]: true }))}
                          />)
                      : <span style={{ color: '#555', fontSize: 11, fontFamily: 'var(--mono)' }}>expired</span>}
                {badge && (
                  <span style={{
                    position: 'absolute', left: 6, top: 6, background: badge.bg, color: '#fff',
                    fontSize: 8.5, fontFamily: 'var(--mono)', letterSpacing: '0.08em',
                    padding: '2px 5px', borderRadius: 4, opacity: 0.92,
                  }}>{badge.text}</span>
                )}
              </div>
              <div style={{ padding: '6px 9px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{ fontSize: 10, fontFamily: 'var(--mono)', color: '#9a9ca3', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}
                  title={n.error ?? n.label}
                >
                  {n.label ?? '—'}
                </span>
                {typeof n.cost === 'number' && n.cost > 0 && (
                  <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--red)', flexShrink: 0 }}>${n.cost.toFixed(3)}</span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Floating selection toolbar. Appears only with a selection, so the
          empty board stays clean. */}
      {selNodes.length > 0 && (
        <div data-ui style={{
          position: 'absolute', left: 10, top: 10, display: 'flex', alignItems: 'center',
          gap: 8, flexWrap: 'wrap', maxWidth: 'calc(100% - 20px)',
          background: 'rgba(20,21,24,0.94)', border: '1px solid var(--border2)',
          borderRadius: 9, padding: '7px 10px', backdropFilter: 'blur(6px)',
        }}>
          <span style={{ fontSize: 10.5, fontFamily: 'var(--mono)', color: '#9a9ca3', letterSpacing: '0.07em' }}>
            {selNodes.length} {t('wf.selected')}
          </span>
          <button
            disabled={busy || selDeletable.length === 0}
            onClick={e => { e.stopPropagation(); if (!busy && selDeletable.length > 0) onDelete?.(selDeletable) }}
            style={btn(!busy && selDeletable.length > 0)}
            title={selDeletable.length === 0 ? t('wf.inputnodelete') : undefined}
          >✕ {t('wf.delete')}</button>
          {selNodes.length === 2 && selNodes.every(n => !!n.thumb) && (
            <button
              onClick={e => { e.stopPropagation(); setCompare([selNodes[0], selNodes[1]]) }}
              style={btn(true)}
            >⇆ {t('wf.compare')}</button>
          )}
          <button
            onClick={e => { e.stopPropagation(); onClearSelection() }}
            style={{ ...btn(true), border: '1px solid #3a3c42', color: '#9a9ca3' }}
          >{t('wf.clearsel')}</button>
        </div>
      )}

      {/* Scene detail window — opened by a still click on a scene box.
          Left corner (the node ⓘ panel owns the right), same shield and
          resize behavior. */}
      {sceneInfo && (
        <div
          data-ui
          onPointerDown={e => e.stopPropagation()}
          onPointerMove={e => e.stopPropagation()}
          onPointerUp={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          style={{
            position: 'absolute', left: 10, top: 44, zIndex: 5,
            width: 'min(400px, calc(100% - 20px))',
            maxHeight: 'calc(100% - 56px)', overflow: 'auto',
            resize: 'both', minWidth: 260, minHeight: 150,
            transform: `translate(${sceneOff.x}px, ${sceneOff.y}px)`,
            background: 'rgba(20,21,24,0.97)', border: '1px solid var(--border2)',
            borderRadius: 12, padding: '14px 16px', backdropFilter: 'blur(6px)',
            userSelect: 'text', WebkitUserSelect: 'text', cursor: 'auto',
          }}>
          <div
            title="drag to move"
            onPointerDown={e => {
              if ((e.target as HTMLElement).closest('button')) return
              sceneWinDrag.current = { sx: e.clientX, sy: e.clientY, ox: sceneOff.x, oy: sceneOff.y }
              ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
            }}
            onPointerMove={e => {
              const d = sceneWinDrag.current
              if (!d) return
              setSceneOff({ x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) })
            }}
            onPointerUp={() => { sceneWinDrag.current = null }}
            style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, cursor: sceneWinDrag.current ? 'grabbing' : 'grab', userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'none' }}
          >
            <span style={{ fontSize: 11.5, fontFamily: 'var(--mono)', letterSpacing: '0.08em', color: '#c9cbd1', fontWeight: 700, flex: 1 }}>{sceneInfo.label}</span>
            <button onClick={() => setSceneInfo(null)} aria-label="close" style={{ border: 'none', background: 'none', color: '#9a9ca3', cursor: 'pointer', fontSize: 14, padding: 0 }}>✕</button>
          </div>
          {([
            ['title',  sceneInfo.scene?.title],
            ['length', typeof sceneInfo.scene?.duration_s === 'number' ? `${sceneInfo.scene.duration_s}s` : null],
            ['model',  sceneInfo.scene?.model_name],
            ['price',  typeof sceneInfo.scene?.cost === 'number' ? `$${sceneInfo.scene.cost.toFixed(2)}`
                     : typeof sceneInfo.scene?.estimate === 'number' ? `~$${sceneInfo.scene.estimate.toFixed(2)}` : null],
            ['status', sceneInfo.scene?.status],
          ] as Array<[string, string | null | undefined]>).filter(([, v]) => v).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', gap: 12, fontSize: 11.5, fontFamily: 'var(--mono)', lineHeight: 2 }}>
              <span style={{ color: '#6a6c73', width: 72, flexShrink: 0 }}>{k}</span>
              <span style={{ color: '#e2e3e7', wordBreak: 'break-word', minWidth: 0 }}>{v}</span>
            </div>
          ))}
          {sceneInfo.scene?.script && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11.5, fontFamily: 'var(--mono)', color: '#6a6c73', marginBottom: 3 }}>script</div>
              <div style={{ fontSize: 12, color: '#e2e3e7', lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '8px 10px' }}>{sceneInfo.scene.script}</div>
            </div>
          )}
          {sceneInfo.scene?.shot && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11.5, fontFamily: 'var(--mono)', color: '#6a6c73', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ flex: 1 }}>shot</span>
                <button
                  onClick={() => { try { void navigator.clipboard.writeText(sceneInfo.scene.shot) } catch {} }}
                  title="copy shot prompt" aria-label="copy shot prompt"
                  style={{ border: 'none', background: 'none', color: '#9a9ca3', cursor: 'pointer', fontSize: 12, padding: 0 }}
                >⧉</button>
              </div>
              <div style={{
                fontSize: 11.5, fontFamily: 'var(--mono)', color: '#e2e3e7', lineHeight: 1.65,
                maxHeight: 150, overflowY: 'auto', overscrollBehavior: 'contain',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '8px 10px',
              }}>{sceneInfo.scene.shot}</div>
            </div>
          )}
        </div>
      )}

      {/* Zoom cluster — always visible; the % chip is the reset (view AND
          any hand-dragged node positions go back to the tidy layout). */}
      <div data-ui style={{
        position: 'absolute', right: 10, top: 10, display: 'flex', alignItems: 'center', gap: 2,
        background: 'rgba(20,21,24,0.94)', border: '1px solid var(--border2)',
        borderRadius: 9, padding: '3px 5px', backdropFilter: 'blur(6px)',
      }}>
        <button
          onClick={e => { e.stopPropagation(); setView(v => ({ ...v, z: Math.max(0.35, v.z / 1.2) })) }}
          aria-label="zoom out"
          style={{ border: 'none', background: 'none', color: '#9a9ca3', fontSize: 15, width: 26, height: 24, cursor: 'pointer', lineHeight: 1 }}
        >−</button>
        <button
          onClick={e => { e.stopPropagation(); setView({ x: 0, y: 0, z: 1 }); setNodePos({}) }}
          title={t('wf.resetview')}
          style={{ border: 'none', background: 'none', color: '#9a9ca3', fontSize: 10.5, fontFamily: 'var(--mono)', minWidth: 38, height: 24, cursor: 'pointer' }}
        >{Math.round(view.z * 100)}%</button>
        <button
          onClick={e => { e.stopPropagation(); setView(v => ({ ...v, z: Math.min(2, v.z * 1.2) })) }}
          aria-label="zoom in"
          style={{ border: 'none', background: 'none', color: '#9a9ca3', fontSize: 15, width: 26, height: 24, cursor: 'pointer', lineHeight: 1 }}
        >＋</button>
        <button
          onClick={e => {
            e.stopPropagation()
            const el = hostRef.current as any
            if (document.fullscreenElement) { try { void document.exitFullscreen() } catch {} }
            else { try { void (el?.requestFullscreen?.() ?? el?.webkitRequestFullscreen?.()) } catch {} }
          }}
          aria-label={t('wf.fullscreen')} title={t('wf.fullscreen')}
          style={{ border: 'none', background: 'none', color: isFs ? 'var(--red)' : '#9a9ca3', fontSize: 13, width: 26, height: 24, cursor: 'pointer', lineHeight: 1 }}
        >⛶</button>
      </div>

      {info && (
        <NodeActionPanel
          n={info} origin={nodeOrigin?.(info) ?? null}
          onPlay={play} onClose={() => setInfo(null)} busy={busy}
          onDelete={onDelete ? (nn) => { onDelete([nn]) } : undefined}
          onRegen={onRerun ? (nn, m, o) => { console.info('[xdirect:canvas] ↻ send', { nodeId: nn.id, rowId: nn.rowId, model: m.display_name, opts: o }); showToast(`↻ ${m.display_name} — ${t('wf.sent')}`); onRerun(nn, m, o) } : undefined}
        />
      )}

      {/* Status line: visible feedback for actions whose life continues in
          the chat rail — essential in fullscreen, harmless outside it. */}
      {(busy || toast) && (
        <div data-ui style={{
          position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: 30, zIndex: 6,
          background: 'rgba(20,21,24,0.96)', border: '1px solid var(--border2)', borderRadius: 999,
          padding: '7px 16px', fontSize: 11.5, fontFamily: 'var(--mono)', color: '#e2e3e7',
          whiteSpace: 'nowrap', maxWidth: 'calc(100% - 40px)', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {busy ? `⏳ ${t('wf.director')}` : toast}
        </div>
      )}

      {/* Reference gallery — the stack block, unfolded. Lives inside the
          host so fullscreen keeps it. */}
      {gallery?.stack && (
        <div data-ui style={{ position: 'absolute', inset: 0, zIndex: 8, background: 'rgba(12,13,15,0.97)', padding: '16px 18px', overflowY: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <span style={{ fontSize: 11, fontFamily: 'var(--mono)', letterSpacing: '0.08em', color: '#c9cbd1', flex: 1 }}>
              {gallery.label ?? 'references'}
            </span>
            <button onClick={() => setGallery(null)} aria-label="close"
              style={{ border: 'none', background: 'none', color: '#9a9ca3', cursor: 'pointer', fontSize: 15 }}>✕</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
            {gallery.stack.map((s, si) => (
              <button
                key={`${s.fileName}-${si}`}
                onClick={() => s.url && setInnerPlay({ url: s.url, isVideo: s.mediaType.startsWith('video/') })}
                style={{ border: '1px solid #33353b', borderRadius: 9, overflow: 'hidden', background: '#1d1f24', cursor: 'pointer', padding: 0, textAlign: 'left' }}
              >
                <div style={{ height: 110, background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {s.url
                    ? (s.mediaType.startsWith('video/')
                      ? <video src={s.url} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      // eslint-disable-next-line @next/next/no-img-element
                      : <img src={s.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />)
                    : <span style={{ color: '#555', fontSize: 11, fontFamily: 'var(--mono)' }}>expired</span>}
                </div>
                <div style={{ padding: '5px 8px', fontSize: 10, fontFamily: 'var(--mono)', color: '#9a9ca3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.fileName}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ⇆ compare: two outputs side by side, both playing. */}
      {compare && (
        <div data-ui style={{ position: 'absolute', inset: 0, zIndex: 9, background: 'rgba(0,0,0,0.94)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 12px' }}>
            <button onClick={() => setCompare(null)} aria-label="close"
              style={{ border: 'none', background: 'rgba(255,255,255,0.08)', color: '#fff', cursor: 'pointer', fontSize: 15, borderRadius: 999, width: 30, height: 30 }}>✕</button>
          </div>
          <div style={{ flex: 1, display: 'flex', gap: 14, padding: '0 16px 14px', minHeight: 0 }}>
            {compare.map(n => (
              <div key={n.id} style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, gap: 8 }}>
                <div style={{ flex: 1, background: '#000', borderRadius: 10, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0 }}>
                  {n.thumb
                    ? (n.isVideo
                      ? <video src={n.thumb} controls autoPlay muted loop playsInline style={{ maxWidth: '100%', maxHeight: '100%' }} />
                      // eslint-disable-next-line @next/next/no-img-element
                      : <img src={n.thumb} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />)
                    : <span style={{ color: '#555', fontSize: 11, fontFamily: 'var(--mono)' }}>expired</span>}
                </div>
                <div style={{ fontSize: 10.5, fontFamily: 'var(--mono)', color: '#c9cbd1', display: 'flex', gap: 10, justifyContent: 'center' }}>
                  <span>{n.label ?? '—'}</span>
                  {typeof n.cost === 'number' && n.cost > 0 && <span style={{ color: 'var(--red)' }}>${n.cost.toFixed(3)}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* In-canvas playback — closing it never exits board fullscreen. */}
      {innerPlay && (
        <div data-ui style={{ position: 'absolute', inset: 0, zIndex: 9, background: 'rgba(0,0,0,0.93)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {innerPlay.isVideo
            ? <video src={innerPlay.url} controls autoPlay playsInline style={{ maxWidth: '94%', maxHeight: '90%' }} />
            // eslint-disable-next-line @next/next/no-img-element
            : <img src={innerPlay.url} alt="" style={{ maxWidth: '94%', maxHeight: '90%', objectFit: 'contain' }} />}
          <button onClick={() => setInnerPlay(null)} aria-label="close"
            style={{ position: 'absolute', top: 12, right: 16, border: 'none', background: 'rgba(0,0,0,0.5)', color: '#fff', cursor: 'pointer', fontSize: 16, borderRadius: 999, width: 32, height: 32 }}>✕</button>
        </div>
      )}

      {boardCost > 0 && (
        <div style={{ position: 'absolute', left: 12, bottom: 8, fontSize: 10, fontFamily: 'var(--mono)', color: '#7a7c83', pointerEvents: 'none' }}>
          {t('wf.boardcost')} ${boardCost.toFixed(3)}
        </div>
      )}
      <div style={{ position: 'absolute', right: 10, bottom: 8, fontSize: 10, fontFamily: 'var(--mono)', color: '#5a5c63', pointerEvents: 'none' }}>
        {t('wf.canvashint')}
      </div>
    </div>
  )
}
