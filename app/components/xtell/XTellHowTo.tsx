'use client'
// app/components/xtell/XTellHowTo.tsx — the four steps on the homepage
// (Oct 3, owner): choose a temple, give your details, choose masters,
// discuss the results with them. Words that hold wherever the guide sits,
// and never how anything is computed.

import { useId } from 'react'
import { useLang } from '../../../lib/i18n'

const STEPS = [1, 2, 3, 4] as const
const STEP_ICONS = [
  <svg key="1" width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2.5" y="2.5" width="7" height="7" rx="2" /><rect x="12.5" y="2.5" width="7" height="7" rx="2" /><rect x="2.5" y="12.5" width="7" height="7" rx="2" /><rect x="12.5" y="12.5" width="7" height="7" rx="2" /></svg>,
  <svg key="2" width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="4" y="2.5" width="14" height="17" rx="2" /><path d="M7.5 7.5h7M7.5 11h7M7.5 14.5h4" /></svg>,
  <svg key="3" width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="8" cy="7.5" r="3" /><path d="M2.5 18.5c.6-3 2.7-4.8 5.5-4.8s4.9 1.8 5.5 4.8" /><circle cx="15.5" cy="8.5" r="2.4" /><path d="M14.6 13.3c2.6-.2 4.4 1.4 4.9 4.2" /></svg>,
  <svg key="4" width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><path d="M3 5.5A2.5 2.5 0 0 1 5.5 3h7A2.5 2.5 0 0 1 15 5.5v3.5a2.5 2.5 0 0 1-2.5 2.5H8.5L5.5 14v-2.5A2.5 2.5 0 0 1 3 9z" /><path d="M17.5 7.5h.5A1.5 1.5 0 0 1 19.5 9v4.5A1.5 1.5 0 0 1 18 15h-.5V17.5L14.5 15H11" /></svg>,
]

export function XTellHowTo() {
  const { t } = useLang()
  const titleId = useId()
  return (
    <section className="xtell-how" aria-labelledby={titleId}>
      <h2 id={titleId} className="xtell-how-title">{t('xtell.how.title')}</h2>
      <ol className="xtell-how-steps">
        {STEPS.map((n, i) => (
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
