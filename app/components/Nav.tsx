'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import type { User } from '@supabase/supabase-js'
import { useAuthModal } from '../../lib/AuthModalContext'
import { useLang } from '../../lib/i18n'
import { XCREATE_TEMPLATES } from '../xcreate/templates'

// The logo doubles as the home link, so the explicit "Home" item is gone.
const NAV_LINKS = [
  { href: '/xduel',       i18n: 'nav.xduel',       protected: true,  icon: 'duel'   },
  { href: '/xcreate',     i18n: 'nav.xcreate',     protected: true,  icon: 'create' },
  // Beta. Hidden until /api/features says this user has it — the route
  // 404s for everyone else anyway, so advertising it would only confuse.
  { href: '/xtalk',       i18n: 'nav.xtalk',       protected: true,  icon: 'talk', feature: 'xtalk' },
  { href: '/xvote',       i18n: 'nav.xvote',       protected: true,  icon: 'vote'   },
  { href: '/xboard',      i18n: 'nav.xboard',      protected: false, icon: 'board'  },
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
    case 'board':  return (<svg {...p}><path d="M4 20h16"/><path d="M5 12h2v7H5z"/><path d="M10.5 8h2v11h-2z"/><path d="M16 4h2v15h-2z"/></svg>)
    // Two bubbles, overlapping — one voice answering another, which is the
    // whole difference between this and every other page.
    case 'talk':   return (<svg {...p}><path d="M8 13H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/><path d="M6 13v3l3-3"/><path d="M19 20h-9a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2z"/><path d="M18 20v3l-3-3"/></svg>)
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
  const [features, setFeatures] = useState<Record<string, boolean>>({})
  useEffect(() => {
    let dead = false
    fetch('/api/features', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : {})
      .then(d => { if (!dead) setFeatures(d ?? {}) })
      .catch(() => {})
    return () => { dead = true }
  }, [user])
  // XCreate history (chat-history pattern): shown under the menu — with a
  // divider so it reads as a separate layer, not more menu items — only
  // while the user is in XCreate. Collapsible, persisted.
  // `running` rows are in-flight xcreate_jobs; the rest are finished xcreates.
  // They share a list because to a user they are all just "my runs".
  const [recent, setRecent] = useState<Array<{ id: string; prompt: string; mode: string; created_at: string; running?: boolean; title?: string | null }>>([])
  // Which history row is being renamed, across BOTH lists. One editor at a
  // time keyed by table + id (CC, Aug 3).
  const [editing, setEditing] = useState<{ table: 'xcreates' | 'xtalk_sessions'; id: string } | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const renameRow = async (table: 'xcreates' | 'xtalk_sessions', id: string, raw: string) => {
    const title = raw.trim().slice(0, 80) || null
    setEditing(null)
    if (table === 'xcreates') setRecent(prev => prev.map(r => r.id === id ? { ...r, title } : r))
    else setRecentGames(prev => prev.map(g => g.id === id ? { ...g, title } : g))
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

  // Fetch the last 10 runs whenever the user lands on /xcreate (also
  // refreshes after a generation → the page URL gains ?id= → pathname
  // stays but a re-nav elsewhere and back re-fetches; good enough v1).
  const onXcreate = pathname?.startsWith('/xcreate') ?? false
  const onXtalk   = pathname?.startsWith('/xtalk') ?? false
  // Werewolf games are server-held sessions with owner-read RLS, so the
  // browser client lists them the same way it lists xcreates. Discussions
  // aren't here: they live in client state and have no row to link to.
  const [recentGames, setRecentGames] = useState<Array<{ id: string; status: string; day: number; winner: string | null; created_at: string; title: string | null }>>([])
  useEffect(() => {
    if (!onXtalk || !user) { setRecentGames([]); return }
    let cancelled = false
    const gsel = (cols: string) => supabase.from('xtalk_sessions')
      .select(cols).eq('user_id', user.id)
      .order('updated_at', { ascending: false }).limit(10)
    gsel('id, status, day, winner, created_at, title').then(async res => {
      const r = res.error ? await gsel('id, status, day, winner, created_at') : res
      if (!cancelled) setRecentGames(((r.data ?? []) as any[]).map(g => ({ ...g, title: g.title ?? null })))
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onXtalk, user?.id, pathname])
  useEffect(() => {
    if (!onXcreate || !user) { setRecent([]); return }
    let cancelled = false
    // Two sources: runs still generating (xcreate_jobs) and finished ones
    // (xcreates). In-flight runs were invisible here before, which is why the
    // page had to hijack itself to show one (CC, July 26). RLS gives an owner
    // read on both tables, so the browser client is enough.
    const load = async () => {
      const [jobsRes, doneRes] = await Promise.all([
        supabase.from('xcreate_jobs')
          .select('id, prompt, mode, created_at')
          .eq('user_id', user.id).eq('status', 'running')
          // Same 10-minute cutoff the jobs/active route uses: past maxDuration
          // (300s) a still-'running' row means a killed function, and nothing
          // closes those any more.
          .gt('created_at', new Date(Date.now() - 10 * 60_000).toISOString())
          .order('created_at', { ascending: false }).limit(10),
        supabase.from('xcreates')
          .select('id, prompt, mode, created_at, title')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false }).limit(10)
          .then(res => res.error
            ? supabase.from('xcreates').select('id, prompt, mode, created_at')
                .eq('user_id', user.id).order('created_at', { ascending: false }).limit(10)
            : res),
      ])
      if (cancelled) return
      const running = (jobsRes.data ?? []).map((j: any) => ({ ...j, running: true }))
      setRecent([...running, ...((doneRes.data ?? []) as any[])].slice(0, 12))
    }
    load()
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
    return () => { cancelled = true; clearInterval(iv) }
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
    <nav className="nav">
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
        <a href="https://www.modelxd.com" style={{
          display: 'inline-block', margin: '-13px 2px 0 auto', alignSelf: 'flex-end',
          fontSize: 10.5, fontWeight: 700, color: 'var(--red)', textDecoration: 'none',
          fontFamily: 'var(--font-mono), monospace', letterSpacing: '.04em',
          borderBottom: '1px dashed var(--red)', paddingBottom: 1, whiteSpace: 'nowrap',
        }}>
          {t('beta.official')} →
        </a>
      )}
      <div className="nav-links">
        {NAV_LINKS.filter(l => !l.feature || features[l.feature]).map(({ href, i18n, protected: isProtected, icon }) => (
          <Link
            key={href}
            href={href}
            className={pathname === href ? 'active' : ''}
            onClick={(e) => handleProtectedClick(e, href, isProtected)}
          >
            <NavIcon name={icon} />{t(i18n)}
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
            <div key={item.running ? `job-${item.id}` : item.id} className="nav-history-item" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Link
                href={item.running ? `/xcreate?job=${item.id}` : `/xcreate?id=${item.id}`}
                style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0, color: 'inherit', textDecoration: 'none' }}
                title={item.running ? `Generating — ${item.prompt}` : (item.title || item.prompt)}
              >
                {item.running
                  ? <span className="nav-history-spin" aria-label="Generating" />
                  : <HistoryModeIcon m={item.mode} />}
                <span className="nav-history-text">{item.title || (item.prompt ? historyTitle(item.prompt) : '(no prompt)')}</span>
              </Link>
              {!item.running && (
                <button
                  aria-label="rename" title={t('ww.rename')}
                  onClick={(e) => { e.preventDefault(); setNameDraft(item.title || ''); setEditing({ table: 'xcreates', id: item.id }) }}
                  style={{ border: 'none', background: 'none', cursor: 'none', padding: 0, color: 'var(--muted)', fontSize: 11, flexShrink: 0, opacity: 0.5 }}
                >✏</button>
              )}
            </div>
            )
          ))}
        </div>
      )}

      {/* XTalk history — same layer as XCreate's, one row per werewolf
          game. The glyph is the outcome: live, wolves won, village won. */}
      {onXtalk && recentGames.length > 0 && (
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
                href={`/xtalk/${g.id}`}
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
                aria-label="rename" title={t('ww.rename')}
                onClick={() => { setNameDraft(g.title || ''); setEditing({ table: 'xtalk_sessions', id: g.id }) }}
                style={{ border: 'none', background: 'none', cursor: 'none', padding: 0, color: 'var(--muted)', fontSize: 11, lineHeight: 1, flexShrink: 0, opacity: 0.5 }}
              >✏</button>
              <button
                aria-label="delete game"
                title={t('ww.delete')}
                onClick={async () => {
                  await supabase.from('xtalk_sessions').delete().eq('id', g.id)
                  setRecentGames(prev => prev.filter(x => x.id !== g.id))
                  if (pathname === `/xtalk/${g.id}`) router.push('/xtalk')
                }}
                style={{ border: 'none', background: 'none', cursor: 'none', padding: 0, color: 'var(--muted)', fontSize: 13, lineHeight: 1, flexShrink: 0, opacity: 0.55 }}
              >×</button>
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
        <a href="mailto:founder@modelxd.com">{t('nav.contact')}</a>
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
        {NAV_LINKS.filter(l => !l.feature || features[l.feature]).map(({ href, i18n, protected: isProtected, icon }) => (
          <Link
            key={href}
            href={href}
            className={pathname === href ? 'active' : ''}
            onClick={(e) => handleProtectedClick(e, href, isProtected)}
          >
            <NavIcon name={icon} />{t(i18n)}
          </Link>
        ))}
        <div className="nav-foot" style={{ marginTop: 8 }}>
          <Link href="/terms">{t('nav.terms')}</Link>
          <Link href="/privacy">{t('nav.privacy')}</Link>
          <a href="mailto:founder@modelxd.com">{t('nav.contact')}</a>
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
