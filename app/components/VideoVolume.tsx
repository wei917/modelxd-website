'use client'
// Every video on the site starts at half volume (owner, Oct 23: "make the
// default video player 50% volume"); the browser's own default is full.
//
// One listener for the whole document instead of a prop on each of the
// ~two dozen <video> tags: media events do not bubble, but they do reach a
// capture listener. Each element is set once, the first time it loads, so a
// viewer's own change survives the clip changing under it. A player that
// mixes its own levels opts out with `data-own-volume` (XCut's preview sets
// each clip's gain).

import { useEffect } from 'react'

export const DEFAULT_VIDEO_VOLUME = 0.5

export default function VideoVolume() {
  useEffect(() => {
    const done = new WeakSet<HTMLVideoElement>()
    const start = (v: HTMLVideoElement) => {
      if (done.has(v) || v.dataset.ownVolume !== undefined) return
      done.add(v)
      v.volume = DEFAULT_VIDEO_VOLUME
    }
    const onLoad = (e: Event) => { if (e.target instanceof HTMLVideoElement) start(e.target) }
    document.addEventListener('loadstart', onLoad, true)
    // The first paint's videos may have started loading before this ran.
    document.querySelectorAll('video').forEach(start)
    return () => document.removeEventListener('loadstart', onLoad, true)
  }, [])
  return null
}
