// app/api/xworld/[id]/route.ts — one XWorld item: poll (GET) or remove (DELETE).
// A pending row is refreshed from its provider on every GET, and the first
// terminal poll settles billing (lib/worldlabs.ts refreshWorld, lib/tripo.ts
// reconcile). Tripo's output URLs are signed, expiring and carry no CORS
// header, so an object's GLB and preview are never handed out — the client
// loads them through ./model, which fetches a fresh link each time.

export const runtime = 'nodejs'

import { createSupabaseServer } from '@/lib/supabase-server'
import { refreshWorld, service } from '@/lib/worldlabs'
import { tripoGet, reconcile } from '@/lib/tripo'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TRIPO_DONE = new Set(['success', 'failed', 'cancelled', 'banned', 'expired'])

async function owned(id: string) {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return { res: Response.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!UUID.test(id)) return { res: Response.json({ error: 'Not found' }, { status: 404 }) }
  const { data: row } = await service().from('xworlds').select('*')
    .eq('id', id).eq('user_id', user.id).is('deleted_at', null).maybeSingle()
  if (!row) return { res: Response.json({ error: 'Not found' }, { status: 404 }) }
  return { row, userId: user.id }
}

async function refreshObject(row: any, userId: string) {
  if (row.status !== 'pending') return row
  const { status, json } = await tripoGet(`/tasks/${encodeURIComponent(row.task_id)}`)
  if (status !== 200) return row
  const task = json?.data ?? {}
  const st = String(task.status ?? '')
  if (!TRIPO_DONE.has(st)) return { ...row, progress: Number(task.progress ?? 0) }
  const settled = await reconcile(userId, row.task_id, task)
  const failed = st !== 'success'
  const { data } = await service().from('xworlds').update({
    status: failed ? 'failed' : 'done', progress: 100, reconciled: true,
    error: failed ? `3D object ${st}` : null,
    ...(settled !== null ? { billed_cents: settled } : {}),
    updated_at: new Date().toISOString(),
  }).eq('id', row.id).eq('status', 'pending').select('*').maybeSingle()
  return data ?? { ...row, status: failed ? 'failed' : 'done' }
}

function view(row: any) {
  const a = row.assets ?? {}
  return {
    id: row.id, kind: row.kind, provider: row.provider, model: row.model, prompt: row.prompt,
    status: row.status, progress: row.progress ?? null, progress_text: row.progress_text ?? null,
    caption: row.caption, error: row.error, billed_cents: row.billed_cents, created_at: row.created_at,
    thumbnail_url: row.kind === 'object' ? (row.status === 'done' ? `/api/xworld/${row.id}/model?asset=preview` : null) : row.thumbnail_url,
    world: row.kind === 'world' && row.status === 'done' ? {
      spz: a.splats?.spz_urls ?? null,
      metadata: a.splats?.semantics_metadata ?? null,
      pano_url: a.imagery?.pano_url ?? null,
      collider_url: a.mesh?.collider_mesh_url ?? null,
    } : null,
    object: row.kind === 'object' && row.status === 'done' ? { glb_url: `/api/xworld/${row.id}/model` } : null,
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const o = await owned(id)
  if (o.res) return o.res
  const row = o.row.kind === 'world' ? await refreshWorld(o.row) : await refreshObject(o.row, o.userId!)
  return Response.json({ item: view(row) })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const o = await owned(id)
  if (o.res) return o.res
  await service().from('xworlds').update({ deleted_at: new Date().toISOString() }).eq('id', id)
  return Response.json({ ok: true })
}
