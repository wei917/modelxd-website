'use client'
// app/xcreate/ExportBar.tsx: download a generated picture in a platform's
// exact upload spec (owner, Oct 1: "make photo ... taobao compliant, or
// make social platform compliant"). The server does the work
// (/api/xcreate/export, lib/platform-export.ts) and says what it checked;
// the list under the button shows each check, a miss included.
//
// The file comes back through fetch and is saved from a blob: URL, which is
// same-origin, so `download` works on phones (a cross-origin link would just
// open the picture; Common Pitfalls 12).

import { useState } from 'react'
import { useLang } from '@/lib/i18n'
import { EXPORT_SPECS, DEFAULT_EXPORT_BY_LANG, type ExportCheck, type ExportSpecId } from '@/lib/platform-specs'

export default function ExportBar({ rowId, slot, count = 1, preferred }: {
  rowId: string
  slot: number
  /** Pictures in the slot (count > 1 runs); each can be exported. */
  count?: number
  preferred?: ExportSpecId | null
}) {
  const { lang, t } = useLang()
  const [spec, setSpec] = useState<ExportSpecId>(preferred ?? DEFAULT_EXPORT_BY_LANG[lang] ?? 'amazon')
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [checks, setChecks] = useState<ExportCheck[] | null>(null)
  const [failed, setFailed] = useState(false)

  const download = async () => {
    if (busy) return
    setBusy(true); setFailed(false); setChecks(null)
    try {
      const res = await fetch(`/api/xcreate/export?id=${encodeURIComponent(rowId)}&slot=${slot}&i=${index}&spec=${spec}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      const blob = await res.blob()
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? `${spec}.jpg`
      const href = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = href; a.download = name
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(href), 15_000)
      try { setChecks(JSON.parse(decodeURIComponent(res.headers.get('X-Export-Checks') ?? '[]'))) } catch { setChecks([]) }
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  const label: Record<ExportCheck['key'], string> = {
    size: t('xc.export.size'), format: t('xc.export.format'), bytes: t('xc.export.bytes'), white: t('xc.export.white'),
  }
  const whiteMissed = checks?.some(c => c.key === 'white' && !c.ok)

  return (
    <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, color: 'var(--muted2)', flex: '0 0 auto' }} htmlFor={`xc-export-${rowId}-${slot}`}>{t('xc.export.label')}</label>
        <select
          id={`xc-export-${rowId}-${slot}`}
          value={spec}
          onChange={e => { setSpec(e.target.value as ExportSpecId); setChecks(null); setFailed(false) }}
          style={{ flex: '1 1 150px', minWidth: 0, minHeight: 36, padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--surface)', color: 'var(--white)', fontSize: 13 }}
        >
          {EXPORT_SPECS.map(s => <option key={s.id} value={s.id}>{t(`spec.${s.id}`)}</option>)}
        </select>
        {count > 1 && (
          <select value={index} onChange={e => { setIndex(Number(e.target.value)); setChecks(null) }} aria-label={t('xc.export.which')}
            style={{ flex: '0 0 auto', minHeight: 36, padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--surface)', color: 'var(--white)', fontSize: 13 }}>
            {Array.from({ length: count }, (_, k) => <option key={k} value={k}>#{k + 1}</option>)}
          </select>
        )}
        <button type="button" onClick={() => void download()} disabled={busy}
          style={{ flex: '0 0 auto', minHeight: 36, padding: '6px 14px', borderRadius: 8, border: '1px solid var(--red)', background: 'transparent', color: 'var(--red)', fontWeight: 700, fontSize: 13, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1 }}>
          ⬇ {t('xc.export.download')}
        </button>
      </div>
      {checks && checks.length > 0 && (
        <div style={{ display: 'flex', gap: '4px 12px', flexWrap: 'wrap', fontSize: 12 }}>
          {checks.map(c => (
            <span key={c.key} style={{ color: c.ok ? 'var(--green)' : 'var(--red)' }}>{c.ok ? '✓' : '✗'} {label[c.key]} {c.value}</span>
          ))}
        </div>
      )}
      {whiteMissed && <div style={{ fontSize: 12, color: 'var(--muted2)', lineHeight: 1.5 }}>{t('xc.export.whitehint')}</div>}
      {failed && <div role="alert" style={{ fontSize: 12, color: 'var(--red)' }}>{t('xc.export.failed')}</div>}
    </div>
  )
}
