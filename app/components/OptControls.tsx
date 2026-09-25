'use client'
// app/components/OptControls.tsx — the per-slot option controls XCreate
// draws under a model card (⚙): a labelled group of pills in the slot's
// colour. Lifted out of app/xcreate/client.tsx (Sep 24) so XTell's per-master
// settings use the same pieces instead of a look-alike. MODULE scope on
// purpose: inline definitions remount the panel on every state update.

import type { ReactNode } from 'react'

export const SLOT_COLORS = ['#4a9eff', '#e8453c', '#a78bfa', '#34d399']

export function OptPill({ color, active, onClick, children, narrow }: {
  color: string; active: boolean; onClick: () => void; children: ReactNode; narrow?: boolean
}) {
  return (
    <button onClick={onClick}
      style={{
        flex: 1, padding: narrow ? '6px 4px' : '7px 6px',
        borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
        background: active ? color + '22' : 'transparent',
        border: `1px solid ${active ? color + '66' : 'var(--border2)'}`,
        color: active ? color : 'var(--muted)',
        transition: 'all 0.15s', textAlign: 'center' as const,
      }}>
      {children}
    </button>
  )
}

export function OptGroup({ label, children, last }: {
  label: string; children: ReactNode; last?: boolean
}) {
  return (
    <div style={{ marginBottom: last ? 0 : 8 }}>
      <div style={{ fontSize: 11, color: 'var(--muted2)', marginBottom: 6, fontWeight: 600 }}>{label}</div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' as const }}>{children}</div>
    </div>
  )
}

/** Thinking levels come from output_config.text.thinking_levels as the
 *  provider's own values. Most read fine as they are (low / high / xhigh);
 *  DashScope's boolean pair does not (Codex QA, Sep 25: raw thinking_true in
 *  the settings), so those two get the On / Off words. */
export function thinkingLabel(level: string, t: (k: string) => string): string {
  if (level === 'thinking_true') return t('xcreate.on')
  if (level === 'thinking_false') return t('xcreate.off')
  return level
}
