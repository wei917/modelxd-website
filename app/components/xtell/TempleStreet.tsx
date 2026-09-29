'use client'

import { useState } from 'react'
import { useLang } from '../../../lib/i18n'
import { TempleArtwork, displayTemples, artKind, type TempleKey } from './TempleArtwork'

// Also used to validate room hashes. These are the existing API keys.
export const TEMPLES = ['bazi', 'ziwei', 'yuelao', 'guandi', 'mazu', 'simianfo', 'navagraha', 'zhanxing', 'xingming', 'cezi', 'yixue', 'jiemeng'] as const
export type { TempleKey } from './TempleArtwork'

/**
 * "What would you like help with?" (audit, product): a newcomer does not
 * know what separates 八字, 紫微 and 九曜, but knows what they came for.
 * Choosing a purpose previews the first matching temple; every temple
 * stays one click away in the top navigation.
 */
export const PURPOSES: Array<{ key: 'self' | 'love' | 'question' | 'ritual' | 'learn'; temples: TempleKey[] }> = [
  { key: 'self', temples: ['bazi', 'ziwei', 'zhanxing', 'navagraha', 'xingming'] },
  { key: 'love', temples: ['yuelao', 'zhanxing'] },
  { key: 'question', temples: ['yixue', 'cezi', 'jiemeng', 'guandi', 'mazu'] },
  { key: 'ritual', temples: ['guandi', 'mazu', 'simianfo'] },
  { key: 'learn', temples: ['yixue'] },
]

export default function TempleStreet({ selected, onSelect, onEnter }: {
  selected: TempleKey
  onSelect: (key: TempleKey) => void
  onEnter: (key: TempleKey) => void
}) {
  const { lang, t } = useLang()
  const [purpose, setPurpose] = useState<(typeof PURPOSES)[number]['key'] | null>(null)
  const choosePurpose = (key: (typeof PURPOSES)[number]['key'] | null) => {
    setPurpose(key)
    const list = key ? PURPOSES.find(p => p.key === key)!.temples : []
    if (key && !list.includes(selected)) onSelect(displayTemples(lang).find(k => list.includes(k))!)
  }
  const name = t('xtell.site.focus.' + selected + '.name')
  const qian = selected === 'mazu' || selected === 'guandi'
  return <section className="xtell-explorer" aria-label={t('xtell.site.choose')}>
    <div className="xtell-focus-hero">
      <div className="xtell-focus-scene" data-kind={artKind(selected)} data-temple={selected}>
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
    <div className="xtell-purposes" role="group" aria-label={t('xtell.purpose.title')}>
      <span className="xtell-purposes-title">{t('xtell.purpose.title')}</span>
      {([null, ...PURPOSES.map(p => p.key)] as Array<(typeof PURPOSES)[number]['key'] | null>).map(key =>
        <button type="button" key={key ?? 'all'} className="xtell-purpose" aria-pressed={purpose === key} onClick={() => choosePurpose(key)}>
          {t('xtell.purpose.' + (key ?? 'all'))}
        </button>)}
    </div>
  </section>
}
