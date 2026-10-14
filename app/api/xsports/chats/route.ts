// app/api/xsports/chats/route.ts — the caller's X體育 chats (supabase/130).
//   GET  ?league=mlb&game=849820   their chats for one game, newest first
//   GET                            their recent chats
//   POST { league, game }          a new chat for a game; the title is the
//                                  matchup, read from the feed, never sent
//   DELETE ?league=mlb&game=849820 every one of the caller's chats for that
//                                  game (清除對話; one chat per game since
//                                  Oct 14)

import { createSupabaseServer } from '@/lib/supabase-server'
import { createChat, deleteChatsFor, listChats } from '@/lib/xsports-store'
import { getGame, isGamePk } from '@/lib/mlb'
import { getNbaGame, isNbaId } from '@/lib/nba'

export const runtime = 'nodejs'

const LEAGUES = new Set(['mlb', 'nba'])

export async function GET(req: Request) {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const q = new URL(req.url).searchParams
  const league = q.get('league') ?? undefined
  const game = q.get('game') ?? undefined
  if (league && !LEAGUES.has(league)) return Response.json({ error: 'bad league' }, { status: 400 })
  if (game && !/^[0-9A-Za-z_-]{1,32}$/.test(game)) return Response.json({ error: 'bad game' }, { status: 400 })
  try {
    return Response.json({ chats: await listChats(user.id, { league, gameId: game, limit: 30 }) })
  } catch (e: any) {
    console.warn('[xsports/chats] list', e?.message ?? e)
    return Response.json({ error: 'chats unavailable' }, { status: 503 })
  }
}

export async function POST(req: Request) {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const league = typeof body?.league === 'string' ? body.league : 'mlb'
  if (!LEAGUES.has(league)) return Response.json({ error: 'bad league' }, { status: 400 })
  if (!(league === 'nba' ? isNbaId(body?.game) : isGamePk(body?.game))) return Response.json({ error: 'bad game' }, { status: 400 })
  let title: string | null = null
  try {
    const g = league === 'nba' ? await getNbaGame(Number(body.game)) : await getGame(Number(body.game))
    title = `${g.away.abbr} @ ${g.home.abbr}${g.series ? ` ${g.series}` : ''}`
  } catch { /* the feed is down: an untitled chat is still a chat */ }
  try {
    const chat = await createChat(user.id, league, String(body.game), title)
    return Response.json({ chat })
  } catch (e: any) {
    console.warn('[xsports/chats] create', e?.message ?? e)
    return Response.json({ error: 'could not create the chat' }, { status: 503 })
  }
}

export async function DELETE(req: Request) {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const q = new URL(req.url).searchParams
  const league = q.get('league') ?? ''
  const game = q.get('game') ?? ''
  if (!LEAGUES.has(league)) return Response.json({ error: 'bad league' }, { status: 400 })
  if (!(league === 'nba' ? isNbaId(game) : isGamePk(game))) return Response.json({ error: 'bad game' }, { status: 400 })
  try {
    return Response.json({ deleted: await deleteChatsFor(user.id, league, game) })
  } catch (e: any) {
    console.warn('[xsports/chats] clear', e?.message ?? e)
    return Response.json({ error: 'could not clear' }, { status: 503 })
  }
}
