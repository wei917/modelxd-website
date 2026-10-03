'use client'
// app/components/ContextMeter.tsx — how full a model's memory is: a ring that
// fills with what the model read for its last reply, against its limit
// (owner, Oct 3: "an icon to fill the circle"; the numbers live in the detail
// view, not here). Shared by every surface that keeps a long conversation
// (lib/conversation-memory.ts). Red past the model's summary point. Children
// sit in the middle: a provider logo, a percentage. With `onClick` it is a
// button (e.g. opening the detail), otherwise a plain image.

export default function ContextMeter({ used, max, point, size = 30, stroke = 2.5, ariaLabel, onClick, className, children }: {
  /** Tokens the model read for its last reply. */
  used: number
  /** Its limit. */
  max: number
  /** Where it summarizes: the ring turns red past it. */
  point?: number
  /** Outer size in px. */
  size?: number
  /** Ring thickness in px. */
  stroke?: number
  ariaLabel?: string
  onClick?: () => void
  className?: string
  children?: React.ReactNode
}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, mid = size / 2
  const frac = max > 0 ? Math.min(1, Math.max(0, used / max)) : 0
  const high = point ? used >= point : frac >= 0.7
  const inner = <>
    <svg className="ctx-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle className="ctx-ring-track" cx={mid} cy={mid} r={r} fill="none" strokeWidth={stroke} />
      {frac > 0 && <circle className={`ctx-ring-fill${high ? ' is-high' : ''}`} cx={mid} cy={mid} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={`${Math.max(frac * c, stroke)} ${c}`} transform={`rotate(-90 ${mid} ${mid})`} />}
    </svg>
    {children != null && <span className="ctx-ring-mid">{children}</span>}
  </>
  const cls = `ctx-meter${className ? ` ${className}` : ''}`
  return onClick
    ? <button type="button" className={cls} style={{ width: size, height: size }} onClick={onClick} aria-label={ariaLabel} title={ariaLabel}>{inner}</button>
    : <span className={cls} style={{ width: size, height: size }} role="img" aria-label={ariaLabel}>{inner}</span>
}
