'use client'
// app/xgame/SeatSlot.tsx — one game seat, the whole interface (CC, Aug 6).
// Click the seat: assign Me / a random model / a picked model, and configure
// the seated model's thinking level — all in ONE popup, because the popup is
// the reusable unit. Chess gets two of these, mahjong four, unchanged.
// Deliberately no web_search option: mid-game search is not a game skill.

import { useEffect, useRef, useState } from 'react'
import { useT } from '../../lib/i18n'
import { DEFAULT_SEAT_OPTS, type SeatOpts } from '../xtalk/SeatConfig'
import type { Speaker } from '../xtalk/templates'

export type SeatAssign = 'me' | { modelId: string; name: string } | null

export default function SeatSlot({ icon, assign, models, seatOpts, onSeatOpts, onAssign, onOpenPicker }: {
  icon: string
  assign: SeatAssign
  models: Speaker[]
  seatOpts: Record<string, SeatOpts>
  onSeatOpts: (next: Record<string, SeatOpts>) => void
  onAssign: (a: SeatAssign) => void
  onOpenPicker: () => void
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  const model: any = assign && assign !== 'me' ? models.find((m: any) => m.id === assign.modelId) : null
  const levels: string[] = model?.output_config?.text?.thinking_levels ?? []
  const cur = model ? (seatOpts[model.id]?.thinking ?? null) : null
  const label = assign === 'me' ? t('gm.me') : assign ? assign.name : t('gm.pickseat')

  const randomModel = (): SeatAssign => {
    const pool: any[] = models.filter((m: any) => m.id)
    if (pool.length === 0) return null
    const m = pool[Math.floor(Math.random() * pool.length)]
    return { modelId: m.id, name: m.display_name }
  }

  const option = (key: string, label: React.ReactNode, on: () => void) => (
    <button key={key} onClick={on} style={{
      display: 'flex', alignItems: 'center', gap: 9,
      textAlign: 'left', padding: '9px 12px', borderRadius: 8, border: 'none',
      background: 'transparent', fontFamily: 'inherit', fontSize: 13.5,
      color: 'var(--white)', cursor: 'pointer',
    }}
    onMouseEnter={e => (e.currentTarget.style.background = 'var(--red-dim)')}
    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >{label}</button>
  )

  return (
    <div ref={box} style={{ position: 'relative', flex: '1 1 220px', maxWidth: 300 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: '16px 16px', borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit',
          border: '1.5px ' + (assign ? 'solid var(--border2)' : 'dashed var(--border2)'),
          background: 'var(--surface)', color: assign ? 'var(--white)' : 'var(--muted)',
          fontSize: 14, fontWeight: assign ? 700 : 400,
        }}
      >
        <span style={{ fontSize: 22 }} aria-hidden>{icon}</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, textAlign: 'left' }}>{label}</span>
        {model && levels.length > 0 && (
          <span style={{ fontSize: 10, fontFamily: 'var(--font-mono), monospace', color: 'var(--muted2)', flexShrink: 0 }}>
            {cur ?? t('gm.auto')}
          </span>
        )}
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 6, zIndex: 30,
          background: '#fff', border: '1px solid var(--border2)', borderRadius: 11,
          boxShadow: '0 8px 30px rgba(0,0,0,0.14)', padding: 6, minWidth: 230,
          display: 'flex', flexDirection: 'column', gap: 2,
        }}>
          {option('me', <><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6"/></svg>{t('gm.me')}</>, () => { onAssign('me'); setOpen(false) })}
          {/* Random KEEPS the popup open: the config for the model that just
              landed appears right below — closing here is what made the
              config "disappear" (owner, Aug 6). */}
          {option('random', <>🎲 {t('gm.random')}</>, () => onAssign(randomModel()))}
          {option('pick', <>☰ {t('gm.choosemodel')}</>, () => { setOpen(false); onOpenPicker() })}
          {model && levels.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border)', marginTop: 4, padding: '8px 10px 6px' }}>
              <div style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 9, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 6 }}>
                {t('gm.configmodel')} · {t('xcreate.thinking')}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {[null, ...levels].map(lv => {
                  const on = cur === lv
                  return (
                    <button key={lv ?? 'auto'} type="button"
                      onClick={() => onSeatOpts({ ...seatOpts, [model.id]: { ...(seatOpts[model.id] ?? DEFAULT_SEAT_OPTS), thinking: lv } })}
                      style={{
                        padding: '3px 10px', borderRadius: 7, fontSize: 11, fontFamily: 'inherit',
                        border: '1px solid ' + (on ? 'var(--red)' : 'var(--border2)'),
                        background: on ? 'var(--red-dim)' : 'var(--surface)',
                        color: on ? 'var(--red)' : 'var(--muted2)', fontWeight: on ? 700 : 400,
                        cursor: 'pointer',
                      }}
                    >{lv ?? t('gm.auto')}</button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
