'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import type { User } from '@supabase/supabase-js'
import { useAuthModal } from '../../lib/AuthModalContext'
import { useLang } from '../../lib/i18n'
import { XCREATE_TEMPLATES } from '../xcreate/templates'
import ContactEmail from './ContactEmail'
import BugReportLink from './BugReport'

// The logo doubles as the home link, so the explicit "Home" item is gone.
const NAV_LINKS = [
  { href: '/xduel',       i18n: 'nav.xduel',       protected: true,  icon: 'duel'   },
  { href: '/xcreate',     i18n: 'nav.xcreate',     protected: true,  icon: 'create' },
  { href: '/xdirect',     i18n: 'nav.xdirect',     protected: true,  icon: 'director' },
  { href: '/xcut',        i18n: 'nav.xcut',        protected: true,  icon: 'cut' },
  { href: '/xtalk',       i18n: 'nav.xtalk',       protected: true,  icon: 'talk'   },
  { href: '/xgame',       i18n: 'nav.xgame',       protected: true,  icon: 'game'   },
  { href: '/xvote',       i18n: 'nav.xvote',       protected: true,  icon: 'vote'   },
  { href: '/xboard',      i18n: 'nav.xboard',      protected: false, icon: 'board'  },
  { href: '/xeval',       i18n: 'nav.xeval',       protected: false, icon: 'board'  },
  // XDev — API keys + MCP for external agents. Open since Aug 24.
  { href: '/xdev',        i18n: 'nav.xdev',        protected: true,  icon: 'dev' },
]

// Inline SVG icons (no icon-font dependency). 18px, inherit color via
// currentColor so the active/hover states tint them automatically.
function NavIcon({ name }: { name: string }) {
  const p = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, style: { flexShrink: 0 } }
  switch (name) {
    case 'duel':   return (<svg {...p}><path d="M21 3v5l-11 9l-4 4l-3-3l4-4l9-11z"/><path d="M5 13l6 6"/><path d="M14.32 17.32l3.68 3.68l3-3l-3.68-3.68"/><path d="M10 5.5l-2-2.5h-5v5l3 2.5"/></svg>)
    case 'create': return (<svg {...p}><path d="M6 21l15-15l-3-3l-15 15l3 3z"/><path d="M15 6l3 3"/><path d="M9 3a2 2 0 0 0 2 2a2 2 0 0 0-2 2a2 2 0 0 0-2-2a2 2 0 0 0 2-2"/></svg>)
    case 'director': return (<svg {...p}><path d="M4 11h16v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9z"/><path d="M4 11l-1-4l16-4l1 4z"/><path d="M8 10l2-4"/><path d="M13 9l2-4"/></svg>)
    case 'vote':   return (<svg {...p}><path d="M7 11v8a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3a4 4 0 0 0 4-4v-1a2 2 0 0 1 4 0v5h3a2 2 0 0 1 2 2l-1 5a2 3 0 0 1-2 2h-7a3 3 0 0 1-3-3"/></svg>)
    // A die: the arena's mark.
    case 'game':   return (<svg {...p}><rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="9" cy="9" r="0.8" fill="currentColor"/><circle cx="15" cy="15" r="0.8" fill="currentColor"/><circle cx="12" cy="12" r="0.8" fill="currentColor"/></svg>)
    case 'board':  return (<svg {...p}><path d="M4 20h16"/><path d="M5 12h2v7H5z"/><path d="M10.5 8h2v11h-2z"/><path d="M16 4h2v15h-2z"/></svg>)
    // Two bubbles, overlapping — one voice answering another, which is the
    // whole difference between this and every other page.
    case 'talk':   return (<svg {...p}><path d="M8 13H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/><path d="M6 13v3l3-3"/><path d="M19 20h-9a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2z"/><path d="M18 20v3l-3-3"/></svg>)
    // Angle brackets around a key stem: agents plug in here.
    case 'cut':    return (<svg {...p}><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.12 15.88"/><path d="M14.47 14.48L20 20"/><path d="M8.12 8.12L12 12"/></svg>)
    case 'dev':    return (<svg {...p}><path d="M8 6l-5 6l5 6"/><path d="M16 6l5 6l-5 6"/><path d="M12 9v6"/><circle cx="12" cy="9" r="0.8" fill="currentColor"/></svg>)
    default:       return null
  }
}

// Output-mode glyphs for history rows — same shapes as ModeIcon in
// app/xcreate/page.tsx (the Mode Selection tabs); keep in sync. 14px,
// monochrome via currentColor (CC: no color emoji in history rows).
function HistoryModeIcon({ m }: { m: string }) {
  const p = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, style: { flexShrink: 0 } }
  if (m === 'text')  return (<svg {...p}><path d="M4 6h16"/><path d="M4 12h10"/><path d="M4 18h14"/></svg>)
  if (m === 'image') return (<svg {...p}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>)
  return (<svg {...p}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9l5 3l-5 3z"/></svg>)
}

// History row title: template name when the prompt came from a template
// (matched by the prompt prefix up to the template's first {{placeholder}}),
// else the first few words of the prompt. Zero-cost "summary" — real LLM
// titles would be a paid call per run (post-launch idea).
function historyTitle(prompt: string): string {
  const clean = (s: string) => s.replace(/\{\{|\}\}/g, '').trim()
  const p = clean(prompt)
  for (const tpl of XCREATE_TEMPLATES) {
    const braceAt = tpl.starterPrompt.indexOf('{{')
    const prefix = clean(braceAt >= 0 ? tpl.starterPrompt.slice(0, braceAt) : tpl.starterPrompt).slice(0, 60)
    if (prefix.length >= 10 && p.startsWith(prefix.slice(0, Math.min(prefix.length, 40)))) return tpl.title
  }
  const words = p.split(/\s+/)
  return words.slice(0, 7).join(' ') + (words.length > 7 ? '…' : '')
}

export default function Nav() {
  const pathname = usePathname()
  const router = useRouter()
  const { show } = useAuthModal()
  const { lang, t } = useLang()
  const [menuOpen, setMenuOpen] = useState(false)
  // dev.modelxd.com and localhost wear a Beta tag with an exit to the
  // official site (CC, Aug 3) — anywhere that isn't www is a dev build.
  // Hostname check after mount: env vars would need separate builds, and
  // SSR must render the same markup on every host.
  const [isDev, setIsDev] = useState(false)
  useEffect(() => {
    const h = window.location.hostname
    setIsDev(h.startsWith('dev.') || h === 'localhost' || h === '127.0.0.1')
  }, [])
  const [user, setUser] = useState<User | null>(null)
  // Beta flags for nav items that carry a `feature` key. Fetched rather
  // than passed down because Nav renders on every route, gated or not.
  // No feature fetch any more: every surface in NAV_LINKS is either public
  // or auth-only since XDev opened (Aug 24). The old flags-with-localStorage
  // dance existed purely to stop the nav reflowing when /api/features
  // answered — with nothing left to gate, the links paint once.
  // XCreate history (chat-history pattern): shown under the menu — with a
  // divider so it reads as a separate layer, not more menu items — only
  // while the user is in XCreate. Collapsible, persisted.
  // Finished xcreates rows only — in-flight jobs are not listed (owner,
  // Aug 20); the active tab's own URL carries ?job= while a run is in flight.
  const [recent, setRecent] = useState<Array<{ id: string; prompt: string; mode: string; created_at: string; title?: string | null }>>([])
  // Which history row is being renamed, across the lists. One editor at a
  // time keyed by table + id (CC, Aug 3).
  const [editing, setEditing] = useState<{ table: 'xcreates' | 'xtalk_sessions' | 'xdirector_conversations'; id: string } | null>(null)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const renameRow = async (table: 'xcreates' | 'xtalk_sessions' | 'xdirector_conversations', id: string, raw: string) => {
    const title = raw.trim().slice(0, 80) || null
    setEditing(null)
    if (table === 'xcreates') setRecent(prev => prev.map(r => r.id === id ? { ...r, title } : r))
    else if (table === 'xtalk_sessions') {
      setRecentGames(prev => prev.map(g => g.id === id ? { ...g, title } : g))
      setRecentTalks(prev => prev.map(g => g.id === id ? { ...g, title } : g))
    }
    else setRecentConvs(prev => prev.map(c => c.id === id ? { ...c, title } : c))
    await supabase.from(table).update({ title }).eq('id', id)
  }
  const [recentCollapsed, setRecentCollapsed] = useState(false)
  const [authLoaded, setAuthLoaded] = useState(false)
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  )

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user)
      setAuthLoaded(true)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      setAuthLoaded(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    try { setRecentCollapsed(localStorage.getItem('xcreate.history.collapsed') === '1') } catch { /* private mode */ }
  }, [])

  // Whole-rail collapse (owner ask, Aug 9): icons only at 64px. Desktop
  // only — mobile already collapses into the top bar + hamburger. Read
  // after mount like isDev above: SSR must render the expanded rail so
  // markup matches on every host, so the first paint is expanded.
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => {
    try { setCollapsed(localStorage.getItem('nav.collapsed') === '1') } catch { /* private mode */ }
  }, [])
  const toggleCollapsed = () => {
    setCollapsed(c => {
      try { localStorage.setItem('nav.collapsed', c ? '0' : '1') } catch { /* private mode */ }
      return !c
    })
  }

  // Fetch the last 10 runs whenever the user lands on /xcreate (also
  // refreshes after a generation → the page URL gains ?id= → pathname
  // stays but a re-nav elsewhere and back re-fetches; good enough v1).
  const onXcreate = pathname?.startsWith('/xcreate') ?? false
  const onXtalk   = pathname?.startsWith('/xtalk') ?? false
  // Werewolf history follows the games to /xgame (CC, Aug 6).
  const onXgame   = pathname?.startsWith('/xgame') ?? false
  // Your characters, most-recently-talked first (owner ask, Aug 8) —
  // owner-read RLS, deep link via /xtalk?char=<id>.
  const [recentChars, setRecentChars] = useState<Array<{ id: string; name: string; avatar_path: string | null; last_chat_at: string | null }>>([])
  useEffect(() => {
    if (!onXtalk || !user) { setRecentChars([]); return }
    let cancelled = false
    supabase.from('x_characters')
      .select('id, name, avatar_path, last_chat_at')
      .eq('user_id', user.id)
      .order('last_chat_at', { ascending: false, nullsFirst: false }).limit(8)
      .then(res => { if (!cancelled && !res.error) setRecentChars((res.data ?? []) as any[]) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onXtalk, user?.id, pathname])
  // Discussion rooms persist since Aug 6 — same owner-read listing as the
  // games, filtered to the discussion tenant.
  const [recentTalks, setRecentTalks] = useState<Array<{ id: string; title: string | null; updated_at: string }>>([])
  useEffect(() => {
    if (!onXtalk || !user) { setRecentTalks([]); return }
    let cancelled = false
    supabase.from('xtalk_sessions')
      .select('id, title, updated_at')
      .eq('user_id', user.id).eq('game', 'discussion')
      .order('updated_at', { ascending: false }).limit(10)
      .then(res => { if (!cancelled && !res.error) setRecentTalks((res.data ?? []) as any[]) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onXtalk, user?.id, pathname])
  const onXdirect = pathname?.startsWith('/xdirect') ?? false
  // Director conversations — same owner-read RLS pattern as the other two
  // lists. Soft-delete only (deleted_at), matching the API's GET filter.
  const [recentConvs, setRecentConvs] = useState<Array<{ id: string; title: string | null; updated_at: string }>>([])
  useEffect(() => {
    if (!onXdirect || !user) { setRecentConvs([]); return }
    let cancelled = false
    supabase.from('xdirector_conversations')
      .select('id, title, updated_at')
      .eq('user_id', user.id).is('deleted_at', null)
      .order('updated_at', { ascending: false }).limit(10)
      .then(res => { if (!cancelled && !res.error) setRecentConvs((res.data ?? []) as any[]) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onXdirect, user?.id, pathname])
  // Werewolf games are server-held sessions with owner-read RLS, so the
  // browser client lists them the same way it lists xcreates. Discussions
  // aren't here: they live in client state and have no row to link to.
  const [recentGames, setRecentGames] = useState<Array<{ id: string; status: string; day: number; winner: string | null; created_at: string; title: string | null }>>([])
  useEffect(() => {
    if (!onXgame || !user) { setRecentGames([]); return }
    let cancelled = false
    // Discussions share the table since Aug 6 — they are /xtalk rows, not
    // games, so keep them out of this list.
    const gsel = (cols: string) => supabase.from('xtalk_sessions')
      .select(cols).eq('user_id', user.id).neq('game', 'discussion')
      .order('updated_at', { ascending: false }).limit(10)
    gsel('id, status, day, winner, created_at, title').then(async res => {
      const r = res.error ? await gsel('id, status, day, winner, created_at') : res
      if (!cancelled) setRecentGames(((r.data ?? []) as any[]).map(g => ({ ...g, title: g.title ?? null })))
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onXgame, user?.id, pathname])
  useEffect(() => {
    if (!onXcreate || !user) { setRecent([]); return }
    let cancelled = false
    // FINISHED runs only (xcreates). In-flight xcreate_jobs used to be
    // listed here as ?job= links, but a transient job URL wearing a
    // durable-looking history entry read as noise (owner, Aug 20) — and the
    // active tab's address bar now carries ?job= itself while a run is in
    // flight, swapping to ?id= when it settles, so the entry was redundant.
    // The 5s refresh below is what makes a just-finished run appear.
    const load = async () => {
      // deleted_at filter on BOTH rungs — without it, soft-deleted runs
      // (node deletes, the sidebar's own × below) kept haunting the list.
      const doneRes = await supabase.from('xcreates')
        .select('id, prompt, mode, created_at, title')
        .eq('user_id', user.id).is('deleted_at', null)
        .order('created_at', { ascending: false }).limit(10)
        .then(res => res.error
          ? supabase.from('xcreates').select('id, prompt, mode, created_at')
              .eq('user_id', user.id).is('deleted_at', null)
              .order('created_at', { ascending: false }).limit(10)
          : res)
      if (cancelled) return
      setRecent(((doneRes.data ?? []) as any[]).slice(0, 12))
    }
    load()
    // Generate-click shows up here INSTANTLY (owner, Aug 20): the composer
    // dispatches run-started with the row id it just minted, and we prepend
    // an optimistic entry — the next load() replaces it with the server's
    // birth-stub row (born ~0.2s after the job), so the two can never
    // disagree for long.
    const onRunStarted = (e: Event) => {
      const d = (e as CustomEvent).detail as { id?: string; prompt?: string; mode?: string } | undefined
      if (!d?.id) return
      setRecent(prev => [
        { id: d.id!, prompt: d.prompt ?? '', mode: d.mode ?? 'text', created_at: new Date().toISOString(), title: null },
        ...prev.filter(r => r.id !== d.id),
      ].slice(0, 12))
    }
    window.addEventListener('xcreate:run-started', onRunStarted)
    // While anything is generating, refresh so a finished run stops spinning
    // and moves into the completed list on its own. HIDDEN tabs skip the
    // tick entirely (CC, July 27): supabase-js serializes auth operations
    // through a navigator.locks lock shared across every open tab, and a
    // pile of background tabs polling every 5s can steal the lock from a
    // freshly loading tab hard enough to crash its hydration ("Lock broken
    // by another request with the 'steal' option").
    const iv = setInterval(() => {
      if (typeof document === 'undefined' || !document.hidden) load()
    }, 5000)
    return () => { cancelled = true; clearInterval(iv); window.removeEventListener('xcreate:run-started', onRunStarted) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onXcreate, user?.id])

  const toggleRecent = () => {
    setRecentCollapsed(c => {
      try { localStorage.setItem('xcreate.history.collapsed', c ? '0' : '1') } catch { /* private mode */ }
      return !c
    })
  }

  // Auto-close the mobile menu whenever the route changes — otherwise
  // tapping a link leaves the overlay covering the page you just
  // navigated to.
  useEffect(() => { setMenuOpen(false) }, [pathname])

  // Daily $1 grant — fire once per UTC day per browser. The server
  // endpoint only logs locale/last-seen now; duplicate POSTs are
  // safe, but we gate on localStorage to keep the chatter down on
  // every page load. The key is per-user so a different account on
  // the same browser still gets its grant. Cleared automatically on
  // logout (different user.id → fresh check).
  useEffect(() => {
    if (!user) return
    if (typeof window === 'undefined') return
    const todayUtc = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
    const key = `modelxd:dailyGrant:${user.id}`
    const last = window.localStorage.getItem(key)
    if (last === todayUtc) return
    fetch('/api/credits/ensure-daily', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // App language rides along for market analytics (profiles.language).
      body: JSON.stringify({ lang }),
    })
      // Only mark the day claimed when the grant actually happened —
      // unverified users get ok:false and retry after verifying.
      .then(r => r.json())
      .then(d => { if (d?.ok) window.localStorage.setItem(key, todayUtc) })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  // Hide the Nav on the password gate. The links would just redirect
  // back to /coming-soon (no cookie yet) and the "Log in" button would
  // try to start an OAuth flow that lands in the same loop.
  // NOTE: this early return MUST stay below every hook above — React
  // requires the same hooks to run in the same order on every render,
  // or you get "Rendered fewer hooks than expected".
  if (pathname === '/coming-soon') return null

  const handleProtectedClick = (e: React.MouseEvent, href: string, isProtected: boolean) => {
    if (isProtected && !user) {
      e.preventDefault()
      show(href)
    }
  }

  return (
    <nav className={collapsed ? 'nav nav--collapsed' : 'nav'}>
      {/* Collapse toggle — a pill straddling the rail's right border.
          Desktop only (hidden ≤760px where the rail is a top bar). */}
      <button
        type="button"
        className="nav-collapse-btn"
        onClick={toggleCollapsed}
        aria-expanded={!collapsed}
        aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
      >{collapsed ? '»' : '«'}</button>
      {/* The "logo" is the whole lockup — mark + wordmark. The Beta sticker
          hangs off ITS bottom-right corner, overlapping the text slightly,
          and the official-site link tucks in right beneath the sticker so
          the pair reads as one message (CC, Aug 3). */}
      <Link href="/" className="nav-logo-text" style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
        <img src="/logo.png" alt="ModelXD" style={{ width: 36, height: 36, borderRadius: 8, flexShrink: 0 }} />
        <span>{lang.startsWith('zh') ? t('brand') : <>Model<span className="x">XD</span></>}</span>
        {isDev && (
          <span style={{
            position: 'absolute', bottom: 12, right: 8, whiteSpace: 'nowrap', opacity: 0.82,
            padding: '1px 6px', borderRadius: 999, fontSize: 8, fontWeight: 800,
            letterSpacing: '.1em', textTransform: 'uppercase', lineHeight: 1.5,
            background: 'var(--red)', color: '#fff',
            fontFamily: 'var(--font-mono), monospace',
            boxShadow: '0 1px 4px rgba(0,0,0,.25)',
          }}>Beta</span>
        )}
      </Link>
      {isDev && (
        <a href="https://www.modelxd.com" className="nav-beta-exit" style={{
          display: 'inline-block', margin: '-13px 2px 0 auto', alignSelf: 'flex-end',
          fontSize: 10.5, fontWeight: 700, color: 'var(--red)', textDecoration: 'none',
          fontFamily: 'var(--font-mono), monospace', letterSpacing: '.04em',
          borderBottom: '1px dashed var(--red)', paddingBottom: 1, whiteSpace: 'nowrap',
        }}>
          {t('beta.official')} →
        </a>
      )}
      <div className="nav-links">
        {NAV_LINKS.map(({ href, i18n, protected: isProtected, icon }) => (
          <Link
            key={href}
            href={href}
            className={pathname === href ? 'active' : ''}
            onClick={(e) => handleProtectedClick(e, href, isProtected)}
            title={collapsed ? t(i18n) : undefined}
          >
            <NavIcon name={icon} /><span className="nav-label">{t(i18n)}</span>
          </Link>
        ))}
      </div>
      {/* XCreate history — under the menu with a divider line so it reads
          as a distinct layer (CC), like every AI chat app's history list.
          Rows are lowercase / smaller than the uppercase menu items. */}
      {onXcreate && recent.length > 0 && (
        <div className="nav-history">
          {/* Whole header row toggles collapse (CC) — not just the chevron. */}
          <button
            type="button"
            className="nav-history-head"
            onClick={toggleRecent}
            aria-expanded={!recentCollapsed}
            aria-label={recentCollapsed ? 'Expand history' : 'Collapse history'}
          >
            <span className="nav-history-cap">{t('xcreate.recent')}</span>
            <span className="nav-history-toggle" aria-hidden>{recentCollapsed ? '»' : '«'}</span>
          </button>
          {!recentCollapsed && recent.map(item => (
            editing && editing.table === 'xcreates' && editing.id === item.id ? (
              <input
                key={`edit-${item.id}`} autoFocus value={nameDraft}
                onChange={e => setNameDraft(e.target.value)}
                onBlur={() => renameRow('xcreates', item.id, nameDraft)}
                onKeyDown={e => { if (e.key === 'Enter') renameRow('xcreates', item.id, nameDraft); if (e.key === 'Escape') setEditing(null) }}
                className="nav-history-item"
                style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--red)', borderRadius: 6, color: 'var(--white)', fontFamily: 'inherit', fontSize: 12.5, padding: '4px 8px', outline: 'none' }}
              />
            ) : (
            <div key={item.id} className="nav-history-item" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Link
                href={`/xcreate?id=${item.id}`}
                style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0, color: 'inherit', textDecoration: 'none' }}
                title={item.title || item.prompt}
              >
                <HistoryModeIcon m={item.mode} />
                <span className="nav-history-text">{item.title || (item.prompt ? historyTitle(item.prompt) : '(no prompt)')}</span>
              </Link>
              <button
                aria-label="rename" title={t('hist.rename')}
                onClick={(e) => { e.preventDefault(); setNameDraft(item.title || ''); setEditing({ table: 'xcreates', id: item.id }) }}
                style={{ border: 'none', background: 'none', cursor: 'none', padding: 0, color: 'var(--muted)', fontSize: 11, flexShrink: 0, opacity: 0.5 }}
              >✏</button>
              {/* Delete — two-step confirm, same pattern as the XDirector
                  list. SOFT delete (deleted_at): boards, the ?id= loader
                  and this list all filter on it, and a hard delete would
                  orphan lineage rows that point here. XCreates never had
                  this button — only rename (owner, Aug 21). */}
              {confirmDel === item.id ? (
                <span style={{ display: 'inline-flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
                  <button
                    aria-label="confirm delete" title={t('hist.delete.confirm')}
                    onClick={async () => {
                      setConfirmDel(null)
                      await supabase.from('xcreates')
                        .update({ deleted_at: new Date().toISOString() }).eq('id', item.id)
                      setRecent(prev => prev.filter(x => x.id !== item.id))
                      if (typeof window !== 'undefined' && window.location.search.includes(item.id)) router.push('/xcreate')
                    }}
                    style={{ border: 'none', background: 'none', cursor: 'none', padding: 0, color: 'var(--red)', fontSize: 12, fontWeight: 700, lineHeight: 1, flexShrink: 0 }}
                  >{t('hist.delete')}</button>
                  <button aria-label="cancel" onClick={() => setConfirmDel(null)}
                    style={{ border: 'none', background: 'none', cursor: 'none', padding: 0, color: 'var(--muted)', fontSize: 12, lineHeight: 1, flexShrink: 0 }}>×</button>
                </span>
              ) : (
                <button
                  aria-label="delete run"
                  title={t('hist.delete')}
                  onClick={() => { setConfirmDel(item.id); setTimeout(() => setConfirmDel(x => x === item.id ? null : x), 4000) }}
                  style={{ border: 'none', background: 'none', cursor: 'none', padding: 0, color: 'var(--muted)', fontSize: 13, lineHeight: 1, flexShrink: 0, opacity: 0.55 }}
                >×</button>
              )}
            </div>
            )
          ))}
        </div>
      )}

      {/* XTalk history — same layer as XCreate's, one row per werewolf
          game. The glyph is the outcome: live, wolves won, village won. */}
      {onXgame && recentGames.length > 0 && (
        <div className="nav-history">
          <div className="nav-history-head" style={{ cursor: 'default' }}>
            <span className="nav-history-cap">{t('xt.recent')}</span>
          </div>
          {recentGames.map(g => (
            editing && editing.table === 'xtalk_sessions' && editing.id === g.id ? (
              <input
                key={`edit-${g.id}`} autoFocus value={nameDraft}
                onChange={e => setNameDraft(e.target.value)}
                onBlur={() => renameRow('xtalk_sessions', g.id, nameDraft)}
                onKeyDown={e => { if (e.key === 'Enter') renameRow('xtalk_sessions', g.id, nameDraft); if (e.key === 'Escape') setEditing(null) }}
                className="nav-history-item"
                style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--red)', borderRadius: 6, color: 'var(--white)', fontFamily: 'inherit', fontSize: 12.5, padding: '4px 8px', outline: 'none' }}
              />
            ) : (
            <div key={g.id} className="nav-history-item" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Link
                href={`/xgame/${g.id}`}
                style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0, color: 'inherit', textDecoration: 'none' }}
                title={`${g.title || t('xt.tpl.werewolf.name')} · ${new Date(g.created_at).toLocaleString()}`}
              >
                <span aria-hidden style={{ fontSize: 12, flexShrink: 0 }}>
                  {g.status === 'active' ? '🎲' : g.winner === 'wolves' ? '🐺' : '🏘️'}
                </span>
                <span className="nav-history-text">
                  {g.title || `${t('xt.tpl.werewolf.name')} · D${g.day}${g.status === 'active' ? '' : ` · ${g.winner === 'wolves' ? t('ww.role.wolf') : t('xt.village')}`}`}
                </span>
              </Link>
              <button
                aria-label="rename" title={t('hist.rename')}
                onClick={() => { setNameDraft(g.title || ''); setEditing({ table: 'xtalk_sessions', id: g.id }) }}
                style={{ border: 'none', background: 'none', cursor: 'none', padding: 0, color: 'var(--muted)', fontSize: 11, lineHeight: 1, flexShrink: 0, opacity: 0.5 }}
              >✏</button>
              {confirmDel === g.id ? (
                <span style={{ display: 'inline-flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
                  <button
                    aria-label="confirm delete" title={t('hist.delete.confirm')}
                    onClick={async () => {
                      setConfirmDel(null)
                      await supabase.from('xtalk_sessions').delete().eq('id', g.id)
                      setRecentGames(prev => prev.filter(x => x.id !== g.id))
                      if (pathname === `/xgame/${g.id}`) router.push('/xgame')
                    }}
                    style={{ border: 'none', background: 'none', cursor: 'none', padding: 0, color: 'var(--red)', fontSize: 12, fontWeight: 700, lineHeight: 1, flexShrink: 0 }}
                  >{t('hist.delete')}</button>
                  <button aria-label="cancel" onClick={() => setConfirmDel(null)}
                    style={{ border: 'none', background: 'none', cursor: 'none', padding: 0, color: 'var(--muted)', fontSize: 12, lineHeight: 1, flexShrink: 0 }}>×</button>
                </span>
              ) : (
                <button
                  aria-label="delete game"
                  title={t('hist.delete')}
                  onClick={() => { setConfirmDel(g.id); setTimeout(() => setConfirmDel(c => c === g.id ? null : c), 4000) }}
                  style={{ border: 'none', background: 'none', cursor: 'none', padding: 0, color: 'var(--muted)', fontSize: 13, lineHeight: 1, flexShrink: 0, opacity: 0.55 }}
                >×</button>
              )}
            </div>
            )
          ))}
        </div>
      )}

      {/* Your characters — one row each, straight into the chat. */}
      {/* XTalk history — ONE 'Recent' layer like every other page
          (owner, Aug 13: characters and talks were two stacked caps).
          Character chats and discussion rooms interleave by recency. */}
      {onXtalk && (recentChars.length > 0 || recentTalks.length > 0) && (
        <div className="nav-history">
          <div className="nav-history-head" style={{ cursor: 'default' }}>
            <span className="nav-history-cap">{t('xt.recent.all')}</span>
          </div>
          {[
            ...recentChars.map(ch => ({ kind: 'char' as const, ts: ch.last_chat_at ?? '', ch, g: null as any })),
            ...recentTalks.map(g => ({ kind: 'talk' as const, ts: g.updated_at ?? '', ch: null as any, g })),
          ].sort((a, b) => String(b.ts).localeCompare(String(a.ts))).map(row => row.kind === 'char' ? (
            <div key={`c-${row.ch.id}`} className="nav-history-item" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Link
                href={`/xtalk/c/${row.ch.id}`}
                style={{ display: 'flex', alignItems: 'center', gap: 7, flex: 1, minWidth: 0, color: 'inherit', textDecoration: 'none' }}
                title={row.ch.name}
              >
                {row.ch.avatar_path ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/x-characters/${row.ch.avatar_path}`}
                    alt="" style={{ width: 16, height: 16, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                ) : (
                  <span aria-hidden style={{ fontSize: 11, flexShrink: 0 }}>👤</span>
                )}
                <span className="nav-history-text">{row.ch.name}</span>
              </Link>
            </div>
          ) : (
            editing && editing.table === 'xtalk_sessions' && editing.id === row.g.id ? (
              <input
                key={`edit-${row.g.id}`} autoFocus value={nameDraft}
                onChange={e => setNameDraft(e.target.value)}
                onBlur={() => renameRow('xtalk_sessions', row.g.id, nameDraft)}
                onKeyDown={e => { if (e.key === 'Enter') renameRow('xtalk_sessions', row.g.id, nameDraft); if (e.key === 'Escape') setEditing(null) }}
                className="nav-history-item"
                style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--red)', borderRadius: 6, color: 'var(--white)', fontFamily: 'inherit', fontSize: 12.5, padding: '4px 8px', outline: 'none' }}
              />
            ) : (
            <div key={row.g.id} className="nav-history-item" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Link
                href={`/xtalk/${row.g.id}`}
                style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0, color: 'inherit', textDecoration: 'none' }}
                title={`${row.g.title || t('xt.tpl.discussion.name')} · ${new Date(row.g.updated_at).toLocaleString()}`}
              >
                <span aria-hidden style={{ fontSize: 12, flexShrink: 0 }}>💬</span>
                <span className="nav-history-text">{row.g.title || t('xt.tpl.discussion.name')}</span>
              </Link>
              <button
                aria-label="rename" title={t('hist.rename')}
                onClick={() => { setNameDraft(row.g.title || ''); setEditing({ table: 'xtalk_sessions', id: row.g.id }) }}
                style={{ border: 'none', background: 'none', cursor: 'none', padding: 0, color: 'var(--muted)', fontSize: 11, lineHeight: 1, flexShrink: 0, opacity: 0.5 }}
              >✏</button>
            </div>
            )
          ))}
        </div>
      )}

      {/* XDirect history — the director's conversations. Board id === conv
          id, so each row reopens both the chat AND its canvas/storyboard.
          Delete is SOFT (deleted_at) to match the API's GET filter. */}
      {onXdirect && recentConvs.length > 0 && (
        <div className="nav-history">
          <div className="nav-history-head" style={{ cursor: 'default' }}>
            <span className="nav-history-cap">{t('xd.recent')}</span>
          </div>
          {recentConvs.map(c => (
            editing && editing.table === 'xdirector_conversations' && editing.id === c.id ? (
              <input
                key={`edit-${c.id}`} autoFocus value={nameDraft}
                onChange={e => setNameDraft(e.target.value)}
                onBlur={() => renameRow('xdirector_conversations', c.id, nameDraft)}
                onKeyDown={e => { if (e.key === 'Enter') renameRow('xdirector_conversations', c.id, nameDraft); if (e.key === 'Escape') setEditing(null) }}
                className="nav-history-item"
                style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--red)', borderRadius: 6, color: 'var(--white)', fontFamily: 'inherit', fontSize: 12.5, padding: '4px 8px', outline: 'none' }}
              />
            ) : (
            <div key={c.id} className="nav-history-item" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Link
                href={`/xdirect?c=${c.id}`}
                style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0, color: 'inherit', textDecoration: 'none' }}
                title={`${c.title || t('nav.xdirect')} · ${new Date(c.updated_at).toLocaleString()}`}
              >
                <span aria-hidden style={{ fontSize: 12, flexShrink: 0 }}>🎬</span>
                <span className="nav-history-text">{c.title || '…'}</span>
              </Link>
              <button
                aria-label="rename" title={t('hist.rename')}
                onClick={() => { setNameDraft(c.title || ''); setEditing({ table: 'xdirector_conversations', id: c.id }) }}
                style={{ border: 'none', background: 'none', cursor: 'none', padding: 0, color: 'var(--muted)', fontSize: 11, lineHeight: 1, flexShrink: 0, opacity: 0.5 }}
              >✏</button>
              {confirmDel === c.id ? (
                <span style={{ display: 'inline-flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
                  <button
                    aria-label="confirm delete" title={t('hist.delete.confirm')}
                    onClick={async () => {
                      setConfirmDel(null)
                      await supabase.from('xdirector_conversations')
                        .update({ deleted_at: new Date().toISOString() }).eq('id', c.id)
                      setRecentConvs(prev => prev.filter(x => x.id !== c.id))
                      if (typeof window !== 'undefined' && window.location.search.includes(c.id)) router.push('/xdirect')
                    }}
                    style={{ border: 'none', background: 'none', cursor: 'none', padding: 0, color: 'var(--red)', fontSize: 12, fontWeight: 700, lineHeight: 1, flexShrink: 0 }}
                  >{t('hist.delete')}</button>
                  <button aria-label="cancel" onClick={() => setConfirmDel(null)}
                    style={{ border: 'none', background: 'none', cursor: 'none', padding: 0, color: 'var(--muted)', fontSize: 12, lineHeight: 1, flexShrink: 0 }}>×</button>
                </span>
              ) : (
                <button
                  aria-label="delete conversation"
                  title={t('hist.delete')}
                  onClick={() => { setConfirmDel(c.id); setTimeout(() => setConfirmDel(x => x === c.id ? null : x), 4000) }}
                  style={{ border: 'none', background: 'none', cursor: 'none', padding: 0, color: 'var(--muted)', fontSize: 13, lineHeight: 1, flexShrink: 0, opacity: 0.55 }}
                >×</button>
              )}
            </div>
            )
          ))}
        </div>
      )}

      {/* Auth — bottom of the sidebar, above Terms (CC, July 20): the
          content-area TopBar is gone; profile avatar / Sign In live HERE. */}
      <div className="nav-auth">
        {!authLoaded ? (
          <div style={{ height: 30 }} aria-hidden />
        ) : user ? (
          <Link href="/profile" className="nav-auth-profile" aria-label={t('nav.profile')}>
            {user.user_metadata?.avatar_url ? (
              <img src={user.user_metadata.avatar_url} alt="" referrerPolicy="no-referrer" />
            ) : (
              <span className="nav-auth-initials">
                {(user.user_metadata?.full_name || user.email || '?').split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)}
              </span>
            )}
            <span className="nav-auth-name">{t('nav.profile')}</span>
          </Link>
        ) : (
          <button className="nav-login" onClick={() => show()}>{t('auth.signin')}</button>
        )}
      </div>

      {/* Terms + Contact — pinned to the bottom of the sidebar (CC, July 20). */}
      <div className="nav-foot">
        <Link href="/terms" className={pathname === '/terms' ? 'active' : ''}>{t('nav.terms')}</Link>
        <Link href="/privacy" className={pathname === '/privacy' ? 'active' : ''}>{t('nav.privacy')}</Link>
        <ContactEmail />
        <BugReportLink />
      </div>

      {/* Auth (profile + sign in/out) moved to the content-area TopBar on
          desktop. On mobile it lives in the hamburger overlay below. */}

      {/* Mobile hamburger — only shown under 760px viewport via CSS. */}
      <button
        type="button"
        className="nav-burger"
        aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen(v => !v)}
      >
        <span />
      </button>

      {/* Mobile overlay — slides down from below the nav bar when
          menuOpen is true. Closes on route change via the useEffect
          above. Includes all the nav links, plus the auth action. */}
      <div className={`nav-mobile-overlay ${menuOpen ? 'open' : ''}`}>
        {NAV_LINKS.map(({ href, i18n, protected: isProtected, icon }) => (
          <Link
            key={href}
            href={href}
            className={pathname === href ? 'active' : ''}
            onClick={(e) => handleProtectedClick(e, href, isProtected)}
          >
            <NavIcon name={icon} /><span className="nav-label">{t(i18n)}</span>
          </Link>
        ))}
        <div className="nav-foot" style={{ marginTop: 8 }}>
          <Link href="/terms">{t('nav.terms')}</Link>
          <Link href="/privacy">{t('nav.privacy')}</Link>
          <ContactEmail />
        <BugReportLink />
        </div>
        {/* Sign Out moved to the profile page (CC, July 19) — the
            Profile link above is the path to it. */}
        {authLoaded && (user ? (
          <Link href="/profile">{t('nav.profile')}</Link>
        ) : (
          <button type="button" onClick={() => { setMenuOpen(false); show() }}>{t('auth.signin')}</button>
        ))}
      </div>
    </nav>
  )
}
