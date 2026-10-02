'use client'
// app/components/xtell/TarotRitual.tsx — 塔羅's ritual (owner, Oct 1: "we
// need to show the cards and face down to let people choose. more 儀式感").
//
//   洗牌  shuffle, thinking of the question, as many times as you like
//   切牌  pick one of three piles by feel; it goes on top
//   選牌  the whole deck fanned face down in an arc; tap the cards you are
//         drawn to, and they fill the spread's places
//   翻牌  turn each chosen card over; the spread is then laid and read
//
// The shuffle (the browser's crypto source, lib/tarot-draw.ts) decides which
// card lies where and which way up; the visitor only chooses places. Nothing
// leaves the browser until the last card is turned: then the picks go to the
// chart route, which lays the spread with names and meanings.

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useLang } from '../../../lib/i18n'
import { cutDeck, shuffleDeck, tarotImage, type TarotPick } from '../../../lib/tarot-draw'

type Stage = 'deck' | 'shuffling' | 'cut' | 'fan' | 'reveal' | 'done'

const SHUFFLE_MS = 1300, CUT_MS = 650, PICKED_MS = 550, LAID_MS = 1100
/** The fan's geometry, shared with globals.css: a card every 28 px (58 wide,
 *  30 under the next), 44 px of padding at each end. */
const FAN_STEP = 28, FAN_HALF = 29, FAN_PAD = 44

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function TarotRitual({ count, positions, ask, disabled, rand, onDone }: {
  count: number
  /** The spread's places, in order (過去, 現在, 未來…), already in words. */
  positions: string[]
  ask: string
  disabled: boolean
  rand: () => number
  onDone: (picks: TarotPick[]) => void
}) {
  const { t } = useLang()
  const [stage, setStage] = useState<Stage>('deck')
  const [deck, setDeck] = useState<TarotPick[] | null>(null)
  const [cutPile, setCutPile] = useState<number | null>(null)
  const [picked, setPicked] = useState<number[]>([])
  const [flipped, setFlipped] = useState<boolean[]>([])
  const strip = useRef<HTMLDivElement>(null)
  const timers = useRef<number[]>([])
  const later = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, reducedMotion() ? 0 : ms)) }
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  // The fan opens on its middle, so both ends are a swipe away. The arc
  // follows the swipe: --s is the middle of what is on screen, and each card
  // tilts and drops by its distance from it (globals.css), so the cards in
  // view always curve like a fan in the hand.
  useEffect(() => {
    if (stage !== 'fan' || !strip.current) return
    const s = strip.current
    let frame = 0
    const centre = () => { frame = 0; s.style.setProperty('--s', String(Math.round(s.scrollLeft + s.clientWidth / 2 - FAN_PAD))) }
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(centre) }
    s.scrollLeft = (s.scrollWidth - s.clientWidth) / 2
    centre()
    s.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => { s.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); if (frame) cancelAnimationFrame(frame) }
  }, [stage])

  const shuffle = () => {
    if (disabled || stage === 'shuffling') return
    setDeck(shuffleDeck(rand))
    setStage('shuffling')
    later(() => setStage('deck'), SHUFFLE_MS)
  }
  const cut = (pile: 0 | 1 | 2) => {
    if (!deck || cutPile !== null) return
    setCutPile(pile)
    setDeck(cutDeck(deck, pile))
    later(() => { setStage('fan'); setCutPile(null) }, CUT_MS)
  }
  const pick = (i: number) => {
    if (stage !== 'fan' || picked.includes(i) || picked.length >= count) return
    const next = [...picked, i]
    setPicked(next)
    if (next.length === count) later(() => { setFlipped(next.map(() => false)); setStage('reveal') }, PICKED_MS)
  }
  const flip = (k: number) => {
    if (stage !== 'reveal' || flipped[k] || !deck) return
    const next = flipped.map((f, j) => f || j === k)
    setFlipped(next)
    if (next.every(Boolean)) later(() => { setStage('done'); onDone(picked.map(i => deck[i])) }, LAID_MS)
  }
  const restart = () => { timers.current.forEach(clearTimeout); setStage('deck'); setDeck(null); setPicked([]); setFlipped([]); setCutPile(null) }

  // Laid, the room replaces this panel. Still here once the laying is over
  // means it failed (the error shows above): start again from the shuffle.
  const laying = useRef(false)
  useEffect(() => {
    if (stage !== 'done') { laying.current = false; return }
    if (disabled) laying.current = true
    else if (laying.current) restart()
  }, [disabled, stage]) // eslint-disable-line react-hooks/exhaustive-deps

  const fill = (key: string, n: number) => t(key).replace('{n}', String(n))
  const step = stage === 'deck' || stage === 'shuffling' ? t(stage === 'shuffling' ? 'xtell.tarot.r.shuffling' : 'xtell.tarot.r.stepShuffle')
    : stage === 'cut' ? t('xtell.tarot.r.stepCut')
    : stage === 'fan' ? (picked.length === 0 ? fill('xtell.tarot.r.stepPick', count) : picked.length < count ? fill('xtell.tarot.r.pickMore', count - picked.length) : '')
    : stage === 'reveal' ? t('xtell.tarot.r.stepFlip')
    : t('xtell.tarot.drawing')

  const slots = (stage === 'fan' || stage === 'reveal' || stage === 'done') && (
    <div className={'xtell-tr-slots' + (count > 1 ? ' is-three' : '')}>
      {positions.slice(0, count).map((label, k) => {
        const i = picked[k], card = i !== undefined && deck ? deck[i] : null
        return (
          <div key={k} className="xtell-tr-slot">
            <span className="xtell-tr-slot-name">{label}</span>
            {!card ? <span className="xtell-tr-slot-empty" aria-hidden="true" />
              : stage === 'fan' ? <span className="xtell-tr-card is-placed" aria-hidden="true"><span className="xtell-tr-face xtell-tr-back" /></span>
              : (
                <button type="button" className={'xtell-tr-card is-flip' + (flipped[k] ? ' is-flipped' : '')} onClick={() => flip(k)}
                  disabled={flipped[k] || stage !== 'reveal'} aria-label={t('xtell.tarot.r.flip').replace('{pos}', label)}>
                  <span className="xtell-tr-face xtell-tr-back" />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <span className="xtell-tr-face xtell-tr-front"><img src={tarotImage(card.id)} alt="" className={card.reversed ? 'is-reversed' : undefined} /></span>
                </button>
              )}
          </div>
        )
      })}
    </div>
  )

  return (
    <div className="xtell-tr" data-stage={stage}>
      <p className="xtell-tr-step" role="status" aria-live="polite">{step}</p>
      {ask.trim() && stage !== 'done' && <p className="xtell-tr-ask">{t('xtell.tarot.r.thinking').replace('{q}', ask.trim())}</p>}

      {(stage === 'deck' || stage === 'shuffling') && <>
        <div className={'xtell-tr-stack' + (stage === 'shuffling' ? ' is-shuffling' : '')} aria-hidden="true">
          {Array.from({ length: 8 }, (_, i) => <span key={i} className="xtell-tr-card" style={{ '--i': i } as CSSProperties}><span className="xtell-tr-face xtell-tr-back" /></span>)}
        </div>
        <div className="xtell-tr-actions">
          <button type="button" className="xtell-tarot-deal" onClick={shuffle} disabled={disabled || stage === 'shuffling'} aria-busy={stage === 'shuffling' || undefined}>
            {t(deck ? 'xtell.tarot.r.again' : 'xtell.tarot.r.shuffle')}
          </button>
          {deck && stage === 'deck' && <button type="button" className="xtell-tr-next" onClick={() => setStage('cut')} disabled={disabled}>{t('xtell.tarot.r.toCut')}</button>}
        </div>
      </>}

      {stage === 'cut' && (
        <div className="xtell-tr-piles" role="group" aria-label={t('xtell.tarot.r.stepCut')}>
          {([0, 1, 2] as const).map(p => (
            <button key={p} type="button" className={'xtell-tr-pile' + (cutPile === p ? ' is-chosen' : cutPile !== null ? ' is-other' : '')}
              onClick={() => cut(p)} disabled={disabled || cutPile !== null} aria-label={fill('xtell.tarot.r.pile', p + 1)}>
              {Array.from({ length: 4 }, (_, i) => <span key={i} className="xtell-tr-card" style={{ '--i': i } as CSSProperties}><span className="xtell-tr-face xtell-tr-back" /></span>)}
            </button>
          ))}
        </div>
      )}

      {slots}

      {stage === 'fan' && deck && (
        <div ref={strip} className="xtell-tr-fan" role="group" aria-label={fill('xtell.tarot.r.stepPick', count)}>
          <div className="xtell-tr-fan-row">
            {deck.map((_, i) => {
              const style = { '--x': i * FAN_STEP + FAN_HALF, '--d': `${i * 7}ms` } as CSSProperties
              return (
                <button key={i} type="button" className={'xtell-tr-card is-fan' + (picked.includes(i) ? ' is-picked' : '')} style={style}
                  onClick={() => pick(i)} disabled={disabled || picked.includes(i) || picked.length >= count} aria-label={fill('xtell.tarot.r.card', i + 1)}>
                  <span className="xtell-tr-face xtell-tr-back" />
                </button>
              )
            })}
          </div>
        </div>
      )}

      {(stage === 'cut' || stage === 'fan') && (
        <button type="button" className="xtell-tr-restart" onClick={restart} disabled={disabled}>{t('xtell.tarot.r.restart')}</button>
      )}
    </div>
  )
}
