'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { useAuthModal } from '../lib/AuthModalContext'
import { useLang } from '../lib/i18n'
import type { Snapshot } from './api/snapshot/route'

const STEPS = [
  { num: '01', title: 'One prompt, see AI models responses side by side' },
  { num: '02', title: 'Vote blindly' },
  { num: '03', title: 'Reveal price' },
  { num: '04', title: 'Vote again' },
  { num: '05', title: 'Reveal the models' },
]

const XCREATE_STEPS = [
  { num: '01', title: 'Select up to 4 models' },
  { num: '02', title: 'Enter one prompt' },
  { num: '03', title: 'View the results side by side' },
  { num: '04', title: 'Pick your favorite to continue' },
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
                <span className="vc-letter">{tier.id.toUpperCase()}</span>
                <img src={tier.src} alt={t(tier.key)} draggable={false} />
              </div>
            ))}
          </div>
        ))}
      </div>

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

      {/* ── Hero ── */}
      <div className="xduel-page" style={{ minHeight: 'auto' }}>
        {/* paddingBottom was 0 back when the CTA buttons ended the hero and
            the next section's own 60px top padding carried the gap. With the
            subtitle now last, the rule above "How XDuel Works" sat right on
            top of it — this restores the breathing room (CC, July 25). */}
        <div className="arena" style={{ paddingBottom: 72 }}>
          <div className="prompt-header">
            <h1 className="prompt-title">
              {t('home.hero')} <span>XD</span>
            </h1>
            {/* Reads before the comparator, not after it — it's the value
                proposition, so it has to land before someone tries to
                interpret four tiles and a slider. maxWidth is measured: the
                English line renders 784px, so 860 keeps every language on a
                single line while still wrapping on small screens. */}
            <div className="prompt-sub" style={{ maxWidth: 860, marginTop: 16, fontSize: 18 }}>
              {t('home.sub')}
            </div>
          </div>

          <TierComparator />
        </div>
      </div>

      {/* ── How XDuel Works ── */}
      <div className="home-section surface reveal rule-top">
        <div className="home-inner">
          <div className="prompt-header">
            <h1 className="prompt-title">How <span>XDuel</span> Works</h1>
          </div>
          <div className="home-steps">
            {STEPS.map((s, i) => (
              <div className="home-step" key={s.num}>
                <div className="home-step-row">
                  <div className="home-step-num">{s.num}</div>
                  <div style={{ flex: 1 }}>
                    <div className="home-step-title">{s.title}</div>
                  </div>
                </div>
                {i < STEPS.length - 1 && <div className="home-step-line" />}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── How XCreate Works ── */}
      <div className="home-section reveal">
        <div className="home-inner">
          <div className="prompt-header">
            <h1 className="prompt-title">How <span>XCreate</span> Works</h1>
          </div>
          <div className="home-xcreate-grid">
            <div className="home-steps">
              {XCREATE_STEPS.map((s, i) => (
                <div className="home-step" key={s.num}>
                  <div className="home-step-row">
                    <div className="home-step-num">{s.num}</div>
                    <div style={{ flex: 1 }}>
                      <div className="home-step-title">{s.title}</div>
                    </div>
                  </div>
                  {i < XCREATE_STEPS.length - 1 && <div className="home-step-line" />}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <img
                src="/xcreate-preview.png"
                alt="XCreate — four AI models generating the same prompt side by side"
                style={{
                  maxWidth: '100%',
                  height: 'auto',
                  borderRadius: 12,
                  border: '1px solid var(--border)',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.08)',
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── XVote ── */}
      <div className="home-section surface reveal">
        <div className="home-inner">
          <div className="prompt-header">
            <h1 className="prompt-title">Vote on <span>Duels</span></h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
            <div className="prompt-sub" style={{ maxWidth: 640 }}>
              Skip generation. Browse community duels, compare the results, and vote blind.
            </div>
            <button onClick={() => router.push('/xvote')} className="btn-primary">Browse XVote →</button>
          </div>
        </div>
      </div>

      {/* ── XBoard ── */}
      <div className="home-section reveal">
        <div className="home-inner">
          <div className="prompt-header">
            <h1 className="prompt-title">Model <span>Leaderboard</span></h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
            <div className="prompt-sub" style={{ maxWidth: 640 }}>
              See which AI models deliver the best value — ranked by ModelXD community votes.
            </div>
            <button onClick={() => router.push('/xboard')} className="btn-primary">View XBoard →</button>
          </div>
        </div>
      </div>

      {/* ── Savings ── */}
      <div className="home-section reveal">
        <div className="home-inner">
          <div className="prompt-header">
            <h1 className="prompt-title">Stop <span>Overpaying</span></h1>
          </div>
          <div className="home-savings">
            <div className="home-savings-left">
              <div className="home-savings-amount">Up to 133×</div>
              <div className="home-savings-period">cheaper per million tokens</div>
              <div className="home-savings-detail">
                Most users pick the expensive model out of habit. XDuel reveals when a <strong style={{ color: 'var(--green)' }}>cheaper model wins blind</strong> — so you only pay more when it actually matters.
              </div>
            </div>
            <div className="home-savings-right">
              <div className="home-compare-row loser">
                <span className="home-compare-badge">POPULAR</span>
                <span className="home-compare-name">Premium Model</span>
                <span className="home-compare-price" style={{ color: 'var(--red)' }}>$$$</span>
              </div>
              <div className="home-compare-vs">VS</div>
              <div className="home-compare-row winner">
                <span className="home-compare-badge">UNDERDOG</span>
                <span className="home-compare-name">You&apos;d Be Surprised</span>
                <span className="home-compare-price" style={{ color: 'var(--green)' }}>$</span>
              </div>
              <div className="home-compare-result">
                <span style={{ color: 'var(--green)', fontWeight: 700 }}>Blind-tested by the community</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Audience ──
          Carries `surface` because the Modes section that used to sit between
          this and Savings was removed (CC, July 25); without it two plain
          sections would abut and read as one long block. */}
      <div className="home-section surface reveal">
        <div className="home-inner">
          <div className="prompt-header">
            <h1 className="prompt-title">Users & <span>Developers</span></h1>
          </div>
          <div className="home-audience">
            <div className="home-audience-card">
              <div className="home-audience-label">FOR USERS</div>
              <div className="home-audience-stat" style={{ color: 'var(--green)' }}>~$17</div>
              <div className="home-audience-period">avg. monthly savings</div>
              <div className="home-audience-desc">You don&apos;t need premium models for everything. XDuel shows you which budget models beat them on your own prompts.</div>
            </div>
            <div className="home-audience-card">
              <div className="home-audience-label">FOR DEVELOPERS</div>
              {/* $780/mo, and the un-rounded figure is the point — a round
                  $1,000 reads invented, this one reads computed, because it is.
                  100M tokens/mo on a mainstream flagship (GPT-5.5, $5/$30 =
                  $17.50 per M blended 50/50 = $1,750/mo) with 60% of that
                  traffic moved to Gemini 3.6 Flash ($1.50/$7.50 = $4.50/M):
                  60M × $13.00 = $780. Deliberately targets the capable mid
                  model, not Flash-Lite at $0.875/M — Flash-Lite would give
                  $998 but "the cheapest model wins 60% of the time" is not a
                  claim we can back. Checked against live model_pricing
                  July 25 2026; re-derive before changing either number. The
                  previous "$8,400 at 10M tokens" was unreachable at ANY
                  assumption: 10M caps out at $1,041 even swapping the priciest
                  model for the cheapest on 100% of traffic. */}
              <div className="home-audience-stat" style={{ color: 'var(--green)' }}>~$780</div>
              <div className="home-audience-period">monthly savings at 100M tokens</div>
              <div className="home-audience-desc">Token costs compound fast. ModelXD gives you community-validated data on which models deliver value.</div>
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
          <a href="mailto:founder@modelxd.com" className="footer-copy" style={{ textDecoration: 'none' }}>{t('nav.contact')}</a>
        </div>
      </footer>
    </>
  )
}
