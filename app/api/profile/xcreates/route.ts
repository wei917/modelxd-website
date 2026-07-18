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
  const from   = page * PAGE_SIZE
  const to     = from + PAGE_SIZE - 1

  const query = (withDeletedFilter: boolean) => {
    let q = supabase.from('xcreates').select('*', { count: 'exact' }).eq('user_id', user.id)
    if (withDeletedFilter) q = q.is('deleted_at', null)
    if (filter !== 'all')  q = q.eq('mode', filter)
    return q.order('created_at', { ascending: false }).range(from, to)
  }

  // Prefer the deleted_at-aware query; fall back for DBs without that column.
  let res = await query(true)
  if (res.error) res = await query(false)
  if (res.error) return Response.json({ error: res.error.message }, { status: 400 })

  const rows = await signRows(supabase, res.data ?? [])
  return Response.json({ rows, total: res.count ?? rows.length, pageSize: PAGE_SIZE })
}
