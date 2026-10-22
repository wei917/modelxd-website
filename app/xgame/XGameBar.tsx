'use client'
// XGame's top bar on www (owner, Oct 20: "modify the xgame page UI to be the
// same as xtell/xoracle, the top nav bar is a list of games (icon + text)").
// X先知's own bar (.xoracle-embedded-bar and its temple row), as XDuel's: the
// games are its rooms, icon over a label. The lobby switches in place
// (onPick); a game's table links back to /xgame?game=.
//
// Icons (Oct 21, approved by the owner via Codex): the refined "03 bold
// graphic" set for five games, the 將 / 帥 river board for 象棋 and the cream
// 3NT table with four cards for bridge. public/xgame/icons/ keeps the
// approved originals; the page loads 256 px crops of them (the same
// rectangles Codex's CSS showed: ~64 KB for all seven, not ~4 MB of PNG on
// a phone). The bar and a game's setup heading share gameIconStyle.

import type { CSSProperties } from 'react'
import { useLang, useT } from '../../lib/i18n'
import { gamesFor, GAME_NAME_KEY, type GameKey } from '../../lib/xgame-games'

export function gameIconStyle(game: GameKey): CSSProperties {
  return { backgroundImage: `url(/xgame/icons/${game}.webp)` }
}

export default function XGameBar({ current, onPick }: {
  current: GameKey | null
  onPick?: (k: GameKey) => void
}) {
  const t = useT()
  const { lang } = useLang()
  return (
    <div className="xoracle-embedded-bar xgame-bar">
      <div className="xoracle-embedded-inner">
        <div className="xoracle-temple-wrap">
          <nav className="xoracle-temple-nav" aria-label="XGame">
            {gamesFor(lang).map(k => (
              <a key={k} href={`/xgame?game=${k}`} aria-current={current === k ? 'page' : undefined}
                onClick={onPick ? e => {
                  // A new tab or window keeps the browser's own behaviour.
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
                  e.preventDefault(); onPick(k)
                } : undefined}>
                <span className="xoracle-nav-icon xgame-bar-icon" style={gameIconStyle(k)} aria-hidden />
                <span>{t(GAME_NAME_KEY[k])}</span>
              </a>
            ))}
          </nav>
        </div>
      </div>
    </div>
  )
}
