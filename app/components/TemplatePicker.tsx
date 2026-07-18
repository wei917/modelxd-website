'use client'
// app/components/TemplatePicker.tsx
//
// XCreate template cards, two layouts driven by the `layout` prop:
//
//   • 'grid' — Gemini-style empty state. When the user hasn't configured
//     anything yet, templates ARE the page: a large responsive grid of
//     preview cards above the composer. Discovery mode.
//   • 'row'  — compact horizontal scroll strip (Kling/PixVerse style)
//     shown once anything is configured (template applied, prompt typed,
//     model picked), so the studio controls stay above the fold.
//   • 'wrap' — same compact cards as 'row', but flex-wrapped so EVERY
//     item is visible at once (no horizontal scroll, no arrows). Used
//     by the discovery section below the composer.
//
// Card anatomy (overlay / preview-first — the preview IS the card):
//   top-left   duration·ratio pill (video only; mode is implied by the
//              active tab so we don't repeat it — Gemini shows none)
//   top-right  ⬆N uploads pill, or ✓ badge when active
//   bottom     title + ×N MODELS badge on a scrim — the ModelXD twist:
//              one click pre-picks N models that all run the same prompt
//
// Clicking a card applies the template (composer pre-fill, Kling-Canvas
// style); clicking the active card again clears it via onClear.
//
// Previews: <img> with fade-in on load and onError→hide, so missing
// files fall back to the gradient underneath. First 6 load eagerly,
// rest lazy. .mp4/.webm previews play on hover only.

import { useEffect, useRef, useState } from 'react'
import type { Template } from '../xcreate/templates'

// Gradient palette for the no-preview fallback, cycled by index so
// adjacent cards aren't the same color.
const FALLBACK_GRADIENTS = [
  'linear-gradient(135deg, #fbe2dd 0%, #e8453c 100%)', // red
  'linear-gradient(135deg, #ddebff 0%, #4a9eff 100%)', // blue
  'linear-gradient(135deg, #e6dcff 0%, #a78bfa 100%)', // purple
  'linear-gradient(135deg, #d4f5e3 0%, #34d399 100%)', // green
  'linear-gradient(135deg, #fef0d4 0%, #f59e0b 100%)', // amber
  'linear-gradient(135deg, #ddeef5 0%, #14b8a6 100%)', // teal
]

const ROW_CARD_W = 210 // px
const ROW_CARD_H = 140 // px
const SCROLL_STEP = (ROW_CARD_W + 12) * 2 // two cards per arrow click

function isVideoUrl(url?: string): boolean {
  if (!url) return false
  return /\.(mp4|webm|mov)(\?|$)/i.test(url)
}

// Floating mono pill used for the duration/ratio + uploads badges.
const pillStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono), monospace',
  fontSize: 9,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  background: 'rgba(255,255,255,0.92)',
  color: 'var(--white)',
  padding: '3px 7px',
  borderRadius: 6,
  lineHeight: 1.2,
  pointerEvents: 'none',
}

export default function TemplatePicker({
  templates,
  selectedId,
  onSelect,
  onClear,
  disabled,
  layout = 'row',
}: {
  templates:   Template[]
  selectedId?: string | null
  onSelect:    (t: Template) => void
  onClear?:    () => void
  disabled?:   boolean
  layout?:     'row' | 'grid' | 'wrap'
}) {
  const isGrid   = layout === 'grid'
  const isWrap   = layout === 'wrap'
  const rowRef   = useRef<HTMLDivElement | null>(null)
  const cardRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({})

  // Which edges have more content to scroll to — drives the fades +
  // arrows (row layout only).
  const [canLeft,  setCanLeft]  = useState(false)
  const [canRight, setCanRight] = useState(false)

  const updateArrows = () => {
    const el = rowRef.current
    if (!el) return
    setCanLeft(el.scrollLeft > 4)
    setCanRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4)
  }

  useEffect(() => {
    if (isGrid || isWrap) return
    updateArrows()
    const onResize = () => updateArrows()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
    // Re-check when the template set or layout changes (mode switch).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates.length, isGrid])

  // Keep the selected card visible when it changes (e.g. re-opening a
  // saved run, or switching modes back to one with an active template).
  useEffect(() => {
    if (!selectedId) return
    const el = cardRefs.current[selectedId]
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
  }, [selectedId])

  const scrollBy = (dx: number) => {
    rowRef.current?.scrollBy({ left: dx, behavior: 'smooth' })
  }

  const arrowStyle = (side: 'left' | 'right'): React.CSSProperties => ({
    position: 'absolute',
    [side]: 4,
    top: ROW_CARD_H / 2,
    transform: 'translateY(-50%)',
    zIndex: 3,
    width: 30, height: 30,
    borderRadius: '50%',
    background: '#ffffff',
    border: '1px solid var(--border2)',
    boxShadow: '0 2px 8px rgba(0,0,0,0.10)',
    cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 14, lineHeight: 1,
    color: 'var(--white)',
    padding: 0,
  })

  const fadeStyle = (side: 'left' | 'right'): React.CSSProperties => ({
    position: 'absolute',
    [side]: 0,
    top: 0,
    height: ROW_CARD_H,
    width: 48,
    zIndex: 2,
    pointerEvents: 'none',
    background: side === 'left'
      ? 'linear-gradient(to right, var(--bg), transparent)'
      : 'linear-gradient(to left, var(--bg), transparent)',
  })

  // Compact utility card for tools ("Remove Background", "Fix Colors") —
  // vertical mini-card: thumbnail strip on top (emoji fallback), title +
  // one-liner below. Same height as template cards but narrower — mixed
  // rows read as one shelf while tools stay visually lighter.
  const renderToolCard = (t: Template) => {
    const active = t.id === selectedId
    return (
      <button
        key={t.id}
        ref={el => { cardRefs.current[t.id] = el }}
        type="button"
        title={active ? `${t.subtitle} — click to clear` : t.subtitle}
        aria-pressed={active}
        onClick={() => {
          if (disabled) return
          if (active) { onClear?.(); return }
          onSelect(t)
        }}
        disabled={disabled}
        onMouseEnter={e => {
          if (disabled || active) return
          const el = e.currentTarget as HTMLElement
          el.style.borderColor = 'var(--red)'
          el.style.transform = 'translateY(-2px)'
          el.style.boxShadow = '0 6px 18px rgba(232,69,60,0.10)'
        }}
        onMouseLeave={e => {
          if (disabled || active) return
          const el = e.currentTarget as HTMLElement
          el.style.borderColor = 'var(--border2)'
          el.style.transform = 'translateY(0)'
          el.style.boxShadow = 'none'
        }}
        style={{
          position: 'relative' as const,
          background: '#ffffff',
          border: `2px solid ${active ? 'var(--red)' : 'var(--border2)'}`,
          borderRadius: 12,
          textAlign: 'left' as const,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          transition: 'all 0.15s',
          padding: 0,
          display: 'flex', flexDirection: 'column' as const,
          overflow: 'hidden',
          ...(isGrid
            ? { width: '100%' }
            // Same height as template cards so mixed shelves (the Popular
            // strip has tools AND templates) read as one row. The thumbnail
            // flex-grows to fill, so there's no dead space below the title
            // (the old complaint that led to auto-height).
            : { flexShrink: 0, scrollSnapAlign: 'start' as const, width: 150, height: ROW_CARD_H }),
        }}
      >
        {active && (
          <span aria-hidden style={{
            position: 'absolute', top: 6, right: 6, zIndex: 1,
            width: 18, height: 18, borderRadius: '50%',
            background: 'var(--red)', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, lineHeight: 1,
          }}>✓</span>
        )}
        {/* Thumbnail strip on top (before/after crop from
            /public/templates/<id>.jpg). Emoji sits behind the image so a
            missing file degrades to a clean emoji block. */}
        <span aria-hidden style={{
          position: 'relative' as const, width: '100%',
          ...(isGrid ? { height: 96, flexShrink: 0 } : { flex: '1 1 auto', minHeight: 0 }),
          background: 'var(--surface2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26,
        }}>
          <span style={{ position: 'absolute' as const }}>{t.emoji}</span>
          {t.previewUrl && (
            <img
              src={t.previewUrl}
              alt=""
              loading="lazy"
              onError={e => { (e.currentTarget as HTMLElement).style.display = 'none' }}
              style={{ position: 'absolute' as const, inset: 0, width: '100%', height: '100%', objectFit: 'cover' as const }}
            />
          )}
        </span>
        {/* Title only — the subtitle lives in the hover tooltip (button
            title attr) so the tile stays clean. CC cut the sub text. */}
        <span style={{ display: 'flex', flexDirection: 'column' as const, minWidth: 0, flexShrink: 0, padding: '8px 10px 10px' }}>
          <span style={{
            fontSize: 12.5, fontWeight: 700, lineHeight: 1.25,
            color: active ? 'var(--red)' : 'var(--white)',
            whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{t.title}</span>
        </span>
      </button>
    )
  }

  const renderCard = (t: Template, i: number) => {
    // Tools and preview-less templates (text starter prompts) both use
    // the compact card — a big preview frame with nothing in it would
    // just be a gradient rectangle.
    if (t.kind === 'tool' || !t.previewUrl) return renderToolCard(t)
    const active   = t.id === selectedId
    const gradient = t.previewBgColor ?? FALLBACK_GRADIENTS[i % FALLBACK_GRADIENTS.length]
    const isVideo  = isVideoUrl(t.previewUrl)
    // Card pills trimmed July 2026 (CC): no aspect-ratio, no ⬆N uploads
    // count — only the duration pill (video) and the active ✓ remain.
    const specs = t.duration ? `${t.duration}s` : ''

    return (
      <button
        key={t.id}
        ref={el => { cardRefs.current[t.id] = el }}
        type="button"
        title={active ? `${t.subtitle} — click to clear` : t.subtitle}
        aria-pressed={active}
        onClick={() => {
          if (disabled) return
          if (active) { onClear?.(); return }
          onSelect(t)
        }}
        disabled={disabled}
        onMouseEnter={e => {
          const vid = videoRefs.current[t.id]
          vid?.play().catch(() => {})
          if (disabled || active) return
          const el = e.currentTarget as HTMLElement
          el.style.borderColor = 'var(--red)'
          el.style.transform = 'translateY(-2px)'
          el.style.boxShadow = '0 6px 18px rgba(232,69,60,0.12)'
        }}
        onMouseLeave={e => {
          const vid = videoRefs.current[t.id]
          if (vid) { vid.pause(); vid.currentTime = 0 }
          if (disabled || active) return
          const el = e.currentTarget as HTMLElement
          el.style.borderColor = 'var(--border2)'
          el.style.transform = 'translateY(0)'
          el.style.boxShadow = 'none'
        }}
        style={{
          position: 'relative' as const,
          padding: 0,
          background: gradient,
          border: `2px solid ${active ? 'var(--red)' : 'var(--border2)'}`,
          borderRadius: isGrid ? 20 : 14,
          textAlign: 'left' as const,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          transition: 'all 0.15s',
          overflow: 'hidden',
          ...(isGrid
            ? { width: '100%', aspectRatio: '16 / 10' }
            : {
                flexShrink: 0,
                scrollSnapAlign: 'start' as const,
                width: ROW_CARD_W,
                height: ROW_CARD_H,
              }),
        }}
      >
        {/* Preview media (fills the card; gradient shows through while
            loading or if the file is missing) */}
        {t.previewUrl && !isVideo && (
          // First ~6 cards are visible immediately, so load them eagerly;
          // the rest lazy-load. Fade in on load so slow first paints show
          // the gradient placeholder instead of a pop. Cached images can
          // finish before React attaches onLoad (hydration race) — the
          // ref callback catches that case.
          <img
            src={t.previewUrl}
            alt=""
            loading={i < 6 ? 'eager' : 'lazy'}
            ref={el => { if (el && el.complete && el.naturalWidth > 0) el.style.opacity = '1' }}
            onLoad={e => { (e.currentTarget as HTMLElement).style.opacity = '1' }}
            onError={e => { (e.currentTarget as HTMLElement).style.display = 'none' }}
            style={{
              position: 'absolute' as const, inset: 0,
              width: '100%', height: '100%',
              objectFit: 'cover' as const,
              opacity: 0,
              transition: 'opacity 0.25s ease',
            }}
          />
        )}
        {t.previewUrl && isVideo && (
          <video
            ref={el => { videoRefs.current[t.id] = el }}
            src={t.previewUrl}
            loop
            muted
            playsInline
            preload="metadata"
            onError={e => { (e.currentTarget as HTMLElement).style.display = 'none' }}
            style={{
              position: 'absolute' as const, inset: 0,
              width: '100%', height: '100%',
              objectFit: 'cover' as const,
            }}
          />
        )}

        {/* Top-left: duration pill (video only — aspect ratio removed) */}
        {specs && (
          <span style={{ ...pillStyle, position: 'absolute', top: 8, left: 8 }}>
            {specs}
          </span>
        )}

        {/* Top-right: check badge when active (⬆N uploads pill removed) */}
        {active && (
          <span aria-hidden style={{
            position: 'absolute', top: 8, right: 8,
            width: 22, height: 22, borderRadius: '50%',
            background: 'var(--red)', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, lineHeight: 1,
          }}>✓</span>
        )}

        {/* Bottom scrim: title */}
        <div style={{
          position: 'absolute' as const,
          bottom: 0, left: 0, right: 0,
          padding: isGrid ? '22px 12px 10px' : '18px 10px 8px',
          background: active
            ? 'linear-gradient(to top, rgba(214,59,50,0.92), rgba(214,59,50,0))'
            : 'linear-gradient(to top, rgba(15,15,15,0.78), rgba(15,15,15,0))',
        }}>
          <span style={{
            fontSize: isGrid ? 14 : 13, fontWeight: 700, lineHeight: 1.25,
            color: '#ffffff',
            whiteSpace: 'nowrap' as const,
            overflow: 'hidden', textOverflow: 'ellipsis',
            display: 'block',
          }}>{t.title}</span>
        </div>
      </button>
    )
  }

  return (
    <div style={{ marginBottom: 16 }}>
      {isGrid ? (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 14,
        }}>
          {templates.map(renderCard)}
        </div>
      ) : isWrap ? (
        // All cards visible at once — no scroll container, no arrows.
        // Cards keep the row layout's fixed sizes so tools stay lighter
        // than templates; they just flow onto as many lines as needed.
        <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 12, alignItems: 'flex-start' as const }}>
          {templates.map(renderCard)}
        </div>
      ) : (
        <div style={{ position: 'relative' as const }}>
          {canLeft && <div style={fadeStyle('left')} />}
          {canRight && <div style={fadeStyle('right')} />}
          {canLeft && (
            <button type="button" aria-label="Scroll templates left"
              style={arrowStyle('left')} onClick={() => scrollBy(-SCROLL_STEP)}>‹</button>
          )}
          {canRight && (
            <button type="button" aria-label="Scroll templates right"
              style={arrowStyle('right')} onClick={() => scrollBy(SCROLL_STEP)}>›</button>
          )}
          <div
            ref={rowRef}
            onScroll={updateArrows}
            style={{
              display: 'flex',
              gap: 12,
              alignItems: 'flex-start' as const,
              overflowX: 'auto' as const,
              paddingBottom: 6,
              scrollbarWidth: 'thin' as const,
              scrollSnapType: 'x proximity' as const,
            }}
          >
            {templates.map(renderCard)}
          </div>
        </div>
      )}
    </div>
  )
}
