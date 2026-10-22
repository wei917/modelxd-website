// app/api/profile/xcreates/route.ts
// Server-paged XCreate history for the profile gallery.
//
// Fetches ONE page of the signed-in user's xcreates (RLS via their server
// session — never the service role, so signing stays scoped to files they
// own) and re-signs only that page's media URLs in one batched
// `createSignedUrls` call per bucket. Returns rows ready to render plus the
// total count for pagination. This keeps the browser from over-fetching the
// whole history or doing per-URL signing round-trips.

export const runtime = 'nodejs'

import type { NextRequest } from 'next/server'

const PAGE_SIZE = 12
const SIGN_RE = /\/storage\/v1\/object\/sign\/([^/]+)\/([^?]+)/

async function signRows(client: any, rows: any[]): Promise<any[]> {
  // Collect every signed-storage path, grouped + deduped by bucket.
  const pathsByBucket: Record<string, Set<string>> = {}
  for (const row of rows) {
    for (const s of (row.slots ?? []) as any[]) {
      if (!s?.text || typeof s.text !== 'string') continue
      for (const part of s.text.split('\n')) {
        const m = part.match(SIGN_RE)
        if (!m) continue
        ;(pathsByBucket[m[1]] ??= new Set<string>()).add(decodeURIComponent(m[2]))
      }
    }
  }
  // Batch-sign per bucket → map `${bucket}\n${path}` -> fresh URL.
  const signedMap: Record<string, string> = {}
  await Promise.all(Object.entries(pathsByBucket).map(async ([bucket, set]) => {
    const list = [...set]
    if (list.length === 0) return
    const { data } = await client.storage.from(bucket).createSignedUrls(list, 60 * 60 * 24)
    for (const item of data ?? []) {
      if (item?.signedUrl && item.path) signedMap[`${bucket}\n${item.path}`] = item.signedUrl
    }
  }))
  // Rebuild each row's slots from the map (leave non-signed parts as-is).
  return rows.map(row => ({
    ...row,
    slots: ((row.slots ?? []) as any[]).map((s: any) => {
      if (!s?.text || typeof s.text !== 'string') return s
      const fresh = s.text.split('\n').map((part: string) => {
        const m = part.match(SIGN_RE)
        if (!m) return part
        return signedMap[`${m[1]}\n${decodeURIComponent(m[2])}`] ?? part
      })
      return { ...s, text: fresh.join('\n') }
    }),
  }))
}

export async function GET(req: NextRequest) {
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const supabase = await createSupabaseServer()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const url    = new URL(req.url)
  const page   = Math.max(0, parseInt(url.searchParams.get('page') ?? '0', 10) || 0)
  const filter = url.searchParams.get('filter') ?? 'all'
  const studioOnly = url.searchParams.get('studio') === '1'
  const excludeXfilm = url.searchParams.get('exclude') === 'xfilm'
  // The profile Library (Oct 15) asks for small previews (size=4), a search
  // over the prompt (q), oldest-first (sort=oldest) and a row offset. Size stays bounded;
  // without these the response is what the studio and the old tab expect.
  const size   = Math.min(24, Math.max(1, parseInt(url.searchParams.get('size') ?? '', 10) || PAGE_SIZE))
  const search = (url.searchParams.get('q') ?? '').trim().slice(0, 100)
  const oldest = url.searchParams.get('sort') === 'oldest'
  // offset (the Library's "Show more") wins over page, so a deleted card
  // never shifts the next request back onto rows already shown.
  const offsetParam = url.searchParams.get('offset')
  const from   = offsetParam != null ? Math.max(0, parseInt(offsetParam, 10) || 0) : page * size
  const to     = from + size - 1

  const query = (withDeletedFilter: boolean) => {
    let q = supabase.from('xcreates').select('*', { count: 'exact' }).eq('user_id', user.id)
    if (withDeletedFilter) q = q.is('deleted_at', null)
    // Film is the studio's fifth type: a video row whose first slot names it
    // (lib/film/driver.ts). It gets its own filter and leaves Video (Oct 1).
    // A 同款 read (Oct 17, lib/remake/saved.ts) is kept the same way under
    // `options.remake`: its own filter, and out of Video too.
    if (filter === 'film') q = q.eq('mode', 'video').not('slots->0->options->>film', 'is', null)
    else if (filter === 'remake') q = q.eq('mode', 'video').not('slots->0->options->>remake', 'is', null)
    // 語音 and 音樂 are both audio rows (Oct 22): the recipe on the first slot tells them apart.
    else if (filter === 'music') q = q.eq('mode', 'audio').eq('slots->0->options->>mode', 'text_to_music')
    else if (filter !== 'all') q = q.eq('mode', filter)
    if (filter === 'audio') q = q.or('slots->0->options->>mode.is.null,slots->0->options->>mode.neq.text_to_music')
    if (filter === 'video') q = q.is('slots->0->options->>film', null).is('slots->0->options->>remake', null).is('slots->0->options->>fan', null)
    // XFilm (Oct 22) took the film, 同款 and 風扇變裝 rows: the Library's
    // XCreate section asks for everything else (exclude=xfilm).
    if (excludeXfilm) q = q.is('slots->0->options->>film', null).is('slots->0->options->>remake', null).is('slots->0->options->>fan', null)
    // The studio's own grid (Oct 3): runs made in the studio only, not XDirect
    // board nodes, upload "Source:" rows or XCut renders (they carry a node_kind).
    if (studioOnly) q = q.is('node_kind', null)
    // PostgREST pattern characters in the search are matched literally.
    if (search) q = q.ilike('prompt', `%${search.replace(/[\\%_]/g, m => '\\' + m)}%`)
    return q.order('created_at', { ascending: oldest }).range(from, to)
  }

  // Prefer the deleted_at-aware query; fall back for DBs without that column.
  let res = await query(true)
  if (res.error) res = await query(false)
  if (res.error) return Response.json({ error: res.error.message }, { status: 400 })

  const rows = await signRows(supabase, res.data ?? [])
  return Response.json({ rows, total: res.count ?? rows.length, pageSize: size })
}
