'use client'

import { useT } from '../../../lib/i18n'
import { TempleArtwork, DISPLAY_TEMPLES, artKind, type TempleKey } from './TempleArtwork'

// Also used to validate room hashes. These are the existing API keys.
export const TEMPLES = ['bazi', 'ziwei', 'yuelao', 'guandi', 'mazu', 'simianfo', 'navagraha', 'zhanxing', 'xingming', 'cezi', 'yixue'] as const
export type { TempleKey } from './TempleArtwork'

export default function TempleStreet({ selected, onSelect, onEnter }: {
  selected: TempleKey
  onSelect: (key: TempleKey) => void
  onEnter: (key: TempleKey) => void
}) {
  const t = useT()
  const name = t('xtell.site.focus.' + selected + '.name')
  const qian = selected === 'mazu' || selected === 'guandi'
  return <section className="xtell-explorer" aria-label={t('xtell.site.choose')}>
    <div className="xtell-focus-hero">
      <div className="xtell-focus-scene" data-kind={artKind(selected)}>
        <TempleArtwork temple={selected} className="xtell-focus-portrait" label={name} />
      </div>
      <div className="xtell-focus-copy">
        <div aria-live="polite" aria-atomic="true">
          <p className="xtell-focus-eyebrow">{t('xtell.site.focus.' + selected + '.eyebrow')}</p>
          <h1 id="xtell-title">{name}</h1>
          <p className="xtell-focus-lead">{t('xtell.site.focus.' + selected + '.lead')}</p>
          <p className="xtell-focus-description">{t('xtell.site.focus.' + selected + '.description')}</p>
          <ul className="xtell-focus-methods" aria-label={t('xtell.site.focus.methods')}>
            {t('xtell.site.focus.' + selected + '.methods').split('|').map(method => <li key={method}>{method}</li>)}
          </ul>
        </div>
        <div className="xtell-focus-actions">
          <button type="button" className="xtell-focus-enter" onClick={() => onEnter(selected)}>
            <span>{t('xtell.site.focus.enter').replace('{temple}', name)}</span><span aria-hidden="true">→</span>
          </button>
          <details className="xtell-focus-how" key={selected}>
            <summary>{t('xtell.site.focus.how')}</summary>
            <p>{t(qian ? 'xtell.site.focus.howQian' : selected === 'yixue' ? 'xtell.site.focus.howYixue' : 'xtell.site.focus.howChart')}</p>
            <p>{t('xtell.site.focus.howReading')}</p>
          </details>
          <p className="xtell-focus-note">{t('xtell.site.focus.signin')}</p>
        </div>
      </div>
    </div>
    <nav className="xtell-focus-menu" aria-label={t('xtell.site.choose')}>
      {DISPLAY_TEMPLES.map(key => <button type="button" key={key} className="xtell-focus-choice"
        aria-label={t('xtell.site.focus.' + key + '.name')} aria-pressed={selected === key} onClick={() => onSelect(key)}>
        <TempleArtwork temple={key} kind="icon" className="xtell-focus-icon" />
        <span className="xtell-focus-label">{t('xtell.site.focus.' + key + '.short')}</span>
      </button>)}
    </nav>
  </section>
}
