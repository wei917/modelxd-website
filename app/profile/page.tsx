'use client'
// /profile — private owner page with edit + tabs

import { useEffect, useMemo, useRef, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import type { UserCredits, CreditTransaction } from '../../lib/credits'
import { useLang, useT, LANGS, type Lang } from '../../lib/i18n'
import { downloadFile, downloadName } from '../../lib/download'
import { useRequireAuth } from '../../lib/useRequireAuth'
import { useSite } from '../../lib/useSite'
import XTellAuthGate from '../components/xtell/XTellAuthGate'
import { useAuthModal } from '../../lib/AuthModalContext'
import XTellActivity from '../components/xtell/XTellActivity'
import { DailyProfileSettings } from '../components/xtell/XTellDaily'
import { PersonalitySettings } from '../components/xtell/XTellPersonality'
import { XTellFooter } from '../components/xtell/XTellNav'
import { yenApprox } from '../../lib/plans'
import { userName, userPhoto } from '../../lib/user-face'
import FaceEditor, { type HandleInfo } from '../components/FaceEditor'
import ProfileLibrary, { makeLoader, ProfileViewTabs, type ProfileView, type LibraryActions } from './Library'
import { renameReading, eraseReading } from '../../lib/xtell-history'
import AccountPanel from './Account'
import VoicesSection from './Voices'

const sb = () => createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
)

interface Profile {
  id: string
  display_name: string | null
  bio: string | null
  avatar_url: string | null
}

// Format an integer cent amount as a USD string. Handles the sign so the
// ledger column can show "-$0.04" style entries without special casing.
const formatCents = (cents: number): string => {
  const sign = cents < 0 ? '-' : ''
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`
}

// Human label for each credit_transactions.kind value.

// Friendly, human label for a grouped ledger session, from its primary
// reference_type. XCreate's reserve / charge / refund / chat all collapse to
// one word so a generation and its follow-ups read as a single session.
const REF_LABELS: Record<string, string> = {
  xcharacter_chat: 'Character chat',
  xgame_gomoku: 'Gomoku game',
  xgame_chess: 'Chess game',
  xgame_poker: 'Poker game',
  xgame_xiangqi: 'Xiangqi game',
  xgame_bridge: 'Bridge game',
  xtalk_werewolf: 'Werewolf game',
  xtalk_turn: 'Discussion',
  xtalk_bid: 'Discussion',
  xtell: 'XOracle',
  xcreate: 'XCreate',
  xcreate_reserve: 'XCreate',
  xcreate_refund: 'XCreate',
  xcreate_chat: 'XCreate',
  stripe_checkout_session: 'Purchase',
  stripe_invoice: 'Monthly plan',
  subscription_bonus: 'Monthly plan',
  subscription_bonus_expiry: 'Monthly plan',
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

function ModelXDProfileAuth() { useRequireAuth(); return null }

export default function ProfilePage() {
  const site = useSite()
  const isXTell = site === 'xtell'
  const { show: showAuth } = useAuthModal()
  const { lang, setLang } = useLang()
  const t = useT()
  // Ledger kinds by name; the row callbacks below shadow `t` with the
  // transaction, so the lookup is bound here.
  const kindLabel = (k: CreditTransaction['kind']) => t('profile.kind.' + k)
  const cursorRef = useRef<HTMLDivElement>(null)
  const ringRef   = useRef<HTMLDivElement>(null)
  const [user,        setUser]        = useState<any>(null)
  const [profile,     setProfile]     = useState<Profile | null>(null)
  // The picture and website name editor (Oct 2): FaceEditor, saved through
  // /api/profile/face, the only writer of display_name and avatar_url.
  const [editingFace, setEditingFace] = useState(false)
  // The @ID (Oct 13, supabase/132): read through /api/profile/handle, which
  // gives an account that has none its ID first.
  const [handleInfo, setHandleInfo] = useState<HandleInfo | null>(null)
  // www's account page has two views (Oct 15; approved design
  // library-designs-20261014/03, Favorite left out until bookmarks exist):
  // Profile (the account: picture, name, wallet, plan, referral, X先知
  // settings, deleting the account) and Library (your work, one section per
  // app). /profile opens on Profile (owner, Oct 16); links to your work say
  // ?view=library. The account links force Profile even then: #language (the
  // sidebar globe), #face (X體育設定's 修改名字), #xtell-… (X先知's links to
  // its birth details and personality type, which scroll themselves into
  // view) and the returns from Stripe (?checkout=, ?verify=). ?view= keeps
  // a chosen view across a reload. X先知's own front door is unchanged.
  const [view, setView] = useState<ProfileView>('profile')
  const accountLink = () => {
    const h = window.location.hash
    const q = new URLSearchParams(window.location.search)
    return h === '#language' || h === '#face' || h.startsWith('#xtell') || q.has('checkout') || q.has('verify')
  }
  // Declared before the checkout effect below, which strips ?checkout= from
  // the address: effects run in order, so this one still sees it.
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get('view')
    if (accountLink()) setView('profile')
    else if (v === 'profile' || v === 'library') setView(v)
    const go = () => { if (accountLink()) setView('profile') }
    window.addEventListener('hashchange', go)
    return () => window.removeEventListener('hashchange', go)
  }, [])
  const chooseView = (v: ProfileView) => {
    setView(v)
    const url = new URL(window.location.href)
    url.searchParams.set('view', v)
    url.hash = ''
    window.history.replaceState(window.history.state, '', url.toString())
  }
  // /profile#language is where the sidebar globe lands (Sep 14): bring the
  // picker into view and focus it once the profile has rendered (the page
  // shows Loading until then), and again on a hash change when the globe is
  // clicked while already here.
  useEffect(() => {
    const go = () => {
      if (window.location.hash !== '#language') return
      const el = document.getElementById('language') as HTMLSelectElement | null
      if (!el) return
      el.scrollIntoView({ block: 'center' })
      el.focus({ preventScroll: true })
    }
    go()
    window.addEventListener('hashchange', go)
    return () => window.removeEventListener('hashchange', go)
  }, [profile, view])
  // /profile#face opens the picture, name and ID editor (X體育設定's 修改名字,
  // Oct 14), once the profile has rendered.
  useEffect(() => {
    const go = () => { if (window.location.hash === '#face' && profile) setEditingFace(true) }
    go()
    window.addEventListener('hashchange', go)
    return () => window.removeEventListener('hashchange', go)
  }, [profile])
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
  const [deleting,    setDeleting]    = useState<string | null>(null)
  const [copyId,      setCopyId]      = useState<string | null>(null)
  const [deleteModal, setDeleteModal] = useState<{ type: 'duel' | 'xcreate'; id: string; prompt: string; onDone: () => void } | null>(null)
  const [lightbox,    setLightbox]    = useState<string | null>(null)
  // XCreate output-preview modal — shows the chosen slot's full text /
  // image / video without leaving the profile page. The conversation view
  // (/xcreate?id=...) is reached via the per-card "Detail" button.
  const [previewItem, setPreviewItem] = useState<any | null>(null)
  // Credits wallet + ledger. RLS guarantees the user only sees their own
  // rows, so we can read both tables directly from the browser client.
  const [credits,     setCredits]     = useState<UserCredits | null>(null)
  const [txns,        setTxns]        = useState<CreditTransaction[]>([])
  // False until the first ledger fetch answers, so an open panel says
  // loading rather than flashing "no activity" over a full history.
  const [txLoaded,    setTxLoaded]    = useState(false)
  // Which session groups are expanded in the activity ledger.
  const [openGroups,  setOpenGroups]  = useState<Record<string, boolean>>({})
  // Checkout UI: picker modal + in-flight flag + post-redirect banner
  const [checkoutOpen,     setCheckoutOpen]     = useState(false)
  // Referral panel. Loads once; a 503 means migration 87 has not run yet and
  // the panel simply stays hidden rather than showing an error to the user.
  const [referral, setReferral] = useState<null | {
    code: string; link: string; pending: number; paid: number; earnedCents: number
    verified: boolean; refereeStatus: string | null
  }>(null)
  const [refBusy, setRefBusy] = useState(false)
  const [refCopied, setRefCopied] = useState(false)
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
  // that case and blanks the page. If the row is missing the page shows a
  // default from the auth metadata; the row itself comes from
  // /api/credits/ensure-daily or a save in the editor, because the browser
  // cannot write profiles since migration 125 (Oct 2).
  useEffect(() => {
    const client = sb()
    client.auth.getUser().then(async ({ data }) => {
      // Signed out: useRequireAuth has already opened the sign-in modal, the
      // same door every gated surface uses. It parks /profile in the
      // auth_redirect cookie, so Google brings them back here. This used to
      // send them to /auth/login, a route that never existed (404, Sep 14).
      if (!data.user) return
      const u = data.user
      setUser(u)

      let { data: p } = await client.from('profiles').select('*').eq('id', u.id).maybeSingle()
      if (!p) {
        p = { id: u.id, display_name: userName(u), avatar_url: userPhoto(u), bio: null } as any
      }
      setProfile(p as Profile)

      const { data: c } = await client.from('user_credits').select('*').eq('user_id', u.id).maybeSingle()
      setCredits((c as UserCredits | null) ?? null)

      fetch('/api/profile/handle').then(r => (r.ok ? r.json() : null)).then((h: HandleInfo | null) => { if (h?.handle) setHandleInfo(h) }).catch(() => {})
    })
  }, [])

  // Show delete confirmation modal
  const handleDelete = (type: 'duel' | 'xcreate', id: string, prompt: string, onDone: () => void) => {
    setDeleteModal({ type, id, prompt, onDone })
  }

  // Actually perform the soft-delete after user confirms via modal
  const confirmDelete = async () => {
    if (!deleteModal) return
    const { type, id, onDone } = deleteModal
    setDeleteModal(null)
    setDeleting(id)
    try {
      const res = await fetch('/api/profile/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, id }),
      })
      // The Library takes the card out of its section (and its count).
      if (res.ok) onDone()
    } catch { /* silent */ }
    setDeleting(null)
  }

  // The picture / name editor and the post-checkout banner, shared by the
  // door's account page and www's Profile tab (./Account).
  const faceEditorNode = profile && editingFace && user && (
      <FaceEditor
        user={user}
        current={{ name: profile.display_name, photo: profile.avatar_url }}
        handleInfo={handleInfo}
        onClose={() => {
          setEditingFace(false)
          // Closed: a reload must not open it again.
          if (window.location.hash === '#face') history.replaceState(null, '', window.location.pathname + window.location.search)
        }}
        onSaved={face => setProfile(prev => prev && { ...prev, display_name: face.name, avatar_url: face.photo })}
        onHandle={setHandleInfo}
      />
  )
  const checkoutBannerNode = checkoutBanner && (
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
  )

  // What the Library borrows from the page: the share and delete flows
  // (the confirm modal lives here), the XCreate preview modal, and X先知's
  // rename / erase under the owner policy.
  const libraryActions: LibraryActions = {
    share: id => handleShare('duel', id),
    copiedId: copyId,
    deletingId: deleting,
    requestDelete: handleDelete,
    // A 同款 read (Oct 17) has nothing to preview here: it opens back into
    // 同款; a 風扇變裝 run (Oct 18) opens back into its template there.
    openXcreate: row => {
      const r = row as { id?: string; slots?: { options?: { remake?: unknown; fan?: unknown } }[] }
      if (r?.id && r.slots?.[0]?.options?.remake) { window.location.href = `/xcreate?remake=${r.id}`; return }
      if (r?.id && r.slots?.[0]?.options?.fan) { window.location.href = `/xcreate?fan=${r.id}`; return }
      setPreviewItem(row)
    },
    renameReading: (id, title) => renameReading(sb(), id, title),
    eraseReading: id => eraseReading(sb(), id),
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

  // The credit ledger, read when its panel opens (the Library's sections
  // load their own work, see ./Library).
  useEffect(() => {
    if (!user) return
    const client = sb()
    if (showActivity || (!isXTell && view === 'profile')) {
      // Latest 100 ledger entries. RLS restricts to the signed-in user.
      setTxLoaded(false)
      client.from('credit_transactions').select('*').eq('user_id', user.id)
        .order('created_at', { ascending: false }).limit(300)
        .then(({ data }) => { setTxns((data ?? []) as CreditTransaction[]); setTxLoaded(true) })
      // Refresh balance at the same time in case a debit just landed.
      client.from('user_credits').select('*').eq('user_id', user.id).maybeSingle()
        .then(({ data: c }) => setCredits((c as UserCredits | null) ?? null))
    }
  }, [user, showActivity, view, isXTell])

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
  // The monthly plan as priced for this visitor, plus their subscription
  // (GET /api/stripe/subscription). `available: false` until migration 98.
  const [plan,         setPlan]         = useState<any>(null)
  const [planBusy,     setPlanBusy]     = useState(false)

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

  const loadPlan = () => fetch('/api/stripe/subscription')
    .then(r => (r.ok ? r.json() : null)).then(d => { if (d && !d.error) setPlan(d) }).catch(() => {})

  useEffect(() => {
    if (!user) return
    void loadPlan()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  useEffect(() => {
    if (!user) return
    fetch('/api/referral').then(r => (r.ok ? r.json() : null)).then(d => { if (d && !d.error) setReferral(d) }).catch(() => {})
  }, [user])

  const planAction = async (action: 'subscribe' | 'cancel' | 'resume' | 'portal', when?: string) => {
    if (action === 'cancel' && !confirm(t('profile.plan.confirmcancel').replace('{date}', when ?? ''))) return
    setPlanBusy(true)
    try {
      const res = await fetch('/api/stripe/subscription', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const d = await res.json().catch(() => ({}))
      if (d?.url) { window.location.href = d.url; return }
      if (!res.ok) { alert(d?.error ?? res.statusText); return }
      await loadPlan()
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err))
    } finally {
      setPlanBusy(false)
    }
  }

  // Card verification is a Stripe Checkout session in setup mode: it validates
  // the card and charges nothing. The webhook — never the client — releases the
  // credits, so nothing here can pay anybody.
  const verifyCard = async () => {
    setRefBusy(true)
    try {
      const res = await fetch('/api/referral', { method: 'POST' })
      const d = await res.json()
      if (d?.url) { window.location.href = d.url; return }
      alert(d?.error ?? 'Could not start verification')
    } catch { alert('Could not start verification') }
    setRefBusy(false)
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
      // A subscription checkout returns here too; its row lands via the
      // webhook in the same window the balance does.
      if (!cancelled) void loadPlan()
    }
    poll()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const libraryLoader = useMemo(() => (user?.id ? makeLoader(user.id) : null), [user?.id])

  if (!profile) return (
    <>
      {isXTell ? <XTellAuthGate /> : <ModelXDProfileAuth />}
      {isXTell ? <main id="xtell-main" tabIndex={-1} className="xtell-container xtell-account-welcome">
        <h1 className="xtell-account-title">{t('xtell.site.account')}</h1>
        <p className="xtell-account-note">{t('xtell.site.authCopy')}</p>
        {user ? <p role="status">{t('common.loading')}</p> : <button className="xtell-button" onClick={() => showAuth('/profile')}>{t('auth.signin')}</button>}
      </main> : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: 'var(--muted)' }}>{t('common.loading')}</div>}
    </>
  )

  const initials = (profile.display_name ?? user?.email ?? '?').charAt(0).toUpperCase()

  return (
    <>
      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{position:'fixed',inset:0,zIndex:99000,background:'rgba(0,0,0,0.92)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer'}}>
          <img src={lightbox} alt="Full size" onClick={() => setLightbox(null)} style={{maxWidth:'90vw',maxHeight:'90vh',borderRadius:8,boxShadow:'0 0 80px rgba(0,0,0,0.8)',cursor:'pointer'}} />
          <div onClick={e => e.stopPropagation()} style={{position:'fixed',top:20,right:24,zIndex:99100,display:'flex',gap:10}}>
            {/* downloadFile, not <a download>: the attribute is ignored on
                cross-origin (supabase.co) hrefs, so this button just opened
                a tab — with no way to save at all on mobile Chrome
                (owner, Aug 21). */}
            <button onClick={() => void downloadFile(lightbox, downloadName(lightbox, 'image'))} title="Download"
              style={{display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(255,255,255,0.15)',border:'1px solid rgba(255,255,255,0.3)',borderRadius:8,width:36,height:36,color:'#fff',fontSize:16,cursor:'pointer',boxShadow:'0 2px 12px rgba(0,0,0,0.4)'}}
            >↓</button>
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
                    <button
                      onClick={() => { const u = chosen.text.split('\n')[0]; void downloadFile(u, downloadName(u, isVideo ? 'video' : 'image')) }}
                      style={{padding:'6px 12px',borderRadius:6,background:'rgba(255,255,255,0.12)',border:'1px solid rgba(255,255,255,0.25)',color:'#fff',cursor:'pointer',fontSize:11,fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase'}}
                    >↓ Download</button>
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

      {/* www's account page wears X先知's look (owner, Oct 16: "font family,
          font size... all don't match XTell's style"): its paper, ink and
          vermilion (.xtell-site.is-in-www, as on www's /xtell), its bar, and
          the account page's own X先知 layout (.xtell-profile). The door's
          page is the same markup on its own host. */}
      <div className={isXTell ? undefined : 'xtell-site is-in-www xtell-www-page pv-xtell'}>
      {!isXTell && <ProfileViewTabs view={view} onChange={chooseView} />}
      <div id={isXTell ? "xtell-main" : undefined} tabIndex={isXTell ? -1 : undefined} className="xduel-page xtell-profile">
        <div className={isXTell ? 'arena' : 'arena profile-arena'} style={{ maxWidth: isXTell ? 1040 : view === 'library' ? 1240 : 760 }}>
          {!isXTell && view === 'profile' && (
            <AccountPanel
              name={profile.display_name} photo={profile.avatar_url}
              handle={handleInfo?.handle ?? null} email={user?.email ?? null}
              onEdit={() => setEditingFace(true)} faceEditor={faceEditorNode}
              onSignOut={async () => { await sb().auth.signOut(); window.location.href = '/' }}
              credits={credits} onTopUp={() => setCheckoutOpen(true)}
              txns={txns} txLoaded={txLoaded} banner={checkoutBannerNode}
              plan={plan} planBusy={planBusy} planAction={(a, when) => void planAction(a, when)}
              referral={referral} refBusy={refBusy} refCopied={refCopied} onVerifyCard={verifyCard}
              onCopyRef={() => { if (referral) navigator.clipboard?.writeText(referral.link).then(() => { setRefCopied(true); setTimeout(() => setRefCopied(false), 1800) }).catch(() => {}) }}
              xtellSettings={<div className="xtell-site is-in-www xtell-profile-tab"><DailyProfileSettings /><PersonalitySettings /></div>}
              voices={<VoicesSection />}
            />
          )}
          {isXTell && <>
          {isXTell && <><p className="xtell-eyebrow">XOracle</p><h1 className="xtell-account-title">{t('xtell.site.account')}</h1><p className="xtell-account-note">{t('xtell.site.accountNote')}</p></>}

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
              id="language"
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
          <div className="xtell-profile-summary" style={{
            display: 'flex', alignItems: 'flex-start',
            gap: 24, marginBottom: 44, flexWrap: 'wrap',
          }}>
            {/* Profile block */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 28, flex: '0 1 auto', minWidth: 0, maxWidth: 380 }}>
              {/* Avatar: the saved picture; Edit below changes it (Oct 2). */}
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
                {handleInfo?.handle && (
                  <div style={{ fontSize: 14, color: 'var(--muted2)', margin: '-2px 0 6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>@{handleInfo.handle}</div>
                )}
                <div style={{ fontSize: 11, color: 'var(--muted2)', fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.04em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.email}</div>
                {/* Edit the picture and website name (Oct 2), then Sign Out,
                    which belongs with the identity block (CC, July 19). */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                  <button
                    onClick={() => setEditingFace(true)}
                    style={{
                      padding: '6px 14px', borderRadius: 7,
                      border: '1px solid var(--white)', background: 'transparent',
                      color: 'var(--white)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    }}
                  >
                    {t('face.edit')}
                  </button>
                  <button
                    onClick={async () => { await sb().auth.signOut(); window.location.href = '/' }}
                    style={{
                      padding: '6px 14px', borderRadius: 7,
                      border: '1px solid var(--border2)', background: 'transparent',
                      color: 'var(--muted2)', fontSize: 12, cursor: 'pointer',
                    }}
                  >
                    {t('auth.signout')}
                  </button>
                </div>
                {faceEditorNode}
              </div>
            </div>

            {/* Credit balance card (right of profile) */}
            <div className="xtell-wallet" style={{
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
                {/* The balance above is the TOTAL spendable; this says how much
                    of it is this month's plan credit, which goes first and
                    expires at month end (migration 99). */}
                {credits && (credits.bonus_cents ?? 0) > 0 && credits.bonus_expires_at
                  && new Date(credits.bonus_expires_at).getTime() > Date.now() && (
                  <div style={{
                    fontSize: 11.5, color: '#1FAA34', marginTop: 6,
                    fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.02em',
                  }}>
                    {t('profile.bonus')
                      .replace('{amount}', formatCents(credits.bonus_cents ?? 0))
                      .replace('{date}', new Date(credits.bonus_expires_at).toLocaleDateString(lang, { month: 'short', day: 'numeric' }))}
                  </div>
                )}
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
                // The same credit ledger on both hosts. The XTell shell once
                // pointed this at its charges list; that list became the saved
                // readings, and the ledger vanished with it (owner, Sep 25).
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

          {/* Monthly plan (lib/plans.ts). Hidden until the plan is open
              (migration 98): a Subscribe button that took money the webhook
              could not yet turn into credit would be worse than no button. */}
          {plan?.available && (() => {
            const sub = plan.subscription
            const live = !!sub && ['active', 'trialing', 'past_due'].includes(sub.status)
            const when = sub?.currentPeriodEnd
              ? new Date(sub.currentPeriodEnd).toLocaleDateString(lang, { year: 'numeric', month: 'short', day: 'numeric' })
              : ''
            const btn = (primary: boolean) => ({
              padding: '10px 16px', borderRadius: 6, flexShrink: 0,
              cursor: planBusy ? 'wait' : 'pointer', opacity: planBusy ? 0.6 : 1,
              whiteSpace: 'nowrap' as const, fontWeight: 700, fontSize: 12,
              letterSpacing: '0.06em', textTransform: 'uppercase' as const,
              fontFamily: 'var(--font-body), sans-serif',
              background: primary ? '#1FAA34' : 'transparent',
              border: primary ? 'none' : '1px solid var(--border2)',
              color: primary ? '#fff' : 'var(--muted2)',
            })
            return (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
                border: '1px solid var(--border2)', borderLeft: '3px solid #1FAA34',
                borderRadius: 10, padding: '16px 22px', marginBottom: 16,
              }}>
                <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                  <div style={{
                    fontSize: 10, color: 'var(--muted2)', textTransform: 'uppercase' as const,
                    letterSpacing: '0.18em', fontFamily: 'var(--font-mono), monospace', marginBottom: 6,
                  }}>
                    {t(isXTell ? 'xtell.site.pass' : 'profile.plan.title')} · {plan.plan.price}{t('profile.plan.permonth')}
                  </div>
                  {live ? (
                    <div style={{ fontSize: 14, fontWeight: 700, color: sub.status === 'past_due' ? 'var(--red)' : 'var(--white)' }}>
                      {sub.status === 'past_due' ? t('profile.plan.pastdue')
                        : sub.cancelAtPeriodEnd ? t('profile.plan.ending').replace('{date}', when)
                        : t('profile.plan.active').replace('{date}', when)}
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--white)', lineHeight: 1.5 }}>
                        {t('profile.plan.pitch')
                          .replace('{total}', formatCents(plan.plan.creditCents + plan.plan.bonusCents))
                          .replace('{credit}', formatCents(plan.plan.creditCents))
                          .replace('{bonus}', formatCents(plan.plan.bonusCents))}
                      </div>
                      {/* The renewal terms sit next to the button that agrees
                          to them, not behind a link. */}
                      <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 6, lineHeight: 1.65 }}>
                        {t('profile.plan.fine')}
                      </div>
                    </>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {!live && <button disabled={planBusy} onClick={() => void planAction('subscribe')} style={btn(true)}>{t('profile.plan.subscribe')}</button>}
                  {live && !sub.cancelAtPeriodEnd && <button disabled={planBusy} onClick={() => void planAction('cancel', when)} style={btn(false)}>{t('profile.plan.cancel')}</button>}
                  {live && sub.cancelAtPeriodEnd && <button disabled={planBusy} onClick={() => void planAction('resume')} style={btn(true)}>{t('profile.plan.resume')}</button>}
                  {sub && <button disabled={planBusy} onClick={() => void planAction('portal')} style={btn(false)}>{t('profile.plan.manage')}</button>}
                </div>
              </div>
            )
          })()}

          {/* Post-checkout banner. Shown briefly after Stripe redirects the
              user back to /profile?checkout=success|cancel. The success
              banner sits next to a polling effect that refreshes the
              balance once the webhook lands. */}
          {checkoutBannerNode}

          {/* ── Referral ──
              $10 welcome for everyone; a referred friend gets $5 more and the
              referrer $5, both released when the friend verifies a card. The
              card is the point: it is the only signal that proves one real
              person (see supabase/87_referrals.sql). Hidden entirely until
              migration 87 has run. */}
          {referral && (
            <div style={{ marginBottom: 16, border: '1px solid var(--border)', borderRadius: 10, padding: '14px 20px' }}>
              {/* Title and running totals share one line; the totals used to
                  take a whole row of their own at the bottom. */}
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 10, ...{ fontSize: 10, fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.12em', textTransform: 'uppercase' as const }, color: 'var(--muted2)' }}>
                <span>{t('profile.ref.title')}</span>
                <span style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                  <span>{t('profile.ref.joined')} <b style={{ color: 'var(--white)' }}>{referral.paid}</b></span>
                  <span>{t('profile.ref.pending')} <b style={{ color: 'var(--white)' }}>{referral.pending}</b></span>
                  <span>{t('profile.ref.earned')} <b style={{ color: 'var(--green)' }}>{formatCents(referral.earnedCents)}</b></span>
                </span>
              </div>

              {/* A referee who has not verified sees the offer to unlock. */}
              {referral.refereeStatus === 'pending' && !referral.verified && (
                <div style={{ fontSize: 13, color: 'var(--white)', marginBottom: 10, lineHeight: 1.5 }}>
                  {t('profile.ref.unlock')}
                  <button onClick={verifyCard} disabled={refBusy} style={{
                    marginLeft: 10, padding: '6px 14px', borderRadius: 999, border: 'none',
                    background: 'var(--red)', color: '#fff', fontSize: 12, fontWeight: 700,
                    cursor: refBusy ? 'default' : 'pointer', opacity: refBusy ? 0.6 : 1,
                  }}>{refBusy ? '…' : t('profile.ref.verify')}</button>
                </div>
              )}

              {/* The explanation sits beside the link instead of above it. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 380px', minWidth: 0, fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5 }}>
                  {t('profile.ref.blurb')}
                </div>
                <code style={{
                  flex: '0 1 340px', minWidth: 0, padding: '8px 12px', borderRadius: 8,
                  background: 'var(--surface2)', border: '1px solid var(--border2)',
                  fontFamily: 'var(--font-mono), monospace', fontSize: 12, color: 'var(--white)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{referral.link}</code>
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(referral.link).then(() => {
                      setRefCopied(true); setTimeout(() => setRefCopied(false), 1800)
                    }).catch(() => {})
                  }}
                  style={{
                    padding: '7px 16px', borderRadius: 999, border: '1px solid var(--border2)', flexShrink: 0,
                    background: refCopied ? 'var(--green)' : 'transparent',
                    color: refCopied ? '#fff' : 'var(--white)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  }}
                >{refCopied ? t('profile.ref.copied') : t('profile.ref.copy')}</button>
              </div>
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
                    aria-label={t('xtell.site.close')}
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
                  {txLoaded ? t('profile.ledger.empty') : t('profile.ledger.loading')}
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
                    <div>{t('profile.ledger.date')}</div>
                    <div>{t('profile.ledger.type')}</div>
                    <div>{t('profile.ledger.description')}</div>
                    <div style={{ textAlign: 'right' }}>{t('profile.ledger.amount')}</div>
                    <div style={{ textAlign: 'right' }}>{t('profile.ledger.balance')}</div>
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
                              }}>{kindLabel(t.kind)}</span>
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
                                  }}>{kindLabel(t.kind)}</span>
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

          </>}

          {isXTell ? <><DailyProfileSettings /><PersonalitySettings /><XTellActivity userId={user.id} /></>
            // www: the Profile tab (AccountPanel above) holds X先知's
            // settings; its readings are a Library section.
            : view === 'library' && libraryLoader
              ? <ProfileLibrary loader={libraryLoader} actions={libraryActions} />
              : null}

          {(isXTell || view === 'profile') && <>
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
          </>}

        </div>
      </div>
      </div>

      {isXTell && <XTellFooter />}

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
                {t('profile.topup.kicker')}
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
              {t('profile.topup.title')}
            </h2>
            <div style={{
              fontSize: 12, color: 'var(--muted2)', marginBottom: 22, lineHeight: 1.6,
              fontFamily: 'var(--font-body), sans-serif',
            }}>
              {t('profile.topup.sub')}
            </div>

            {/* Tier grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
              {DISPLAY_TIERS.map((tr) => {
                const isSelected = pickedTier === tr.id
                const isDimmed = checkoutTier !== null && !isSelected
                return (
                  <button
                    key={tr.id}
                    onClick={() => setPickedTier(tr.id)}
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
                      {tr.label}
                    </div>
                    {/* Japanese pages: the amount in yen too (Sep 29). */}
                    {lang === 'ja' && <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>{yenApprox(tr.priceCents / 100)}</div>}
                    <div style={{
                      fontSize: 10.5, color: 'var(--muted2)',
                      fontFamily: 'var(--font-mono), monospace',
                      letterSpacing: '0.06em', textTransform: 'uppercase' as const,
                      lineHeight: 1.4,
                    }}>
                      {t(`profile.topup.tier.${tr.id}`)}
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
                  {t('profile.topup.custom')}
                </div>
              </div>
            </div>

            {/* Recipient: myself (default) or someone else — the email box
                appears only for gifts. Server verifies the account exists. */}
            <div style={{ marginTop: 14 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                {([['self', t('profile.topup.self')], ['other', t('profile.topup.other')]] as const).map(([mode, label]) => (
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
                    placeholder={t('profile.topup.giftEmail')}
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
                      {t('profile.topup.giftNote').replace('{email}', giftEmail.trim())}
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
                ? `$${(cents / 100).toLocaleString()}${lang === 'ja' ? `（${yenApprox(cents / 100)}）` : ''}`
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
                    ? t('profile.topup.redirecting')
                    : pickedTier === 'custom' && !customValid
                      ? t('profile.topup.enter')
                      : t('profile.topup.pay').replace('{amount}', amount)}
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
                {t('profile.topup.toStripe')}
              </div>
            )}

            {!checkoutTier && (
              <div style={{
                marginTop: 20, paddingTop: 14, borderTop: '1px solid var(--border)',
                fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.6,
                textAlign: 'center' as const,
              }}>
                {/* One-time, and the refund rule, beside the button that pays
                    (Sep 29: a Japanese tester asked for the terms in plain view). */}
                {t('profile.topup.fine')}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
