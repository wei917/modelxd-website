'use client'

// app/components/ShowcaseWall.tsx — the showcase wall on XCreate.
//
// A Pinterest board: many pictures, packed, each labelled with the model that
// made it. NOT a comparison — one picture per brief, and no brief appears
// twice. Showing one prompt rendered by every model side by side is XDuel's
// job, and doing it here turns a gallery into a test (which is exactly what
// the first version of this got wrong).
//
// The label is still the point: an unlabelled grid of AI images is wallpaper.
// You should be able to see something you like and immediately know which
// model to pick, and what it costs.

import { useState } from 'react'
import ProviderLogo from './ProviderLogo'
import { useT } from '@/lib/i18n'
import type { ShowcasePiece } from '@/lib/showcase'

/** How long this picture took. Sub-10s gets a decimal; the spread runs 3.8s to
 *  69s, so the difference is worth a digit. */
function secs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms <= 0) return ''
  const s = ms / 1000
  return (s < 10 ? s.toFixed(1) : String(Math.round(s))) + 's'
}

/** Prices run from $0.0336 to $0.1345; show enough digits to tell them apart. */
function price(c: number | null): string {
  if (c === null || !Number.isFinite(c)) return ''
  return '$' + (c < 0.1 ? c.toFixed(4) : c.toFixed(3)).replace(/0+$/, '').replace(/\.$/, '')
}

/**
 * The information block. ONE component, used by the always-on chip, the hover
 * caption and the lightbox, because the first version wrote them separately
 * and they immediately drifted: the chip was two lines, the caption was one,
 * arranged differently. Whatever joins this (resolution, duration for the
 * video wall) lands in all three at once.
 *
 * Line 1 is who made it. Line 2 is what it cost you.
 */
function PieceMeta({ p, size = 10 }: { p: ShowcasePiece; size?: number }) {
  return (
    <>
      <span className="line1">
        <ProviderLogo provider={p.provider} size={size} />
        <span className="name">{p.name}</span>
      </span>
      <span className="line2">
        <span className="price">{price(p.cost)}</span>
        {secs(p.ms) && <><span className="dot">·</span><span className="speed">{secs(p.ms)}</span></>}
      </span>
    </>
  )
}

export default function ShowcaseWall({ pieces }: { pieces: ShowcasePiece[] }) {
  const t = useT()
  const [open, setOpen] = useState<ShowcasePiece | null>(null)

  // Silent when empty: an unseeded wall should look like no wall, not a
  // broken one.
  if (!pieces || pieces.length === 0) return null

  return (
    <div style={{ marginTop: 26 }}>
      {/* Header in the house voice: red // eyebrow, one line of explanation,
          and the count set in mono on the right so the wall announces its own
          size the way XBoard does. */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 6 }}>
        <div className="prompt-label eyebrow" style={{ marginBottom: 0 }}>{t('showcase.eyebrow')}</div>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 10.5, color: 'var(--muted2)', letterSpacing: '0.1em' }}>
          {pieces.length} WORKS · {new Set(pieces.map(p => p.model)).size} MODELS
        </span>
      </div>
      <p style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.6, maxWidth: 620, margin: '0 0 16px' }}>
        {t('showcase.sub')}
      </p>

      <div className="showcase-wall">
        {pieces.map(p => (
          <figure key={p.id} className="showcase-tile" tabIndex={0} onClick={() => setOpen(p)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt={p.title} loading="lazy" />

            {/* Attribution is never hidden: the chip is on every picture from
                the start, and only steps aside when the full caption arrives.
                A wall of unlabelled AI images is wallpaper. */}
            {/* Two lines, always on: who made it, then what it cost and how
                long it took. Those three are the site's whole argument, and
                speed is the axis the leaderboard does not carry — flash-lite
                is 3.8s AND the cheapest, grok is 60s+ at twice the price.
                Only the prompt waits for a hover. */}
            <figcaption className="showcase-chip piece-meta">
              <PieceMeta p={p} />
            </figcaption>

            <figcaption className="showcase-cap">
              <p className="showcase-prompt">{p.prompt}</p>
              <div className="piece-meta cap-meta">
                <PieceMeta p={p} size={11} />
              </div>
            </figcaption>
          </figure>
        ))}
      </div>

      {open && (
        <div
          onClick={() => setOpen(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.9)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, cursor: 'zoom-out',
          }}>
          <div onClick={e => e.stopPropagation()} style={{ maxWidth: 940, width: '100%', cursor: 'default' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={open.url} alt={open.title}
              style={{ width: '100%', maxHeight: '72vh', objectFit: 'contain', display: 'block' }} />
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, marginTop: 14, color: '#fff' }}>
              <div className="piece-meta" style={{ fontSize: 11.5 }}>
                <PieceMeta p={open} size={14} />
              </div>
              <span style={{ flex: 1 }} />
              <span style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>
                {open.model}
              </span>
            </div>
            <p style={{ color: 'rgba(255,255,255,0.78)', fontSize: 13, lineHeight: 1.65, marginTop: 10, maxWidth: 780 }}>
              {open.prompt}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
