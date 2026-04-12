'use client'
// /profile — private owner page with edit + tabs

import { useEffect, useRef, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import ReactMarkdown from 'react-markdown'
import type { UserCredits, CreditTransaction } from '../../lib/credits'

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

type Tab = 'xcreates' | 'votes' | 'stats' | 'credits'

// Format an integer cent amount as a USD string. Handles the sign so the
// ledger column can show "-$0.04" style entries without special casing.
const formatCents = (cents: number): string => {
  const sign = cents < 0 ? '-' : ''
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`
}

// Human label for each credit_transactions.kind value.
const KIND_LABELS: Record<CreditTransaction['kind'], string> = {
  grant:      'Grant',
  purchase:   'Purchase',
  debit:      'Spent',
  refund:     'Refund',
  adjustment: 'Adjustment',
}

// Client-side mirror of CREDIT_TIERS in lib/stripe.ts. Kept here so we
// don't have to pull a server-only module into a 'use client' file. The
// server re-validates the tier id when building the Checkout Session, so
// if these drift the worst case is a 400, not a wrong charge.
const DISPLAY_TIERS: { id: string; priceCents: number; label: string; description: string }[] = [
  { id: 'tier_5',   priceCents:   500, label: '$5',   description: 'Starter — a few XCreates' },
  { id: 'tier_10',  priceCents:  1000, label: '$10',  description: 'Casual — most popular' },
  { id: 'tier_25',  priceCents:  2500, label: '$25',  description: 'Regular — heavy XCreate use' },
  { id: 'tier_100', priceCents: 10000, label: '$100', description: 'Power — bulk credit load' },
]

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
  const [tab,         setTab]         = useState<Tab>('xcreates')
  const [xcreates,    setXcreates]    = useState<any[]>([])
  const [votes,       setVotes]       = useState<any[]>([])
  const [stats,       setStats]       = useState<any>(null)
  const [lightbox,    setLightbox]    = useState<string | null>(null)
  // Credits wallet + ledger. RLS guarantees the user only sees their own
  // rows, so we can read both tables directly from the browser client.
  const [credits,     setCredits]     = useState<UserCredits | null>(null)
  const [txns,        setTxns]        = useState<CreditTransaction[]>([])
  // Checkout UI: picker modal + in-flight flag + post-redirect banner
  const [checkoutOpen,     setCheckoutOpen]     = useState(false)
  const [checkoutTier,     setCheckoutTier]     = useState<string | null>(null)
  const [checkoutBanner,   setCheckoutBanner]   = useState<'success' | 'cancel' | null>(null)

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

  // Load user + profile + wallet. Wallet read goes through RLS
  // (user_credits: owner read), so no service-role bounce needed.
  //
  // We use .maybeSingle() here instead of .single() because users who
  // signed up before the handle_new_user trigger was installed have an
  // auth.users row but no profiles row — .single() returns HTTP 406 in
  // that case and blanks the page. If the row is missing we upsert a
  // default from the auth metadata and retry.
  useEffect(() => {
    const client = sb()
    client.auth.getUser().then(async ({ data }) => {
      if (!data.user) { window.location.href = '/auth/login'; return }
      const u = data.user
      setUser(u)

      let { data: p } = await client.from('profiles').select('*').eq('id', u.id).maybeSingle()
      if (!p) {
        // Self-heal: create the missing profile row from auth metadata.
        const fallback = {
          id: u.id,
          display_name: u.user_metadata?.full_name ?? u.user_metadata?.name ?? u.email?.split('@')[0] ?? null,
          avatar_url:   u.user_metadata?.avatar_url ?? null,
          bio:          null,
        }
        await client.from('profiles').upsert(fallback)
        p = { ...fallback, display_name: fallback.display_name ?? null } as any
      }
      setProfile(p as Profile)
      setEditName((p as any)?.display_name ?? '')
      setEditBio((p as any)?.bio ?? '')

      const { data: c } = await client.from('user_credits').select('*').eq('user_id', u.id).maybeSingle()
      setCredits((c as UserCredits | null) ?? null)
    })
  }, [])

  // Load tab data
  useEffect(() => {
    if (!user) return
    const client = sb()
    if (tab === 'xcreates') {
      client.from('xcreates').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(50)
        .then(({ data }) => setXcreates(data ?? []))
    } else if (tab === 'votes') {
      client.from('duel_votes').select('*, duels(prompt, mode, slots)').eq('user_id', user.id).order('created_at', { ascending: false }).limit(50)
        .then(({ data }) => setVotes(data ?? []))
    } else if (tab === 'stats') {
      Promise.all([
        client.from('xcreates').select('id', { count: 'exact' }).eq('user_id', user.id),
        client.from('duels').select('id', { count: 'exact' }).eq('user_id', user.id),
        client.from('duel_votes').select('id', { count: 'exact' }).eq('user_id', user.id),
      ]).then(([c, d, v]) => {
        setStats({ xcreates: c.count ?? 0, duels: d.count ?? 0, votes: v.count ?? 0 })
      })
    } else if (tab === 'credits') {
      // Latest 100 ledger entries. RLS restricts to the signed-in user.
      client.from('credit_transactions').select('*').eq('user_id', user.id)
        .order('created_at', { ascending: false }).limit(100)
        .then(({ data }) => setTxns((data ?? []) as CreditTransaction[]))
      // Refresh balance at the same time in case a debit just landed.
      client.from('user_credits').select('*').eq('user_id', user.id).maybeSingle()
        .then(({ data: c }) => setCredits((c as UserCredits | null) ?? null))
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

  // Kick off a Stripe Checkout Session for the selected tier. The server
  // re-validates the tier id and builds a session keyed to the signed-in
  // user, then returns a hosted URL that we redirect to. Credits are
  // granted from the webhook, not on return — so the success banner just
  // tells the user to hang tight while we poll for the balance.
  const startCheckout = async (tierId: string) => {
    setCheckoutTier(tierId)
    try {
      const res = await fetch('/api/stripe/checkout', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ tierId }),
      })
      const data = await res.json()
      if (!res.ok || !data.url) {
        alert(`Checkout failed: ${data.error ?? res.statusText}`)
        setCheckoutTier(null)
        return
      }
      window.location.href = data.url as string
    } catch (err) {
      alert(`Checkout failed: ${err instanceof Error ? err.message : String(err)}`)
      setCheckoutTier(null)
    }
  }

  // Post-redirect banner + balance refresh. When Stripe sends the user
  // back with ?checkout=success we poll user_credits for ~15s so the
  // webhook-granted balance appears without a manual refresh. The
  // webhook is usually faster than the browser redirect, but not always.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const result = params.get('checkout')
    if (result !== 'success' && result !== 'cancel') return
    setCheckoutBanner(result)
    // Strip the query so a reload doesn't re-fire the banner.
    const url = new URL(window.location.href)
    url.searchParams.delete('checkout')
    url.searchParams.delete('session_id')
    window.history.replaceState({}, '', url.toString())

    if (result !== 'success') return
    let cancelled = false
    const poll = async () => {
      const client = sb()
      for (let i = 0; i < 10 && !cancelled; i++) {
        const { data } = await client.auth.getUser()
        if (!data.user) return
        const { data: c } = await client.from('user_credits').select('*').eq('user_id', data.user.id).maybeSingle()
        if (c) setCredits(c as UserCredits)
        // Also refresh ledger if the Credits tab is open.
        if (tab === 'credits') {
          const { data: t } = await client.from('credit_transactions').select('*').eq('user_id', data.user.id)
            .order('created_at', { ascending: false }).limit(100)
          setTxns((t ?? []) as CreditTransaction[])
        }
        await new Promise(r => setTimeout(r, 1500))
      }
    }
    poll()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!profile) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: 'var(--muted)' }}>Loading…</div>
  )

  const initials = (profile.display_name ?? user?.email ?? '?').charAt(0).toUpperCase()

  return (
    <>
      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{position:'fixed',inset:0,zIndex:99999,background:'rgba(0,0,0,0.92)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer'}}>
          <img src={lightbox} alt="Full size" onClick={() => setLightbox(null)} style={{maxWidth:'90vw',maxHeight:'90vh',borderRadius:8,boxShadow:'0 0 80px rgba(0,0,0,0.8)',cursor:'pointer'}} />
          <div onClick={e => e.stopPropagation()} style={{position:'fixed',top:20,right:24,zIndex:100000,display:'flex',gap:10}}>
            <a href={lightbox} download target="_blank" rel="noreferrer" title="Download"
              style={{display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(255,255,255,0.15)',border:'1px solid rgba(255,255,255,0.3)',borderRadius:8,width:36,height:36,color:'#fff',fontSize:16,textDecoration:'none',cursor:'pointer',boxShadow:'0 2px 12px rgba(0,0,0,0.4)'}}
            >↓</a>
            <button onClick={() => setLightbox(null)} title="Close"
              style={{display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(255,255,255,0.15)',border:'1px solid rgba(255,255,255,0.3)',borderRadius:8,width:36,height:36,color:'#fff',fontSize:16,cursor:'pointer',boxShadow:'0 2px 12px rgba(0,0,0,0.4)'}}
            >✕</button>
          </div>
        </div>
      )}
      <div className="cursor" ref={cursorRef} />
      <div className="cursor-ring" ref={ringRef} />

      <div className="xduel-page">
        <div className="arena" style={{ maxWidth: 1040 }}>

          {/* Eyebrow — ties the profile page into the same section-label
              motif used across XDuel / XCreate / landing. Gives the page
              a clear identity above the user's name. */}
          <div style={{
            fontFamily: 'var(--font-mono), monospace',
            fontSize: 10, color: 'var(--muted2)',
            letterSpacing: '0.22em', textTransform: 'uppercase',
            marginBottom: 24,
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <span style={{ width: 24, height: 1, background: 'var(--red)' }} />
            Account  ·  {user?.email ? 'Signed in' : ''}
          </div>

          {/* ── Header ── */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 28, marginBottom: 44 }}>
            {/* Avatar */}
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <div
                onClick={() => !uploading && fileRef.current?.click()}
                style={{
                  width: 96, height: 96, borderRadius: '50%', overflow: 'hidden', cursor: 'pointer',
                  background: profile.avatar_url ? 'transparent' : 'var(--surface2)',
                  border: '1px solid var(--border2)',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.04)',
                  position: 'relative',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                {profile.avatar_url
                  ? <img src={profile.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <span style={{ fontSize: 32, fontWeight: 800, color: 'var(--red)' }}>{initials}</span>
                }
                <div style={{
                  position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  opacity: 0, transition: 'opacity 0.2s', borderRadius: '50%',
                  fontSize: 11, color: 'var(--white)', fontWeight: 600,
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
                    style={{ background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 8, padding: '10px 14px', color: 'var(--white)', fontSize: 18, fontWeight: 700, outline: 'none', fontFamily: 'inherit' }}
                  />
                  <textarea
                    value={editBio} onChange={e => setEditBio(e.target.value)}
                    placeholder="Bio (optional)"
                    rows={3}
                    style={{ background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 8, padding: '10px 14px', color: 'var(--white)', fontSize: 13, lineHeight: 1.6, outline: 'none', resize: 'none', fontFamily: 'inherit' }}
                  />
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button
                      onClick={saveProfile}
                      disabled={saving}
                      style={{
                        padding: '9px 20px', borderRadius: 6,
                        background: 'var(--red)', border: 'none',
                        color: '#fff', fontWeight: 700, fontSize: 11,
                        fontFamily: 'var(--font-display), sans-serif',
                        letterSpacing: '0.12em', textTransform: 'uppercase',
                        cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1,
                      }}
                    >
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      onClick={() => setEditing(false)}
                      style={{
                        padding: '9px 16px', borderRadius: 6,
                        background: 'transparent', border: '1px solid var(--border2)',
                        color: 'var(--muted2)', fontSize: 11,
                        fontFamily: 'var(--font-mono), monospace',
                        letterSpacing: '0.1em', textTransform: 'uppercase',
                        cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
                    <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0, letterSpacing: '-0.01em', fontFamily: 'var(--font-display), sans-serif' }}>
                      {profile.display_name ?? 'Anonymous'}
                    </h1>
                    <button
                      onClick={() => setEditing(true)}
                      style={{ background: 'transparent', border: '1px solid var(--border2)', color: 'var(--muted2)', borderRadius: 6, padding: '4px 10px', fontSize: 10, cursor: 'pointer', fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.08em', textTransform: 'uppercase' }}
                      onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'var(--red)'; el.style.color = 'var(--red)' }}
                      onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'var(--border2)'; el.style.color = 'var(--muted2)' }}
                    >
                      Edit
                    </button>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted2)', marginBottom: 10, fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.04em' }}>{user?.email}</div>
                  {profile.bio
                    ? <p style={{ fontSize: 14, color: 'var(--muted2)', lineHeight: 1.65, margin: 0, maxWidth: 560 }}>{profile.bio}</p>
                    : <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0, fontStyle: 'italic' }}>No bio yet — click Edit to add one</p>
                  }
                </>
              )}
            </div>

            {/* Public profile link */}
            <a href={`/profile/${user?.id}`} target="_blank"
              style={{
                fontSize: 10, color: 'var(--muted2)', border: '1px solid var(--border2)', borderRadius: 6,
                padding: '8px 14px', textDecoration: 'none', flexShrink: 0, marginTop: 6,
                fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.1em', textTransform: 'uppercase',
                transition: 'color 0.2s, border-color 0.2s',
              }}
              onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.color = 'var(--red)'; el.style.borderColor = 'var(--red)' }}
              onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.color = 'var(--muted2)'; el.style.borderColor = 'var(--border2)' }}
            >
              ↗ Public profile
            </a>
          </div>

          {/* Post-checkout banner. Shown briefly after Stripe redirects the
              user back to /profile?checkout=success|cancel. The success
              banner sits next to a polling effect that refreshes the
              balance once the webhook lands. */}
          {checkoutBanner && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12,
              background: checkoutBanner === 'success' ? '#22c55e18' : '#e8453c18',
              border: `1px solid ${checkoutBanner === 'success' ? '#22c55e55' : '#e8453c55'}`,
              color:  checkoutBanner === 'success' ? 'var(--green)' : 'var(--red)',
              borderRadius: 10, padding: '12px 16px', marginBottom: 16,
              fontSize: 13,
            }}>
              <span style={{ fontSize: 16 }}>{checkoutBanner === 'success' ? '✓' : '⊘'}</span>
              <span style={{ flex: 1 }}>
                {checkoutBanner === 'success'
                  ? 'Payment received — your balance will update shortly.'
                  : 'Checkout canceled. No charge was made.'}
              </span>
              <button
                onClick={() => setCheckoutBanner(null)}
                style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 16, opacity: 0.7 }}
                aria-label="Dismiss"
              >×</button>
            </div>
          )}

          {/* ── Credit balance card ──
              Styled like a trading-terminal row: thin red accent on the
              left edge, mono numerics, generous padding. The goal is for
              the balance to read instantly without competing with the
              header above it. */}
          <div style={{
            position: 'relative',
            display: 'flex', alignItems: 'center', gap: 20,
            background: 'var(--surface)',
            border: '1px solid var(--border2)',
            borderLeft: '3px solid var(--red)',
            borderRadius: 10,
            padding: '20px 24px 20px 26px',
            marginBottom: 32,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 10, color: 'var(--muted2)',
                textTransform: 'uppercase' as const, letterSpacing: '0.18em',
                fontFamily: 'var(--font-mono), monospace',
                marginBottom: 6,
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--red)', display: 'inline-block' }} />
                Credit balance
              </div>
              <div style={{
                fontSize: 36, fontWeight: 800, color: 'var(--white)',
                fontFamily: 'var(--font-display), sans-serif',
                lineHeight: 1, letterSpacing: '-0.02em',
              }}>
                {credits ? formatCents(credits.balance_cents) : '$0.00'}
              </div>
              {credits && credits.lifetime_spent_cents > 0 && (
                <div style={{
                  fontSize: 11, color: 'var(--muted2)', marginTop: 10,
                  fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.04em',
                }}>
                  Spent {formatCents(credits.lifetime_spent_cents)}
                  {credits.lifetime_granted_cents > 0 && <>   ·   Granted {formatCents(credits.lifetime_granted_cents)}</>}
                </div>
              )}
            </div>
            <button
              onClick={() => setCheckoutOpen(true)}
              style={{
                padding: '12px 22px', borderRadius: 6,
                background: 'var(--red)', border: 'none',
                color: '#fff', fontWeight: 700, fontSize: 12,
                fontFamily: 'var(--font-display), sans-serif',
                letterSpacing: '0.1em', textTransform: 'uppercase',
                cursor: 'pointer', flexShrink: 0,
                transition: 'transform 0.15s, box-shadow 0.2s',
              }}
              onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.boxShadow = '0 8px 24px var(--red-glow)'; el.style.transform = 'translateY(-1px)' }}
              onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.boxShadow = 'none'; el.style.transform = 'translateY(0)' }}
            >
              + Add credits
            </button>
          </div>

          {/* ── Tabs ── */}
          <div style={{
            display: 'flex', gap: 0, marginBottom: 32,
            borderBottom: '1px solid var(--border)',
          }}>
            {([['xcreates', '✦ XCreates'], ['votes', '⊞ Votes'], ['credits', '◈ Credits'], ['stats', '◎ Stats']] as [Tab, string][]).map(([t, label]) => {
              const active = tab === t
              return (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  style={{
                    padding: '12px 20px', background: 'transparent', border: 'none',
                    borderBottom: active ? '2px solid var(--red)' : '2px solid transparent',
                    color: active ? 'var(--white)' : 'var(--muted2)',
                    fontWeight: active ? 700 : 500,
                    fontSize: 11,
                    fontFamily: 'var(--font-mono), monospace',
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                    marginBottom: -1,
                    transition: 'color 0.2s, border-color 0.2s',
                  }}
                  onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.color = 'var(--white)' }}
                  onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.color = 'var(--muted2)' }}
                >
                  {label}
                </button>
              )
            })}
          </div>

          {/* ── XCreates tab ── */}
          {tab === 'xcreates' && (
            xcreates.length === 0
              ? <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 60, fontSize: 13 }}>No XCreates yet — head to XCreate to start.</div>
              : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
                  {xcreates.map(item => {
                    const slots   = (item.slots ?? []).filter(Boolean)
                    const mode    = item.mode
                    const modeColor = mode === 'video' ? '#34d399' : mode === 'image' ? '#a78bfa' : '#4a9eff'
                    const chosen  = slots.find((s: any) => s.id === item.chosen_model_id)
                    const preview = chosen ?? slots[0]
                    return (
                      <div
                        key={item.id}
                        style={{
                          background: 'var(--surface)',
                          border: '1px solid var(--border2)',
                          borderRadius: 10,
                          overflow: 'hidden',
                          transition: 'border-color 0.2s, transform 0.2s',
                        }}
                        onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'var(--red)'; el.style.transform = 'translateY(-2px)' }}
                        onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'var(--border2)'; el.style.transform = 'translateY(0)' }}
                      >
                        {preview && (
                          preview.isVideo
                            ? <video src={preview.text} muted loop playsInline style={{ width: '100%', maxHeight: 160, objectFit: 'cover', display: 'block' }} />
                            : preview.isImage
                            ? <img src={preview.text} alt="" onClick={() => setLightbox(preview.text)} style={{ width: '100%', maxHeight: 160, objectFit: 'cover', display: 'block', cursor: 'zoom-in' }} />
                            : <div style={{ padding: '14px 14px 4px', fontSize: 11, color: 'var(--muted2)', lineHeight: 1.65, maxHeight: 90, overflow: 'hidden', maskImage: 'linear-gradient(to bottom, black 55%, transparent)', WebkitMaskImage: 'linear-gradient(to bottom, black 55%, transparent)' }}>{preview.text?.slice(0, 180)}</div>
                        )}
                        <div style={{ padding: '12px 14px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                            <span style={{
                              fontSize: 9, fontWeight: 700, color: modeColor,
                              background: modeColor + '18',
                              padding: '3px 8px', borderRadius: 3,
                              textTransform: 'uppercase' as const,
                              letterSpacing: '0.1em',
                              fontFamily: 'var(--font-mono), monospace',
                            }}>{mode}</span>
                            <span style={{
                              fontSize: 10, color: 'var(--muted2)', marginLeft: 'auto',
                              fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.04em',
                            }}>{new Date(item.created_at).toLocaleDateString()}</span>
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.4 }}>{item.prompt}</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
          )}

          {/* ── Votes tab ── */}
          {tab === 'votes' && (
            votes.length === 0
              ? <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 60, fontSize: 13 }}>No votes yet — head to XDuel to start voting.</div>
              : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {votes.map((v: any) => {
                    const duel = v.duels
                    return (
                      <a key={v.id} href={`/duel/${v.duel_id}`} style={{ textDecoration: 'none' }}>
                        <div
                          style={{
                            background: 'var(--surface)', border: '1px solid var(--border2)',
                            borderRadius: 8, padding: '14px 18px',
                            display: 'flex', alignItems: 'center', gap: 16,
                            transition: 'border-color 0.2s, background 0.2s',
                          }}
                          onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'var(--red)'; el.style.background = 'var(--surface2)' }}
                          onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'var(--border2)'; el.style.background = 'var(--surface)' }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, color: 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 4, fontWeight: 500 }}>
                              {duel?.prompt ?? 'Duel'}
                            </div>
                            <div style={{
                              fontSize: 10, color: 'var(--muted2)',
                              fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.08em',
                              textTransform: 'uppercase',
                            }}>
                              {duel?.mode ?? 'text'}  ·  {new Date(v.created_at).toLocaleDateString()}
                            </div>
                          </div>
                          {v.winner_model_id
                            ? <span style={{
                                fontSize: 9, fontWeight: 700, color: 'var(--green)',
                                background: 'var(--green-dim)',
                                padding: '4px 10px', borderRadius: 3, flexShrink: 0,
                                fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.1em',
                                textTransform: 'uppercase',
                              }}>Voted</span>
                            : <span style={{
                                fontSize: 9, fontWeight: 700, color: 'var(--muted2)',
                                background: 'var(--surface2)',
                                padding: '4px 10px', borderRadius: 3, flexShrink: 0,
                                fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.1em',
                                textTransform: 'uppercase',
                              }}>Tie</span>
                          }
                        </div>
                      </a>
                    )
                  })}
                </div>
          )}

          {/* ── Credits tab ──
              Rendered as a proper striped ledger: one bordered container,
              row dividers instead of per-row borders, alternating row
              background for legibility, mono numerics pinned to the right. */}
          {tab === 'credits' && (
            txns.length === 0
              ? <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 72, fontSize: 13, border: '1px dashed var(--border2)', borderRadius: 10 }}>
                  No credit activity yet. Grants and purchases will appear here.
                </div>
              : <div style={{
                  border: '1px solid var(--border2)',
                  borderRadius: 10,
                  overflow: 'hidden',
                  background: 'var(--surface)',
                }}>
                  {/* Column headers */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '160px 110px 1fr 130px 130px',
                    fontSize: 9, color: 'var(--muted2)',
                    textTransform: 'uppercase' as const, letterSpacing: '0.12em',
                    fontFamily: 'var(--font-mono), monospace', fontWeight: 700,
                    padding: '14px 20px',
                    background: 'var(--surface2)',
                    borderBottom: '1px solid var(--border2)',
                  }}>
                    <div>Date</div>
                    <div>Type</div>
                    <div>Description</div>
                    <div style={{ textAlign: 'right' }}>Amount</div>
                    <div style={{ textAlign: 'right' }}>Balance</div>
                  </div>
                  {txns.map((t, idx) => {
                    const positive = t.amount_cents >= 0
                    const color = positive ? 'var(--green)' : 'var(--red)'
                    const zebra = idx % 2 === 1
                    return (
                      <div
                        key={t.id}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '160px 110px 1fr 130px 130px',
                          alignItems: 'center',
                          padding: '13px 20px',
                          background: zebra ? 'var(--bg)' : 'transparent',
                          borderBottom: idx === txns.length - 1 ? 'none' : '1px solid var(--border)',
                          fontSize: 12,
                          transition: 'background 0.15s',
                        }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface2)'}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = zebra ? 'var(--bg)' : 'transparent'}
                      >
                        <div style={{ color: 'var(--muted2)', fontFamily: 'var(--font-mono), monospace', fontSize: 11, letterSpacing: '0.02em' }}>
                          {new Date(t.created_at).toLocaleDateString()}
                          {' '}
                          <span style={{ color: 'var(--muted)' }}>
                            {new Date(t.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div>
                          <span style={{
                            display: 'inline-block', padding: '3px 9px', borderRadius: 3,
                            fontSize: 9, fontWeight: 700,
                            background: color === 'var(--green)' ? 'var(--green-dim)' : 'var(--red-dim)',
                            color,
                            fontFamily: 'var(--font-mono), monospace',
                            letterSpacing: '0.1em',
                            textTransform: 'uppercase',
                          }}>{KIND_LABELS[t.kind]}</span>
                        </div>
                        <div style={{ color: 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 12 }}>
                          {t.description ?? (t.reference_type ? `${t.reference_type}${t.reference_id ? ` · ${t.reference_id}` : ''}` : '—')}
                        </div>
                        <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono), monospace', fontWeight: 700, color, fontSize: 12, letterSpacing: '0.02em' }}>
                          {positive ? '+' : ''}{formatCents(t.amount_cents)}
                        </div>
                        <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono), monospace', color: 'var(--muted2)', fontSize: 12, letterSpacing: '0.02em' }}>
                          {formatCents(t.balance_after_cents)}
                        </div>
                      </div>
                    )
                  })}
                </div>
          )}

          {/* ── Stats tab ──
              Three-column grid of numeric callouts in the display font.
              Each card has a 3px accent edge in its category color (matching
              the balance card treatment above) so the categories read as
              related but distinct. */}
          {tab === 'stats' && stats && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
              {[
                { label: 'XDuels Created', value: stats.duels,    color: 'var(--red)',  num: '01' },
                { label: 'XCreates',       value: stats.xcreates, color: '#8b5cf6',     num: '02' },
                { label: 'Votes Cast',     value: stats.votes,    color: 'var(--green)', num: '03' },
              ].map(s => (
                <div
                  key={s.label}
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border2)',
                    borderTop: `3px solid ${s.color}`,
                    borderRadius: '2px 2px 10px 10px',
                    padding: '28px 24px 24px',
                    position: 'relative',
                  }}
                >
                  <div style={{
                    position: 'absolute', top: 14, right: 16,
                    fontFamily: 'var(--font-mono), monospace',
                    fontSize: 9, color: 'var(--muted)', letterSpacing: '0.15em',
                  }}>{s.num}</div>
                  <div style={{
                    fontFamily: 'var(--font-display), sans-serif',
                    fontSize: 56, fontWeight: 900, color: s.color,
                    lineHeight: 0.95, letterSpacing: '-0.03em',
                    marginBottom: 12,
                  }}>{s.value}</div>
                  <div style={{
                    fontSize: 10, color: 'var(--muted2)',
                    fontFamily: 'var(--font-mono), monospace',
                    letterSpacing: '0.15em', textTransform: 'uppercase',
                  }}>{s.label}</div>
                </div>
              ))}
            </div>
          )}

        </div>
      </div>

      {/* ── Checkout tier picker modal ──────────────────────────────────
          Shown when the user clicks "+ Add credits". Picks a fixed tier
          and POSTs /api/stripe/checkout, then redirects the browser to
          the Stripe-hosted session. */}
      {checkoutOpen && (
        <div
          onClick={() => !checkoutTier && setCheckoutOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(15, 15, 15, 0.35)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20,
            animation: 'fadeIn 0.15s ease-out',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--border2)',
              borderLeft: '3px solid var(--red)',
              borderRadius: 10,
              padding: '28px 28px 22px',
              maxWidth: 520, width: '100%',
              boxShadow: '0 24px 80px rgba(15, 15, 15, 0.18), 0 2px 8px rgba(15, 15, 15, 0.06)',
            }}
          >
            {/* Eyebrow + close */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                fontFamily: 'var(--font-mono), monospace',
                fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase',
                color: 'var(--red)', fontWeight: 600,
              }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--red)' }} />
                Top up · USD
              </div>
              <button
                onClick={() => !checkoutTier && setCheckoutOpen(false)}
                disabled={!!checkoutTier}
                style={{
                  background: 'transparent', border: 'none',
                  color: 'var(--muted2)', cursor: checkoutTier ? 'default' : 'pointer',
                  fontSize: 22, lineHeight: 1, padding: 0,
                  fontFamily: 'var(--font-mono), monospace',
                }}
                aria-label="Close"
              >×</button>
            </div>

            {/* Display heading */}
            <h2 style={{
              fontSize: 32, fontWeight: 900, color: 'var(--white)', margin: '8px 0 6px',
              fontFamily: 'var(--font-display), serif',
              letterSpacing: '-0.02em', lineHeight: 1.05,
            }}>
              Add credits
            </h2>
            <div style={{
              fontSize: 12, color: 'var(--muted2)', marginBottom: 22, lineHeight: 1.6,
              fontFamily: 'var(--font-body), sans-serif',
            }}>
              Pick a top-up amount. You'll be redirected to Stripe to pay. Test card{' '}
              <code style={{
                background: 'var(--surface2)', padding: '2px 7px', borderRadius: 3,
                fontSize: 10.5, fontFamily: 'var(--font-mono), monospace',
                letterSpacing: '0.04em', color: 'var(--white)',
                border: '1px solid var(--border)',
              }}>4242 4242 4242 4242</code> works in dev.
            </div>

            {/* Tier grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
              {DISPLAY_TIERS.map((t, idx) => {
                const isSelected = checkoutTier === t.id
                const isDimmed = checkoutTier !== null && !isSelected
                return (
                  <button
                    key={t.id}
                    onClick={() => startCheckout(t.id)}
                    disabled={!!checkoutTier}
                    style={{
                      textAlign: 'left' as const,
                      position: 'relative' as const,
                      padding: '18px 18px 16px',
                      background: isSelected ? 'var(--red-dim)' : 'var(--surface)',
                      border: `1px solid ${isSelected ? 'var(--red)' : 'var(--border2)'}`,
                      borderRadius: 8,
                      cursor: checkoutTier ? 'default' : 'pointer',
                      opacity: isDimmed ? 0.4 : 1,
                      transition: 'all 0.15s ease-out',
                      overflow: 'hidden' as const,
                    }}
                    onMouseEnter={e => {
                      if (!checkoutTier) {
                        const el = e.currentTarget as HTMLElement
                        el.style.borderColor = 'var(--red)'
                        el.style.background = 'var(--red-dim)'
                        el.style.transform = 'translateY(-1px)'
                      }
                    }}
                    onMouseLeave={e => {
                      if (!checkoutTier) {
                        const el = e.currentTarget as HTMLElement
                        el.style.borderColor = 'var(--border2)'
                        el.style.background = 'var(--surface)'
                        el.style.transform = 'translateY(0)'
                      }
                    }}
                  >
                    {/* Corner numeral */}
                    <div style={{
                      position: 'absolute' as const,
                      top: 10, right: 12,
                      fontFamily: 'var(--font-mono), monospace',
                      fontSize: 9, letterSpacing: '0.12em',
                      color: 'var(--muted2)', fontWeight: 600,
                    }}>
                      0{idx + 1}
                    </div>

                    <div style={{
                      fontSize: 28, fontWeight: 900, color: 'var(--white)',
                      fontFamily: 'var(--font-display), serif',
                      letterSpacing: '-0.02em', lineHeight: 1,
                      marginBottom: 6,
                    }}>
                      {t.label}
                    </div>
                    <div style={{
                      fontSize: 10.5, color: 'var(--muted2)',
                      fontFamily: 'var(--font-mono), monospace',
                      letterSpacing: '0.06em', textTransform: 'uppercase' as const,
                      lineHeight: 1.4,
                    }}>
                      {t.description}
                    </div>
                  </button>
                )
              })}
            </div>

            {checkoutTier && (
              <div style={{
                marginTop: 18, padding: '10px 0',
                fontSize: 10, color: 'var(--red)',
                fontFamily: 'var(--font-mono), monospace',
                letterSpacing: '0.18em', textTransform: 'uppercase' as const,
                textAlign: 'center' as const, fontWeight: 600,
                borderTop: '1px solid var(--border)',
              }}>
                <span style={{
                  display: 'inline-block', width: 5, height: 5, borderRadius: '50%',
                  background: 'var(--red)', marginRight: 8, verticalAlign: 'middle',
                  animation: 'pulse 1.2s ease-in-out infinite',
                }} />
                Redirecting to Stripe
              </div>
            )}

            {!checkoutTier && (
              <div style={{
                marginTop: 20, paddingTop: 14, borderTop: '1px solid var(--border)',
                fontSize: 9, color: 'var(--muted2)',
                fontFamily: 'var(--font-mono), monospace',
                letterSpacing: '0.14em', textTransform: 'uppercase' as const,
                textAlign: 'center' as const,
              }}>
                Secure payment via Stripe · No subscription
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
