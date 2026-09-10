// app/api/xworld/route.ts — XWorld: list mine, or start one.
//   kind 'world'  → World Labs Marble (text / image / multi-image / video → 3D world)
//   kind 'object' → Tripo (photo → 3D object), through the same lib/tripo.ts
//                   billing the public proxy uses.
// Uploads arrive as storage paths (AttachmentButton.commitAttachments files
// them under the uploader's id); they are signed HERE for the provider to
// fetch, after checking the path really is the caller's.

export const runtime = 'nodejs'

import { createSupabaseServer } from '@/lib/supabase-server'
import { InsufficientCreditsError, getUserCredits } from '@/lib/credits'
import { createWorld, worldPrompt, worldlabsKey, service } from '@/lib/worldlabs'
import { WORLD_MODELS, OBJECT_MODELS, DEFAULT_WORLD_MODEL, DEFAULT_OBJECT_MODEL, type WorldInput } from '@/lib/xworld-models'
import { tripoKey, tripoPost, recordTask, listPriceCents } from '@/lib/tripo'

const LOG = '[xworld]'
const INPUTS: WorldInput[] = ['text', 'image', 'multi-image', 'video']
const BUCKETS = new Set(['xcreate-user-images', 'xcreate-user-videos'])

type Att = { bucket: string; storagePath: string; mediaType: string }

export async function GET() {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { data, error } = await sb.from('xworlds')
    .select('id, kind, provider, model, prompt, status, progress, caption, thumbnail_url, billed_cents, error, created_at')
    .is('deleted_at', null).order('created_at', { ascending: false }).limit(60)
  if (error) {
    const msg = /xworlds/.test(error.message) ? 'XWorld is not set up yet (run supabase/96_xworld.sql).' : error.message
    return Response.json({ error: msg }, { status: 503 })
  }
  return Response.json({ items: data ?? [] })
}

export async function POST(req: Request) {
  const sb = await createSupabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const kind = body?.kind === 'object' ? 'object' : 'world'
  const promptText = typeof body?.prompt === 'string' ? body.prompt.trim().slice(0, 2000) : ''
  const atts: Att[] = Array.isArray(body?.attachments) ? body.attachments : []

  // Every attachment must be one of OUR upload buckets, under the caller's id.
  for (const a of atts) {
    if (!a || !BUCKETS.has(a.bucket) || typeof a.storagePath !== 'string' || !a.storagePath.startsWith(`${user.id}/`)) {
      return Response.json({ error: 'Invalid attachment' }, { status: 400 })
    }
  }
  const svc = service()
  const sign = async (a: Att) => {
    const { data, error } = await svc.storage.from(a.bucket).createSignedUrl(a.storagePath, 60 * 60)
    if (error || !data?.signedUrl) throw new Error(`Could not read ${a.storagePath}`)
    return data.signedUrl
  }
  const images = atts.filter(a => a.mediaType?.startsWith('image/'))
  const videos = atts.filter(a => a.mediaType?.startsWith('video/'))
  const inputRecord = { attachments: atts.map(({ bucket, storagePath, mediaType }) => ({ bucket, storagePath, mediaType })) }

  // ── Photo → 3D object (Tripo) ───────────────────────────────────────
  if (kind === 'object') {
    if (!tripoKey()) return Response.json({ error: '3D objects are not configured on this deployment.' }, { status: 503 })
    const model = OBJECT_MODELS[body?.model] ? body.model : DEFAULT_OBJECT_MODEL
    if (images.length !== 1) return Response.json({ error: 'Attach exactly one photo of the object.' }, { status: 400 })
    const cents = listPriceCents('image_to_model', model, true)
    // Tripo starts the paid task before we can debit it, so check first.
    const bal = await getUserCredits(user.id).catch(() => null)
    if (!bal || Number(bal.balance_cents) < cents) return Response.json({ error: 'insufficient_credits', need_cents: cents }, { status: 402 })
    const ext = images[0].mediaType === 'image/png' ? 'png' : images[0].mediaType === 'image/webp' ? 'webp' : 'jpg'
    let url: string
    try { url = await sign(images[0]) } catch (e: any) { return Response.json({ error: e.message }, { status: 400 }) }
    const { status, json } = await tripoPost('/generation/image-to-model', { model, texture: true, file: { type: ext, url } })
    const taskId = json?.data?.task_id
    if (status !== 200 || !taskId) {
      console.error(`${LOG} tripo create ${status}:`, JSON.stringify(json).slice(0, 400))
      return Response.json({ error: json?.message ?? json?.error ?? `Tripo answered ${status}` }, { status: 502 })
    }
    try {
      await recordTask({ userId: user.id, taskId, kind: 'image_to_model', params: { model, texture: true, source: 'xworld' }, billCents: cents })
    } catch (e: any) {
      if (e instanceof InsufficientCreditsError) return Response.json({ error: 'insufficient_credits' }, { status: 402 })
      throw e
    }
    const { data: row, error } = await svc.from('xworlds').insert({
      user_id: user.id, kind: 'object', provider: 'tripo', model, prompt: promptText || null,
      input: { type: 'image', ...inputRecord }, task_id: taskId, billed_cents: cents,
    }).select('id').single()
    if (error) console.error(`${LOG} ledger insert failed for tripo ${taskId}:`, error.message)
    return Response.json({ id: row?.id ?? null, task_id: taskId })
  }

  // ── World (World Labs) ──────────────────────────────────────────────
  if (!worldlabsKey()) return Response.json({ error: 'XWorld is not configured on this deployment.' }, { status: 503 })
  const model = WORLD_MODELS[body?.model] ? body.model : DEFAULT_WORLD_MODEL
  const input: WorldInput = INPUTS.includes(body?.input) ? body.input : 'text'
  if (input === 'text' && !promptText) return Response.json({ error: 'Describe the world you want.' }, { status: 400 })
  if (input === 'image' && images.length !== 1) return Response.json({ error: 'Attach one image.' }, { status: 400 })
  if (input === 'multi-image' && (images.length < 2 || images.length > 4)) return Response.json({ error: 'Attach 2 to 4 images.' }, { status: 400 })
  if (input === 'video' && videos.length !== 1) return Response.json({ error: 'Attach one video.' }, { status: 400 })

  let prompt: Record<string, unknown>
  try {
    const imageUrls = await Promise.all(images.map(sign))
    const videoUrl = videos[0] ? await sign(videos[0]) : undefined
    const azimuths = Array.isArray(body?.azimuths) ? body.azimuths.map((n: any) => Number(n) || 0) : images.map((_, i) => Math.round((360 / images.length) * i))
    prompt = worldPrompt(input, { text: promptText, imageUrls, azimuths, videoUrl })
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 400 })
  }

  try {
    const out = await createWorld({
      userId: user.id, model, input, prompt, promptText: promptText || null, inputRecord: { type: input, ...inputRecord },
      displayName: promptText.slice(0, 64) || `XWorld ${input}`,
    })
    if ('error' in out) return Response.json({ error: out.error }, { status: out.status })
    return Response.json({ id: out.row.id ?? null, task_id: out.row.task_id })
  } catch (e: any) {
    if (e instanceof InsufficientCreditsError) return Response.json({ error: 'insufficient_credits' }, { status: 402 })
    console.error(`${LOG} create threw:`, e?.message ?? e)
    return Response.json({ error: 'Could not start the world' }, { status: 500 })
  }
}
