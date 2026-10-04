'use client'
// app/components/xtell/PinButton.tsx — 釘選 in a temple's header (owner,
// Oct 3, in place of the 我的常用 card): pins the temple to the very left of
// the top bar (lib/xtell-pins.ts); pressed again, it goes back to its place.

import { useLang } from '../../../lib/i18n'
import { usePins } from './usePins'
import type { TempleKey } from './TempleArtwork'

export default function PinButton({ temple }: { temple: TempleKey }) {
  const { t } = useLang()
  const { pins, toggle } = usePins()
  const pinned = !!pins?.includes(temple)
  return (
    <button type="button" className="xtell-pin" aria-pressed={pinned} disabled={!pins}
      title={t(pinned ? 'xtell.pin.unhint' : 'xtell.pin.hint')} onClick={() => toggle(temple)}>
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
        <path d="M9.8 1.8l4.4 4.4-1.6.6-2.4 2.4.3 3.1-1.3 1.3-2.6-2.6-3.4 3.4-.8-.8 3.4-3.4-2.6-2.6 1.3-1.3 3.1.3 2.4-2.4z" />
      </svg>
      <span>{t(pinned ? 'xtell.pin.on' : 'xtell.pin.off')}</span>
    </button>
  )
}
