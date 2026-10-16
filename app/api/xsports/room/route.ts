// app/api/xsports/room/route.ts — a game's live room (supabase/131).
//   GET  ?league=&game=&lang=[&before=<id>]   80 of the room's visible messages
//        (the newest, or those older than <id>; more: whether older ones
//        exist) (anyone), and `mine`: the ids of those the caller wrote
//        (signed in), so the page can offer 刪除; with the newest page,
//        `votes`: the caller's 👍 (1) / 👎 (-1) on 晴晴's pictures and clips
//        among them (supabase/137; app/api/xsports/room/vote); with the
//        newest page, `ais`: the room's two commentators now (its @ list),
//        `cheer`: 晴晴 where she cheers (lib/xsports-cheer), else null, and
//        `admin`:
//        whether the caller is an admin (her card then offers her actions,
//        app/api/xsports/cheer, which checks again)
//   POST { league, game, lang, content, confirmName? }
//        a fan's message: signed in, name confirmed once (409
//        name_unconfirmed carries the name, @ID and picture to confirm), not
//        muted, at most one every 2 s, checked by OpenAI's moderation (a
//        check that cannot run refuses, like the profile name). The name,
//        @ID (supabase/132) and picture are copied in. "@AI" asks the
//        room's commentators (whoever's turn it is), "@Opus", "@Gemini"...
//        one of the room's two (lib/xsports-ais), each named one in turn.

export const runtime = 'nodejs'
// A fan naming both commentators, each perhaps asking the other: up to four
// answers one after another in `after`, each waiting for the floor; a top
// model at its middle thinking, searching, can take a minute and more each
// (Oct 15).
export const maxDuration = 300

import { after } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { isAdminEmail } from '@/lib/admin'
import { moderate } from '@/lib/moderation'
import { userName, userPhoto } from '@/lib/user-face'
import { ensureHandle } from '@/lib/profile-handle'
import { xsportsAdmin } from '@/lib/xsports-store'
import { addRoomMessage, confirmName, member, ownIds, ownVotes, recentMessages, roomKeyOf, roomMissing, secondsSinceLast, MESSAGE_MAX } from '@/lib/xsports-room'
import { askedAis, asksCheer, cheersIn, isCheer } from '@/lib/xsports-ais'
import { cheerFace, roomCheer } from '@/lib/xsports-cheer'
import { roomPair, roomSpeak } from '@/lib/xsports-room-ai'

const PAGE = 80
const fail = (code: string, status: number, extra: object = {}) => Response.json({ error: code, code, ...extra }, { status })

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams
  const k = roomKeyOf(q.get('league'), q.get('game'), q.get('lang'))
  if (!k) return fail('bad_room', 400)
  try {
    // A page of 80: the newest, or with ?before=<id> the ones older than it.
    const b = q.get('before')
    const before = b && /^\d{1,12}$/.test(b) ? Number(b) : undefined
    const messages = await recentMessages(k, PAGE, before)
    // Which of them are the caller's (user ids never leave the server).
    let mine: number[] = []
    const sb = await createSupabaseServer()
    const { data: { user } } = await sb.auth.getUser()
    if (user) mine = await ownIds(user.id, messages.filter(m => m.kind === 'human').map(m => m.id)).catch(() => [])
    // Their votes on her pictures and clips here.
    const votes = user ? await ownVotes(user.id, messages.filter(m => isCheer(m) && m.media_url).map(m => m.id)).catch(() => ({})) : {}
    // The room's two commentators now, with the newest page (the @ list).
    const ais = before ? undefined : (await roomPair(k).catch(() => null))?.pair
    // And the room's cheerleader, where she cheers (her name, @ and photo).
    const cheer = before ? undefined : cheersIn(k) ? await cheerFace().catch(() => null) : null
    const admin = before ? undefined : isAdminEmail(user?.email)
    return Response.json({ messages, mine, votes, more: messages.length === PAGE, ais, cheer, admin })
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
  // Before the first message the person sees and confirms the name strangers
  // will see (owner, Oct 13: "we need users to set their display name"); it
  // may be their sign-in name (Oct 14: "the display name can be the same as
  // sign in name": a rule that it differ made the panel reopen forever).

  try {
    const m = await member(user.id)
    if (!m.confirmed) {
      if (body?.confirmName !== true) return fail('name_unconfirmed', 409, { name, avatar, handle: id?.handle ?? null, nextChangeAt: id?.nextChangeAt ?? null })
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
  // A fan asked the commentators: whoever's turn it is (@AI), or each of
  // the room's two that is named, in order, when it can take the floor.
  const asked = /[@＠]/.test(content) ? askedAis(content, (await roomPair(k)).pair) : []
  // @晴晴: the room's cheerleader answers first (lib/xsports-cheer).
  const cheer = cheersIn(k) && asksCheer(content) && !!(await cheerFace())
  if (asked.length || cheer) {
    after((async () => {
      if (cheer) await roomCheer(k, { trigger: 'user', asker: { name, text: content, id: message.id } })
      for (const who of asked) await roomSpeak(k, 'user', { asker: { name, text: content, id: message.id }, wait: true, who: who === 'any' ? undefined : who })
    })())
  }
  return Response.json({ message })
}
