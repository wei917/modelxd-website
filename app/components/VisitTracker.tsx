'use client'
// app/components/VisitTracker.tsx
//
// The browser half of the visit log (owner, Sep 27): how long each visit
// lasts and which ad or link brought it. Rows land in site_visits through
// /api/visit (supabase/109_site_visits.sql); docs/SITE-VISITS.md has the
// reports.
//
// A visit is one tab's stay. Its state lives in sessionStorage, so reloads
// and in-app navigation continue it, and 30 minutes without input starts a
// new one. Only time with the tab in front counts, and counting pauses after
// 5 minutes without input, so a tab left open overnight is not a long visit.
// The tab reports at the start (a bounce is still a visit), once a minute
// while in front, and when it is hidden or closed. The server owns the
// visitor cookie, the signed-in user and the geo; nothing here reads auth.
//
// Mounted once in the root layout, on every front door, except where
// consent is required (lib/consent.ts).
//
// Each visit also has page views (supabase/139; owner, Oct 15: "record which
// page so we can tell which temple they enter"): the page the visitor is on,
// as a short key (lib/page-key.ts: an X先知 room is 'xtell/<room>', anything
// else its path with ids masked), timed like the visit. A new page view
// starts on a route change or when an app names a new part of its page.

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { PAGE_EVENT, currentPageKey } from '../../lib/page-key'

const KEY = 'modelxd:visit'
const IDLE_MS = 5 * 60_000        // counting pauses after this long without input
const NEW_VISIT_MS = 30 * 60_000  // and the visit ends after this long
const TICK_MS = 15_000
const REPORT_MS = 60_000
const INPUT_THROTTLE_MS = 5_000
const AD_PARAMS = ['gclid', 'gbraid', 'wbraid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const
const INPUTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'] as const

type Visit = {
  id: string
  landing: string
  referrer: string
  ad: Partial<Record<(typeof AD_PARAMS)[number], string>>
  pages: number
  activeMs: number
  lastInput: number
  path: string
  /** The page view the visit is on now. */
  page?: Page
}

type Page = { id: string; key: string; activeMs: number }

// One page load counts one page view, even when React runs the effect twice
// (Strict Mode in dev): module state survives the remount.
let loadCounted = false

function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

function read(): Visit | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as Visit | null
    return v && typeof v.id === 'string' && typeof v.lastInput === 'number' ? v : null
  } catch { return null }
}

function write(v: Visit) {
  try { sessionStorage.setItem(KEY, JSON.stringify(v)) } catch { /* private mode */ }
}

/** A visit starting now. `arrival` = this page load came from outside (a
 *  link, an ad, a typed URL); only then do the referrer and the ad tags
 *  belong to it. A reload of an ad URL is not a second ad click, and a
 *  visit that restarts after a long idle came from nowhere. */
function startVisit(now: number, path: string, arrival: boolean): Visit {
  const ad: Visit['ad'] = {}
  let referrer = ''
  if (arrival) {
    const q = new URLSearchParams(window.location.search)
    for (const k of AD_PARAMS) { const val = q.get(k); if (val) ad[k] = val.slice(0, 200) }
    try { referrer = document.referrer ? new URL(document.referrer).host : '' } catch { /* opaque */ }
  }
  return { id: uuid(), landing: window.location.pathname, referrer, ad, pages: 1, activeMs: 0, lastInput: now, path, page: newPage() }
}

function newPage(): Page {
  return { id: uuid(), key: currentPageKey(), activeMs: 0 }
}

function send(v: Visit, leaving: boolean) {
  const body = JSON.stringify({
    id: v.id, landing: v.landing, referrer: v.referrer, ad: v.ad,
    pages: v.pages, active: Math.round(v.activeMs / 1000),
    ...(v.page ? { page: { id: v.page.id, key: v.page.key, active: Math.round(v.page.activeMs / 1000) } } : {}),
  })
  try {
    // A beacon survives the page closing; fetch (keepalive) is used otherwise
    // because only a fetch response reliably sets the visitor cookie.
    if (leaving && navigator.sendBeacon?.('/api/visit', body)) return
    void fetch('/api/visit', { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(() => {})
  } catch { /* never let logging touch the page */ }
}

export default function VisitTracker() {
  const pathname = usePathname()
  const visit = useRef<Visit | null>(null)

  useEffect(() => {
    const now = Date.now()
    const navType = (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type
    let v = read()
    if (!v || now - v.lastInput > NEW_VISIT_MS) {
      // A reload or Back after a lapsed visit is not a new ad click. With no
      // visit on record in this tab, though, the page is still the arrival:
      // LANG_BOOT (lib/lang.ts) reloads once on landing for a visitor whose
      // language was saved before the cookie existed.
      const arrival = !v || (navType !== 'reload' && navType !== 'back_forward')
      v = startVisit(now, pathname, arrival)
    } else if (!loadCounted) {
      v.pages += 1
      v.path = pathname
      v.lastInput = now   // a page load is the visitor doing something
      v.page = newPage()  // and a page view of its own
    }
    if (!v.page) v.page = newPage()
    loadCounted = true
    visit.current = v
    write(v)
    send(v, false)

    let shown = document.visibilityState === 'visible'
    let lastTick = now
    let lastReport = now
    let lastSeenInput = 0

    // Add the time since the last tick if the tab was in front, stopping
    // IDLE_MS after the last input.
    const accrue = (t: number) => {
      const cur = visit.current
      if (cur && shown) {
        const until = Math.min(t, cur.lastInput + IDLE_MS)
        if (until > lastTick) {
          cur.activeMs += until - lastTick
          if (cur.page) cur.page.activeMs += until - lastTick
        }
      }
      lastTick = t
    }

    // The visitor moved to another page, or an app named another part of its
    // page: close the page view where it stood and start the next.
    const onPage = () => {
      const cur = visit.current
      if (!cur) return
      const key = currentPageKey()
      if (cur.page?.key === key) return
      const t = Date.now()
      accrue(t)
      if (cur.page) send(cur, false)
      cur.page = newPage()
      write(cur)
      send(cur, false)
      lastReport = t
    }

    // Input, or coming back to the tab. After a long break that is a new
    // visit: the old one is closed where it stood and a new one opens here.
    const activity = (t: number) => {
      const cur = visit.current
      if (!cur) return
      if (t - cur.lastInput > NEW_VISIT_MS) {
        send(cur, false)
        const next = startVisit(t, window.location.pathname, false)
        visit.current = next
        write(next)
        send(next, false)
        lastReport = t
        return
      }
      cur.lastInput = t
      write(cur)
    }

    const onInput = () => {
      const t = Date.now()
      if (t - lastSeenInput < INPUT_THROTTLE_MS) return
      lastSeenInput = t
      accrue(t)
      activity(t)
    }

    const onVisibility = () => {
      const t = Date.now()
      accrue(t)
      shown = document.visibilityState === 'visible'
      if (shown) { activity(t); return }
      const cur = visit.current
      if (!cur) return
      write(cur)
      send(cur, true)
      lastReport = t
    }

    const onPageHide = () => {
      const t = Date.now()
      accrue(t)
      const cur = visit.current
      if (!cur) return
      write(cur)
      send(cur, true)
      lastReport = t
    }

    let sent = { active: -1, pages: -1 }
    const tick = window.setInterval(() => {
      const t = Date.now()
      accrue(t)
      const cur = visit.current
      if (!cur) return
      write(cur)
      const active = Math.round(cur.activeMs / 1000)
      if (shown && t - lastReport >= REPORT_MS && (active !== sent.active || cur.pages !== sent.pages)) {
        send(cur, false)
        sent = { active, pages: cur.pages }
        lastReport = t
      }
    }, TICK_MS)

    for (const e of INPUTS) window.addEventListener(e, onInput, { passive: true, capture: true })
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener(PAGE_EVENT, onPage)
    return () => {
      window.clearInterval(tick)
      for (const e of INPUTS) window.removeEventListener(e, onInput, { capture: true })
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener(PAGE_EVENT, onPage)
    }
    // The visit outlives route changes; the effect below counts those.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // In-app navigation is a page view of the same visit.
  useEffect(() => {
    const cur = visit.current
    if (!cur || cur.path === pathname) return
    cur.pages += 1
    cur.path = pathname
    write(cur)
    window.dispatchEvent(new Event(PAGE_EVENT))
  }, [pathname])

  return null
}
