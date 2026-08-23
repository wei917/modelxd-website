'use client'
// app/components/Omnibox.tsx
// One bar at the top of every page: search what exists, or hand the same
// text to XDirector.
//
// The load-bearing decision is that it NEVER GUESSES which of those two you
// meant. "veo 3" is a search; "make a fox video" is a request; and any
// heuristic that tries to tell them apart is wrong often enough to be
// infuriating — and wrong in a way that spends the user's credits. So the
// results list is free, local and instant, and the agent sits in a pinned
// row at the bottom that you have to deliberately land on. Guessing would
// have been cheaper to build and worse to use. (CC, Aug 5)
//
// Phase one deliberately contains no AI: search + navigate is useful on its
// own, costs nothing, and gets the shape right before the agent arrives.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useLang, useT } from '../../lib/i18n'
import { createSupabaseBrowser } from '../../lib/supabase-client'
import ProviderLogo from './ProviderLogo'

type Row = {
  key: string
  section: string
  label: string
  sub?: string
  provider?: string
  href: string
}

/**
 * Where the omnibox belongs. An ALLOW-list, not a block-list: the landing
 * page is a marketing surface whose job is the hero, and a search field
 * above it both pushes the pitch down and offers a first-time visitor
 * nothing — they have no generations to find and no reason to ask the agent
 * yet. A block-list would quietly leak onto the next marketing page someone
 * adds; this way a new route has to opt in. (CC, Aug 5)
 */
const SURFACES = ['/xduel', '/xcreate', '/xdirect', '/xcut', '/xtalk', '/xgame', '/xvote', '/xboard', '/xeval', '/xdev', '/profile', '/xdirector']

/** Static destinations. Ordered as the nav is, so the list reads familiar. */
const PAGES: { key: string; i18n: string; href: string }[] = [
  { key: 'xduel',   i18n: 'nav.xduel',   href: '/xduel' },
  { key: 'xcreate', i18n: 'nav.xcreate', href: '/xcreate' },
  { key: 'xdirect', i18n: 'nav.xdirect', href: '/xdirect' },
  { key: 'xcut', i18n: 'nav.xcut', href: '/xcut' },
  { key: 'xtalk',   i18n: 'nav.xtalk',   href: '/xtalk' },
  { key: 'xvote',   i18n: 'nav.xvote',   href: '/xvote' },
  { key: 'xboard',  i18n: 'nav.xboard',  href: '/xboard' },
  { key: 'xeval',   i18n: 'nav.xeval',   href: '/xeval' },
  { key: 'profile', i18n: 'nav.profile', href: '/profile' },
]

/** Which XCreate tab a model should open on. */
function modeOf(m: any): string {
  const out: string[] = m?.output_modalities ?? []
  if (out.includes('video')) return 'video'
  if (out.includes('image')) return 'image'
  return 'text'
}

export default function Omnibox() {
  const t = useT()
  const { lang } = useLang()
  const router = useRouter()
  const pathname = usePathname() ?? ''
  const onSurface = SURFACES.some(s => pathname === s || pathname.startsWith(s + '/'))
  const [open, setOpen]   = useState(false)
  const [q, setQ]         = useState('')
  const [sel, setSel]     = useState(0)
  const [models,  setModels]  = useState<any[]>([])
  const [creates, setCreates] = useState<any[]>([])
  const [talks,   setTalks]   = useState<any[]>([])
  const [loaded,  setLoaded]  = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // Agent answer, shown inside the panel rather than by navigating away —
  // "where is Werewolf" deserves a sentence, not a page load.
  const [asking, setAsking] = useState(false)
  const [answer, setAnswer] = useState<{ answer: string; route: string | null; routeLabel: string | null } | null>(null)
  const [askErr, setAskErr] = useState(false)

  // ⌘K / Ctrl+K anywhere. Esc closes.
  useEffect(() => {
    if (!onSurface) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(v => !v)
      } else if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSurface])

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 20) }, [open])

  // Everything searchable is small (39 models, a page of history), so it is
  // fetched ONCE on first open and filtered in the browser. A debounced
  // query per keystroke would be slower, chattier, and no more correct.
  useEffect(() => {
    if (!open || loaded) return
    setLoaded(true)
    const sb = createSupabaseBrowser()
    sb.from('ai_models')
      .select('id, display_name, model_name, provider, output_modalities, modes')
      .eq('enabled', true)
      .then(({ data }) => setModels(data ?? []))
    // RLS scopes both of these to the signed-in user; a signed-out visitor
    // simply gets nothing back rather than an error.
    sb.from('xcreates').select('id, title, prompt, mode, created_at')
      .order('created_at', { ascending: false }).limit(60)
      .then(({ data }) => setCreates(data ?? []))
    sb.from('xtalk_sessions').select('id, title, created_at')
      .order('created_at', { ascending: false }).limit(60)
      .then(({ data }) => setTalks(data ?? []))
  }, [open, loaded])

  const rows = useMemo<Row[]>(() => {
    const needle = q.trim().toLowerCase()
    const hit = (s?: string | null) => !!s && s.toLowerCase().includes(needle)
    const out: Row[] = []

    for (const p of PAGES) {
      const label = t(p.i18n)
      if (!needle || hit(label) || hit(p.key)) {
        out.push({ key: 'p:' + p.key, section: t('omni.sec.pages'), label, href: p.href })
      }
    }
    for (const m of models) {
      if (!needle || hit(m.display_name) || hit(m.model_name) || hit(m.provider)) {
        out.push({
          key: 'm:' + m.id, section: t('omni.sec.models'),
          label: m.display_name, sub: m.model_name, provider: m.provider,
          href: `/xcreate?model=${m.id}&mode=${modeOf(m)}`,
        })
      }
    }
    for (const c of creates) {
      const label = (c.title || c.prompt || '').toString()
      if (!label) continue
      if (!needle || hit(label)) {
        out.push({
          key: 'c:' + c.id, section: t('omni.sec.creations'),
          label: label.slice(0, 90), sub: c.mode ?? undefined,
          href: `/xcreate?id=${c.id}`,
        })
      }
    }
    for (const s of talks) {
      const label = (s.title || '').toString()
      if (!label) continue
      if (!needle || hit(label)) {
        out.push({ key: 's:' + s.id, section: t('omni.sec.talks'), label: label.slice(0, 90), href: `/xtalk/${s.id}` })
      }
    }
    // Long lists are noise in a picker; the query is how you narrow.
    return out.slice(0, 24)
  }, [q, models, creates, talks, t])

  // The ask row is always last and always present, so "type, arrow down,
  // Enter" reaches the agent from any query — including one with no matches.
  const askIndex = rows.length
  const total    = rows.length + (q.trim() ? 1 : 0)

  useEffect(() => { setSel(0); setAnswer(null); setAskErr(false) }, [q])

  /** Ask the site agent. Answers in place; never generates, never bills. */
  const ask = useCallback(async () => {
    const question = q.trim()
    if (!question || asking) return
    setAsking(true); setAskErr(false); setAnswer(null)
    try {
      const res = await fetch('/api/agent/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: question, lang }),
      })
      if (!res.ok) throw new Error(String(res.status))
      setAnswer(await res.json())
    } catch {
      setAskErr(true)
    } finally {
      setAsking(false)
    }
  }, [q, asking, lang])

  const go = useCallback((i: number) => {
    if (q.trim() && i === askIndex) { void ask(); return }
    const r = rows[i]
    if (!r) return
    router.push(r.href)
    setOpen(false)
    setQ('')
  }, [q, rows, askIndex, router, ask])

  const goTo = useCallback((href: string) => {
    router.push(href)
    setOpen(false); setQ(''); setAnswer(null)
  }, [router])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => (s + 1) % Math.max(total, 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => (s - 1 + Math.max(total, 1)) % Math.max(total, 1)) }
    else if (e.key === 'Enter')   { e.preventDefault(); go(sel) }
  }

  let lastSection = ''

  if (!onSurface) return null

  return (
    <>
      <div className="omni-bar">
        <button className="omni-trigger" onClick={() => setOpen(true)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
          </svg>
          <span className="omni-trigger-text">{t('omni.placeholder')}</span>
          <kbd className="omni-kbd">⌘K</kbd>
        </button>
      </div>

      {open && (
        <div
          className="omni-overlay"
          onClick={e => { if (e.target === e.currentTarget) setOpen(false) }}
        >
          <div className="omni-panel">
            <div className="omni-input-row">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ color: 'var(--muted2)', flexShrink: 0 }}>
                <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
              </svg>
              <input
                ref={inputRef}
                value={q}
                onChange={e => setQ(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={t('omni.placeholder')}
                className="omni-input"
              />
              <button className="omni-esc" onClick={() => setOpen(false)}>esc</button>
            </div>

            <div className="omni-list">
              {rows.map((r, i) => {
                const head = r.section !== lastSection ? r.section : null
                lastSection = r.section
                return (
                  <div key={r.key}>
                    {head && <div className="omni-section">{head}</div>}
                    <button
                      className={`omni-row${i === sel ? ' on' : ''}`}
                      onMouseEnter={() => setSel(i)}
                      onClick={() => go(i)}
                    >
                      {r.provider
                        ? <ProviderLogo provider={r.provider} size={14} />
                        : <span className="omni-dot" />}
                      <span className="omni-label">{r.label}</span>
                      {r.sub && <span className="omni-sub">{r.sub}</span>}
                    </button>
                  </div>
                )
              })}

              {q.trim() && (
                <>
                  <div className="omni-section">{t('omni.sec.ask')}</div>
                  <button
                    className={`omni-row omni-ask${sel === askIndex ? ' on' : ''}`}
                    onMouseEnter={() => setSel(askIndex)}
                    onClick={() => go(askIndex)}
                    disabled={asking}
                  >
                    <span className="omni-spark">{asking ? '◐' : '✦'}</span>
                    <span className="omni-label">
                      {asking ? t('omni.asking') : t('omni.ask')}
                      {!asking && <> <span className="omni-q">“{q.trim()}”</span></>}
                    </span>
                  </button>

                  {answer && (
                    <div className="omni-answer">
                      <div className="omni-answer-text">{answer.answer}</div>
                      {answer.route && (
                        <button className="omni-answer-go" onClick={() => goTo(answer.route!)}>
                          {t('omni.goto').replace('{n}', answer.routeLabel ?? '')} →
                        </button>
                      )}
                    </div>
                  )}
                  {askErr && (
                    <div className="omni-answer">
                      <div className="omni-answer-text">{t('omni.askfail')}</div>
                    </div>
                  )}
                </>
              )}

              {!q.trim() && rows.length === 0 && (
                <div className="omni-empty">{t('omni.placeholder')}</div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
