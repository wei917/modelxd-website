'use client'

import { useEffect, useRef, useState } from 'react'
import LandingAgent from './components/LandingAgent'
import ContactEmail from './components/ContactEmail'
import BugReportLink from './components/BugReport'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { useAuthModal } from '../lib/AuthModalContext'
import { useLang } from '../lib/i18n'
import type { Snapshot } from './api/snapshot/route'

// The apps grid — the landing's star section since the repositioning
// (owner, Aug 18: "we have built a lot of applications... not a blind test
// website anymore"). Template apps lead with REAL generated result loops
// (the same assets the in-app cards wear); surfaces follow. All gates are
// gone (Aug 18), so every card shows to everyone — signed-out clicks land
// in the auth modal with the destination preserved.
type LandingApp = {
  href: string; name: string; descKey: string
  video?: string; img?: string; emoji?: string; color?: string
  public?: boolean
  /** Renders only when /api/features grants it (XDev). */
  gated?: boolean
}
const APPS: LandingApp[] = [
  { href: '/xdirect', name: 'Music Video',  descKey: 'home.app.mv',
    video: '/xdirect/skills/music-video-loop.mp4', img: '/xdirect/skills/music-video-cover.webp' },
  { href: '/xdirect', name: 'Animation',    descKey: 'home.app.anim',
    video: '/xdirect/skills/ai-animation-loop.mp4', img: '/xdirect/skills/ai-animation-cover.webp' },
  { href: '/xdirect', name: 'Product Video', descKey: 'home.app.pv',
    img: '/xdirect/skills/product-video-pipeline.webp' },
  { href: '/xdirect', name: 'Social Post',  descKey: 'home.app.sp',
    img: '/xdirect/skills/social-post.webp' },
  { href: '/xtalk',   name: 'XTalk',   descKey: 'home.surf.xtalk',   emoji: '💬', color: '#0ea5e9' },
  { href: '/xgame',   name: 'XGame',   descKey: 'home.surf.xgame',   emoji: '🎲', color: '#f59e0b' },
  { href: '/xduel',   name: 'XDuel',   descKey: 'home.surf.xduel',   emoji: '⚔️', color: '#ef4444' },
  { href: '/xcreate', name: 'XCreate', descKey: 'home.surf.xcreate', emoji: '🪄', color: '#8b5cf6' },
  { href: '/xboard',  name: 'XBoard',  descKey: 'home.surf.xboard',  emoji: '📊', color: '#10b981', public: true },
  // Agents channel. XDev is the one surface still email-gated, so its card
  // renders only for entitled accounts — a public visitor must never click
  // into a notFound() (same rule the old surface grid lived by).
  { href: '/xdev',    name: 'XDev',    descKey: 'home.surf.xdev',    emoji: '🤖', color: '#475569', gated: true },
]

// Four price/quality tiers, cheapest first. Images are placeholders until
// CC supplies the real renders (CC, July 25) — drop files at the same paths
// and nothing else needs to change. Numbers are deliberately absent: the
// point of the hero is the visible difference, not a spec sheet.
// Served from the public `landing` storage bucket, not public/ — same
// reasoning as the bundled samples: a repo asset has to be committed AND
// deployed to exist, and when it isn't the password gate answers 200 with
// its own HTML instead of a 404. Swap a tier by upserting over the object;
// no commit, no deploy (CC, July 25).
const TIERS_BASE = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/landing/tiers`

const TIERS = [
  { id: 'a', key: 'home.vc.tier.a', src: `${TIERS_BASE}/level-a.jpg` },
  { id: 'b', key: 'home.vc.tier.b', src: `${TIERS_BASE}/level-b.jpg` },
  { id: 'c', key: 'home.vc.tier.c', src: `${TIERS_BASE}/level-c.jpg` },
  { id: 'd', key: 'home.vc.tier.d', src: `${TIERS_BASE}/level-d.jpg` },
] as const

/**
 * Two draggable points on one price-to-quality axis, each driving one side
 * of a side-by-side. Red owns the left panel, blue the right; the dashed
 * leader under each thumb keeps that legible once they're close together.
 *
 * The points never share a tier and never swap order (CC, July 25). Moving
 * one onto the other pushes it along in the direction of travel; when the
 * pushed point runs out of track, the move is refused rather than allowing
 * an overlap. That keeps "left is the cheaper one" true at all times, which
 * is what makes the two panels readable without labels repeating the price.
 */
/* Inline so they inherit currentColor and ship with zero extra requests.
   The icon states the axis before the words do: a price tag on the cheap
   side, a cut gem on the expensive one. */
function TagIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M11.6 2.6a2 2 0 0 0-1.42.58L2.6 10.76a2 2 0 0 0 0 2.83l7.81 7.81a2 2 0 0 0 2.83 0l7.58-7.58a2 2 0 0 0 .58-1.42V4.6a2 2 0 0 0-2-2h-7.8Zm5.15 3.05a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2Z" />
    </svg>
  )
}

function GemIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M7.2 3h9.6a1 1 0 0 1 .8.4l3.2 4.27a1 1 0 0 1-.06 1.28l-8 8.74a1 1 0 0 1-1.48 0l-8-8.74a1 1 0 0 1-.06-1.28L6.4 3.4a1 1 0 0 1 .8-.4Zm.55 2-2.1 2.8h3.5L10.6 5H7.75Zm5.1 0 1.45 2.8h3.5L15.7 5h-2.85Zm-.85.36L10.6 7.8h2.8l-1.4-2.44ZM4.9 9.8l4.62 5.05L7.6 9.8H4.9Zm4.9 0 2.2 5.6 2.2-5.6H9.8Zm6.6 0-1.92 5.05L19.1 9.8h-2.7Z" />
    </svg>
  )
}

function TierComparator() {
  const { t } = useLang()
  // Opens on the extremes — cheapest vs best — so the range the comparator
  // exists to show is on screen before anyone touches it (CC, July 25).
  const [picks, setPicks] = useState<[number, number]>([0, TIERS.length - 1])
  const [dragging, setDragging] = useState<0 | 1 | null>(null)
  const trackRef = useRef<HTMLDivElement>(null)

  const setPick = (side: 0 | 1, idx: number) => {
    const max = TIERS.length - 1
    const t = Math.max(0, Math.min(max, idx))
    setPicks(prev => {
      const [lo, hi] = prev
      let next: [number, number]
      if (side === 0) {
        // Left point. Free below the right one; past it, the right one is
        // pushed up a tier. If that would leave the track, the left point
        // stops one short instead of forcing an overlap.
        if (t < hi)            next = [t, hi]
        else if (t + 1 <= max) next = [t, t + 1]
        else                   next = [max - 1, max]
      } else {
        if (t > lo)            next = [lo, t]
        else if (t - 1 >= 0)   next = [t - 1, t]
        else                   next = [0, 1]
      }
      return next[0] === lo && next[1] === hi ? prev : next
    })
  }

  // The axis is four equal zones, one per tier — click anywhere inside a
  // zone and you get that tier. Rounding to the nearest stop instead would
  // make the two end zones half the width of the middle ones, which is a
  // meaningfully worse target for exactly the two tiers (cheapest, best)
  // people reach for most. Returns null when the track isn't measurable yet.
  const zoneFromClientX = (clientX: number): number | null => {
    const el = trackRef.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    if (r.width === 0) return null
    const ratio = (clientX - r.left) / r.width
    return Math.max(0, Math.min(TIERS.length - 1, Math.floor(ratio * TIERS.length)))
  }

  const pickFromClientX = (side: 0 | 1, clientX: number) => {
    const idx = zoneFromClientX(clientX)
    if (idx !== null) setPick(side, idx)
  }

  // NOTE: do not preventDefault() these pointer events. The site hides the
  // native cursor (`cursor: none`, globals.css) and draws its own from a
  // `mousemove` listener — and per the Pointer Events spec, calling
  // preventDefault() on a pointermove suppresses the compatibility mouse
  // events. Doing so froze the custom cursor for the whole drag, so the
  // pointer simply vanished (CC, July 25). Text selection is held off with
  // user-select in CSS, and touch scrolling by touch-action, so nothing here
  // needs preventDefault anyway.
  useEffect(() => {
    if (dragging === null) return
    const move = (e: PointerEvent) => pickFromClientX(dragging, e.clientX)
    const up = () => setDragging(null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging])

  // Click anywhere on the axis: the nearer point comes to you, then keeps
  // following the pointer so a click and a drag are the same gesture.
  const onTrackDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const idx = zoneFromClientX(e.clientX)
    if (idx === null) return
    const d0 = Math.abs(picks[0] - idx)
    const d1 = Math.abs(picks[1] - idx)
    // Equidistant (including both points already on that tier): let the half
    // of the axis you clicked decide, so the choice matches the intent.
    const side: 0 | 1 = d0 === d1 ? (idx < TIERS.length / 2 ? 0 : 1) : (d0 < d1 ? 0 : 1)
    setPick(side, idx)
    setDragging(side)
  }

  const pct = (i: number) => `${(i / (TIERS.length - 1)) * 100}%`
  const sides = [
    { side: 0 as const, cls: 't-left',  panel: 'is-left',  label: t('home.vc.left') },
    { side: 1 as const, cls: 't-right', panel: 'is-right', label: t('home.vc.right') },
  ]

  return (
    <div className="vc">
      <div className="vc-stage">
        {sides.map(({ side, panel }) => (
          <div className={`vc-panel ${panel}`} key={side}>
            {TIERS.map((tier, i) => (
              <div
                className={`vc-cell${picks[side] === i ? ' on' : ''}`}
                key={tier.id}
                onClick={() => setPick(side, i)}
              >
                <span className="vc-letter">{t(tier.key)}</span>
                <span className="vc-name">
                  {side === 0 ? <TagIcon /> : <GemIcon />}
                  {t(side === 0 ? 'home.vc.badge.price' : 'home.vc.badge.quality')}
                </span>
                <img src={tier.src} alt={t(tier.key)} draggable={false} />
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Same prompt, different model — the claim the comparison rests on. */}
      <div className="vc-note">{t('home.vc.note')}</div>

      <div className="vc-axis">
        <div className="vc-axis-row">
          <span className="vc-end">{t('home.vc.save')}</span>
          <div className="vc-track" ref={trackRef} onPointerDown={onTrackDown}>
            {sides.map(({ side, cls, label }) => (
              <button
                key={`t${side}`}
                type="button"
                role="slider"
                aria-label={label}
                aria-valuemin={1}
                aria-valuemax={TIERS.length}
                aria-valuenow={picks[side] + 1}
                aria-valuetext={t(TIERS[picks[side]].key)}
                className={`vc-thumb ${cls}${dragging === side ? ' dragging' : ''}`}
                style={{ left: pct(picks[side]) }}
                onPointerDown={e => { e.stopPropagation(); setDragging(side) }}
                onKeyDown={e => {
                  if (e.key === 'ArrowLeft'  || e.key === 'ArrowDown') { e.preventDefault(); setPick(side, picks[side] - 1) }
                  if (e.key === 'ArrowRight' || e.key === 'ArrowUp')   { e.preventDefault(); setPick(side, picks[side] + 1) }
                  if (e.key === 'Home') { e.preventDefault(); setPick(side, 0) }
                  if (e.key === 'End')  { e.preventDefault(); setPick(side, TIERS.length - 1) }
                }}
              />
            ))}
          </div>
          <span className="vc-end">{t('home.vc.push')}</span>
        </div>
      </div>
    </div>
  )
}

export default function Home() {
  const cursorRef = useRef<HTMLDivElement>(null)
  const ringRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const { show } = useAuthModal()
  const { t } = useLang()
  // Live XBoard leaders, one per mode. Null until it lands (and if the
  // fetch fails) — the chips render a dash rather than disappearing, so
  // the bar never changes height under the hero.
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  // The one gate left: XDev. Advisory — the page enforces server-side.
  const [xdevOk, setXdevOk] = useState(false)
  useEffect(() => {
    fetch('/api/features').then(r => r.ok ? r.json() : null).then(f => { if (f?.xdev) setXdevOk(true) }).catch(() => {})
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch('/api/snapshot')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d) setSnapshot(d as Snapshot) })
      .catch(() => { /* decorative — a failure here is not worth surfacing */ })
    return () => { cancelled = true }
  }, [])

  const handleNav = async (path: string) => {
    const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)
    const { data } = await supabase.auth.getUser()
    if (data.user) router.push(path)
    else show(path)
  }

  useEffect(() => {
    let mx = 0, my = 0, rx = 0, ry = 0
    let animId: number
    const onMove = (e: MouseEvent) => {
      mx = e.clientX; my = e.clientY
      if (cursorRef.current) { cursorRef.current.style.left = mx + 'px'; cursorRef.current.style.top = my + 'px' }
    }
    const animRing = () => {
      rx += (mx - rx) * 0.12; ry += (my - ry) * 0.12
      if (ringRef.current) { ringRef.current.style.left = rx + 'px'; ringRef.current.style.top = ry + 'px' }
      animId = requestAnimationFrame(animRing)
    }
    document.addEventListener('mousemove', onMove)
    animId = requestAnimationFrame(animRing)
    return () => { document.removeEventListener('mousemove', onMove); cancelAnimationFrame(animId) }
  }, [])

  useEffect(() => {
    const els = document.querySelectorAll('.reveal')
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target) } })
    }, { threshold: 0.1 })
    els.forEach(el => obs.observe(el))
    return () => obs.disconnect()
  }, [])

  return (
    <>
      <div className="cursor" ref={cursorRef} />
      <div className="cursor-ring" ref={ringRef} />

      {/* ── Value snapshot bar ──
          Placeholder figures for now (CC, July 25: "ignore the number
          badges"). They're isolated in SNAPSHOT so wiring them to the live
          XBoard aggregates later is a one-function change, not a rewrite. */}
      <div className="value-bar">
        <span className="vb-label">{t('home.picks')}</span>
        {([
          ['text',  'mode.text',  'g-text'],
          ['image', 'mode.image', 'g-image'],
          ['video', 'mode.video', 'g-video'],
        ] as const).map(([mode, key, tone]) => {
          const pick = snapshot?.[mode]
          // Inert until the pick lands — a chip showing "—" has nothing to
          // open, and a button that does nothing is worse than a label.
          return pick ? (
            <button
              className="vb-chip is-action"
              key={mode}
              onClick={() => handleNav(`/xcreate?model=${encodeURIComponent(pick.modelName)}&mode=${mode}`)}
              title={`${t(key)} · ${pick.name}`}
            >
              <span className="vb-mode">{t(key)}<i className="vb-dot">·</i></span>
              <b className={tone}>{pick.name}</b>
              <span className="vb-go" aria-hidden>→</span>
            </button>
          ) : (
            <span className="vb-chip" key={mode}>
              <span className="vb-mode">{t(key)}<i className="vb-dot">·</i></span>
              <b className={tone}>—</b>
            </span>
          )
        })}
      </div>

      {/* ── Hero ──
          Lead with the decision ModelXD helps visitors make. The agent sits
          beside the pitch as a useful next step instead of pushing the value
          proposition below a full screen of chat chrome. */}
      <section className="home-hero">
        <div className="home-hero-copy">
          <div className="home-hero-eyebrow">{t('home.eyebrow')}</div>
          <h1 className="home-hero-title">{t('home.hero')}</h1>
          <p className="home-hero-sub">{t('home.sub')}</p>
          <div className="home-hero-actions">
            <button type="button" className="home-hero-cta is-primary" onClick={() => void handleNav('/xdirect')}>
              {t('home.cta.primary')} <span aria-hidden>→</span>
            </button>
            <button type="button" className="home-hero-cta is-secondary" onClick={() => void handleNav('/xduel')}>
              {t('home.cta.secondary')}
            </button>
          </div>
        </div>
        <div className="home-hero-agent">
          <LandingAgent />
        </div>
      </section>

      {/* ── The apps (owner, Aug 18): the product is a shelf of working
          applications — template films with REAL generated result loops on
          their cards, plus the surfaces. Blind testing moved from identity
          to trust layer; here is where the repositioning lives. ── */}
      <div className="home-section reveal">
        <div className="home-inner">
          <div className="home-compare-eyebrow" style={{ marginBottom: 6, textAlign: 'center' }}>{t('home.apps.eyebrow')}</div>
          <h2 style={{ fontFamily: 'var(--font-display), inherit', fontWeight: 800, fontSize: 'clamp(24px, 3vw, 34px)', textAlign: 'center', margin: '0 0 26px' }}>{t('home.apps.title')}</h2>
          {/* Landing-native cards — light surfaces, small accent tints. The
              first cut borrowed the app pages' xt-tpl system and its dark
              #14161a banner slabs, which read broken on the light landing
              (owner, Aug 18). Template cards carry real result media;
              surface cards get a soft brand-tinted plate, never a dark one. */}
          <div className="home-apps-desktop">
            {APPS.filter(a => !a.gated || xdevOk).map(a => (
              <div
                key={a.name}
                role="link" tabIndex={0}
                onClick={() => a.public ? router.push(a.href) : void handleNav(a.href)}
                onKeyDown={e => { if (e.key === 'Enter') { a.public ? router.push(a.href) : void handleNav(a.href) } }}
                style={{
                  background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 12,
                  overflow: 'hidden', cursor: 'pointer', transition: 'border-color .2s, transform .2s',
                }}
                onMouseEnter={e => {
                  const el = e.currentTarget as HTMLElement
                  el.style.borderColor = 'var(--red)'; el.style.transform = 'translateY(-2px)'
                  el.querySelector('video')?.play().catch(() => {})
                }}
                onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'var(--border2)'; el.style.transform = 'none' }}
              >
                <div style={{ aspectRatio: '16 / 9', background: a.color ? `linear-gradient(135deg, ${a.color}1f, var(--surface2))` : 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {a.video
                    ? <video src={a.video} poster={a.img} autoPlay muted loop playsInline preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    : a.img
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={a.img} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                      : <span aria-hidden style={{ fontSize: 40, filter: 'saturate(.9)' }}>{a.emoji}</span>}
                </div>
                <div style={{ padding: '12px 16px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontWeight: 800, fontSize: 15, fontFamily: 'var(--font-display), inherit' }}>{a.name}</span>
                    <span aria-hidden style={{ marginLeft: 'auto', color: 'var(--muted2)' }}>→</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5 }}>{t(a.descKey)}</div>
                </div>
              </div>
            ))}
          </div>

          {/* ── Mobile apps layout (owner's mock, Aug 18 — layout only, all
              copy is the existing i18n): XDirect leads as the FEATURED card
              wearing a film strip of the real template clips; the other
              surfaces follow as compact two-column text cards. Hidden on
              desktop; the media grid above hides on mobile. ── */}
          <div className="home-apps-mobile">
            <div
              className="ham-featured"
              role="link" tabIndex={0}
              onClick={() => void handleNav('/xdirect')}
              onKeyDown={e => { if (e.key === 'Enter') void handleNav('/xdirect') }}
            >
              <div className="ham-name">XDirect</div>
              <div className="ham-desc">{t('home.surf.xdirect')}</div>
              <div className="ham-strip">
                <video src="/xdirect/skills/music-video-loop.mp4" poster="/xdirect/skills/music-video-cover.webp" autoPlay muted loop playsInline preload="metadata" />
                <video src="/xdirect/skills/ai-animation-loop.mp4" poster="/xdirect/skills/ai-animation-cover.webp" autoPlay muted loop playsInline preload="metadata" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/xdirect/skills/product-video-pipeline.webp" alt="" loading="lazy" />
              </div>
            </div>
            <div className="ham-grid">
              {([
                ['/xduel',   'XDuel',   'home.surf.xduel',   false],
                ['/xcreate', 'XCreate', 'home.surf.xcreate', false],
                ['/xtalk',   'XTalk',   'home.surf.xtalk',   false],
                ['/xgame',   'XGame',   'home.surf.xgame',   false],
                ['/xvote',   'XVote',   'home.surf.xvote',   false],
                ['/xboard',  'XBoard',  'home.surf.xboard',  true],
                ...(xdevOk ? [['/xdev', 'XDev', 'home.surf.xdev', false] as [string, string, string, boolean]] : []),
              ] as Array<[string, string, string, boolean]>).map(([href, name, key, pub]) => (
                <div
                  key={href} className="ham-card"
                  role="link" tabIndex={0}
                  onClick={() => pub ? router.push(href) : void handleNav(href)}
                  onKeyDown={e => { if (e.key === 'Enter') { pub ? router.push(href) : void handleNav(href) } }}
                >
                  <div className="ham-name">{name}</div>
                  <div className="ham-desc">{t(key)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Interactive proof ── */}
      <div className="xduel-page home-compare" style={{ minHeight: 'auto' }}>
        {/* paddingBottom was 0 back when the CTA buttons ended the hero and
            the next section's own 60px top padding carried the gap. With the
            subtitle now last, the rule above "How XDuel Works" sat right on
            top of it — this restores the breathing room (CC, July 25). */}
        <div className="arena" style={{ paddingBottom: 72 }}>
          <div className="prompt-header home-compare-header">
            <div className="home-compare-eyebrow">{t('home.compare.eyebrow')}</div>
            <h2 className="prompt-title">{t('home.compare.title')}</h2>
            <div className="prompt-sub home-compare-sub">{t('home.compare.sub')}</div>
          </div>

          <TierComparator />
        </div>
      </div>

      {/* ── The pitch, consolidated (owner, Aug 6) ──
          Six July-era sections ("Same Result Pay Less", audience split, two
          How-It-Works walkthroughs, XVote and XBoard teasers) became this
          one: the two derived savings figures and the surface grid. The
          agent above answers "how does it work" better than static copy
          ever did, and in five languages. */}
      <div className="home-section surface reveal">
        <div className="home-inner">
          <div className="home-audience">
            <div className="home-audience-card">
              <div className="home-audience-label">{t('home.aud.gap')}</div>
              {/* 120× — re-derived from live model_pricing Aug 7 2026:
                  cheapest enabled text output is Gemini 3.1 Flash-Lite at
                  $1.50/M, priciest is GPT-5.5 Pro at $180/M = exactly 120×.
                  The ratio is the thesis in one number (owner: "more
                  meaningful than actual $") — it's volume-free where the
                  two savings figures each assume a workload. Re-derive
                  before changing (same rule as the other two numbers). */}
              <div className="home-audience-stat" style={{ color: 'var(--red)' }}>120×</div>
              <div className="home-audience-period">{t('home.aud.gap.period')}</div>
              <div className="home-audience-desc">{t('home.aud.gap.desc')}</div>
            </div>
            <div className="home-audience-card">
              <div className="home-audience-label">{t('home.aud.dev')}</div>
              {/* $7,800/mo, and the un-rounded figure is the point — a round
                  $8,000 reads invented, this one reads computed, because it is.
                  1B tokens/mo (a scaling production app, ~33M/day) on a
                  mainstream flagship (GPT-5.5, $5/$30 = $17.50 per M blended
                  50/50 = $17,500/mo) with 60% of that traffic moved to
                  Gemini 3.6 Flash ($1.50/$7.50 = $4.50/M):
                  600M × $13.00 = $7,800. Deliberately targets the capable mid
                  model, not Flash-Lite at $0.875/M — "the cheapest model wins
                  60% of the time" is not a claim we can back. Volume history:
                  100M ($780, July) → 500M ($3,900, Aug 5) → 1B (owner call,
                  Aug 18); the per-token logic and both model prices are
                  unchanged and were last re-checked against live
                  model_pricing Aug 19 (catalog carries LIST prices only —
                  owner rule; Gemini 3.7 Flash has the same list price, so
                  its launch changes nothing here). Re-derive before
                  changing any number. */}
              <div className="home-audience-stat" style={{ color: 'var(--green)' }}>~$7,800</div>
              <div className="home-audience-period">{t('home.aud.dev.period')}</div>
              <div className="home-audience-desc">{t('home.aud.dev.desc')}</div>
            </div>
            <div className="home-audience-card">
              <div className="home-audience-label">{t('home.aud.user')}</div>
              {/* $176/mo, derived the same way as the developer figure so the
                  two can be defended with one method. The old "~$17 avg.
                  monthly savings" was text-only and unattributed — it read as
                  a guess, and it understated the case badly, because video is
                  where a heavy user's money actually goes.
                  100 eight-second 1080p clips a month (3–4 a day, a working
                  creator): Veo 3.1 Preview at $0.40/sec = $3.20 a clip = $320.
                  HappyHorse 1.1 at $0.18/sec = $1.44 a clip = $144.
                  Saving $176/mo — and HappyHorse is the model our own board
                  ranks top for text-to-video, so this is the recommendation we
                  already make, priced out. Live model_pricing, Aug 5 2026. */}
              <div className="home-audience-stat" style={{ color: 'var(--green)' }}>~$176</div>
              <div className="home-audience-period">{t('home.aud.user.period')}</div>
              <div className="home-audience-desc">{t('home.aud.user.desc')}</div>
            </div>
          </div>

        </div>
      </div>

      {/* ── Footer ── */}
      <footer className="home-footer">
        <div className="home-inner" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
          <div className="footer-copy">© 2026 MODELXD</div>
          <a href="/terms" className="footer-copy" style={{ textDecoration: 'none' }}>{t('nav.terms')}</a>
          <a href="/privacy" className="footer-copy" style={{ textDecoration: 'none' }}>{t('nav.privacy')}</a>
          <ContactEmail className="footer-copy" style={{ textDecoration: 'none' }} />
          <BugReportLink className="footer-copy" style={{ textDecoration: 'none' }} />
        </div>
      </footer>
    </>
  )
}
