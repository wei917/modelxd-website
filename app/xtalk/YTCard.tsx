'use client'
// app/xtalk/YTCard.tsx — the room music player card, shared by Characters
// and Discussion (owner, Aug 13: "can we hit play for the users?").
//
// AUTOPLAY CONTRACT: `autoplay` is granted ONLY to a song that arrived live
// in this session — the browser permits sound because the user's own click
// (calling on the speaker) precedes it, and history reopening must never
// start a choir. Delegation rides the iframe allow="autoplay".
// With no videoId it late-resolves via /api/xcharacter/yt (server key);
// with no hit it links out — a click beats a dead end.

import { useEffect, useState } from 'react'

/* Inline player for a [[play: …]] directive or a bare YouTube URL.
 *  With YOUTUBE_API_KEY on the server it embeds the top search hit;
 *  without, it links out. `autoplay` is granted only to songs that arrive
 *  live in this session — history must never start a choir on reopen. */
export default function YTCard({ query, fixedId, autoplay }: { query: string; fixedId?: string | null; autoplay?: boolean }) {
  const [videoId, setVideoId] = useState<string | null | 'loading'>(fixedId ?? 'loading')
  useEffect(() => {
    if (fixedId) return
    let dead = false
    fetch('/api/xcharacter/yt', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!dead) setVideoId(d?.videoId ?? null) })
      .catch(() => { if (!dead) setVideoId(null) })
    return () => { dead = true }
  }, [query, fixedId])

  if (videoId && videoId !== 'loading') {
    return (
      <span style={{ display: 'block', marginTop: 8, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border2)' }}>
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${videoId}${autoplay ? '?autoplay=1' : ''}`}
          title={query} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen
          style={{ display: 'block', width: '100%', aspectRatio: '16 / 9', border: 'none' }}
        />
      </span>
    )
  }
  return (
    <a
      href={`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`}
      target="_blank" rel="noopener noreferrer"
      style={{
        display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, padding: '8px 12px',
        borderRadius: 10, border: '1px solid var(--border2)', background: 'var(--surface2)',
        color: 'var(--white)', fontSize: 12.5, fontWeight: 700, textDecoration: 'none',
      }}>
      <span aria-hidden>🎵</span>
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{query}</span>
      <span style={{ color: 'var(--red)', flexShrink: 0 }}>{videoId === 'loading' ? '…' : '▶ YouTube'}</span>
    </a>
  )
}
