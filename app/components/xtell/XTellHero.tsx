'use client'
// app/components/xtell/XTellHero.tsx — the homepage's scenic entrance (Oct 3,
// the owner's approved Concept 24). One temple at a time: its world behind,
// its name, its lead and its line, and a real link into it. It turns by
// itself every few seconds and the top bar highlights the temple on show
// (lib/xtell-preview.ts).
//
// Turning is display only: it never changes the address, the hash or the
// room, never opens a form, sends a reading or spends anything. Entering is
// the link (href="/#<temple>", or "/xtell#<temple>" under the path), the
// same native link the top bar uses.
//
// It holds still while the pointer or keyboard focus is on it, while the tab
// is hidden, and from the start when the visitor asks for less motion; any
// choice of a slide (arrows, dots) pauses it until play is pressed. Every
// slide has the same height, so turning never moves the page.

import { useEffect, useState, type CSSProperties } from 'react'
import { useLang } from '../../../lib/i18n'
import { TempleArtwork, artKind, type TempleKey } from './TempleArtwork'
import { HERO_ART, HERO_SECONDS, heroTemples, stepSlide, mayRotate } from '../../../lib/xtell-hero'
import { announcePreview } from '../../../lib/xtell-preview'
import { useSiteBase } from '../../../lib/useSite'
import { templeHref } from '../../../lib/site'

export default function XTellHero() {
  const { lang, t } = useLang()
  const base = useSiteBase()
  const temples = heroTemples(lang)
  const count = temples.length
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [played, setPlayed] = useState(false)      // play pressed: overrides reduced motion
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  // Slides shown so far (and the next): only their pictures are fetched.
  const [seen, setSeen] = useState<Set<number>>(() => new Set([0, 1]))

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return
    const set = () => setReducedMotion(mq.matches)
    set()
    mq.addEventListener?.('change', set)
    return () => mq.removeEventListener?.('change', set)
  }, [])
  useEffect(() => {
    const set = () => setHidden(document.hidden)
    set()
    document.addEventListener('visibilitychange', set)
    return () => document.removeEventListener('visibilitychange', set)
  }, [])
  useEffect(() => { if (index >= count) setIndex(0) }, [count, index])

  const rotating = mayRotate({ paused, hovered, focused, hidden, reducedMotion: reducedMotion && !played, count })
  useEffect(() => {
    if (!rotating) return
    const id = window.setTimeout(() => setIndex(i => stepSlide(i, 1, count)), HERO_SECONDS * 1000)
    return () => window.clearTimeout(id)
  }, [rotating, index, count])
  useEffect(() => { setSeen(s => s.has(index) && s.has(stepSlide(index, 1, count)) ? s : new Set([...s, index, stepSlide(index, 1, count)])) }, [index, count])

  const current: TempleKey | undefined = temples[index] ?? temples[0]
  // The top bar follows the slide; it forgets when the hero goes.
  useEffect(() => { announcePreview(current ?? null) }, [current])
  useEffect(() => () => announcePreview(null), [])

  if (!current) return null
  const nameOf = (k: TempleKey) => t('xtell.site.focus.' + k + '.name')
  const choose = (i: number) => { setIndex(stepSlide(i, 0, count)); setPaused(true) }
  // The button shows the visitor's choice, not the moment: hovering or
  // focusing (the button itself, too) holds the slide but does not flip it.
  const playMode = !paused && !(reducedMotion && !played)
  const toggle = () => { if (playMode) setPaused(true); else { setPaused(false); setPlayed(true) } }
  const name = nameOf(current)
  // The button names the temple without its gloss: 「夢占い（周公解夢）」 is
  // the kicker, 「夢占いへ」 the button, so it stays one line on a phone.
  const short = name.replace(/\s*[（(][^（）()]*[）)]\s*$/, '') || name

  return (
    <section className="xtell-hero" aria-roledescription={t('xtell.home.hero.role')} aria-label={t('xtell.home.hero.label')}
      onPointerEnter={e => { if (e.pointerType === 'mouse') setHovered(true) }}
      onPointerLeave={e => { if (e.pointerType === 'mouse') setHovered(false) }}
      onFocus={() => setFocused(true)}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false) }}
      onKeyDown={e => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          const target = e.target as HTMLElement
          if (target.tagName === 'A') return
          e.preventDefault(); choose(stepSlide(index, e.key === 'ArrowRight' ? 1 : -1, count))
        }
      }}>
      <h1 className="xtell-sr-only">{t('xtell.site.brand')}</h1>
      <div className="xtell-hero-stage">
        {temples.map((k, i) => {
          const art = HERO_ART[k]!
          return (
            <div key={k} className={'xtell-hero-backdrop' + (i === index ? ' is-on' : '')} aria-hidden="true"
              style={{ backgroundImage: `linear-gradient(135deg, ${art.wash[0]}, ${art.wash[1]})` }}>
              {/* A slide not shown yet has only its wash: no picture fetched,
                  and no fallback art either (it used to overflow the stage). */}
              {art.src
                ? seen.has(i) && <picture>
                    {art.srcPortrait && <source media="(max-width: 480px)" srcSet={art.srcPortrait} />}
                    {art.srcMobile && <source media="(max-width: 760px)" srcSet={art.srcMobile} />}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={art.src} alt="" decoding="async" fetchPriority={i === 0 ? 'high' : 'low'}
                      style={{ ...(art.focus ? { objectPosition: art.focus } : {}), ...(art.focusPortrait ? { '--hero-portrait-focus': art.focusPortrait } : {}) } as CSSProperties} />
                  </picture>
                : <TempleArtwork temple={k} className={'xtell-hero-portrait is-' + artKind(k)} />}
            </div>
          )
        })}
        <div className="xtell-hero-scrim" aria-hidden="true" />
        <div className="xtell-hero-copy" aria-live={rotating ? 'off' : 'polite'} aria-atomic="true">
          <p className="xtell-hero-kicker"><span>{name}</span></p>
          <h2 className="xtell-hero-title">{t('xtell.site.focus.' + current + '.lead')}</h2>
          <p className="xtell-hero-sub">{t('xtell.site.focus.' + current + '.eyebrow')}</p>
          <a className="xtell-hero-enter" href={templeHref(base, current)}>
            <span>{t('xtell.site.focus.enter').replace('{temple}', short)}</span><span aria-hidden="true">→</span>
          </a>
        </div>
        {count > 1 && <>
          <button type="button" className="xtell-hero-arrow is-prev" onClick={() => choose(stepSlide(index, -1, count))}
            aria-label={t('xtell.home.hero.prev')}><span aria-hidden="true">‹</span></button>
          <button type="button" className="xtell-hero-arrow is-next" onClick={() => choose(stepSlide(index, 1, count))}
            aria-label={t('xtell.home.hero.next')}><span aria-hidden="true">›</span></button>
          <div className="xtell-hero-controls">
            <div className="xtell-hero-dots" role="group" aria-label={t('xtell.home.hero.slides')}>
              {temples.map((k, i) => (
                <button key={k} type="button" className="xtell-hero-dot" aria-current={i === index ? 'true' : undefined}
                  aria-label={t('xtell.home.hero.slide').replace('{n}', String(i + 1)).replace('{count}', String(count)).replace('{temple}', nameOf(k))}
                  onClick={() => choose(i)} />
              ))}
            </div>
            <button type="button" className="xtell-hero-play" onClick={toggle}
              aria-label={t(playMode ? 'xtell.home.hero.pause' : 'xtell.home.hero.play')}>
              {playMode
                ? <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden="true"><rect x="0.5" y="0.5" width="3" height="11" rx="1" fill="currentColor" /><rect x="6.5" y="0.5" width="3" height="11" rx="1" fill="currentColor" /></svg>
                : <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden="true"><path d="M1 0.8v10.4L9.5 6z" fill="currentColor" /></svg>}
            </button>
          </div>
        </>}
      </div>
    </section>
  )
}
