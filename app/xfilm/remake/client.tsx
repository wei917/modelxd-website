'use client'
// app/xfilm/remake/client.tsx — XFilm's 同款 (Remake): a video link or upload
// read into a shot list and remade with your swaps, and its templates
// (風扇變裝). It was X創作's sixth type (Oct 10) until Oct 22; RemakeStudio
// moved here unchanged and wears X創作's look still (.xcs-page,
// standalone.css), phone first.
//
// Addresses, written in place (no Back step), as they were on /xcreate:
// ?remake=<id> a kept read, ?fan=new the template's form, ?fan=<id> a run.

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAuthModal } from '@/lib/AuthModalContext'
import { createSupabaseBrowser } from '@/lib/supabase-client'
import RemakeStudio from './RemakeStudio'
import '@/app/xcreate/standalone.css'

const isUuid = (v: string | null | undefined): v is string => !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const fanOf = (v: string | null) => v === 'new' ? 'new' : isUuid(v) ? v.toLowerCase() : null

export default function RemakeClient() {
  return <Suspense fallback={null}><Remake /></Suspense>
}

function Remake() {
  const params = useSearchParams()
  const remakeParam = params?.get('remake') ?? null
  const fanParam = params?.get('fan') ?? null
  const [remakeId, setRemakeId] = useState<string | null>(() => isUuid(remakeParam) ? remakeParam.toLowerCase() : null)
  const [fan, setFan] = useState<string | null>(() => fanOf(fanParam))
  const [userId, setUserId] = useState<string | null>(null)
  const { show: showAuth } = useAuthModal()
  useEffect(() => { createSupabaseBrowser().auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null)) }, [])
  // A link to another read or run (the Library, Back) while the page is open.
  useEffect(() => { if (isUuid(remakeParam)) { setFan(null); setRemakeId(remakeParam.toLowerCase()) } }, [remakeParam])
  useEffect(() => { const f = fanOf(fanParam); if (f) setFan(f) }, [fanParam])

  const writeUrl = (key: 'remake' | 'fan' | null, value: string | null) => {
    const url = new URL(window.location.href)
    url.searchParams.delete('remake'); url.searchParams.delete('fan')
    if (key && value) url.searchParams.set(key, value)
    window.history.replaceState({}, '', url.pathname + url.search + url.hash)
  }

  return (
    <div className="xcs-page">
      <div className="xduel-page">
        <div className="arena xcreate-arena xcs-studio" id="xcreate-main" tabIndex={-1}>
          <RemakeStudio signedIn={!!userId} onSignIn={next => showAuth(next ?? '/xfilm/remake')}
            remakeId={remakeId} onRemakeId={id => { setRemakeId(id); writeUrl(id ? 'remake' : null, id) }}
            fan={fan} onFan={v => {
              setFan(v)
              if (v) writeUrl('fan', v); else writeUrl(remakeId ? 'remake' : null, remakeId)
              window.scrollTo({ top: 0 })
            }} />
        </div>
      </div>
    </div>
  )
}
