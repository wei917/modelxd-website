// app/api/xsports/room/tick/route.ts — an open room page asks, every ~10 s
// while it is in front, whether the room's AI should speak. The answer comes
// from the room's state and the game (lib/xsports-room-ai.ts nextTrigger);
// one request wins the speaking lock and speaks in after(), the rest return.
// Signed-in viewers only: ModelXD pays for the room's AI, and a signed-out
// script must not be able to make it talk in every room.

export const runtime = 'nodejs'
// A top model at its middle thinking can take a minute and more (Oct 15).
export const maxDuration = 180

import { after } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { xsportsAdmin } from '@/lib/xsports-store'
import { roomKeyOf, roomMissing, type RoomState } from '@/lib/xsports-room'
import { gameFor, nextTrigger, roomSpeak } from '@/lib/xsports-room-ai'

const lastTick = new Map<string, number>()

export async function POST(req: Request) {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ spoke: false, reason: 'signed_out' })
  const body = await req.json().catch(() => ({}))
  const k = roomKeyOf(body?.league, body?.game, body?.lang)
  if (!k) return Response.json({ error: 'bad_room' }, { status: 400 })
  // One tick per viewer per 5 s is plenty (a floor per instance).
  const key = `${user.id}:${k.league}:${k.game}:${k.lang}`
  if (Date.now() - (lastTick.get(key) ?? 0) < 5_000) return Response.json({ spoke: false, reason: 'too_soon' })
  lastTick.set(key, Date.now())
  if (lastTick.size > 5000) lastTick.clear()

  const { data: room, error } = await xsportsAdmin().from('xsports_rooms').select('ai_since, ai_last_at, ai_lulls, ai_busy_until')
    .eq('league', k.league).eq('game_id', k.game).eq('lang', k.lang).maybeSingle()
  if (error) return Response.json({ spoke: false, reason: roomMissing(error) ? 'room_unavailable' : 'error' }, { status: roomMissing(error) ? 503 : 500 })
  if (room?.ai_busy_until && Date.parse(room.ai_busy_until) > Date.now()) return Response.json({ spoke: false, reason: 'busy' })
  const game = await gameFor(k.league, Number(k.game)).catch(() => null)
  if (!game) return Response.json({ spoke: false, reason: 'no_game' })
  const { data: lastHuman } = await xsportsAdmin().from('xsports_room_messages').select('created_at')
    .eq('league', k.league).eq('game_id', k.game).eq('lang', k.lang).eq('kind', 'human')
    .order('id', { ascending: false }).limit(1).maybeSingle()
  const trigger = nextTrigger(game, (room as RoomState | null) ?? null, lastHuman?.created_at ?? null)
  if (!trigger) return Response.json({ spoke: false, reason: 'wait' })
  after(roomSpeak(k, trigger))
  return Response.json({ spoke: true, trigger })
}
