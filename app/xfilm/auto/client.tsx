'use client'
// app/xfilm/auto/client.tsx — XFilm's 自動成片 (Auto): a brief becomes a
// finished film, run by Claude (lib/film/). It was X創作's fifth type, 成片
// (Sep 29), until Oct 22; FilmStudio moved here unchanged, and wears X創作's
// look still (.xcs-page, standalone.css), phone first.
//
// A film is ?film=<id>, written in place (no Back step), as it was at
// /xcreate?film=. Your films are listed under the brief.

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAuthModal } from '@/lib/AuthModalContext'
import { createSupabaseBrowser } from '@/lib/supabase-client'
import StudioWorks from '@/app/xcreate/StudioWorks'
import FilmStudio from './FilmStudio'
import '@/app/xcreate/standalone.css'

const isUuid = (v: string | null | undefined): v is string => !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

export default function AutoClient() {
  return <Suspense fallback={null}><Auto /></Suspense>
}

function Auto() {
  const filmParam = useSearchParams()?.get('film') ?? null
  const [filmId, setFilmId] = useState<string | null>(() => isUuid(filmParam) ? filmParam.toLowerCase() : null)
  const [userId, setUserId] = useState<string | null>(null)
  const { show: showAuth } = useAuthModal()
  useEffect(() => { createSupabaseBrowser().auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null)) }, [])
  // A link to another film (the Library, Back) while the page is open.
  useEffect(() => { if (isUuid(filmParam)) setFilmId(filmParam.toLowerCase()) }, [filmParam])

  const openFilm = (id: string | null) => {
    setFilmId(id)
    const url = new URL(window.location.href)
    if (id) url.searchParams.set('film', id); else url.searchParams.delete('film')
    window.history.replaceState({}, '', url.pathname + url.search + url.hash)
  }

  return (
    <div className="xcs-page">
      <div className="xduel-page">
        <div className="arena xcreate-arena xcs-studio" id="xcreate-main" tabIndex={-1}>
          <FilmStudio filmId={filmId} onFilm={openFilm} signedIn={!!userId}
            onSignIn={next => showAuth(next ?? '/xfilm/auto')} />
          {/* Past films under the brief, as X創作 listed them. */}
          {!filmId && userId && <StudioWorks type="film" userId={userId} />}
        </div>
      </div>
    </div>
  )
}
