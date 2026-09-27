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

/** An option whose list is too long to read as a row of pills. The Audio
 *  tab's voices are the case it was built for: 26 on Gemini TTS, 11 on
 *  MiniMax, and a wrapped pill grid that tall buries every setting under
 *  it. Wears the slot colour the way a SELECTED pill does, because one of
 *  these is always chosen — there is no empty state to show.
 *
 *  `group` buckets the options into <optgroup>s (voices by language) in
 *  first-seen order. A single bucket renders flat: one heading over the
 *  whole list names nothing. */
export function OptSelect({ color, value, onChange, options }: {
  color: string
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string; group?: string | null }>
}) {
  type Opt = typeof options[number]
  const groups: Array<[string, Opt[]]> = []
  for (const o of options) {
    const key = o.group ?? ''
    const hit = groups.find(g => g[0] === key)
    if (hit) hit[1].push(o)
    else groups.push([key, [o]])
  }
  // Options inherit the select's colour in some browsers, which makes the
  // open list unreadable against its own white menu — set them back.
  const optStyle = { color: 'var(--white)', background: '#ffffff' }
  const opt = (o: Opt) => <option key={o.value} value={o.value} style={optStyle}>{o.label}</option>
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{
        flex: 1, width: '100%', maxWidth: '100%', boxSizing: 'border-box' as const,
        padding: '7px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600,
        fontFamily: 'inherit', cursor: 'pointer', outline: 'none',
        background: color + '22', border: `1px solid ${color}66`, color,
      }}>
      {groups.length < 2
        ? options.map(opt)
        : groups.map(([g, os]) => <optgroup key={g} label={g || 'other'}>{os.map(opt)}</optgroup>)}
    </select>
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
