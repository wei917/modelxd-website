// app/api/xworld/[id]/model/route.ts — stream a Tripo object's GLB (or its
// preview image, ?asset=preview) through us. Tripo's output URLs are
// CloudFront-signed, expire, and send no Access-Control-Allow-Origin
// (checked Sep 10), so the browser can't load them directly and a stored
// link would die — Common Pitfall #11. Every request asks Tripo for a fresh
// link (the task GET is free) and pipes the bytes; a textured P1 mesh is
// well under a megabyte.

export const runtime = 'nodejs'

import { createSupabaseServer } from '@/lib/supabase-server'
import { service } from '@/lib/worldlabs'
import { tripoGet } from '@/lib/tripo'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })
  const { data: row } = await service().from('xworlds').select('task_id, kind, status')
    .eq('id', id).eq('user_id', user.id).is('deleted_at', null).maybeSingle()
  if (!row || row.kind !== 'object' || row.status !== 'done') return new Response('Not found', { status: 404 })

  const { status, json } = await tripoGet(`/tasks/${encodeURIComponent(row.task_id)}`)
  const out = json?.data?.output ?? {}
  const preview = new URL(req.url).searchParams.get('asset') === 'preview'
  const src: string | undefined = preview
    ? (out.rendered_image_url ?? out.rendered_image)
    : (out.pbr_model ?? out.model_url ?? out.model)
  if (status !== 200 || !src) return new Response('Model unavailable', { status: 502 })

  const upstream = await fetch(src)
  if (!upstream.ok || !upstream.body) return new Response('Model unavailable', { status: 502 })
  return new Response(upstream.body, {
    headers: {
      'Content-Type': preview ? (upstream.headers.get('content-type') ?? 'image/webp') : 'model/gltf-binary',
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
