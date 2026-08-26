'use client'
// app/components/GlobalCursor.tsx
// Site-wide custom cursor (CC, July 27).
//
// History: globals.css sets `cursor: none` on <body>, and every page was
// expected to render its own `.cursor` / `.cursor-ring` pair. Every time a
// new page shipped without remembering that ritual (/xdirector being the
// latest), users got an invisible mouse. This component ends the ritual:
// it mounts ONCE in the root layout, so every page — present and future —
// has a cursor by default.
//
// Pages that still render their own cursor (xduel recolors it per battle,
// xcreate tints it, etc.) are left alone: when another `.cursor` element
// exists on the route, this one steps aside. Those per-page copies can be
// deleted over time; nothing breaks in either order.

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'

export default function GlobalCursor() {
  const pathname = usePathname()
  const [yield_, setYield] = useState(false)
  const cursorRef = useRef<HTMLDivElement>(null)
  const ringRef   = useRef<HTMLDivElement>(null)

  // Step aside when the current page brings its own cursor.
  //
  // The hard case: pages like /xcreate mount their studio (and its own
  // `.cursor`) inside <Suspense>, i.e. AFTER our first render. A one-shot
  // rAF check ran too early and never saw that late cursor, so the page
  // ended up with two. We instead watch <body> with a MutationObserver and
  // re-evaluate whenever ANY node is added/removed \u2014 the moment the page's
  // cursor appears (or disappears) we yield (or take back over). setYield
  // with an unchanged value is a no-op, so the observer settles rather than
  // thrashing when our own dot mounts/unmounts.
  useEffect(() => {
    const recheck = () => {
      const others = [...document.querySelectorAll('.cursor')]
        .filter(el => el !== cursorRef.current)
      setYield(others.length > 0)
    }
    recheck()
    const raf = requestAnimationFrame(recheck) // settle first paint too
    const obs = new MutationObserver(recheck)
    obs.observe(document.body, { childList: true, subtree: true })
    return () => { cancelAnimationFrame(raf); obs.disconnect() }
  }, [pathname])

  // Same dot + trailing-ring behaviour as the per-page originals.
  useEffect(() => {
    if (yield_) return
    let mx = -100, my = -100, rx = -100, ry = -100, rafId = 0
    const move = (e: MouseEvent) => {
      mx = e.clientX; my = e.clientY
      if (cursorRef.current) { cursorRef.current.style.left = mx + 'px'; cursorRef.current.style.top = my + 'px' }
    }
    const tick = () => {
      // 0.35 matches profile/duel-permalink. 0.12 was the original feel and
      // users reported the ring as laggy (owner, Aug 26) — at 60Hz it
      // trailed ~130ms; 0.35 trails ~40ms and still reads as a trail.
      rx += (mx - rx) * 0.35; ry += (my - ry) * 0.35
      if (ringRef.current) { ringRef.current.style.left = rx + 'px'; ringRef.current.style.top = ry + 'px' }
      rafId = requestAnimationFrame(tick)
    }
    document.addEventListener('mousemove', move)
    rafId = requestAnimationFrame(tick)
    return () => { document.removeEventListener('mousemove', move); cancelAnimationFrame(rafId) }
  }, [yield_])

  if (yield_) return null
  return (
    <>
      <div className="cursor" ref={cursorRef} />
      <div className="cursor-ring" ref={ringRef} />
    </>
  )
}
