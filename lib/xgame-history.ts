// lib/xgame-history.ts — an account's tables of one game, as the history card
// under that game's setup lists them (Oct 21; owner: "you should put the
// history in the tab page not on the left nav bar", "check how XOracle
// works": XOracle keeps each temple's visits under its form). SERVER-ONLY:
// a table a friend invited you to is not your row, so it is read with the
// service key through xgame_members (supabase/147).

import { createClient } from '@supabase/supabase-js'
import { seatOf } from './xgame-duo'

const admin = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false } },
)

/** Where a table stands for the asking account. */
export type TableState = 'yourturn' | 'waiting' | 'live' | 'won' | 'lost' | 'draw' | 'cancelled' | 'over'

export type HistoryRow = {
  id: string; title: string | null; game: string; created_at: string; updated_at: string
  /** The account created it (it may rename and delete it). */
  host: boolean
  state: TableState
}

const COLS = 'id, user_id, title, game, status, phase, winner, human_seat, players, pending, created_at, updated_at'

/** Chess and 象棋 store the side to move in `phase` ('w' / 'b') and seat
 *  White / Red first, so "your turn" and "you won" can be told; the other
 *  games say only live or over. */
function stateOf(row: any, userId: string): TableState {
  const twoSided = row.game === 'chess' || row.game === 'xiangqi'
  const me = twoSided ? seatOf(row, userId) : -1
  if (row.status === 'over') {
    if (row.pending?.end?.reason === 'cancel') return 'cancelled'
    if (me < 0) return 'over'
    if (row.winner === 'draw') return 'draw'
    const winnerSeat = row.winner === 'black' ? 1 : (row.winner === 'white' || row.winner === 'red') ? 0 : -1
    return winnerSeat < 0 ? 'over' : winnerSeat === me ? 'won' : 'lost'
  }
  if (row.pending?.lobby?.open?.length) return 'waiting'
  if (me >= 0 && (row.phase === 'w' ? 0 : row.phase === 'b' ? 1 : -1) === me) return 'yourturn'
  return 'live'
}

/** The account's newest tables of `game`: its own and those it joined. */
export async function tablesFor(userId: string, game: string, limit = 5): Promise<HistoryRow[]> {
  const db = admin()
  const [own, joined] = await Promise.all([
    db.from('xtalk_sessions').select(COLS).eq('user_id', userId).eq('game', game)
      .order('updated_at', { ascending: false }).limit(limit),
    db.from('xgame_members').select('table_id').eq('user_id', userId)
      .order('joined_at', { ascending: false }).limit(50),
  ])
  const ids = (joined.data ?? []).map(m => m.table_id)
  const guest = ids.length
    ? (await db.from('xtalk_sessions').select(COLS).in('id', ids).eq('game', game).neq('user_id', userId)).data ?? []
    : []
  return [...(own.data ?? []), ...guest]
    .sort((a: any, b: any) => String(b.updated_at).localeCompare(String(a.updated_at)))
    .slice(0, limit)
    .map((r: any) => ({
      id: r.id, title: r.title ?? null, game: r.game, created_at: r.created_at, updated_at: r.updated_at,
      host: r.user_id === userId, state: stateOf(r, userId),
    }))
}
