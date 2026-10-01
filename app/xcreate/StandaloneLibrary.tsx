'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useAuthModal } from '@/lib/AuthModalContext'
import { useLang } from '@/lib/i18n'
import ModeIcon from '../components/ModeIcon'
import { xcreateStudioCopy } from './standalone-copy'
import { STUDIO_TYPES, type StudioType } from '../components/xcreate/studio-type'
// The account page shows the Library without the studio, so it brings the
// studio's stylesheet (every rule scoped to the XCreate door).
import './standalone.css'

type Mode = 'image' | 'video' | 'text' | 'audio'
type Creation = {
  id: string; mode: Mode; prompt: string; title?: string | null; created_at: string
  slots: { text?: string; isImage?: boolean; isVideo?: boolean; error?: string; name?: string; options?: { film?: string } | null }[] | null
}
type Page = { rows: Creation[]; total: number; pageSize: number }

/** Uses the existing paginated, session-authenticated history endpoint.
 * Opening a record follows the studio's existing ?id= restore path. */
export default function StandaloneLibrary({ onNew }: { onNew: () => void }) {
  const { lang, t } = useLang()
  const copy = xcreateStudioCopy(lang)
  const { show } = useAuthModal()
  const [filter, setFilter] = useState<StudioType | 'all'>('all')
  const [page, setPage] = useState(0)
  const [retry, setRetry] = useState(0)
  const [data, setData] = useState<Page | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'auth' | 'error'>('loading')
  useEffect(() => {
    const controller = new AbortController()
    setStatus('loading')
    fetch(`/api/profile/xcreates?page=${page}&filter=${filter}`, { signal: controller.signal })
      .then(async res => {
        if (res.status === 401) { setData(null); setStatus('auth'); return }
        if (!res.ok) throw new Error('history unavailable')
        const body = await res.json()
        if (!Array.isArray(body.rows) || typeof body.total !== 'number' || typeof body.pageSize !== 'number' || body.pageSize < 1) throw new Error('invalid history')
        if (!controller.signal.aborted) { setData(body); setStatus('ready') }
      }).catch(() => { if (!controller.signal.aborted) setStatus('error') })
    return () => controller.abort()
  }, [filter, page, retry])

  return <section className="xcs-library" aria-label={copy.creationsTitle}>
    <div className="xcs-library-toolbar">
      <label className="xcs-filter-label">{copy.type}
        <select value={filter} onChange={e => { setFilter(e.target.value as StudioType | 'all'); setPage(0) }}>
          <option value="all">{copy.all}</option>
          {/* The top bar's types and order; Film is its own (Oct 1), no longer inside Video. */}
          {STUDIO_TYPES.map(type => <option key={type} value={type}>{t(`mode.${type}`)}</option>)}
        </select>
      </label>
      <button className="xcs-secondary" onClick={onNew}>+ {copy.newCreation}</button>
    </div>
    {status === 'loading' && <p className="xcs-empty" role="status">{copy.loading}</p>}
    {status === 'auth' && <div className="xcs-empty"><button className="xcs-primary" onClick={() => show('/profile')}>{copy.signIn}</button></div>}
    {status === 'error' && <div className="xcs-empty" role="alert"><p>{copy.error}</p><button className="xcs-secondary" onClick={() => setRetry(n => n + 1)}>{copy.retry}</button></div>}
    {status === 'ready' && data && <>
      {data.rows.length === 0 ? <p className="xcs-empty">{filter === 'all' ? copy.empty : copy.emptyFilter}</p> : <div className="xcs-library-grid">
        {data.rows.map(item => {
          const slots = (item.slots ?? []).filter(Boolean)
          const preview = slots.find(s => !s.error && s.text)
          const url = preview?.text?.split('\n')[0]
          const mediaUrl = url && /^https?:\/\//i.test(url) ? url : null
          const title = item.title || item.prompt || copy.untitled
          // A film (the fifth type) is a video row whose one slot names it.
          const isFilm = typeof slots[0]?.options?.film === 'string'
          return <Link key={item.id} href={`/?id=${encodeURIComponent(item.id)}`} className="xcs-creation" aria-label={`${copy.open}: ${title}`}>
            <div className="xcs-creation-preview">
              {mediaUrl && (item.mode === 'image' || preview?.isImage)
                ? <img src={mediaUrl} alt="" loading="lazy" />
                : mediaUrl && (item.mode === 'video' || preview?.isVideo)
                  // #t=0.1: mobile Chrome paints a blank box for a preload="metadata" video without it.
                  ? <video src={`${mediaUrl}#t=0.1`} preload="metadata" muted playsInline />
                  : item.mode === 'text' && preview?.text
                    ? <p>{preview.text.slice(0,240)}</p>
                    : <ModeIcon m={isFilm ? 'film' : item.mode} />}
            </div>
            <div className="xcs-creation-copy"><div className="xcs-creation-meta"><span>{t(isFilm ? 'mode.film' : `mode.${item.mode}`)}</span><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleDateString(lang)}</time></div><h2>{title}</h2>{!isFilm && <span>{slots.length} {copy.models}</span>}</div>
          </Link>
        })}
      </div>}
      {data.total > data.pageSize && <nav className="xcs-pagination" aria-label={copy.creationsTitle}>
        <button disabled={page === 0} onClick={() => setPage(p => p - 1)}>{copy.previous}</button>
        <span aria-live="polite">{page + 1} / {Math.ceil(data.total / data.pageSize)}</span>
        <button disabled={(page + 1) * data.pageSize >= data.total} onClick={() => setPage(p => p + 1)}>{copy.next}</button>
      </nav>}
    </>}
  </section>
}
