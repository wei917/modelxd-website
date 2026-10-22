'use client'
// app/components/xoracle/TeacherPicker.tsx — 「請一位老師」: XOracle's own teacher
// picker (owner, Sep 28), replacing XCreate's model browser (search, score
// tabs, provider filters, model ids, release dates). Every offered teacher
// is visible at once, grouped 快速 / 均衡 / 深入 (lib/xoracle-teachers.ts),
// each with a one-line description, the price of a question and how soon
// they start answering. No advanced mode: comparing models is XCreate's
// and XBoard's job.

import { useEffect, useRef } from 'react'
import { useT } from '../../../lib/i18n'
import type { PickerModel } from '../ModelPickerDialog'
import ProviderLogo from '../ProviderLogo'
import { TEACHER_GROUPS } from '../../../lib/xoracle-teachers'

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
    panel.current?.querySelector<HTMLButtonElement>('button.xoracle-tp-row:not(:disabled)')?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const groups = TEACHER_GROUPS
    .map(g => ({ key: g.key, rows: g.models.map(n => catalog.find(m => m.model_name === n)).filter((m): m is PickerModel => !!m) }))
    .filter(g => g.rows.length > 0)
  return (
    <div className="xoracle-tp-backdrop" onClick={onClose}>
      <div ref={panel} className="xoracle-tp" role="dialog" aria-modal="true" aria-labelledby="xoracle-tp-title" onClick={e => e.stopPropagation()}>
        <header className="xoracle-tp-head">
          <h2 id="xoracle-tp-title">{t(replacing ? 'xoracle.tp.replace' : 'xoracle.tp.title')}</h2>
          <p>{t('xoracle.tp.sub')}</p>
        </header>
        <div className="xoracle-tp-body">
          {groups.length === 0 && <p className="xoracle-tp-empty">{t('common.loading')}</p>}
          {groups.map(g => (
            <section key={g.key} aria-label={t(`xoracle.tp.group.${g.key}`)}>
              <h3>{t(`xoracle.tp.group.${g.key}`)}</h3>
              {g.rows.map(m => {
                const current = m.id === replacing
                const taken = !current && seated.includes(m.id)
                const usd = price(m), secs = firstWord(m)
                return (
                  <button key={m.id} type="button" className="xoracle-tp-row" aria-current={current || undefined} disabled={taken || current} onClick={() => onSelect(m)}>
                    <span className="xoracle-tp-logo" aria-hidden="true"><ProviderLogo provider={m.provider} size={22} /></span>
                    <span className="xoracle-tp-main">
                      <span className="xoracle-tp-name">
                        {m.display_name}
                        {m.model_name === defaultModel && <small>{t('xoracle.tp.default')}</small>}
                        {(taken || current) && <small className="is-muted">{t(current ? 'xoracle.tp.current' : 'xoracle.tp.seated')}</small>}
                      </span>
                      <span className="xoracle-tp-note">{t(`xoracle.tp.note.${m.model_name}`)}</span>
                    </span>
                    <span className="xoracle-tp-stats">
                      {usd && <span>{t('xoracle.seat.priceLabel')} <b>~{usd}</b></span>}
                      {secs && <span>{t('xoracle.seat.ttftLabel')} ~{secs} {t('xoracle.seat.sec')}</span>}
                    </span>
                  </button>
                )
              })}
            </section>
          ))}
        </div>
        <footer className="xoracle-tp-foot"><button type="button" onClick={onClose}>{t('xoracle.tp.cancel')}</button></footer>
      </div>
    </div>
  )
}
