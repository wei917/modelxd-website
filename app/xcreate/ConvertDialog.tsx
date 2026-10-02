'use client'
// app/xcreate/ConvertDialog.tsx: "your photo / your video → a platform's
// spec" with no model involved (phase 2, Oct 1; owner: "make photo/video
// taobao compliant"). The file is uploaded to the user's own folder (the
// normal attachment path), converted on our server (pictures:
// /api/xcreate/export?upload=, videos: /api/xcreate/export-video), and
// downloaded, with the checks shown. Free: nothing is billed. It is the
// user's own file, so no AI marker and no AI reminder.

import { useRef, useState } from 'react'
import { useLang } from '@/lib/i18n'
import { createSupabaseBrowser } from '@/lib/supabase-client'
import { pendingAttachment, commitAttachments } from '../components/AttachmentButton'
import { EXPORT_SPECS, VIDEO_SPECS, DEFAULT_EXPORT_BY_LANG, DEFAULT_VIDEO_EXPORT_BY_LANG, type ExportCheck } from '@/lib/platform-specs'
import { downloadPictureExport, ExportChecks } from './ExportBar'
import { runVideoExport, VideoExportResult } from './VideoExportBar'

const MAX_BYTES = { image: 25_000_000, video: 300_000_000 }

export default function ConvertDialog({ kind, onClose, onSignIn }: {
  kind: 'image' | 'video'
  onClose: () => void
  onSignIn: () => void
}) {
  const { lang, t } = useLang()
  const specs = kind === 'image' ? EXPORT_SPECS : VIDEO_SPECS
  const [spec, setSpec] = useState<string>(kind === 'image' ? (DEFAULT_EXPORT_BY_LANG[lang] ?? 'amazon') : (DEFAULT_VIDEO_EXPORT_BY_LANG[lang] ?? 'v-vertical'))
  const [file, setFile] = useState<File | null>(null)
  const [stage, setStage] = useState<'idle' | 'uploading' | 'converting' | 'done' | 'error'>('idle')
  const [problem, setProblem] = useState<string | null>(null)
  const [checks, setChecks] = useState<ExportCheck[]>([])
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  // One upload per chosen file: a second platform reuses it.
  const uploaded = useRef<{ file: File; path: string } | null>(null)

  const busy = stage === 'uploading' || stage === 'converting'

  const go = async () => {
    if (!file || busy) return
    const { data } = await createSupabaseBrowser().auth.getUser()
    if (!data.user) { onSignIn(); return }
    if (file.size > MAX_BYTES[kind]) { setProblem(t('xc.convert.toobig')); setStage('error'); return }
    setProblem(null); setChecks([]); setVideoUrl(null)
    try {
      let path = uploaded.current?.file === file ? uploaded.current.path : null
      if (!path) {
        setStage('uploading')
        const [att] = await commitAttachments([pendingAttachment(file, 'xcreate')])
        path = att.storagePath
        uploaded.current = { file, path }
      }
      setStage('converting')
      if (kind === 'image') {
        setChecks(await downloadPictureExport(`upload=${encodeURIComponent(path)}&spec=${spec}`, `${spec}.jpg`))
      } else {
        const r = await runVideoExport({ spec: spec as any, source: { kind: 'upload', path } })
        setChecks(r.checks); setVideoUrl(r.url)
      }
      setStage('done')
    } catch {
      setProblem(t('xc.export.failed')); setStage('error')
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={t('xc.convert.title')}
      onClick={() => { if (!busy) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: 12 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: 'min(480px, 100%)', maxHeight: '90vh', overflow: 'auto', background: 'var(--bg)', borderRadius: 16, border: '1px solid var(--border2)', padding: '18px 18px 20px', display: 'flex', flexDirection: 'column', gap: 12, boxShadow: '0 12px 40px rgba(0,0,0,0.25)', marginBottom: 'max(0px, env(safe-area-inset-bottom))' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--white)' }}>{t(kind === 'image' ? 'xct.convert.image.title' : 'xct.convert.video.title')}</div>
            <div style={{ fontSize: 13, color: 'var(--muted2)', marginTop: 4, lineHeight: 1.5 }}>{t('xc.convert.sub')}</div>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label={t('xc.convert.close')}
            style={{ border: 'none', background: 'none', fontSize: 20, lineHeight: 1, color: 'var(--muted2)', cursor: 'pointer', padding: 4 }}>✕</button>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: 'var(--white)', fontWeight: 600 }}>
          {t(kind === 'image' ? 'xc.convert.pick.image' : 'xc.convert.pick.video')}
          <input type="file" accept={kind === 'image' ? 'image/jpeg,image/png,image/webp' : 'video/mp4,video/quicktime,video/webm'} disabled={busy}
            onChange={e => { setFile(e.target.files?.[0] ?? null); setStage('idle'); setProblem(null); setChecks([]); setVideoUrl(null) }}
            style={{ fontSize: 13, fontWeight: 400 }} />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: 'var(--white)', fontWeight: 600 }}>
          {t('xc.export.label')}
          <select value={spec} disabled={busy} onChange={e => { setSpec(e.target.value); setStage('idle'); setChecks([]); setVideoUrl(null) }}
            style={{ minHeight: 40, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--surface)', color: 'var(--white)', fontSize: 14, fontWeight: 400 }}>
            {specs.map(s => <option key={s.id} value={s.id}>{t(`${kind === 'image' ? 'spec' : 'vspec'}.${s.id}`)}</option>)}
          </select>
        </label>

        <button type="button" onClick={() => void go()} disabled={!file || busy}
          style={{ minHeight: 44, borderRadius: 10, border: 'none', background: 'var(--red)', color: '#fff', fontWeight: 700, fontSize: 15, cursor: !file || busy ? 'default' : 'pointer', opacity: !file || busy ? 0.55 : 1 }}>
          {stage === 'uploading' ? t('xc.convert.uploading') : stage === 'converting' ? t('xc.export.converting') : `⬇ ${t('xc.convert.go')}`}
        </button>

        {stage === 'done' && (kind === 'video' && videoUrl
          ? <VideoExportResult url={videoUrl} checks={checks} ai={false} />
          : <ExportChecks checks={checks} />)}
        {problem && <div role="alert" style={{ fontSize: 13, color: 'var(--red)' }}>{problem}</div>}
      </div>
    </div>
  )
}
