'use client'
// TGS 2026 game gallery: image-led, Japanese first (English fallback for the
// other locales). Each work opens a lightbox with the generation prompt, a
// copy button and two real actions: an XDuel image duel prefilled with the
// prompt, and XDirect with the prompt in its composer. Neither auto-submits.
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useLang } from '../../lib/i18n'
import { TGS_WORKS, pick, type TgsWork } from './works'

const duelHref   = (p: string) => `/xduel?mode=image&q=${encodeURIComponent(p)}`
const directHref = (p: string) => `/xdirect?q=${encodeURIComponent(p)}`

export default function TgsClient() {
  const { lang, t } = useLang()
  const [open, setOpen] = useState<TgsWork | null>(null)
  const [copied, setCopied] = useState(false)
  const [broken, setBroken] = useState<Record<string, boolean>>({})
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    setCopied(false)
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null) }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open])

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { /* clipboard blocked */ }
  }
  const markBroken = (slug: string) => setBroken(b => ({ ...b, [slug]: true }))

  return (
    <div className="xduel-page">
      <div className="arena tgs-arena">
        <div className="prompt-label eyebrow">{t('tgs.eyebrow')}</div>
        <h1 className="page-headline" style={{ marginBottom: 10 }}>{t('tgs.title')}</h1>
        <p className="tgs-sub">{t('tgs.sub')}</p>

        <div className="tgs-grid">
          {TGS_WORKS.map(w => (
            <button key={w.slug} type="button" className="tgs-card" onClick={() => setOpen(w)}>
              <span className="tgs-card-img">
                {broken[w.slug]
                  ? <span className="tgs-img-fallback">{pick(w.title, lang)}</span>
                  : <img src={w.thumb} alt={pick(w.alt, lang)} loading="lazy" onError={() => markBroken(w.slug)} />}
                <span className="tgs-badge">{t('tgs.badge')}</span>
              </span>
              <span className="tgs-card-body">
                <span className="tgs-card-title">{pick(w.title, lang)}</span>
                <span className="tgs-card-ref">{pick(w.reference, lang)}</span>
              </span>
            </button>
          ))}
        </div>

        <p className="tgs-note">{t('tgs.note')}</p>
      </div>

      {open && (
        <div className="tgs-lightbox" role="dialog" aria-modal="true" aria-label={pick(open.title, lang)}
             onClick={e => { if (e.target === e.currentTarget) setOpen(null) }}>
          <div className="tgs-lb-card">
            <button ref={closeRef} type="button" className="tgs-lb-close" onClick={() => setOpen(null)} aria-label={t('tgs.close')}>✕</button>
            <div className="tgs-lb-img">
              {broken[open.slug]
                ? <span className="tgs-img-fallback">{pick(open.title, lang)}</span>
                : <img src={open.image} alt={pick(open.alt, lang)} onError={() => markBroken(open.slug)} />}
            </div>
            <div className="tgs-lb-body">
              <span className="tgs-badge tgs-badge--inline">{t('tgs.badge')}</span>
              <h2 className="tgs-lb-title">{pick(open.title, lang)}</h2>
              <p className="tgs-lb-ref">{pick(open.reference, lang)}</p>
              {open.prompt ? (
                <>
                  <div className="tgs-lb-label">{t('tgs.prompt')}</div>
                  <pre className="tgs-lb-prompt">{open.prompt}</pre>
                  <div className="tgs-lb-actions">
                    <Link href={duelHref(open.prompt)} className="tgs-btn tgs-btn--primary">{t('tgs.duel')}</Link>
                    <button type="button" className="tgs-btn" onClick={() => void copy(open.prompt)}>{copied ? t('tgs.copied') : t('tgs.copy')}</button>
                    <Link href={directHref(open.prompt)} className="tgs-btn">{t('tgs.direct')}</Link>
                  </div>
                  <p className="tgs-lb-hint">{t('tgs.duel.hint')}</p>
                </>
              ) : (
                <p className="tgs-lb-hint">{t('tgs.prompt.pending')}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
