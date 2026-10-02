// app/api/xcreate/export/route.ts: download one generated picture in a
// platform's exact upload spec (owner, Oct 1: templates that make a photo
// "taobao compliant" or "social platform compliant").
//
//   GET ?id=<xcreates id>&slot=<0-3>&i=<image index>&spec=<ExportSpecId>
//   GET ?upload=<path in xcreate-user-images>&spec=<ExportSpecId>
//        (a photo the user uploaded: their own folder only; no AI marker)
//
// The viewer must own the run. The file is read from storage with the
// service key (the URL stored on the row is a 24-hour signed one) and only
// from our own storage, never from an arbitrary URL: a row's slots are
// owner-writable, so following any link there would let a viewer make this
// server fetch whatever they like. The response is the JPEG as an
// attachment, with the checks in X-Export-Checks (URI-encoded JSON).

import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { exportSpecById, isOwnUpload, UPLOAD_BUCKETS } from '@/lib/platform-specs'
import { exportToSpec, type AiSource } from '@/lib/platform-export'

/** Recipes that start from the user's picture: an edit, not a pure generation. */
const EDIT_MODES = new Set(['image_edit', 'region_edit', 'reference_frames'])

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const upload = url.searchParams.get('upload')
  const id = url.searchParams.get('id') ?? ''
  const slotIdx = Number(url.searchParams.get('slot') ?? '0')
  const imgIdx = Number(url.searchParams.get('i') ?? '0')
  const spec = exportSpecById(url.searchParams.get('spec'))
  if (!spec || (!upload && (!/^[0-9a-f-]{36}$/i.test(id)
      || !Number.isInteger(slotIdx) || slotIdx < 0 || slotIdx > 3
      || !Number.isInteger(imgIdx) || imgIdx < 0 || imgIdx > 9))) {
    return Response.json({ error: 'bad_request' }, { status: 400 })
  }

  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const admin = createClient(base, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } })

  // A photo the user uploaded: only from their own folder.
  if (upload) {
    if (!isOwnUpload(user.id, upload)) return Response.json({ error: 'not_found' }, { status: 404 })
    const { data: file, error } = await admin.storage.from(UPLOAD_BUCKETS.image).download(upload)
    if (error || !file) return Response.json({ error: 'file_missing' }, { status: 404 })
    return send(Buffer.from(await file.arrayBuffer()), spec, null)
  }

  const { data: row } = await supabase.from('xcreates')
    .select('id, user_id, slots').eq('id', id).is('deleted_at', null).maybeSingle()
  if (!row || row.user_id !== user.id) return Response.json({ error: 'not_found' }, { status: 404 })

  const slot = Array.isArray(row.slots) ? (row.slots as any[])[slotIdx] : null
  const src = typeof slot?.text === 'string' ? slot.text.split('\n').filter(Boolean)[imgIdx] : null
  if (!src || !slot?.isImage) return Response.json({ error: 'not_an_image' }, { status: 404 })

  const m = src.startsWith(base) ? src.match(/\/storage\/v1\/object\/(?:sign|public)\/([^/]+)\/([^?]+)/) : null
  if (!m) return Response.json({ error: 'not_stored_here' }, { status: 422 })

  const { data: file, error } = await admin.storage.from(m[1]).download(decodeURIComponent(m[2]))
  if (error || !file) return Response.json({ error: 'file_missing' }, { status: 404 })
  // Every model picture is marked as AI: made from the user's picture, or from words alone.
  const ai: AiSource = EDIT_MODES.has(String(slot?.options?.mode ?? '')) ? 'edited' : 'generated'
  return send(Buffer.from(await file.arrayBuffer()), spec, ai)
}

async function send(input: Buffer, spec: NonNullable<ReturnType<typeof exportSpecById>>, ai: AiSource | null) {
  try {
    const out = await exportToSpec(input, spec, { ai })
    return new Response(new Uint8Array(out.buffer), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Disposition': `attachment; filename="${spec.file}-${out.width}x${out.height}.jpg"`,
        'Cache-Control': 'no-store',
        'X-Export-Checks': encodeURIComponent(JSON.stringify(out.checks)),
      },
    })
  } catch (e) {
    console.error('[xcreate/export] failed:', e)
    return Response.json({ error: 'export_failed' }, { status: 500 })
  }
}
