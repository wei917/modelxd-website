// app/api/xduel/community-vote/route.ts
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

  // Called TWICE per duel now (Aug 29): once with the blind choice at step 2,
  // once with the informed choice at step 4. The upsert was always
  // idempotent, so the second call simply overwrites vote_choice with the
  // final answer — which is the one that should stand.
  //
  // It has to be recorded at the blind step because that is what earns the
  // reveal below: the identities and prices are withheld until the server has
  // the viewer's vote, so "reveal on vote" and "record on vote" have to be
  // the same moment. The visible consequence is that community_vote_count
  // now counts someone who votes blind and then walks away.
  const { error } = await sb.from('duel_votes').upsert(
    { user_id: user.id, duel_id: duelId, vote_choice: voteChoice ?? null },
    { onConflict: 'user_id,duel_id' }
  )
  if (error) {
    console.error('[community-vote] insert failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  // The vote is recorded, so this viewer has earned the identities. Same
  // bargain as XDuel's own vote route: unobtainable until you have voted.
  const { data: duel } = await sb.from('duels').select('slots').eq('id', duelId).single()
  return Response.json({ ok: true, slots: duel?.slots ?? null })
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
