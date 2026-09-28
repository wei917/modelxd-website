'use client'
// app/components/xtell/TeacherPicker.tsx — 「請一位老師」: XTell's own teacher
// picker (owner, Sep 28), replacing XCreate's model browser (search, score
// tabs, provider filters, model ids, release dates). Every offered teacher
// is visible at once, grouped 快速 / 均衡 / 深入 (lib/xtell-teachers.ts),
// each with a one-line description, the price of a question and how soon
// they start answering. No advanced mode: comparing models is XCreate's
// and XBoard's job.

import { useEffect, useRef } from 'react'
import { useT } from '../../../lib/i18n'
import type { PickerModel } from '../ModelPickerDialog'
import ProviderLogo from '../ProviderLogo'
import { TEACHER_GROUPS } from '../../../lib/xtell-teachers'

export default function TeacherPicker({ catalog, seated, replacing, defaultModel, price, firstWord, onSelect, onClose }: {
  catalog: PickerModel[]
  /** Ids already at the table (not offered again). */
  seated: string[]
  /** The seat being changed, if any (its teacher is marked 目前). */
  replacing: string | null
  defaultModel: string
  /** Price of one question with this teacher's default settings, or null. */
  price: (m: PickerModel) => string | null
  /** Seconds to the first word, or null when unmeasured. */
  firstWord: (m: PickerModel) => string | null
  onSelect: (m: PickerModel) => void
  onClose: () => void
}) {
  const t = useT()
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    panel.current?.querySelector<HTMLButtonElement>('button.xtell-tp-row:not(:disabled)')?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const groups = TEACHER_GROUPS
    .map(g => ({ key: g.key, rows: g.models.map(n => catalog.find(m => m.model_name === n)).filter((m): m is PickerModel => !!m) }))
    .filter(g => g.rows.length > 0)
  return (
    <div className="xtell-tp-backdrop" onClick={onClose}>
      <div ref={panel} className="xtell-tp" role="dialog" aria-modal="true" aria-labelledby="xtell-tp-title" onClick={e => e.stopPropagation()}>
        <header className="xtell-tp-head">
          <h2 id="xtell-tp-title">{t(replacing ? 'xtell.tp.replace' : 'xtell.tp.title')}</h2>
          <p>{t('xtell.tp.sub')}</p>
        </header>
        <div className="xtell-tp-body">
          {groups.length === 0 && <p className="xtell-tp-empty">{t('common.loading')}</p>}
          {groups.map(g => (
            <section key={g.key} aria-label={t(`xtell.tp.group.${g.key}`)}>
              <h3>{t(`xtell.tp.group.${g.key}`)}</h3>
              {g.rows.map(m => {
                const current = m.id === replacing
                const taken = !current && seated.includes(m.id)
                const usd = price(m), secs = firstWord(m)
                return (
                  <button key={m.id} type="button" className="xtell-tp-row" aria-current={current || undefined} disabled={taken || current} onClick={() => onSelect(m)}>
                    <span className="xtell-tp-logo" aria-hidden="true"><ProviderLogo provider={m.provider} size={22} /></span>
                    <span className="xtell-tp-main">
                      <span className="xtell-tp-name">
                        {m.display_name}
                        {m.model_name === defaultModel && <small>{t('xtell.tp.default')}</small>}
                        {(taken || current) && <small className="is-muted">{t(current ? 'xtell.tp.current' : 'xtell.tp.seated')}</small>}
                      </span>
                      <span className="xtell-tp-note">{t(`xtell.tp.note.${m.model_name}`)}</span>
                    </span>
                    <span className="xtell-tp-stats">
                      {usd && <span>{t('xtell.seat.priceLabel')} <b>~{usd}</b></span>}
                      {secs && <span>{t('xtell.seat.ttftLabel')} ~{secs} {t('xtell.seat.sec')}</span>}
                    </span>
                  </button>
                )
              })}
            </section>
          ))}
        </div>
        <footer className="xtell-tp-foot"><button type="button" onClick={onClose}>{t('xtell.tp.cancel')}</button></footer>
      </div>
    </div>
  )
}
