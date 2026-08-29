// app/api/xvote/feed/route.ts
// The XVote feed, redacted.
//
// XVote is permanently blind — unlike XDuel it has no reveal step at all, so
// a voter is never meant to learn which models they judged. The page used to
// read `duels` straight from the browser with the Supabase client, and
// `slots` carries provider, model_name, display_name and priceLabel. The UI
// rendered none of them; the Network tab handed over all of them. (Aug 29,
// same class of hole as XDuel's `meta` event.)
//
// So the read moves here and the identity fields never leave the server. The
// only slot fields a card actually draws are the answer and its media flags;
// cost, response time, price and identity were all shipped and none of them
// were used.
//
// Note the search consequence, which is deliberate: the page could filter by
// MODEL NAME, and that cannot be made safe by moving it server-side — a query
// for "gemini" that returns five duels has told you Gemini is in all five,
// which is exactly the fact the blind vote withholds. Prompt search stays;
// model-name search is gone.

export const runtime = 'nodejs'

import { createClient } from '@supabase/supabase-js'

const MODES = new Set(['text', 'image', 'video'])
const RECENT_LIMIT  = 200
const POPULAR_LIMIT = 100

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  )
}

/** Everything a card draws, and nothing that says who wrote it. */
function redact(slots: any): any[] {
  return (Array.isArray(slots) ? slots : []).map((s: any) => ({
    text:    s?.text ?? null,
    isImage: s?.isImage ?? false,
    isVideo: s?.isVideo ?? false,
  }))
}

/** A duel with a failed or empty slot can't be judged fairly. The old
 *  client query meant to drop these but never did — its `.not(...)` calls
 *  were chained after a `return`, so they were unreachable. Done in JS here,
 *  where it is obvious whether it ran. */
function isVotable(d: any): boolean {
  const slots = Array.isArray(d?.slots) ? d.slots : []
  return slots.length > 0 && slots.every((s: any) => typeof s?.text === 'string' && s.text.length > 0)
}

export async function GET(req: Request) {
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const supabaseUser = await createSupabaseServer()
  const { data: { user }, error: authError } = await supabaseUser.auth.getUser()
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const url  = new URL(req.url)
  const mode = MODES.has(url.searchParams.get('mode') ?? '') ? url.searchParams.get('mode')! : 'text'

  const sb = serviceClient()

  // The exclusion list is derived here rather than sent by the client: the
  // server already owns duel_votes, and the old query only excluded when the
  // id list was short enough to fit in a query string.
  const { data: voted } = await sb.from('duel_votes').select('duel_id').eq('user_id', user.id)
  const votedIds = new Set((voted ?? []).map((r: any) => r.duel_id))

  const columns = 'id, mode, prompt, slots, vote2, community_vote_count, created_at'
  const base = () => sb.from('duels').select(columns).eq('mode', mode).is('deleted_at', null)

  // Two windows, merged. blendedOrder on the client weighs recency against
  // popularity, but it can only rank what it is handed — a single created_at
  // window would permanently hide an all-time popular duel that has scrolled
  // past the newest 200, so its votes could never grow further.
  const [recentRes, popularRes] = await Promise.all([
    base().order('created_at', { ascending: false }).limit(RECENT_LIMIT),
    base().order('community_vote_count', { ascending: false })
          .order('created_at', { ascending: false }).limit(POPULAR_LIMIT),
  ])

  let rows: any[] | null = null
  if (recentRes.error) {
    // Fallback for a database that predates community_vote_count/deleted_at.
    const fb = await sb.from('duels')
      .select('id, mode, prompt, slots, vote2, created_at')
      .eq('mode', mode)
      .order('created_at', { ascending: false }).limit(RECENT_LIMIT)
    if (fb.error) return Response.json({ duels: [] })
    rows = (fb.data ?? []).map((d: any) => ({ ...d, community_vote_count: 0 }))
  } else {
    const merged = new Map<string, any>()
    for (const row of [...(recentRes.data ?? []), ...(popularRes.data ?? [])]) merged.set(row.id, row)
    rows = Array.from(merged.values())
  }

  const duels = rows
    .filter(d => !votedIds.has(d.id))
    .filter(isVotable)
    .map(d => ({
      id: d.id, mode: d.mode, prompt: d.prompt,
      vote2: d.vote2 ?? null,
      community_vote_count: d.community_vote_count ?? 0,
      created_at: d.created_at,
      slots: redact(d.slots),
    }))

  return Response.json({ duels })
}
