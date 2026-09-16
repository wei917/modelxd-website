'use client'
// ✨ Improve prompt — a compact button beside a prompt box (XDuel, XCreate).
// On an explicit click it asks /api/prompt/refine for a suggested rewrite
// and shows it in an EDITABLE preview with Apply / Keep original; nothing
// replaces the input until the user applies, nothing generates, and an Undo
// follows an apply. Details the model added are listed as suggestions.
//
// Staleness: each request carries an id; a reply from a superseded request
// is dropped, and a reply whose base prompt no longer matches the input is
// shown with a "your input changed" note rather than applied anywhere.
import { useEffect, useRef, useState } from 'react'
import { useLang } from '../../lib/i18n'

type Status = 'idle' | 'loading' | 'preview' | 'error'
type Props = {
  prompt: string
  mode: string                 // text | image | video | game
  surface: 'xduel' | 'xcreate'
  disabled?: boolean
  onApply: (next: string) => void
}

const MIN_CHARS = 2
const MAX_CHARS = 2000

/** The refiner split in two so the button can live in the composer's action
 *  row beside Generate / Start while the editable preview takes a full-width
 *  section of its own. One hook call holds the state for both; callers place
 *  `action` and `preview` wherever the layout wants them. */
export function usePromptRefiner({ prompt, mode, surface, disabled, onApply }: Props): { action: JSX.Element; preview: JSX.Element | null } {
  const { lang, t } = useLang()
  const [status, setStatus]   = useState<Status>('idle')
  const [error, setError]     = useState<string | null>(null)
  const [base, setBase]       = useState('')          // the input the suggestion was made for
  const [draft, setDraft]     = useState('')          // editable suggestion
  const [added, setAdded]     = useState<string[]>([])
  const [changes, setChanges] = useState<string[]>([])
  const [applied, setApplied] = useState<{ previous: string; next: string } | null>(null)
  const reqRef = useRef(0)
  const busyRef = useRef(false)   // synchronous double-click guard; state lags a render
  const taRef  = useRef<HTMLTextAreaElement>(null)

  const trimmed = prompt.trim()
  const canAsk = !disabled && status !== 'loading' && trimmed.length >= MIN_CHARS && trimmed.length <= MAX_CHARS
  const stale = status === 'preview' && prompt !== base

  // The undo offer lasts while the input still holds what was applied.
  useEffect(() => {
    if (applied && prompt !== applied.next) setApplied(null)
  }, [prompt, applied])

  useEffect(() => {
    if (status === 'preview') taRef.current?.focus({ preventScroll: true })
  }, [status])

  const ask = async () => {
    if (!canAsk || busyRef.current) return
    busyRef.current = true
    const id = ++reqRef.current
    const asked = prompt
    setStatus('loading'); setError(null); setApplied(null)
    let res: Response | null = null
    try {
      res = await fetch('/api/prompt/refine', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: asked, mode, surface, lang }),
      })
    } catch { res = null } finally { busyRef.current = false }
    if (id !== reqRef.current) return            // superseded by a newer click
    if (!res) { setStatus('error'); setError(t('refine.err.failed')); return }
    if (!res.ok) {
      const code = await res.json().then(j => j?.error).catch(() => null)
      setStatus('error')
      setError(res.status === 401 ? t('refine.err.signin')
             : res.status === 429 ? t('refine.err.busy')
             : code === 'too_long' ? t('refine.err.long')
             : t('refine.err.failed'))
      return
    }
    const data = await res.json().catch(() => null)
    if (id !== reqRef.current) return
    const suggestion = String(data?.suggestion ?? '').trim()
    if (!suggestion) { setStatus('error'); setError(t('refine.err.failed')); return }
    setBase(asked)
    setDraft(suggestion)
    setAdded(Array.isArray(data?.added) ? data.added.filter((x: unknown) => typeof x === 'string') : [])
    setChanges(Array.isArray(data?.changes) ? data.changes.filter((x: unknown) => typeof x === 'string').slice(0, 3) : [])
    setStatus('preview')
  }

  const apply = () => {
    const next = draft.trim()
    if (!next) return
    setApplied({ previous: prompt, next })
    onApply(next)
    setStatus('idle')
  }
  const cancel = () => { setStatus('idle'); setError(null) }
  const undo = () => {
    if (!applied) return
    onApply(applied.previous)
    setApplied(null)
  }

  const action = (
    <span className="refine-action">
      <button type="button" className="btn-secondary refine-btn" onClick={ask} disabled={!canAsk} aria-busy={status === 'loading'}
              title={trimmed.length < MIN_CHARS ? t('refine.empty') : undefined}>
        <span className="refine-glyph" aria-hidden>✦</span>{status === 'loading' ? t('refine.loading') : t('refine.button')}
      </button>
      {applied && status === 'idle' && (
        <span className="refine-applied" role="status">
          {t('refine.applied')} <button type="button" className="refine-link" onClick={undo}>{t('refine.undo')}</button>
        </span>
      )}
      {status === 'error' && (
        <span className="refine-error" role="alert">
          {error} <button type="button" className="refine-link" onClick={ask} disabled={!canAsk}>{t('refine.retry')}</button>
        </span>
      )}
    </span>
  )

  const preview = status !== 'preview' ? null : (
        <div className="refine-panel" role="region" aria-label={t('refine.title')}>
          <div className="refine-label">{t('refine.title')}</div>
          <textarea ref={taRef} className="prompt-textarea refine-ta" rows={5} value={draft} onChange={e => setDraft(e.target.value)} maxLength={MAX_CHARS} />
          {changes.length > 0 && (
            <div className="refine-note">
              <span className="refine-cap">{t('refine.changes')}</span>
              <span className="refine-items">{changes.join(' · ')}</span>
            </div>
          )}
          {added.length > 0 && (
            <div className="refine-note">
              <span className="refine-cap">{t('refine.added')}</span>
              <span className="refine-items">{added.join(' · ')}</span>
            </div>
          )}
          {stale && <div className="refine-note refine-note--warn">{t('refine.stale')}</div>}
          <div className="refine-actions">
            <button type="button" className="btn-secondary refine-act refine-act--apply" onClick={apply} disabled={!draft.trim()}>{t('refine.apply')}</button>
            <button type="button" className="btn-secondary refine-act" onClick={cancel}>{t('refine.keep')}</button>
            <span className="refine-free">{t('refine.free')}</span>
          </div>
        </div>
  )

  return { action, preview }
}

/** Stacked form: button row, then the preview. Kept for callers that have
 *  no composer action row to put the button in. */
export default function PromptRefiner(props: Props) {
  const { action, preview } = usePromptRefiner(props)
  return (
    <div className="refine">
      <div className="refine-row">{action}</div>
      {preview}
    </div>
  )
}
