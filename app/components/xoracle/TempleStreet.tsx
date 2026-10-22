'use client'

import { useState } from 'react'
import { useLang } from '../../../lib/i18n'
import { TempleArtwork, displayTemples, artKind, type TempleKey } from './TempleArtwork'

// Also used to validate room hashes. These are the existing API keys.
export const TEMPLES = ['bazi', 'ziwei', 'yuelao', 'guandi', 'mazu', 'simianfo', 'navagraha', 'zhanxing', 'xingming', 'cezi', 'yixue', 'jiemeng', 'guanyin', 'tarot', 'cookie', 'kyusei', 'sukuyo', 'sunzi', 'guanxiang'] as const
export type { TempleKey } from './TempleArtwork'

/**
 * "What would you like help with?" (audit, product): a newcomer does not
 * know what separates 八字, 紫微 and 九曜, but knows what they came for.
 * Choosing a purpose previews the first matching temple; every temple
 * stays one click away in the top navigation.
 */
export const PURPOSES: Array<{ key: 'self' | 'love' | 'question' | 'ritual' | 'learn'; temples: TempleKey[] }> = [
  { key: 'self', temples: ['bazi', 'ziwei', 'zhanxing', 'guanxiang', 'navagraha', 'kyusei', 'sukuyo', 'xingming'] },
  { key: 'love', temples: ['yuelao', 'zhanxing', 'tarot', 'sukuyo'] },
  { key: 'question', temples: ['tarot', 'yixue', 'cezi', 'jiemeng', 'sunzi', 'cookie', 'guanyin', 'guandi', 'mazu'] },
  { key: 'ritual', temples: ['guanyin', 'guandi', 'mazu', 'simianfo'] },
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
  const name = t('xoracle.site.focus.' + selected + '.name')
  const qian = selected === 'mazu' || selected === 'guandi' || selected === 'guanyin'
  return <section className="xoracle-explorer" aria-label={t('xoracle.site.choose')}>
    <div className="xoracle-focus-hero">
      <div className="xoracle-focus-scene" data-kind={artKind(selected)} data-temple={selected}>
        <TempleArtwork temple={selected} className="xoracle-focus-portrait" label={name} />
      </div>
      <div className="xoracle-focus-copy">
        <div aria-live="polite" aria-atomic="true">
          <p className="xoracle-focus-eyebrow">{t('xoracle.site.focus.' + selected + '.eyebrow')}</p>
          <h1 id="xoracle-title">{name}</h1>
          <p className="xoracle-focus-lead">{t('xoracle.site.focus.' + selected + '.lead')}</p>
          <p className="xoracle-focus-description">{t('xoracle.site.focus.' + selected + '.description')}</p>
          <ul className="xoracle-focus-methods" aria-label={t('xoracle.site.focus.methods')}>
            {t('xoracle.site.focus.' + selected + '.methods').split('|').map(method => <li key={method}>{method}</li>)}
          </ul>
        </div>
        <div className="xoracle-focus-actions">
          <button type="button" className="xoracle-focus-enter" onClick={() => onEnter(selected)}>
            <span>{t('xoracle.site.focus.enter').replace('{temple}', name)}</span><span aria-hidden="true">→</span>
          </button>
          <details className="xoracle-focus-how" key={selected}>
            <summary>{t('xoracle.site.focus.how')}</summary>
            <p>{t(qian ? 'xoracle.site.focus.howQian' : selected === 'yixue' ? 'xoracle.site.focus.howYixue' : selected === 'tarot' ? 'xoracle.site.focus.howTarot' : selected === 'cookie' ? 'xoracle.site.focus.howCookie' : 'xoracle.site.focus.howChart')}</p>
            <p>{t('xoracle.site.focus.howReading')}</p>
          </details>
          <p className="xoracle-focus-note">{t('xoracle.site.focus.signin')}</p>
        </div>
      </div>
    </div>
    <div className="xoracle-purposes" role="group" aria-label={t('xoracle.purpose.title')}>
      <span className="xoracle-purposes-title">{t('xoracle.purpose.title')}</span>
      {([null, ...PURPOSES.map(p => p.key)] as Array<(typeof PURPOSES)[number]['key'] | null>).map(key =>
        <button type="button" key={key ?? 'all'} className="xoracle-purpose" aria-pressed={purpose === key} onClick={() => choosePurpose(key)}>
          {t('xoracle.purpose.' + (key ?? 'all'))}
        </button>)}
    </div>
  </section>
}
