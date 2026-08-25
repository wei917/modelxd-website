// app/api/xcut/render/route.ts — XCut's export: the timeline → one MP4.
//
// ffmpeg (ffmpeg-static) in this function: every clip is normalised to the
// project's frame (scale + pad, fps, yuv420p), trimmed to its in/out,
// joined — hard cuts by concat, dissolves by xfade/acrossfade — with the
// clip's own sound or silence, the music track mixed over it (gain, fades,
// position), subtitles burned in when a CJK font is bundled. The result is
// stored like every generation: xcreate-ai-videos/<uid>/…, an xcreates row
// (node_kind 'film', parent_ids = the source rows) on the source board, and
// `render` on the project. No credits are charged: compute, not a model.
//
// Ownership: a clip renders only if the signed-in user owns its source —
// the xcreates / duels row it names, or an attachments row of theirs, or
// a path under their own prefix. Nothing else is ever downloaded.

export const runtime = 'nodejs'
export const maxDuration = 800

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServer } from '@/lib/supabase-server'
import { cleanTimeline, renderPlan, toAss, type MediaSrc, type RenderPlan } from '@/lib/xcut-timeline'
import { mediaFromSlots } from '@/lib/xcut-media'
import { ffmpegPath, run, probe, buildFfmpegArgs, bundledFont, type Local } from '@/lib/xcut-render'
import { uploadFilm } from '@/lib/xcut-upload'
import { safeFilename } from '@/lib/download-url'

const LOG = '[xcut:render]'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const OUT_BUCKET = 'xcreate-ai-videos'
const serviceClient = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } })

// ── Ownership ──────────────────────────────────────────────────────────────
async function ownsMedia(sb: any, userId: string, src: MediaSrc, cache: Map<string, boolean>): Promise<boolean> {
  const key = `${src.bucket}\n${src.path}`
  if (cache.has(key)) return cache.get(key)!
  let ok = src.path.startsWith(`${userId}/`)
  if (!ok && src.rowId && UUID.test(src.rowId)) {
    const { data } = await sb.from('xcreates').select('id, slots').eq('id', src.rowId).maybeSingle()
    ok = !!data && mediaFromSlots(data.slots).some(m => m.bucket === src.bucket && m.path === src.path)
  }
  if (!ok && src.duelId && UUID.test(src.duelId)) {
    const { data } = await sb.from('duels').select('id, slots').eq('id', src.duelId).maybeSingle()
    ok = !!data && mediaFromSlots(data.slots).some(m => m.bucket === src.bucket && m.path === src.path)
  }
  if (!ok) {
    const { data } = await sb.from('attachments').select('id').eq('bucket', src.bucket)
      .or(`original_path.eq.${src.path},resized_path.eq.${src.path}`).limit(1)
    ok = !!data && data.length > 0
  }
  cache.set(key, ok)
  return ok
}

// ── Routes ─────────────────────────────────────────────────────────────────
export async function GET(req: Request) {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const id = new URL(req.url).searchParams.get('projectId') ?? ''
  if (!UUID.test(id)) return Response.json({ error: 'Bad id' }, { status: 400 })
  const { data } = await sb.from('xcut_projects').select('id, title, render').eq('id', id).maybeSingle()
  if (!data) return Response.json({ error: 'Not found' }, { status: 404 })

  // render.url was signed for 24h at export time and then PERSISTED, so any
  // click the next day died on '"exp" claim timestamp check failed' — on
  // desktop too, where the cross-origin download fix could not help because
  // the link itself was dead. render keeps bucket+path, so sign on demand:
  //   ?download=1  → 302 to a fresh attachment URL (the button's href never
  //                  expires however long the tab has been open)
  //   otherwise    → the same JSON with a freshly signed url
  const r: any = data.render ?? null
  if (r?.bucket && r?.path) {
    const wantsFile = new URL(req.url).searchParams.get('download') === '1'
    const name = safeFilename(data.title ?? '', 'final-cut', 'mp4')
    const svc = serviceClient()
    const { data: signed } = await svc.storage.from(r.bucket).createSignedUrl(
      r.path, 60 * 60 * 24, wantsFile ? { download: name } : undefined)
    if (signed?.signedUrl) {
      if (wantsFile) return Response.redirect(signed.signedUrl, 302)
      return Response.json({ render: { ...r, url: signed.signedUrl } })
    }
  }
  return Response.json({ render: r })
}

export async function POST(req: Request) {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const id = typeof body?.projectId === 'string' ? body.projectId : ''
  if (!UUID.test(id)) return Response.json({ error: 'projectId required' }, { status: 400 })

  const { data: project } = await sb.from('xcut_projects').select('id, title, source_board_id, timeline').eq('id', id).is('deleted_at', null).maybeSingle()
  if (!project) return Response.json({ error: 'Not found' }, { status: 404 })
  const tl = cleanTimeline(body?.timeline ?? project.timeline)
  if (!tl || tl.video.length === 0) return Response.json({ error: 'Nothing on the video track.' }, { status: 400 })
  const plan = renderPlan(tl)
  if (plan.duration > 30 * 60) return Response.json({ error: 'Films longer than 30 minutes are not supported yet.' }, { status: 400 })

  const started = new Date().toISOString()
  const setRender = (r: Record<string, unknown>) => sb.from('xcut_projects').update({ render: r, updated_at: new Date().toISOString() }).eq('id', id)
  await setRender({ status: 'rendering', started_at: started })

  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'xcut-'))
  const svc = serviceClient()
  try {
    // 1. Ownership + download every source once.
    const cache = new Map<string, boolean>()
    const files = new Map<string, string>()
    const fetchOne = async (src: MediaSrc, label: string) => {
      const key = `${src.bucket}\n${src.path}`
      if (files.has(key)) return files.get(key)!
      if (!(await ownsMedia(sb, user.id, src, cache))) throw new Error(`You don't own the source of "${label}".`)
      const { data, error } = await svc.storage.from(src.bucket).download(src.path)
      if (error || !data) throw new Error(`Could not fetch "${label}": ${error?.message ?? 'missing'}`)
      const ext = (src.path.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin'
      const file = path.join(work, `src${files.size}.${ext}`)
      await fs.writeFile(file, Buffer.from(await data.arrayBuffer()))
      files.set(key, file)
      return file
    }
    const bin = ffmpegPath()
    const locals: Local[] = []
    for (const seg of plan.segments) {
      const file = await fetchOne(seg.src, tl.video[seg.index].label ?? seg.src.fileName ?? `clip ${seg.index + 1}`)
      const p = seg.kind === 'video' ? await probe(bin, file) : { hasAudio: false, duration: 0 }
      locals.push({ seg, file, hasAudio: p.hasAudio })
    }
    const music: Array<{ a: RenderPlan['audio'][number]; file: string }> = []
    for (const a of plan.audio) music.push({ a, file: await fetchOne(a.src, a.src.fileName ?? 'audio') })

    // 2. Subtitles file + font.
    const font = await bundledFont()
    let srt: string | null = null
    if (plan.subtitles.length > 0 && font) { srt = path.join(work, 'subs.ass'); await fs.writeFile(srt, toAss(plan.subtitles, plan.width, plan.height, font)) }
    const warnings: string[] = []
    if (plan.subtitles.length > 0 && !font) warnings.push('Subtitles were not burned in: no CJK font is bundled on the server yet.')

    // 3. Render.
    const out = path.join(work, 'film.mp4')
    const args = buildFfmpegArgs(plan, locals, music, srt, font, out)
    const t0 = Date.now()
    await run(bin, args, 700_000)
    const buf = await fs.readFile(out)
    console.log(`${LOG} ${id}: ${plan.segments.length} clip(s), ${plan.duration.toFixed(1)}s, ${plan.width}x${plan.height} → ${(buf.length / 1e6).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(0)}s`)

    // 4. Store like a generation.
    const outPath = `${user.id}/xcut-${id}-${Date.now()}.mp4`
    // Resumable (TUS, 6 MB chunks, per-chunk retries) — see lib/xcut-upload.ts.
    try { await uploadFilm({ bucket: OUT_BUCKET, path: outPath, buffer: buf, contentType: 'video/mp4' }) }
    catch (e: any) { throw new Error(`Upload failed: ${e?.message ?? e}`) }
    const { data: signed } = await svc.storage.from(OUT_BUCKET).createSignedUrl(outPath, 60 * 60 * 24)
    const url = signed?.signedUrl ?? null

    let rowId: string | null = null
    try {
      const parents = [...new Set(tl.video.map(c => c.src.rowId).filter((r): r is string => !!r && UUID.test(r)))]
      const { data: row } = await svc.from('xcreates').insert({
        user_id: user.id, mode: 'video', node_kind: 'film', prompt: project.title || 'XCut film',
        slots: [{ name: 'XCut', provider: 'modelxd', model_name: 'xcut', isVideo: true, text: url, cost: 0, options: { duration: plan.duration, resolution: `${plan.width}x${plan.height}` } }],
        board_id: project.source_board_id ?? null, parent_ids: parents.length > 0 ? parents : null,
      }).select('id').single()
      rowId = row?.id ?? null
    } catch (e: any) { console.warn(`${LOG} film row not recorded:`, e?.message) }

    const render = { status: 'done', started_at: started, finished_at: new Date().toISOString(), bucket: OUT_BUCKET, path: outPath, url, row_id: rowId, duration: plan.duration, width: plan.width, height: plan.height, bytes: buf.length, warnings }
    await setRender(render)
    return Response.json({ ok: true, render })
  } catch (err: any) {
    const msg = String(err?.message ?? err).slice(0, 600)
    console.error(`${LOG} ${id} failed:`, msg)
    await setRender({ status: 'error', started_at: started, finished_at: new Date().toISOString(), error: msg })
    return Response.json({ error: msg }, { status: 502 })
  } finally {
    fs.rm(work, { recursive: true, force: true }).catch(() => {})
  }
}
