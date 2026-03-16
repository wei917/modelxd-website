'use client'
// /profile/[userId] — public read-only profile

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import Nav from '../../components/Nav'

const sb = () => createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
)

interface Profile {
  id: string
  display_name: string | null
  bio: string | null
  avatar_url: string | null
  created_at: string
}

export default function PublicProfilePage() {
  const { userId } = useParams<{ userId: string }>()
  const cursorRef  = useRef<HTMLDivElement>(null)
  const ringRef    = useRef<HTMLDivElement>(null)

  const [profile,  setProfile]  = useState<Profile | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    let mx = 0, my = 0, rx = 0, ry = 0, raf: number
    const move = (e: MouseEvent) => {
      mx = e.clientX; my = e.clientY
      if (cursorRef.current) { cursorRef.current.style.left = mx+'px'; cursorRef.current.style.top = my+'px' }
    }
    const tick = () => {
      rx += (mx-rx)*0.12; ry += (my-ry)*0.12
      if (ringRef.current) { ringRef.current.style.left = rx+'px'; ringRef.current.style.top = ry+'px' }
      raf = requestAnimationFrame(tick)
    }
    document.addEventListener('mousemove', move)
    raf = requestAnimationFrame(tick)
    return () => { document.removeEventListener('mousemove', move); cancelAnimationFrame(raf) }
  }, [])

  useEffect(() => {
    if (!userId) return
    sb().from('profiles').select('*').eq('id', userId).single()
      .then(({ data, error }) => {
        if (error || !data) { setNotFound(true) }
        else { setProfile(data) }
        setLoading(false)
      })
  }, [userId])

  if (loading) return <><Nav /><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: '#333' }}>Loading…</div></>
  if (notFound) return <><Nav /><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: '#333', flexDirection: 'column', gap: 12 }}><div style={{ fontSize: 48 }}>◎</div><div>Profile not found</div></div></>

  const initials = (profile!.display_name ?? '?').charAt(0).toUpperCase()
  const joined   = new Date(profile!.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  return (
    <>
      <div className="cursor" ref={cursorRef} />
      <div className="cursor-ring" ref={ringRef} />
      <Nav />

      <div className="xduel-page">
        <div className="arena" style={{ maxWidth: 600 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '40px 0' }}>

            {/* Avatar */}
            <div style={{
              width: 100, height: 100, borderRadius: '50%', overflow: 'hidden',
              background: profile!.avatar_url ? 'transparent' : '#1a1a1a',
              border: '2px solid #222', marginBottom: 20,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {profile!.avatar_url
                ? <img src={profile!.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <span style={{ fontSize: 36, fontWeight: 800, color: '#e8453c' }}>{initials}</span>
              }
            </div>

            <h1 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 6px' }}>
              {profile!.display_name ?? 'Anonymous'}
            </h1>

            <div style={{ fontSize: 12, color: '#444', marginBottom: 16, fontFamily: 'var(--mono)' }}>
              Joined {joined}
            </div>

            {profile!.bio && (
              <p style={{ fontSize: 14, color: '#777', lineHeight: 1.7, maxWidth: 420, margin: 0 }}>
                {profile!.bio}
              </p>
            )}

            <div style={{ marginTop: 32, padding: '16px 24px', background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 12, fontSize: 12, color: '#444' }}>
              Stats and activity are private to this user.
            </div>

          </div>
        </div>
      </div>
    </>
  )
}
