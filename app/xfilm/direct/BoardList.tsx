'use client'
// 導演's first screen (Oct 22; owner: "my projects should be inside
// Direct"): your boards, newest first, and New, which opens the director's
// start screen (the template gallery and the composer) at ?new=1. A visitor
// with no boards, or signed out, never sees an empty list: onEmpty hands the
// page to the start screen, as /xdirect always opened.
//
// The picture is the board's first shot or sheet, signed per request by
// /api/xdirector/boards. A clip draws its own first frame (#t=0.1 forces the
// decode, as XCut's cards learned on Sep 8).

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { STRINGS, useT } from '@/lib/i18n'

type Board = { id: string; title: string | null; skill: string | null; scenes: number; created_at: string; updated_at: string
  poster?: { url: string; mediaType: string } }

export default function BoardList({ onEmpty }: { onEmpty: () => void }) {
  const t = useT()
  const [boards, setBoards] = useState<Board[] | null>(null)
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = async (offset: number) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/xdirector/boards?offset=${offset}`, { cache: 'no-store' })
      const d = await res.json().catch(() => null)
      if (!res.ok) { if (offset === 0) onEmpty(); return }
      const page: Board[] = d?.boards ?? []
      if (offset === 0 && page.length === 0) { onEmpty(); return }
      setBoards(prev => offset === 0 ? page : [...(prev ?? []), ...page])
      setMore(!!d?.more)
    } catch { if (offset === 0) onEmpty() }
    finally { setBusy(false) }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(0) }, [])

  const tplName = (skill: string | null) => skill && STRINGS[`skill.${skill}.title`] ? t(`skill.${skill}.title`) : null
  return (
    <div className="xduel-page">
      <div className="arena xcreate-arena xfilm-boards">
        <div className="xfilm-boards-head">
          <h1>{t('xfilm.boards')}</h1>
          <Link href="/xfilm/direct?new=1" className="xfilm-new">＋ {t('xfilm.new')}</Link>
        </div>
        {boards === null
          ? <div className="xfilm-boards-wait"><span className="nav-history-spin" aria-hidden /></div>
          : <div className="xfilm-board-grid">
              {boards.map(b => {
                const tpl = tplName(b.skill)
                return (
                  <Link key={b.id} href={`/xfilm/direct?c=${b.id}`} className="xfilm-board">
                    <span className="xfilm-board-pic">
                      {b.poster
                        ? (b.poster.mediaType.startsWith('video/')
                            ? <video src={`${b.poster.url}#t=0.1`} muted playsInline preload="metadata" />
                            // eslint-disable-next-line @next/next/no-img-element
                            : <img src={b.poster.url} alt="" loading="lazy" decoding="async" />)
                        : <svg className="xfilm-board-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 11h16v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9z"/><path d="M4 11l-1-4l16-4l1 4z"/><path d="M8 10l2-4"/><path d="M13 9l2-4"/></svg>}
                    </span>
                    <span className="xfilm-board-title">{b.title || t('xfilm.untitled')}</span>
                    <span className="xfilm-board-meta">
                      {[tpl, b.scenes > 0 ? t('xfilm.scenes').replace('{n}', String(b.scenes)) : null, new Date(b.updated_at).toLocaleDateString()].filter(Boolean).join(' · ')}
                    </span>
                  </Link>
                )
              })}
            </div>}
        {more && <button type="button" className="xfilm-more" disabled={busy} onClick={() => void load(boards?.length ?? 0)}>{t('xfilm.more')}</button>}
      </div>
    </div>
  )
}
