// app/api/xduel/feed/route.ts
// The vote feed under XDuel's composer (app/xduel/VoteFeed.tsx), redacted.
// It was XVote's feed (/api/xvote/feed) until XVote folded into XDuel on
// Oct 17.
//
// The feed is permanently blind — unlike a duel you ran, it has no reveal
// step at all, so
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
import { DUEL_MODELS } from '@/lib/duel-allowance'
import { isVideoRecipe, recipeOfDuel } from '@/lib/xduel-recipes'
import { signAudioDuels } from '@/lib/xduel-audio'

const MODES = new Set(['text', 'image', 'video', 'audio'])
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
    ...(s?.isAudio ? { isAudio: true } : {}),
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
  // Video: the chosen kind's duels only (owner, Oct 19: "feed follows the chip").
  const recipe = mode === 'video' && isVideoRecipe(url.searchParams.get('recipe')) ? url.searchParams.get('recipe') : null

  const sb = serviceClient()

  // The exclusion list is derived here rather than sent by the client: the
  // server already owns duel_votes, and the old query only excluded when the
  // id list was short enough to fit in a query string.
  const { data: voted } = await sb.from('duel_votes').select('duel_id').eq('user_id', user.id)
  const votedIds = new Set((voted ?? []).map((r: any) => r.duel_id))

  // `lang` (migration 141) and `recipe` (142) are read when the columns
  // exist, so the feed works on either side of them.
  const columns = 'id, mode, prompt, slots, vote2, community_vote_count, created_at, input_media'
  const optional = ['lang', 'recipe']
  const base = () => { const cols: string = [columns, ...optional].join(', '); return sb.from('duels').select(cols).eq('mode', mode).is('deleted_at', null) }

  // Two windows, merged. blendedOrder on the client weighs recency against
  // popularity, but it can only rank what it is handed — a single created_at
  // window would permanently hide an all-time popular duel that has scrolled
  // past the newest 200, so its votes could never grow further.
  const read = () => Promise.all([
    base().order('created_at', { ascending: false }).limit(RECENT_LIMIT),
    base().order('community_vote_count', { ascending: false })
          .order('created_at', { ascending: false }).limit(POPULAR_LIMIT),
  ])
  let [recentRes, popularRes] = await read()
  for (let i = 0; recentRes.error && i < 2; i++) {
    const missing = optional.find(c => recentRes.error!.message.includes(`.${c}`))
    if (!missing) break
    optional.splice(optional.indexOf(missing), 1)
    ;[recentRes, popularRes] = await read()
  }

  let rows: any[] | null = null
  if (recentRes.error) {
    // Fallback for a database that predates community_vote_count/deleted_at.
    const fb = await sb.from('duels')
      .select('id, mode, prompt, slots, vote2, created_at, input_media')
      .eq('mode', mode)
      .order('created_at', { ascending: false }).limit(RECENT_LIMIT)
    if (fb.error) return Response.json({ duels: [] })
    rows = (fb.data ?? []).map((d: any) => ({ ...d, community_vote_count: 0 }))
  } else {
    const merged = new Map<string, any>()
    for (const row of [...(recentRes.data ?? []), ...(popularRes.data ?? [])] as any[]) merged.set(row.id, row)
    rows = Array.from(merged.values())
  }

  const duels = rows
    .filter(d => !votedIds.has(d.id))
    .filter(isVotable)
    // 1v1 only (owner, Oct 18): the 3- and 4-model duels from before stay
    // in the database and on their links, but take no more votes here.
    .filter(d => Array.isArray(d.slots) && d.slots.length === DUEL_MODELS)
    .filter(d => !recipe || recipeOfDuel(d) === recipe)
    .map(d => ({
      id: d.id, mode: d.mode, prompt: d.prompt,
      vote2: d.vote2 ?? null,
      community_vote_count: d.community_vote_count ?? 0,
      created_at: d.created_at,
      input_media: d.input_media ?? null,
      lang: d.lang ?? null,
      slots: d.slots,
    }))
  // Speech files: fresh links, one signing call for the whole feed.
  const signed = await signAudioDuels(duels.map(d => Array.isArray(d.slots) ? d.slots : []))
  return Response.json({ duels: duels.map((d, i) => ({ ...d, slots: redact(signed[i]) })) })
}
