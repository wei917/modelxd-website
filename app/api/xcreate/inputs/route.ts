// app/api/xcreate/inputs/route.ts
// Fresh signed URLs for the INPUT attachments of a set of creations
// (CC, July 28).
//
// Why this exists: a generation's reference image is an attachment, not an
// xcreates row, so the canvas — which draws one node per row — had nothing
// to draw for it. A video made from an uploaded handbag photo showed the
// video and no source, which is exactly the connection the board is for.
//
// Signing happens server-side with the service client because the stored
// URLs in xcreates.input_attachments are absent (only storage paths are
// kept) and the ones in the attachments table carry a 1h TTL that has long
// expired for anything older than today. Ownership is checked first.
//
// Thumbnails are preferred over originals for display: a phone upload is
// routinely 1-4MB and the board may show a dozen of them at 168px wide.

export const runtime = 'nodejs'

import { createClient } from '@supabase/supabase-js'

const LOG = '[xcreate:inputs]'
const TTL = 60 * 60 * 24   // 24h: a working session must outlive its links (owner, Aug 14: play showed 0:00 after a long-open tab — the 1h signatures had expired under it)

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } }
  )
}

export async function POST(req: Request) {
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const supabaseUser = await createSupabaseServer()
  const { data: { user }, error: authError } = await supabaseUser.auth.getUser()
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { ids, boardId } = await req.json()
  // UUID-shape filter, not just typeof string. A malformed id makes the
  // .in() query fail outright, which 500'd the whole board instead of
  // dropping one node.
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  const sb = serviceClient()
  let rows: any[] | null = null
  let error: any = null
  if (typeof boardId === 'string' && UUID.test(boardId)) {
    // Whole-board form (owner ask, Aug 9): the client no longer needs the
    // row ids first, so the board query and this call run IN PARALLEL —
    // the refs block used to pop in seconds after the nodes because this
    // request had to wait for the other's ids. Scoped to the caller's own
    // rows, same filter as the board loader.
    ;({ data: rows, error } = await sb.from('xcreates')
      .select('id, user_id, input_attachments, slots')
      .eq('board_id', boardId).eq('user_id', user.id).is('deleted_at', null)
      .limit(200))
  } else {
    const idList: string[] = (Array.isArray(ids) ? ids : [])
      .filter((x: any) => typeof x === 'string' && UUID.test(x))
      .slice(0, 200)
    if (idList.length === 0) return Response.json({ inputs: {} })
    ;({ data: rows, error } = await sb.from('xcreates')
      .select('id, user_id, input_attachments, slots')
      .in('id', idList))
  }
  if (error) {
    console.error(`${LOG} read failed:`, error.message)
    return Response.json({ error: 'Lookup failed' }, { status: 500 })
  }

  const mine = (rows ?? []).filter((r: any) => r.user_id === user.id)

  // Collect every distinct original path, then resolve thumbnails in ONE
  // query rather than per attachment.
  const paths = new Set<string>()
  for (const r of mine) {
    for (const a of (Array.isArray(r.input_attachments) ? r.input_attachments : [])) {
      if (a?.storagePath) paths.add(a.storagePath)
    }
  }
  const byOriginal = new Map<string, any>()
  if (paths.size > 0) {
    const { data: atts } = await sb.from('attachments')
      .select('bucket, original_path, resized_path, thumbnail_path, media_type, file_name, file_size')
      .in('original_path', [...paths])
    for (const a of atts ?? []) byOriginal.set(a.original_path, a)
  }

  const inputs: Record<string, any[]> = {}
  for (const r of mine) {
    const list: any[] = []
    for (const a of (Array.isArray(r.input_attachments) ? r.input_attachments : [])) {
      if (!a?.storagePath) continue
      const meta = byOriginal.get(a.storagePath)
      const bucket = a.bucket ?? meta?.bucket
      if (!bucket) continue
      // Smallest adequate rendition wins; fall back to the original.
      const displayPath = meta?.thumbnail_path ?? meta?.resized_path ?? a.storagePath
      let url: string | null = null
      try {
        const { data: signed } = await sb.storage.from(bucket).createSignedUrl(displayPath, TTL)
        url = signed?.signedUrl ?? null
      } catch (err) {
        console.warn(`${LOG} sign failed for ${bucket}/${displayPath}:`, err)
      }
      list.push({
        // The generation-input descriptor: exactly the shape /api/xcreate
        // takes in `attachments`, so a board node can be re-used as an input
        // without another upload.
        bucket,
        storagePath: a.storagePath,
        mediaType:   a.mediaType ?? meta?.media_type ?? 'image/jpeg',
        fileName:    a.fileName  ?? meta?.file_name  ?? 'input',
        fileSize:    a.fileSize  ?? meta?.file_size  ?? 0,
        url,
      })
    }
    if (list.length > 0) inputs[r.id] = list
  }

  // ── Re-sign the OUTPUTS too ──────────────────────────────────────────
  // Slot URLs are stored with a 1h TTL, so any board older than an hour
  // rendered as black rectangles — the generation was fine, the link was
  // dead. The storage path inside the stale URL never changes, so parse it
  // back out and mint a fresh one, keyed by the board's node id.
  const outputs: Record<string, string> = {}
  for (const r of mine) {
    const ss: any[] = Array.isArray(r.slots) ? r.slots : []
    for (let i = 0; i < ss.length; i++) {
      const raw = typeof ss[i]?.text === 'string' ? ss[i].text.split('\n')[0] : null
      if (!raw) continue
      const m = raw.match(/\/storage\/v1\/object\/sign\/([^/]+)\/([^?]+)/)
      if (!m) continue
      const [, bucket, rawPath] = m
      try {
        const { data: signed } = await sb.storage.from(bucket).createSignedUrl(decodeURIComponent(rawPath), TTL)
        if (signed?.signedUrl) outputs[`${r.id}::${i}`] = signed.signedUrl
      } catch (err) {
        console.warn(`${LOG} output sign failed for ${bucket}:`, err)
      }
    }
  }

  return Response.json({ inputs, outputs })
}
