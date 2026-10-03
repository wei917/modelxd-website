'use client'
// app/xcreate/StandaloneTemplates.tsx: section ① of the X創作 door (Oct 3
// redesign, learned from Pollo AI's /image page: tools first, then models,
// then the social feed, then your own work). One sideways row of big cards:
// the multi-format templates lead (電商商品圖, 社群貼文圖, 電商影片, 社群短影音;
// the platform is chosen inside, owner: "all 電商影片 should be just one
// template"), then the other templates, then the free converter for a file
// the user already has. Phone: the row scrolls and runs to the screen edge;
// from 761px it wraps.

import { useState } from 'react'
import { useLang, tOr } from '@/lib/i18n'
import { XCREATE_TEMPLATES, type Template } from './templates'

const GROUP_ORDER: NonNullable<Template['group']>[] = ['shop', 'social', 'shopvideo', 'shortvideo', 'style']

export default function StandaloneTemplates({ mode, onSelect, onConvert }: {
  mode: 'image' | 'video' | 'text' | 'audio'; onSelect: (template: Template) => void
  /** Opens "your own file → a platform's spec" (no model; ConvertDialog). */
  onConvert?: (kind: 'image' | 'video') => void
}) {
  const { t } = useLang()
  const [broken, setBroken] = useState<Record<string, true>>({})
  if (mode !== 'image' && mode !== 'video') return null

  const items = XCREATE_TEMPLATES
    .filter(item => item.group && item.mode === mode)
    .map((item, i) => ({ item, i }))
    .sort((a, b) =>
      Number(!a.item.formats) - Number(!b.item.formats)
      || GROUP_ORDER.indexOf(a.item.group!) - GROUP_ORDER.indexOf(b.item.group!)
      || a.i - b.i)
    .map(x => x.item)
  if (items.length === 0 && !onConvert) return null

  return (
    <section id="xcs-templates" className="xcs-sec" aria-label={t('xcs.sec.tools')}>
      <div className="xcs-sec-head"><h2>{t('xcs.sec.tools')}</h2></div>
      <div className="xcs-tool-strip">
        {items.map(item => (
          <button type="button" key={item.id} className="xcs-tool" onClick={() => onSelect(item)}>
            <span className={`xcs-tool-img${item.mode === 'video' ? ' is-video' : ''}`}>
              {item.previewUrl && !broken[item.id]
                ? <img src={item.previewUrl} alt="" loading="lazy" onError={() => setBroken(b => ({ ...b, [item.id]: true }))} />
                : <span className="xcs-tool-emoji" aria-hidden>{item.emoji}</span>}
            </span>
            <span className="xcs-tool-text">
              <b>{tOr(t, `xct.${item.id}.title`, item.title)}</b>
              <small>{tOr(t, `xct.${item.id}.spec`, tOr(t, `xct.${item.id}.subtitle`, item.subtitle))}</small>
            </span>
          </button>
        ))}
        {onConvert && (
          <button type="button" className="xcs-tool xcs-tool-convert" onClick={() => onConvert(mode)}>
            <span className="xcs-tool-img"><span className="xcs-tool-convert-icon" aria-hidden>⇄</span><span className="xcs-tool-free">{t('xct.convert.spec')}</span></span>
            <span className="xcs-tool-text">
              <b>{t(mode === 'image' ? 'xct.convert.image.title' : 'xct.convert.video.title')}</b>
              <small>{t('xc.convert.sub')}</small>
            </span>
          </button>
        )}
      </div>
    </section>
  )
}
