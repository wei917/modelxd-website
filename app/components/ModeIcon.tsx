// Shared inline icon for the output-mode segmented selectors (text /
// image / video). Single source of truth — used by XCreate, XDuel, and
// XVote so all three mode selectors look identical (CC, July 20).
export default function ModeIcon({ m }: { m: 'text' | 'image' | 'video' }) {
  const p = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, style: { flexShrink: 0 } }
  if (m === 'text')  return (<svg {...p}><path d="M4 6h16"/><path d="M4 12h10"/><path d="M4 18h14"/></svg>)
  if (m === 'image') return (<svg {...p}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>)
  return (<svg {...p}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9l5 3l-5 3z"/></svg>)
}
