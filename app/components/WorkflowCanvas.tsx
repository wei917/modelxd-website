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
import { PORT_COLORS } from '../../lib/ports'
import ModelPickerDialog from './ModelPickerDialog'

/** A video URL that will actually PAINT a frame when it lands.
 *
 *  A bare <video src> sits at readyState 0 and renders solid black until
 *  enough of the file decodes — on a 720p clip that reads as a missing or
 *  broken generation. The media fragment makes the browser seek to 0.1s and
 *  decode that frame, so the node shows its own opening image instead of a
 *  hole. Canvas nodes have no separate still to use as a poster; the video
 *  is the thumbnail. */
function firstFrame(url: string | null | undefined): string | undefined {
  if (!url) return undefined
  return url.includes('#') ? url : `${url}#t=0.1`
}

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
   *  reference and source files"). Viewable from the ⓘ panel; the full
   *  descriptor rides along so a regen can re-use a chosen subset as its
   *  attachments without another upload. */
  sources?: Array<{ url: string | null; fileName: string; mediaType: string; bucket?: string; storagePath?: string; fileSize?: number }>
  /** A TAKE STACK: every take of one storyboard cut collapsed into one
   *  node (owner, Aug 9) — the take in use renders up front, the rest fan
   *  behind like the reference pile. Click expands all takes to play side
   *  by side and pick one. The node's own fields are the ACTIVE take's. */
  takes?: CanvasNode[]
  /** Typed inbound wires (migration 81, owner Aug 15: ComfyUI-style
   *  ports): which PORT of this node's model each source fed —
   *  first_frame, reference_image, reference_audio, … `from` is a node id
   *  already resolved by board-nodes. Wired edges take the port type's
   *  color and land on a port dot; plain parentIds edges remain for
   *  anything unwired. */
  wires?: Array<{ from: string; port: string; type: 'image' | 'audio' | 'video' }>
  /** The PROMPT INPUT node (owner, Aug 9: "the original input is not just
   *  references — we also provide prompts"): the film's brief, rendered
   *  as text instead of a thumbnail. */
  brief?: string
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
// Shared window-button styles — the ⓘ panel, the scene window and the
// regen control all speak the same visual language.
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

/** ↻ Re-generate: model pick + length/resolution/aspect config with a live
 *  price, then send. Extracted from the ⓘ panel (owner, Aug 9: "the
 *  Re-generate button should be in the SceneCut's detail view, not the
 *  asset's") — the CUT's window owns it for storyboard shots; assets
 *  without a scene keep it in their own panel. */
function RegenControl({ n, busy, fallbackDur, onRegen, onSent }: {
  /** The base node whose prompt/inputs the re-run repeats. */
  n: CanvasNode
  busy?: boolean
  /** Duration shown when the user keeps "same" — the clip's known length. */
  fallbackDur?: number | null
  onRegen: (n: CanvasNode, model: { id: string; display_name: string }, opts: { duration?: number; resolution?: string; aspect_ratio?: string; refs?: Array<{ bucket: string; storagePath: string; mediaType: string; fileName: string; fileSize: number }> }) => void
  onSent?: () => void
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [dur, setDur] = useState<number | null>(null)   // null = same as original
  // Config step (owner, Aug 9: "I need to config it"): picking a model no
  // longer fires the generation — it opens resolution/aspect/length config
  // with a live price, and the ↻ button is the send.
  const [selModel, setSelModel] = useState<any | null>(null)
  const [res, setRes] = useState<string | null>(null)
  const [aspect, setAspect] = useState<string | null>(null)
  // Reference picker (owner, Aug 9): which of the original's sources ride
  // on the re-run. All of them by default — deselect to drop one, or all
  // of them for a clean text-only take.
  const [refOff, setRefOff] = useState<Record<number, boolean>>({})

  const pickable = (n.sources ?? []).filter(s => s.storagePath && s.bucket)
  const chosenRefs = pickable
    .filter((_, i) => !refOff[i])
    .map(s => ({ bucket: s.bucket!, storagePath: s.storagePath!, mediaType: s.mediaType, fileName: s.fileName, fileSize: s.fileSize ?? 0 }))
  const isVid = n.isVideo || n.kind === 'video'

  // Live price for the configured run: chosen resolution's rate × chosen
  // length (falling back to the original clip's length).
  const pvs = selModel?.model_pricing?.per_video_second
  const resKeys: string[] = pvs && typeof pvs === 'object' ? Object.keys(pvs) : []
  const perSec = pvs ? Number((pvs as any)[res ?? resKeys[0]]) : NaN
  const effDur = dur ?? (fallbackDur ? Math.round(fallbackDur) : null)
  const est = isVid && Number.isFinite(perSec) && effDur ? perSec * effDur : null

  return (
    <>
      <button disabled={busy} onClick={() => setOpen(o => !o)} style={{ ...act(), width: '100%', marginTop: 9, opacity: busy ? 0.5 : 1 }}>
        ↻ {t('wf.regen')}
      </button>
      {open && (
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
              {pickable.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 9.5, fontFamily: 'var(--mono)', color: '#6a6c73', marginBottom: 4 }}>
                    references · {chosenRefs.length}/{pickable.length}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {pickable.map((s, i) => {
                      const on = !refOff[i]
                      return (
                        <button
                          key={`${s.fileName}-${i}`} title={s.fileName}
                          onClick={() => setRefOff(m => ({ ...m, [i]: on }))}
                          style={{
                            padding: 0, width: 44, height: 44, borderRadius: 7, overflow: 'hidden', flexShrink: 0,
                            border: on ? '1.5px solid var(--red)' : '1px solid #3a3c42',
                            opacity: on ? 1 : 0.35, background: '#000', cursor: 'pointer',
                          }}
                        >
                          {s.url
                            ? ((s.mediaType || '').startsWith('video/')
                              ? <video src={firstFrame(s.url)} preload="metadata" muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              // eslint-disable-next-line @next/next/no-img-element
                              : <img src={s.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />)
                            : <span aria-hidden style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 14 }}>🖼</span>}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
              <button
                onClick={() => {
                  onRegen(n, { id: selModel.id, display_name: selModel.display_name }, {
                    duration: dur ?? undefined,
                    resolution: (res ?? (resKeys.length > 1 ? resKeys[0] : undefined)) || undefined,
                    aspect_ratio: aspect ?? undefined,
                    ...(pickable.length > 0 ? { refs: chosenRefs } : {}),
                  })
                  onSent?.()
                }}
                style={{ ...act(true), width: '100%', marginTop: 10 }}
              >
                ↻ {t('wf.regen')}{est != null ? ` — $${est.toFixed(2)}` : ''}
              </button>
            </>
          )}
        </div>
      )}
      {pickerOpen && (
        // data-ui + stopped pointer events: a REAL click begins with
        // pointerdown, which was bubbling to the canvas host, arming a pan,
        // and the pointerup then read as "empty-space click" — clearing the
        // selection and unmounting the whole window (and the picker with
        // it) before the row's click could land (owner, Aug 9).
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
              // Picking is not sending (owner, Aug 9): the model lands in
              // the config step and the ↻ button below is the trigger.
              setSelModel(m); setRes(null)
              setPickerOpen(false)
            }}
          />
        </div>
      )}
    </>
  )
}

function NodeActionPanel({ n, origin, onPlay, onClose, onDelete, onRegen, pick, onViewSource, busy }: {
  n: CanvasNode; origin: string | null
  onPlay?: (n: CanvasNode) => void
  onClose: () => void
  /** single-node delete, straight from the panel */
  onDelete?: (n: CanvasNode) => void
  /** re-generate: same prompt + refs, user-picked model + config. Only
   *  rendered for assets WITHOUT a scene — a cut's regen lives in its
   *  scene window (owner, Aug 9). */
  onRegen?: (n: CanvasNode, model: { id: string; display_name: string }, opts: { duration?: number; resolution?: string; aspect_ratio?: string }) => void
  /** sub-canvas pick mode: ★ next to ▶ (owner, Aug 9 — "Use this as main
   *  asset next to Play"), or an In-use chip on the current main asset. */
  pick?: { inUse: boolean; run: () => void }
  /** open one source file full size (in-canvas lightbox, fullscreen-safe) */
  onViewSource?: (src: { url: string; isVideo: boolean }) => void
  busy?: boolean
}) {
  const t = useT()
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

  // A cut's regen lives in its SCENE window, not here (owner, Aug 9) —
  // only assets without a storyboard origin re-generate from this panel.
  const canRegen = !!onRegen && !!n.rowId && !!n.prompt && !origin && !pick

  return (
    <div
      data-ui
      // The canvas must never pan, select-clear or node-drag from inside
      // this window — and its text must be COPYABLE (owner, Aug 9).
      onPointerDown={e => e.stopPropagation()}
      onPointerMove={e => e.stopPropagation()}
      onPointerUp={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
      style={{
        // Drag moves the ANCHORS, never a transform: a transform would make
        // this window the containing block for the model picker's
        // position:fixed and squash it to window width (owner, Aug 9:
        // "the model picker is too narrow") — same trap as backdropFilter.
        position: 'absolute', right: 10 - off.x, top: 44 + off.y, zIndex: 5,
        width: 'min(430px, calc(100% - 20px))',
        maxHeight: 'calc(100% - 56px)', overflow: 'auto',
        // Native resize (owner, Aug 9: "too much information there") — the
        // grip is the bottom-right corner; the browser writes the chosen
        // size as inline style, which React's diff never claws back.
        resize: 'both', minWidth: 260, minHeight: 150,
        background: 'rgba(20,21,24,0.97)', border: '1px solid var(--border2)',
        // no backdropFilter here: it would become the containing block for the
        // model picker's position:fixed and squash it to window width.
        borderRadius: 12, padding: '14px 16px',
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
          slot 0 is the start frame for recipes that take one. Tiles, not
          filenames (owner, Aug 9): click one to view it full size; the
          name survives as the tooltip. */}
      {n.sources && n.sources.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11.5, fontFamily: 'var(--mono)', color: '#6a6c73', marginBottom: 4 }}>sources</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {n.sources.map((s, i) => (
              <button
                key={`${s.fileName}-${i}`} title={s.fileName}
                onClick={() => s.url && onViewSource?.({ url: s.url, isVideo: (s.mediaType || '').startsWith('video/') })}
                style={{ padding: 0, width: 54, height: 54, borderRadius: 8, overflow: 'hidden', border: '1px solid #3a3c42', background: '#000', cursor: s.url ? 'pointer' : 'default', flexShrink: 0 }}
              >
                {s.url
                  ? ((s.mediaType || '').startsWith('video/')
                    ? <video src={firstFrame(s.url)} preload="metadata" muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    // eslint-disable-next-line @next/next/no-img-element
                    : <img src={s.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />)
                  : <span aria-hidden style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 16 }}>{(s.mediaType || '').startsWith('video/') ? '🎞' : '🖼'}</span>}
              </button>
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
        {pick && (pick.inUse ? (
          <span style={{ alignSelf: 'center', fontSize: 10, fontFamily: 'var(--mono)', letterSpacing: '0.07em', color: 'var(--red)', border: '1px solid var(--red)', borderRadius: 999, padding: '4px 10px', whiteSpace: 'nowrap' }}>★ {t('wf.inuse')}</span>
        ) : (
          <button disabled={busy} onClick={pick.run} style={{ ...act(), opacity: busy ? 0.5 : 1 }}>
            ★ {t('wf.usetake')}
          </button>
        ))}
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

      {canRegen && (
        <RegenControl n={n} busy={busy} fallbackDur={meta.dur} onRegen={onRegen!} onSent={onClose} />
      )}
    </div>
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
  nodes: rawNodes, selectedIds, onSelect, onClearSelection,
  onDelete, busy = false, height = 460, onPlay, nodeOrigin, sceneOf, onUseTake, sceneSlot, pickMode, title, onRerun,
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
  /** Promote a comparison take onto its scene card: the card's clip, model
   *  and cost switch to this node. Offered in the ⓘ panel when a node is a
   *  take of a scene it doesn't currently represent (owner, Aug 9: the card
   *  changes takes only when the user picks one). */
  onUseTake?: (n: CanvasNode, scene: any) => void
  /** The node's place in the STORY GRID (owner, Aug 9): scene number →
   *  column, cut number → row in it. Null = not a storyboard node. */
  sceneSlot?: (n: CanvasNode) => { scene: number; cut: number } | null
  /** Board title, drawn on the canvas in the cut-label style. */
  title?: string | null
  /** SUB-CANVAS mode (owner, Aug 9): this instance shows one cut's takes.
   *  Every node's ⓘ panel gets ★ "use this take" beside ▶ (or an In-use
   *  chip on the current main asset); regen and nesting are disabled. */
  pickMode?: { activeRowId?: string | null; onPick: (n: CanvasNode) => void }
  /** ↻ same prompt, different model + config — the new output lands as a
   *  sibling of the original. opts.refs, when present, is the user's
   *  chosen subset of the original's source files for this re-run. */
  onRerun?: (n: CanvasNode, model: { id: string; display_name: string }, opts: { duration?: number; resolution?: string; aspect_ratio?: string; refs?: Array<{ bucket: string; storagePath: string; mediaType: string; fileName: string; fileSize: number }> }) => void
}) {
  const t = useT()
  // ── Take stacks (owner, Aug 9): a cut with several takes renders as ONE
  // node — the take in use up front, the others fanned behind, exactly
  // like the reference pile; clicking expands all takes to play side by
  // side and pick. Same verbatim prompt = same cut (a ↻ re-runs its
  // prompt unchanged); the ACTIVE take is the one the scene card points
  // at. Children of any collapsed take re-wire to the stack.
  const nodes = useMemo<CanvasNode[]>(() => {
    if (!sceneOf) return rawNodes
    // Membership is SCENE IDENTITY, never prompt equality: the director
    // rewrites shot text between runs, and a prompt-matched stack dropped
    // the re-run out of its cut entirely (owner bug, Aug 11 — "there is a
    // video not belonging to any scene"). sceneOf() resolves a row through
    // the cut's full take list, so a rewritten prompt changes nothing.
    const stacks = new Map<string, { active: CanvasNode; members: CanvasNode[] }>()
    const memberOf = new Map<string, string>()
    const bySceneId = new Map<string, CanvasNode[]>()
    for (const n of rawNodes) {
      if (!n.rowId || !n.thumb) continue
      // KEYFRAME mode's key still feeds the cut; it is not one of its takes.
      if (!(n.isVideo || n.kind === 'video')) continue
      const scene = sceneOf(n)
      if (!scene?.id) continue
      if (!bySceneId.has(scene.id)) bySceneId.set(scene.id, [])
      bySceneId.get(scene.id)!.push(n)
    }
    for (const [sceneId, members] of bySceneId) {
      if (members.length < 2) continue
      // The card's own row is the take in use; otherwise the newest.
      const scene: any = members.map(m => sceneOf(m)).find(Boolean)
      const active = members.find(m => m.rowId === scene?.row_id)
        ?? [...members].sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))[0]
      const id = `takes::${sceneId}`
      stacks.set(id, { active, members })
      for (const m of members) memberOf.set(m.id, id)
    }
    if (stacks.size === 0) return rawNodes
    const out: CanvasNode[] = []
    for (const n of rawNodes) {
      const sid = memberOf.get(n.id)
      // Typed wires follow their edges through the stack rebase.
      const remapWires = (ws?: CanvasNode['wires']) =>
        ws?.map(w => ({ ...w, from: memberOf.get(w.from) ?? w.from }))
      if (!sid) {
        const pids = [...new Set((n.parentIds ?? []).map(p => memberOf.get(p) ?? p))]
        out.push({ ...n, parentIds: pids, parentId: pids[0] ?? null, wires: remapWires(n.wires) })
        continue
      }
      const st = stacks.get(sid)!
      if (st.active.id !== n.id) continue   // only the active take emits the stack
      const union = [...new Set(st.members.flatMap(m => m.parentIds ?? []).map(p => memberOf.get(p) ?? p))]
        .filter(p => p !== sid)
      const wireUnion = (remapWires(st.members.flatMap(m => m.wires ?? [])) ?? [])
        .filter(w => w.from !== sid)
        .filter((w, i, arr) => arr.findIndex(x => x.from === w.from && x.port === w.port) === i)
      out.push({
        ...st.active, id: sid, parentIds: union, parentId: union[0] ?? null,
        wires: wireUnion.length > 0 ? wireUnion : undefined,
        takes: [...st.members].sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''))),
      })
    }
    return out
  }, [rawNodes, sceneOf])
  const sel = useMemo(() => new Set(selectedIds), [selectedIds])
  const [info, setInfo] = useState<CanvasNode | null>(null)
  // The expanded take stack — a SUB-CANVAS scoped to the cut's takes
  // (owner, Aug 9): every canvas feature, but starting from the assets,
  // no sources. It keeps its own selection; picking closes it.
  const [takesView, setTakesView] = useState<CanvasNode | null>(null)
  const [subSel, setSubSel] = useState<string[]>([])
  const subNodes = useMemo<CanvasNode[]>(() => (takesView?.takes ?? []).map(tk => ({
    ...tk, parentIds: [], parentId: null, takes: undefined, wires: undefined,
  })), [takesView])
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
  // ↻ confirm feedback (owner, Aug 9: "show a bigger message or dialog
  // saying the job is submitted") — a real modal, not just the toast, that
  // also says WHERE to watch progress. Auto-dismisses; OK closes sooner.
  const [submitted, setSubmitted] = useState<string | null>(null)
  const submittedTimer = useRef<any>(null)
  const showSubmitted = (model: string) => {
    setSubmitted(model)
    clearTimeout(submittedTimer.current)
    submittedTimer.current = setTimeout(() => setSubmitted(null), 10_000)
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

    // ── THE GRID (owner, Aug 9): a SCENE is a column, a CUT is a row in
    // it. Story structure decides placement; derivation is what the wires
    // show. Column 0 holds the reference inputs, scene columns follow in
    // story order, and assets outside the storyboard trail after them.
    // A board with no storyboard at all falls back to derivation depth.
    const slots = new Map<string, { scene: number; cut: number }>()
    if (sceneSlot) {
      for (const n of nodes) { const s = sceneSlot(n); if (s) slots.set(n.id, s) }
      // Same-prompt siblings inherit the cut — a failed attempt belongs to
      // its cut even though no scene card points at its row.
      for (const n of nodes) {
        if (slots.has(n.id) || !n.rowId || !n.prompt) continue
        const sib = nodes.find(m => m.id !== n.id && m.prompt === n.prompt && slots.has(m.id))
        if (sib) slots.set(n.id, slots.get(sib.id)!)
      }
    }

    const GROUP_GAP = 46   // clearance between cut boxes (26 top + 12 bottom + air)
    const pos = new Map<string, { x: number; y: number }>()
    const plans: Array<{ d: number; entries: Array<{ n: CanvasNode; dy: number }>; h: number }> = []

    const seatColumn = (col: CanvasNode[], keyOf: (n: CanvasNode) => string) => {
      let y = 0
      let prevKey: string | null = null
      const entries: Array<{ n: CanvasNode; dy: number }> = []
      for (const n of col) {
        const k = keyOf(n)
        if (prevKey !== null && k !== prevKey) y += GROUP_GAP
        entries.push({ n, dy: y }); y += NODE_H + ROW_GAP
        prevKey = k
      }
      return { entries, h: Math.max(NODE_H, y - ROW_GAP) }
    }

    if (slots.size > 0) {
      const sceneNums = [...new Set([...slots.values()].map(s => s.scene))].sort((a, b) => a - b)
      const colIdxOf = (n: CanvasNode): number => {
        const s = slots.get(n.id)
        if (s) return 1 + sceneNums.indexOf(s.scene)
        if (!n.rowId) return 0                      // references / inputs
        return 1 + sceneNums.length                 // free assets trail the story
      }
      const cols = new Map<number, CanvasNode[]>()
      for (const n of nodes) {
        const ci = colIdxOf(n)
        if (!cols.has(ci)) cols.set(ci, [])
        cols.get(ci)!.push(n)
      }
      const colOrder = [...cols.keys()].sort((a, b) => a - b)
      for (const ci of colOrder) {
        const raw = cols.get(ci)!
        const isScene = ci >= 1 && ci <= sceneNums.length
        const col = isScene
          ? [...raw].sort((a, b) => {
              const ca = slots.get(a.id)!.cut, cb = slots.get(b.id)!.cut
              if (ca !== cb) return ca - cb
              // within a cut: the stack (or the live take) first, errors last
              const ra = a.takes ? 0 : a.status === 'error' ? 2 : 1
              const rb = b.takes ? 0 : b.status === 'error' ? 2 : 1
              if (ra !== rb) return ra - rb
              return String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''))
            })
          : raw
        const keyOf = isScene
          ? (n: CanvasNode) => 'c' + slots.get(n.id)!.cut
          : (n: CanvasNode) => (n.prompt ? 'p:' + n.prompt : 'id:' + n.id)
        const { entries, h } = seatColumn(col, keyOf)
        plans.push({ d: colOrder.indexOf(ci), entries, h })
      }
    } else {
      // No storyboard: derivation depth places the columns, as before.
      const depth = new Map<string, number>()
      for (const n of nodes) depth.set(n.id, depthOf(n.id, new Set()))
      // Takes of one shot still share a column even when wiring differs.
      const byPrompt = new Map<string, string[]>()
      for (const n of nodes) {
        if (!n.rowId || !n.prompt) continue
        if (!byPrompt.has(n.prompt)) byPrompt.set(n.prompt, [])
        byPrompt.get(n.prompt)!.push(n.id)
      }
      for (const ids of byPrompt.values()) {
        if (ids.length < 2) continue
        const dmax = Math.max(...ids.map(id => depth.get(id) ?? 0))
        for (const id of ids) depth.set(id, dmax)
      }
      const cols = new Map<number, CanvasNode[]>()
      for (const n of nodes) {
        const d = depth.get(n.id) ?? 0
        if (!cols.has(d)) cols.set(d, [])
        cols.get(d)!.push(n)
      }
      for (const [d, raw] of cols) {
        // cluster same-prompt takes adjacently, first-seen order
        const order: string[] = []
        const clusters = new Map<string, CanvasNode[]>()
        for (const n of raw) {
          const key = n.prompt ? 'p:' + n.prompt : 'id:' + n.id
          if (!clusters.has(key)) { clusters.set(key, []); order.push(key) }
          clusters.get(key)!.push(n)
        }
        const col = order.flatMap(k => clusters.get(k)!)
        const { entries, h } = seatColumn(col, n => (n.prompt ? 'p:' + n.prompt : 'id:' + n.id))
        plans.push({ d, entries, h })
      }
    }

    const fullH = Math.max(NODE_H + ROW_GAP, ...plans.map(p => p.h))
    for (const p of plans) {
      for (const { n, dy } of p.entries) {
        pos.set(n.id, {
          x: 40 + p.d * (NODE_W + COL_GAP),
          y: 40 + (fullH - p.h) / 2 + dy,
        })
      }
    }
    const width = 80 + (Math.max(0, ...plans.map(p => p.d)) + 1) * (NODE_W + COL_GAP)
    return { pos, byId, parentsOf, height: fullH + 80, width }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, sceneSlot])

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
      // Only the board layer itself — or the bare host — zooms. And only
      // OUR OWN board layer: a sub-canvas (take stacks) nests a second
      // host inside this one, and its wheel must not zoom both.
      const el = e.target as HTMLElement | null
      if (el && el !== host) {
        const bl = el.closest('[data-board]')
        if (!bl || bl.closest('[data-canvas-host]') !== host) return
      }
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
    // Typed ports stagger their landings down the node's left edge, so
    // first_frame / reference_image / reference_audio wires arrive at
    // distinct, labeled dots instead of one anonymous midpoint.
    const typed = (n.wires ?? []).filter(w => posOf(w.from))
    const portNames = [...new Set(typed.map(w => w.port))]
    const portY = new Map(portNames.map((name, i) =>
      [name, NODE_H / 2 + (i - (portNames.length - 1) / 2) * 16] as const))
    return layout.parentsOf(n).flatMap(pid => {
      const p = posOf(pid)
      if (!p) return []
      const lane = laneOf(pid)
      const tw = typed.find(w => w.from === pid)
      const x1 = p.x + NODE_W, y1 = p.y + NODE_H / 2
      const x2 = c.x,          y2 = c.y + (tw ? portY.get(tw.port)! : NODE_H / 2)
      const yB = corridorY + lane * 8
      const xd = x1 + 16 + lane * 7          // drop column, inside the gap
      const xu = x2 - 16 - lane * 7          // rise column, inside the gap
      const r  = 10
      const lit = sel.has(n.id) || sel.has(pid)
      const color = tw ? PORT_COLORS[tw.type] : wireColor(pid)
      // Same column (the story grid stacks a chained cut under its source):
      // a short loop out the right side instead of the corridor detour.
      if (Math.abs(p.x - c.x) < 1) {
        const x2r = c.x + NODE_W
        return [{
          key: `${pid}->${n.id}`,
          d: `M ${x1} ${y1} C ${x1 + 44 + lane * 6} ${y1}, ${x2r + 44 + lane * 6} ${y2}, ${x2r} ${y2}`,
          lit, color,
          px: x2r, py: y2, port: tw?.port, right: true,
        }]
      }
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
        lit, color,
        px: x2, py: y2, port: tw?.port, right: false,
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
      // Scene identity first (survives a rewritten prompt); prompt only as
      // the fallback for nodes the storyboard doesn't claim.
      const sid = sceneOf?.(n)?.id
      const key = sid ? 'sc:' + sid : (n.prompt ? 'p:' + n.prompt : 'id:' + n.id)
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
  // Cost sums the RAW rows — a collapsed stack must still bill every take.
  const boardCost   = rawNodes.reduce((sum, n) => sum + (n.cost ?? 0), 0)

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
      data-canvas-host
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
        {/* Board title (owner, Aug 9) — same grammar as the cut labels,
            one size up. Lives in board space, so it pans and zooms with
            the work it names. */}
        {title && (
          <span style={{
            position: 'absolute', left: 40, top: 8, fontSize: 12, fontWeight: 700,
            fontFamily: 'var(--mono)', letterSpacing: '0.1em', textTransform: 'uppercase',
            color: '#c9cbd1', whiteSpace: 'nowrap', pointerEvents: 'none',
          }}>🎬 {title}</span>
        )}
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
          {/* Typed wires land on PORT DOTS with their role named — the
              ComfyUI grammar (owner, Aug 15): the wire says WHAT it feeds
              (first_frame, reference_image, reference_audio), not just
              that a connection exists. */}
          {wires.filter(w => w.port).map(w => (
            <g key={`${w.key}::port`} opacity={w.lit ? 0.95 : 0.7}>
              <circle cx={w.px} cy={w.py} r={3.5} fill={w.color} stroke="rgba(0,0,0,0.55)" strokeWidth={1.25} />
              <text
                x={w.right ? w.px + 7 : w.px - 7} y={w.py + 3}
                textAnchor={w.right ? 'start' : 'end'}
                style={{ fontSize: 8.5, fontFamily: 'var(--mono)', letterSpacing: '0.04em' }}
                fill={w.color}
              >{w.port}</text>
            </g>
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
                if (n.takes) { setSubSel([]); setTakesView(n); return }
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
                  ? <span className="nav-history-spin" style={{ width: 18, height: 18, borderWidth: 2 }} aria-label="Generating" />
                  : errored
                    ? <span style={{ color: '#c4564e', fontSize: 18 }} title={n.error ?? undefined}>⚠</span>
                    : n.brief ? (
                      // The film's brief — text is the thumbnail. Full
                      // text lives in the ⓘ panel, copyable.
                      <div style={{
                        padding: '8px 10px', width: '100%', height: '100%', overflow: 'hidden',
                        fontSize: 9.5, fontFamily: 'var(--mono)', color: '#c9cbd1', lineHeight: 1.55,
                        background: 'rgba(255,255,255,0.03)',
                      }}>
                        {n.brief.length > 150 ? n.brief.slice(0, 150) + '…' : n.brief}
                      </div>
                    )
                    : n.takes ? (
                      // The take pile (owner, Aug 9): the take IN USE up
                      // front, alternates fanned behind like the reference
                      // pile — click expands all takes to play and pick.
                      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                        {n.takes.filter(tk => tk.rowId !== n.rowId).slice(0, 2).map((tk, si) => tk.thumb ? (
                          tk.isVideo
                            ? <video key={tk.id} src={firstFrame(tk.thumb)} preload="metadata" muted playsInline style={{
                                position: 'absolute', left: 34 + si * 12, top: 10 + si * 5,
                                width: '58%', height: '72%', objectFit: 'cover', borderRadius: 6,
                                border: '1px solid #3a3c42', transform: `rotate(${6 + si * 4}deg)`,
                                opacity: 0.75, boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
                              }} />
                            // eslint-disable-next-line @next/next/no-img-element
                            : <img key={tk.id} src={tk.thumb} alt="" draggable={false} style={{
                                position: 'absolute', left: 34 + si * 12, top: 10 + si * 5,
                                width: '58%', height: '72%', objectFit: 'cover', borderRadius: 6,
                                border: '1px solid #3a3c42', transform: `rotate(${6 + si * 4}deg)`,
                                opacity: 0.75, boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
                              }} />
                        ) : null)}
                        {n.thumb && (n.isVideo
                          ? <video src={firstFrame(n.thumb)} preload="metadata" muted playsInline style={{
                              position: 'absolute', left: 8, top: 6, width: '64%', height: '82%',
                              objectFit: 'cover', borderRadius: 6, border: '1px solid #4a4c52',
                              transform: 'rotate(-3deg)', boxShadow: '0 3px 10px rgba(0,0,0,0.6)',
                            }} />
                          // eslint-disable-next-line @next/next/no-img-element
                          : <img src={n.thumb} alt="" draggable={false} style={{
                              position: 'absolute', left: 8, top: 6, width: '64%', height: '82%',
                              objectFit: 'cover', borderRadius: 6, border: '1px solid #4a4c52',
                              transform: 'rotate(-3deg)', boxShadow: '0 3px 10px rgba(0,0,0,0.6)',
                            }} />)}
                        <span style={{
                          position: 'absolute', right: 6, bottom: 4, fontSize: 10,
                          fontFamily: 'var(--mono)', color: '#e6e7ea',
                          background: 'rgba(0,0,0,0.55)', borderRadius: 4, padding: '1px 6px',
                        }}>{n.takes.length}</span>
                      </div>
                    )
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
                {/* Price lives in the ⓘ panel only (owner, Aug 9) — the
                    card stays a picture, not a receipt. */}
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
            // Anchor-offset drag, NOT transform — a transform would squash
            // the model picker's position:fixed to this window's width.
            position: 'absolute', left: 10 + sceneOff.x, top: 44 + sceneOff.y, zIndex: 5,
            width: 'min(400px, calc(100% - 20px))',
            maxHeight: 'calc(100% - 56px)', overflow: 'auto',
            resize: 'both', minWidth: 260, minHeight: 150,
            background: 'rgba(20,21,24,0.97)', border: '1px solid var(--border2)',
            // no backdropFilter here: it would become the containing block for the
        // model picker's position:fixed and squash it to window width.
        borderRadius: 12, padding: '14px 16px',
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
          {/* ↻ belongs to the CUT (owner, Aug 9): another take of this
              shot, base = the take currently in use. The result joins the
              cut's stack when it lands. */}
          {onRerun && (() => {
            const cutNode = nodes.find(nn => nn.rowId && nn.rowId === sceneInfo.scene?.row_id) ?? null
            if (!cutNode?.prompt) return null
            return (
              <RegenControl
                n={cutNode} busy={busy}
                fallbackDur={typeof sceneInfo.scene?.duration_s === 'number' ? sceneInfo.scene.duration_s : null}
                onRegen={(nn, m, o) => { console.info('[xdirect:canvas] ↻ send (cut)', { rowId: nn.rowId, model: m.display_name, opts: o }); showSubmitted(m.display_name); onRerun(nn, m, o) }}
                onSent={() => setSceneInfo(null)}
              />
            )
          })()}
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
        {/* No nested fullscreen from a sub-canvas — its parent owns it. */}
        {!pickMode && (
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
        )}
      </div>

      {info && (
        <NodeActionPanel
          n={info} origin={nodeOrigin?.(info) ?? null}
          onPlay={play} onClose={() => setInfo(null)} busy={busy}
          onDelete={onDelete ? (nn) => { onDelete([nn]) } : undefined}
          onRegen={onRerun ? (nn, m, o) => { console.info('[xdirect:canvas] ↻ send', { nodeId: nn.id, rowId: nn.rowId, model: m.display_name, opts: o }); showSubmitted(m.display_name); onRerun(nn, m, o) } : undefined}
          pick={pickMode && info.rowId && info.thumb ? {
            inUse: info.rowId === pickMode.activeRowId,
            run: () => { console.info('[xdirect:canvas] ★ pick take', { nodeId: info.id, rowId: info.rowId }); pickMode.onPick(info) },
          } : undefined}
          onViewSource={(src) => setInnerPlay(src)}
        />
      )}

      {/* Submitted dialog (owner, Aug 9) — the unmissable confirm that a
          ↻ job went out, and WHERE its progress lives. Inside the host,
          so fullscreen-safe. */}
      {submitted && (
        <div
          data-ui
          onPointerDown={e => e.stopPropagation()}
          onPointerUp={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          style={{ position: 'fixed', inset: 0, zIndex: 99340, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div style={{
            width: 'min(420px, calc(100% - 40px))', background: 'rgba(20,21,24,0.98)',
            border: '1px solid var(--border2)', borderRadius: 14, padding: '22px 24px',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span aria-hidden style={{ fontSize: 20, color: 'var(--green, #43c46b)' }}>✓</span>
              <span style={{ fontSize: 15, fontWeight: 800, color: '#e2e3e7' }}>{t('wf.sub.title')}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, fontFamily: 'var(--mono)', color: '#9a9ca3' }}>{submitted}</span>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.7, color: '#c9cbd1' }}>{t('wf.sub.body')}</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button
                onClick={() => { clearTimeout(submittedTimer.current); setSubmitted(null) }}
                style={{ padding: '9px 22px', borderRadius: 9, border: 'none', background: 'var(--red)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
              >{t('wf.sub.ok')}</button>
            </div>
          </div>
        </div>
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
        <div data-ui style={{ position: 'fixed', inset: 0, zIndex: 99310, background: 'rgba(12,13,15,0.97)', padding: '16px 18px', overflowY: 'auto' }}>
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
                      ? <video src={firstFrame(s.url)} preload="metadata" muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
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

      {/* Take stack expanded (owner, Aug 9): a SUB-CANVAS — the same board,
          scoped to this cut's takes, no sources. Every canvas feature works
          in here; ★ beside ▶ in each asset's panel is the pick. Inside the
          host, so fullscreen-safe. */}
      {takesView && takesView.takes && (() => {
        const subLabel = nodeOrigin?.(takesView) ?? null
        return (
        <div
          data-ui
          onPointerDown={e => e.stopPropagation()}
          onPointerMove={e => e.stopPropagation()}
          onPointerUp={e => e.stopPropagation()}
          style={{ position: 'fixed', inset: 0, zIndex: 99310, background: 'rgba(10,11,13,0.97)', display: 'flex', flexDirection: 'column', padding: 14 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontFamily: 'var(--mono)', letterSpacing: '0.08em', color: '#e2e3e7', fontWeight: 700, flex: 1 }}>
              {(subLabel ?? t('wf.detail'))} · {takesView.takes.length}
            </span>
            <button onClick={() => setTakesView(null)} aria-label="close"
              style={{ border: 'none', background: 'rgba(255,255,255,0.08)', color: '#fff', cursor: 'pointer', fontSize: 15, borderRadius: 999, width: 30, height: 30 }}>✕</button>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <WorkflowCanvas
              nodes={subNodes}
              selectedIds={subSel}
              onSelect={(nn, additive) => setSubSel(prev => additive
                ? (prev.includes(nn.id) ? prev.filter(x => x !== nn.id) : [...prev, nn.id])
                : [nn.id])}
              onClearSelection={() => setSubSel([])}
              onDelete={onDelete ? (nns) => { setTakesView(null); onDelete(nns) } : undefined}
              busy={busy}
              height="100%"
              nodeOrigin={subLabel ? () => subLabel : undefined}
              pickMode={{
                activeRowId: takesView.rowId ?? null,
                onPick: (tk) => {
                  const sc = sceneOf?.(takesView)
                  if (!sc) return
                  console.info('[xdirect:canvas] ★ use take', { rowId: tk.rowId, scene: sc.id })
                  showToast(`★ ${tk.label ?? ''}`)
                  onUseTake?.(tk, sc)
                  setTakesView(null)
                },
              }}
            />
          </div>
        </div>
        )
      })()}

      {/* ⇆ compare: two outputs side by side, both playing. */}
      {compare && (
        <div data-ui style={{ position: 'fixed', inset: 0, zIndex: 99320, background: 'rgba(0,0,0,0.94)', display: 'flex', flexDirection: 'column' }}>
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
        <div data-ui style={{ position: 'fixed', inset: 0, zIndex: 99330, background: 'rgba(0,0,0,0.93)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
