'use client'
// app/xgame/XGameLanding.tsx — /xgame with no game chosen (Oct 22; owner:
// "you missed the landing page for XGame. Can you check XOracle page?").
// XOracle's homepage on XGame's paper: the page (client.tsx) draws the top
// bar with nothing marked and the slideshow; this is the rest, as on
// /xoracle: the guide box right under the slideshow (XGameGuide) and four
// steps in XOracle's how-to style (.xoracle-how, globals.css). The footer is
// XOracle's with XGame's own line. No recent games and no card per game
// (owner, Oct 22: XOracle has no recent visits there, "we already have top
// nav bar so no need to list all games"), and no today's card.

import { useId } from 'react'
import { useLang } from '../../lib/i18n'
import type { GameKey } from '../../lib/xgame-games'
import XGameGuide from './XGameGuide'

const STEP_ICONS = [
  // A game: the grid of tiles.
  <svg key="1" width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2.5" y="2.5" width="7" height="7" rx="2" /><rect x="12.5" y="2.5" width="7" height="7" rx="2" /><rect x="2.5" y="12.5" width="7" height="7" rx="2" /><rect x="12.5" y="12.5" width="7" height="7" rx="2" /></svg>,
  // The seats: two people.
  <svg key="2" width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="8" cy="7.5" r="3" /><path d="M2.5 18.5c.6-3 2.7-4.8 5.5-4.8s4.9 1.8 5.5 4.8" /><circle cx="15.5" cy="8.5" r="2.4" /><path d="M14.6 13.3c2.6-.2 4.4 1.4 4.9 4.2" /></svg>,
  // Start: play.
  <svg key="3" width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><circle cx="11" cy="11" r="8.5" /><path d="M9 7.5v7l5.5-3.5z" /></svg>,
  // Every move's reasoning: a speech bubble with lines.
  <svg key="4" width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"><path d="M3 5.5A2.5 2.5 0 0 1 5.5 3h11A2.5 2.5 0 0 1 19 5.5v7a2.5 2.5 0 0 1-2.5 2.5H9l-4 3.5V15H5.5A2.5 2.5 0 0 1 3 12.5z" /><path d="M7 7.5h8M7 10.5h5" /></svg>,
]

export default function XGameLanding({ onOpen }: { onOpen: (game: GameKey) => void }) {
  const { t } = useLang()
  const howId = useId()
  return (
    <>
      <XGameGuide onOpen={onOpen} />
      <section className="xoracle-how xgame-how" aria-labelledby={howId}>
        <h2 id={howId} className="xoracle-how-title">{t('xg.how.title')}</h2>
        <ol className="xoracle-how-steps">
          {STEP_ICONS.map((icon, i) => (
            <li key={i}>
              <span className="xoracle-how-icon">{icon}</span>
              <span className="xoracle-how-text">
                <strong><span className="xoracle-how-n">{i + 1}</span>{t(`xg.how.${i + 1}.title`)}</strong>
                <span>{t(`xg.how.${i + 1}.desc`)}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>
    </>
  )
}
