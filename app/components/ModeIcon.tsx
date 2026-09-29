// Shared inline icon for the output-mode segmented selectors (text /
// image / video, plus XDuel's game die). Single source of truth — used by
// XCreate, XDuel, and XVote so the mode selectors look identical (CC, July 20).
export default function ModeIcon({ m }: { m: 'text' | 'image' | 'video' | 'game' | 'audio' | 'film' }) {
  const p = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, style: { flexShrink: 0 } }
  if (m === 'text')  return (<svg {...p}><path d="M4 6h16"/><path d="M4 12h10"/><path d="M4 18h14"/></svg>)
  if (m === 'image') return (<svg {...p}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>)
  // Speaker with sound waves: text-to-speech (XCreate audio mode, Sep 26).
  if (m === 'audio') return (<svg {...p}><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/></svg>)
  // Clapperboard: a finished film, directed and edited by Claude (XCreate's
  // fifth type, Sep 29).
  if (m === 'film')  return (<svg {...p}><rect x="3" y="10" width="18" height="11" rx="2"/><path d="M3 10V7a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v3"/><path d="M8 6l-2 4"/><path d="M13 6l-2 4"/><path d="M18 6l-2 4"/></svg>)
  if (m === 'game')  return (<svg {...p}><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.3" cy="8.3" r="1.3" fill="currentColor" stroke="none"/><circle cx="15.7" cy="8.3" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="8.3" cy="15.7" r="1.3" fill="currentColor" stroke="none"/><circle cx="15.7" cy="15.7" r="1.3" fill="currentColor" stroke="none"/></svg>)
  return (<svg {...p}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9l5 3l-5 3z"/></svg>)
}
