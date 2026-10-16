// app/api/xsports/room/vote/route.ts — a fan's 👍 or 👎 on one of 晴晴's
// pictures or clips (owner, Oct 16: "user can thumb up or down or report?
// so we know which models are better"; supabase/137). Signed in; one vote per
// person per message, changed or taken back (0). Fans never see which model
// made it; the votes count for that model on /admin/traffic.
//   POST { id, vote: 1 | -1 | 0 } → { vote }

export const runtime = 'nodejs'

import { createSupabaseServer } from '@/lib/supabase-server'
import { xsportsAdmin } from '@/lib/xsports-store'
import { isCheer } from '@/lib/xsports-ais'

const fail = (code: string, status: number) => Response.json({ error: code, code }, { status })

export async function POST(req: Request) {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return fail('Unauthorized', 401)
  const body = await req.json().catch(() => ({}))
  const id = Number(body?.id)
  const vote = body?.vote === 1 || body?.vote === -1 || body?.vote === 0 ? (body.vote as 1 | -1 | 0) : null
  if (!Number.isSafeInteger(id) || id <= 0 || vote === null) return fail('bad_vote', 400)
  const admin = xsportsAdmin()
  // Her pictures and clips only.
  const { data: m } = await admin.from('xsports_room_messages').select('id, kind, model_name, media_url').eq('id', id).maybeSingle()
  if (!m || !isCheer(m) || !m.media_url) return fail('not_votable', 400)
  const { error } = vote === 0
    ? await admin.from('xsports_media_votes').delete().eq('message_id', id).eq('user_id', user.id)
    : await admin.from('xsports_media_votes').upsert({ message_id: id, user_id: user.id, vote, created_at: new Date().toISOString() }, { onConflict: 'message_id,user_id' })
  if (error) {
    console.warn('[xsports/vote]', error.message)
    return fail('unavailable', 503)
  }
  return Response.json({ vote })
}
