'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import LandingAgent from './components/LandingAgent'
import ContactEmail from './components/ContactEmail'
import BugReportLink from './components/BugReport'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { useAuthModal } from '../lib/AuthModalContext'
import { useLang, tOr } from '../lib/i18n'
import type { Snapshot } from './api/snapshot/route'

// The apps grid — the landing's star section since the repositioning
// (owner, Aug 18: "we have built a lot of applications... not a blind test
// website anymore"). Template apps lead with REAL generated result loops
// (the same assets the in-app cards wear); surfaces follow. All gates are
// gone (Aug 18), so every card shows to everyone — signed-out clicks land
// in the auth modal with the destination preserved.
type LandingApp = {
  href: string; name: string; nameKey?: string; descKey: string
  video?: string; img?: string; emoji?: string; color?: string
  public?: boolean
}
const TEMPLATES: LandingApp[] = [
  { href: '/xdirect', name: 'Music Video',  nameKey: 'skill.music-video.title', descKey: 'home.app.mv',
    video: '/xdirect/skills/music-video-loop.mp4', img: '/xdirect/skills/music-video-cover.webp' },
  { href: '/xdirect', name: 'Animation',    nameKey: 'skill.ai-animation.title', descKey: 'home.app.anim',
    video: '/xdirect/skills/ai-animation-loop.mp4', img: '/xdirect/skills/ai-animation-cover.webp' },
  // Shipped Aug 22; its loop sat unused in public/ while the shelf skipped it.
  { href: '/xdirect', name: 'Story to Video', nameKey: 'skill.story-to-video.title', descKey: 'home.app.story',
    video: '/xdirect/skills/story-to-video-loop.mp4', img: '/xdirect/skills/story-to-video-cover.jpg' },
  { href: '/xdirect', name: 'Product Video', nameKey: 'skill.product-video-pipeline.title', descKey: 'home.app.pv',
    video: '/xdirect/skills/product-video-loop.mp4', img: '/xdirect/skills/product-video-cover.jpg' },
  { href: '/xdirect', name: 'Social Post',  nameKey: 'skill.social-post.title', descKey: 'home.app.sp',
    video: '/xdirect/skills/social-post-loop.mp4', img: '/xdirect/skills/social-post-cover.jpg' },
]
// The surfaces wear generated covers of the same ambition as the template
// loops (owner, Aug 23: emoji plates and clip-art read as placeholders).
// Generated with GPT Image 2; originals in the session scratchpad. XVote has
// no cover: it rides on the XBoard card, since its votes are what the board
// ranks by.
const SURFACES: LandingApp[] = [
  { href: '/xtalk',   name: 'XTalk',   descKey: 'home.surf.xtalk',   video: '/landing/apps/xtalk-loop.mp4', img: '/landing/apps/xtalk.jpg' },
  { href: '/xgame',   name: 'XGame',   descKey: 'home.surf.xgame',   video: '/landing/apps/xgame-loop.mp4', img: '/landing/apps/xgame.jpg' },
  { href: '/xduel',   name: 'XDuel',   descKey: 'home.surf.xduel',   video: '/landing/apps/xduel-loop.mp4', img: '/landing/apps/xduel.jpg' },
  { href: '/xcreate', name: 'XCreate', descKey: 'home.surf.xcreate', img: '/landing/apps/xcreate.jpg' },
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


// X先知 and X創作, the two products with their own front door, as app icons
// right under the hero's buttons (owner, Oct 12: "X先知 + X創作"). Icons:
// 月老 from the approved temple sheet (public/xtell/approved/icons.avif),
// and four real results of one prompt from four models
// (public/xcreate-preview.png), which is what the studio does.
const PRODUCTS = [
  { href: '/xtell',   name: 'nav.xtell',   desc: 'home.prod.xtell',   icon: '/home/xtell-icon.webp' },
  { href: '/xcreate', name: 'nav.xcreate', desc: 'home.prod.xcreate', icon: '/home/xcreate-icon.webp' },
]

export default function HomeClient() {
  const cursorRef = useRef<HTMLDivElement>(null)
  const ringRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const { show } = useAuthModal()
  const { t, lang } = useLang()
  // Live XBoard leaders, one per mode. Null until it lands (and if the
  // fetch fails) — the chips render a dash rather than disappearing, so
  // the bar never changes height under the hero.
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
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
  // A card opens its app: public pages directly, the rest through sign-in
  // with the destination kept (handleNav).
  const open = (a: { href: string; public?: boolean }) => a.public ? router.push(a.href) : void handleNav(a.href)
  const cardKeys = (a: { href: string; public?: boolean }) => (e: React.KeyboardEvent) => { if (e.key === 'Enter') open(a) }

  useEffect(() => {
    let mx = 0, my = 0, rx = 0, ry = 0
    let animId: number
    const onMove = (e: MouseEvent) => {
      mx = e.clientX; my = e.clientY
      if (cursorRef.current) { cursorRef.current.style.left = mx + 'px'; cursorRef.current.style.top = my + 'px' }
    }
    const animRing = () => {
      rx += (mx - rx) * 0.35; ry += (my - ry) * 0.35
      if (ringRef.current) { ringRef.current.style.left = rx + 'px'; ringRef.current.style.top = ry + 'px' }
      animId = requestAnimationFrame(animRing)
    }
    document.addEventListener('mousemove', onMove)
    animId = requestAnimationFrame(animRing)
    return () => { document.removeEventListener('mousemove', onMove); cancelAnimationFrame(animId) }
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
              title={`${t(key)} · ${pick.name}${pick.source === 'pick' ? ` · ${t('home.ourpick.why')}` : ''}`}
            >
              <span className="vb-mode">{t(key)}<i className="vb-dot">·</i></span>
              <b className={tone}>{pick.name}</b>
              {pick.source === 'pick' && <em className="vb-tag">{t('home.ourpick')}</em>}
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

      {/* ── Hero (redesigned Oct 12, owner: "redesign", keeping every
          section). The pitch, then X先知 and X創作 as app icons; the agent in
          the second column on desktop, under the icons on a phone. The row of
          three buttons under the pitch (玩玩看 → the Playground, deleted with
          /tgs the same day; 開始創作 →
          /xdirect, 免費盲測模型 → /xduel) was removed the same day (owner:
          "remove this row"); XDirect and XDuel stay in the nav and the app
          cards. ── */}
      <section className="home-hero hm-hero">
        <div className="home-hero-copy">
          <div className="home-hero-eyebrow">{t('home.eyebrow')}</div>
          <h1 className="home-hero-title">
            {lang === 'ja'
              // Each phrase is an unbreakable unit, so a narrow column wraps
              // between 遊ぶ。/ つくる。/ AIを選ぶ。 and never inside a word
              // (text-wrap: balance split つくる at 1280px — Codex, Sep 14).
              ? t('home.hero').split('。').filter(Boolean).map(ph => (
                  <span key={ph} style={{ display: 'inline-block', whiteSpace: 'nowrap' }}>{ph}。</span>
                ))
              : lang.startsWith('zh')
                // Two lines on every width, broken after the comma (owner,
                // Oct 1): 每個任務，/ 都用最好的 AI。, never after 都.
                ? t('home.hero').split(/(?<=，)/).map(ph => (
                    <span key={ph} style={{ display: 'block' }}>{ph}</span>
                  ))
                : t('home.hero')}
          </h1>
          <p className="home-hero-sub">{t('home.sub')}</p>
          <ul className="hm-products">
            {PRODUCTS.map(p => (
              <li key={p.href}>
                <Link href={p.href} className="hm-product">
                  <span className="hm-icon">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.icon} alt="" width={300} height={300} />
                  </span>
                  <span className="hm-product-name">{t(p.name)}</span>
                  <span className="hm-product-desc">{t(p.desc)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="home-hero-agent">
          <LandingAgent />
        </div>
      </section>

      {/* ── The apps (owner, Aug 18): the product is a shelf of working
          applications. One layout for every width since Oct 12: XDirect's
          templates as a row of real result loops (swiped on a phone), the
          surfaces as picture cards, then XBoard with XVote, the proof. ── */}
      <section className="hm-section">
        <div className="hm-inner">
          <div className="hm-eyebrow">{t('home.apps.eyebrow')}</div>
          <h2 className="hm-title">{t('home.apps.title')}</h2>

          <div className="hm-direct">
            <div className="hm-direct-head" role="link" tabIndex={0}
              onClick={() => void handleNav('/xdirect')}
              onKeyDown={e => { if (e.key === 'Enter') void handleNav('/xdirect') }}>
              <span className="hm-card-name">XDirect</span>
              <span className="hm-card-desc">{t('home.surf.xdirect')}</span>
            </div>
            <div className="hm-templates">
              {TEMPLATES.map(a => (
                <div key={a.name} className="hm-card" role="link" tabIndex={0} onClick={() => open(a)} onKeyDown={cardKeys(a)}>
                  <div className="hm-media">
                    {a.video
                      ? <video src={a.video} poster={a.img} autoPlay muted loop playsInline preload="metadata" />
                      // eslint-disable-next-line @next/next/no-img-element
                      : <img src={a.img} alt="" loading="lazy" />}
                  </div>
                  <div className="hm-card-body">
                    <span className="hm-card-name">{a.nameKey ? tOr(t, a.nameKey, a.name) : a.name}</span>
                    <span className="hm-card-desc">{t(a.descKey)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="hm-surfaces">
            {SURFACES.map(a => (
              <div key={a.name} className="hm-card" role="link" tabIndex={0} onClick={() => open(a)} onKeyDown={cardKeys(a)}>
                <div className="hm-media">
                  {a.video
                    ? <video src={a.video} poster={a.img} autoPlay muted loop playsInline preload="metadata" />
                    // eslint-disable-next-line @next/next/no-img-element
                    : <img src={a.img} alt="" loading="lazy" />}
                </div>
                <div className="hm-card-body">
                  <span className="hm-card-name">{a.name}</span>
                  <span className="hm-card-desc">{t(a.descKey)}</span>
                </div>
              </div>
            ))}
          </div>

          {/* ── The proof (owner, Aug 24): XBoard and XEval are not apps,
              they are the evidence behind "the best AI for every task", so
              they close the shelf as two wide cards. XVote sits inside
              XBoard's: judging other people's duels is how the board
              moves. ── */}
          <div className="hm-proofs">
            <div className="hm-proof">
              <div className="hm-proof-main" role="link" tabIndex={0} onClick={() => router.push('/xboard')} onKeyDown={e => { if (e.key === 'Enter') router.push('/xboard') }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/landing/apps/xboard.jpg" alt="" loading="lazy" />
                <div className="hm-card-body">
                  <span className="hm-card-name">XBoard</span>
                  <span className="hm-card-desc">{t('home.surf.xboard')}</span>
                </div>
              </div>
              <div className="hm-proof-vote" role="link" tabIndex={0} onClick={() => void handleNav('/xvote')} onKeyDown={e => { if (e.key === 'Enter') void handleNav('/xvote') }}>
                <span className="hm-card-name">XVote</span>
                <span className="hm-card-desc">{t('home.surf.xvote')}</span>
              </div>
            </div>
            <div className="hm-proof">
              <div className="hm-proof-main" role="link" tabIndex={0} onClick={() => router.push('/xeval')} onKeyDown={e => { if (e.key === 'Enter') router.push('/xeval') }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/landing/apps/xeval.jpg" alt="" loading="lazy" />
                <div className="hm-card-body">
                  <span className="hm-card-name">XEval</span>
                  <span className="hm-card-desc">{t('home.surf.xeval')}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Interactive proof ── */}
      <section className="hm-section">
        <div className="hm-inner">
          <div className="hm-eyebrow">{t('home.compare.eyebrow')}</div>
          <h2 className="hm-title">{t('home.compare.title')}</h2>
          <p className="hm-sub">{t('home.compare.sub')}</p>
          <TierComparator />
        </div>
      </section>

      {/* ── The pitch, consolidated (owner, Aug 6) ──
          Six July-era sections ("Same Result Pay Less", audience split, two
          How-It-Works walkthroughs, XVote and XBoard teasers) became this
          one: the two derived savings figures and the surface grid. The
          agent above answers "how does it work" better than static copy
          ever did, and in five languages. Since Oct 12 three plain columns
          (rows on a phone) instead of one tall boxed panel. */}
      <section className="hm-section">
        <div className="hm-inner">
          <div className="hm-stats">
            <div className="hm-stat">
              <div className="hm-stat-label">{t('home.aud.gap')}</div>
              {/* 120× — re-derived from live model_pricing Aug 7 2026:
                  cheapest enabled text output is Gemini 3.1 Flash-Lite at
                  $1.50/M, priciest is GPT-5.5 Pro at $180/M = exactly 120×.
                  The ratio is the thesis in one number (owner: "more
                  meaningful than actual $") — it's volume-free where the
                  two savings figures each assume a workload. Re-derive
                  before changing (same rule as the other two numbers). */}
              <div className="hm-stat-num" style={{ color: 'var(--red)' }}>120×</div>
              <div className="hm-stat-period">{t('home.aud.gap.period')}</div>
              <p className="hm-stat-desc">{t('home.aud.gap.desc')}</p>
            </div>
            <div className="hm-stat">
              <div className="hm-stat-label">{t('home.aud.dev')}</div>
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
              <div className="hm-stat-num" style={{ color: 'var(--green)' }}>~$7,800</div>
              <div className="hm-stat-period">{t('home.aud.dev.period')}</div>
              <p className="hm-stat-desc">{t('home.aud.dev.desc')}</p>
              <a href="/xdev" className="hm-link">XDev · {t('home.surf.xdev')}</a>
            </div>
            <div className="hm-stat">
              <div className="hm-stat-label">{t('home.aud.user')}</div>
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
              <div className="hm-stat-num" style={{ color: 'var(--green)' }}>~$176</div>
              <div className="hm-stat-period">{t('home.aud.user.period')}</div>
              <p className="hm-stat-desc">{t('home.aud.user.desc')}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ── each item keeps its words on one line; the row wraps
          between items on a phone (they broke mid-word before Oct 12). */}
      <footer className="hm-footer">
        <span className="footer-copy">© 2026 MODELXD</span>
        <a href="/terms" className="footer-copy">{t('nav.terms')}</a>
        <a href="/privacy" className="footer-copy">{t('nav.privacy')}</a>
        <ContactEmail className="footer-copy" />
        <BugReportLink className="footer-copy" />
      </footer>
    </>
  )
}
