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

/** Prices run from $0.0336 to $0.1345; show enough digits to tell them apart. */
function price(c: number | null): string {
  if (c === null || !Number.isFinite(c)) return ''
  return '$' + (c < 0.1 ? c.toFixed(4) : c.toFixed(3)).replace(/0+$/, '').replace(/\.$/, '')
}

/**
 * The gallery as the page's own backdrop, behind the studio UI. Purely
 * decorative: no name cards, no lightbox, no clicks (pointer-events is off in
 * CSS, so it can never steal a press meant for the composer), and aria-hidden
 * so a screen reader is not read a wall of alt text before reaching the form.
 *
 * The veil and blur live in globals.css. They are not decoration for its own
 * sake: this site is light theme with dark text, so pictures behind the
 * working UI have to become texture or the prompt box stops being readable.
 */
export function ShowcaseBackdrop({ pieces }: { pieces: ShowcasePiece[] }) {
  if (!pieces || pieces.length === 0) return null
  // Twelve: enough to fill six columns, few enough to be worth loading eagerly.
  // These are ABOVE THE FOLD — the first thing on the page — so `loading=lazy`
  // is wrong for them: it guarantees a flash of empty veil on every load, and
  // in any tab the browser has deprioritised they never arrive at all.
  const wall = pieces.slice(0, 12)
  return (
    <div className="xcreate-backdrop" aria-hidden="true">
      <div className="xcreate-backdrop-inner">
        {wall.map(p => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={p.id} src={p.url} alt="" loading="eager" decoding="async" />
        ))}
      </div>
    </div>
  )
}

export default function ShowcaseWall({ pieces }: { pieces: ShowcasePiece[] }) {
  const t = useT()
  const [open, setOpen] = useState<ShowcasePiece | null>(null)

  // Silent when empty: an unseeded wall should look like no wall, not a
  // broken one.
  if (!pieces || pieces.length === 0) return null

  return (
    <div style={{ marginTop: 56 }}>
      <div className="prompt-label" style={{ marginBottom: 10 }}>{t('showcase.eyebrow')}</div>
      <p style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.6, maxWidth: 640, margin: '0 0 24px' }}>
        {t('showcase.sub')}
      </p>

      {/* CSS columns, not grid: a masonry wall packs by column and lets every
          picture keep its own height. A grid would force one aspect ratio and
          crop the work, which is the one thing a gallery must not do. */}
      {/* Column count lives in globals.css so the media queries can win — an
          inline columnCount would override them and pin a phone to 4 columns. */}
      <div className="showcase-masonry">
        {pieces.map(p => (
          <figure
            key={p.id}
            onClick={() => setOpen(p)}
            style={{
              margin: '0 0 14px', breakInside: 'avoid', cursor: 'zoom-in',
              borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border2)',
              background: 'var(--surface)', position: 'relative',
            }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt={p.title} loading="lazy"
              style={{ width: '100%', height: 'auto', display: 'block' }} />
            {/* The name card, on the picture. Always legible over any image
                thanks to the scrim, and out of the way until you look at it. */}
            <figcaption style={{
              position: 'absolute', left: 0, right: 0, bottom: 0,
              display: 'flex', alignItems: 'center', gap: 6, padding: '18px 10px 8px',
              background: 'linear-gradient(to top, rgba(0,0,0,0.72), rgba(0,0,0,0))',
              color: '#fff',
            }}>
              <ProviderLogo provider={p.provider} size={12} />
              <span style={{
                fontSize: 11.5, fontWeight: 700, minWidth: 0,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{p.name}</span>
              <span style={{ flex: 1 }} />
              <span style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 10.5, opacity: 0.85 }}>
                {price(p.cost)}
              </span>
            </figcaption>
          </figure>
        ))}
      </div>

      {open && (
        <div
          onClick={() => setOpen(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.82)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, cursor: 'zoom-out',
          }}>
          <div onClick={e => e.stopPropagation()} style={{ maxWidth: 900, width: '100%', cursor: 'default' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={open.url} alt={open.title}
              style={{ width: '100%', maxHeight: '74vh', objectFit: 'contain', display: 'block', borderRadius: 8 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, color: '#fff' }}>
              <ProviderLogo provider={open.provider} size={14} />
              <span style={{ fontWeight: 800, fontSize: 14 }}>{open.name}</span>
              <span style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 12, opacity: 0.7 }}>{open.model}</span>
              <span style={{ flex: 1 }} />
              <span style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 13 }}>{price(open.cost)}</span>
            </div>
            {/* The brief is worth reading once you have stopped on a picture,
                not while you are scanning the wall. */}
            <p style={{ color: 'rgba(255,255,255,0.72)', fontSize: 12.5, lineHeight: 1.6, marginTop: 8 }}>
              {open.prompt}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
