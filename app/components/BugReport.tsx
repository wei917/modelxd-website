'use client'
// app/components/BugReport.tsx — "Report a bug" (owner, Aug 7).
// Click captures the page AS IT LOOKS (before the modal opens, so the
// modal never photobombs), then a small form: screenshot preview the
// user can drop, a description box, and the contact address as
// click-to-copy — reports go to the feedback table, not to email.
// The capture is DOM-rendered (html-to-image, loaded on demand), so
// there's no scary screen-share permission prompt; if it fails the
// form still works without a screenshot.
//
// The page on screen is not always the one with the problem (owner,
// Sep 27), so the reporter can attach their own image instead: a button,
// paste, or drop, up to 10 MB (owner). It replaces the capture (one image
// per report). Whatever is sent is scaled down in the browser first: a
// Vercel function takes at most 4.5 MB of request, and base64 adds a third,
// so the image that travels stays under 3 MB.

import { useRef, useState } from 'react'

const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_SEND_BYTES = 3 * 1024 * 1024
const MAX_SIDE = 2000
const bytesOf = (dataUrl: string) => Math.floor((dataUrl.length - dataUrl.indexOf(',') - 1) * 3 / 4)

/** An image (a blob or data URL) → a PNG or JPEG data URL small enough to
 *  send, or null when the browser cannot decode it (HEIC outside Safari, a
 *  broken file). A PNG stays PNG when it fits; otherwise JPEG. */
async function fitImage(url: string, png: boolean): Promise<string | null> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url
    })
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(img.naturalWidth * scale)); c.height = Math.max(1, Math.round(img.naturalHeight * scale))
    const g = c.getContext('2d')
    if (!g) return null
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height)
    g.drawImage(img, 0, 0, c.width, c.height)
    const tries = png ? [() => c.toDataURL('image/png'), () => c.toDataURL('image/jpeg', 0.85), () => c.toDataURL('image/jpeg', 0.7)]
      : [() => c.toDataURL('image/jpeg', 0.85), () => c.toDataURL('image/jpeg', 0.7)]
    for (const make of tries) { const out = make(); if (bytesOf(out) <= MAX_SEND_BYTES) return out }
    return null
  } catch { return null }
}
async function imageToDataUrl(file: File): Promise<string | null> {
  const url = URL.createObjectURL(file)
  try { return await fitImage(url, file.type === 'image/png') } finally { URL.revokeObjectURL(url) }
}
import { useT } from '../../lib/i18n'
import ContactEmail from './ContactEmail'

export default function BugReportLink({ className, style }: { className?: string; style?: React.CSSProperties }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [shot, setShot] = useState<string | null>(null)
  const [desc, setDesc] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // 'page' = the capture of this page; 'yours' = an image the reporter attached.
  const [shotKind, setShotKind] = useState<'page' | 'yours'>('page')
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const attach = async (file: File | undefined | null) => {
    if (!file || !file.type.startsWith('image/')) return
    setErr(null)
    if (file.size > MAX_FILE_BYTES) { setErr(t('fb.tooBig')); return }
    const url = await imageToDataUrl(file)
    if (!url) { setErr(t('fb.badImage')); return }
    setShot(url); setShotKind('yours')
  }

  const start = async () => {
    setErr(null); setSent(false); setDesc(''); setShotKind('page'); setDragging(false)
    // Capture FIRST — the page as the user sees it, no modal in frame.
    try {
      const { toPng } = await import('html-to-image')
      const png = await toPng(document.body, {
        pixelRatio: 1,
        // The custom cursor overlay would photobomb every report.
        filter: (n: any) => !(n?.classList?.contains?.('cursor') || n?.classList?.contains?.('cursor-ring')),
      })
      setShot(bytesOf(png) <= MAX_SEND_BYTES ? png : await fitImage(png, true))
    } catch { setShot(null) }
    setOpen(true)
  }

  const send = async () => {
    if (busy || !desc.trim()) return
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: desc.trim(),
          page: location.pathname + location.search,
          screenshot: shot,
          context: {
            userAgent: navigator.userAgent,
            viewport: `${innerWidth}x${innerHeight}`,
            lang: document.documentElement.lang || '',
          },
        }),
      })
      const d = await res.json().catch(() => null)
      if (!res.ok) { setErr(d?.error ?? `HTTP ${res.status}`); setBusy(false); return }
      setSent(true); setBusy(false)
      setTimeout(() => { setOpen(false); setSent(false) }, 1600)
    } catch { setErr('Network error — try again.'); setBusy(false) }
  }

  return (
    <>
      <a href="#" className={className} style={style} onClick={e => { e.preventDefault(); void start() }}>
        {t('nav.bug')}
      </a>
      {open && (
        <div
          onClick={() => !busy && setOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 99500, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
        >
          <div onClick={e => e.stopPropagation()}
            onPaste={e => { const f = Array.from(e.clipboardData?.files ?? []).find(x => x.type.startsWith('image/')); if (f) { e.preventDefault(); void attach(f) } }}
            onDragOver={e => { if (Array.from(e.dataTransfer?.types ?? []).includes('Files')) { e.preventDefault(); setDragging(true) } }}
            onDragLeave={e => { if (e.currentTarget === e.target) setDragging(false) }}
            onDrop={e => { e.preventDefault(); setDragging(false); void attach(Array.from(e.dataTransfer?.files ?? []).find(x => x.type.startsWith('image/'))) }}
            style={{
            width: 'min(480px, 94vw)', background: 'var(--bg)', borderRadius: 14,
            border: `1px ${dragging ? 'dashed var(--red)' : 'solid var(--border2)'}`, padding: '20px 22px', boxShadow: '0 18px 60px rgba(0,0,0,0.25)',
          }}>
            <div style={{ fontSize: 16, fontWeight: 800, fontFamily: 'var(--font-display), inherit', marginBottom: 12 }}>
              🐞 {t('fb.title')}
            </div>
            {sent ? (
              <div style={{ padding: '26px 0', textAlign: 'center', fontSize: 15, fontWeight: 700, color: 'var(--green)' }}>
                ✓ {t('fb.sent')}
              </div>
            ) : (
              <>
                {shot && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 11.5, color: 'var(--muted2)', marginBottom: 4 }}>{t(shotKind === 'yours' ? 'fb.shotYours' : 'fb.shotPage')}</div>
                    <div style={{ position: 'relative' }}>
                      <img src={shot} alt="" style={{ width: '100%', maxHeight: 180, objectFit: shotKind === 'yours' ? 'contain' : 'cover', objectPosition: 'top', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)' }} />
                      <button
                        onClick={() => setShot(null)} aria-label={t('fb.noshot')} title={t('fb.noshot')}
                        style={{ position: 'absolute', top: 6, right: 6, border: 'none', borderRadius: 999, width: 24, height: 24, background: 'rgba(0,0,0,0.55)', color: '#fff', cursor: 'pointer', fontSize: 12, lineHeight: 1 }}
                      >✕</button>
                    </div>
                  </div>
                )}
                {/* Another image instead: button, paste or drop. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12, fontSize: 12, color: 'var(--muted2)' }}>
                  <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => { void attach(e.target.files?.[0]); e.target.value = '' }} />
                  <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
                    style={{ padding: '6px 12px', borderRadius: 999, border: '1px solid var(--border2)', background: 'none', color: 'var(--white)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                  >📎 {t(shot ? 'fb.replace' : 'fb.attach')}</button>
                  <span>{t('fb.attachHint')}</span>
                </div>
                <textarea
                  autoFocus value={desc} onChange={e => setDesc(e.target.value)}
                  placeholder={t('fb.ph')} maxLength={4000} rows={4}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1.5px solid var(--border2)', background: 'var(--surface)', color: 'var(--white)', fontSize: 13.5, fontFamily: 'inherit', outline: 'none', resize: 'vertical' }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
                  <button
                    onClick={send} disabled={busy || !desc.trim()}
                    style={{ padding: '9px 22px', borderRadius: 999, border: 'none', background: 'var(--red)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: busy || !desc.trim() ? 0.5 : 1 }}
                  >{busy ? '…' : t('fb.send')}</button>
                  <button
                    onClick={() => setOpen(false)} disabled={busy}
                    style={{ padding: '9px 16px', borderRadius: 999, border: '1px solid var(--border2)', background: 'none', color: 'var(--muted)', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}
                  >{t('fb.cancel')}</button>
                </div>
                {err && <div style={{ marginTop: 10, color: 'var(--red)', fontSize: 12.5 }}>⚠ {err}</div>}
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--muted2)' }}>
                  {t('fb.or')} <ContactEmail plain style={{ color: 'var(--muted)', fontWeight: 700 }} />
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
