// app/api/duel/community-vote/route.ts
// Records that a logged-in user voted on someone else's duel.
// Inserts into duel_votes (the trigger bumps duels.community_vote_count).
// Also returns the list of duel IDs this user has already voted on (for
// filtering the feed without relying on localStorage).

export const runtime = 'nodejs'

import { createClient } from '@supabase/supabase-js'

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } }
  )
}

export async function POST(req: Request) {
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const supabaseUser = await createSupabaseServer()
  const { data: { user }, error: authError } = await supabaseUser.auth.getUser()
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { duelId, voteChoice } = await req.json()
  if (!duelId) return Response.json({ error: 'Missing duelId' }, { status: 400 })

  const sb = serviceClient()

  // Upsert so duplicate calls are idempotent.
  const { error } = await sb.from('duel_votes').upsert(
    { user_id: user.id, duel_id: duelId, vote_choice: voteChoice ?? null },
    { onConflict: 'user_id,duel_id' }
  )
  if (error) {
    console.error('[community-vote] insert failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ ok: true })
}

// GET: returns all duel IDs this user has community-voted on.
export async function GET(req: Request) {
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const supabaseUser = await createSupabaseServer()
  const { data: { user }, error: authError } = await supabaseUser.auth.getUser()
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = serviceClient()
  const { data, error } = await sb
    .from('duel_votes')
    .select('duel_id')
    .eq('user_id', user.id)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ votedDuelIds: (data ?? []).map((r: any) => r.duel_id) })
}
