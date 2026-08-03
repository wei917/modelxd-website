'use client'
// app/xtalk/SeatConfig.tsx
//
// The per-seat settings XTalk was missing.
//
// XCreate and XDuel both let you set a model's thinking level; XTalk did not
// pass one at all, so every seat ran on the provider's default with nothing
// in the UI to say so. That is not a cosmetic gap — Qwen measured 36x the
// cost between thinking on and off on the same question, and a werewolf game
// is seven models speaking every round for two or three days. The bill was
// being decided by a value nobody had chosen or could see.
//
// Deliberately the same shape as XCreate's ⚙ panel (a gear on the model chip
// opening labelled rows of pills) so the three surfaces teach the same
// gesture once. Shared by both templates rather than reimplemented per room.

import { useEffect, useRef, useState } from 'react'
import { useT } from '../../lib/i18n'
import type { Speaker } from './templates'

export type SeatOpts = {
  /** null = provider default ("Auto"). */
  thinking: string | null
  /** Only ever true for models that declare the capability. */
  search: boolean
}

export const DEFAULT_SEAT_OPTS: SeatOpts = { thinking: null, search: false }

export const thinkingLevels = (m: Speaker): string[] =>
  m.output_config?.text?.thinking_levels ?? []

export const canSearch = (m: Speaker): boolean =>
  (m.output_config?.text?.capabilities ?? []).includes('web_search')

/** Whether this model has anything worth opening a panel for. */
export const hasSeatOpts = (m: Speaker, allowSearch: boolean): boolean =>
  thinkingLevels(m).length > 0 || (allowSearch && canSearch(m))

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick() }}
      style={{
        padding: '3px 9px', borderRadius: 7, cursor: 'none', fontSize: 11,
        fontFamily: 'inherit', lineHeight: 1.6,
        border: `1px solid ${active ? 'var(--red)' : 'var(--border2)'}`,
        background: active ? 'var(--red-dim)' : 'var(--surface)',
        color: active ? 'var(--red)' : 'var(--muted2)',
        fontWeight: active ? 700 : 400,
      }}
    >{children}</button>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{
        fontFamily: 'var(--font-mono), monospace', fontSize: 9, letterSpacing: '.12em',
        textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 5,
      }}>{label}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>{children}</div>
    </div>
  )
}

export function SeatConfig({
  model, opts, onChange, allowSearch = true,
}: {
  model: Speaker
  opts: SeatOpts
  onChange: (next: SeatOpts) => void
  /** False when search is decided for the whole table rather than per seat. */
  allowSearch?: boolean
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  // Click-away. Without it the panel stays open behind the next one you
  // open, and two seats' settings end up on screen at once looking like one.
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  const levels = thinkingLevels(model)
  const search = allowSearch && canSearch(model)
  if (levels.length === 0 && !search) return null

  return (
    <div ref={box} style={{ position: 'relative', marginLeft: 'auto' }}>
      <button
        type="button"
        aria-label="settings"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
        // Matches XCreate's gear exactly (24px, same padding, same muted →
        // accent colour shift). It was 12px and half-opacity here, which made
        // the same control look like a different, lesser one.
        style={{
          background: 'none', border: 'none', color: open ? 'var(--red)' : 'var(--muted)',
          cursor: 'none', fontSize: 24, lineHeight: 1,
          padding: '4px 2px', flexShrink: 0,
        }}
      >⚙</button>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: 20, right: 0, zIndex: 40, width: 232,
            padding: '11px 12px 5px', borderRadius: 10,
            border: '1px solid var(--border2)', background: '#fff',
            boxShadow: '0 8px 26px rgba(0,0,0,.10)', cursor: 'default',
          }}
        >
          {levels.length > 0 && (
            <Row label={t('xcreate.thinking')}>
              <Pill active={opts.thinking == null} onClick={() => onChange({ ...opts, thinking: null })}>
                {t('xcreate.auto')}
              </Pill>
              {levels.map(l => (
                <Pill key={l} active={opts.thinking === l} onClick={() => onChange({ ...opts, thinking: l })}>{l}</Pill>
              ))}
            </Row>
          )}
          {search && (
            <Row label={t('xcreate.websearch')}>
              <Pill active={!opts.search} onClick={() => onChange({ ...opts, search: false })}>{t('xcreate.off')}</Pill>
              <Pill active={opts.search}  onClick={() => onChange({ ...opts, search: true })}>{t('xcreate.on')}</Pill>
            </Row>
          )}
        </div>
      )}
    </div>
  )
}
