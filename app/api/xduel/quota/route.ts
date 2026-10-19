// app/api/xduel/quota/route.ts
//
// What the signed-in user can still run today (UTC), per type, so the
// page can disable what does not fit and say when the day's allowance is
// gone. The page shows no counts (owner, Oct 17); the allowance is in
// lib/duel-allowance.ts. Read-only.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { createSupabaseServer } from '@/lib/supabase-server'
import { readDuelUsed } from '@/lib/duel-quota'
import { duelsLeft } from '@/lib/duel-allowance'

export async function GET() {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const used = await readDuelUsed(user.id)
  return Response.json({
    left: { text: duelsLeft('text', used), image: duelsLeft('image', used), video: duelsLeft('video', used), audio: duelsLeft('text', used) },
    date: new Date().toISOString().slice(0, 10),
  })
}
