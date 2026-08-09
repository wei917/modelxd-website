'use client'
// /profile — private owner page with edit + tabs

import { useEffect, useRef, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import ReactMarkdown from 'react-markdown'
import type { UserCredits, CreditTransaction } from '../../lib/credits'
import { useLang, useT, LANGS, type Lang } from '../../lib/i18n'

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

// Shared content-mode filter pills (XDuels / XCreates / XVotes tabs).
function ModePills({ value, onChange }: {
  value: 'all' | 'text' | 'image' | 'video'
  onChange: (v: 'all' | 'text' | 'image' | 'video') => void
}) {
  const t = useT()
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' as const }}>
      {([
        { id: 'all',   key: 'common.all',  color: 'var(--muted2)' },
        { id: 'text',  key: 'mode.text',   color: '#4a9eff' },
        { id: 'image', key: 'mode.image',  color: '#a78bfa' },
        { id: 'video', key: 'mode.video',  color: '#34d399' },
      ] as const).map(opt => {
        const active = value === opt.id
        return (
          <button key={opt.id}
            onClick={() => onChange(opt.id)}
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
            {t(opt.key)}
          </button>
        )
      })}
    </div>
  )
}

type Tab = 'duels' | 'xcreates' | 'xdirects' | 'xtalks' | 'xgames' | 'votes' | 'activities'

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

// Friendly, human label for a grouped ledger session, from its primary
// reference_type. XCreate's reserve / charge / refund / chat all collapse to
// one word so a generation and its follow-ups read as a single session.
const REF_LABELS: Record<string, string> = {
  xcharacter_chat: 'Character chat',
  xgame_gomoku: 'Gomoku game',
  xtalk_werewolf: 'Werewolf game',
  xtalk_turn: 'Discussion',
  xtalk_bid: 'Discussion',
  xcreate: 'XCreate',
  xcreate_reserve: 'XCreate',
  xcreate_refund: 'XCreate',
  xcreate_chat: 'XCreate',
  stripe_checkout_session: 'Purchase',
  welcome: 'Welcome bonus',
  admin_grant: 'Admin grant',
  asset: 'Asset',
}
const refLabel = (rt: string | null): string => (rt && REF_LABELS[rt]) || rt || 'Activity'

// One ledger row per session. Charges sharing a reference_id — every turn of a
// werewolf game, a generation and its refunds, a discussion's turns — collapse
// into one expandable group; rows without a reference_id (most grants and
// purchases) stand alone. Input is newest-first and order is preserved, so
// groups sort by their most recent charge. (CC, Aug 4)
type LedgerGroup = {
  key: string
  txns: CreditTransaction[]
  total: number
  latest: string
  balanceAfter: number
  label: string
}
function buildLedgerGroups(rows: CreditTransaction[]): LedgerGroup[] {
  const order: string[] = []
  const map = new Map<string, CreditTransaction[]>()
  for (const t of rows) {
    const key = t.reference_id ? `ref:${t.reference_id}` : `solo:${t.id}`
    if (!map.has(key)) { map.set(key, []); order.push(key) }
    map.get(key)!.push(t)
  }
  return order.map(key => {
    const g = map.get(key)!
    return {
      key,
      txns: g,
      total: g.reduce((s, r) => s + r.amount_cents, 0),
      latest: g[0].created_at,
      balanceAfter: g[0].balance_after_cents,
      label: refLabel(g[0].reference_type),
    }
  })
}

// Client-side mirror of CREDIT_TIERS in lib/stripe.ts. Kept here so we
// don't have to pull a server-only module into a 'use client' file. The
// server re-validates the tier id when building the Checkout Session, so
// if these drift the worst case is a 400, not a wrong charge.
const DISPLAY_TIERS: { id: string; priceCents: number; label: string; description: string }[] = [
  { id: 'tier_10',  priceCents:  1000, label: '$10',  description: 'Starter' },
  { id: 'tier_20',  priceCents:  2000, label: '$20',  description: 'Most popular' },
  { id: 'tier_100', priceCents: 10000, label: '$100', description: 'Power' },
]

export default function ProfilePage() {
  const { lang, setLang } = useLang()
  const t = useT()
  const cursorRef = useRef<HTMLDivElement>(null)
  const ringRef   = useRef<HTMLDivElement>(null)
  const [user,        setUser]        = useState<any>(null)
  const [profile,     setProfile]     = useState<Profile | null>(null)
  const [tab,         setTab]         = useState<Tab>('duels')
  const [duels,       setDuels]       = useState<any[]>([])
  const [xcreates,    setXcreates]    = useState<any[]>([])
  const [votes,       setVotes]       = useState<any[]>([])
  const [xdirects,    setXdirects]    = useState<any[]>([])
  const [xtalks,      setXtalks]      = useState<any[]>([])
  const [xgames,      setXgames]      = useState<any[]>([])
  // Which beta surfaces this account can see — the XDirect/XGame tabs
  // follow the same gate as their nav items, so a non-beta user's profile
  // doesn't advertise doors the server would slam. (owner ask, Aug 6)
  const [feats,       setFeats]       = useState<{ xdirector?: boolean; xtalk?: boolean }>({})
  useEffect(() => {
    fetch('/api/features').then(r => r.ok ? r.json() : null).then(f => { if (f) setFeats(f) }).catch(() => {})
  }, [])
  // Per-tab "has fetched at least once" flags. Initial render of an empty
  // array would otherwise show "No X yet" before the first fetch resolved,
  // making it look like the user has nothing when really we just haven't
  // asked the server yet.
  const [tabsLoaded,  setTabsLoaded]  = useState<{ duels: boolean; xcreates: boolean; votes: boolean; xdirects: boolean; xtalks: boolean; xgames: boolean }>({
    duels: false, xcreates: false, votes: false, xdirects: false, xtalks: false, xgames: false,
  })
  // XCreate pagination — 12 cards per page, server-side `range` so we
  // don't load the entire history into the browser when a user has
  // hundreds of runs.
  const XCREATES_PAGE_SIZE = 12
  const [xcreatePage, setXcreatePage] = useState(0)
  const [xcreateTotal, setXcreateTotal] = useState<number | null>(null)
  // XCreate type filter — 'all' shows every mode, otherwise filters by mode.
  // Filtering and paging are both done server-side now, so changing either
  // re-fetches the matching page from /api/profile/xcreates.
  // Default to 'image' (CC, July 17): it's the most-used mode and 'all'
  // pulls every row's slots jsonb on first open — noticeably slow.
  const [xcreateFilter, setXcreateFilter] = useState<'all' | 'text' | 'image' | 'video'>('image')
  // Content-mode filters for the XDuels / XVotes tabs (CC, July 19) —
  // same pills as XCreates; these lists are client-cached so filtering
  // is instant.
  // Default 'image' across all three content tabs (CC, July 19) —
  // matches XCreates; image grids are the most scannable landing view.
  const [duelFilter, setDuelFilter] = useState<'all' | 'text' | 'image' | 'video'>('image')
  const [voteFilter, setVoteFilter] = useState<'all' | 'text' | 'image' | 'video'>('image')
  // Credit activity ledger lives with the balance card, not the content
  // tabs (CC, July 19).
  const [showActivity, setShowActivity] = useState(false)
  // Danger zone (delete account): expand → type DELETE → call the API.
  const [dangerOpen, setDangerOpen] = useState(false)
  const [dangerText, setDangerText] = useState('')
  const [dangerBusy, setDangerBusy] = useState(false)
  const [dangerErr, setDangerErr] = useState<string | null>(null)
  useEffect(() => {
    if (!showActivity) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowActivity(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [showActivity])
  // Bump this to force a re-fetch (Refresh button). Adding it to the
  // tabs effect's deps means setting `xcreateRefreshTick + 1` triggers
  // exactly one new fetch without disturbing filter/page state.
  const [xcreateRefreshTick, setXcreateRefreshTick] = useState(0)
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
  // Which session groups are expanded in the activity ledger.
  const [openGroups,  setOpenGroups]  = useState<Record<string, boolean>>({})
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
        else {
          setXcreates(prev => prev.filter(x => x.id !== id))
          setXcreateTotal(t => (t ?? 1) - 1)
        }
      }
    } catch { /* silent */ }
    setDeleting(null)
  }

  // Copy permalink
  const handleShare = (type: 'duel' | 'xcreate', id: string) => {
    const url = type === 'duel'
      ? `${window.location.origin}/xduel/${id}`
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
    const markLoaded = (k: 'duels' | 'xcreates' | 'votes' | 'xdirects' | 'xtalks' | 'xgames') =>
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
      // XCreates are fetched + re-signed server-side, one page at a time, by
      // the dedicated effect below (keyed on page/filter). Nothing to do in
      // this per-tab effect.
    } else if (tab === 'xgames') {
      // Games are server-held sessions with owner-read RLS — same query the
      // Nav history uses, with a fallback for a pre-migration-72 `game`
      // column. XTalk Discussions are NOT here: they live in client state
      // and have no row to link to (see Nav.tsx).
      const gsel = (cols: string) => client.from('xtalk_sessions')
        .select(cols).eq('user_id', user.id).neq('game', 'discussion')
        .order('updated_at', { ascending: false }).limit(50)
      gsel('id, status, day, winner, created_at, title, game').then(async (res: any) => {
        const r = res.error ? await gsel('id, status, day, winner, created_at, title') : res
        setXgames(((r.data ?? []) as any[]).map(g => ({ game: 'werewolf', ...g })))
        markLoaded('xgames')
      })
    } else if (tab === 'xtalks') {
      // Persisted discussion rooms (Aug 6) — the same rows the /xtalk nav
      // history lists, linking back into the live room.
      client.from('xtalk_sessions').select('id, title, created_at, updated_at')
        .eq('user_id', user.id).eq('game', 'discussion')
        .order('updated_at', { ascending: false }).limit(50)
        .then(({ data }: any) => { setXtalks(data ?? []); markLoaded('xtalks') })
    } else if (tab === 'xdirects') {
      client.from('xdirector_conversations').select('id, title, created_at, updated_at')
        .eq('user_id', user.id).is('deleted_at', null)
        .order('updated_at', { ascending: false }).limit(50)
        .then(({ data, error }: any) => {
          if (error) {
            client.from('xdirector_conversations').select('id, title, created_at, updated_at')
              .eq('user_id', user.id)
              .order('updated_at', { ascending: false }).limit(50)
              .then(({ data: fb }: any) => { setXdirects(fb ?? []); markLoaded('xdirects') })
          } else { setXdirects(data ?? []); markLoaded('xdirects') }
        })
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
    }
    if (showActivity) {
      // Latest 100 ledger entries. RLS restricts to the signed-in user.
      client.from('credit_transactions').select('*').eq('user_id', user.id)
        .order('created_at', { ascending: false }).limit(300)
        .then(({ data }) => setTxns((data ?? []) as CreditTransaction[]))
      // Refresh balance at the same time in case a debit just landed.
      client.from('user_credits').select('*').eq('user_id', user.id).maybeSingle()
        .then(({ data: c }) => setCredits((c as UserCredits | null) ?? null))
    }
  // xcreateRefreshTick is a dep so bumping it manually re-fetches the
  // 200-row xcreate cache. Filter + pagination are now both client-side
  // so they intentionally don't appear here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, user, xcreateRefreshTick, showActivity])

  // Fetch the visible XCreate page from the server, which fetches + re-signs
  // ONLY that page's rows (one batched sign per bucket) and returns them
  // ready to render. Server-paged, so the browser never over-fetches the
  // whole history or signs anything itself. Re-runs on page/filter/refresh.
  useEffect(() => {
    if (tab !== 'xcreates' || !user) return
    let cancelled = false
    setTabsLoaded(s => ({ ...s, xcreates: false }))
    ;(async () => {
      try {
        const res  = await fetch(`/api/profile/xcreates?page=${xcreatePage}&filter=${xcreateFilter}`)
        const json = await res.json().catch(() => ({}))
        if (cancelled) return
        setXcreates(json.rows ?? [])
        setXcreateTotal(json.total ?? 0)
      } catch {
        if (!cancelled) { setXcreates([]); setXcreateTotal(0) }
      } finally {
        if (!cancelled) setTabsLoaded(s => ({ ...s, xcreates: true }))
      }
    })()
    return () => { cancelled = true }
  }, [tab, user, xcreatePage, xcreateFilter, xcreateRefreshTick])

  // Kick off a Stripe Checkout Session for the selected tier. The server
  // re-validates the tier id and builds a session keyed to the signed-in
  // user, then returns a hosted URL that we redirect to. Credits are
  // granted from the webhook, not on return — so the success banner just
  // tells the user to hang tight while we poll for the balance.
  // Custom amount (whole dollars, $5–$500 — server re-validates) and the
  // optional gift recipient. A filled gift email routes the credits to
  // that account (must already exist; the server checks and 400s if not).
  const [customAmount, setCustomAmount] = useState('200')
  // Recipient: 'self' (default) or 'other' — the email box only appears
  // (and only applies) when buying for someone else.
  const [giftMode,     setGiftMode]     = useState<'self' | 'other'>('self')
  const [giftEmail,    setGiftEmail]    = useState('')
  // Which tile is chosen. Separate from checkoutTier, which means "a Stripe
  // redirect is in flight". Picking a tile used to launch checkout on the
  // click, which sent people to Stripe before they'd finished reading the
  // options (CC, July 25) — now the tiles only select, and the Pay button
  // is the single thing that spends money. 'custom' = use customAmount.
  const [pickedTier,   setPickedTier]   = useState<string | null>('tier_20')

  const startCheckout = async (tierId: string | null, customCents?: number) => {
    if (giftMode === 'other' && !giftEmail.trim()) {
      alert("Enter the recipient's email, or switch back to \"For myself\".")
      return
    }
    setCheckoutTier(tierId ?? 'custom')
    try {
      const res = await fetch('/api/stripe/checkout', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          tierId:         tierId ?? undefined,
          customCents,
          recipientEmail: giftMode === 'other' ? (giftEmail.trim() || undefined) : undefined,
        }),
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

  // Returning from Stripe with the browser's Back button restores this page
  // from the bfcache with its React state intact — checkoutOpen still true
  // and checkoutTier still set. That renders the checkout overlay with every
  // control disabled (disabled={!!checkoutTier}) and its dismiss handler
  // gated on !checkoutTier, i.e. a full-screen blurred sheet with nothing
  // clickable and no way out. That's the hang (CC, July 25).
  //
  // Stripe's own Cancel button navigates to cancel_url, which is a fresh
  // load and resets state naturally — only the back-button path breaks, so
  // the fix is scoped to a genuine bfcache restore.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return
      setCheckoutTier(null)
      setCheckoutOpen(false)
    }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [])

  // Post-redirect banner + balance refresh. When Stripe sends the user
  // back with ?checkout=success we poll user_credits for ~15s so the
  // webhook-granted balance appears without a manual refresh. The
  // webhook is usually faster than the browser redirect, but not always.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const result = params.get('checkout')
    if (result !== 'success' && result !== 'cancel') return
    // Whatever brought us back, the checkout attempt is over — never leave
    // the modal in its locked "processing" state.
    setCheckoutTier(null)
    setCheckoutOpen(false)
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
        if (showActivity) {
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
            {t('profile.account')}  ·  {user?.email ? t('profile.signedin') : ''}
            {/* Language picker — auto-detect handles first visits; this is
                the manual override. Labels are each language's own name. */}
            <select
              value={lang}
              onChange={e => setLang(e.target.value as Lang)}
              aria-label="Language"
              style={{
                marginLeft: 'auto', padding: '6px 10px', borderRadius: 7,
                border: '1px solid var(--border2)', background: 'var(--surface)',
                color: 'var(--white)', fontSize: 12, cursor: 'pointer', outline: 'none',
                letterSpacing: 'normal', textTransform: 'none',
              }}
            >
              {LANGS.map(l => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
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
                  ? <img src={profile.avatar_url} alt="" referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <span style={{ fontSize: 32, fontWeight: 800, color: 'var(--red)' }}>{initials}</span>
                }
              </div>

              {/* Name + email */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <h1 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 6px', letterSpacing: '-0.01em', fontFamily: 'var(--font-display), sans-serif' }}>
                  {profile.display_name ?? 'Anonymous'}
                </h1>
                <div style={{ fontSize: 11, color: 'var(--muted2)', fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.04em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.email}</div>
                {/* Sign Out belongs with the identity block (CC, July 19). */}
                <button
                  onClick={async () => { await sb().auth.signOut(); window.location.href = '/' }}
                  style={{
                    marginTop: 10, padding: '6px 14px', borderRadius: 7,
                    border: '1px solid var(--border2)', background: 'transparent',
                    color: 'var(--muted2)', fontSize: 12, cursor: 'pointer',
                  }}
                >
                  {t('auth.signout')}
                </button>
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
                  {t('profile.balance')}
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
                    {t('profile.spent')} {formatCents(credits.lifetime_spent_cents)}
                    {credits.lifetime_granted_cents > 0 && <>   ·   {t('profile.granted')} {formatCents(credits.lifetime_granted_cents)}</>}
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
                {t('profile.addcredits')}
              </button>
              {/* Ledger toggle — credit activity belongs to this card. */}
              <button
                onClick={() => setShowActivity(true)}
                style={{
                  padding: '12px 16px', borderRadius: 6,
                  background: 'transparent', border: '1px solid var(--border2)',
                  color: 'var(--muted2)', fontWeight: 700, fontSize: 12,
                  fontFamily: 'var(--font-mono), monospace',
                  letterSpacing: '0.08em', textTransform: 'uppercase',
                  cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' as const,
                }}
              >
                {t('profile.activity')}
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

          {/* Credit activity — pop-up dialog (CC, July 20), not inline. */}
          {showActivity && (
            <div
              onClick={e => { if (e.target === e.currentTarget) setShowActivity(false) }}
              style={{
                position: 'fixed', inset: 0, zIndex: 1200,
                background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
              }}
            >
              <div style={{
                background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 12,
                width: '100%', maxWidth: 860, maxHeight: '78vh',
                display: 'flex', flexDirection: 'column', overflow: 'hidden',
                boxShadow: '0 24px 80px rgba(0,0,0,0.25)',
              }}>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '16px 20px', borderBottom: '1px solid var(--border)',
                }}>
                  <span style={{
                    fontFamily: 'var(--font-mono), monospace', fontSize: 12, fontWeight: 700,
                    letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--white)',
                  }}>{t('profile.activity')}</span>
                  <button
                    onClick={() => setShowActivity(false)}
                    aria-label="Close"
                    style={{
                      width: 28, height: 28, background: 'transparent',
                      border: '1px solid var(--border2)', borderRadius: 6,
                      color: 'var(--muted2)', fontSize: 14, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >✕</button>
                </div>
                <div style={{ overflowY: 'auto', padding: 20 }}>
                  {txns.length === 0
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
                  {(() => {
                    const groups = buildLedgerGroups(txns)
                    const cellDate = (iso: string) => (
                      <div style={{ color: 'var(--muted2)', fontFamily: 'var(--font-mono), monospace', fontSize: 11, letterSpacing: '0.02em' }}>
                        {new Date(iso).toLocaleDateString()}{' '}
                        <span style={{ color: 'var(--muted)' }}>
                          {new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    )
                    return groups.map((g, idx) => {
                      const last  = idx === groups.length - 1
                      const zebra = idx % 2 === 1
                      const base = {
                        display: 'grid',
                        gridTemplateColumns: '160px 110px 1fr 130px 130px',
                        alignItems: 'center',
                        padding: '13px 20px',
                        background: zebra ? 'var(--bg)' : 'transparent',
                        fontSize: 12,
                        transition: 'background 0.15s',
                      } as const

                      // A lone charge (most grants, purchases, one-offs) — plain row.
                      if (g.txns.length === 1) {
                        const t = g.txns[0]
                        const positive = t.amount_cents >= 0
                        const color = positive ? 'var(--green)' : 'var(--red)'
                        return (
                          <div key={g.key}
                            style={{ ...base, borderBottom: last ? 'none' : '1px solid var(--border)' }}
                            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface2)'}
                            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = zebra ? 'var(--bg)' : 'transparent'}
                          >
                            {cellDate(t.created_at)}
                            <div>
                              <span style={{
                                display: 'inline-block', padding: '3px 9px', borderRadius: 3, fontSize: 9, fontWeight: 700,
                                background: color === 'var(--green)' ? 'var(--green-dim)' : 'var(--red-dim)', color,
                                fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.1em', textTransform: 'uppercase',
                              }}>{KIND_LABELS[t.kind]}</span>
                            </div>
                            <div style={{ color: 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 12 }}>
                              {t.description ?? refLabel(t.reference_type)}
                            </div>
                            <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono), monospace', fontWeight: 700, color, fontSize: 12, letterSpacing: '0.02em' }}>
                              {positive ? '+' : ''}{formatCents(t.amount_cents)}
                            </div>
                            <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono), monospace', color: 'var(--muted2)', fontSize: 12, letterSpacing: '0.02em' }}>
                              {formatCents(t.balance_after_cents)}
                            </div>
                          </div>
                        )
                      }

                      // A session: one summary row, click to expand its charges.
                      const open = !!openGroups[g.key]
                      const positive = g.total >= 0
                      const color = positive ? 'var(--green)' : 'var(--red)'
                      return (
                        <div key={g.key}>
                          <div
                            style={{ ...base, cursor: 'pointer', borderBottom: (last && !open) ? 'none' : '1px solid var(--border)' }}
                            onClick={() => setOpenGroups(s => ({ ...s, [g.key]: !s[g.key] }))}
                            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface2)'}
                            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = zebra ? 'var(--bg)' : 'transparent'}
                          >
                            {cellDate(g.latest)}
                            <div>
                              <span style={{
                                display: 'inline-block', padding: '3px 9px', borderRadius: 3, fontSize: 9, fontWeight: 700,
                                background: 'var(--surface2)', color: 'var(--muted2)', border: '1px solid var(--border2)',
                                fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.08em',
                              }}>{g.txns.length}×</span>
                            </div>
                            <div style={{ color: 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ color: 'var(--muted2)', fontSize: 10, width: 9, display: 'inline-block' }}>{open ? '▾' : '▸'}</span>
                              <span style={{ fontWeight: 600 }}>{g.label}</span>
                              <span style={{ color: 'var(--muted)', fontSize: 11 }}>· {g.txns.length} charges</span>
                            </div>
                            <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono), monospace', fontWeight: 700, color, fontSize: 12, letterSpacing: '0.02em' }}>
                              {positive ? '+' : ''}{formatCents(g.total)}
                            </div>
                            <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono), monospace', color: 'var(--muted2)', fontSize: 12, letterSpacing: '0.02em' }}>
                              {formatCents(g.balanceAfter)}
                            </div>
                          </div>
                          {open && g.txns.map((t, j) => {
                            const p = t.amount_cents >= 0
                            const cc = p ? 'var(--green)' : 'var(--red)'
                            const lastChild = last && j === g.txns.length - 1
                            return (
                              <div key={t.id} style={{
                                display: 'grid', gridTemplateColumns: '160px 110px 1fr 130px 130px', alignItems: 'center',
                                padding: '10px 20px', background: 'var(--surface2)', fontSize: 11.5,
                                borderBottom: lastChild ? 'none' : '1px solid var(--border)',
                              }}>
                                {cellDate(t.created_at)}
                                <div>
                                  <span style={{
                                    display: 'inline-block', padding: '2px 8px', borderRadius: 3, fontSize: 8.5, fontWeight: 700,
                                    background: cc === 'var(--green)' ? 'var(--green-dim)' : 'var(--red-dim)', color: cc,
                                    fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.1em', textTransform: 'uppercase',
                                  }}>{KIND_LABELS[t.kind]}</span>
                                </div>
                                <div style={{ color: 'var(--muted2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingLeft: 17, paddingRight: 12 }}>
                                  {t.description ?? refLabel(t.reference_type)}
                                </div>
                                <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono), monospace', fontWeight: 700, color: cc, fontSize: 11.5, letterSpacing: '0.02em' }}>
                                  {p ? '+' : ''}{formatCents(t.amount_cents)}
                                </div>
                                <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono), monospace', color: 'var(--muted)', fontSize: 11.5, letterSpacing: '0.02em' }}>
                                  {formatCents(t.balance_after_cents)}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )
                    })
                  })()}
                </div>}
                </div>
              </div>
            </div>
          )}

          {/* Privacy summary — sits right above the content tabs so the
              public/private expectations frame what's below (CC, July 19). */}
          <div style={{
            marginBottom: 10,
            fontSize: 11.5, color: 'var(--muted2)', lineHeight: 1.6,
          }}>
            {t('profile.privacy')}
          </div>

          {/* ── Tabs ── */}
          <div style={{
            display: 'flex', gap: 0, marginBottom: 32,
            borderBottom: '1px solid var(--border)',
          }}>
            {([
              ['duels', '⚔ ' + t('nav.xduel')],
              ['xcreates', '✦ ' + t('nav.xcreate')],
              ...(feats.xdirector ? [['xdirects', '▶ ' + t('nav.xdirect')]] : []),
              ...(feats.xtalk ? [['xtalks', '💬 ' + t('nav.xtalk')]] : []),
              ...(feats.xtalk ? [['xgames', '◉ ' + t('nav.xgame')]] : []),
              ['votes', '⊞ ' + t('nav.xvote')],
            ] as [Tab, string][]).map(([tb, label]) => {
              const active = tab === tb
              return (
                <button
                  key={tb}
                  onClick={() => { setTab(tb); if (tb === 'xcreates') setXcreatePage(0) }}
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
          {tab === 'duels' && (() => {
            const visibleDuels = duelFilter === 'all' ? duels : duels.filter(d => d.mode === duelFilter)
            return (
            !tabsLoaded.duels
              ? <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 60, fontSize: 13 }}>Loading…</div>
              : <>
              <ModePills value={duelFilter} onChange={setDuelFilter} />
              {visibleDuels.length === 0
              ? <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 60, fontSize: 13 }}>{duelFilter === 'all' ? t('profile.noduels') : t('profile.noduels')}</div>
              : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
                  {visibleDuels.map(item => {
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
                          background: 'var(--bg)',
                          border: '1px solid var(--border2)',
                          borderRadius: 10,
                          overflow: 'hidden',
                          transition: 'border-color 0.2s, transform 0.2s',
                          opacity: isDel ? 0.4 : 1,
                          display: 'flex', flexDirection: 'column' as const,
                        }}
                        onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'var(--red)'; el.style.transform = 'translateY(-2px)' }}
                        onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'var(--border2)'; el.style.transform = 'translateY(0)' }}
                      >
                        {preview && (
                          <a href={`/xduel/${item.id}`} style={{ textDecoration: 'none' }}>
                            {preview.isVideo
                              ? <video src={preview.text} muted loop playsInline style={{ width: '100%', maxHeight: 160, objectFit: 'cover', display: 'block' }} />
                              : preview.isImage
                              ? <img src={preview.text} alt="" style={{ width: '100%', maxHeight: 160, objectFit: 'cover', display: 'block' }} />
                              : <div style={{ padding: '14px 14px 4px', fontSize: 11, color: 'var(--muted2)', lineHeight: 1.65, maxHeight: 90, overflow: 'hidden', maskImage: 'linear-gradient(to bottom, black 55%, transparent)', WebkitMaskImage: 'linear-gradient(to bottom, black 55%, transparent)' }}>{preview.text?.slice(0, 180)}</div>
                            }
                          </a>
                        )}
                        <div style={{ padding: '12px 14px', flex: 1, display: 'flex', flexDirection: 'column' as const }}>
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
                          <div style={{ display: 'flex', gap: 6, marginTop: 'auto' }}>
                            <button
                              onClick={() => handleShare('duel', item.id)}
                              style={{
                                flex: 1, padding: '6px 0', borderRadius: 5,
                                background: 'transparent', border: '1px solid var(--border2)',
                                color: copied ? 'var(--green)' : 'var(--muted2)', fontSize: 10, fontWeight: 600, cursor: 'pointer',
                                fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.08em', textTransform: 'uppercase',
                                transition: 'all 0.15s',
                              }}
                            >{copied ? t('common.copied') : t('common.share')}</button>
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
                            >{isDel ? '…' : t('common.delete')}</button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>}
              </>
            )
          })()}

          {/* ── XCreates tab ── */}
          {tab === 'xcreates' && (() => {
            // Filter + paginate the cached list client-side. Switching the
            // filter is instant (no network round-trip); Refresh button
            // below triggers a re-fetch into `xcreates` state.
            // The server already returns this page filtered, paged, and
            // signed — `xcreates` holds exactly the current page's rows.
            const visibleSlice = xcreates
            const totalCount   = xcreateTotal ?? 0
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
                  { id: 'all',   label: t('common.all'),  color: 'var(--muted2)' },
                  { id: 'text',  label: t('mode.text'),   color: '#4a9eff' },
                  { id: 'image', label: t('mode.image'),  color: '#a78bfa' },
                  { id: 'video', label: t('mode.video'),  color: '#34d399' },
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
                          background: 'var(--bg)',
                          border: '1px solid var(--border2)',
                          borderRadius: 10,
                          overflow: 'hidden',
                          transition: 'border-color 0.2s, transform 0.2s',
                          opacity: isDel ? 0.4 : 1,
                          cursor: 'pointer',
                          display: 'flex', flexDirection: 'column' as const,
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
                        <div style={{ padding: '12px 14px', flex: 1, display: 'flex', flexDirection: 'column' as const }}>
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
                          <div style={{ display: 'flex', gap: 6, marginTop: 'auto' }}>
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
                            >{isDel ? '…' : t('common.delete')}</button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>}
              {/* Pagination footer — computed off the filtered slice so
                  pagination shrinks/grows with the active filter. */}
              {tabsLoaded.xcreates && totalCount > XCREATES_PAGE_SIZE && (() => {
                const totalPages = Math.ceil(totalCount / XCREATES_PAGE_SIZE)
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
          {tab === 'votes' && (() => {
            const visibleVotes = voteFilter === 'all' ? votes : votes.filter((v: any) => v.duels?.mode === voteFilter)
            return (
            !tabsLoaded.votes
              ? <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 60, fontSize: 13 }}>Loading…</div>
              : <>
              <ModePills value={voteFilter} onChange={setVoteFilter} />
              {visibleVotes.length === 0
              ? <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 60, fontSize: 13 }}>{t('profile.novotes')}</div>
              : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {visibleVotes.map((v: any) => {
                    const duel = v.duels
                    const isTie = v.vote_choice === 'T'
                    return (
                      <a key={v.id} href={`/xduel/${v.duel_id}`} style={{ textDecoration: 'none' }}>
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
                </div>}
              </>
            )
          })()}

          {/* ── XDirect tab — director conversations/boards, same rows the
              Nav history shows, linked back into the stage. ── */}
          {tab === 'xdirects' && (
            !tabsLoaded.xdirects
              ? <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 60, fontSize: 13 }}>Loading…</div>
              : xdirects.length === 0
              ? <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 60, fontSize: 13 }}>{t('profile.noxdirects')}</div>
              : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {xdirects.map((c: any) => (
                    <a key={c.id} href={`/xdirect?c=${c.id}`} style={{ textDecoration: 'none' }}>
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
                            {c.title || t('profile.untitled')}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--muted2)', fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                            {t('nav.xdirect')}  ·  {new Date(c.updated_at ?? c.created_at).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                    </a>
                  ))}
                </div>
          )}

          {/* ── XTalk tab — persisted discussion rooms, linking back into
              the live conversation. ── */}
          {tab === 'xtalks' && (
            !tabsLoaded.xtalks
              ? <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 60, fontSize: 13 }}>Loading…</div>
              : xtalks.length === 0
              ? <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 60, fontSize: 13 }}>{t('profile.notalks')}</div>
              : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {xtalks.map((c: any) => (
                    <a key={c.id} href={`/xtalk/${c.id}`} style={{ textDecoration: 'none' }}>
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
                            {c.title || t('xt.tpl.discussion.name')}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--muted2)', fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                            {t('xt.tpl.discussion.name')}  ·  {new Date(c.updated_at ?? c.created_at).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                    </a>
                  ))}
                </div>
          )}

          {/* ── XGame tab — every game session (Werewolf, Gomoku, …); the
              permalink is the row. LIVE badge for games still running. ── */}
          {tab === 'xgames' && (
            !tabsLoaded.xgames
              ? <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 60, fontSize: 13 }}>Loading…</div>
              : xgames.length === 0
              ? <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 60, fontSize: 13 }}>{t('profile.nogames')}</div>
              : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {xgames.map((g: any) => {
                    const gameName = g.game === 'gomoku' ? t('xg.game.gomoku') : t('xt.tpl.werewolf.name')
                    return (
                      <a key={g.id} href={`/xgame/${g.id}`} style={{ textDecoration: 'none' }}>
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
                              {g.title || gameName}
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--muted2)', fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                              {gameName}  ·  {new Date(g.created_at).toLocaleDateString()}
                            </div>
                          </div>
                          {g.status === 'active' && (
                            <span style={{
                              fontSize: 9, fontWeight: 700, color: 'var(--red)',
                              background: 'var(--red-dim)',
                              padding: '4px 10px', borderRadius: 3, flexShrink: 0,
                              fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.1em',
                              textTransform: 'uppercase',
                            }}>LIVE</span>
                          )}
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

          {/* ── Danger zone — delete account (Privacy Policy §5) ── */}
          <div style={{ marginTop: 56, border: '1px solid rgba(232,69,60,0.35)', borderRadius: 10, padding: '18px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 260 }}>
                <div style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--red)', marginBottom: 6 }}>
                  {t('profile.danger')}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--muted2)', lineHeight: 1.6 }}>{t('profile.deletewarn')}</div>
              </div>
              {!dangerOpen && (
                <button
                  onClick={() => { setDangerOpen(true); setDangerText(''); setDangerErr(null) }}
                  style={{ padding: '9px 16px', borderRadius: 6, background: 'transparent', border: '1px solid var(--red)', color: 'var(--red)', fontWeight: 700, fontSize: 11, fontFamily: 'var(--font-display), sans-serif', letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer' }}
                >
                  {t('profile.deleteaccount')}
                </button>
              )}
            </div>
            {dangerOpen && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
                <input
                  value={dangerText}
                  onChange={e => setDangerText(e.target.value)}
                  placeholder={t('profile.deleteconfirm')}
                  disabled={dangerBusy}
                  style={{ flex: 1, minWidth: 220, padding: '9px 12px', borderRadius: 6, border: '1px solid var(--border2)', background: '#fff', fontSize: 13, fontFamily: 'var(--font-mono), monospace', outline: 'none' }}
                />
                <button
                  disabled={dangerText !== 'DELETE' || dangerBusy}
                  onClick={async () => {
                    setDangerBusy(true); setDangerErr(null)
                    try {
                      const res = await fetch('/api/profile/delete-account', { method: 'POST' })
                      const j = await res.json().catch(() => ({}))
                      if (!res.ok) throw new Error(j?.error ?? 'Delete failed. Please try again.')
                      await sb().auth.signOut()
                      window.location.href = '/'
                    } catch (err) {
                      setDangerErr(err instanceof Error ? err.message : 'Delete failed. Please try again.')
                      setDangerBusy(false)
                    }
                  }}
                  style={{ padding: '9px 16px', borderRadius: 6, background: dangerText === 'DELETE' && !dangerBusy ? 'var(--red)' : 'var(--border2)', border: 'none', color: '#fff', fontWeight: 700, fontSize: 11, fontFamily: 'var(--font-display), sans-serif', letterSpacing: '0.1em', textTransform: 'uppercase', cursor: dangerText === 'DELETE' && !dangerBusy ? 'pointer' : 'default' }}
                >
                  {dangerBusy ? t('profile.deleting') : t('profile.deleteaccount')}
                </button>
                <button
                  disabled={dangerBusy}
                  onClick={() => { setDangerOpen(false); setDangerText(''); setDangerErr(null) }}
                  style={{ padding: '9px 12px', borderRadius: 6, background: 'transparent', border: '1px solid var(--border2)', color: 'var(--muted2)', fontSize: 11, fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer' }}
                >
                  ✕
                </button>
                {dangerErr && <div style={{ width: '100%', fontSize: 12, color: 'var(--red)' }}>⚠️ {dangerErr}</div>}
              </div>
            )}
          </div>

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
              {DISPLAY_TIERS.map((t) => {
                const isSelected = pickedTier === t.id
                const isDimmed = checkoutTier !== null && !isSelected
                return (
                  <button
                    key={t.id}
                    onClick={() => setPickedTier(t.id)}
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
                        el.style.borderColor = isSelected ? 'var(--red)' : 'var(--border2)'
                        el.style.background = isSelected ? 'var(--red-dim)' : 'var(--surface)'
                        el.style.transform = 'translateY(0)'
                      }
                    }}
                  >
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

              {/* Custom amount — the 4th card. The whole TILE is the buy
                  action, exactly like the fixed tiers; the inline input
                  only edits the amount (clicks on it don't launch). */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => { if (!checkoutTier) setPickedTier('custom') }}
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
                    const on = pickedTier === 'custom'
                    el.style.borderColor = on ? 'var(--red)' : 'var(--border2)'
                    el.style.background = on ? 'var(--red-dim)' : 'var(--surface)'
                    el.style.transform = 'translateY(0)'
                  }
                }}
                style={{
                  position: 'relative' as const,
                  padding: '18px 18px 16px',
                  background: pickedTier === 'custom' ? 'var(--red-dim)' : 'var(--surface)',
                  border: `1px solid ${pickedTier === 'custom' ? 'var(--red)' : 'var(--border2)'}`,
                  borderRadius: 8,
                  cursor: checkoutTier ? 'default' : 'pointer',
                  transition: 'all 0.15s ease-out',
                  opacity: checkoutTier !== null && pickedTier !== 'custom' ? 0.4 : 1,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
                  <span style={{ fontSize: 28, fontWeight: 900, fontFamily: 'var(--font-display), serif', color: 'var(--white)' }}>$</span>
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    step={1}
                    value={customAmount}
                    onChange={e => { setCustomAmount(e.target.value); setPickedTier('custom') }}
                    onClick={e => { e.stopPropagation(); if (!checkoutTier) setPickedTier('custom') }}
                    placeholder="200"
                    disabled={!!checkoutTier}
                    style={{
                      width: 88, fontSize: 28, fontWeight: 900,
                      fontFamily: 'var(--font-display), serif',
                      border: 'none', borderBottom: '2px solid var(--border2)',
                      background: 'transparent', color: 'var(--white)', outline: 'none',
                    }}
                  />
                </div>
                <div style={{
                  fontSize: 10.5, color: 'var(--muted2)',
                  fontFamily: 'var(--font-mono), monospace',
                  letterSpacing: '0.06em', textTransform: 'uppercase' as const, lineHeight: 1.4,
                }}>
                  Custom — $1 to $1000
                </div>
              </div>
            </div>

            {/* Recipient: myself (default) or someone else — the email box
                appears only for gifts. Server verifies the account exists. */}
            <div style={{ marginTop: 14 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                {([['self', 'For myself'], ['other', '🎁 For someone else']] as const).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => { if (!checkoutTier) setGiftMode(mode) }}
                    disabled={!!checkoutTier}
                    style={{
                      flex: 1, padding: '9px 0', borderRadius: 7,
                      border: `1px solid ${giftMode === mode ? 'var(--red)' : 'var(--border2)'}`,
                      background: giftMode === mode ? 'var(--red-dim)' : 'var(--surface)',
                      color: giftMode === mode ? 'var(--red)' : 'var(--muted2)',
                      fontFamily: 'var(--font-mono), monospace', fontSize: 10.5,
                      letterSpacing: '0.1em', textTransform: 'uppercase' as const,
                      fontWeight: 700, cursor: checkoutTier ? 'default' : 'pointer',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {giftMode === 'other' && (
                <div style={{ marginTop: 10 }}>
                  <input
                    type="email"
                    value={giftEmail}
                    onChange={e => setGiftEmail(e.target.value)}
                    placeholder="their-email@example.com — must have a ModelXD account"
                    disabled={!!checkoutTier}
                    style={{
                      width: '100%', padding: '10px 12px', borderRadius: 7,
                      border: `1px solid ${giftEmail.trim() ? 'var(--red)' : 'var(--border2)'}`,
                      background: 'var(--surface)', color: 'var(--white)',
                      fontSize: 13, outline: 'none',
                    }}
                  />
                  {giftEmail.trim() && (
                    <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 6 }}>
                      Your card, their balance — credits go to {giftEmail.trim()}.
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* The one control that spends money. Everything above it only
                selects; nothing leaves the page until this is pressed. */}
            {(() => {
              const customCents = Math.round(Number(customAmount)) * 100
              const customValid = Number.isFinite(customCents) && customCents >= 100 && customCents <= 100000
              const tier = DISPLAY_TIERS.find(x => x.id === pickedTier)
              const cents = pickedTier === 'custom' ? customCents : (tier?.priceCents ?? 0)
              const ready = !checkoutTier && (pickedTier === 'custom' ? customValid : !!tier)
              const amount = cents > 0 && (pickedTier !== 'custom' || customValid)
                ? `$${(cents / 100).toLocaleString()}`
                : ''
              return (
                <button
                  onClick={() => {
                    if (!ready) return
                    if (pickedTier === 'custom') startCheckout(null, customCents)
                    else if (tier) startCheckout(tier.id)
                  }}
                  disabled={!ready}
                  style={{
                    width: '100%', marginTop: 20, padding: '15px 20px',
                    background: ready ? 'var(--red)' : 'var(--border)',
                    color: ready ? '#fff' : 'var(--muted)',
                    border: 'none', borderRadius: 8,
                    fontFamily: 'var(--font-display), sans-serif',
                    fontSize: 15, fontWeight: 800, letterSpacing: '0.08em',
                    textTransform: 'uppercase' as const,
                    cursor: ready ? 'pointer' : 'default',
                    transition: 'background 0.15s, box-shadow 0.15s',
                  }}
                  onMouseEnter={e => { if (ready) (e.currentTarget as HTMLElement).style.boxShadow = '0 0 28px var(--red-glow)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = 'none' }}
                >
                  {checkoutTier
                    ? 'Redirecting…'
                    : pickedTier === 'custom' && !customValid
                      ? 'Enter $1 – $1000'
                      : `Pay ${amount} →`}
                </button>
              )
            })()}

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
