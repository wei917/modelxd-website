'use client'

// app/xsports/room-lang.ts — which language's public chat this browser joins
// (owner, Oct 15: "add the chat language setting"). Each language has its own
// room, so a Japanese fan lands in the Japanese one (owner, Oct 14), and the
// AI commentators speak the room's language. Unset, the room follows the site
// language; X體育設定 picks another on purpose. In this browser only.

import { useSyncExternalStore } from 'react'
import { LANGS } from '../../lib/i18n'

const KEY = 'xsports.roomLang'
const CODES = new Set<string>(LANGS.map(l => l.code))
const listeners = new Set<() => void>()
// The choice as last read or made (undefined: not read yet). Kept here too,
// so a browser that refuses storage still switches for this page.
let current: string | null | undefined

function snapshot(): string | null {
  if (current === undefined) {
    try {
      const v = localStorage.getItem(KEY)
      current = v && CODES.has(v) ? v : null
    } catch {
      current = null
    }
  }
  return current
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) { current = undefined; cb() } }
  window.addEventListener('storage', onStorage)
  return () => { listeners.delete(cb); window.removeEventListener('storage', onStorage) }
}

/** The room language picked here (null: the site's), and how to pick one:
 *  null, or the site's own language, goes back to following the site. */
export function useRoomLang(): [string | null, (lang: string | null) => void] {
  const chosen = useSyncExternalStore(subscribe, snapshot, () => null)
  const set = (lang: string | null) => {
    current = lang && CODES.has(lang) ? lang : null
    try {
      if (current) localStorage.setItem(KEY, current)
      else localStorage.removeItem(KEY)
    } catch { /* private mode: this page only */ }
    listeners.forEach(l => l())
  }
  return [chosen, set]
}
