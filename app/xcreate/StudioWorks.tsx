'use client'
// app/xcreate/StudioWorks.tsx: section ④ of the X創作 door (Oct 3 redesign):
// your latest work of the chosen type as a picture grid, newest first; a
// tap reopens it, and 作品庫 opens the account page's Library with
// everything. Signed-in only; nothing renders when there is nothing yet.
// It reads the Library's own endpoint (/api/profile/xcreates, which
// re-signs the 24-hour file links) with studio=1, so XDirect board nodes,
// upload "Source:" rows and XCut renders stay out. Film is its own type.

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useLang } from '@/lib/i18n'
import type { StudioType } from '../components/xcreate/studio-type'

type Row = {
  id: string; mode: string; prompt: string | null; title: string | null; created_at: string
  slots: { text?: string; isImage?: boolean; isVideo?: boolean; isAudio?: boolean; error?: string | null; options?: { film?: string } | null }[] | null
}

const SHOW = 10

export default function StudioWorks({ type, userId }: { type: StudioType; userId: string }) {
  const { lang, t } = useLang()
  const [rows, setRows] = useState<Row[]>([])
  useEffect(() => { setRows([]) }, [type])
  useEffect(() => {
    let dead = false
    fetch(`/api/profile/xcreates?page=0&filter=${type}&studio=1`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!dead && Array.isArray(d?.rows)) setRows((d.rows as Row[]).slice(0, SHOW)) })
      .catch(() => {})
    return () => { dead = true }
  }, [type, userId])

  if (rows.length === 0) return null

  return (
    <section className="xcs-sec" aria-label={t('xcs.sec.works')}>
      <div className="xcs-sec-head">
        <h2>{t('xcs.sec.works')}</h2>
        <Link href="/profile">{t('xcs.sec.library')} ›</Link>
      </div>
      <div className="xcs-works">
        {rows.map(r => {
          const slot = (r.slots ?? []).find(s => s && !s.error && typeof s.text === 'string' && s.text)
          const url = slot?.text?.split('\n')[0] ?? ''
          const media = /^https?:\/\//i.test(url) ? url : null
          const title = r.title || r.prompt || t('xcs.works.untitled')
          const day = new Date(r.created_at).toLocaleDateString(lang, { month: 'numeric', day: 'numeric' })
          return (
            <Link key={r.id} href={`/?id=${encodeURIComponent(r.id)}`} className="xcs-work" title={title}>
              {media && (slot?.isImage || r.mode === 'image')
                ? <img src={media} alt="" loading="lazy" />
                : media && (slot?.isVideo || r.mode === 'video')
                  // #t=0.1: mobile Chrome paints nothing for a preload="metadata" video without it.
                  ? <video src={`${media}#t=0.1`} preload="metadata" muted playsInline />
                  : <span className="xcs-work-text">{r.mode === 'audio' ? '🎙 ' : ''}{(r.mode === 'text' && slot?.text ? slot.text : title).slice(0, 80)}</span>}
              <span className="xcs-work-day">{day}</span>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
