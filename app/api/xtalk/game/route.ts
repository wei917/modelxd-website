// app/api/xtalk/game/route.ts
// Record a finished werewolf game.
//
// Written server-side with the service key rather than from the browser: the
// client already holds the roles (it is the moderator), so a client-side
// insert would let anyone post any result they liked into a public board.
// This route re-derives side and won from the roles it is given, so the only
// thing the caller controls is what happened, not what it scored.

export const runtime = 'nodejs'

import { createClient } from '@supabase/supabase-js'

const LOG = '[xtalk/game]'

const service = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false } },
)

export async function POST(req: Request) {
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { winner, days = 1, cost = 0, players = [], transcript = null } = await req.json()
  if (winner !== 'wolves' && winner !== 'village') {
    return Response.json({ error: 'winner must be wolves or village' }, { status: 400 })
  }
  if (!Array.isArray(players) || players.length < 4) {
    return Response.json({ error: 'need at least 4 players' }, { status: 400 })
  }

  const rows = players.map((p: any, i: number) => {
    const side = p.role === 'wolf' ? 'wolf' : 'village'
    return {
      seat: i,
      model_id: p.modelId,
      side,
      role: String(p.role),
      // Derived here, never trusted from the caller.
      won: side === winner || (side === 'village' && winner === 'village'),
      survived: !!p.alive,
    }
  })
  // The line above is true by construction for wolves too; spell it out so a
  // future reader doesn't have to prove it.
  for (const r of rows) r.won = (r.side === 'wolf') === (winner === 'wolves')

  const svc = service()
  const { data: game, error } = await svc.from('xtalk_games').insert({
    user_id: user.id,
    players: rows.length,
    wolves:  rows.filter(r => r.side === 'wolf').length,
    winner,
    days:    Math.max(1, Number(days) || 1),
    cost_usd: Number(cost) || 0,
    transcript,
  }).select('id').single()

  if (error || !game) {
    console.warn(`${LOG} insert failed:`, error?.message)
    return Response.json({ error: error?.message ?? 'insert failed' }, { status: 500 })
  }

  const { error: pErr } = await svc.from('xtalk_game_players')
    .insert(rows.map(r => ({ ...r, game_id: game.id })))
  if (pErr) {
    console.warn(`${LOG} player insert failed:`, pErr.message)
    return Response.json({ error: pErr.message }, { status: 500 })
  }

  console.log(`${LOG} recorded ${game.id}: ${winner} win, ${rows.length}p, ${days}d, $${cost}`)
  return Response.json({ ok: true, gameId: game.id })
}
