// lib/profile-handle.ts — reading, assigning and changing an account's @ID
// (supabase/132; rules in lib/handle.ts). Server-only: every call runs with
// the service role. Until migration 132 has been run every reader here
// answers "no ID" instead of failing, so nothing that shows a name breaks.

import { createClient } from '@supabase/supabase-js'
import { moderate } from './moderation'

const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } })

/** The error Supabase gives while migration 132 has not been run. */
export const handlesMissing = (e: any): boolean =>
  !!e && (e.code === '42703' || e.code === '42883' || e.code === 'PGRST202' || e.code === 'PGRST204'
    || /does not exist|could not find|schema cache/i.test(String(e.message ?? '')))

export interface HandleState {
  handle: string
  /** When the person may change it next; null: now. */
  nextChangeAt: string | null
}

const DAY = 86_400_000
const stateOf = (handle: string, changedAt: string | null): HandleState => ({
  handle,
  nextChangeAt: changedAt && Date.parse(changedAt) + 30 * DAY > Date.now() ? new Date(Date.parse(changedAt) + 30 * DAY).toISOString() : null,
})

/** The account's @ID, giving it one first if it has none. A newly assigned
 *  ID (an X username, say) goes through moderation like a chosen one; when
 *  refused it is replaced with words, and when the check cannot run it
 *  stays. null before migration 132, or with no profile row yet. */
export async function ensureHandle(userId: string): Promise<HandleState | null> {
  const db = admin()
  const read = await db.from('profiles').select('handle, handle_changed_at').eq('id', userId).maybeSingle()
  if (read.error) { if (!handlesMissing(read.error)) console.warn('[handle] read', read.error.message); return null }
  if (read.data?.handle) return stateOf(read.data.handle, read.data.handle_changed_at)
  if (!read.data) return null
  const { data: handle, error } = await db.rpc('assign_profile_handle', { uid: userId })
  if (error || typeof handle !== 'string') { if (error && !handlesMissing(error)) console.warn('[handle] assign', error.message); return null }
  if ((await moderate({ text: handleText(handle) })) === 'refused') {
    const { data: words } = await db.rpc('assign_profile_handle', { uid: userId, words_only: true })
    if (typeof words === 'string') return stateOf(words, null)
  }
  return stateOf(handle, null)
}

export type ChangeResult =
  | { ok: true; state: HandleState }
  | { ok: false; error: 'handle_taken' | 'handle_too_soon' | 'handle_chars' | 'handle_refused' | 'check_unavailable' | 'failed'; next?: string }

/** What moderation reads for an ID: its words, not its underscores. */
export const handleText = (handle: string) => handle.replace(/[._]+/g, ' ')

/** Change the account's @ID (already cleaned and checked by checkHandle):
 *  moderation (unless the caller ran it), then the 30-day rule, holds and
 *  uniqueness in one transaction. */
export async function changeHandle(userId: string, handle: string, opts: { moderated?: boolean } = {}): Promise<ChangeResult> {
  if (!opts.moderated) {
    const verdict = await moderate({ text: handleText(handle) })
    if (verdict === 'refused') return { ok: false, error: 'handle_refused' }
    if (verdict === 'unavailable') return { ok: false, error: 'check_unavailable' }
  }
  const { data, error } = await admin().rpc('change_profile_handle', { uid: userId, h: handle })
  if (error || !data) { console.warn('[handle] change', error?.message); return { ok: false, error: 'failed' } }
  const j = data as { handle?: string; changed_at?: string; error?: string; next?: string }
  if (j.error === 'handle_taken' || j.error === 'handle_too_soon' || j.error === 'handle_chars') return { ok: false, error: j.error, next: j.next }
  if (!j.handle) return { ok: false, error: 'failed' }
  return { ok: true, state: stateOf(j.handle, j.changed_at ?? null) }
}

/** Whether an ID (checked by checkHandle) is free for this account. */
export async function handleAvailable(userId: string, handle: string): Promise<boolean | null> {
  const db = admin()
  const [taken, held] = await Promise.all([
    db.from('profiles').select('id').eq('handle', handle).neq('id', userId).limit(1),
    db.from('profile_handle_holds').select('user_id').eq('handle', handle).neq('user_id', userId).gt('until', new Date().toISOString()).limit(1),
  ])
  if (taken.error || held.error) return null
  return !taken.data?.length && !held.data?.length
}
