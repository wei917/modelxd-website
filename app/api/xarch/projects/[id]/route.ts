// app/api/xarch/projects/[id]/route.ts — one project: read, undo/rename, delete.

export const runtime = 'nodejs'

import { service } from '@/lib/xarch-ai'
import { owned, view } from '../../_shared'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const o = await owned((await params).id)
  if (o instanceof Response) return o
  return Response.json({ project: await view(o.row) })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const o = await owned((await params).id)
  if (o instanceof Response) return o
  const body = await req.json().catch(() => ({}))
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body?.undo) {
    const history = Array.isArray(o.row.history) ? [...o.row.history] : []
    const prev = history.pop()
    if (!prev) return Response.json({ error: 'Nothing to undo' }, { status: 400 })
    patch.plan = prev; patch.history = history
  }
  if (typeof body?.title === 'string' && body.title.trim()) patch.title = body.title.trim().slice(0, 120)
  const { data } = await service().from('xarch_projects').update(patch).eq('id', o.row.id).select('*').single()
  return Response.json({ project: await view(data ?? o.row) })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const o = await owned((await params).id)
  if (o instanceof Response) return o
  await service().from('xarch_projects').update({ deleted_at: new Date().toISOString() }).eq('id', o.row.id)
  return Response.json({ ok: true })
}
