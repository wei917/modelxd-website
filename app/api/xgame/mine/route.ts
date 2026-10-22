// app/api/xgame/mine/route.ts — the history card under a game's setup
// (Oct 21): the asking account's newest tables of that game, its own and
// those a friend invited it to, each with where it stands for them
// (lib/xgame-history.ts). GET ?game=chess

export const runtime = 'nodejs'

import { tablesFor } from '@/lib/xgame-history'
import { isGameKey } from '@/lib/xgame-games'

export async function GET(req: Request) {
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ tables: [] })
  const game = new URL(req.url).searchParams.get('game') ?? ''
  if (!isGameKey(game)) return Response.json({ error: 'unknown game' }, { status: 400 })
  return Response.json({ tables: await tablesFor(user.id, game) })
}
