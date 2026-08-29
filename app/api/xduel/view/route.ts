// app/api/xduel/view/route.ts
// One duel, for the permalink page — redacted until the viewer has voted.
//
// The page used to read the row itself with the browser client
// (`sb.from('duels').select('*')`), which handed every visitor the model
// names and prices that the five-step flow exists to withhold. XVote sends
// people here, so redacting the XVote feed while this stayed open would have
// been a fix in name only. (Aug 29, same class as XDuel's `meta` event.)
//
// Who sees what:
//   * signed in, hasn't voted  → redacted. The reveal comes back from the
//     vote itself (see ../community-vote and ../vote).
//   * signed in, has voted     → full row.
//   * signed out               → full row, because a shared permalink is a
//     RESULT, and a link whose point is "look what these models did" cannot
//     withhold the models. Signed-out visitors cannot vote at all (both vote
//     routes 401), so nothing they see can reach XDRating.
//
// The residual, stated plainly: someone can open a permalink signed out,
// read the identities, then sign in and vote. Closing that would mean making
// shared links useless to anyone without an account. It buys them one vote.

export const runtime = 'nodejs'

import { createClient } from '@supabase/supabase-js'

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  )
}

/** What a card draws before the reveal. Identity, price and this run's spend
 *  are all withheld; the answer, its media flags and how long it took are
 *  what the blind comparison is actually about. */
export function redactSlots(slots: any): any[] {
  return (Array.isArray(slots) ? slots : []).map((s: any) => ({
    text:         s?.text ?? null,
    isImage:      s?.isImage ?? false,
    isVideo:      s?.isVideo ?? false,
    responseTime: s?.responseTime ?? 0,
    searches:     s?.searches ?? 0,
  }))
}

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return Response.json({ error: 'Missing id' }, { status: 400 })

  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const supabaseUser = await createSupabaseServer()
  const { data: { user } } = await supabaseUser.auth.getUser()

  const sb = serviceClient()
  const { data: duel, error } = await sb.from('duels').select('*').eq('id', id).single()
  if (error || !duel) return Response.json({ error: 'Not found' }, { status: 404 })

  let revealed = false
  if (!user) {
    revealed = true                                             // read-only visitor
  } else if (duel.user_id === user.id) {
    revealed = duel.vote1 != null                               // their own duel, already judged
  } else {
    const { data: v } = await sb.from('duel_votes')
      .select('id').eq('user_id', user.id).eq('duel_id', id).maybeSingle()
    revealed = !!v
  }

  return Response.json({
    revealed,
    canVote: !!user,
    duel: {
      id:          duel.id,
      mode:        duel.mode,
      prompt:      duel.prompt,
      input_media: duel.input_media ?? null,
      created_at:  duel.created_at,
      user_id:     duel.user_id,
      // Slot INDICES, not model ids — the owner's own choices are part of
      // the page, but `vote1_model_id` would name a model outright.
      vote1:       duel.vote1 ?? null,
      vote2:       duel.vote2 ?? null,
      slots:       revealed ? duel.slots : redactSlots(duel.slots),
    },
  })
}
