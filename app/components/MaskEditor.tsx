'use client'
// MaskEditor — paint the region an edit is allowed to touch.
//
// The user brushes over the part of the photo to change; everything
// unpainted is preserved. Export is the OpenAI images/edits contract:
// a PNG the size of the working canvas whose TRANSPARENT pixels mean
// "repaint here" and opaque pixels mean "keep". The server rescales it
// to the exact source bytes it sends (lib/providers/openai.ts), so the
// working resolution here only needs to be proportional, not identical.
//
// Strokes are stored at FULL alpha and shown translucent via CSS opacity
// on the overlay canvas — painting with translucent strokes directly
// would export partial alpha, which the API would treat as a half-hearted
// mask. Erasing is destination-out on the stroke layer.

import { useEffect, useRef, useState } from 'react'

// Bound the working canvas: masks don't need more resolution than the
// resized sources they stencil (≤1920px), and huge canvases make strokes
// laggy on integrated GPUs.
const MAX_DIM = 1536
const UNDO_CAP = 20

export default function MaskEditor({
  imageUrl,
  onSave,
  onClose,
}: {
  imageUrl: string
  /** file: the mask PNG (transparent = repaint). preview: small data-URL
   *  composite (photo + red region) for the composer chip. */
  onSave:  (file: File, preview: string) => void
  onClose: () => void
}) {
  const imgRef     = useRef<HTMLImageElement | null>(null)   // decoded photo
  const paintRef   = useRef<HTMLCanvasElement | null>(null)  // stroke layer (full alpha)
  const stageRef   = useRef<HTMLDivElement | null>(null)
  const drawingRef = useRef(false)
  const lastPtRef  = useRef<{ x: number; y: number } | null>(null)
  const undoRef    = useRef<ImageData[]>([])

  const [ready,   setReady]   = useState(false)
  const [failed,  setFailed]  = useState(false)
  const [erasing, setErasing] = useState(false)
  const [brush,   setBrush]   = useState(48)
  const [hasInk,  setHasInk]  = useState(false)
  const [canUndo, setCanUndo] = useState(false)

  // Decode the photo and size the stroke canvas to it (capped).
  useEffect(() => {
    let dead = false
    const img = new Image()
    // Remote sources (restored runs use signed Supabase URLs) need CORS
    // opt-in or the canvas taints and toBlob throws on export.
    if (!/^(blob:|data:)/.test(imageUrl)) img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (dead) return
      imgRef.current = img
      const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight))
      const c = paintRef.current
      if (c) {
        c.width  = Math.max(1, Math.round(img.naturalWidth  * scale))
        c.height = Math.max(1, Math.round(img.naturalHeight * scale))
      }
      setReady(true)
    }
    img.onerror = () => { if (!dead) setFailed(true) }
    img.src = imageUrl
    return () => { dead = true }
  }, [imageUrl])

  const ctx = () => paintRef.current?.getContext('2d', { willReadFrequently: true }) ?? null

  // Pointer position in stroke-canvas pixels.
  const canvasPoint = (e: React.PointerEvent): { x: number; y: number } | null => {
    const c = paintRef.current
    if (!c) return null
    const r = c.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return null
    return {
      x: (e.clientX - r.left) * (c.width  / r.width),
      y: (e.clientY - r.top)  * (c.height / r.height),
    }
  }

  const strokeTo = (p: { x: number; y: number }) => {
    const g = ctx()
    const c = paintRef.current
    if (!g || !c) return
    // Brush size is chosen against the DISPLAYED image; convert to canvas px.
    const r = c.getBoundingClientRect()
    const w = brush * (c.width / Math.max(1, r.width))
    g.globalCompositeOperation = erasing ? 'destination-out' : 'source-over'
    g.strokeStyle = '#e8503c'
    g.fillStyle   = '#e8503c'
    g.lineWidth   = w
    g.lineCap     = 'round'
    g.lineJoin    = 'round'
    const from = lastPtRef.current ?? p
    g.beginPath()
    g.moveTo(from.x, from.y)
    g.lineTo(p.x, p.y)
    g.stroke()
    // A click with no drag still lands a dot.
    g.beginPath()
    g.arc(p.x, p.y, w / 2, 0, Math.PI * 2)
    g.fill()
    lastPtRef.current = p
  }

  const onDown = (e: React.PointerEvent) => {
    const p = canvasPoint(e)
    const g = ctx()
    const c = paintRef.current
    if (!p || !g || !c) return
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    // Snapshot for undo (bounded).
    try {
      undoRef.current.push(g.getImageData(0, 0, c.width, c.height))
      if (undoRef.current.length > UNDO_CAP) undoRef.current.shift()
      setCanUndo(true)
    } catch { /* tainted canvas can't snapshot — undo just won't offer */ }
    drawingRef.current = true
    lastPtRef.current = null
    strokeTo(p)
    setHasInk(true)
  }

  const onMove = (e: React.PointerEvent) => {
    if (!drawingRef.current) return
    const p = canvasPoint(e)
    if (p) strokeTo(p)
  }

  const onUp = () => { drawingRef.current = false; lastPtRef.current = null }

  const undo = () => {
    const g = ctx()
    const snap = undoRef.current.pop()
    if (g && snap) g.putImageData(snap, 0, 0)
    setCanUndo(undoRef.current.length > 0)
    setHasInk(!!paintRef.current && layerHasInk())
  }

  const clearAll = () => {
    const g = ctx()
    const c = paintRef.current
    if (g && c) g.clearRect(0, 0, c.width, c.height)
    undoRef.current = []
    setCanUndo(false)
    setHasInk(false)
  }

  const layerHasInk = (): boolean => {
    const g = ctx()
    const c = paintRef.current
    if (!g || !c) return false
    try {
      const d = g.getImageData(0, 0, c.width, c.height).data
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true
    } catch { return true }
    return false
  }

  const save = async () => {
    const c   = paintRef.current
    const img = imgRef.current
    if (!c || !img || !hasInk) return
    // Mask: opaque black sheet with the painted strokes punched out.
    const mask = document.createElement('canvas')
    mask.width = c.width; mask.height = c.height
    const mg = mask.getContext('2d')!
    mg.fillStyle = '#000'
    mg.fillRect(0, 0, mask.width, mask.height)
    mg.globalCompositeOperation = 'destination-out'
    mg.drawImage(c, 0, 0)
    // Chip preview: the photo with the region tinted, small.
    const pv = document.createElement('canvas')
    const pvScale = 96 / Math.max(mask.width, mask.height)
    pv.width  = Math.max(1, Math.round(mask.width  * pvScale))
    pv.height = Math.max(1, Math.round(mask.height * pvScale))
    const pg = pv.getContext('2d')!
    pg.drawImage(img, 0, 0, pv.width, pv.height)
    pg.globalAlpha = 0.5
    pg.drawImage(c, 0, 0, pv.width, pv.height)
    const preview = pv.toDataURL('image/jpeg', 0.7)
    const blob: Blob | null = await new Promise(res => mask.toBlob(res, 'image/png'))
    if (!blob) return
    onSave(new File([blob], 'region-mask.png', { type: 'image/png' }), preview)
  }

  const btn = (active = false): React.CSSProperties => ({
    padding: '6px 12px', borderRadius: 8, fontSize: 12, fontFamily: 'var(--mono)',
    border: `1px solid ${active ? 'var(--red)' : 'var(--border2)'}`,
    background: active ? 'var(--red-dim, #fde8e5)' : 'transparent',
    color: active ? 'var(--red)' : 'var(--muted2)', cursor: 'pointer',
  })

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(10,10,10,0.62)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div style={{
        background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 14,
        maxWidth: 'min(920px, 94vw)', width: '100%', maxHeight: '92vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--white)' }}>
            ◐ Edit region
          </span>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            Paint what should change — everything else is kept
          </span>
          <button onClick={onClose} aria-label="Close"
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {/* Stage */}
        <div ref={stageRef} style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'var(--surface)' }}>
          {failed && (
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              Couldn&apos;t load this image for editing. Re-attach the file and try again.
            </div>
          )}
          {!failed && (
            <div style={{ position: 'relative', maxWidth: '100%', maxHeight: '100%', lineHeight: 0 }}>
              {/* The photo underneath… */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl} alt="" draggable={false}
                style={{ maxWidth: '100%', maxHeight: 'calc(92vh - 170px)', display: 'block', borderRadius: 8, userSelect: 'none' }} />
              {/* …and the stroke layer on top, translucent by CSS only. */}
              <canvas
                ref={paintRef}
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerLeave={onUp}
                style={{
                  position: 'absolute', inset: 0, width: '100%', height: '100%',
                  opacity: 0.45, cursor: ready ? 'crosshair' : 'wait',
                  touchAction: 'none', borderRadius: 8,
                }}
              />
            </div>
          )}
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
          <button onClick={() => setErasing(false)} style={btn(!erasing)}>🖌 Paint</button>
          <button onClick={() => setErasing(true)}  style={btn(erasing)}>◻ Erase</button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>
            size
            <input type="range" min={8} max={140} value={brush}
              onChange={e => setBrush(Number(e.target.value))} style={{ width: 110 }} />
          </label>
          <button onClick={undo} disabled={!canUndo} style={{ ...btn(), opacity: canUndo ? 1 : 0.4 }}>↩ Undo</button>
          <button onClick={clearAll} disabled={!hasInk} style={{ ...btn(), opacity: hasInk ? 1 : 0.4 }}>Clear</button>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={btn()}>Cancel</button>
            <button onClick={save} disabled={!hasInk || !ready}
              style={{
                padding: '6px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                border: 'none', background: 'var(--red)', color: '#fff',
                cursor: hasInk && ready ? 'pointer' : 'default', opacity: hasInk && ready ? 1 : 0.5,
              }}>
              Use region ✓
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
