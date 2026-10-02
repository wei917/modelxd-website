'use client'
// app/xcreate/StandaloneTemplates.tsx: the X創作 door's templates under the
// composer (owner, Oct 1: "we still need templates for image and video ...
// need to have better looking", e.g. "make photo/video taobao compliant, or
// make social platform compliant"). Phone first: each row scrolls sideways
// with snap, and on a wide screen it wraps. A card is the template's real
// preview, the platform's mark, its shape, its name and the one rule that
// matters. Choosing one applies it through applyTemplate.
//
// Which templates and rows: Template.group in templates.ts. The marketplace
// rows lead with what the reader's market sells on (TW: 蝦皮, momo; JP: 楽天,
// Amazon; zh-Hans: 淘寶).

import { useState } from 'react'
import { useLang, tOr } from '@/lib/i18n'
import { XCREATE_TEMPLATES, type Template } from './templates'

type Group = NonNullable<Template['group']>

const ROWS: Record<'image' | 'video', Group[]> = {
  image: ['shop', 'social', 'style'],
  video: ['shopvideo', 'shortvideo'],
}

const FIRST: Record<string, string[]> = {
  'zh-Hant': ['shop-shopee', 'shop-momo', 'shop-taobao-main', 'shop-taobao-white', 'shop-amazon', 'shop-rakuten', 'video-shopee', 'video-taobao-main', 'video-amazon', 'video-vertical-916'],
  'zh-Hans': ['shop-taobao-main', 'shop-taobao-white', 'shop-amazon', 'shop-shopee', 'shop-rakuten', 'shop-momo', 'video-taobao-main', 'video-amazon', 'video-shopee', 'video-vertical-916'],
  ja:        ['shop-rakuten', 'shop-amazon', 'shop-taobao-main', 'shop-taobao-white', 'shop-shopee', 'shop-momo', 'video-amazon', 'video-taobao-main', 'video-shopee', 'video-vertical-916'],
  en:        ['shop-amazon', 'shop-shopee', 'shop-taobao-main', 'shop-taobao-white', 'shop-rakuten', 'shop-momo', 'video-amazon', 'video-shopee', 'video-taobao-main', 'video-vertical-916'],
  ko:        ['shop-amazon', 'shop-shopee', 'shop-taobao-main', 'shop-taobao-white', 'shop-rakuten', 'shop-momo', 'video-amazon', 'video-shopee', 'video-taobao-main', 'video-vertical-916'],
}

/** The framed preview for a social size: its shape inside the 148px box. */
const FRAME: Record<string, { w: number; h: number }> = {
  '3:4': { w: 96, h: 128 }, '9:16': { w: 72, h: 128 }, '1:1': { w: 112, h: 112 },
}

export default function StandaloneTemplates({ mode, onSelect, onConvert }: {
  mode: 'image' | 'video' | 'text' | 'audio'; onSelect: (template: Template) => void
  /** Opens "your own file → a platform's spec" (no model; ConvertDialog). */
  onConvert?: (kind: 'image' | 'video') => void
}) {
  const { lang, t } = useLang()
  const [broken, setBroken] = useState<Record<string, true>>({})
  if (mode !== 'image' && mode !== 'video') return null

  const first = FIRST[lang] ?? FIRST.en
  const rank = (id: string) => { const i = first.indexOf(id); return i < 0 ? first.length : i }
  const rows = ROWS[mode]
    .map(group => ({
      group,
      items: XCREATE_TEMPLATES
        .filter(item => item.group === group && item.mode === mode)
        .map((item, i) => ({ item, i }))
        .sort((a, b) => rank(a.item.id) - rank(b.item.id) || a.i - b.i)
        .map(x => x.item),
    }))
    .filter(row => row.items.length > 0)
  if (rows.length === 0) return null

  return (
    <section id="xcs-templates" className="xcs-tpl" aria-label={t('xct.section')}>
      <div className="xcs-tpl-head">
        <h2>{t('xct.section')}</h2>
        <p>{t(mode === 'image' ? 'xct.section.image' : 'xct.section.video')}</p>
      </div>
      {rows.map(row => (
        <div className="xcs-tpl-row" key={row.group}>
          <div className="xcs-tpl-row-head">
            <h3>{t(`xct.row.${row.group}`)}</h3>
            <span>{t(`xct.row.${row.group}.note`)}</span>
          </div>
          <div className="xcs-tpl-strip">
            {/* First in the marketplace rows: convert a file you already have,
                no model and nothing billed (phase 2, Oct 1). */}
            {onConvert && (row.group === 'shop' || row.group === 'shopvideo') && (
              <button type="button" className="xcs-tpl-card xcs-tpl-convert" onClick={() => onConvert(mode)}>
                <span className="xcs-tpl-pv"><span className="xcs-tpl-convert-icon" aria-hidden>⇄</span></span>
                <span className="xcs-tpl-meta">
                  <b>{t(mode === 'image' ? 'xct.convert.image.title' : 'xct.convert.video.title')}</b>
                  <small>{t('xct.convert.spec')}</small>
                </span>
              </button>
            )}
            {row.items.map(item => {
              const title = tOr(t, `xct.${item.id}.title`, item.title)
              const line = tOr(t, `xct.${item.id}.spec`, tOr(t, `xct.${item.id}.subtitle`, item.subtitle))
              const frame = row.group === 'social' ? FRAME[item.aspectRatio ?? ''] : null
              const img = item.previewUrl && !broken[item.id]
                ? <img src={item.previewUrl} alt="" loading="lazy" onError={() => setBroken(b => ({ ...b, [item.id]: true }))} />
                : <span className="xcs-tpl-emoji" aria-hidden>{item.emoji}</span>
              return (
                <button type="button" key={item.id} className="xcs-tpl-card" onClick={() => onSelect(item)}>
                  <span className={`xcs-tpl-pv${item.mode === 'video' ? ' is-video' : ''}`}>
                    {frame
                      ? <span className="xcs-tpl-frame" style={{ width: frame.w, height: frame.h }}>{img}</span>
                      : img}
                    {item.mark && (
                      <span className="xcs-tpl-mark" aria-hidden>
                        {item.mark.logo
                          ? <img src={item.mark.logo} alt="" />
                          : <b style={{ color: item.mark.color }}>{item.mark.text}</b>}
                      </span>
                    )}
                    {item.aspectRatio && row.group !== 'style' && (
                      <span className="xcs-tpl-ratio">{item.aspectRatio}{item.mode === 'video' && item.duration ? ` · ${item.duration}s` : ''}</span>
                    )}
                  </span>
                  <span className="xcs-tpl-meta">
                    <b>{title}</b>
                    <small>{line}</small>
                    {item.exportSpec && <span className="xcs-tpl-chk">✓ {t('xct.ready')}</span>}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </section>
  )
}
