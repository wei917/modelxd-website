// app/api/xcut/projects/[id]/route.ts — one XCut project: read (with fresh
// signed URLs on every clip), save the timeline, soft-delete.

export const runtime = 'nodejs'

import { createSupabaseServer } from '@/lib/supabase-server'
import { cleanTimeline, totalDuration } from '@/lib/xcut-timeline'
import { signTimeline } from '@/lib/xcut-media'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COLS = 'id, title, source_board_id, timeline, duration_s, render, created_at, updated_at'

async function ctx(params: Promise<{ id: string }>) {
  const { id } = await params
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  return { id, sb, user }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id, sb, user } = await ctx(params)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!UUID.test(id)) return Response.json({ error: 'Bad id' }, { status: 400 })
  const { data, error } = await sb.from('xcut_projects').select(COLS).eq('id', id).is('deleted_at', null).maybeSingle()
  if (error) return Response.json({ error: error.message }, { status: 503 })
  if (!data) return Response.json({ error: 'Not found' }, { status: 404 })
  const tl = cleanTimeline(data.timeline)
  return Response.json({ project: { ...data, timeline: tl ? await signTimeline(sb, tl) : null } })
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id, sb, user } = await ctx(params)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!UUID.test(id)) return Response.json({ error: 'Bad id' }, { status: 400 })
  const body = await req.json().catch(() => ({}))
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof body?.title === 'string') patch.title = body.title.slice(0, 120)
  if (body?.timeline !== undefined) {
    const tl = cleanTimeline(body.timeline)
    if (!tl) return Response.json({ error: 'Invalid timeline' }, { status: 400 })
    if (JSON.stringify(tl).length > 400_000) return Response.json({ error: 'Timeline too large' }, { status: 413 })
    // Signed URLs are transient — never persist them.
    patch.timeline = { ...tl, video: tl.video.map(c => ({ ...c, src: { ...c.src, url: undefined } })), audio: tl.audio.map(c => ({ ...c, src: { ...c.src, url: undefined } })) }
    patch.duration_s = totalDuration(tl)
  }
  const { data, error } = await sb.from('xcut_projects').update(patch).eq('id', id).is('deleted_at', null).select('id, updated_at, duration_s').maybeSingle()
  if (error) return Response.json({ error: error.message }, { status: 503 })
  if (!data) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json({ ok: true, ...data })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id, sb, user } = await ctx(params)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!UUID.test(id)) return Response.json({ error: 'Bad id' }, { status: 400 })
  const { error } = await sb.from('xcut_projects').update({ deleted_at: new Date().toISOString() }).eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 503 })
  return Response.json({ ok: true })
}
