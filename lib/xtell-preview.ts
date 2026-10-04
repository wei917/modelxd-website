// lib/xtell-preview.ts — the homepage hero tells the top bar which temple it
// is showing (Oct 3, Concept 24), so that icon can be highlighted. The top
// bar is mounted by the shared Nav, apart from the page, hence a window
// event rather than shared React state. A preview is only a highlight: it
// never changes the address, the hash or the room.

import type { TempleKey } from '../app/components/xtell/TempleArtwork'

export const PREVIEW_EVENT = 'xtell:preview'

/** Announce the temple on show, or null when the hero is gone. */
export function announcePreview(temple: TempleKey | null): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<TempleKey | null>(PREVIEW_EVENT, { detail: temple }))
}

/** Follow the announcements; returns the unsubscribe. */
export function onPreview(fn: (temple: TempleKey | null) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (e: Event) => fn(((e as CustomEvent<TempleKey | null>).detail ?? null))
  window.addEventListener(PREVIEW_EVENT, handler)
  return () => window.removeEventListener(PREVIEW_EVENT, handler)
}
