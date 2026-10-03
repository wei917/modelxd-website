'use client'
// app/components/ContextMeter.tsx — how much of its limit a model read for its
// last reply, as current / max (owner, Oct 3: "current vs max", "each model
// can handle differently"). Shared by every surface that keeps a long
// conversation with a model (lib/conversation-memory.ts). The tick marks the
// model's summary point; past it the bar turns red. With `onClick` it is a
// button (e.g. opening the summary), otherwise a plain label.

import { formatTokens } from '../../lib/conversation-memory'

export default function ContextMeter({ used, max, point, label, ariaLabel, onClick, className }: {
  /** Tokens the model read for its last reply. */
  used: number
  /** Its limit. */
  max: number
  /** Where it summarizes. */
  point?: number
  /** A word before the numbers, e.g. 記憶. */
  label?: string
  ariaLabel?: string
  onClick?: () => void
  className?: string
}) {
  const pct = max > 0 ? Math.min(100, used / max * 100) : 0
  const mark = point && max > 0 ? Math.min(100, point / max * 100) : null
  const high = point ? used >= point : pct >= 70
  const inner = <>
    <span className="ctx-meter-bar" aria-hidden="true">
      <span className={high ? 'is-high' : undefined} style={{ width: `${Math.max(pct, 2)}%` }} />
      {mark != null && <i style={{ left: `${mark}%` }} />}
    </span>
    <span className="ctx-meter-txt" aria-hidden="true">{label ? `${label} ` : ''}{formatTokens(used)} / {formatTokens(max)}</span>
  </>
  const cls = `ctx-meter${className ? ` ${className}` : ''}`
  return onClick
    ? <button type="button" className={cls} onClick={onClick} aria-label={ariaLabel}>{inner}</button>
    : <span className={cls} role="img" aria-label={ariaLabel ?? `${formatTokens(used)} / ${formatTokens(max)}`}>{inner}</span>
}
