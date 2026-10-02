'use client'
// app/components/xtell/AnswerVote.tsx — 👍 / 👎 under a teacher's answer
// (owner, Oct 1: "add thumb up and thumb down for each response"). Pressing
// the chosen one again takes it back. Only the visitor sees their own vote;
// /admin/traffic counts them per teacher and temple (supabase/122).

import { useLang } from '../../../lib/i18n'

// Material Icons' thumb_up (Apache-2.0); thumb_down is the same turned over.
const THUMB = 'M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z'

export function AnswerVote({ value, onVote }: { value: 0 | 1 | -1; onVote: (v: 1 | -1) => void }) {
  const { t } = useLang()
  return (
    <div className="xtell-vote" role="group" aria-label={t('xtell.vote.label')}>
      {([1, -1] as const).map(v => (
        <button key={v} type="button" className="xtell-vote-btn" aria-pressed={value === v}
          aria-label={t(v === 1 ? 'xtell.vote.up' : 'xtell.vote.down')} title={t(v === 1 ? 'xtell.vote.up' : 'xtell.vote.down')}
          onClick={() => onVote(v)}>
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" style={v === -1 ? { transform: 'rotate(180deg)' } : undefined}>
            <path d={THUMB} fill="currentColor" />
          </svg>
        </button>
      ))}
    </div>
  )
}
