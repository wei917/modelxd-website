// lib/xtell-favorites.ts — 我的常用 (Oct 3, Concept 24): the temples a visitor
// pins on the homepage, kept on this device (localStorage) in v1; there is
// no account copy yet. Everything read back is checked: only real temple
// keys, each once, in the saved order. Corrupt or foreign data reads as
// empty and is not overwritten until the visitor changes something; blocked
// storage (private mode, a refused quota) leaves the list in memory only.
// Nothing is ever pre-filled.

import type { TempleKey } from '../app/components/xtell/TempleArtwork'

export const FAVORITES_KEY = 'xtell:favorites:v1'

/** The saved list, or [] for nothing / anything that is not a valid list.
 *  `known` is the list of real temple keys. */
export function parseFavorites(raw: string | null | undefined, known: readonly string[]): TempleKey[] {
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

/** Read the list; `ok` is false when storage cannot be used at all. */
export function loadFavorites(store: Store | null, known: readonly string[]): { list: TempleKey[]; ok: boolean } {
  if (!store) return { list: [], ok: false }
  try { return { list: parseFavorites(store.getItem(FAVORITES_KEY), known), ok: true } }
  catch { return { list: [], ok: false } }
}

/** Save the list; false when the browser refused. */
export function saveFavorites(store: Store | null, list: readonly TempleKey[]): boolean {
  if (!store) return false
  try { store.setItem(FAVORITES_KEY, JSON.stringify(list)); return true } catch { return false }
}

/** The browser's localStorage, or null where it cannot even be touched. */
export function deviceStore(): Store | null {
  try { return typeof window !== 'undefined' ? window.localStorage : null } catch { return null }
}

export const addFavorite = (list: readonly TempleKey[], key: TempleKey): TempleKey[] => list.includes(key) ? [...list] : [...list, key]
export const removeFavorite = (list: readonly TempleKey[], key: TempleKey): TempleKey[] => list.filter(k => k !== key)
/** Move one place left (-1) or right (+1); unchanged at the ends. */
export function moveFavorite(list: readonly TempleKey[], key: TempleKey, by: -1 | 1): TempleKey[] {
  const i = list.indexOf(key), j = i + by
  if (i < 0 || j < 0 || j >= list.length) return [...list]
  const out = [...list]; [out[i], out[j]] = [out[j], out[i]]
  return out
}
