'use client'

// app/xsports/hidden.ts — who a viewer has hidden in X體育's public chats
// (owner, Oct 14: "a hide feature so users can choose to hide AI or users";
// "keep 30 days on local browser should be good enough"). One list for every
// game's chat, in this browser only: nobody else sees it and nothing goes to
// the server. Each entry lapses 30 days after it was made. Every open tab and
// component reads the same list (useSyncExternalStore, plus the storage event
// for other tabs).

import { useSyncExternalStore } from 'react'

const KEY = 'xsports.hidden'
const TTL = 30 * 86_400_000

export interface HiddenPerson { name: string; handle: string | null; avatar: string | null; at: number }
export interface HiddenState {
  /** Fans by key (personKey): their name and picture as last seen. */
  people: Record<string, HiddenPerson>
  /** One AI commentator by its @handle (Luna, Qwen). */
  ais: Record<string, number>
  /** Every AI commentator, since when; null when they show. */
  allAi: number | null
}

const EMPTY: HiddenState = { people: {}, ais: {}, allAi: null }
let state: HiddenState | null = null
const listeners = new Set<() => void>()

/** A fan's key: the @ID (unique, public), else the name (older messages). */
export const personKey = (m: { author_handle?: string | null; author_name: string }) => (m.author_handle ? `@${m.author_handle}` : `name:${m.author_name}`)

/** The list as stored, without what has lapsed. */
function read(): HiddenState {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    const now = Date.now()
    const fresh = (at: unknown) => typeof at === 'number' && now - at < TTL
    const people: Record<string, HiddenPerson> = {}
    for (const [k, p] of Object.entries((raw?.people ?? {}) as Record<string, HiddenPerson>)) if (p && fresh(p.at)) people[k] = p
    const ais: Record<string, number> = {}
    for (const [k, at] of Object.entries((raw?.ais ?? {}) as Record<string, number>)) if (fresh(at)) ais[k] = at
    return { people, ais, allAi: fresh(raw?.allAi) ? raw.allAi : null }
  } catch {
    return EMPTY
  }
}

const snapshot = () => (state ??= read())

function write(next: HiddenState) {
  state = next
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* private mode: this page only */ }
  listeners.forEach(l => l())
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) { state = read(); listeners.forEach(l => l()) } }
  window.addEventListener('storage', onStorage)
  return () => { listeners.delete(cb); window.removeEventListener('storage', onStorage) }
}

/** The list and what can be done with it. */
export function useHidden() {
  const s = useSyncExternalStore(subscribe, snapshot, () => EMPTY)
  return {
    state: s,
    /** Hidden here: a fan on the list, or the commentators (all, or this one). */
    hides: (m: { kind: string; author_handle?: string | null; author_name: string }, aiHandle: string | null) =>
      m.kind === 'ai' ? s.allAi !== null || (!!aiHandle && aiHandle in s.ais) : personKey(m) in s.people,
    hidePerson: (m: { author_handle?: string | null; author_name: string; author_avatar?: string | null }) =>
      write({ ...snapshot(), people: { ...snapshot().people, [personKey(m)]: { name: m.author_name, handle: m.author_handle ?? null, avatar: m.author_avatar ?? null, at: Date.now() } } }),
    showPerson: (key: string) => {
      const people = { ...snapshot().people }
      delete people[key]
      write({ ...snapshot(), people })
    },
    hideAi: (handle: string) => write({ ...snapshot(), ais: { ...snapshot().ais, [handle]: Date.now() } }),
    showAi: (handle: string) => {
      const ais = { ...snapshot().ais }
      delete ais[handle]
      write({ ...snapshot(), ais })
    },
    setAllAi: (hidden: boolean) => write({ ...snapshot(), allAi: hidden ? Date.now() : null }),
  }
}
