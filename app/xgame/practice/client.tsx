'use client'
// The practice board. 7x7, black to move, four black stones already in a
// row with both ends open: either end wins. This is a presentation feature
// (a puzzle with fixed local logic), not a rule set for the real Gomoku
// game, which lives in lib/gomoku-engine and app/xgame/GomokuLive.tsx.
import { useState } from 'react'
import Link from 'next/link'
import { useT } from '../../../lib/i18n'

const N = 7, CELL = 44, PAD = 26
const W = PAD * 2 + (N - 1) * CELL
// [x, y] on a 0..6 grid. The row of four sits on y=3 at x=2..5.
const BLACK: Array<[number, number]> = [[2, 3], [3, 3], [4, 3], [5, 3]]
const WHITE: Array<[number, number]> = [[2, 2], [3, 4], [4, 2], [5, 4], [3, 1], [1, 5]]
const WINS: Array<[number, number]> = [[1, 3], [6, 3]]
const key = (x: number, y: number) => `${x},${y}`

export default function PracticeClient() {
  const t = useT()
  const [placed, setPlaced] = useState<[number, number] | null>(null)
  const [misses, setMisses] = useState(0)
  const won = !!placed && WINS.some(([x, y]) => placed[0] === x && placed[1] === y)
  const taken = new Set([...BLACK, ...WHITE].map(([x, y]) => key(x, y)))

  const play = (x: number, y: number) => {
    if (won || taken.has(key(x, y))) return
    if (WINS.some(([wx, wy]) => wx === x && wy === y)) { setPlaced([x, y]); return }
    setPlaced([x, y]); setMisses(m => m + 1)
    // A wrong stone is shown for a beat, then lifted so the puzzle stays the same puzzle.
    setTimeout(() => setPlaced(p => (p && p[0] === x && p[1] === y ? null : p)), 650)
  }
  const reset = () => { setPlaced(null); setMisses(0) }
  const px = (i: number) => PAD + i * CELL

  return (
    <div className="xduel-page">
      <div className="arena xcreate-arena" style={{ maxWidth: 760 }}>
        <Link href="/xgame" className="prompt-label eyebrow" style={{ textDecoration: 'none', display: 'inline-block' }}>XGAME · {t('xg.practice.eyebrow')}</Link>
        <h1 className="page-headline" style={{ marginBottom: 8 }}>{t('xg.practice.title')}</h1>
        <p style={{ color: 'var(--muted)', fontSize: 15, lineHeight: 1.7, margin: '0 0 18px', maxWidth: 560 }}>{t('xg.practice.sub')}</p>

        <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <svg viewBox={`0 0 ${W} ${W}`} width="100%" style={{ maxWidth: 340, background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 12, touchAction: 'manipulation' }} role="group" aria-label={t('xg.practice.title')}>
            {Array.from({ length: N }, (_, i) => (
              <g key={i} stroke="var(--border2)" strokeWidth={1}>
                <line x1={px(0)} y1={px(i)} x2={px(N - 1)} y2={px(i)} />
                <line x1={px(i)} y1={px(0)} x2={px(i)} y2={px(N - 1)} />
              </g>
            ))}
            {WHITE.map(([x, y]) => <circle key={'w' + key(x, y)} cx={px(x)} cy={px(y)} r={17} fill="#fff" stroke="#8C8880" strokeWidth={1.5} />)}
            {BLACK.map(([x, y]) => <circle key={'b' + key(x, y)} cx={px(x)} cy={px(y)} r={17} fill="#1B1B1A" />)}
            {placed && <circle cx={px(placed[0])} cy={px(placed[1])} r={17} fill="#1B1B1A" stroke={won ? 'var(--green)' : 'var(--red)'} strokeWidth={3} />}
            {won && <line x1={px(Math.min(placed![0], 2))} y1={px(3)} x2={px(Math.max(placed![0], 5))} y2={px(3)} stroke="var(--green)" strokeWidth={4} strokeLinecap="round" opacity={0.85} />}
            {/* hit targets last, so they sit above the stones */}
            {Array.from({ length: N * N }, (_, i) => {
              const x = i % N, y = Math.floor(i / N)
              const occupied = taken.has(key(x, y))
              const label = t('xg.practice.cell').replace('{col}', 'ABCDEFG'[x]).replace('{row}', String(y + 1)) + (occupied ? ' · ' + t('xg.practice.occupied') : '')
              return (
                <rect
                  key={'h' + i} x={px(x) - CELL / 2} y={px(y) - CELL / 2} width={CELL} height={CELL} fill="transparent"
                  role="button" tabIndex={won || occupied ? -1 : 0} aria-label={label} aria-disabled={won || occupied || undefined}
                  className="practice-cell"
                  style={{ cursor: won || occupied ? 'default' : 'pointer' }}
                  onClick={() => play(x, y)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play(x, y) } }}
                />
              )
            })}
          </svg>

          <div style={{ flex: '1 1 240px', minWidth: 0 }}>
            <div className="prompt-label" style={{ marginBottom: 8 }}>{won ? t('xg.practice.won') : t('xg.practice.turn')}</div>
            {/* aria-live: the win and the hint are announced, not just drawn */}
            <p aria-live="polite" style={{ fontSize: 15, lineHeight: 1.7, color: won ? 'var(--white)' : 'var(--muted)', margin: '0 0 16px' }}>
              {won ? t('xg.practice.won.desc') : misses > 0 ? t('xg.practice.hint') : t('xg.practice.task')}
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {won ? (
                <>
                  <Link href="/xgame" className="home-hero-cta is-primary" style={{ textDecoration: 'none' }}>{t('xg.practice.real')} →</Link>
                  <button type="button" className="home-hero-cta is-secondary" onClick={reset}>{t('xg.practice.again')}</button>
                </>
              ) : (
                <button type="button" className="home-hero-cta is-secondary" onClick={reset}>{t('xg.practice.reset')}</button>
              )}
              <Link href="/" className="home-hero-cta is-secondary" style={{ textDecoration: 'none' }}>{t('xg.practice.home')}</Link>
            </div>
            <p style={{ fontSize: 12.5, color: 'var(--muted2)', lineHeight: 1.6, marginTop: 18 }}>{t('xg.practice.note')}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
