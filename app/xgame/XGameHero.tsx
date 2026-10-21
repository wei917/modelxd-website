'use client'
// XGame's scenic feature above a game's setup (Oct 21; Codex's XOracle-style
// tab page, approved by the owner): one slide per game, arrows, dots,
// pause / play, arrow keys. It turns every 8 s only while nobody is
// pointing at it, focusing it or reading another tab, and never by itself
// when the reader asked for reduced motion. Browsing a slide never changes
// the table or its configured seats; its button picks that game and moves
// to the setup.

import { useEffect, useMemo, useState } from 'react'
import { useLang } from '../../lib/i18n'
import { GAME_NAME_KEY, gamesFor, type GameKey } from '../../lib/xgame-games'

const ART: Record<GameKey, string> = {
  werewolf: '/xtalk/werewolf-banner.png',
  gomoku: '/xgame/gomoku-banner.svg',
  draw: '/xgame/draw-banner.svg',
  chess: '/xgame/chess-banner.svg',
  poker: '/xgame/poker-banner.svg',
  // No bridge banner yet: the card table's art stands in.
  bridge: '/xgame/poker-banner.svg',
  xiangqi: '/xgame/xiangqi-banner.svg',
}

export default function XGameHero({ initialGame, onEnter }: {
  initialGame: GameKey
  onEnter: (game: GameKey) => void
}) {
  const { lang, t } = useLang()
  const games = useMemo(() => gamesFor(lang), [lang])
  const [current, setCurrent] = useState(initialGame)
  const [paused, setPaused] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(true)
  const [played, setPlayed] = useState(false)
  const index = games.indexOf(current)
  const playMode = !paused && (!reducedMotion || played)
  const rotating = playMode && !hovered && !focused && !hidden

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const updateMotion = () => setReducedMotion(media.matches)
    const updateVisibility = () => setHidden(document.hidden)
    updateMotion(); updateVisibility()
    media.addEventListener('change', updateMotion)
    document.addEventListener('visibilitychange', updateVisibility)
    return () => {
      media.removeEventListener('change', updateMotion)
      document.removeEventListener('visibilitychange', updateVisibility)
    }
  }, [])

  useEffect(() => {
    if (!rotating) return
    const timer = window.setTimeout(() => setCurrent(games[(index + 1) % games.length]), 8000)
    return () => window.clearTimeout(timer)
  }, [rotating, index, games])

  const choose = (game: GameKey) => { setCurrent(game); setPaused(true) }
  const step = (direction: number) => choose(games[(index + direction + games.length) % games.length])
  const name = t(GAME_NAME_KEY[current])

  return (
    <section className="xgame-hero" data-game={current} aria-label={t('xg.hero.label')}
      aria-roledescription={t('xg.hero.carousel')}
      onPointerEnter={e => { if (e.pointerType === 'mouse') setHovered(true) }}
      onPointerLeave={e => { if (e.pointerType === 'mouse') setHovered(false) }}
      onFocus={() => setFocused(true)}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false) }}
      onKeyDown={e => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
        e.preventDefault(); step(e.key === 'ArrowLeft' ? -1 : 1)
      }}>
      <div className="xgame-hero-art" aria-hidden="true">
        {/* The art is decorative; the game's name is in the copy. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img key={current} src={ART[current]} alt="" fetchPriority="high" />
      </div>
      <div className="xgame-hero-shade" aria-hidden="true" />
      <div className="xgame-hero-copy" aria-live={rotating ? 'off' : 'polite'} aria-atomic="true">
        <p className="xgame-hero-kicker">{name}</p>
        <h2>{t(`xg.hero.${current}.title`)}</h2>
        <p className="xgame-hero-description">{t(`xg.hero.${current}.description`)}</p>
        <a className="xgame-hero-enter" href={`/xgame?game=${current}#xgame-table`}
          onClick={e => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
            e.preventDefault(); setPaused(true); onEnter(current)
          }}>
          {t('xg.hero.enter').replace('{game}', name)} <span aria-hidden="true">→</span>
        </a>
      </div>
      <button type="button" className="xgame-hero-arrow is-prev" aria-label={t('xg.hero.prev')} onClick={() => step(-1)}>‹</button>
      <button type="button" className="xgame-hero-arrow is-next" aria-label={t('xg.hero.next')} onClick={() => step(1)}>›</button>
      <div className="xgame-hero-controls">
        <div className="xgame-hero-dots" role="group" aria-label={t('xg.hero.label')}>
          {games.map(game => <button type="button" key={game} aria-label={t(GAME_NAME_KEY[game])}
            aria-current={game === current ? 'true' : undefined} onClick={() => choose(game)} />)}
        </div>
        <button type="button" className="xgame-hero-play" aria-label={t(playMode ? 'xg.hero.pause' : 'xg.hero.play')}
          onClick={() => { setPaused(playMode); if (!playMode) setPlayed(true) }}>
          {playMode ? <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1v10M9 1v10" stroke="currentColor" strokeWidth="3" /></svg>
            : <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="m3 1 8 5-8 5z" fill="currentColor" /></svg>}
        </button>
      </div>
      <span className="xgame-hero-count" aria-hidden="true">0{index + 1} <span>/ 0{games.length}</span></span>
    </section>
  )
}
