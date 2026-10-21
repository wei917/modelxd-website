// lib/xgame-duo.ts — the server half of a table where people play each
// other (Oct 21; docs/XGAME-MULTIPLAYER-PLAN.md, step 1: chess and 象棋 for
// two people). SERVER-ONLY: it reads profiles and writes xgame_members with
// the service key (supabase/147).
//
// A seat of a table is an account's: `players[i].userId`. The host's own seat
// carries it from the start; an invited seat gets it when someone opens the
// table's link and sits down. Rows written before Oct 21 have no userId: their
// one person is the creator, at `human_seat`. The browser can no longer write
// a table row (migration 147), so `players` is the server's word on who sits
// where; xgame_members is the same fact as rows, for "tables I joined" and as
// the arbiter of a seat (unique per table and seat).

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createClient, type User } from '@supabase/supabase-js'
import { userName, userPhoto } from './user-face'
import { ensureHandle } from './profile-handle'

const LOG = '[xgame:duo]'

const admin = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false } },
)

/** A seat as the duo code reads it (each game's Player has these fields). */
export type DuoSeat = {
  isHuman: boolean
  userId?: string | null
  name: string
  handle?: string | null
  avatar?: string | null
  /** Waiting for someone to open the link and sit down. */
  invited?: boolean
}

/** The table waits for its invited seats; gone once they are all taken. */
export type Lobby = { token: string; open: number[] }

/** Two people at the table (and so no model, and a clock). */
export const isDuo = (players: DuoSeat[]) => players.length === 2 && players.every(p => p.isHuman)

/** The seat of this account at this table, or -1 (not seated). */
export function seatOf(row: { user_id: string; human_seat: number | null; players: DuoSeat[] }, userId: string): number {
  const byId = row.players.findIndex(p => p.isHuman && p.userId === userId)
  if (byId >= 0) return byId
  // Before Oct 21 a table's one person was its creator, at human_seat.
  const legacy = row.human_seat
  if (row.user_id === userId && legacy != null && row.players[legacy]?.isHuman && !row.players[legacy]?.userId) return legacy
  return -1
}

export const newToken = () => randomBytes(16).toString('base64url')

/** The link's token matches the table's, in constant time. */
export function tokenOk(lobby: Lobby | null | undefined, given: unknown): boolean {
  if (!lobby?.token || typeof given !== 'string' || !given) return false
  const a = Buffer.from(lobby.token), b = Buffer.from(given)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** The name, @ID and picture other people see (profiles, written only by
 *  /api/profile/face), falling back to the sign-in's own, as X體育 does. */
export async function faceOf(user: User): Promise<{ name: string; handle: string | null; avatar: string | null }> {
  const [{ data: prof }, h] = await Promise.all([
    admin().from('profiles').select('display_name, avatar_url').eq('id', user.id).maybeSingle(),
    ensureHandle(user.id).catch(() => null),
  ])
  return {
    name: (prof?.display_name || userName(user as any) || 'Player').slice(0, 40),
    handle: h?.handle ?? null,
    avatar: prof?.avatar_url || userPhoto(user as any) || null,
  }
}

/** Take a seat: one row per account and per seat, so two people racing for
 *  the last seat get one each way (the loser's insert fails). */
export async function claimSeat(tableId: string, userId: string, seat: number): Promise<'ok' | 'taken'> {
  const { error } = await admin().from('xgame_members').insert({ table_id: tableId, user_id: userId, seat })
  if (!error) return 'ok'
  if (error.code !== '23505') console.warn(`${LOG} claim ${tableId}#${seat}:`, error.message)
  return 'taken'
}

export async function releaseSeat(tableId: string, userId: string): Promise<void> {
  const { error } = await admin().from('xgame_members').delete().eq('table_id', tableId).eq('user_id', userId)
  if (error) console.warn(`${LOG} release ${tableId}:`, error.message)
}

/** The Realtime channel of a table. Its messages carry no game data, only
 *  "something changed": each page then fetches its own view from the API. */
export const tableChannel = (tableId: string) => `xgame:${tableId}`

/** Tell the table's open pages to refresh. Best effort: a page that misses
 *  it refreshes on its 5 s fallback. */
export async function pingTable(tableId: string): Promise<void> {
  try {
    await admin().channel(tableChannel(tableId)).httpSend('v', { at: Date.now() })
  } catch (e: any) {
    console.warn(`${LOG} ping ${tableId}:`, e?.message ?? e)
  }
}

/** Seats as the page sees them: never an account id. */
export const publicSeats = <T extends DuoSeat>(players: T[]) =>
  players.map(({ userId: _u, ...p }) => p)

/** The tables an account sits at as a guest (not the host), newest first:
 *  for the menu and the Library, which list the host's own rows themselves. */
export async function tablesJoined(userId: string, limit = 20) {
  const { data: mine, error } = await admin().from('xgame_members')
    .select('table_id, joined_at').eq('user_id', userId)
    .order('joined_at', { ascending: false }).limit(limit)
  if (error || !mine?.length) return []
  const { data: rows } = await admin().from('xtalk_sessions')
    .select('id, title, game, status, created_at, updated_at, user_id')
    .in('id', mine.map(m => m.table_id))
  return (rows ?? []).filter(r => r.user_id !== userId)
    .map(({ user_id: _u, ...r }) => r)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
}
