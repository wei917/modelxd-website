// app/api/xtalk/session/route.ts
// Discussion persistence (owner ask, Aug 6: "we should keep Discussion").
//
// Discussions stay CLIENT-DRIVEN — the room's turn loop, bidding and
// streaming all still live in DiscussionRoom.tsx — this route only makes
// the room durable: a row is created when the room opens, the transcript is
// written through after turns land, and a permalink can load it back.
// Third tenant of xtalk_sessions (game='discussion', no migration needed).
//
// Why not server-held like Werewolf/Gomoku? Those need a referee the
// players can't read. A discussion has no hidden state — the client is
// already the source of truth, so persistence is a mirror, not a move.

export const runtime = 'nodejs'

import { createClient } from '@supabase/supabase-js'

const svc = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false } },
)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// The transcript is user-shaped data heading into a shared table — cap and
// coerce every field so a hostile client can't store a novel per turn.
const MAX_TURNS = 500
const sanitizeTurns = (raw: any): any[] => (Array.isArray(raw) ? raw : []).slice(0, MAX_TURNS).map((t: any) => ({
  speaker: String(t?.speaker ?? '').slice(0, 80),
  isUser: t?.isUser === true,
  text: String(t?.text ?? '').slice(0, 20_000),
  ...(t?.provider ? { provider: String(t.provider).slice(0, 40) } : {}),
  ...(typeof t?.cost === 'number' && isFinite(t.cost) ? { cost: t.cost } : {}),
  ...(typeof t?.bid === 'number' ? { bid: t.bid } : {}),
  ...(typeof t?.credits === 'number' ? { credits: t.credits } : {}),
  ...(t?.error ? { error: String(t.error).slice(0, 200) } : {}),
  // The room player (owner, Aug 13 — YouTube now). videoId feeds an iframe
  // src, so it is coerced to YouTube's exact 11-char id shape or dropped — a
  // hostile client must not be able to store a novel OR an embed of
  // anything that isn't a Spotify track.
  ...(t?.song && typeof t.song === 'object' ? {
    song: {
      videoId: typeof t.song.videoId === 'string' && /^[A-Za-z0-9_-]{11}$/.test(t.song.videoId) ? t.song.videoId : null,
      query: String(t.song.query ?? '').slice(0, 120),
      ...(t.song.name ? { name: String(t.song.name).slice(0, 120) } : {}),
      ...(t.song.artists ? { artists: String(t.song.artists).slice(0, 160) } : {}),

    },
  } : {}),
}))

export async function POST(req: Request) {
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return Response.json({ error: 'Bad JSON' }, { status: 400 }) }
  const id = String(body.id ?? '')
  if (!UUID_RE.test(id)) return Response.json({ error: 'bad id' }, { status: 400 })

  // ── create — the room opened; mint its row under the client's convId so
  // the billing ledger (which already groups by that id) matches 1:1. ──
  if (body.action === 'create') {
    const players = (Array.isArray(body.players) ? body.players : []).slice(0, 8).map((p: any) => ({
      modelId: String(p?.modelId ?? '').slice(0, 60),
      name: String(p?.name ?? '').slice(0, 60),
      provider: String(p?.provider ?? '').slice(0, 40),
      persona: String(p?.persona ?? '').slice(0, 500),
      thinking: typeof p?.thinking === 'string' ? p.thinking.slice(0, 20) : null,
      search: p?.search === true,
    }))
    if (players.length < 2) return Response.json({ error: 'need at least 2 seats' }, { status: 400 })
    const { error } = await svc().from('xtalk_sessions').insert({
      id, user_id: user.id, game: 'discussion', status: 'active',
      human_seat: null, players, phase: 'open', day: 0, turn_order: [],
      transcript: [], pending: {
        flow: ['order', 'bid', 'manual'].includes(body.flow) ? body.flow : 'order',
        rotate: body.rotate !== false,
      },
      title: String(body.title ?? '').slice(0, 140) || null,
    })
    // A retried create may hit its own earlier insert — that's success.
    if (error && error.code !== '23505') {
      console.warn('[xtalk:session] create failed:', error.message)
      return Response.json({ error: 'could not persist the room' }, { status: 503 })
    }
    return Response.json({ ok: true, id })
  }

  // ── everything else acts on an existing owned discussion row ──
  const { data: row } = await svc().from('xtalk_sessions')
    .select('id, user_id, game, title, players, pending, transcript, day, status')
    .eq('id', id).maybeSingle()
  if (!row || row.user_id !== user.id || row.game !== 'discussion') {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  if (body.action === 'sync') {
    // Full replace, not append: the client owns the room state, and a
    // replace is idempotent under retries and out-of-order debounces.
    const turns = sanitizeTurns(body.turns)
    const cost = turns.reduce((s: number, t: any) => s + (typeof t.cost === 'number' ? t.cost : 0), 0)
    await svc().from('xtalk_sessions').update({
      transcript: turns,
      day: Math.max(0, Math.min(9999, Number(body.round) || 0)),
      cost_usd: cost,
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    return Response.json({ ok: true })
  }

  if (body.action === 'load') {
    return Response.json({
      id: row.id, title: row.title, players: row.players,
      pending: row.pending, transcript: row.transcript, day: row.day,
    })
  }

  return Response.json({ error: 'unknown action' }, { status: 400 })
}
