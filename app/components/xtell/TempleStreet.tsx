'use client'

import { useT } from '../../../lib/i18n'

export const TEMPLES = ['bazi', 'ziwei', 'yuelao', 'guandi', 'mazu', 'simianfo', 'navagraha', 'zhanxing', 'xingming', 'cezi'] as const
export type TempleKey = typeof TEMPLES[number]
const MARKS: Record<TempleKey, string> = { bazi: '命', ziwei: '星', yuelao: '緣', guandi: '義', mazu: '安', simianfo: '願', navagraha: '曜', zhanxing: '宙', xingming: '名', cezi: '字' }
const METHODS: Record<TempleKey, string> = { bazi: '八字', ziwei: '紫微斗數', yuelao: '合婚', guandi: '關帝靈籤', mazu: '六十甲子籤', simianfo: '四面許願', navagraha: '吠陀占星', zhanxing: '西洋占星', xingming: '姓名學', cezi: '測字' }

export default function TempleStreet({ onEnter }: { onEnter: (key: TempleKey) => void }) {
  const t = useT()
  return <>
    <section className="xtell-welcome" aria-labelledby="xtell-title">
      <div>
        <p className="xtell-eyebrow">{t('xtell.site.eyebrow')}</p>
        <h1 id="xtell-title">{t('xtell.site.title')}</h1>
        <p className="xtell-welcome-copy">{t('xtell.site.subtitle')}</p>
      </div>
      <div className="xtell-welcome-aside"><span className="xtell-street-glyph" aria-hidden="true">廟街</span><p>{t('xtell.site.free')}</p></div>
    </section>
    <div className="xtell-street-label"><h2>{t('xtell.site.choose')}</h2><span>{String(TEMPLES.length).padStart(2, '0')} <span aria-hidden="true">/</span> {t('xtell.site.temples')}</span></div>
    <div className="xtell-temple-grid">
      {TEMPLES.map((key, index) => <button key={key} className="xtell-temple-card" onClick={() => onEnter(key)}>
        <div className="xtell-temple-image">
          {/* Existing commissioned temple art, preserved in its original ratio. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/xtell/${key}.jpg`} alt="" width={768} height={432} loading={index < 3 ? 'eager' : 'lazy'} />
          <span className="xtell-temple-number">{String(index + 1).padStart(2, '0')}</span>
          <span className="xtell-temple-mark" aria-hidden="true">{MARKS[key]}</span>
        </div>
        <div className="xtell-temple-copy">
          <span className="xtell-temple-method">{METHODS[key]}</span>
          <h3>{t(`xtell.${key}.name`)}</h3>
          <p>{t(`xtell.${key}.desc`)}</p>
          <span className="xtell-temple-enter">{t('xtell.site.visit')}<span aria-hidden="true">↗</span></span>
        </div>
      </button>)}
    </div>
    <div className="xtell-street-note"><span className="xtell-note-mark" aria-hidden="true">卜</span><p>{t('xtell.site.note')}</p></div>
  </>
}
