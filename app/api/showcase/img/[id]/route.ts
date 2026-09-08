// GET /api/showcase/img/{showcase_id} — a gallery picture, signed on demand.
//
// The wall's HTML carries THIS path, never a signed storage URL. That is the
// whole point: /xcreate is prerendered as static content, so a signature baked
// into the markup is signed once at BUILD time and every picture on the wall
// dies two hours after a deploy. It did — images were 404ing on dev with a
// token that had expired 20 hours earlier.
//
// CLAUDE.md pitfall 11 says exactly this ("sign on demand behind our own
// route, not by re-signing at every read site") and the first version of this
// gallery signed at read time anyway, which looks identical in dev and fails
// silently in production the moment a render is cached.
//
// A redirect rather than a proxy: Supabase serves the bytes, we only hand out
// a fresh key. Nothing streams through the function.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { createClient } from '@supabase/supabase-js'

// Short. The redirect is cheap to reissue and a long-lived signature in a CDN
// is the same bug wearing a different hat.
const SIGN_TTL_SECONDS = 60 * 10

function parseStored(url: string): { bucket: string; path: string } | null {
  const m = String(url).split('\n')[0].match(/\/storage\/v1\/object\/sign\/([^/]+)\/([^?]+)/)
  return m ? { bucket: m[1], path: decodeURIComponent(m[2]) } : null
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } })

  const { data: piece } = await sb.from('showcase')
    .select('xcreate_id, slot_index, published').eq('id', id).maybeSingle()
  // Unpublished pieces are not public. The wall is curated; an id that is not
  // hung should not be fetchable just because someone kept the link.
  if (!piece || !piece.published) return new Response('Not found', { status: 404 })

  const { data: run } = await sb.from('xcreates')
    .select('slots, deleted_at').eq('id', piece.xcreate_id).maybeSingle()
  if (!run || run.deleted_at) return new Response('Not found', { status: 404 })

  const slot = (run.slots as any[])?.[piece.slot_index]
  const loc = slot?.text && !slot.error ? parseStored(slot.text) : null
  if (!loc) return new Response('Not found', { status: 404 })

  const { data: signed } = await sb.storage.from(loc.bucket).createSignedUrl(loc.path, SIGN_TTL_SECONDS)
  if (!signed?.signedUrl) return new Response('Not found', { status: 404 })

  return Response.redirect(signed.signedUrl, 302)
}
