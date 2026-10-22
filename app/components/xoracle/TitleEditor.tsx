'use client'
// app/components/xoracle/TitleEditor.tsx — rename a saved visit in place (owner,
// Sep 28). Enter or 儲存 keeps it, Esc or 取消 leaves it as it was; an empty
// name goes back to the automatic title (lib/xoracle-history.ts cleanTitle).

import { useEffect, useRef, useState } from 'react'
import { useT } from '../../../lib/i18n'
import { TITLE_MAX } from '../../../lib/xoracle-history'

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
    <form className="xoracle-rename" onSubmit={e => { e.preventDefault(); void save() }}>
      <input ref={input} value={text} maxLength={TITLE_MAX * 2} onChange={e => setText(e.target.value)} placeholder={t('xoracle.saved.renamePh')}
        aria-label={t('xoracle.saved.rename')} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); onCancel() } }} disabled={busy} />
      <button type="submit" className="xoracle-rename-save" disabled={busy}>{t('xoracle.saved.renameSave')}</button>
      <button type="button" className="xoracle-rename-cancel" onClick={onCancel} disabled={busy}>{t('xoracle.saved.renameCancel')}</button>
      {failed && <span role="alert">{t('xoracle.saved.renameFailed')}</span>}
    </form>
  )
}
