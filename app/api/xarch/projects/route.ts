// app/api/xarch/projects/route.ts — list my XArch projects, or start one.
//   { sample: true }                      → the free sample (no model call)
//   { upload: {bucket,storagePath,mediaType}, architect } → an architect
//     reads the plan in the background (`after`); the row sits in 'reading'
//     and the page polls. A GPT-6 Astra read of a real blueprint took ~6 min.

export const runtime = 'nodejs'
export const maxDuration = 800

import { after } from 'next/server'
import { service, readPlan, assertBalance, bill, download } from '@/lib/xarch-ai'
import { ARCHITECTS, isArchitect, type ArchitectId } from '@/lib/xarch'
import { SAMPLE_PLAN, SAMPLE_PLAN_IMAGE, SAMPLE_TITLE, SAMPLE_MEDIA } from '@/lib/xarch-sample'
import { currentUser, USER_BUCKETS, fail, sourceUrl } from '../_shared'

const MAX_EDGE = 1568   // what both architects actually see; plan pixels = these pixels

export async function GET() {
  const user = await currentUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { data, error } = await service().from('xarch_projects')
    .select('id, title, status, source, is_sample, spent_cents, updated_at, created_at')
    .eq('user_id', user.id).is('deleted_at', null).order('updated_at', { ascending: false }).limit(60)
  if (error) {
    const msg = /xarch_projects/.test(error.message) ? 'XArch is not set up yet (run supabase/100_xarch.sql).' : error.message
    return Response.json({ error: msg }, { status: 503 })
  }
  const projects = await Promise.all((data ?? []).map(async p => {
    const { source, ...rest } = p as any
    return { ...rest, thumb_url: await sourceUrl(source) }
  }))
  return Response.json({ projects })
}

export async function POST(req: Request) {
  const user = await currentUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const svc = service()

  if (body?.sample) {
    const now = new Date().toISOString()
    const { data, error } = await svc.from('xarch_projects').insert({
      user_id: user.id, title: SAMPLE_TITLE, status: 'ready', is_sample: true,
      source: { public_url: SAMPLE_PLAN_IMAGE }, plan: SAMPLE_PLAN,
      media: SAMPLE_MEDIA.map(m => ({ ...m, created_at: now })),
    }).select('id').single()
    if (error) return fail(error.message)
    return Response.json({ id: data.id })
  }

  const up = body?.upload
  const architect: ArchitectId = isArchitect(body?.architect) ? body.architect : 'astra'
  if (!up || !USER_BUCKETS.has(up.bucket) || typeof up.storagePath !== 'string' || !up.storagePath.startsWith(`${user.id}/`) || !String(up.mediaType).startsWith('image/')) {
    return Response.json({ error: 'Upload a floor plan image (JPG, PNG or WebP).' }, { status: 400 })
  }

  try {
    await assertBalance(user.id, ARCHITECTS[architect].readEstimateCents)
    // Normalise the drawing once: the architect reads THESE pixels and the
    // page draws over THESE pixels, so a resize anywhere else would shift
    // every wall.
    const sharp = (await import('sharp')).default
    const src = await download(up.bucket, up.storagePath)
    const img = sharp(src.buffer).rotate().flatten({ background: '#ffffff' })
    const meta = await img.metadata()
    const scale = Math.min(1, MAX_EDGE / Math.max(meta.width ?? MAX_EDGE, meta.height ?? MAX_EDGE))
    const { data: buf, info } = await img
      .resize({ width: Math.round((meta.width ?? MAX_EDGE) * scale) })
      .jpeg({ quality: 92 }).toBuffer({ resolveWithObject: true })
    const path = `${user.id}/xarch/${crypto.randomUUID()}.jpg`
    const { error: upErr } = await svc.storage.from('xcreate-user-images').upload(path, buf, { contentType: 'image/jpeg' })
    if (upErr) throw new Error(upErr.message)

    const title = typeof body?.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 120) : 'My floor plan'
    const { data: row, error } = await svc.from('xarch_projects').insert({
      user_id: user.id, title, status: 'reading', architect,
      source: { bucket: 'xcreate-user-images', path, mediaType: 'image/jpeg', w: info.width, h: info.height },
    }).select('id').single()
    if (error) throw new Error(error.message)

    after(async () => {
      try {
        const { plan, cost } = await readPlan(architect, user.id, { buffer: buf, mediaType: 'image/jpeg', w: info.width, h: info.height })
        const cents = await bill(user.id, cost, row.id, `plan read (${ARCHITECTS[architect].label})`, { architect, kind: 'read' })
        await svc.from('xarch_projects').update({ status: 'ready', plan, spent_cents: cents, updated_at: new Date().toISOString() }).eq('id', row.id)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error('[xarch] read failed', row.id, msg)
        await svc.from('xarch_projects').update({ status: 'failed', error: msg.slice(0, 400), updated_at: new Date().toISOString() }).eq('id', row.id)
      }
    })
    return Response.json({ id: row.id })
  } catch (e) {
    return fail(e, 'Could not start reading the plan')
  }
}
