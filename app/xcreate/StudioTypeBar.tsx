'use client'
// The studio's types in one row (Text, Image, Video, Audio, Film), pinned on
// top of /xcreate inside www's own shell (left nav, ModelXD logo), as X先知's
// temples row is on /xtell. It was the xcreate.modelxd.com door's top bar
// (owner, Sep 28: "do the same as xtell"); the door was never released and
// went on Oct 13 (owner: "I will only keep dev.modelxd.com/xcreate or
// www.modelxd.com/xcreate"), and the row came with the studio.
//
// The studio owns the type (studio-type.ts): it publishes its current one,
// and a click here asks it to switch in place, because a switch may first
// need a fresh composer. A modified click opens the studio on that type in
// a new tab (`/xcreate?type=`).
//
// Icons: the approved ModelXD media set (MediaIcon, Oct 17) for Text, Image,
// Video, Speech and Music, in full colour; Film has no approved icon yet and
// keeps its line drawing.

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useLang } from '@/lib/i18n'
import ModeIcon from '../components/ModeIcon'
import MediaIcon, { hasMediaIcon } from '../components/MediaIcon'
import { STUDIO_TYPES, requestStudioType, useStudioType, type StudioType } from '../components/xcreate/studio-type'

export default function StudioTypeBar({ initial = null }: { initial?: StudioType | null } = {}) {
  const { lang, t } = useLang()
  const active = useStudioType(initial)
  const row = useRef<HTMLElement>(null)
  const [more, setMore] = useState({ left: false, right: false })
  // On a phone the row scrolls and the last types start past the edge: keep
  // the current type in view, when it changes and when the row changes size.
  const showCurrent = () => {
    const el = row.current
    const current = el?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!el || !current) return
    const box = el.getBoundingClientRect()
    const r = current.getBoundingClientRect()
    if (r.right > box.right) el.scrollBy({ left: r.right - box.right + 8, behavior: 'smooth' })
    else if (r.left < box.left) el.scrollBy({ left: r.left - box.left - 8, behavior: 'smooth' })
  }
  useEffect(() => {
    const el = row.current
    if (!el) return
    const check = () => setMore({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 })
    check()
    el.addEventListener('scroll', check, { passive: true })
    const ro = new ResizeObserver(() => { check(); showCurrent() })
    ro.observe(el)
    return () => { el.removeEventListener('scroll', check); ro.disconnect() }
  }, [lang])
  useEffect(showCurrent, [active])
  const scrollRow = (dir: number) => row.current?.scrollBy({ left: dir * row.current.clientWidth * 0.8, behavior: 'smooth' })
  return <div className="xcs-typebar">
    <div className="xcs-types-wrap">
      <nav ref={row} className="xcs-types" aria-label={t('xcreate.site.navigation')}>
        {STUDIO_TYPES.map(type => <Link key={type} href={`/xcreate?type=${type}`} aria-current={active === type ? 'page' : undefined}
          onClick={event => {
            if (active === null || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
            event.preventDefault()
            requestStudioType(type)
          }}>
          {/* 'audio' is 語音 since 音樂 has its own tab (Oct 22). */}
          {hasMediaIcon(type) ? <span className="xcs-type-icon"><MediaIcon kind={type === 'audio' ? 'speech' : type} /></span> : <ModeIcon m={type} />}<span>{t(type === 'audio' ? 'mode.speech' : 'mode.' + type)}</span>
        </Link>)}
      </nav>
      {more.left && <button type="button" className="xcs-types-arrow is-left" tabIndex={-1} aria-hidden="true" onClick={() => scrollRow(-1)}>‹</button>}
      {more.right && <button type="button" className="xcs-types-arrow is-right" tabIndex={-1} aria-hidden="true" onClick={() => scrollRow(1)}>›</button>}
    </div>
  </div>
}
