'use client'
// app/xgame/DuoParts.tsx — the page half of a table where two people play
// (Oct 21; docs/XGAME-MULTIPLAYER-PLAN.md step 1). Shared by the chess and
// 象棋 tables: the invite panel the host shares, the panel a friend sits down
// from, live refresh, faces and clocks. The server half is lib/xgame-duo.ts.

import { useEffect, useRef, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useT } from '../../lib/i18n'
import { fmtClock, remaining, type Clock } from '../../lib/xgame-clock'

/** The invite token in the address (/xgame/<id>?join=…), read once. */
export function useJoinToken(): string | null {
  const [token] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    return new URLSearchParams(window.location.search).get('join')
  })
  return token
}

/** Refresh when the table changes: the server's Realtime ping on
 *  `xgame:<id>` (it carries no game data), a 5 s fallback, and a return to
 *  the tab. `on` false = nothing (a table with a model drives itself). */
export function useTablePings(id: string | null | undefined, on: boolean, refresh: () => void) {
  const ref = useRef(refresh)
  ref.current = refresh
  useEffect(() => {
    if (!id || !on) return
    const sb = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)
    const channel = sb.channel(`xgame:${id}`)
      .on('broadcast', { event: 'v' }, () => ref.current())
      .subscribe()
    const iv = setInterval(() => { if (!document.hidden) ref.current() }, 5000)
    const back = () => { if (!document.hidden) ref.current() }
    document.addEventListener('visibilitychange', back)
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', back); void sb.removeChannel(channel) }
  }, [id, on])
}

/** The clocks as the page draws them: the server's numbers, run forward on
 *  this device's time (corrected by the server's own `now`). */
export type ViewClock = Clock & { now: number }
export function useDuoClock(clock: ViewClock | null | undefined, toMove: 0 | 1 | null, onFlag: () => void) {
  const [, setTick] = useState(0)
  const offset = useRef(0)
  const flaggedRef = useRef<string | null>(null)
  useEffect(() => { if (clock) offset.current = clock.now - Date.now() }, [clock])
  const running = !!clock?.turnStart && toMove != null
  useEffect(() => {
    if (!running) return
    const iv = setInterval(() => setTick(x => x + 1), 200)
    return () => clearInterval(iv)
  }, [running])
  const now = Date.now() + offset.current
  const left = (seat: 0 | 1) => clock ? remaining(clock, seat, toMove, now) : null
  // Out of time on this screen: ask the server once (it ends the game).
  const key = clock?.turnStart ?? null
  if (clock && toMove != null && key && (left(toMove) ?? 1) <= 0 && flaggedRef.current !== key) {
    flaggedRef.current = key
    setTimeout(onFlag, 0)
  }
  return left
}

export function Face({ name, avatar, size = 22 }: { name: string; avatar?: string | null; size?: number }) {
  const initial = (name || '?').trim().slice(0, 1).toUpperCase()
  return avatar
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={avatar} alt="" width={size} height={size} style={{ width: size, height: size, borderRadius: 999, objectFit: 'cover', flexShrink: 0 }} />
    : <span aria-hidden style={{ width: size, height: size, borderRadius: 999, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface2)', color: 'var(--muted)', fontSize: size * 0.5, fontWeight: 700 }}>{initial}</span>
}

export const ClockText = ({ ms, live }: { ms: number | null; live: boolean }) => ms == null ? null : (
  <span style={{ fontSize: 13, fontFamily: 'var(--font-mono), monospace', fontWeight: 800, color: live ? (ms < 30_000 ? '#fff' : 'var(--red)') : 'var(--muted2)', background: live && ms < 30_000 ? 'var(--red)' : 'transparent', borderRadius: 6, padding: live && ms < 30_000 ? '1px 6px' : 0, flexShrink: 0 }}>
    {fmtClock(ms)}
  </span>
)

/** The host's panel while the table waits: the link, copy and share. */
export function InvitePanel({ id, token, gameName }: { id: string; token: string; gameName: string }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const link = typeof window === 'undefined' ? '' : `${window.location.origin}/xgame/${id}?join=${encodeURIComponent(token)}`
  const text = t('gm.invite.text').replace('{game}', gameName)
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { /* the field below is selectable */ }
  }
  const share = async () => {
    try { await (navigator as any).share({ title: text, text, url: link }) } catch { /* closed */ }
  }
  const canShare = typeof navigator !== 'undefined' && typeof (navigator as any).share === 'function'
  return (
    <div style={{ padding: '14px 16px', borderRadius: 12, border: '1.5px solid var(--red)', background: 'var(--red-dim)' }}>
      <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 4 }}>{t('gm.invite.waiting')}</div>
      <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 10 }}>{t('gm.invite.how')}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input readOnly value={link} onFocus={e => e.currentTarget.select()} aria-label={t('gm.invite.link')}
          style={{ flex: '1 1 220px', minWidth: 0, padding: '9px 11px', borderRadius: 9, border: '1px solid var(--border2)', background: '#fff', fontSize: 12.5, fontFamily: 'var(--font-mono), monospace', color: 'var(--white)' }} />
        <button type="button" onClick={copy} style={{ padding: '9px 16px', borderRadius: 999, border: 'none', background: 'var(--red)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
          {copied ? t('gm.invite.copied') : t('gm.invite.copy')}
        </button>
        {canShare && (
          <button type="button" onClick={share} style={{ padding: '9px 16px', borderRadius: 999, border: '1px solid var(--red)', background: '#fff', color: 'var(--red)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            {t('gm.invite.share')}
          </button>
        )}
      </div>
    </div>
  )
}

/** A friend opened the link: who invited them, and the seat to take. */
export function JoinPanel({ host, gameName, seatLabel, onJoin, busy }: {
  host: { name: string; avatar?: string | null; handle?: string | null }
  gameName: string; seatLabel: string; onJoin: () => void; busy: boolean
}) {
  const t = useT()
  return (
    <div style={{ padding: '14px 16px', borderRadius: 12, border: '1.5px solid var(--red)', background: 'var(--red-dim)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <Face name={host.name} avatar={host.avatar} size={36} />
      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 800 }}>{t('gm.join.title').replace('{name}', host.name).replace('{game}', gameName)}</div>
        {host.handle && <div style={{ fontSize: 12, color: 'var(--muted2)' }}>@{host.handle}</div>}
      </div>
      <button type="button" onClick={onJoin} disabled={busy}
        style={{ padding: '10px 20px', borderRadius: 999, border: 'none', background: 'var(--red)', color: '#fff', fontWeight: 800, fontSize: 14, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1 }}>
        {busy ? '…' : t('gm.join.sit').replace('{side}', seatLabel)}
      </button>
    </div>
  )
}
