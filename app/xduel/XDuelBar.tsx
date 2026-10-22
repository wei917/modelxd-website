'use client'
// XDuel's top bar on www (owner, Oct 16: "apply the xtell layout and design
// to XDuel"): X先知's own bar (.xtell-embedded-bar and its temple row, as
// /profile's), with the duel types as its rooms, icon over a label.
// The types left the composer's "Task type" row for it. The live page
// switches in place (onPick); the permalink page links to /xduel?mode=.
// Icons: the approved ModelXD media set (MediaIcon, Oct 17), in full colour.

import MediaIcon from '../components/MediaIcon'
import { useT } from '../../lib/i18n'

// 語音 replaced 遊戲 on Oct 19 (owner): the game duels live in XGame.
// 音樂 left 音訊's Mode row for a tab of its own (owner, Oct 22: "in Audio tab,
// we can actually generate speech or music. should we split them into two
// tabs?", then "let's do it for both XDuel and XCreate"): with 'music' in
// the row, 'audio' is speech and wears the microphone.
export type DuelKind = 'text' | 'image' | 'video' | 'audio' | 'music'
const KINDS: DuelKind[] = ['text', 'image', 'video', 'audio']
export const SPLIT_KINDS: DuelKind[] = ['text', 'image', 'video', 'audio', 'music']

export default function XDuelBar({ current, onPick, busy, base = '/xduel', kinds = KINDS }: {
  current: DuelKind | null
  onPick?: (k: DuelKind) => void
  /** Where the types link: XBoard wears the same bar (Oct 22). */
  base?: string
  /** The row: XBoard keeps one 音訊 tab (speech and music boards together);
   *  XDuel passes SPLIT_KINDS. */
  kinds?: DuelKind[]
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
            {kinds.map(k => {
              const waiting = busy && k !== current
              const speech = k === 'audio' && kinds.includes('music')
              return (
                <a key={k} href={`${base}?mode=${k}`} aria-current={current === k ? 'page' : undefined}
                  aria-disabled={waiting || undefined}
                  onClick={onPick ? e => { e.preventDefault(); if (!waiting) onPick(k) } : undefined}>
                  <span className="xtell-nav-icon xduel-bar-icon"><MediaIcon kind={speech ? 'speech' : k} /></span>
                  <span>{t(speech ? 'mode.speech' : 'mode.' + k)}</span>
                </a>
              )
            })}
          </nav>
        </div>
      </div>
    </div>
  )
}
