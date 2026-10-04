// lib/xtell-pins.ts — temples a visitor pins to the front of the top bar
// (owner, Oct 3: instead of a 我的常用 card). The newest pin goes to the very
// left. Kept on this device (localStorage); there is no account copy yet.
// Everything read back is checked: only real temple keys, each once, in the
// saved order. Corrupt or foreign data reads as none and is not overwritten
// until the visitor changes something; blocked storage keeps pins for this
// visit only. Nothing is ever pinned for them.

import type { TempleKey } from '../app/components/xtell/TempleArtwork'

export const PINS_KEY = 'xtell:pins:v1'
/** Fired on window after a change, so the top bar follows in the same tab. */
export const PINS_EVENT = 'xtell:pins'

/** The saved pins, or [] for nothing / anything that is not a valid list.
 *  `known` is the list of real temple keys. */
export function parsePins(raw: string | null | undefined, known: readonly string[]): TempleKey[] {
  if (!raw) return []
  let data: unknown
  try { data = JSON.parse(raw) } catch { return [] }
  if (!Array.isArray(data)) return []
  const out: TempleKey[] = []
  for (const item of data) {
    if (typeof item === 'string' && known.includes(item) && !out.includes(item as TempleKey)) out.push(item as TempleKey)
  }
  return out
}

type Store = Pick<Storage, 'getItem' | 'setItem'>

/** Read the pins; `ok` is false when storage cannot be used at all. */
export function loadPins(store: Store | null, known: readonly string[]): { list: TempleKey[]; ok: boolean } {
  if (!store) return { list: [], ok: false }
  try { return { list: parsePins(store.getItem(PINS_KEY), known), ok: true } }
  catch { return { list: [], ok: false } }
}

/** Save the pins; false when the browser refused. */
export function savePins(store: Store | null, list: readonly TempleKey[]): boolean {
  if (!store) return false
  try { store.setItem(PINS_KEY, JSON.stringify(list)); return true } catch { return false }
}

/** The browser's localStorage, or null where it cannot even be touched. */
export function deviceStore(): Store | null {
  try { return typeof window !== 'undefined' ? window.localStorage : null } catch { return null }
}

/** Pin: the temple goes to the very left. */
export const pinTemple = (list: readonly TempleKey[], key: TempleKey): TempleKey[] => [key, ...list.filter(k => k !== key)]
export const unpinTemple = (list: readonly TempleKey[], key: TempleKey): TempleKey[] => list.filter(k => k !== key)

/** The top bar's order: the pins first (newest leftmost), then the market's
 *  order without them. Pins that are not in `order` are ignored. */
export function pinnedFirst(order: readonly TempleKey[], pins: readonly TempleKey[]): TempleKey[] {
  const first = pins.filter(k => order.includes(k))
  return [...first, ...order.filter(k => !first.includes(k))]
}
