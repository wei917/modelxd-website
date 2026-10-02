'use client'
// app/xcreate/VideoExportBar.tsx: a finished video, re-encoded to a
// platform's upload spec (phase 2, Oct 1). The server re-encodes it
// (/api/xcreate/export-video, lib/platform-video.ts), stores it, and answers
// with a one-hour link that downloads; the checks show under the button.
// Videos carry no AI marker a platform reads, so the note asks the user to
// tick the platform's own AI label.

import { useState } from 'react'
import { useLang } from '@/lib/i18n'
import { VIDEO_SPECS, DEFAULT_VIDEO_EXPORT_BY_LANG, type ExportCheck, type VideoSpecId } from '@/lib/platform-specs'
import { ExportChecks } from './ExportBar'

/** Ask for one video export and start its download. Shared with ConvertDialog. */
export async function runVideoExport(body: { spec: VideoSpecId; source: Record<string, unknown> }): Promise<{ url: string; checks: ExportCheck[] }> {
  const res = await fetch('/api/xcreate/export-video', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const d = await res.json().catch(() => null)
  if (!res.ok || !d?.url) throw new Error(d?.error ?? String(res.status))
  // Content-Disposition: attachment, so the page stays where it is.
  window.location.assign(d.url)
  return { url: d.url, checks: Array.isArray(d.checks) ? d.checks : [] }
}

export function VideoExportResult({ url, checks, ai }: { url: string; checks: ExportCheck[]; ai: boolean }) {
  const { t } = useLang()
  const short = checks.some(c => c.key === 'duration' && !c.ok)
  return (
    <>
      <ExportChecks checks={checks} />
      {short && <div style={{ fontSize: 12, color: 'var(--muted2)', lineHeight: 1.5 }}>{t('xc.export.shorthint')}</div>}
      <a href={url} style={{ fontSize: 12, color: 'var(--red)' }}>{t('xc.export.again')}</a>
      {ai && <div style={{ fontSize: 12, color: 'var(--muted2)', lineHeight: 1.5 }}>{t('xc.export.ainote.video')}</div>}
    </>
  )
}

export default function VideoExportBar({ rowId, slot }: { rowId: string; slot: number }) {
  const { lang, t } = useLang()
  const [spec, setSpec] = useState<VideoSpecId>(DEFAULT_VIDEO_EXPORT_BY_LANG[lang] ?? 'v-vertical')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ url: string; checks: ExportCheck[] } | null>(null)
  const [failed, setFailed] = useState(false)

  const go = async () => {
    if (busy) return
    setBusy(true); setFailed(false); setDone(null)
    try { setDone(await runVideoExport({ spec, source: { kind: 'slot', id: rowId, slot } })) }
    catch { setFailed(true) }
    finally { setBusy(false) }
  }

  return (
    <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--bg)' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, color: 'var(--muted2)', flex: '0 0 auto' }} htmlFor={`xc-vexport-${rowId}-${slot}`}>{t('xc.export.label')}</label>
        <select id={`xc-vexport-${rowId}-${slot}`} value={spec} disabled={busy}
          onChange={e => { setSpec(e.target.value as VideoSpecId); setDone(null); setFailed(false) }}
          style={{ flex: '1 1 150px', minWidth: 0, minHeight: 36, padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--surface)', color: 'var(--white)', fontSize: 13 }}>
          {VIDEO_SPECS.map(s => <option key={s.id} value={s.id}>{t(`vspec.${s.id}`)}</option>)}
        </select>
        <button type="button" onClick={() => void go()} disabled={busy}
          style={{ flex: '0 0 auto', minHeight: 36, padding: '6px 14px', borderRadius: 8, border: '1px solid var(--red)', background: 'transparent', color: 'var(--red)', fontWeight: 700, fontSize: 13, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1 }}>
          {busy ? t('xc.export.converting') : `⬇ ${t('xc.export.download')}`}
        </button>
      </div>
      {done && <VideoExportResult url={done.url} checks={done.checks} ai />}
      {failed && <div role="alert" style={{ fontSize: 12, color: 'var(--red)' }}>{t('xc.export.failed')}</div>}
    </div>
  )
}
