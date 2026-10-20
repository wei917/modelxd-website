'use client'
// XGame's top bar on www (owner, Oct 20: "modify the xgame page UI to be the
// same as xtell/xoracle, the top nav bar is a list of games (icon + text)").
// X先知's own bar (.xtell-embedded-bar and its temple row), as XDuel's: the
// games are its rooms, icon over a label. The lobby switches in place
// (onPick); a game's table links back to /xgame?game=.
//
// Icons: there is no approved per-game icon set yet (MediaIcon has one
// generic 'game'). Each game shows a square cut from its own lobby art
// (werewolf's painted icon, the other banners' centres) until generated
// icons replace them.

import { useLang, useT } from '../../lib/i18n'
import { gamesFor, GAME_NAME_KEY, type GameKey } from '../../lib/xgame-games'

const ICON: Record<GameKey, string> = {
  werewolf: '/xtalk/werewolf.png',
  gomoku: '/xgame/gomoku-banner.svg',
  draw: '/xgame/draw-banner.svg',
  chess: '/xgame/chess-banner.svg',
  poker: '/xgame/poker-banner.svg',
  xiangqi: '/xgame/xiangqi-icon.svg',
  bridge: '/xgame/bridge-icon.svg',
}

/** Where the square sits in a banner, when its centre is not the subject. */
const ICON_POS: Partial<Record<GameKey, string>> = { draw: '20% 55%' }


export default function XGameBar({ current, onPick }: {
  current: GameKey | null
  onPick?: (k: GameKey) => void
}) {
  const t = useT()
  const { lang } = useLang()
  return (
    <div className="xtell-embedded-bar xgame-bar">
      <div className="xtell-embedded-inner">
        <div className="xtell-temple-wrap">
          <nav className="xtell-temple-nav" aria-label="XGame">
            {gamesFor(lang).map(k => (
              <a key={k} href={`/xgame?game=${k}`} aria-current={current === k ? 'page' : undefined}
                onClick={onPick ? e => {
                  // A new tab or window keeps the browser's own behaviour.
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
                  e.preventDefault(); onPick(k)
                } : undefined}>
                <span className="xtell-nav-icon xgame-bar-icon" style={{ backgroundImage: `url(${ICON[k]})`, ...(ICON_POS[k] ? { backgroundPosition: ICON_POS[k] } : {}) }} aria-hidden />
                <span>{t(GAME_NAME_KEY[k])}</span>
              </a>
            ))}
          </nav>
        </div>
      </div>
    </div>
  )
}
