// app/api/xsports/room/route.ts — a game's live room (supabase/131).
//   GET  ?league=&game=&lang=   the room's latest visible messages (anyone),
//                               and `mine`: the ids of those the caller wrote
//                               (signed in), so the page can offer 刪除
//   POST { league, game, lang, content, confirmName? }
//        a fan's message: signed in, name confirmed once (409
//        name_unconfirmed carries the name, @ID and picture to confirm), not
//        muted, at most one every 2 s, checked by OpenAI's moderation (a
//        check that cannot run refuses, like the profile name). The name,
//        @ID (supabase/132) and picture are copied in. "@AI" asks the
//        room's commentators (whoever's turn it is), "@Luna" / "@Qwen" one
//        of them (lib/xsports-ais), each named one in turn.

export const runtime = 'nodejs'
// A fan naming both commentators, each perhaps asking the other: up to four
// answers one after another in `after`, each waiting for the floor.
export const maxDuration = 120

import { after } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { moderate } from '@/lib/moderation'
import { userName, userPhoto } from '@/lib/user-face'
import { ensureHandle } from '@/lib/profile-handle'
import { xsportsAdmin } from '@/lib/xsports-store'
import { addRoomMessage, confirmName, member, ownIds, recentMessages, roomKeyOf, roomMissing, secondsSinceLast, MESSAGE_MAX } from '@/lib/xsports-room'
import { askedAis } from '@/lib/xsports-ais'
import { roomSpeak } from '@/lib/xsports-room-ai'

const fail = (code: string, status: number, extra: object = {}) => Response.json({ error: code, code, ...extra }, { status })

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams
  const k = roomKeyOf(q.get('league'), q.get('game'), q.get('lang'))
  if (!k) return fail('bad_room', 400)
  try {
    const messages = await recentMessages(k, 80)
    // Which of them are the caller's (user ids never leave the server).
    let mine: number[] = []
    const sb = await createSupabaseServer()
    const { data: { user } } = await sb.auth.getUser()
    if (user) mine = await ownIds(user.id, messages.filter(m => m.kind === 'human').map(m => m.id)).catch(() => [])
    return Response.json({ messages, mine })
  } catch (e: any) {
    if (roomMissing(e)) return fail('room_unavailable', 503)
    console.warn('[xsports/room] read', e?.message ?? e)
    return fail('room_unavailable', 503)
  }
}

export async function POST(req: Request) {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return fail('Unauthorized', 401)
  const body = await req.json().catch(() => ({}))
  const k = roomKeyOf(body?.league, body?.game, body?.lang)
  if (!k) return fail('bad_room', 400)
  const content = typeof body?.content === 'string' ? body.content.replace(/\s+$/g, '').trim().slice(0, MESSAGE_MAX) : ''
  if (!content) return fail('empty', 400)

  // The name and picture other people will see (profiles, written only by
  // /api/profile/face), falling back to the sign-in's own.
  const [{ data: prof }, id] = await Promise.all([
    xsportsAdmin().from('profiles').select('display_name, avatar_url').eq('id', user.id).maybeSingle(),
    ensureHandle(user.id),
  ])
  const name = (prof?.display_name || userName(user as any) || 'Fan').slice(0, 60)
  const avatar = prof?.avatar_url || userPhoto(user as any) || null
  // A name the person chose, not the one copied from their sign-in (owner,
  // Oct 13: "we need users to set their display name"): sign-in names are
  // often real full names, and a room shows the name to strangers.
  const signinName = (userName(user as any) ?? '').trim()
  const chosen = !!prof?.display_name && prof.display_name.trim() !== signinName

  try {
    const m = await member(user.id)
    if (!m.confirmed) {
      if (body?.confirmName !== true || !chosen) return fail('name_unconfirmed', 409, { name: chosen ? name : '', avatar, chosen, handle: id?.handle ?? null, nextChangeAt: id?.nextChangeAt ?? null })
      await confirmName(user.id)
    }
    if (m.mutedUntil && Date.parse(m.mutedUntil) > Date.now()) return fail('muted', 403)
    const since = await secondsSinceLast(user.id)
    if (since !== null && since < 2) return fail('too_fast', 429)
  } catch (e: any) {
    if (roomMissing(e)) return fail('room_unavailable', 503)
    throw e
  }

  const verdict = await moderate({ text: content })
  if (verdict === 'refused') return fail('refused', 422)
  if (verdict === 'unavailable') return fail('check_unavailable', 503)

  const message = await addRoomMessage(k, { kind: 'human', user_id: user.id, author_name: name, author_handle: id?.handle ?? null, author_avatar: avatar, content })
  // A fan asked the commentators: whoever's turn it is (@AI), or each one
  // named, in order, when it can take the floor.
  const asked = askedAis(content)
  if (asked.length) {
    after((async () => {
      for (const who of asked) await roomSpeak(k, 'user', { asker: { name, text: content, id: message.id }, wait: true, who: who === 'any' ? undefined : who })
    })())
  }
  return Response.json({ message })
}
