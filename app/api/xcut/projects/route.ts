// app/api/xcut/projects/route.ts — XCut projects: list mine, create one
// (blank, or the ROUGH CUT of an XDirect board: scenes in strip order, each
// shot scene trimmed to its card, unshot scenes held on their key still,
// subtitles from the scripts). RLS through the user's own session; the
// board read uses the service client with the same owner check as
// /api/xdirector/conversation.

export const runtime = 'nodejs'

import { createClient } from '@supabase/supabase-js'
import { createSupabaseServer } from '@/lib/supabase-server'
import { timelineFromStoryboard, emptyTimeline, totalDuration, cleanTimeline, type SceneSource, type StoryboardScene } from '@/lib/xcut-timeline'
import { parseStorageUrl, signTimeline } from '@/lib/xcut-media'

const LOG = '[xcut]'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const serviceClient = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } })
const notSetUp = (msg: string) => /xcut_projects/.test(msg) ? 'XCut storage is not set up yet (run supabase/83_xcut.sql).' : msg

export async function GET() {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { data, error } = await sb.from('xcut_projects')
    .select('id, title, source_board_id, duration_s, render, created_at, updated_at')
    .is('deleted_at', null).order('updated_at', { ascending: false }).limit(100)
  if (error) return Response.json({ error: notSetUp(error.message) }, { status: 503 })
  return Response.json({ projects: data ?? [] })
}

export async function POST(req: Request) {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const aspect = ['16:9', '9:16', '1:1'].includes(body?.aspect) ? body.aspect : '16:9'
  let title: string | null = typeof body?.title === 'string' ? body.title.slice(0, 120) : null
  let timeline = emptyTimeline(aspect)
  let sourceBoard: string | null = null

  const board = typeof body?.from?.board === 'string' ? body.from.board : null
  if (board) {
    if (!UUID.test(board)) return Response.json({ error: 'Bad board id' }, { status: 400 })
    const { data: conv } = await serviceClient().from('xdirector_conversations')
      .select('id, user_id, title, storyboard, deleted_at').eq('id', board).maybeSingle()
    if (!conv || conv.user_id !== user.id || conv.deleted_at) return Response.json({ error: 'Board not found' }, { status: 404 })
    const scenes: StoryboardScene[] = Array.isArray(conv.storyboard) ? conv.storyboard : []
    // Resolve each scene's clip / key still from the signed URLs the board
    // stored — the PATH is what matters; the signature is re-made on read.
    const sources: Record<string, SceneSource> = {}
    for (const s of scenes) {
      if (s.asset) continue
      const v = parseStorageUrl(s.url), st = parseStorageUrl(s.still_url)
      const src: SceneSource = {}
      if (v) src.video = { ...v, mediaType: 'video/mp4', rowId: s.row_id }
      if (st) src.still = { ...st, mediaType: /\.jpe?g$/i.test(st.path) ? 'image/jpeg' : 'image/png', rowId: s.still_row_id }
      if (src.video || src.still) sources[s.id] = src
    }
    timeline = timelineFromStoryboard(scenes, sources, { aspect })
    title = title ?? (typeof conv.title === 'string' && conv.title ? conv.title.slice(0, 120) : null)
    sourceBoard = conv.id
  } else if (body?.timeline) {
    timeline = cleanTimeline(body.timeline) ?? timeline
  }

  const row = { user_id: user.id, title, source_board_id: sourceBoard, timeline, duration_s: totalDuration(timeline) }
  const { data, error } = await sb.from('xcut_projects').insert(row).select('id, title, source_board_id, timeline, duration_s, render, created_at, updated_at').single()
  if (error) {
    console.error(`${LOG} create failed:`, error.message)
    return Response.json({ error: notSetUp(error.message) }, { status: 503 })
  }
  console.log(`${LOG} project ${data.id} created for ${user.id}${sourceBoard ? ` from board ${sourceBoard}` : ''}: ${timeline.video.length} clip(s), ${totalDuration(timeline).toFixed(1)}s`)
  return Response.json({ project: { ...data, timeline: await signTimeline(sb, data.timeline) } })
}
