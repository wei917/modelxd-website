'use client'
// /profile — private owner page with edit + tabs

import { useEffect, useRef, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import Nav from '../components/Nav'
import ReactMarkdown from 'react-markdown'

const sb = () => createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
)

const PROVIDER_COLORS: Record<string, string> = {
  anthropic: '#e8453c', openai: '#10a37f', google: '#4285f4',
  xai: '#aaa', deepseek: '#4a9eff', meta: '#0668e1',
  mistral: '#ff7000', bfl: '#a78bfa', recraft: '#34d399',
}
const providerColor = (p: string) => PROVIDER_COLORS[p?.toLowerCase()] ?? '#888'

interface Profile {
  id: string
  display_name: string | null
  bio: string | null
  avatar_url: string | null
}

type Tab = 'creates' | 'votes' | 'stats'

export default function ProfilePage() {
  const cursorRef = useRef<HTMLDivElement>(null)
  const ringRef   = useRef<HTMLDivElement>(null)
  const fileRef   = useRef<HTMLInputElement>(null)

  const [user,        setUser]        = useState<any>(null)
  const [profile,     setProfile]     = useState<Profile | null>(null)
  const [editing,     setEditing]     = useState(false)
  const [editName,    setEditName]    = useState('')
  const [editBio,     setEditBio]     = useState('')
  const [saving,      setSaving]      = useState(false)
  const [uploading,   setUploading]   = useState(false)
  const [tab,         setTab]         = useState<Tab>('creates')
  const [creates,     setCreates]     = useState<any[]>([])
  const [votes,       setVotes]       = useState<any[]>([])
  const [stats,       setStats]       = useState<any>(null)
  const [lightbox,    setLightbox]    = useState<string | null>(null)

  // Cursor
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

  // Load user + profile
  useEffect(() => {
    const client = sb()
    client.auth.getUser().then(({ data }) => {
      if (!data.user) { window.location.href = '/auth/login'; return }
      setUser(data.user)
      client.from('profiles').select('*').eq('id', data.user.id).single()
        .then(({ data: p }) => {
          setProfile(p)
          setEditName(p?.display_name ?? '')
          setEditBio(p?.bio ?? '')
        })
    })
  }, [])

  // Load tab data
  useEffect(() => {
    if (!user) return
    const client = sb()
    if (tab === 'creates') {
      client.from('creates').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(50)
        .then(({ data }) => setCreates(data ?? []))
    } else if (tab === 'votes') {
      client.from('duel_votes').select('*, duels(prompt, mode, slots)').eq('user_id', user.id).order('created_at', { ascending: false }).limit(50)
        .then(({ data }) => setVotes(data ?? []))
    } else if (tab === 'stats') {
      Promise.all([
        client.from('creates').select('id', { count: 'exact' }).eq('user_id', user.id),
        client.from('duels').select('id', { count: 'exact' }).eq('user_id', user.id),
        client.from('duel_votes').select('id', { count: 'exact' }).eq('user_id', user.id),
      ]).then(([c, d, v]) => {
        setStats({ creates: c.count ?? 0, duels: d.count ?? 0, votes: v.count ?? 0 })
      })
    }
  }, [tab, user])

  const saveProfile = async () => {
    if (!user) return
    setSaving(true)
    await sb().from('profiles').upsert({ id: user.id, display_name: editName, bio: editBio, updated_at: new Date().toISOString() })
    setProfile(p => p ? { ...p, display_name: editName, bio: editBio } : p)
    setEditing(false)
    setSaving(false)
  }

  const uploadAvatar = async (file: File) => {
    if (!user) return
    if (file.size > 5 * 1024 * 1024) { alert('Max 5MB'); return }
    setUploading(true)
    try {
      const ext  = file.name.split('.').pop() ?? 'jpg'
      const path = `${user.id}.${ext}`
      const client = sb()
      await client.storage.from('avatars').upload(path, file, { contentType: file.type, upsert: true })
      const { data: { publicUrl } } = client.storage.from('avatars').getPublicUrl(path)
      await client.from('profiles').upsert({ id: user.id, avatar_url: publicUrl, updated_at: new Date().toISOString() })
      setProfile(p => p ? { ...p, avatar_url: publicUrl } : p)
    } catch (err) { alert('Upload failed') }
    setUploading(false)
  }

  if (!profile) return (
    <><Nav /><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: '#333' }}>Loading…</div></>
  )

  const initials = (profile.display_name ?? user?.email ?? '?').charAt(0).toUpperCase()

  return (
    <>
      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out' }}>
          <img src={lightbox} alt="" style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: 8 }} />
        </div>
      )}
      <div className="cursor" ref={cursorRef} />
      <div className="cursor-ring" ref={ringRef} />
      <Nav />

      <div className="xduel-page">
        <div className="arena" style={{ maxWidth: 900 }}>

          {/* ── Header ── */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 24, marginBottom: 40 }}>
            {/* Avatar */}
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <div
                onClick={() => !uploading && fileRef.current?.click()}
                style={{
                  width: 88, height: 88, borderRadius: '50%', overflow: 'hidden', cursor: 'pointer',
                  background: profile.avatar_url ? 'transparent' : '#1a1a1a',
                  border: '2px solid #222', position: 'relative',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                {profile.avatar_url
                  ? <img src={profile.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <span style={{ fontSize: 32, fontWeight: 800, color: '#e8453c' }}>{initials}</span>
                }
                <div style={{
                  position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  opacity: 0, transition: 'opacity 0.2s', borderRadius: '50%',
                  fontSize: 11, color: '#fff', fontWeight: 600,
                }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '1'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = '0'}
                >
                  {uploading ? '…' : 'Change'}
                </div>
              </div>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) uploadAvatar(f) }} />
            </div>

            {/* Name + bio */}
            <div style={{ flex: 1 }}>
              {editing ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <input
                    value={editName} onChange={e => setEditName(e.target.value)}
                    placeholder="Display name"
                    style={{ background: '#0d0d0d', border: '1px solid #333', borderRadius: 8, padding: '8px 12px', color: '#fff', fontSize: 18, fontWeight: 700, outline: 'none', fontFamily: 'inherit' }}
                  />
                  <textarea
                    value={editBio} onChange={e => setEditBio(e.target.value)}
                    placeholder="Bio (optional)"
                    rows={3}
                    style={{ background: '#0d0d0d', border: '1px solid #333', borderRadius: 8, padding: '8px 12px', color: '#ccc', fontSize: 13, outline: 'none', resize: 'none', fontFamily: 'inherit' }}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={saveProfile} disabled={saving} style={{ padding: '7px 18px', borderRadius: 8, background: '#e8453c', border: 'none', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                    <button onClick={() => setEditing(false)} style={{ padding: '7px 14px', borderRadius: 8, background: 'transparent', border: '1px solid #222', color: '#666', fontSize: 13, cursor: 'pointer' }}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>{profile.display_name ?? 'Anonymous'}</h1>
                    <button onClick={() => setEditing(true)} style={{ background: 'transparent', border: '1px solid #222', color: '#555', borderRadius: 7, padding: '3px 10px', fontSize: 11, cursor: 'pointer' }}>
                      Edit
                    </button>
                  </div>
                  <div style={{ fontSize: 12, color: '#444', marginBottom: 8, fontFamily: 'var(--mono)' }}>{user?.email}</div>
                  {profile.bio
                    ? <p style={{ fontSize: 13, color: '#777', lineHeight: 1.6, margin: 0 }}>{profile.bio}</p>
                    : <p style={{ fontSize: 13, color: '#333', margin: 0, fontStyle: 'italic' }}>No bio yet — click Edit to add one</p>
                  }
                </>
              )}
            </div>

            {/* Public profile link */}
            <a href={`/profile/${user?.id}`} target="_blank"
              style={{ fontSize: 11, color: '#444', border: '1px solid #1e1e1e', borderRadius: 8, padding: '6px 12px', textDecoration: 'none', flexShrink: 0, marginTop: 4 }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#888'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = '#444'}
            >
              ↗ Public profile
            </a>
          </div>

          {/* ── Tabs ── */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 28, borderBottom: '1px solid #111', paddingBottom: 0 }}>
            {([['creates', '✦ Creates'], ['votes', '⊞ Votes'], ['stats', '◎ Stats']] as [Tab, string][]).map(([t, label]) => (
              <button key={t} onClick={() => setTab(t)} style={{
                padding: '9px 18px', background: 'transparent', border: 'none',
                borderBottom: tab === t ? '2px solid #e8453c' : '2px solid transparent',
                color: tab === t ? '#fff' : '#555', fontWeight: tab === t ? 700 : 400,
                fontSize: 13, cursor: 'pointer', marginBottom: -1,
              }}>{label}</button>
            ))}
          </div>

          {/* ── Creates tab ── */}
          {tab === 'creates' && (
            creates.length === 0
              ? <div style={{ color: '#333', textAlign: 'center', padding: 60, fontSize: 13 }}>No creates yet — go to Studio to start.</div>
              : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
                  {creates.map(item => {
                    const slots   = (item.slots ?? []).filter(Boolean)
                    const mode    = item.mode
                    const modeColor = mode === 'video' ? '#34d399' : mode === 'image' ? '#a78bfa' : '#4a9eff'
                    const chosen  = slots.find((s: any) => s.id === item.chosen_model_id)
                    const preview = chosen ?? slots[0]
                    return (
                      <div key={item.id} style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 12, overflow: 'hidden' }}>
                        {preview && (
                          preview.isVideo
                            ? <video src={preview.text} muted loop playsInline style={{ width: '100%', maxHeight: 140, objectFit: 'cover', display: 'block' }} />
                            : preview.isImage
                            ? <img src={preview.text} alt="" onClick={() => setLightbox(preview.text)} style={{ width: '100%', maxHeight: 140, objectFit: 'cover', display: 'block', cursor: 'zoom-in' }} />
                            : <div style={{ padding: '10px 12px', fontSize: 11, color: '#555', lineHeight: 1.6, maxHeight: 80, overflow: 'hidden', maskImage: 'linear-gradient(to bottom, black 50%, transparent)' }}>{preview.text?.slice(0, 180)}</div>
                        )}
                        <div style={{ padding: '10px 12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                            <span style={{ fontSize: 9, fontWeight: 700, color: modeColor, background: modeColor+'18', padding: '2px 7px', borderRadius: 8, textTransform: 'uppercase' as const }}>{mode}</span>
                            <span style={{ fontSize: 11, color: '#2a2a2a', marginLeft: 'auto' }}>{new Date(item.created_at).toLocaleDateString()}</span>
                          </div>
                          <div style={{ fontSize: 12, color: '#555', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.prompt}</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
          )}

          {/* ── Votes tab ── */}
          {tab === 'votes' && (
            votes.length === 0
              ? <div style={{ color: '#333', textAlign: 'center', padding: 60, fontSize: 13 }}>No votes yet — head to XDuel to start voting.</div>
              : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {votes.map((v: any) => {
                    const duel = v.duels
                    return (
                      <a key={v.id} href={`/duel/${v.duel_id}`} style={{ textDecoration: 'none' }}>
                        <div style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 10, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 14 }}
                          onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = '#2a2a2a'}
                          onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = '#1a1a1a'}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, color: '#ccc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 3 }}>
                              {duel?.prompt ?? 'Duel'}
                            </div>
                            <div style={{ fontSize: 11, color: '#444' }}>
                              {duel?.mode ?? 'text'} · {new Date(v.created_at).toLocaleDateString()}
                            </div>
                          </div>
                          {v.winner_model_id
                            ? <span style={{ fontSize: 11, color: '#34d399', background: '#34d39918', padding: '3px 9px', borderRadius: 7, flexShrink: 0 }}>Voted</span>
                            : <span style={{ fontSize: 11, color: '#888', background: '#ffffff0a', padding: '3px 9px', borderRadius: 7, flexShrink: 0 }}>Tie</span>
                          }
                        </div>
                      </a>
                    )
                  })}
                </div>
          )}

          {/* ── Stats tab ── */}
          {tab === 'stats' && stats && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
              {[
                { label: 'XDuels Created', value: stats.duels, color: '#e8453c' },
                { label: 'Studio Creates', value: stats.creates, color: '#a78bfa' },
                { label: 'Votes Cast',     value: stats.votes,   color: '#34d399' },
              ].map(s => (
                <div key={s.label} style={{ background: '#0d0d0d', border: `1px solid ${s.color}22`, borderRadius: 12, padding: '24px 20px', textAlign: 'center' }}>
                  <div style={{ fontSize: 40, fontWeight: 900, color: s.color, lineHeight: 1, marginBottom: 8 }}>{s.value}</div>
                  <div style={{ fontSize: 12, color: '#555' }}>{s.label}</div>
                </div>
              ))}
            </div>
          )}

        </div>
      </div>
    </>
  )
}
