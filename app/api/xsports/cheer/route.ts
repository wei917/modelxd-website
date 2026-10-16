// app/api/xsports/cheer/route.ts — an admin asks 晴晴 for something from her
// card in a room (owner, Oct 16: "admins can tap her profile and ask her do
// something? the action can have dance(post dance selfie), 幫某人加油(with
// comic like picture with dialog +name text), or cheer video...etc"; "fresh
// each time"): made new each time, seen by the admin, then posted.
//   POST { league, game, lang, action, name?, seconds?, video? } → { draft }
//        starts making it (lib/xsports-cheer-fresh): a selfie or a 加油
//        photo in about ten seconds; a dance, a cheer, or a 加油 asked as a
//        `video`, a clip of `seconds` (3 or 5, default 5) in one to two
//        minutes
//   GET  ?draft=<id>                  → { status, url?, kind?, model?, ms?, usd? }
//        working, done (with the picture or clip to look at, and for the
//        admin which model made it, how long it took, what it cost), or
//        failed
//   POST { league, game, lang, action, name?, draft } → { ok }
//        posts it with her words, as soon as she has the floor
// action: 'selfie' | 'dance' | 'cheer' | 'shout' (a 加油 takes a name,
// checked by OpenAI's moderation; a check that cannot run refuses).
// Admins only (ADMIN_EMAILS, lib/admin), checked here: 403 for anyone else.
// Only where she cheers, while her character is public (409). The models
// are drawn from lists in a JSON file (lib/xsports-cheer-models); every ask
// is a row of xsports_cheer_jobs (supabase/137; 503 not_set_up before it
// runs). ModelXD pays; each call counts toward the day's XSports total.

export const runtime = 'nodejs'
// A clip is made in `after`: a picture, about two minutes of HappyHorse, a
// re-encode (ffmpeg-static, traced in next.config.js).
export const maxDuration = 800

import { after } from 'next/server'
import { getAdminUser } from '@/lib/admin'
import { moderate } from '@/lib/moderation'
import { roomKeyOf } from '@/lib/xsports-room'
import { cheersIn } from '@/lib/xsports-ais'
import { CHEER_ACTIONS, clipSeconds, shoutName } from '@/lib/xsports-cheer-media'
import { cheerFace, roomCheer } from '@/lib/xsports-cheer'
import { freshPosted, freshStatus, isFreshId, makeFresh, newFreshId, startFresh } from '@/lib/xsports-cheer-fresh'
import { modelLabel } from '@/lib/xsports-cheer-models'

const fail = (code: string, status: number) => Response.json({ error: code, code }, { status })

export async function GET(req: Request) {
  if (!(await getAdminUser())) return fail('forbidden', 403)
  const id = new URL(req.url).searchParams.get('draft')
  if (!isFreshId(id)) return fail('bad_draft', 400)
  try {
    const st = await freshStatus(id)
    return Response.json(st.status === 'done' ? { ...st, label: await modelLabel(st.model).catch(() => null) } : st)
  } catch (e: any) {
    console.warn('[xsports/cheer] status', e?.message ?? e)
    return fail('unavailable', 503)
  }
}

export async function POST(req: Request) {
  const admin = await getAdminUser()
  if (!admin) return fail('forbidden', 403)
  const body = await req.json().catch(() => ({}))
  const k = roomKeyOf(body?.league, body?.game, body?.lang)
  if (!k) return fail('bad_room', 400)
  const action = CHEER_ACTIONS.find(a => a === body?.action)
  if (!action) return fail('bad_action', 400)
  if (!cheersIn(k) || !(await cheerFace().catch(() => null))) return fail('not_here', 409)

  let name: string | undefined
  if (action === 'shout') {
    name = shoutName(body?.name)
    if (!name) return fail('bad_name', 400)
    const verdict = await moderate({ text: name })
    if (verdict === 'refused') return fail('name_refused', 422)
    if (verdict === 'unavailable') return fail('check_unavailable', 503)
  }

  // Post what the admin saw: only a finished job's own file.
  if (body?.draft !== undefined) {
    if (!isFreshId(body.draft)) return fail('bad_draft', 400)
    const st = await freshStatus(body.draft).catch(() => null)
    if (st?.status !== 'done') return fail('not_ready', 409)
    const draft = body.draft
    after((async () => {
      const posted = await roomCheer(k, { trigger: 'admin', action, name, media: { url: st.url, kind: st.kind } })
      if (posted) await freshPosted(draft, posted.id)
    })())
    return Response.json({ ok: true })
  }

  const draft = newFreshId()
  const o = { seconds: clipSeconds(body?.seconds), video: action === 'shout' && body?.video === true }
  try {
    await startFresh(k, draft, { action, name, ...o, adminId: admin.id })
  } catch (e: any) {
    console.warn('[xsports/cheer] start', e?.message ?? e)
    return fail('not_set_up', 503)
  }
  after(makeFresh(k, draft, action, name, o))
  return Response.json({ draft })
}
