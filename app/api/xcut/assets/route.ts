// app/api/xcut/assets/route.ts — the asset bin: what the signed-in user can
// drop on a timeline. Four sources, one shape:
//   xdirect  — generations that live on a board (xcreates.board_id set)
//   xcreate  — studio generations (no board)
//   xduel    — both sides of the user's duels
//   uploads  — their own files (attachments: video / audio / image)
// Paged, signed per page (24 h), RLS via the user's session.

export const runtime = 'nodejs'

import { createSupabaseServer } from '@/lib/supabase-server'
import { mediaFromSlots, signMany } from '@/lib/xcut-media'

const PAGE = 24

export type AssetItem = {
  id: string
  kind: 'video' | 'image' | 'audio'
  src: { bucket: string; path: string; mediaType: string; fileName?: string; rowId?: string; duelId?: string }
  url: string | null
  label: string
  model?: string
  cost?: number
  createdAt: string
  source: 'xdirect' | 'xcreate' | 'xduel' | 'uploads'
  boardId?: string
}

export async function GET(req: Request) {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const source = (url.searchParams.get('source') ?? 'xdirect') as AssetItem['source']
  const kindFilter = url.searchParams.get('kind')   // video | image | audio | null
  const page = Math.max(0, parseInt(url.searchParams.get('page') ?? '0', 10) || 0)
  const from = page * PAGE, to = from + PAGE - 1

  let items: AssetItem[] = []
  let total = 0
  if (source === 'xdirect' || source === 'xcreate') {
    let q = sb.from('xcreates').select('id, prompt, title, mode, slots, board_id, created_at', { count: 'exact' })
      .eq('user_id', user.id).in('mode', ['image', 'video']).is('deleted_at', null)
    q = source === 'xdirect' ? q.not('board_id', 'is', null) : q.is('board_id', null)
    const { data, count, error } = await q.order('created_at', { ascending: false }).range(from, to)
    if (error) return Response.json({ error: error.message }, { status: 503 })
    total = count ?? 0
    for (const row of data ?? []) {
      mediaFromSlots(row.slots).forEach((m, i) => items.push({
        id: `${row.id}:${i}`, kind: m.kind, src: { bucket: m.bucket, path: m.path, mediaType: m.mediaType, rowId: row.id }, url: null,
        label: (row.title || row.prompt || '').slice(0, 80), model: m.model, cost: m.cost, createdAt: row.created_at, source, boardId: row.board_id ?? undefined,
      }))
    }
  } else if (source === 'xduel') {
    const { data, count, error } = await sb.from('duels').select('id, prompt, mode, slots, created_at', { count: 'exact' })
      .eq('user_id', user.id).in('mode', ['image', 'video']).order('created_at', { ascending: false }).range(from, to)
    if (error) return Response.json({ error: error.message }, { status: 503 })
    total = count ?? 0
    for (const row of data ?? []) {
      mediaFromSlots(row.slots).forEach((m, i) => items.push({
        id: `${row.id}:${i}`, kind: m.kind, src: { bucket: m.bucket, path: m.path, mediaType: m.mediaType, duelId: row.id }, url: null,
        label: (row.prompt || '').slice(0, 80), model: m.model, cost: m.cost, createdAt: row.created_at, source,
      }))
    }
  } else if (source === 'uploads') {
    // Uploads are files under the user's own folder in the upload buckets
    // (commitAttachments writes `<uid>/…`; nothing else records them).
    const BUCKETS: Array<{ bucket: string; kind: AssetItem['kind'] | null }> = [
      { bucket: 'xcreate-user-videos', kind: 'video' }, { bucket: 'xcreate-user-files', kind: null }, { bucket: 'xcreate-user-images', kind: 'image' },
    ]
    const all: AssetItem[] = []
    await Promise.all(BUCKETS.map(async ({ bucket, kind }) => {
      const { data } = await sb.storage.from(bucket).list(user.id, { limit: 200, sortBy: { column: 'created_at', order: 'desc' } })
      for (const f of data ?? []) {
        if (!f?.name || f.name.endsWith('/') || f.id === null) continue
        const mime: string = f.metadata?.mimetype ?? ''
        const k: AssetItem['kind'] | null = kind ?? (mime.startsWith('audio/') ? 'audio' : mime.startsWith('video/') ? 'video' : mime.startsWith('image/') ? 'image' : /\.(mp3|m4a|wav|flac|ogg|aac)$/i.test(f.name) ? 'audio' : null)
        if (!k) continue
        const path = `${user.id}/${f.name}`
        all.push({ id: `${bucket}:${path}`, kind: k, src: { bucket, path, mediaType: mime || (k === 'video' ? 'video/mp4' : k === 'audio' ? 'audio/mpeg' : 'image/jpeg'), fileName: f.name }, url: null, label: f.name, createdAt: f.created_at ?? '', source })
      }
    }))
    all.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    total = all.length
    items = all.slice(from, to + 1)
  } else return Response.json({ error: 'Unknown source' }, { status: 400 })

  if (kindFilter) items = items.filter(i => i.kind === kindFilter)
  const signed = await signMany(sb, items.map(i => i.src))
  for (const i of items) i.url = signed.get(`${i.src.bucket}\n${i.src.path}`) ?? null
  return Response.json({ items, total, page, pageSize: PAGE })
}
