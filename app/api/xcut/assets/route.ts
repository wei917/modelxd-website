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
  boardTitle?: string
}

export async function GET(req: Request) {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const source = (url.searchParams.get('source') ?? 'xdirect') as AssetItem['source'] | 'boards'
  const kindFilter = url.searchParams.get('kind')   // video | image | audio | null
  const page = Math.max(0, parseInt(url.searchParams.get('page') ?? '0', 10) || 0)
  const from = page * PAGE, to = from + PAGE - 1

  let items: AssetItem[] = []
  let total = 0

  // "XDirect" = generations on a DIRECTOR board; every generation carries a
  // board_id (XCreate's canvas has boards too), so the split is by the
  // user's xdirector_conversations, not by board_id being set.
  const { data: convs } = await sb.from('xdirector_conversations').select('id, title, updated_at, storyboard')
    .eq('user_id', user.id).is('deleted_at', null).order('updated_at', { ascending: false }).limit(300)
  const convIds = (convs ?? []).map((c: any) => c.id as string)
  const convTitle = new Map<string, string>((convs ?? []).map((c: any) => [c.id, String(c.title ?? '')]))
  // row id → the scene card it filled (its title), so a clip is "S1 · 石猴反天",
  // not 700 characters of shot prompt.
  const sceneOfRow = new Map<string, string>()
  for (const c of convs ?? []) {
    let sc = 0
    for (const sn of (Array.isArray(c.storyboard) ? c.storyboard : []) as any[]) {
      if (!sn?.asset) { if (!(sn?.continues && sc > 0)) sc += 1 }
      const tag = sn?.asset ? String(sn.title ?? 'ASSET') : `S${sc} · ${sn?.title ?? ''}`
      for (const rid of [sn?.row_id, sn?.still_row_id, ...(Array.isArray(sn?.takes) ? sn.takes : [])]) if (typeof rid === 'string') sceneOfRow.set(rid, tag)
    }
  }

  if (source === 'boards') {
    return Response.json({ boards: (convs ?? []).map((c: any) => ({ id: c.id, title: c.title ?? '', updatedAt: c.updated_at, scenes: Array.isArray(c.storyboard) ? c.storyboard.filter((x: any) => !x?.asset).length : 0 })) })
  }

  if (source === 'xdirect' || source === 'xcreate') {
    const board = url.searchParams.get('board')
    let q = sb.from('xcreates').select('id, prompt, title, mode, node_kind, slots, board_id, created_at', { count: 'exact' })
      .eq('user_id', user.id).in('mode', ['image', 'video']).is('deleted_at', null)
    if (source === 'xdirect') {
      if (board && convIds.includes(board)) q = q.eq('board_id', board)
      else if (convIds.length > 0) q = q.in('board_id', convIds)
      else q = q.eq('board_id', '00000000-0000-0000-0000-000000000000')
    } else {
      q = convIds.length > 0 ? q.or(`board_id.is.null,board_id.not.in.(${convIds.join(',')})`) : q
    }
    const { data, count, error } = await q.order('created_at', { ascending: false }).range(from, to)
    if (error) return Response.json({ error: error.message }, { status: 503 })
    total = count ?? 0
    for (const row of data ?? []) {
      const scene = row.node_kind === 'film' ? 'FINAL CUT' : sceneOfRow.get(row.id)
      const boardTitle = row.board_id ? convTitle.get(row.board_id) : undefined
      mediaFromSlots(row.slots).forEach((m, i) => items.push({
        id: `${row.id}:${i}`, kind: m.kind, src: { bucket: m.bucket, path: m.path, mediaType: m.mediaType, rowId: row.id }, url: null,
        label: (scene ?? row.title ?? row.prompt ?? '').slice(0, 80), model: m.model, cost: m.cost, createdAt: row.created_at, source, boardId: row.board_id ?? undefined,
        ...(boardTitle ? { boardTitle: boardTitle.slice(0, 60) } : {}),
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
