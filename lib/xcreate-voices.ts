// lib/xcreate-voices.ts — the voices people clone of themselves for X創作's
// 語音 (owner, Oct 20). Server-only: service-key reads of `xcreate_voices`
// (migration 144), which no browser can read.
//
// A page names a voice as `mine:<row id>` in a slot's `voice` option. The
// route turns that into MiniMax's voice id here, only for the account that
// made it, so a voice id never reaches a browser and nobody can speak with
// somebody else's voice.

import type { SupabaseClient } from '@supabase/supabase-js'

export const MINE_PREFIX = 'mine:'

/** At most this many voices kept at once, and this many tries a day (a
 *  try is house-paid: Whisper reads it before MiniMax clones it). */
export const MAX_VOICES = 5
export const MAX_TRIES_PER_DAY = 10
export const TRY_EVENT = 'xcreate_voice_try'

/** MiniMax deletes a cloned voice that has not spoken within 7 days. Two
 *  hours early here, so we never offer a voice MiniMax just dropped. */
const LAPSE_MS = 7 * 24 * 3600_000 - 2 * 3600_000

export type VoiceRow = {
  id: string
  user_id: string
  provider: 'minimax'
  voice_id: string
  name: string
  lang: string | null
  first_used_at: string | null
  created_at: string
}

/** What a page may know about a voice: no provider id. */
export type MyVoice = { id: string; name: string; lang: string | null; used: boolean; createdAt: string; lapsesAt: string | null }

export const toMyVoice = (r: VoiceRow): MyVoice => ({
  id: r.id, name: r.name, lang: r.lang, used: !!r.first_used_at, createdAt: r.created_at,
  lapsesAt: r.first_used_at ? null : new Date(Date.parse(r.created_at) + LAPSE_MS).toISOString(),
})

const lapsed = (r: Pick<VoiceRow, 'first_used_at' | 'created_at'>) =>
  !r.first_used_at && Date.now() - Date.parse(r.created_at) > LAPSE_MS

const COLS = 'id, user_id, provider, voice_id, name, lang, first_used_at, created_at'

/** The account's voices, newest first. A voice MiniMax has let lapse is
 *  marked deleted on the way. */
export async function listVoices(sb: SupabaseClient, userId: string): Promise<VoiceRow[]> {
  const { data, error } = await sb.from('xcreate_voices').select(COLS)
    .eq('user_id', userId).is('deleted_at', null).order('created_at', { ascending: false })
  if (error) throw error
  const rows = (data ?? []) as VoiceRow[]
  const gone = rows.filter(lapsed).map(r => r.id)
  if (gone.length) await sb.from('xcreate_voices').update({ deleted_at: new Date().toISOString() }).in('id', gone)
  return rows.filter(r => !gone.includes(r.id))
}

/** `mine:<id>` → that voice, when it is this account's and still alive. */
export async function resolveVoice(sb: SupabaseClient, userId: string, option: string): Promise<VoiceRow | null> {
  const id = option.startsWith(MINE_PREFIX) ? option.slice(MINE_PREFIX.length) : ''
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const { data } = await sb.from('xcreate_voices').select(COLS)
    .eq('id', id).eq('user_id', userId).is('deleted_at', null).maybeSingle()
  const row = data as VoiceRow | null
  return row && !lapsed(row) ? row : null
}

/** Mark the voice's first use. True for the ONE caller that did, who adds
 *  MiniMax's fee to that slot (two seats speaking at once pay it once). */
export async function claimFirstUse(sb: SupabaseClient, id: string): Promise<boolean> {
  const { data } = await sb.from('xcreate_voices').update({ first_used_at: new Date().toISOString() })
    .eq('id', id).is('first_used_at', null).select('id')
  return (data ?? []).length > 0
}

/** A fresh MiniMax voice id: a letter first, the account in it (for anyone
 *  reading MiniMax's console), then time and chance so it is never reused. */
export function newVoiceId(userId: string): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `xd${userId.replace(/-/g, '')}_${Date.now().toString(36)}${rand}`
}
