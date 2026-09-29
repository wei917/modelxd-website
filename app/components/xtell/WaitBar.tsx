'use client'
// app/components/xtell/WaitBar.tsx — a thin bar and "about N seconds" while a
// free page waits for its quick model (Sep 29: a tester found 今日運勢
// silent for 20–30 seconds). The bar runs on the clock against the measured
// time and never reaches the end by itself: it is an estimate, and the text
// arriving is the real progress.

import { useEffect, useState } from 'react'
import { useT } from '../../../lib/i18n'

/** Seconds from pressing to seeing the result, measured from provider_calls
 *  (Sep 25–29) plus the request around the call:
 *  daily — Qwen 3.8 Flash writing ~700 tokens, 15–19 s;
 *  cookie — its taste-and-slips pick, ~3 s (the note streams after);
 *  note — the cookie's note, ~230 tokens, ~5.5 s;
 *  dream — GPT-6 Luna's scan, 1–2 s (p90 2.4 s). */
export const WAIT_SECONDS = { daily: 20, cookie: 5, note: 6, dream: 4 } as const

export function WaitBar({ seconds, label }: { seconds: number; label?: string }) {
  const t = useT()
  const [start] = useState(() => Date.now())
  const [now, setNow] = useState(start)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [])
  // ~90% at the estimate, then creeping: never full until the page moves on.
  const done = 1 - Math.exp(-((now - start) / 1000) * 2.3 / seconds)
  return (
    <div className="xtell-wait" role="status" aria-live="polite">
      {label && <p className="xtell-wait-label">{label}<span>{t('xtell.wait.about').replace('{s}', String(seconds))}</span></p>}
      <div className="xtell-wait-track" aria-hidden="true"><div className="xtell-wait-fill" style={{ width: `${Math.round(done * 1000) / 10}%` }} /></div>
    </div>
  )
}
