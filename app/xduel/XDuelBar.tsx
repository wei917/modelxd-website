'use client'
// XDuel's top bar on www (owner, Oct 16: "apply the xtell layout and design
// to XDuel"): X先知's own bar (.xtell-embedded-bar and its temple row, as
// /profile's), with the four duel types as its rooms, icon over a label.
// The types left the composer's "Task type" row for it. The live page
// switches in place (onPick); the permalink page links to /xduel?mode=.
// Icons: the approved ModelXD media set (MediaIcon, Oct 17), in full colour.

import MediaIcon from '../components/MediaIcon'
import { useT } from '../../lib/i18n'

// 語音 replaced 遊戲 on Oct 19 (owner): the game duels live in XGame.
export type DuelKind = 'text' | 'image' | 'video' | 'audio'
const KINDS: DuelKind[] = ['text', 'image', 'video', 'audio']

export default function XDuelBar({ current, onPick, busy, base = '/xduel' }: {
  current: DuelKind | null
  onPick?: (k: DuelKind) => void
  /** Where the types link: XBoard wears the same bar (Oct 22). */
  base?: string
  // A duel is still running: the other types wait for it (switching would
  // leave its stream writing into the next duel).
  busy?: boolean
}) {
  const t = useT()
  return (
    <div className="xtell-embedded-bar xduel-bar">
      <div className="xtell-embedded-inner">
        <div className="xtell-temple-wrap">
          <nav className="xtell-temple-nav" aria-label={t('xduel.tasktype').replace(/[:：]\s*$/, '')}>
            {KINDS.map(k => {
              const waiting = busy && k !== current
              return (
                <a key={k} href={`${base}?mode=${k}`} aria-current={current === k ? 'page' : undefined}
                  aria-disabled={waiting || undefined}
                  onClick={onPick ? e => { e.preventDefault(); if (!waiting) onPick(k) } : undefined}>
                  <span className="xtell-nav-icon xduel-bar-icon"><MediaIcon kind={k} /></span>
                  <span>{t('mode.' + k)}</span>
                </a>
              )
            })}
          </nav>
        </div>
      </div>
    </div>
  )
}
