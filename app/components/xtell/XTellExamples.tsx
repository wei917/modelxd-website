'use client'
// app/components/xtell/XTellExamples.tsx — 解讀範例 and the three steps, on
// the homepage under today's cards (Oct 3, Concept 24).
//
// The examples show what a reading looks like: a question of the kind people
// bring, and a short passage in a master's voice. They are labelled 示例 and
// said to be examples, never written as a visitor's own words or results
// (no testimonials). Each leads into its temple by the same native link the
// top bar uses; nothing is sent.

import { useId, useState } from 'react'
import { useLang } from '../../../lib/i18n'
import { TempleArtwork, artKind, type TempleKey } from './TempleArtwork'
import { HERO_ART } from '../../../lib/xtell-hero'

export const EXAMPLES: Array<{ id: 'career' | 'love' | 'year'; temple: TempleKey }> = [
  { id: 'career', temple: 'guanyin' },
  { id: 'love', temple: 'tarot' },
  { id: 'year', temple: 'bazi' },
]

export function XTellExamples() {
  const { t } = useLang()
  const titleId = useId()
  const [all, setAll] = useState(false)
  const shown = all ? EXAMPLES : EXAMPLES.slice(0, 1)
  return (
    <section className="xtell-ex" aria-labelledby={titleId}>
      <div className="xtell-ex-head">
        <h2 id={titleId} className="xtell-home-title">
          <svg width="22" height="18" viewBox="0 0 22 18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><path d="M11 3.5C9 2 6 1.5 1.5 2v13c4.5-.5 7.5 0 9.5 1.5 2-1.5 5-2 9.5-1.5V2C16 1.5 13 2 11 3.5zM11 3.5V16.5" /></svg>
          {t('xtell.ex.title')}
        </h2>
        <p className="xtell-ex-sub">{t('xtell.ex.sub')}</p>
        <button type="button" className="xtell-home-link" aria-expanded={all} onClick={() => setAll(a => !a)}>
          {t(all ? 'xtell.ex.less' : 'xtell.ex.more')} <span aria-hidden="true">{all ? '↑' : '→'}</span>
        </button>
      </div>
      <ul className="xtell-ex-list">
        {shown.map(ex => {
          const art = HERO_ART[ex.temple]
          const name = t('xtell.site.focus.' + ex.temple + '.name')
          return (
            <li key={ex.id}>
              <a className="xtell-ex-card" href={'/#' + ex.temple}>
                <span className="xtell-ex-art" aria-hidden="true"
                  style={art ? { backgroundImage: `linear-gradient(135deg, ${art.wash[0]}, ${art.wash[1]})` } : undefined}>
                  {art?.src
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={art.src} alt="" loading="lazy" decoding="async" style={art.focus ? { objectPosition: art.focus } : undefined} />
                    : <TempleArtwork temple={ex.temple} className={'xtell-ex-portrait is-' + artKind(ex.temple)} />}
                </span>
                <span className="xtell-ex-body">
                  <span className="xtell-ex-badge">{t('xtell.ex.badge')}</span>
                  <span className="xtell-ex-q">{t('xtell.ex.' + ex.id + '.q')}</span>
                  <span className="xtell-ex-a">{t('xtell.ex.' + ex.id + '.a')}</span>
                  <span className="xtell-ex-go">{t('xtell.ex.enter').replace('{temple}', name)} <span aria-hidden="true">›</span></span>
                </span>
              </a>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

const STEP_ICONS = [
  <svg key="1" width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2.5" y="2.5" width="7" height="7" rx="2" /><rect x="12.5" y="2.5" width="7" height="7" rx="2" /><rect x="2.5" y="12.5" width="7" height="7" rx="2" /><rect x="12.5" y="12.5" width="7" height="7" rx="2" /></svg>,
  <svg key="2" width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="4" y="2.5" width="14" height="17" rx="2" /><path d="M7.5 7.5h7M7.5 11h7M7.5 14.5h4" /></svg>,
  <svg key="3" width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><path d="M11 2.5l1.8 4.7 4.7 1.8-4.7 1.8L11 15.5l-1.8-4.7L4.5 9l4.7-1.8z" /><path d="M17 14l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" /></svg>,
]

export function XTellHowTo() {
  const { t } = useLang()
  const titleId = useId()
  return (
    <section className="xtell-how" aria-labelledby={titleId}>
      <h2 id={titleId} className="xtell-how-title">{t('xtell.how.title')}</h2>
      <ol className="xtell-how-steps">
        {[1, 2, 3].map((n, i) => (
          <li key={n}>
            <span className="xtell-how-icon">{STEP_ICONS[i]}</span>
            <span className="xtell-how-text">
              <strong><span className="xtell-how-n">{n}</span>{t('xtell.how.' + n + '.title')}</strong>
              <span>{t('xtell.how.' + n + '.desc')}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}
