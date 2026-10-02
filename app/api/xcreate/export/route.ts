// app/api/xcreate/export/route.ts: download one generated picture in a
// platform's exact upload spec (owner, Oct 1: templates that make a photo
// "taobao compliant" or "social platform compliant").
//
//   GET ?id=<xcreates id>&slot=<0-3>&i=<image index>&spec=<ExportSpecId>
//
// The viewer must own the run. The file is read from storage with the
// service key (the URL stored on the row is a 24-hour signed one) and only
// from our own storage, never from an arbitrary URL: a row's slots are
// owner-writable, so following any link there would let a viewer make this
// server fetch whatever they like. The response is the JPEG as an
// attachment, with the checks in X-Export-Checks (URI-encoded JSON).

import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { exportSpecById } from '@/lib/platform-specs'
import { exportToSpec } from '@/lib/platform-export'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const id = url.searchParams.get('id') ?? ''
  const slotIdx = Number(url.searchParams.get('slot') ?? '0')
  const imgIdx = Number(url.searchParams.get('i') ?? '0')
  const spec = exportSpecById(url.searchParams.get('spec'))
  if (!/^[0-9a-f-]{36}$/i.test(id) || !spec
      || !Number.isInteger(slotIdx) || slotIdx < 0 || slotIdx > 3
      || !Number.isInteger(imgIdx) || imgIdx < 0 || imgIdx > 9) {
    return Response.json({ error: 'bad_request' }, { status: 400 })
  }

  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { data: row } = await supabase.from('xcreates')
    .select('id, user_id, slots').eq('id', id).is('deleted_at', null).maybeSingle()
  if (!row || row.user_id !== user.id) return Response.json({ error: 'not_found' }, { status: 404 })

  const slot = Array.isArray(row.slots) ? (row.slots as any[])[slotIdx] : null
  const src = typeof slot?.text === 'string' ? slot.text.split('\n').filter(Boolean)[imgIdx] : null
  if (!src || !slot?.isImage) return Response.json({ error: 'not_an_image' }, { status: 404 })

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const m = src.startsWith(base) ? src.match(/\/storage\/v1\/object\/(?:sign|public)\/([^/]+)\/([^?]+)/) : null
  if (!m) return Response.json({ error: 'not_stored_here' }, { status: 422 })

  const admin = createClient(base, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } })
  const { data: file, error } = await admin.storage.from(m[1]).download(decodeURIComponent(m[2]))
  if (error || !file) return Response.json({ error: 'file_missing' }, { status: 404 })

  try {
    const out = await exportToSpec(Buffer.from(await file.arrayBuffer()), spec)
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
