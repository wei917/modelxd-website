'use client'
// ModelXD Playground: tool entrances, four artworks and two scenario presets.
// Each item opens a detail panel with an EDITABLE image prompt and a separate
// motion prompt; the two actions open XDuel (image duel, prefilled) and
// XDirect (film, prefilled). Nothing here auto-submits, and sign-in, quotas
// and charges stay exactly as on those pages. No video playback: the film
// action is a real tool entrance, not a sample.
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useLang } from '../../lib/i18n'
import { PG_ARTWORKS, PG_PRESETS, pick, imagePromptOf, type PgItem } from './works'

const duelHref   = (p: string) => `/xduel?mode=image&q=${encodeURIComponent(p)}`
const directHref = (p: string) => `/xdirect?q=${encodeURIComponent(p)}`

function Detail({ item, lang, t, onClose }: { item: PgItem; lang: string; t: (k: string) => string; onClose: () => void }) {
  const img0 = imagePromptOf(item, lang)
  const vid0 = pick(item.videoPrompt, lang)
  const [img, setImg] = useState(img0)
  const [vid, setVid] = useState(vid0)
  const [copied, setCopied] = useState<'img' | 'vid' | null>(null)
  const [broken, setBroken] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])

  const copy = async (which: 'img' | 'vid', text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(which); setTimeout(() => setCopied(null), 1800) } catch { /* clipboard blocked */ }
  }
  const changed = img !== img0 || vid !== vid0
  const badge = item.kind === 'artwork' && !item.original ? t('pg.badge.fan') : t('pg.badge.original')

  return (
    <div className="pg-lightbox" role="dialog" aria-modal="true" aria-label={pick(item.title, lang)}
         onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="pg-lb-card">
        <button ref={closeRef} type="button" className="pg-lb-close" onClick={onClose} aria-label={t('pg.close')}>✕</button>
        <div className="pg-lb-img">
          {item.kind === 'artwork' && !broken
            ? <img src={item.image} alt={pick(item.alt, lang)} onError={() => setBroken(true)} />
            : <span className="pg-lb-emoji" aria-hidden>{item.kind === 'preset' ? item.emoji : pick(item.title, lang)}</span>}
        </div>
        <div className="pg-lb-body">
          <span className="pg-badge pg-badge--inline">{badge}</span>
          <h2 className="pg-lb-title">{pick(item.title, lang)}</h2>
          <p className="pg-lb-ref">{item.kind === 'artwork' ? pick(item.reference, lang) : pick(item.blurb, lang)}</p>

          <label className="pg-lb-label" htmlFor="pg-img-prompt">{t('pg.prompt.image')}</label>
          <textarea id="pg-img-prompt" className="pg-textarea" rows={6} value={img} onChange={e => setImg(e.target.value)} />
          <div className="pg-lb-actions">
            <Link href={duelHref(img)} className="pg-btn pg-btn--primary">{t('pg.act.duel')}</Link>
            <button type="button" className="pg-btn" onClick={() => void copy('img', img)}>{copied === 'img' ? t('pg.copied') : t('pg.copy')}</button>
          </div>

          <label className="pg-lb-label" htmlFor="pg-vid-prompt">{t('pg.prompt.video')}</label>
          <textarea id="pg-vid-prompt" className="pg-textarea" rows={4} value={vid} onChange={e => setVid(e.target.value)} />
          <div className="pg-lb-actions">
            <Link href={directHref(vid)} className="pg-btn pg-btn--primary">{t('pg.act.video')}</Link>
            <button type="button" className="pg-btn" onClick={() => void copy('vid', vid)}>{copied === 'vid' ? t('pg.copied') : t('pg.copy')}</button>
            {changed && <button type="button" className="pg-btn pg-btn--quiet" onClick={() => { setImg(img0); setVid(vid0) }}>{t('pg.reset')}</button>}
          </div>
          <p className="pg-lb-hint">{t('pg.hint')}</p>
        </div>
      </div>
    </div>
  )
}

export default function PlaygroundClient() {
  const { lang, t } = useLang()
  const [open, setOpen] = useState<PgItem | null>(null)
  const [broken, setBroken] = useState<Record<string, boolean>>({})
  const markBroken = (slug: string) => setBroken(b => ({ ...b, [slug]: true }))

  return (
    <div className="xduel-page">
      <div className="arena pg-arena">
        <div className="prompt-label eyebrow">{t('pg.eyebrow')}</div>
        <h1 className="page-headline" style={{ marginBottom: 10 }}>{t('pg.title')}</h1>
        <p className="pg-sub">{t('pg.sub')}</p>

        <div className="pg-tools">
          <Link href="/xduel?mode=image" className="pg-tool">
            <span className="pg-tool-cap">IMAGE</span>
            <span className="pg-tool-title">{t('pg.tool.image')}</span>
            <span className="pg-tool-sub">{t('pg.tool.image.sub')}</span>
          </Link>
          <Link href="/xdirect" className="pg-tool">
            <span className="pg-tool-cap">VIDEO</span>
            <span className="pg-tool-title">{t('pg.tool.video')}</span>
            <span className="pg-tool-sub">{t('pg.tool.video.sub')}</span>
          </Link>
          <Link href="/xboard" className="pg-tool">
            <span className="pg-tool-cap">COMPARE</span>
            <span className="pg-tool-title">{t('pg.tool.compare')}</span>
            <span className="pg-tool-sub">{t('pg.tool.compare.sub')}</span>
          </Link>
        </div>

        <h2 className="pg-section">{t('pg.section.works')}</h2>
        <div className="pg-grid">
          {PG_ARTWORKS.map(w => (
            <button key={w.slug} type="button" className="pg-card" onClick={() => setOpen(w)}>
              <span className="pg-card-img">
                {broken[w.slug]
                  ? <span className="pg-img-fallback">{pick(w.title, lang)}</span>
                  : <img src={w.thumb} alt={pick(w.alt, lang)} loading="lazy" onError={() => markBroken(w.slug)} />}
                <span className="pg-badge">{w.original ? t('pg.badge.original') : t('pg.badge.fan')}</span>
              </span>
              <span className="pg-card-body">
                <span className="pg-card-title">{pick(w.title, lang)}</span>
                <span className="pg-card-ref">{pick(w.reference, lang)}</span>
                <span className="pg-card-open">{t('pg.open')} →</span>
              </span>
            </button>
          ))}
        </div>

        <h2 className="pg-section">{t('pg.section.presets')}</h2>
        <div className="pg-grid pg-grid--presets">
          {PG_PRESETS.map(p => (
            <button key={p.slug} type="button" className="pg-card" onClick={() => setOpen(p)}>
              <span className="pg-card-img pg-card-img--preset"><span className="pg-preset-emoji" aria-hidden>{p.emoji}</span></span>
              <span className="pg-card-body">
                <span className="pg-card-title">{pick(p.title, lang)}</span>
                <span className="pg-card-ref">{pick(p.blurb, lang)}</span>
                <span className="pg-card-open">{t('pg.open')} →</span>
              </span>
            </button>
          ))}
        </div>

        <p className="pg-note">{t('pg.note')}</p>
      </div>

      {open && <Detail key={open.slug} item={open} lang={lang} t={t} onClose={() => setOpen(null)} />}
    </div>
  )
}
