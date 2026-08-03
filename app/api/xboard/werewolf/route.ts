// app/api/xboard/werewolf/route.ts
// Werewolf standings — aggregated from finished XTalk werewolf games.
//
// This is a game scoreboard, not a rating pool. It never touches
// model_ratings or the ELO pipeline: a wolf win is a social-deduction
// outcome decided by six other models' votes, which is not the same
// evidence as a human preferring one answer over another. Keeping it
// out of XD Score means one system's noise can't leak into the other.
// (If agents join later — XAGENT — their rows partition here the same
// way they will in the rating pools: by participant, from day one.)

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const revalidate = 0

export type WerewolfRow = {
  modelId: string
  games: number
  wins: number
  wolfGames: number
  wolfWins: number
  villageGames: number
  villageWins: number
  survived: number
}

export async function GET() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  )

  // Player rows only exist for games that finished and recorded — an
  // abandoned session never writes them, so no status filter is needed.
  const [{ data, error }, { count: totalGames }] = await Promise.all([
    sb.from('xtalk_game_players').select('model_id, side, won, survived'),
    sb.from('xtalk_games').select('id', { count: 'exact', head: true }),
  ])

  if (error) {
    console.warn('[xboard/werewolf] read failed:', error.message)
    return NextResponse.json({ totalGames: 0, rows: [] }, { status: 200 })
  }

  const acc = new Map<string, WerewolfRow>()
  for (const r of data ?? []) {
    if (!r.model_id) continue // human seats have no model
    let row = acc.get(r.model_id)
    if (!row) {
      row = { modelId: r.model_id, games: 0, wins: 0, wolfGames: 0, wolfWins: 0, villageGames: 0, villageWins: 0, survived: 0 }
      acc.set(r.model_id, row)
    }
    row.games++
    if (r.won) row.wins++
    if (r.survived) row.survived++
    if (r.side === 'wolf') { row.wolfGames++; if (r.won) row.wolfWins++ }
    else                   { row.villageGames++; if (r.won) row.villageWins++ }
  }

  return NextResponse.json({ totalGames: totalGames ?? 0, rows: [...acc.values()] })
}
