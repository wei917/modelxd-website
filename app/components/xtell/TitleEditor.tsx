'use client'
// app/components/xtell/TitleEditor.tsx — rename a saved visit in place (owner,
// Sep 28). Enter or 儲存 keeps it, Esc or 取消 leaves it as it was; an empty
// name goes back to the automatic title (lib/xtell-history.ts cleanTitle).

import { useEffect, useRef, useState } from 'react'
import { useT } from '../../../lib/i18n'
import { TITLE_MAX } from '../../../lib/xtell-history'

export function TitleEditor({ value, onSave, onCancel }: { value: string; onSave: (title: string) => Promise<boolean>; onCancel: () => void }) {
  const t = useT()
  const [text, setText] = useState(value)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { input.current?.focus(); input.current?.select() }, [])
  const save = async () => {
    if (busy) return
    setBusy(true); setFailed(false)
    const ok = await onSave(text)
    setBusy(false)
    if (!ok) setFailed(true)
  }
  return (
    <form className="xtell-rename" onSubmit={e => { e.preventDefault(); void save() }}>
      <input ref={input} value={text} maxLength={TITLE_MAX * 2} onChange={e => setText(e.target.value)} placeholder={t('xtell.saved.renamePh')}
        aria-label={t('xtell.saved.rename')} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); onCancel() } }} disabled={busy} />
      <button type="submit" className="xtell-rename-save" disabled={busy}>{t('xtell.saved.renameSave')}</button>
      <button type="button" className="xtell-rename-cancel" onClick={onCancel} disabled={busy}>{t('xtell.saved.renameCancel')}</button>
      {failed && <span role="alert">{t('xtell.saved.renameFailed')}</span>}
    </form>
  )
}
