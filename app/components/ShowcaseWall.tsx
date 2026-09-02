'use client'

// app/components/ShowcaseWall.tsx — the museum wall on XCreate.
//
// One brief per room, hung by every qualifying model, each picture with a name
// card: which model painted it and what that picture cost. Attribution IS the
// exhibit — an unlabelled gallery of AI images is wallpaper, and the reason to
// show these at all is that the same brief costs $0.034 from one model and
// $0.134 from another, and you can see what the difference buys.
//
// Nothing here is a test and nothing is voted on. XDuel is where judgement
// happens with the price hidden; this is the opposite room, where the label is
// the point and you are told everything up front.

import { useState } from 'react'
import ProviderLogo from './ProviderLogo'
import { useT } from '@/lib/i18n'
import type { ShowcaseRoom, ShowcasePiece } from '@/lib/showcase'

type Piece = ShowcasePiece
type Room = ShowcaseRoom

/** Prices run from $0.0336 to $0.1345; show enough digits to tell them apart. */
function price(c: number | null): string {
  if (c === null || !Number.isFinite(c)) return ''
  return '$' + (c < 0.1 ? c.toFixed(4) : c.toFixed(3)).replace(/0+$/, '').replace(/\.$/, '')
}

// Rooms arrive as a PROP, read on the server by the page. This component owns
// no fetching on purpose: a client fetch renders nothing wherever React defers
// passive effects (any hidden or background tab) and costs a waterfall
// everywhere else. State here is only the lightbox.
export default function ShowcaseWall({ rooms }: { rooms: Room[] }) {
  const t = useT()
  const [open, setOpen] = useState<{ piece: Piece; room: Room } | null>(null)

  // Silent when empty: an unseeded wall should look like no wall, not a
  // broken one.
  if (!rooms || rooms.length === 0) return null

  return (
    <div style={{ marginTop: 56 }}>
      <div className="prompt-label" style={{ marginBottom: 10 }}>{t('showcase.eyebrow')}</div>
      <p style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.6, maxWidth: 640, margin: '0 0 28px' }}>
        {t('showcase.sub')}
      </p>

      {rooms.map(room => (
        <section key={room.room} style={{ marginBottom: 44 }}>
          <h3 style={{ fontSize: 15, fontWeight: 800, margin: '0 0 4px' }}>{room.title}</h3>
          {/* The brief, shown as wall text: the pictures only mean something
              beside the words every model was given. */}
          <p style={{
            fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6, margin: '0 0 14px',
            maxWidth: 760, fontStyle: 'italic',
          }}>{room.prompt}</p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 18 }}>
            {room.pieces.map(p => (
              <figure key={p.id} style={{ margin: 0 }}>
                <button
                  onClick={() => setOpen({ piece: p, room })}
                  style={{
                    display: 'block', width: '100%', padding: 0, border: '1px solid var(--border2)',
                    borderRadius: 8, overflow: 'hidden', background: 'var(--surface)', cursor: 'zoom-in',
                    lineHeight: 0,
                  }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={`${room.title} — ${p.name}`} loading="lazy"
                    style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', display: 'block' }} />
                </button>
                {/* The name card. */}
                <figcaption style={{ paddingTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <ProviderLogo provider={p.provider} size={12} />
                  <span style={{ fontSize: 12, fontWeight: 700, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.name}
                  </span>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 11, color: 'var(--muted2)' }}>
                    {price(p.cost)}
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      ))}

      {open && (
        <div
          onClick={() => setOpen(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.82)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, cursor: 'zoom-out',
          }}>
          <div onClick={e => e.stopPropagation()} style={{ maxWidth: 900, width: '100%', cursor: 'default' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={open.piece.url} alt={open.piece.name}
              style={{ width: '100%', maxHeight: '76vh', objectFit: 'contain', display: 'block', borderRadius: 8 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, color: '#fff' }}>
              <ProviderLogo provider={open.piece.provider} size={14} />
              <span style={{ fontWeight: 800, fontSize: 14 }}>{open.piece.name}</span>
              <span style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 12, opacity: 0.75 }}>
                {open.piece.model}
              </span>
              <span style={{ flex: 1 }} />
              <span style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 13 }}>{price(open.piece.cost)}</span>
            </div>
            <p style={{ color: 'rgba(255,255,255,0.72)', fontSize: 12.5, lineHeight: 1.6, marginTop: 8 }}>
              {open.room.prompt}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
