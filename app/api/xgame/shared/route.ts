// app/api/xgame/shared/route.ts — the XGame tables an account sits at as a
// guest (Oct 21, multiplayer step 1). The menu and the Library list the
// account's own rows straight from xtalk_sessions (owner-read RLS); a table
// someone else created is not its row, so it comes from here
// (xgame_members, lib/xgame-duo.ts tablesJoined).

export const runtime = 'nodejs'

import { tablesJoined } from '@/lib/xgame-duo'

export async function GET() {
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ tables: [] })
  return Response.json({ tables: await tablesJoined(user.id) })
}
