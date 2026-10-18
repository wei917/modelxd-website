// lib/xtell-room.ts: X先知's room in the address (Oct 18; owner, after X創作's
// tabs went into ?type=: "should XTell follow this design too?"; "don't worry
// about old users or old ads"). A room is ?t=<room>, the form a shared link
// already had (lib/xtell-share.ts), so the server draws the room at first
// paint and a link preview can read it; the street has none. It used to be
// the hash (/xtell#bazi), which no server ever sees.
//
// Entering a room is a history step, so Back returns to the street, as it did
// with the hash; nothing reloads (Next keeps useSearchParams in step with the
// browser's own history calls).

/** Opens a room, or the street with null, in place. */
export function goToRoom(key: string | null, { replace = false }: { replace?: boolean } = {}) {
  const url = new URL(window.location.href)
  if (key) url.searchParams.set('t', key); else url.searchParams.delete('t')
  url.hash = ''
  if (url.href === window.location.href) return
  if (replace) window.history.replaceState(window.history.state, '', url)
  else window.history.pushState(null, '', url)
}

/** A plain click on a room link while the street's own page is on screen
 *  opens the room in place; a modified click, or one from another page
 *  (the account page), follows the link. */
export function opensInPlace(event: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; button: number }, streetPath: string): boolean {
  return !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0
    && window.location.pathname === streetPath
}
