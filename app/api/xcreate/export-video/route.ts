// app/api/xcreate/export-video/route.ts: re-encode a video to a platform's
// upload spec (phase 2 of the Oct 1 platform templates; owner: "make
// photo/video taobao compliant, or make social platform compliant").
//
//   POST { spec: VideoSpecId, source: { kind: 'slot', id, slot } }   a video a model made
//   POST { spec: VideoSpecId, source: { kind: 'upload', path } }     the user's own upload
//
// The viewer must own the run, or the upload must sit in their own folder;
// the file is only ever read from our storage. ffmpeg runs here
// (lib/platform-video.ts), and the result is stored under the user's
// exports folder and handed back as a one-hour signed link that downloads
// (Supabase's `download` turns it into an attachment, which is what works on
// phones; a function response could not carry a large video anyway).

import { NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'
import { videoSpecById, isOwnUpload, UPLOAD_BUCKETS } from '@/lib/platform-specs'
import { exportVideoToSpec } from '@/lib/platform-video'

export const runtime = 'nodejs'
export const maxDuration = 800

const OUT_BUCKET = 'xcreate-ai-videos'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as any
  const spec = videoSpecById(body?.spec)
  const source = body?.source
  if (!spec || !source || (source.kind !== 'slot' && source.kind !== 'upload')) {
    return Response.json({ error: 'bad_request' }, { status: 400 })
  }

  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const admin = createClient(base, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } })

  // Where the video lives, and whether it is the viewer's to convert.
  let bucket: string, objectPath: string
  if (source.kind === 'upload') {
    const p = String(source.path ?? '')
    if (!isOwnUpload(user.id, p)) return Response.json({ error: 'not_found' }, { status: 404 })
    bucket = UPLOAD_BUCKETS.video; objectPath = p
  } else {
    const id = String(source.id ?? ''), slotIdx = Number(source.slot ?? 0)
    if (!/^[0-9a-f-]{36}$/i.test(id) || !Number.isInteger(slotIdx) || slotIdx < 0 || slotIdx > 3) {
      return Response.json({ error: 'bad_request' }, { status: 400 })
    }
    const { data: row } = await supabase.from('xcreates')
      .select('id, user_id, slots').eq('id', id).is('deleted_at', null).maybeSingle()
    if (!row || row.user_id !== user.id) return Response.json({ error: 'not_found' }, { status: 404 })
    const slot = Array.isArray(row.slots) ? (row.slots as any[])[slotIdx] : null
    const src = typeof slot?.text === 'string' ? slot.text.split('\n').filter(Boolean)[0] : null
    if (!src || !slot?.isVideo) return Response.json({ error: 'not_a_video' }, { status: 404 })
    const m = src.startsWith(base) ? src.match(/\/storage\/v1\/object\/(?:sign|public)\/([^/]+)\/([^?]+)/) : null
    if (!m) return Response.json({ error: 'not_stored_here' }, { status: 422 })
    bucket = m[1]; objectPath = decodeURIComponent(m[2])
  }

  const { data: file, error: dlErr } = await admin.storage.from(bucket).download(objectPath)
  if (dlErr || !file) return Response.json({ error: 'file_missing' }, { status: 404 })

  const tag = randomUUID()
  const ext = (path.extname(objectPath) || '.mp4').slice(0, 6)
  const inFile = path.join(os.tmpdir(), `${tag}-in${ext}`)
  const outFile = path.join(os.tmpdir(), `${tag}-out.mp4`)
  try {
    await fs.writeFile(inFile, Buffer.from(await file.arrayBuffer()))
    const result = await exportVideoToSpec(inFile, outFile, spec)

    const name = `${spec.file}-${spec.w}x${spec.h}.mp4`
    const dest = `${user.id}/exports/${tag}-${name}`
    const { error: upErr } = await admin.storage.from(OUT_BUCKET)
      .upload(dest, await fs.readFile(outFile), { contentType: 'video/mp4', upsert: false })
    if (upErr) {
      console.error('[xcreate/export-video] store failed:', upErr.message)
      return Response.json({ error: 'store_failed', checks: result.checks }, { status: 500 })
    }
    const { data: signed } = await admin.storage.from(OUT_BUCKET).createSignedUrl(dest, 60 * 60, { download: name })
    if (!signed?.signedUrl) return Response.json({ error: 'sign_failed' }, { status: 500 })
    return Response.json({ url: signed.signedUrl, name, checks: result.checks, seconds: result.seconds, bytes: result.bytes })
  } catch (e) {
    console.error('[xcreate/export-video] failed:', e)
    return Response.json({ error: 'export_failed' }, { status: 500 })
  } finally {
    await fs.rm(inFile, { force: true }).catch(() => {})
    await fs.rm(outFile, { force: true }).catch(() => {})
  }
}
