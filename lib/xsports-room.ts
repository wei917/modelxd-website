// lib/xsports-room.ts — X體育 live rooms (supabase/131): fans and one AI
// commentator per game per language. Only the server writes, with the
// service role, so every function here takes the verified user id and puts
// it in the query. Anyone reads a room's visible messages directly (the
// public columns), and Supabase Realtime pushes new ones to open rooms.

import { xsportsAdmin } from './xsports-store'
import { isGamePk } from './mlb'
import { isNbaId } from './nba'

export interface RoomKey { league: string; game: string; lang: string }

const LANGS = new Set(['en', 'zh-Hant', 'zh-Hans', 'ja', 'ko'])

/** A room from untrusted input: a known league, its game id, a site language. */
export function roomKeyOf(league: unknown, game: unknown, lang: unknown): RoomKey | null {
  const l = league === 'nba' ? 'nba' : league === 'mlb' ? 'mlb' : null
  if (!l || typeof lang !== 'string' || !LANGS.has(lang)) return null
  if (!(l === 'nba' ? isNbaId(game) : isGamePk(game))) return null
  return { league: l, game: String(game), lang }
}

export interface RoomMessage {
  id: number
  kind: 'human' | 'ai'
  author_name: string
  /** The fan's @ID when the message was sent (supabase/132); null for the
   *  commentator and for messages from before IDs. */
  author_handle?: string | null
  author_avatar: string | null
  content: string
  model_name: string | null
  reply_to: number | null
  created_at: string
}

const PUBLIC_COLS = 'id, kind, author_name, author_handle, author_avatar, content, model_name, reply_to, created_at'
// Until migration 132 adds author_handle, rooms read and write without it
// (asking again every 5 minutes, so running it needs no restart).
let noHandlesSince = 0
const handles = () => Date.now() - noHandlesSince > 5 * 60_000
const cols = () => (handles() ? PUBLIC_COLS : PUBLIC_COLS.replace(' author_handle,', ''))
const noHandleColumn = (e: any) => handles() && !!e && (e.code === '42703' || e.code === 'PGRST204' || /author_handle/.test(String(e.message ?? '')))
export const REPORTS_TO_HIDE = 3
export const MESSAGE_MAX = 500

/** The error Supabase gives while migration 131 has not been run. */
export const roomMissing = (e: any): boolean =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|schema cache|could not find/i.test(String(e.message ?? '')))

/** The newest messages, or (before) the ones just older than that id: the
 *  page goes back a page at a time to the game's first (Oct 14: "all the
 *  way back"). Oldest first. */
export async function recentMessages(k: RoomKey, limit = 80, before?: number): Promise<RoomMessage[]> {
  let q = xsportsAdmin().from('xsports_room_messages').select(cols())
    .eq('league', k.league).eq('game_id', k.game).eq('lang', k.lang).eq('hidden', false)
  if (before) q = q.lt('id', before)
  const { data, error } = await q.order('id', { ascending: false }).limit(limit)
  if (noHandleColumn(error)) { noHandlesSince = Date.now(); return recentMessages(k, limit, before) }
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
  return ((data ?? []) as unknown as RoomMessage[]).reverse()
}

export async function addRoomMessage(k: RoomKey, m: { kind: 'human' | 'ai'; user_id?: string | null; author_name: string; author_handle?: string | null; author_avatar?: string | null; content: string; model_name?: string | null; reply_to?: number | null }): Promise<RoomMessage> {
  const { author_handle, ...rest } = m
  const { data, error } = await xsportsAdmin().from('xsports_room_messages')
    .insert({ league: k.league, game_id: k.game, lang: k.lang, ...rest, ...(handles() && author_handle ? { author_handle } : {}) })
    .select(cols()).single()
  if (noHandleColumn(error)) { noHandlesSince = Date.now(); return addRoomMessage(k, m) }
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
  return data as unknown as RoomMessage
}

/** Seconds since this person's last message in any room (null: none). */
export async function secondsSinceLast(userId: string): Promise<number | null> {
  const { data } = await xsportsAdmin().from('xsports_room_messages').select('created_at')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  return data?.created_at ? (Date.now() - Date.parse(data.created_at)) / 1000 : null
}

export async function member(userId: string): Promise<{ confirmed: boolean; mutedUntil: string | null }> {
  const { data, error } = await xsportsAdmin().from('xsports_room_members').select('name_confirmed_at, muted_until').eq('user_id', userId).maybeSingle()
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
  return { confirmed: !!data?.name_confirmed_at, mutedUntil: data?.muted_until ?? null }
}

export async function confirmName(userId: string): Promise<void> {
  const { error } = await xsportsAdmin().from('xsports_room_members')
    .upsert({ user_id: userId, name_confirmed_at: new Date().toISOString() }, { onConflict: 'user_id' })
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
}

/** Of these messages, the ones this person wrote (a page asks after a
 *  reload: user ids are never sent to browsers). */
export async function ownIds(userId: string, ids: number[]): Promise<number[]> {
  if (!ids.length) return []
  const { data } = await xsportsAdmin().from('xsports_room_messages').select('id').eq('user_id', userId).in('id', ids)
  return (data ?? []).map((r: { id: number }) => r.id)
}

/** A fan takes back one of their own messages (owner, Oct 14): hidden for
 *  everyone, the row kept so reports on it can still be looked at. Returns
 *  its room, or null when it is not theirs (or not there). */
export async function removeOwn(userId: string, messageId: number): Promise<RoomKey | null> {
  const { data, error } = await xsportsAdmin().from('xsports_room_messages').update({ hidden: true })
    .eq('id', messageId).eq('user_id', userId).eq('kind', 'human').select('league, game_id, lang')
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
  const r = (data ?? [])[0] as { league: string; game_id: string; lang: string } | undefined
  return r ? { league: r.league, game: r.game_id, lang: r.lang } : null
}

/** The room a message is in. */
export async function roomOf(messageId: number): Promise<RoomKey | null> {
  const { data } = await xsportsAdmin().from('xsports_room_messages').select('league, game_id, lang').eq('id', messageId).maybeSingle()
  return data ? { league: data.league, game: data.game_id, lang: data.lang } : null
}

/** The Realtime channel a room's open pages listen on (the page names it
 *  the same way). */
export const roomChannel = (k: RoomKey) => `xsports-room:${k.league}:${k.game}:${k.lang}`

/** Tell a room's open pages a message is gone (taken back, or hidden by
 *  reports): a broadcast on the room's channel. Best effort: a page that
 *  misses it drops the message at its next read. */
export async function announceGone(k: RoomKey, messageId: number): Promise<void> {
  try {
    await xsportsAdmin().channel(roomChannel(k)).httpSend('gone', { id: messageId })
  } catch (e: any) {
    console.warn('[xsports/room] gone broadcast failed:', e?.message ?? e)
  }
}

/** Why a message was reported (the page's dialog; supabase/133, 134). Fans'
 *  messages: spam … misinfo; the commentator's: wrong, clueless (不懂球,
 *  owner Oct 14), inappropriate. */
export const REPORT_REASONS = ['spam', 'harassment', 'hate', 'sexual', 'misinfo', 'wrong', 'clueless', 'inappropriate', 'other'] as const
export type ReportReason = (typeof REPORT_REASONS)[number]
export const REPORT_DETAILS_MAX = 300
// Until migration 133 adds reason and details, reports save without them
// (asking again every 5 minutes, so running it needs no restart).
let noReasonsSince = 0
const reasons = () => Date.now() - noReasonsSince > 5 * 60_000
const noReasonColumn = (e: any) => reasons() && !!e && (e.code === '42703' || e.code === 'PGRST204' || /reason|details/.test(String(e.message ?? '')))

/** One report per person per message (the first one's reason stays);
 *  enough of them hide it. Returns whether the message is now hidden. */
export async function report(userId: string, messageId: number, why: { reason: ReportReason; details: string | null } | null = null): Promise<boolean> {
  const admin = xsportsAdmin()
  const base = { message_id: messageId, user_id: userId }
  const row = why && reasons() ? { ...base, reason: why.reason, details: why.details } : base
  const { error } = await admin.from('xsports_room_reports').upsert(row, { onConflict: 'message_id,user_id', ignoreDuplicates: true })
  if (noReasonColumn(error)) {
    noReasonsSince = Date.now()
    await admin.from('xsports_room_reports').upsert(base, { onConflict: 'message_id,user_id', ignoreDuplicates: true })
  } else if (error?.code === '23514' && why?.reason === 'clueless') {
    // Until migration 134 adds it, 不懂球 is kept as other, said in front.
    await admin.from('xsports_room_reports').upsert({ ...base, reason: 'other', details: `[clueless] ${why.details ?? ''}`.trim().slice(0, 500) }, { onConflict: 'message_id,user_id', ignoreDuplicates: true })
  }
  const { count } = await admin.from('xsports_room_reports').select('message_id', { count: 'exact', head: true }).eq('message_id', messageId)
  if ((count ?? 0) >= REPORTS_TO_HIDE) {
    await admin.from('xsports_room_messages').update({ hidden: true }).eq('id', messageId)
    return true
  }
  return false
}

export interface RoomState { ai_since: string | null; ai_last_at: string | null; ai_lulls: number }

/** The room's AI may speak now: whoever claims the lock (one UPDATE with
 *  the condition in it, so two open pages cannot both win) does the
 *  speaking; the lock lapses by itself if that request dies. Held 150 s:
 *  a top model at its middle thinking, searching for a fan, can take a
 *  minute and more (Oct 15). */
export async function claimSpeaker(k: RoomKey, holdSeconds = 150): Promise<RoomState | null> {
  const admin = xsportsAdmin()
  await admin.from('xsports_rooms').upsert({ league: k.league, game_id: k.game, lang: k.lang }, { onConflict: 'league,game_id,lang', ignoreDuplicates: true })
  const now = new Date().toISOString()
  const { data } = await admin.from('xsports_rooms')
    .update({ ai_busy_until: new Date(Date.now() + holdSeconds * 1000).toISOString() })
    .eq('league', k.league).eq('game_id', k.game).eq('lang', k.lang)
    .or(`ai_busy_until.is.null,ai_busy_until.lt.${now}`)
    .select('ai_since, ai_last_at, ai_lulls')
  return (data?.[0] as RoomState) ?? null
}

export async function releaseSpeaker(k: RoomKey, patch: Partial<RoomState> & { spoke?: boolean }): Promise<void> {
  const { spoke, ...rest } = patch
  await xsportsAdmin().from('xsports_rooms').update({
    ...rest,
    ...(spoke ? { ai_last_at: new Date().toISOString() } : {}),
    ai_busy_until: null,
  }).eq('league', k.league).eq('game_id', k.game).eq('lang', k.lang)
}
