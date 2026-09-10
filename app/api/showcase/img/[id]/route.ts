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
//
// VIDEO PIECES (Sep 11). `?poster=1` answers with the tile's JPEG still, and a
// plain request prefers the fast-start copy when one exists. Both come from
// scripts/showcase-video-assets.ts; see SHOWCASE_POSTER in lib/showcase.ts.
// The redirect may be reused by the browser for 5 minutes, half the life of
// the signature it carries, so a revisited wall does not re-sign and re-fetch
// every clip.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { createClient } from '@supabase/supabase-js'
import { SHOWCASE_POSTER, SHOWCASE_FASTSTART } from '@/lib/showcase'

// Short. The redirect is cheap to reissue and a long-lived signature in a CDN
// is the same bug wearing a different hat.
const SIGN_TTL_SECONDS = 60 * 10

const redirect = (url: string) => new Response(null, {
  status: 302,
  headers: { Location: url, 'Cache-Control': 'private, max-age=300' },
})

function parseStored(url: string): { bucket: string; path: string } | null {
  const m = String(url).split('\n')[0].match(/\/storage\/v1\/object\/sign\/([^/]+)\/([^?]+)/)
  return m ? { bucket: m[1], path: decodeURIComponent(m[2]) } : null
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const wantPoster = new URL(req.url).searchParams.get('poster') === '1'
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } })

  const { data: piece } = await sb.from('showcase')
    .select('xcreate_id, slot_index, published').eq('id', id).maybeSingle()
  // Unpublished pieces are not public. The wall is curated; an id that is not
  // hung should not be fetchable just because someone kept the link.
  if (!piece || !piece.published) return new Response('Not found', { status: 404 })

  if (wantPoster) {
    const { data: p } = await sb.storage.from(SHOWCASE_POSTER.bucket)
      .createSignedUrl(SHOWCASE_POSTER.path(id), SIGN_TTL_SECONDS)
    return p?.signedUrl ? redirect(p.signedUrl) : new Response('Not found', { status: 404 })
  }

  const { data: run } = await sb.from('xcreates')
    .select('slots, deleted_at, mode').eq('id', piece.xcreate_id).maybeSingle()
  if (!run || run.deleted_at) return new Response('Not found', { status: 404 })

  // A clip whose original has its index at the end is served from the copy
  // that has it at the front, so hover playback starts at once.
  if (run.mode === 'video') {
    const { data: f } = await sb.storage.from(SHOWCASE_FASTSTART.bucket)
      .createSignedUrl(SHOWCASE_FASTSTART.path(id), SIGN_TTL_SECONDS)
    if (f?.signedUrl) return redirect(f.signedUrl)
  }

  const slot = (run.slots as any[])?.[piece.slot_index]
  const loc = slot?.text && !slot.error ? parseStored(slot.text) : null
  if (!loc) return new Response('Not found', { status: 404 })

  const { data: signed } = await sb.storage.from(loc.bucket).createSignedUrl(loc.path, SIGN_TTL_SECONDS)
  if (!signed?.signedUrl) return new Response('Not found', { status: 404 })

  return redirect(signed.signedUrl)
}
