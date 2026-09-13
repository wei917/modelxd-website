// app/api/xarch/projects/[id]/media/route.ts — attach an uploaded photo or
// video to a room (POST), remove one (DELETE ?mediaId=).

export const runtime = 'nodejs'

import { service } from '@/lib/xarch-ai'
import type { Media } from '@/lib/xarch'
import { owned, view, USER_BUCKETS } from '../../../_shared'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const o = await owned((await params).id)
  if (o instanceof Response) return o
  const body = await req.json().catch(() => ({}))
  const items: any[] = Array.isArray(body?.items) ? body.items.slice(0, 10) : []
  const roomId = typeof body?.room_id === 'string' ? body.room_id : null
  const now = new Date().toISOString()
  const added: Media[] = []
  for (const it of items) {
    const okType = String(it?.mediaType).startsWith('image/') || String(it?.mediaType).startsWith('video/')
    if (!okType || !USER_BUCKETS.has(it?.bucket) || typeof it?.storagePath !== 'string' || !it.storagePath.startsWith(`${o.userId}/`)) {
      return Response.json({ error: 'Invalid file' }, { status: 400 })
    }
    added.push({ id: crypto.randomUUID(), room_id: roomId, kind: 'upload', mediaType: it.mediaType, bucket: it.bucket, path: it.storagePath, created_at: now })
  }
  const { data } = await service().from('xarch_projects')
    .update({ media: [...(o.row.media ?? []), ...added], updated_at: now }).eq('id', o.row.id).select('*').single()
  return Response.json({ project: await view(data ?? o.row) })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const o = await owned((await params).id)
  if (o instanceof Response) return o
  const mediaId = new URL(req.url).searchParams.get('mediaId')
  const media = (o.row.media ?? []).filter((m: Media) => m.id !== mediaId)
  const { data } = await service().from('xarch_projects')
    .update({ media, updated_at: new Date().toISOString() }).eq('id', o.row.id).select('*').single()
  return Response.json({ project: await view(data ?? o.row) })
}
