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
  deepseek: '#4a9eff', meta: '#0668e1',
  mistral: '#ff7000', bfl: '#a78bfa', recraft: '#34d399',
}
const providerColor = (p: string) => PROVIDER_COLORS[p?.toLowerCase()] ?? '#888'

interface Profile {
  id: string
  display_name: string | null
  bio: string | null
  avatar_url: string | null
}

type Tab = 'duels' | 'xcreates' | 'votes' | 'stats' | 'activities'

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
  const [user,        setUser]        = useState<any>(null)
  const [profile,     setProfile]     = useState<Profile | null>(null)
  const [tab,         setTab]         = useState<Tab>('duels')
  const [duels,       setDuels]       = useState<any[]>([])
  const [xcreates,    setXcreates]    = useState<any[]>([])
  const [votes,       setVotes]       = useState<any[]>([])
  // Per-tab "has fetched at least once" flags. Initial render of an empty
  // array would otherwise show "No X yet" before the first fetch resolved,
  // making it look like the user has nothing when really we just haven't
  // asked the server yet.
  const [tabsLoaded,  setTabsLoaded]  = useState<{ duels: boolean; xcreates: boolean; votes: boolean }>({
    duels: false, xcreates: false, votes: false,
  })
  // XCreate pagination — 12 cards per page, server-side `range` so we
  // don't load the entire history into the browser when a user has
  // hundreds of runs.
  const XCREATES_PAGE_SIZE = 12
  const [xcreatePage, setXcreatePage] = useState(0)
  const [xcreateTotal, setXcreateTotal] = useState<number | null>(null)
  // XCreate type filter — 'all' shows every mode, otherwise filters the
  // already-loaded cache client-side. Filter clicks don't trigger a
  // re-fetch; the Refresh button below does.
  const [xcreateFilter, setXcreateFilter] = useState<'all' | 'text' | 'image' | 'video'>('all')
  // Bump this to force a re-fetch (Refresh button). Adding it to the
  // tabs effect's deps means setting `xcreateRefreshTick + 1` triggers
  // exactly one new fetch without disturbing filter/page state.
  const [xcreateRefreshTick, setXcreateRefreshTick] = useState(0)
  const [stats,       setStats]       = useState<any>(null)
  const [deleting,    setDeleting]    = useState<string | null>(null)
  const [copyId,      setCopyId]      = useState<string | null>(null)
  const [deleteModal, setDeleteModal] = useState<{ type: 'duel' | 'xcreate'; id: string; prompt: string } | null>(null)
  const [lightbox,    setLightbox]    = useState<string | null>(null)
  // XCreate output-preview modal — shows the chosen slot's full text /
  // image / video without leaving the profile page. The conversation view
  // (/xcreate?id=...) is reached via the per-card "Detail" button.
  const [previewItem, setPreviewItem] = useState<any | null>(null)
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
      rx += (mx-rx)*0.35; ry += (my-ry)*0.35
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

      const { data: c } = await client.from('user_credits').select('*').eq('user_id', u.id).maybeSingle()
      setCredits((c as UserCredits | null) ?? null)
    })
  }, [])

  // Show delete confirmation modal
  const handleDelete = (type: 'duel' | 'xcreate', id: string, prompt?: string) => {
    setDeleteModal({ type, id, prompt: prompt ?? '' })
  }

  // Actually perform the soft-delete after user confirms via modal
  const confirmDelete = async () => {
    if (!deleteModal) return
    const { type, id } = deleteModal
    setDeleteModal(null)
    setDeleting(id)
    try {
      const res = await fetch('/api/profile/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, id }),
      })
      if (res.ok) {
        if (type === 'duel') setDuels(prev => prev.filter(d => d.id !== id))
        else setXcreates(prev => prev.filter(x => x.id !== id))
      }
    } catch { /* silent */ }
    setDeleting(null)
  }

  // Copy permalink
  const handleShare = (type: 'duel' | 'xcreate', id: string) => {
    const url = type === 'duel'
      ? `${window.location.origin}/duel/${id}`
      : `${window.location.origin}/xcreate?id=${id}`
    navigator.clipboard.writeText(url).then(() => {
      setCopyId(id)
      setTimeout(() => setCopyId(null), 2000)
    })
  }

  // Load tab data
  useEffect(() => {
    if (!user) return
    const client = sb()
    const markLoaded = (k: 'duels' | 'xcreates' | 'votes') =>
      setTabsLoaded(prev => ({ ...prev, [k]: true }))
    if (tab === 'duels') {
      // Try with deleted_at filter; fall back if column doesn't exist yet.
      client.from('duels').select('*').eq('user_id', user.id).is('deleted_at', null)
        .order('created_at', { ascending: false }).limit(50)
        .then(({ data, error }) => {
          if (error) {
            // Fallback: deleted_at column doesn't exist yet
            client.from('duels').select('*').eq('user_id', user.id)
              .order('created_at', { ascending: false }).limit(50)
              .then(({ data: fb }) => { setDuels(fb ?? []); markLoaded('duels') })
          } else {
            setDuels(data ?? []); markLoaded('duels')
          }
        })
    } else if (tab === 'xcreates') {
      // Pull a fat slice (up to 200 rows) once per tab visit and do
      // both filtering and pagination client-side from this cache. Filter
      // clicks then feel instant. A manual "Refresh" button re-runs this
      // same fetch when the user wants fresh data. Past ~200 rows we'd
      // need to fall back to server-paged fetching, but that's a future-
      // problem — today's users have far fewer runs than that.
      ;(async () => {
        let rows: any[] = []
        const { data, error } = await client.from('xcreates').select('*').eq('user_id', user.id).is('deleted_at', null)
          .order('created_at', { ascending: false }).limit(200)
        if (error) {
          // Fallback for DBs that don't have `deleted_at` yet.
          const { data: fb } = await client.from('xcreates').select('*').eq('user_id', user.id)
            .order('created_at', { ascending: false }).limit(200)
          rows = fb ?? []
        } else {
          rows = data ?? []
        }
        // Re-sign every slot's stored image/video URL so expired tokens
        // don't show up as broken images in the gallery. The browser
        // client is authenticated; RLS scopes signing to files the user
        // owns. We parse `/storage/v1/object/sign/<bucket>/<path>?token`
        // out of the existing URL to find what to re-sign.
        const refreshed = await Promise.all(rows.map(async row => {
          const slots = (row.slots ?? []) as any[]
          const newSlots = await Promise.all(slots.map(async (s: any) => {
            if (!s?.text || typeof s.text !== 'string') return s
            // Slot.text can be a single URL or newline-separated URLs (multi-image).
            const parts = s.text.split('\n')
            const fresh = await Promise.all(parts.map(async (part: string) => {
              const m = part.match(/\/storage\/v1\/object\/sign\/([^/]+)\/([^?]+)/)
              if (!m) return part   // Not a Supabase signed URL — leave as-is.
              const [, bucket, path] = m
              const { data: signed } = await client.storage.from(bucket).createSignedUrl(decodeURIComponent(path), 60 * 60 * 24)
              return signed?.signedUrl ?? part
            }))
            return { ...s, text: fresh.join('\n') }
          }))
          return { ...row, slots: newSlots }
        }))
        setXcreates(refreshed)
        setXcreateTotal(refreshed.length)
        markLoaded('xcreates')
      })()
    } else if (tab === 'votes') {
      // Try duel_votes table; fall back to showing user's own duels that have votes.
      client.from('duel_votes').select('*, duels(id, prompt, mode, slots)').eq('user_id', user.id)
        .order('created_at', { ascending: false }).limit(50)
        .then(({ data, error }) => {
          if (error) {
            // duel_votes table doesn't exist yet — show own duels with votes
            client.from('duels').select('*').eq('user_id', user.id).not('vote1', 'is', null)
              .order('created_at', { ascending: false }).limit(50)
              .then(({ data: fb }) => {
                // Reshape to match expected format
                setVotes((fb ?? []).map((d: any) => ({
                  id: d.id, duel_id: d.id, vote_choice: d.vote1,
                  created_at: d.created_at, duels: { id: d.id, prompt: d.prompt, mode: d.mode, slots: d.slots },
                })))
                markLoaded('votes')
              })
          } else {
            setVotes(data ?? []); markLoaded('votes')
          }
        })
    } else if (tab === 'stats') {
      Promise.all([
        client.from('xcreates').select('id', { count: 'exact' }).eq('user_id', user.id),
        client.from('duels').select('id', { count: 'exact' }).eq('user_id', user.id),
        client.from('duel_votes').select('id', { count: 'exact' }).eq('user_id', user.id)
          .then(r => r.error ? { count: 0 } : r),  // fallback if table missing
      ]).then(([c, d, v]) => {
        setStats({ xcreates: c.count ?? 0, duels: d.count ?? 0, votes: v.count ?? 0 })
      })
    } else if (tab === 'activities') {
      // Latest 100 ledger entries. RLS restricts to the signed-in user.
      client.from('credit_transactions').select('*').eq('user_id', user.id)
        .order('created_at', { ascending: false }).limit(100)
        .then(({ data }) => setTxns((data ?? []) as CreditTransaction[]))
      // Refresh balance at the same time in case a debit just landed.
      client.from('user_credits').select('*').eq('user_id', user.id).maybeSingle()
        .then(({ data: c }) => setCredits((c as UserCredits | null) ?? null))
    }
  // xcreateRefreshTick is a dep so bumping it manually re-fetches the
  // 200-row xcreate cache. Filter + pagination are now both client-side
  // so they intentionally don't appear here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, user, xcreateRefreshTick])

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
        if (tab === 'activities') {
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
        <div onClick={() => setLightbox(null)} style={{position:'fixed',inset:0,zIndex:99000,background:'rgba(0,0,0,0.92)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer'}}>
          <img src={lightbox} alt="Full size" onClick={() => setLightbox(null)} style={{maxWidth:'90vw',maxHeight:'90vh',borderRadius:8,boxShadow:'0 0 80px rgba(0,0,0,0.8)',cursor:'pointer'}} />
          <div onClick={e => e.stopPropagation()} style={{position:'fixed',top:20,right:24,zIndex:99100,display:'flex',gap:10}}>
            <a href={lightbox} download target="_blank" rel="noreferrer" title="Download"
              style={{display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(255,255,255,0.15)',border:'1px solid rgba(255,255,255,0.3)',borderRadius:8,width:36,height:36,color:'#fff',fontSize:16,textDecoration:'none',cursor:'pointer',boxShadow:'0 2px 12px rgba(0,0,0,0.4)'}}
            >↓</a>
            <button onClick={() => setLightbox(null)} title="Close"
              style={{display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(255,255,255,0.15)',border:'1px solid rgba(255,255,255,0.3)',borderRadius:8,width:36,height:36,color:'#fff',fontSize:16,cursor:'pointer',boxShadow:'0 2px 12px rgba(0,0,0,0.4)'}}
            >✕</button>
          </div>
        </div>
      )}

      {/* ── XCreate output-preview modal ──
          Opened by clicking an XCreate card. Shows the chosen slot's
          output full-size (image / video / text) plus minimal metadata.
          The conversation history view is at /xcreate?id=... — reached
          via the Detail button on the card. */}
      {previewItem && (() => {
        const slots = (previewItem.slots ?? []).filter(Boolean)
        const chosen = slots.find((s: any) => s.id === previewItem.chosen_model_id) ?? slots[0]
        if (!chosen) return null
        const isVideo = !!chosen.isVideo
        const isImage = !!chosen.isImage
        return (
          <div onClick={() => setPreviewItem(null)}
            style={{position:'fixed',inset:0,zIndex:99000,background:'rgba(0,0,0,0.92)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:24,cursor:'pointer'}}>
            <div onClick={e => e.stopPropagation()}
              style={{maxWidth:'min(900px, 90vw)', width:'100%', display:'flex', flexDirection:'column', gap:14, cursor:'default'}}>
              {/* Output */}
              <div style={{ display:'flex', justifyContent:'center', alignItems:'center', maxHeight:'70vh', overflow:'hidden', borderRadius:10 }}>
                {isVideo ? (
                  <video src={chosen.text} controls autoPlay loop playsInline style={{maxWidth:'100%',maxHeight:'70vh',borderRadius:10,boxShadow:'0 0 80px rgba(0,0,0,0.8)'}} />
                ) : isImage ? (
                  <img src={chosen.text} alt="" style={{maxWidth:'100%',maxHeight:'70vh',borderRadius:10,boxShadow:'0 0 80px rgba(0,0,0,0.8)',display:'block'}} />
                ) : (
                  <div style={{background:'var(--bg)',color:'var(--white)',padding:'24px 28px',borderRadius:10,maxHeight:'70vh',overflow:'auto',fontSize:14,lineHeight:1.7,whiteSpace:'pre-wrap',fontFamily:'var(--font-body), sans-serif',width:'100%'}}>
                    {chosen.text}
                  </div>
                )}
              </div>
              {/* Metadata strip */}
              <div style={{ display:'flex', alignItems:'center', gap:12, color:'#ddd', fontSize:12, fontFamily:'var(--font-mono), monospace', flexWrap:'wrap' as const }}>
                <span style={{fontWeight:700}}>{chosen.name ?? chosen.model_name}</span>
                <span style={{opacity:0.6}}>·</span>
                <span style={{opacity:0.8}}>{previewItem.mode}</span>
                {chosen.responseTime != null && (<>
                  <span style={{opacity:0.6}}>·</span>
                  <span style={{opacity:0.8}}>⏱ {(Number(chosen.responseTime)/1000).toFixed(2)}s</span>
                </>)}
                {Number(chosen.cost ?? 0) > 0 && (<>
                  <span style={{opacity:0.6}}>·</span>
                  <span style={{opacity:0.8}}>${Number(chosen.cost).toFixed(4)}</span>
                </>)}
                <span style={{marginLeft:'auto', display:'flex', gap:8}}>
                  {(isImage || isVideo) && chosen.text && (
                    <a href={chosen.text} download target="_blank" rel="noreferrer"
                      style={{padding:'6px 12px',borderRadius:6,background:'rgba(255,255,255,0.12)',border:'1px solid rgba(255,255,255,0.25)',color:'#fff',textDecoration:'none',fontSize:11,fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase'}}
                    >↓ Download</a>
                  )}
                  <button
                    onClick={() => { window.open(`/xcreate?id=${previewItem.id}`, '_blank', 'noopener') }}
                    style={{padding:'6px 12px',borderRadius:6,background:'rgba(255,255,255,0.12)',border:'1px solid rgba(255,255,255,0.25)',color:'#fff',cursor:'pointer',fontSize:11,fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase',fontFamily:'var(--font-mono), monospace'}}
                  >↗ Detail</button>
                  <button onClick={() => setPreviewItem(null)}
                    style={{padding:'6px 12px',borderRadius:6,background:'rgba(255,255,255,0.12)',border:'1px solid rgba(255,255,255,0.25)',color:'#fff',cursor:'pointer',fontSize:11,fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase',fontFamily:'var(--font-mono), monospace'}}
                  >✕ Close</button>
                </span>
              </div>
            </div>
          </div>
        )
      })()}
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

          {/* ── Header row ──
              Profile block (avatar + name + email) on the left; credit
              balance card on the right of the same row. They share one
              flex parent with `flex-wrap` so the layout collapses to a
              vertical stack on narrow viewports. */}
          <div style={{
            display: 'flex', alignItems: 'flex-start',
            gap: 24, marginBottom: 44, flexWrap: 'wrap',
          }}>
            {/* Profile block */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 28, flex: '1 1 320px', minWidth: 0 }}>
              {/* Avatar (read-only) */}
              <div style={{
                width: 96, height: 96, borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
                background: profile.avatar_url ? 'transparent' : 'var(--surface2)',
                border: '1px solid var(--border2)',
                boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.04)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {profile.avatar_url
                  ? <img src={profile.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <span style={{ fontSize: 32, fontWeight: 800, color: 'var(--red)' }}>{initials}</span>
                }
              </div>

              {/* Name + email */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <h1 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 6px', letterSpacing: '-0.01em', fontFamily: 'var(--font-display), sans-serif' }}>
                  {profile.display_name ?? 'Anonymous'}
                </h1>
                <div style={{ fontSize: 11, color: 'var(--muted2)', fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.04em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.email}</div>
              </div>
            </div>

            {/* Credit balance card (right of profile) */}
            <div style={{
              position: 'relative',
              display: 'flex', alignItems: 'center', gap: 18,
              background: 'var(--surface)',
              border: '1px solid var(--border2)',
              borderLeft: '3px solid var(--red)',
              borderRadius: 10,
              padding: '18px 22px 18px 22px',
              flex: '1 1 360px', minWidth: 280,
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
                  fontSize: 32, fontWeight: 800, color: 'var(--white)',
                  fontFamily: 'var(--font-display), sans-serif',
                  lineHeight: 1, letterSpacing: '-0.02em',
                }}>
                  {credits ? formatCents(credits.balance_cents) : '$0.00'}
                </div>
                {credits && credits.lifetime_spent_cents > 0 && (
                  <div style={{
                    fontSize: 11, color: 'var(--muted2)', marginTop: 8,
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
                  padding: '12px 20px', borderRadius: 6,
                  // Slightly darker than the macOS traffic-light maximize
                  // (#28C840). The full-bright traffic-light hue ends up
                  // looking acid on a 13px UI button against the warm
                  // off-white surface — dropping ~15% lightness lands on
                  // a green that's still clearly "buy / positive" but
                  // doesn't flicker against the rest of the page.
                  background: '#1FAA34', border: 'none',
                  color: '#fff', fontWeight: 700, fontSize: 13,
                  fontFamily: 'var(--font-body), sans-serif',
                  letterSpacing: '0.06em', textTransform: 'uppercase',
                  cursor: 'pointer', flexShrink: 0,
                  transition: 'transform 0.15s, box-shadow 0.2s',
                  whiteSpace: 'nowrap' as const,
                }}
                onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.boxShadow = '0 8px 24px rgba(31,170,52,0.34)'; el.style.transform = 'translateY(-1px)' }}
                onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.boxShadow = 'none'; el.style.transform = 'translateY(0)' }}
              >
                + Add credits
              </button>
            </div>
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

          {/* ── Tabs ── */}
          <div style={{
            display: 'flex', gap: 0, marginBottom: 32,
            borderBottom: '1px solid var(--border)',
          }}>
            {([['duels', '⚔ XDuels'], ['xcreates', '✦ XCreates'], ['votes', '⊞ XVotes'], ['activities', '◈ Activities'], ['stats', '◎ Stats']] as [Tab, string][]).map(([t, label]) => {
              const active = tab === t
              return (
                <button
                  key={t}
                  onClick={() => { setTab(t); if (t === 'xcreates') setXcreatePage(0) }}
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

          {/* ── XDuels tab ── */}
          {tab === 'duels' && (
            !tabsLoaded.duels
              ? <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 60, fontSize: 13 }}>Loading…</div>
              : duels.length === 0
              ? <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 60, fontSize: 13 }}>No XDuels yet — head to XDuel to start.</div>
              : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
                  {duels.map(item => {
                    const slots   = (item.slots ?? []).filter(Boolean)
                    const mode    = item.mode
                    const modeColor = mode === 'video' ? '#34d399' : mode === 'image' ? '#a78bfa' : '#4a9eff'
                    const preview = slots[0]
                    const isDel   = deleting === item.id
                    const copied  = copyId === item.id
                    return (
                      <div
                        key={item.id}
                        style={{
                          background: 'var(--surface)',
                          border: '1px solid var(--border2)',
                          borderRadius: 10,
                          overflow: 'hidden',
                          transition: 'border-color 0.2s, transform 0.2s',
                          opacity: isDel ? 0.4 : 1,
                        }}
                        onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'var(--red)'; el.style.transform = 'translateY(-2px)' }}
                        onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'var(--border2)'; el.style.transform = 'translateY(0)' }}
                      >
                        {preview && (
                          <a href={`/duel/${item.id}`} style={{ textDecoration: 'none' }}>
                            {preview.isVideo
                              ? <video src={preview.text} muted loop playsInline style={{ width: '100%', maxHeight: 160, objectFit: 'cover', display: 'block' }} />
                              : preview.isImage
                              ? <img src={preview.text} alt="" style={{ width: '100%', maxHeight: 160, objectFit: 'cover', display: 'block' }} />
                              : <div style={{ padding: '14px 14px 4px', fontSize: 11, color: 'var(--muted2)', lineHeight: 1.65, maxHeight: 90, overflow: 'hidden', maskImage: 'linear-gradient(to bottom, black 55%, transparent)', WebkitMaskImage: 'linear-gradient(to bottom, black 55%, transparent)' }}>{preview.text?.slice(0, 180)}</div>
                            }
                          </a>
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
                          <div style={{ fontSize: 12, color: 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.4, marginBottom: 8 }}>{item.prompt}</div>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              onClick={() => handleShare('duel', item.id)}
                              style={{
                                flex: 1, padding: '6px 0', borderRadius: 5,
                                background: 'transparent', border: '1px solid var(--border2)',
                                color: copied ? 'var(--green)' : 'var(--muted2)', fontSize: 10, fontWeight: 600, cursor: 'pointer',
                                fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.08em', textTransform: 'uppercase',
                                transition: 'all 0.15s',
                              }}
                            >{copied ? '✓ Copied' : '↗ Share'}</button>
                            <button
                              onClick={() => handleDelete('duel', item.id, item.prompt)}
                              disabled={isDel}
                              style={{
                                flex: 1, padding: '6px 0', borderRadius: 5,
                                background: 'transparent', border: '1px solid var(--border2)',
                                color: 'var(--red)', fontSize: 10, fontWeight: 600, cursor: isDel ? 'default' : 'pointer',
                                fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.08em', textTransform: 'uppercase',
                                transition: 'all 0.15s', opacity: isDel ? 0.5 : 1,
                              }}
                            >{isDel ? '…' : '✕ Delete'}</button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
          )}

          {/* ── XCreates tab ── */}
          {tab === 'xcreates' && (() => {
            // Filter + paginate the cached list client-side. Switching the
            // filter is instant (no network round-trip); Refresh button
            // below triggers a re-fetch into `xcreates` state.
            const filteredAll = xcreateFilter === 'all'
              ? xcreates
              : xcreates.filter((x: any) => x.mode === xcreateFilter)
            const pagedFrom    = xcreatePage * XCREATES_PAGE_SIZE
            const pagedTo      = pagedFrom + XCREATES_PAGE_SIZE
            const visibleSlice = filteredAll.slice(pagedFrom, pagedTo)
            return (
            <>
              {/* Toolbar: filter pills on the left, Refresh button on the
                  right. Filter clicks are instant; Refresh re-fetches the
                  cache. */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                marginBottom: 16, flexWrap: 'wrap' as const,
              }}>
                {([
                  { id: 'all',   label: 'All',   color: 'var(--muted2)' },
                  { id: 'text',  label: 'Text',  color: '#4a9eff' },
                  { id: 'image', label: 'Image', color: '#a78bfa' },
                  { id: 'video', label: 'Video', color: '#34d399' },
                ] as const).map(opt => {
                  const active = xcreateFilter === opt.id
                  return (
                    <button key={opt.id}
                      onClick={() => { setXcreateFilter(opt.id); setXcreatePage(0) }}
                      style={{
                        padding: '6px 14px', borderRadius: 999,
                        background: active ? opt.color + '22' : 'transparent',
                        border: `1px solid ${active ? opt.color + '88' : 'var(--border2)'}`,
                        color: active ? opt.color : 'var(--muted2)',
                        fontSize: 11, fontWeight: 700,
                        fontFamily: 'var(--font-mono), monospace',
                        letterSpacing: '0.1em', textTransform: 'uppercase',
                        cursor: 'pointer', transition: 'all 0.15s',
                      }}
                    >
                      {opt.label}
                    </button>
                  )
                })}
                <button
                  onClick={() => { setXcreateRefreshTick(t => t + 1) }}
                  style={{
                    marginLeft: 'auto',
                    padding: '6px 14px', borderRadius: 999,
                    background: 'transparent', border: '1px solid var(--border2)',
                    color: 'var(--muted2)', fontSize: 11, fontWeight: 700,
                    fontFamily: 'var(--font-mono), monospace',
                    letterSpacing: '0.1em', textTransform: 'uppercase',
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}
                  title="Re-fetch the latest from the server"
                >
                  ↻ Refresh
                </button>
              </div>
              {!tabsLoaded.xcreates ? (
                <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 60, fontSize: 13 }}>Loading…</div>
              ) : visibleSlice.length === 0 ? (
                <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 60, fontSize: 13 }}>
                  {xcreateFilter === 'all'
                    ? 'No XCreates yet — head to XCreate to start.'
                    : `No ${xcreateFilter} XCreates yet.`}
                </div>
              ) : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
                  {visibleSlice.map(item => {
                    const slots   = (item.slots ?? []).filter(Boolean)
                    const mode    = item.mode
                    const modeColor = mode === 'video' ? '#34d399' : mode === 'image' ? '#a78bfa' : '#4a9eff'
                    const chosen  = slots.find((s: any) => s.id === item.chosen_model_id)
                    const preview = chosen ?? slots[0]
                    const isDel   = deleting === item.id
                    const copied  = copyId === item.id
                    return (
                      <div
                        key={item.id}
                        // Default click opens the output-preview modal so the
                        // user can see their generation full-size without
                        // leaving the page. The "Detail" button below
                        // opens the conversation view (xcreate?id=...).
                        // Inner buttons stop propagation.
                        onClick={() => setPreviewItem(item)}
                        style={{
                          background: 'var(--surface)',
                          border: '1px solid var(--border2)',
                          borderRadius: 10,
                          overflow: 'hidden',
                          transition: 'border-color 0.2s, transform 0.2s',
                          opacity: isDel ? 0.4 : 1,
                          cursor: 'pointer',
                        }}
                        onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'var(--red)'; el.style.transform = 'translateY(-2px)' }}
                        onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'var(--border2)'; el.style.transform = 'translateY(0)' }}
                      >
                        {preview && (
                          preview.isVideo
                            ? <video src={preview.text} muted loop playsInline style={{ width: '100%', maxHeight: 160, objectFit: 'cover', display: 'block' }} />
                            : preview.isImage
                            ? <img src={preview.text} alt="" onClick={e => { e.stopPropagation(); setLightbox(preview.text) }} style={{ width: '100%', maxHeight: 160, objectFit: 'cover', display: 'block', cursor: 'zoom-in' }} />
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
                          <div style={{ fontSize: 12, color: 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.4, marginBottom: 8 }}>{item.prompt}</div>
                          <div style={{ display: 'flex', gap: 6 }}>
                            {/* No Share button on XCreates — they're a private studio.
                                Detail opens the conversation view (xcreate?id=...);
                                Delete removes the run. */}
                            <button
                              onClick={e => { e.stopPropagation(); window.open(`/xcreate?id=${item.id}`, '_blank', 'noopener') }}
                              style={{
                                flex: 1, padding: '6px 0', borderRadius: 5,
                                background: 'transparent', border: '1px solid var(--border2)',
                                color: 'var(--muted2)', fontSize: 10, fontWeight: 600, cursor: 'pointer',
                                fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.08em', textTransform: 'uppercase',
                                transition: 'all 0.15s',
                              }}
                            >↗ Detail</button>
                            <button
                              onClick={e => { e.stopPropagation(); handleDelete('xcreate', item.id, item.prompt) }}
                              disabled={isDel}
                              style={{
                                flex: 1, padding: '6px 0', borderRadius: 5,
                                background: 'transparent', border: '1px solid var(--border2)',
                                color: 'var(--red)', fontSize: 10, fontWeight: 600, cursor: isDel ? 'default' : 'pointer',
                                fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.08em', textTransform: 'uppercase',
                                transition: 'all 0.15s', opacity: isDel ? 0.5 : 1,
                              }}
                            >{isDel ? '…' : '✕ Delete'}</button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>}
              {/* Pagination footer — computed off the filtered slice so
                  pagination shrinks/grows with the active filter. */}
              {tabsLoaded.xcreates && filteredAll.length > XCREATES_PAGE_SIZE && (() => {
                const totalPages = Math.ceil(filteredAll.length / XCREATES_PAGE_SIZE)
                const canPrev = xcreatePage > 0
                const canNext = xcreatePage < totalPages - 1
                const btn = (label: string, enabled: boolean, onClick: () => void) => (
                  <button onClick={onClick} disabled={!enabled} style={{
                    padding: '8px 16px', borderRadius: 6,
                    background: enabled ? 'var(--surface)' : 'transparent',
                    border: '1px solid var(--border2)',
                    color: enabled ? 'var(--white)' : 'var(--muted)',
                    fontSize: 12, fontWeight: 600,
                    fontFamily: 'var(--font-mono), monospace',
                    letterSpacing: '0.06em', textTransform: 'uppercase',
                    cursor: enabled ? 'pointer' : 'default',
                    opacity: enabled ? 1 : 0.4,
                    transition: 'border-color 0.15s, background 0.15s',
                  }}>{label}</button>
                )
                return (
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 24 }}>
                    {btn('← Prev', canPrev, () => setXcreatePage(p => Math.max(0, p - 1)))}
                    <span style={{ fontSize: 12, color: 'var(--muted2)', fontFamily: 'var(--font-mono), monospace' }}>
                      Page {xcreatePage + 1} of {totalPages}
                    </span>
                    {btn('Next →', canNext, () => setXcreatePage(p => Math.min(totalPages - 1, p + 1)))}
                  </div>
                )
              })()}
            </>
            )
          })()}

          {/* ── Votes tab ── */}
          {tab === 'votes' && (
            !tabsLoaded.votes
              ? <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 60, fontSize: 13 }}>Loading…</div>
              : votes.length === 0
              ? <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 60, fontSize: 13 }}>No votes yet — head to the Vote page to start voting on community duels.</div>
              : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {votes.map((v: any) => {
                    const duel = v.duels
                    const isTie = v.vote_choice === 'T'
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
                          {isTie
                            ? <span style={{
                                fontSize: 9, fontWeight: 700, color: 'var(--muted2)',
                                background: 'var(--surface2)',
                                padding: '4px 10px', borderRadius: 3, flexShrink: 0,
                                fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.1em',
                                textTransform: 'uppercase',
                              }}>Tie</span>
                            : <span style={{
                                fontSize: 9, fontWeight: 700, color: 'var(--green)',
                                background: 'var(--green-dim)',
                                padding: '4px 10px', borderRadius: 3, flexShrink: 0,
                                fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.1em',
                                textTransform: 'uppercase',
                              }}>Voted</span>
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
          {tab === 'activities' && (
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

      {/* ── Delete confirmation modal ──────────────────────────────────── */}
      {deleteModal && (
        <div
          onClick={() => setDeleteModal(null)}
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
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--border2)',
              borderLeft: '3px solid var(--red)',
              borderRadius: 10,
              padding: '28px 28px 24px',
              maxWidth: 420, width: '100%',
              boxShadow: '0 24px 80px rgba(15, 15, 15, 0.18), 0 2px 8px rgba(15, 15, 15, 0.06)',
            }}
          >
            {/* Eyebrow */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              fontFamily: 'var(--font-mono), monospace',
              fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase',
              color: 'var(--red)', fontWeight: 600,
              marginBottom: 4,
            }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--red)' }} />
              Confirm delete
            </div>

            <h2 style={{
              fontSize: 22, fontWeight: 800, color: 'var(--white)', margin: '8px 0 12px',
              fontFamily: 'var(--font-display), serif',
              letterSpacing: '-0.02em', lineHeight: 1.15,
            }}>
              Delete this {deleteModal.type === 'duel' ? 'XDuel' : 'XCreate'}?
            </h2>

            {deleteModal.prompt && (
              <div style={{
                fontSize: 13, color: 'var(--muted2)', lineHeight: 1.5,
                marginBottom: 8,
                overflow: 'hidden', display: '-webkit-box',
                WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
              }}>
                "{deleteModal.prompt}"
              </div>
            )}

            <p style={{
              fontSize: 12, color: 'var(--muted)', lineHeight: 1.6,
              margin: '0 0 24px',
            }}>
              This action cannot be undone.
            </p>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setDeleteModal(null)}
                style={{
                  padding: '10px 20px', borderRadius: 6,
                  background: 'transparent',
                  border: '1px solid var(--border2)',
                  color: 'var(--muted2)', fontWeight: 600, fontSize: 11,
                  fontFamily: 'var(--font-mono), monospace',
                  letterSpacing: '0.1em', textTransform: 'uppercase',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => { const el = e.currentTarget; el.style.borderColor = 'var(--white)'; el.style.color = 'var(--white)' }}
                onMouseLeave={e => { const el = e.currentTarget; el.style.borderColor = 'var(--border2)'; el.style.color = 'var(--muted2)' }}
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                style={{
                  padding: '10px 20px', borderRadius: 6,
                  background: 'var(--red)', border: 'none',
                  color: '#fff', fontWeight: 700, fontSize: 11,
                  fontFamily: 'var(--font-display), sans-serif',
                  letterSpacing: '0.12em', textTransform: 'uppercase',
                  cursor: 'pointer',
                  transition: 'transform 0.15s, box-shadow 0.2s',
                }}
                onMouseEnter={e => { const el = e.currentTarget; el.style.boxShadow = '0 8px 24px var(--red-glow)'; el.style.transform = 'translateY(-1px)' }}
                onMouseLeave={e => { const el = e.currentTarget; el.style.boxShadow = 'none'; el.style.transform = 'translateY(0)' }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

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

            {/* Display heading — body font (Barlow) at heavy weight rather
                than display font (Barlow Condensed). Two-word headings
                read awkwardly narrow in Barlow Condensed. */}
            <h2 style={{
              fontSize: 32, fontWeight: 900, color: 'var(--white)', margin: '8px 0 6px',
              fontFamily: 'var(--font-body), sans-serif',
              letterSpacing: '-0.01em', lineHeight: 1.05,
            }}>
              Add credits
            </h2>
            <div style={{
              fontSize: 12, color: 'var(--muted2)', marginBottom: 22, lineHeight: 1.6,
              fontFamily: 'var(--font-body), sans-serif',
            }}>
              Pick a top-up amount. You&apos;ll be redirected to Stripe to pay.
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
