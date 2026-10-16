// app/api/xsports/cheer/route.ts — an admin asks 晴晴 for something from her
// card in a room (owner, Oct 16: "admins can tap her profile and ask her do
// something? the action can have dance(post dance selfie), 幫某人加油(with
// comic like picture with dialog +name text), or cheer video...etc").
//   POST { league, game, lang, action: 'dance' | 'selfie' | 'cheer' }
//        she posts a dance clip, a selfie or a cheer clip from her reviewed
//        set (lib/xsports-cheer-media), with words of her own, as soon as she
//        has the floor
//   POST { league, game, lang, action: 'shout', name }
//        draws her shouting 「<name> 加油！」 in a comic picture and hands it
//        back ({ picture }) to look at first: nothing unseen reaches a room
//   POST { league, game, lang, action: 'shout', name, picture }
//        posts that picture with her words
// Admins only (ADMIN_EMAILS, lib/admin), checked here: 403 for anyone else.
// Only where she cheers, while her character is public (409). The name is
// checked by OpenAI's moderation (a check that cannot run refuses). ModelXD
// pays; her words and the picture count toward the day's XSports total.

export const runtime = 'nodejs'
// Drawing takes up to a minute; her words wait up to a minute for the floor.
export const maxDuration = 180

import { after } from 'next/server'
import { getAdminUser } from '@/lib/admin'
import { moderate } from '@/lib/moderation'
import { roomKeyOf } from '@/lib/xsports-room'
import { cheersIn } from '@/lib/xsports-ais'
import { CHEER_ACTIONS, shoutName } from '@/lib/xsports-cheer-media'
import { cheerFace, drawShout, isShoutPicture, roomCheer } from '@/lib/xsports-cheer'

const fail = (code: string, status: number) => Response.json({ error: code, code }, { status })

export async function POST(req: Request) {
  if (!(await getAdminUser())) return fail('forbidden', 403)
  const body = await req.json().catch(() => ({}))
  const k = roomKeyOf(body?.league, body?.game, body?.lang)
  if (!k) return fail('bad_room', 400)
  const action = CHEER_ACTIONS.find(a => a === body?.action)
  if (!action) return fail('bad_action', 400)
  if (!cheersIn(k) || !(await cheerFace().catch(() => null))) return fail('not_here', 409)

  if (action !== 'shout') {
    after(roomCheer(k, { trigger: 'admin', action }))
    return Response.json({ ok: true })
  }

  const name = shoutName(body?.name)
  if (!name) return fail('bad_name', 400)
  const verdict = await moderate({ text: name })
  if (verdict === 'refused') return fail('name_refused', 422)
  if (verdict === 'unavailable') return fail('check_unavailable', 503)
  if (body?.picture !== undefined) {
    if (!isShoutPicture(body.picture)) return fail('bad_picture', 400)
    after(roomCheer(k, { trigger: 'admin', action, name, picture: body.picture }))
    return Response.json({ ok: true })
  }
  try {
    return Response.json({ picture: await drawShout(k, name) })
  } catch (e: any) {
    console.warn('[xsports/cheer] draw', k.league, k.game, e?.message ?? e)
    return fail('draw_failed', 502)
  }
}
