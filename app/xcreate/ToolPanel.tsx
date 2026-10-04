'use client'
// app/xcreate/ToolPanel.tsx: one tool's own panel (Oct 3; owner: "blackbox
// mode that we control, which is what Pollo.ai does"). A photo, the tool's
// few choices, and Create; the prompt and model are the tool's
// (lib/xcreate-tools.ts). The run is an ordinary /api/xcreate run (credit
// check, list-price billing, the call log, a row in My works, saved under
// the tool's name), polled at /api/xcreate/job/<id> like the studio's. For
// the beta the panel names the model and its price (owner: "we show more
// information at the first beta version"). Phone: full screen; wider: a
// centered panel.

import { useEffect, useRef, useState } from 'react'
import { useLang } from '@/lib/i18n'
import { createSupabaseBrowser } from '@/lib/supabase-client'
import { pendingAttachment, commitAttachments, type Attachment } from '../components/AttachmentButton'
import { downloadFile, downloadName } from '@/lib/download'
import { perImageRate, formatUsd } from '@/lib/model-facts'
import { nearestRatio, type XTool, type ToolChoice } from '@/lib/xcreate-tools'

const MAX_BYTES = 20_000_000
const POLL_MS = 2500
const GIVE_UP_MS = 6 * 60_000

type ModelRow = { id: string; display_name: string; model_pricing: any }
type Stage = 'idle' | 'uploading' | 'running' | 'done' | 'error'
type Problem = { msg: string; credits?: boolean }

const uuid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
  ? crypto.randomUUID()
  : `${Date.now()}-${Math.random().toString(36).slice(2)}`
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export default function ToolPanel({ tool, onClose, onSignIn }: {
  tool: XTool
  onClose: () => void
  /** Not signed in at Create: the door's sign-in dialog. */
  onSignIn: () => void
}) {
  const { t } = useLang()
  const [model, setModel] = useState<ModelRow | null>(null)
  const [att, setAtt] = useState<Attachment | null>(null)
  const [ratio, setRatio] = useState<string | null>(null)
  const [choice, setChoice] = useState<ToolChoice | null>(tool.choices?.[0] ?? null)
  const [text, setText] = useState('')
  const [stage, setStage] = useState<Stage>('idle')
  const [secs, setSecs] = useState(0)
  const [problem, setProblem] = useState<Problem | null>(null)
  const [result, setResult] = useState<{ url: string; rowId: string } | null>(null)
  const [view, setView] = useState<'after' | 'before'>('after')
  const fileRef = useRef<HTMLInputElement | null>(null)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const busy = stage === 'uploading' || stage === 'running'
  const name = t(`xtool.${tool.id}.name`)

  // The model row: its id for the run, its name and list price for the line.
  useEffect(() => {
    createSupabaseBrowser().from('ai_models')
      .select('id, display_name, model_pricing')
      .eq('model_name', tool.model).eq('enabled', true).maybeSingle()
      .then(({ data }) => { if (alive.current) setModel((data as ModelRow | null) ?? null) })
  }, [tool.model])

  // Esc closes (not mid-run), and the page under the panel stays put.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [busy, onClose])

  // Seconds on the clock while a run is under way.
  useEffect(() => {
    if (!busy) return
    const started = Date.now()
    setSecs(0)
    const id = setInterval(() => setSecs(Math.round((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(id)
  }, [busy])

  const size = choice?.size ?? tool.size
  const price = model ? perImageRate(model.model_pricing?.per_image, null, size) : null
  const needsText = !!tool.text?.required && !text.trim()
  const canRun = !!att && !!model && !busy && !needsText

  const pick = (f: File | undefined) => {
    if (!f || !f.type.startsWith('image/')) return
    if (f.size > MAX_BYTES) { setProblem({ msg: t('xtools.toobig') }); return }
    setProblem(null); setResult(null); setStage('idle'); setView('after')
    const a = pendingAttachment(f, 'xcreate')
    setAtt(a)
    // The photo keeps its own shape unless the tool fixes one.
    setRatio(null)
    if (a.previewUrl) {
      const img = new Image()
      img.onload = () => { if (alive.current) setRatio(nearestRatio(img.naturalWidth, img.naturalHeight)) }
      img.src = a.previewUrl
    }
  }

  const run = async () => {
    if (!att || !model || busy || needsText) return
    const { data } = await createSupabaseBrowser().auth.getUser()
    if (!data.user) { onSignIn(); return }
    setProblem(null); setResult(null); setView('after')
    try {
      setStage('uploading')
      const [up] = await commitAttachments([att])
      if (!alive.current) return
      setAtt(up)  // uploaded once; Run again reuses it
      setStage('running')
      const jobId = uuid(), rowId = uuid()
      let refused: Problem | null = null
      // The POST runs for the whole generation; progress comes from the job
      // poller, as in the studio. Only a refusal before any model ran (402,
      // a bad request) answers here; a gateway timeout means the run goes on.
      fetch('/api/xcreate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId, rowId, mode: 'image',
          prompt: tool.prompt({ choice, text }),
          title: name,
          modelIds: [model.id],
          modelOptions: [{
            mode: 'image_edit', size, quality: null, count: 1, watermark: false,
            aspect_ratio: choice?.aspect ?? tool.aspect ?? ratio,
          }],
          attachments: [{ storagePath: up.storagePath, bucket: up.bucket, mediaType: up.mediaType, fileName: up.fileName, fileSize: up.fileSize }],
        }),
      }).then(async res => {
        if (res.ok || res.status === 502 || res.status === 504 || res.status === 524) return
        const d = await res.json().catch(() => null)
        refused = res.status === 402
          ? { msg: t('xtools.credits'), credits: true }
          : { msg: d?.message ?? d?.error ?? t('xtools.failed') }
      }).catch(() => { refused = { msg: t('xtools.failed') } })

      const started = Date.now()
      while (alive.current && Date.now() - started < GIVE_UP_MS) {
        await sleep(POLL_MS)
        if (refused) throw refused
        const res = await fetch(`/api/xcreate/job/${jobId}`, { cache: 'no-store' }).catch(() => null)
        if (!res || !res.ok) continue  // 404 until the job row exists
        const d = await res.json().catch(() => null)
        const slot = d?.slots?.[0]
        if (slot?.done || d?.job?.status === 'completed') {
          const url = typeof slot?.text === 'string' ? slot.text.split('\n').find(Boolean) : null
          if (slot?.error || !url) throw { msg: slot?.error ?? t('xtools.failed') }
          if (!alive.current) return
          setResult({ url, rowId: d?.job?.xcreateId ?? rowId })
          setStage('done')
          // My works under the studio refreshes to show it.
          window.dispatchEvent(new CustomEvent('xcreate:works-changed'))
          return
        }
        if (d?.job?.status === 'failed') throw { msg: slot?.error ?? t('xtools.failed') }
      }
      if (alive.current) throw { msg: t('xtools.failed') }
    } catch (e) {
      if (!alive.current) return
      const p = e as Partial<Problem> | null
      setProblem(p && typeof p.msg === 'string' ? { msg: p.msg, credits: !!p.credits } : { msg: t('xtools.failed') })
      setStage('error')
    }
  }

  const shown = result && view === 'after' ? result.url : att?.previewUrl ?? null

  return (
    <div className="xtool-overlay" role="dialog" aria-modal="true" aria-label={name}
      onClick={() => { if (!busy) onClose() }}>
      <div className="xtool-panel" onClick={e => e.stopPropagation()}>
        <header className="xtool-head">
          <div>
            <h2>{name}</h2>
            <p>{t(`xtool.${tool.id}.sub`)}</p>
          </div>
          <button type="button" className="xtool-x" onClick={onClose} disabled={busy} aria-label={t('xtools.close')}>✕</button>
        </header>

        <div className="xtool-stage">
          {shown
            ? <img src={shown} alt="" />
            : (
              <button type="button" className="xtool-upload" onClick={() => fileRef.current?.click()}>
                <b aria-hidden>+</b>
                {t('xtools.pick')}
              </button>
            )}
          {busy && (
            <div className="xtool-busy" aria-live="polite">
              <span className="xtool-spinner" aria-hidden />
              {t(stage === 'uploading' ? 'xtools.uploading' : 'xtools.running')} {secs > 0 ? `${secs}s` : ''}
            </div>
          )}
        </div>

        {result && (
          <div className="xtool-toggle" role="group">
            <button type="button" aria-pressed={view === 'before'} onClick={() => setView('before')}>{t('xtools.before')}</button>
            <button type="button" aria-pressed={view === 'after'} onClick={() => setView('after')}>{t('xtools.after')}</button>
          </div>
        )}

        {att && !busy && (
          <button type="button" className="xtool-change" onClick={() => fileRef.current?.click()}>{t('xtools.change')}</button>
        )}

        {tool.choices && (
          <div className="xtool-chips" role="radiogroup" aria-label={name}>
            {tool.choices.map(c => (
              <button key={c.id} type="button" role="radio" aria-checked={choice?.id === c.id} disabled={busy}
                className={`xtool-chip${choice?.id === c.id ? ' is-on' : ''}`} onClick={() => setChoice(c)}>
                {t(`xtool.${tool.id}.${c.id}`)}
              </button>
            ))}
          </div>
        )}

        {tool.text && (
          <label className="xtool-field">
            {t(`xtool.${tool.id}.text`)}
            <input type="text" value={text} maxLength={tool.text.max} disabled={busy}
              placeholder={t(`xtool.${tool.id}.textph`)} onChange={e => setText(e.target.value)} />
            {tool.text.presets && (
              <span className="xtool-chips">
                {tool.text.presets.map(p => {
                  const words = t(`xtool.${tool.id}.p.${p}`)
                  return (
                    <button key={p} type="button" disabled={busy}
                      className={`xtool-chip${text === words ? ' is-on' : ''}`} onClick={() => setText(words)}>
                      {words}
                    </button>
                  )
                })}
              </span>
            )}
          </label>
        )}

        {problem && (
          <p className="xtool-problem" role="alert">
            {problem.msg}
            {problem.credits && <a href="/profile">{t('xtools.addcredit')}</a>}
          </p>
        )}

        <div className="xtool-actions">
          {result ? (
            <>
              <button type="button" className="xtool-primary" onClick={() => void downloadFile(result.url, downloadName(result.url, 'image'))}>{t('xtools.download')}</button>
              <button type="button" className="xtool-secondary" onClick={() => void run()} disabled={!canRun}>{t('xtools.again')}</button>
              <a className="xtool-secondary" href={`/?id=${encodeURIComponent(result.rowId)}`}>{t('xtools.open')}</a>
            </>
          ) : (
            <button type="button" className="xtool-primary" onClick={() => void run()} disabled={!canRun}>
              {busy ? t(stage === 'uploading' ? 'xtools.uploading' : 'xtools.running') : t('xtools.run')}
            </button>
          )}
        </div>

        {model && (
          <p className="xtool-info">
            {t('xtools.madewith').replace('{model}', model.display_name).replace('{price}', price != null ? `${formatUsd(price)}${t('xcs.unit.image')}` : '')}
          </p>
        )}
        <p className="xtool-note">{t('xtools.note')}</p>

        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden
          onChange={e => { pick(e.target.files?.[0]); e.target.value = '' }} />
      </div>
    </div>
  )
}
