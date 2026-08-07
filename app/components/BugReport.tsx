'use client'
// app/components/BugReport.tsx — "Report a bug" (owner, Aug 7).
// Click captures the page AS IT LOOKS (before the modal opens, so the
// modal never photobombs), then a small form: screenshot preview the
// user can drop, a description box, and the contact address as
// click-to-copy — reports go to the feedback table, not to email.
// The capture is DOM-rendered (html-to-image, loaded on demand), so
// there's no scary screen-share permission prompt; if it fails the
// form still works without a screenshot.

import { useState } from 'react'
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

  const start = async () => {
    setErr(null); setSent(false); setDesc('')
    // Capture FIRST — the page as the user sees it, no modal in frame.
    try {
      const { toPng } = await import('html-to-image')
      const png = await toPng(document.body, {
        pixelRatio: 1,
        // The custom cursor overlay would photobomb every report.
        filter: (n: any) => !(n?.classList?.contains?.('cursor') || n?.classList?.contains?.('cursor-ring')),
      })
      setShot(png.length <= 4_500_000 ? png : null)
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
          <div onClick={e => e.stopPropagation()} style={{
            width: 'min(480px, 94vw)', background: 'var(--bg)', borderRadius: 14,
            border: '1px solid var(--border2)', padding: '20px 22px', boxShadow: '0 18px 60px rgba(0,0,0,0.25)',
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
                  <div style={{ position: 'relative', marginBottom: 12 }}>
                    <img src={shot} alt="" style={{ width: '100%', maxHeight: 180, objectFit: 'cover', objectPosition: 'top', borderRadius: 8, border: '1px solid var(--border)' }} />
                    <button
                      onClick={() => setShot(null)} aria-label="remove screenshot" title={t('fb.noshot')}
                      style={{ position: 'absolute', top: 6, right: 6, border: 'none', borderRadius: 999, width: 24, height: 24, background: 'rgba(0,0,0,0.55)', color: '#fff', cursor: 'pointer', fontSize: 12, lineHeight: 1 }}
                    >✕</button>
                  </div>
                )}
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
                  {t('fb.or')} <ContactEmail style={{ color: 'var(--muted)', fontWeight: 700 }} />
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
