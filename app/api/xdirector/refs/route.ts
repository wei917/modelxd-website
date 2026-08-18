// app/api/xdirector/refs/route.ts
// Signed URLs for the reference photos the DIRECTOR looks at (owner, Aug 11:
// "can they just take url instead of photo bytes?").
//
// The Messages API accepts image blocks with source {type:"url"}, which
// replaced inline base64 in the chat — a link is ~200 chars where a photo
// was 15k-100k, and that base64 was what overflowed the context cap. It also
// means the director sees each photo at full resolution.
//
// Why this route exists at all: uploads land at `originals/<uuid>`, but the
// bucket's owner-read policy matches on a leading user-id folder, so the
// BROWSER cannot sign these paths — its createSignedUrl is denied and returns
// null (which silently sent the director text-only photos until it was
// caught live). Signing needs the service client, so it has to happen here.
//
// Ownership is checked against storage.objects.owner, which Supabase stamps
// with the uploader's auth uid — a guessed path from another account signs
// nothing.

export const runtime = 'nodejs'

import { createClient } from '@supabase/supabase-js'

const LOG = '[xdirector:refs]'
const TTL = 60 * 60 * 24   // a day: comfortably longer than a session

const serviceClient = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false } },
)

export async function POST(req: Request) {
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const supabaseUser = await createSupabaseServer()
  const { data: { user } } = await supabaseUser.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { files } = await req.json().catch(() => ({}))
  const list: Array<{ bucket?: string; storagePath?: string }> =
    Array.isArray(files) ? files.slice(0, 20) : []
  if (list.length === 0) return Response.json({ urls: {} })

  const sb = serviceClient()
  const urls: Record<string, string> = {}

  for (const f of list) {
    if (typeof f?.bucket !== 'string' || typeof f?.storagePath !== 'string') continue
    // Ownership straight off the path: uploads are filed under the
    // uploader's id (see commitAttachments). Objects predating that scheme
    // are refused and fall back to a text-only mention — the director
    // simply doesn't see those older photos inline.
    if (!f.storagePath.startsWith(`${user.id}/`)) {
      console.warn(`${LOG} refused ${f.bucket}/${f.storagePath} (not owned / pre-dates id-prefixed uploads)`)
      continue
    }
    const { data: signed } = await sb.storage.from(f.bucket).createSignedUrl(f.storagePath, TTL)
    if (signed?.signedUrl) urls[f.storagePath] = signed.signedUrl
  }

  console.log(`${LOG} signed ${Object.keys(urls).length}/${list.length}`)
  return Response.json({ urls })
}
