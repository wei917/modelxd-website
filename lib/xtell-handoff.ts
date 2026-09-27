// lib/xtell-handoff.ts — carrying a guide suggestion into a temple.
//
// When a visitor clicks one of the front-door guide's actions, the feature id
// and the question it prepared are kept in sessionStorage (this tab only,
// never the URL) and the street opens the room by its usual #hash. The room
// takes its mode and pre-filled question from here. Nothing is sent, drawn or
// cast: the visitor still fills in the form and presses send, which is where
// any charge is estimated and confirmed.
//
// Only the feature id is trusted, and only after the catalog has vouched for
// it: the room and the mode are always derived from the catalog entry, never
// read back from storage (Codex review: storage can be stale or edited). A
// handoff from another catalog version, an unknown or pending feature, an
// expired one, or one for another room is ignored.
//
// Client-safe and storage-injectable, so the tests run without a browser.

import { XTELL_CATALOG_VERSION, liveFeature, type Feature, type FeatureId } from './xtell-catalog'
import type { Temple } from './xtell'

export const HANDOFF_KEY = 'xtell.assistant.handoff'
/** Long enough to sign in with Google and come back; short enough that an
 *  old suggestion does not reappear on a later, unrelated visit. */
export const HANDOFF_TTL_MS = 30 * 60_000
export const QUESTION_MAX = 300

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** What is stored. Deliberately no room or mode: see above. */
type Stored = { v: string; feature: string; question: string | null; at: number }

/** A handoff the room may use: the catalog's feature and a clean question. */
export type Handoff = { feature: Feature; question: string | null }

/** A question safe to pre-fill: one line of plain text, bounded, and never a
 *  link (the guide has no reason to hand over a URL). */
export function cleanQuestion(q: unknown): string | null {
  if (typeof q !== 'string') return null
  const s = q.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, QUESTION_MAX)
  if (!s || /[a-z][a-z0-9+.-]*:\/\/|javascript:|data:/i.test(s)) return null
  return s
}

/** Keep a clicked action for the room it opens. False when the feature is
 *  not a live catalog feature or storage refuses (private mode). */
export function writeHandoff(store: Store, feature: FeatureId | string, question: unknown, now = Date.now()): boolean {
  const f = liveFeature(feature)
  // Rooms only: the daily, almanac and Panchang cards are on the street itself.
  if (!f?.temple) return false
  const value: Stored = { v: XTELL_CATALOG_VERSION, feature: f.id, question: f.question ? cleanQuestion(question) : null, at: now }
  try { store.setItem(HANDOFF_KEY, JSON.stringify(value)); return true } catch { return false }
}

/** The handoff for `temple`, if a valid one is waiting. Does not remove it:
 *  it has to survive the sign-in round trip (see clearHandoff). */
export function readHandoff(store: Store, temple: Temple, now = Date.now()): Handoff | null {
  let raw: string | null = null
  try { raw = store.getItem(HANDOFF_KEY) } catch { return null }
  if (!raw) return null
  let s: Partial<Stored>
  try { s = JSON.parse(raw) } catch { return null }
  if (!s || s.v !== XTELL_CATALOG_VERSION || typeof s.at !== 'number' || !(now - s.at >= 0 && now - s.at <= HANDOFF_TTL_MS)) return null
  const f = liveFeature(s.feature)
  if (!f || f.temple !== temple) return null
  return { feature: f, question: f.question ? cleanQuestion(s.question) : null }
}

/** Forget the waiting handoff: once the visitor has entered or cast in the
 *  room, or left it. */
export function clearHandoff(store: Store): void {
  try { store.removeItem(HANDOFF_KEY) } catch { /* nothing to clear */ }
}

/** sessionStorage when there is a browser, else nothing. */
export function sessionStore(): Store | null {
  try { return typeof window !== 'undefined' ? window.sessionStorage : null } catch { return null }
}
