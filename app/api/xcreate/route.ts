// app/api/xcreate/route.ts
// Private studio: user-specified models, saved to xcreates table.
//
// New architecture (2026-04): the POST handler creates an xcreate_jobs row,
// awaits the generation to completion, and writes progress into
// xcreate_job_slots as each slot advances. The client POSTs and then polls
// /api/xcreate/job/[id] — it does NOT consume the response body. This lets
// navigation leave the page without killing the generation: Vercel Node.js
// serverless keeps functions alive after client disconnect until they finish
// or hit maxDuration.

export const runtime     = 'nodejs'
export const maxDuration = 300

import { getModelById, type ModelInfo } from '@/lib/models'
import { processAttachment }            from '@/lib/attachment'
import * as providers                   from '@/lib/providers'
import { createClient }                 from '@supabase/supabase-js'

const LOG = '[xcreate]'

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } }
  )
}

type SlotOpts = { quality?: string; size?: string; duration?: number }

/**
 * Retry a Supabase Storage upload with exponential backoff on transient
 * network-level failures. The SDK surfaces these as errors whose message is
 * literally "fetch failed" — they come from Node's undici fetch when the
 * connection drops mid-upload. Larger buffers (GPT-5 Image Mini output in
 * particular) seem to trigger it more often on dev machines.
 *
 * Only retries on fetch-level errors; permission/validation errors (bucket
 * not found, mime rejected, duplicate path, etc.) fail fast.
 */
async function uploadWithRetry(
  sb:      ReturnType<typeof serviceClient>,
  bucket:  string,
  path:    string,
  buffer:  Buffer,
  mime:    string,
  attempts = 3,
): Promise<void> {
  let lastErr: any = null
  for (let i = 0; i < attempts; i++) {
    const { error } = await sb.storage.from(bucket).upload(path, buffer, { contentType: mime, upsert: false })
    if (!error) return
    lastErr = error
    const msg = (error.message ?? '').toLowerCase()
    const transient = msg.includes('fetch failed') || msg.includes('network') || msg.includes('socket') || msg.includes('econnreset') || msg.includes('timeout')
    if (!transient) break
    const backoff = 400 * Math.pow(2, i) // 400ms, 800ms, 1600ms
    console.warn(`${LOG} upload attempt ${i+1}/${attempts} failed transiently (${error.message}); retrying in ${backoff}ms`)
    await new Promise(r => setTimeout(r, backoff))
  }
  throw new Error(`Upload failed: ${lastErr?.message ?? 'unknown'}`)
}

async function runSlot(
  sb:         ReturnType<typeof serviceClient>,
  jobId:      string,
  index:      number,
  model:      ModelInfo,
  mode:       string,
  prompt:     string,
  attachment: providers.Attachment | null,
  options:    SlotOpts,
): Promise<{ text: string; isImage: boolean; isVideo: boolean; responseTime: number; cost: number } | null> {
  const start = Date.now()
  console.log(`${LOG} Slot[${index}] ${model.provider}/${model.model_name}`)

  const patch = async (fields: Record<string, any>) => {
    await sb.from('xcreate_job_slots').update(fields).eq('job_id', jobId).eq('slot_index', index)
  }

  try {
    if (mode === 'text') {
      let fullText = ''
      let doneResult = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, cost: 0 }

      // Throttle DB writes during token streaming so we don't hammer the DB.
      let lastWrite = 0
      await providers.streamText(
        model,
        [{ role: 'user', content: prompt }],
        {
          onDelta: (text) => {
            fullText += text
            const now = Date.now()
            if (now - lastWrite > 400) {
              lastWrite = now
              patch({ text: fullText }).catch(() => {})
            }
          },
          onDone:  (r) => { doneResult = r },
          onError: (msg) => { throw new Error(msg) },
        },
        attachment
      )

      const rt = Date.now() - start
      await patch({ text: fullText, streaming: false, done: true, cost: doneResult.cost, response_time: rt })
      return { text: fullText, isImage: false, isVideo: false, responseTime: rt, cost: doneResult.cost }
    }

    if (mode === 'image') {
      await patch({ is_image: true })

      const quality = (options.quality ?? 'medium') as 'low' | 'medium' | 'high'
      const size    = options.size ?? '1024x1024'
      const result  = await providers.generateImage(model, prompt, quality, size, attachment)

      const ext  = result.mediaType.split('/')[1] ?? 'png'
      const path = `${jobId}_slot${index}.${ext}`
      console.log(`${LOG} Slot[${index}] uploading ${result.buffer.length} bytes (${result.mediaType}) to xcreate-ai-images/${path}`)
      await uploadWithRetry(sb, 'xcreate-ai-images', path, result.buffer, result.mediaType)
      const { data: signed, error: signErr } = await sb.storage.from('xcreate-ai-images').createSignedUrl(path, 60 * 60 * 24)
      if (signErr || !signed) throw new Error('Failed to create signed URL')

      const rt = Date.now() - start
      await patch({ text: signed.signedUrl, is_image: true, streaming: false, done: true, cost: result.cost, response_time: rt })
      return { text: signed.signedUrl, isImage: true, isVideo: false, responseTime: rt, cost: result.cost }
    }

    if (mode === 'video') {
      await patch({ is_video: true })

      const videoSize     = options.size ?? '1280x720'
      const videoDuration = options.duration ?? 16
      const result = await providers.generateVideo(
        model, prompt, videoSize, videoDuration, attachment,
        (pct) => { patch({ progress: Math.max(0, Math.min(100, Math.round(pct))) }).catch(() => {}) }
      )

      const ext  = result.mediaType.split('/')[1] ?? 'mp4'
      const path = `${jobId}_slot${index}.${ext}`
      console.log(`${LOG} Slot[${index}] uploading ${result.buffer.length} bytes (${result.mediaType}) to xcreate-ai-videos/${path}`)
      await uploadWithRetry(sb, 'xcreate-ai-videos', path, result.buffer, result.mediaType)
      const { data: signed, error: signErr } = await sb.storage.from('xcreate-ai-videos').createSignedUrl(path, 60 * 60 * 24)
      if (signErr || !signed) throw new Error('Failed to create signed URL')

      const rt = Date.now() - start
      await patch({ text: signed.signedUrl, is_video: true, streaming: false, done: true, cost: result.cost, response_time: rt, progress: 100 })
      return { text: signed.signedUrl, isImage: false, isVideo: true, responseTime: rt, cost: result.cost }
    }

    throw new Error(`Unknown mode: ${mode}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const rt  = Date.now() - start
    console.warn(`${LOG} Slot[${index}] failed after ${rt}ms: ${msg}`)
    try { await patch({ streaming: false, done: true, error: msg, response_time: rt }) } catch {}
    return null
  }
}

export async function POST(req: Request) {
  // Auth
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const supabaseUser = await createSupabaseServer()
  const { data: { user }, error: authError } = await supabaseUser.auth.getUser()
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { prompt, mode = 'text', modelIds, modelOptions = [], attachment: attachmentInput = null, jobId: clientJobId = null } = await req.json()
  console.log(`${LOG} POST prompt="${prompt?.slice(0,50)}" mode=${mode} models=${JSON.stringify(modelIds)} jobId=${clientJobId ?? 'server-generated'}`)

  if (!prompt?.trim() || prompt.trim().length < 3) return Response.json({ error: 'Prompt too short' }, { status: 400 })
  if (!Array.isArray(modelIds) || modelIds.length === 0) return Response.json({ error: 'No models specified' }, { status: 400 })

  // Load models by UUID
  const models = (await Promise.all(modelIds.map((id: string) => getModelById(id)))).filter(Boolean) as ModelInfo[]
  if (models.length === 0) return Response.json({ error: 'No valid models found' }, { status: 400 })

  // Process attachment
  let attachment: providers.Attachment | null = null
  let attachmentId: string | null = null
  if (attachmentInput?.storagePath) {
    try {
      const result = await processAttachment(user.id, attachmentInput.bucket, attachmentInput.storagePath, attachmentInput.mediaType, attachmentInput.fileName, attachmentInput.fileSize)
      attachment   = { buffer: result.buffer, mediaType: result.mediaType }
      attachmentId = result.attachmentId
    } catch (err) { console.warn(`${LOG} attachment failed:`, err) }
  }

  const sb = serviceClient()

  // Close any still-running jobs for this user. We assume a user can only
  // have one generation at a time; if a previous tab was left behind this
  // cleans it up so the active-job lookup returns the new one.
  await sb.from('xcreate_jobs').update({ status: 'failed', error: 'superseded', completed_at: new Date().toISOString() })
    .eq('user_id', user.id).eq('status', 'running')

  // Insert the job row. If the client pre-generated a jobId (so it can start
  // polling before POST returns), use that id; otherwise let Postgres generate.
  const jobInsert: any = {
    user_id: user.id,
    mode,
    prompt,
    attachment_id: attachmentId,
    status: 'running',
  }
  if (clientJobId && typeof clientJobId === 'string') jobInsert.id = clientJobId

  const { data: job, error: jobErr } = await sb.from('xcreate_jobs').insert(jobInsert).select('id').single()
  if (jobErr || !job) {
    console.error(`${LOG} job insert failed:`, jobErr)
    return Response.json({ error: 'Failed to create job' }, { status: 500 })
  }

  // Seed slot rows.
  const slotRows = models.map((m, i) => ({
    job_id:     job.id,
    slot_index: i,
    model_id:   m.id,
    provider:   m.provider,
    model_name: m.model_name,
    name:       m.name,
    options:    modelOptions[i] ?? {},
  }))
  const { error: slotErr } = await sb.from('xcreate_job_slots').insert(slotRows)
  if (slotErr) {
    console.error(`${LOG} slot insert failed:`, slotErr)
    await sb.from('xcreate_jobs').update({ status: 'failed', error: slotErr.message, completed_at: new Date().toISOString() }).eq('id', job.id)
    return Response.json({ error: 'Failed to initialize slots' }, { status: 500 })
  }

  // Run all slots in parallel. Vercel Node.js serverless keeps the function
  // alive after client disconnect up to maxDuration, so we just await.
  const results = await Promise.all(
    models.map((m, i) => runSlot(sb, job.id, i, m, mode, prompt, attachment, modelOptions[i] ?? {}))
  )

  // Save finished run to xcreates table (without chosen_model_id yet — set on pick).
  const slotsForXCreate = models.map((m, i) => ({
    model_id:     m.id,
    provider:     m.provider,
    model_name:   m.model_name,
    name:         m.name,
    text:         results[i]?.text ?? null,
    isImage:      results[i]?.isImage ?? false,
    isVideo:      results[i]?.isVideo ?? false,
    cost:         results[i]?.cost ?? 0,
    responseTime: results[i]?.responseTime ?? 0,
  }))
  const { data: xcreateRow } = await sb.from('xcreates').insert({
    user_id: user.id, mode, prompt,
    slots: slotsForXCreate, attachment_id: attachmentId,
  }).select('id').single()

  await sb.from('xcreate_jobs').update({
    status: 'completed',
    xcreate_id: xcreateRow?.id ?? null,
    completed_at: new Date().toISOString(),
  }).eq('id', job.id)

  return Response.json({ jobId: job.id, xcreateId: xcreateRow?.id ?? null })
}
