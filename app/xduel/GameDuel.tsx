'use client'
// app/xduel/GameDuel.tsx — the GAME task type (owner, Aug 6).
// Blind game duels: the house seats two anonymous models at a real board;
// the engine names the winner, the user judges the play, then the reveal.
// This panel only LAUNCHES — the match itself lives on the game's page,
// where the server-side masking keeps the seats anonymous. Gomoku first;
// each new game becomes another card here.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '../../lib/i18n'

export default function GameDuel() {
  const t = useT()
  const router = useRouter()
  const [busy, setBusy] = useState<null | 'play' | 'watch'>(null)
  const [err, setErr] = useState<string | null>(null)

  const start = async (play: boolean) => {
    if (busy) return
    setBusy(play ? 'play' : 'watch'); setErr(null)
    try {
      const res = await fetch('/api/xgame/gomoku', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', duel: true, play }),
      })
      const d = await res.json().catch(() => null)
      if (!res.ok || !d?.id) { setErr(d?.error ?? `HTTP ${res.status}`); setBusy(null); return }
      router.push(`/xgame/${d.id}`)   // busy stays on while navigating
    } catch {
      setErr('Network error — try again.'); setBusy(null)
    }
  }

  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ maxWidth: 420, border: '1.5px solid var(--border)', borderRadius: 14, overflow: 'hidden', background: 'var(--surface)' }}>
        <img src="/xgame/gomoku-banner.svg" alt="" style={{ width: '100%', display: 'block' }} />
        <div style={{ padding: '16px 18px 18px' }}>
          <div style={{ fontSize: 17, fontWeight: 800, fontFamily: 'var(--font-display), inherit' }}>{t('xg.game.gomoku')}</div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.55, margin: '6px 0 14px' }}>{t('gd.blurb')}</div>
          <button className="btn-battle" onClick={() => start(true)} disabled={!!busy} style={{ width: '100%' }}>
            {busy === 'play' ? '…' : `⚔️ ${t('gd.play')}`}
          </button>
          <button onClick={() => start(false)} disabled={!!busy} style={{
            width: '100%', marginTop: 8, padding: '10px 0', borderRadius: 10, cursor: 'pointer',
            border: '1px solid var(--border2)', background: 'none', color: 'var(--muted)',
            fontWeight: 700, fontSize: 13,
          }}>
            {busy === 'watch' ? '…' : `👁 ${t('gd.watch')}`}
          </button>
          <div style={{ marginTop: 9, fontSize: 11, color: 'var(--muted2)', fontFamily: 'var(--font-mono), monospace', textAlign: 'center' }}>
            {t('gd.free')}
          </div>
        </div>
      </div>
      {err && <div style={{ marginTop: 10, color: 'var(--red)', fontSize: 13 }}>⚠ {err}</div>}
    </div>
  )
}
