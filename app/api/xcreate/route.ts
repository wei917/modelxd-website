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
import { debitCredits, grantCredits, InsufficientCreditsError, getUserCredits, formatCents } from '@/lib/credits'
import { estimateCost } from '@/lib/providers/pricing'
import { sanitizeProviderError } from '@/lib/provider-errors'

const LOG = '[xcreate]'

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } }
  )
}

type SlotOpts = {
  quality?:        string
  size?:           string
  duration?:       number
  aspect_ratio?:   string
  /** Alibaba video and image. null/undefined = use provider default. */
  watermark?:      boolean | null
  /** Number of outputs (image gen). Mainly for qwen-image-2.0 series 1..6. */
  count?:          number | null
  mode?:           string
  thinking_level?: string
}

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
  sb:          ReturnType<typeof serviceClient>,
  userId:      string,
  jobId:       string,
  index:       number,
  model:       ModelInfo,
  mode:        string,
  prompt:      string,
  attachments: providers.Attachment[],
  options:     SlotOpts,
): Promise<{ text: string; isImage: boolean; isVideo: boolean; responseTime: number; cost: number; error?: string; errorRef?: string | null; responseId?: string; conversationHistory?: any[] } | null> {
  const start = Date.now()
  console.log(`${LOG} Slot[${index}] ${model.provider}/${model.model_name}`)

  const patch = async (fields: Record<string, any>) => {
    await sb.from('xcreate_job_slots').update(fields).eq('job_id', jobId).eq('slot_index', index)
  }

  const callContext: providers.CallContext = { userId }

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
        attachments,
        callContext,
        { thinking: options.thinking_level ?? null },
      )

      const rt = Date.now() - start
      await patch({ text: fullText, streaming: false, done: true, cost: doneResult.cost, response_time: rt })
      return { text: fullText, isImage: false, isVideo: false, responseTime: rt, cost: doneResult.cost }
    }

    if (mode === 'image') {
      await patch({ is_image: true })

      const quality = (options.quality ?? 'medium') as 'low' | 'medium' | 'high'
      const size    = options.size ?? '1024x1024'
      const result  = await providers.generateImage(
        model, prompt, quality, size, attachments, null, null, callContext,
        {
          watermark:    options.watermark ?? null,
          aspect_ratio: options.aspect_ratio ?? null,
          count:        options.count ?? null,
        },
      )

      // Multi-image support: upload primary + extras. URLs joined with '\n'
      // in the slot's `text` field; UI splits on newlines and renders a grid.
      const allImages = [
        { buffer: result.buffer, mediaType: result.mediaType },
        ...(result.extras ?? []),
      ]
      console.log(`${LOG} Slot[${index}] uploading ${allImages.length} image(s) (${allImages.map(im => im.buffer.length).join('+')} bytes)`)

      const signedUrls: string[] = []
      for (let imgIdx = 0; imgIdx < allImages.length; imgIdx++) {
        const im   = allImages[imgIdx]
        const ext  = im.mediaType.split('/')[1] ?? 'png'
        const suffix = allImages.length > 1 ? `_${imgIdx}` : ''
        const path = `${userId}/${jobId}_slot${index}${suffix}.${ext}`
        await uploadWithRetry(sb, 'xcreate-ai-images', path, im.buffer, im.mediaType)
        // Short 24h TTL — XCreate is private, so we don't want leaked
        // signed URLs to work forever. The profile gallery page re-signs
        // on load (parses bucket+path out of the stored URL), so a
        // short TTL is fine in practice: the user always sees a fresh
        // URL when they revisit.
        const { data: signed, error: signErr } = await sb.storage.from('xcreate-ai-images').createSignedUrl(path, 60 * 60 * 24)
        if (signErr || !signed) throw new Error('Failed to create signed URL')
        signedUrls.push(signed.signedUrl)

        // Per-image media event in provider_calls.
        providers.logMediaUrl(result.requestId, {
          provider: model.provider, model_name: model.model_name, model_id: model.id ?? null,
          mode: 'image', user_id: userId,
        }, `xcreate-ai-images/${path}`)
      }

      const joinedUrls = signedUrls.join('\n')
      const rt = Date.now() - start
      await patch({ text: joinedUrls, is_image: true, streaming: false, done: true, cost: result.cost, response_time: rt })
      return {
        text: joinedUrls, isImage: true, isVideo: false, responseTime: rt, cost: result.cost,
        responseId: result.responseId,                    // OpenAI multi-turn
        conversationHistory: result.conversationHistory,  // Google multi-turn
      }
    }

    if (mode === 'video') {
      await patch({ is_video: true })

      const videoSize     = options.size ?? '1280x720'
      const videoDuration = options.duration ?? 16
      // Watermark is Alibaba-only and tri-state (null/true/false). Forward
      // exactly what the user picked; the router only sends it when truthy
      // and only to Alibaba. Aspect ratio is passed through as `ratio`.
      const videoWatermark:   boolean | null = options.watermark ?? null
      const videoAspectRatio: string  | null = options.aspect_ratio ?? null
      console.log(`${LOG} Slot[${index}] video options received: watermark=${JSON.stringify(options.watermark)} aspect_ratio=${JSON.stringify(options.aspect_ratio)} → forwarding watermark=${videoWatermark}`)
      const result = await providers.generateVideo(
        model, prompt, videoSize, videoDuration, attachments,
        (pct) => { patch({ progress: Math.max(0, Math.min(100, Math.round(pct))) }).catch(() => {}) },
        callContext,
        { watermark: videoWatermark, aspect_ratio: videoAspectRatio, mode: options.mode ?? null },
      )

      const ext  = result.mediaType.split('/')[1] ?? 'mp4'
      const path = `${userId}/${jobId}_slot${index}.${ext}`
      console.log(`${LOG} Slot[${index}] uploading ${result.buffer.length} bytes (${result.mediaType}) to xcreate-ai-videos/${path}`)
      await uploadWithRetry(sb, 'xcreate-ai-videos', path, result.buffer, result.mediaType)
      // 24h TTL — see image-upload comment above. Profile gallery
      // re-signs on load so this stays fresh through normal use.
      const { data: signed, error: signErr } = await sb.storage.from('xcreate-ai-videos').createSignedUrl(path, 60 * 60 * 24)
      if (signErr || !signed) throw new Error('Failed to create signed URL')

      providers.logMediaUrl(result.requestId, {
        provider: model.provider, model_name: model.model_name, model_id: model.id ?? null,
        mode: 'video', user_id: userId,
      }, `xcreate-ai-videos/${path}`)

      const rt = Date.now() - start
      await patch({ text: signed.signedUrl, is_video: true, streaming: false, done: true, cost: result.cost, response_time: rt, progress: 100 })
      return { text: signed.signedUrl, isImage: false, isVideo: true, responseTime: rt, cost: result.cost }
    }

    throw new Error(`Unknown mode: ${mode}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const rt  = Date.now() - start
    const ref = (err as any)?.requestId ?? null
    console.warn(`${LOG} Slot[${index}] failed after ${rt}ms (ref=${ref}): ${msg}`)
    const userMsg = sanitizeProviderError(msg)
    try { await patch({ streaming: false, done: true, error: userMsg, error_ref: ref, response_time: rt }) } catch {}
    // Return the error (instead of null) so it gets persisted into the
    // xcreates.slots row below. Otherwise a failed slot shows its error live
    // (read from xcreate_job_slots) but becomes a blank card when the run is
    // reopened from the gallery, because the error was never saved.
    return { text: '', isImage: false, isVideo: false, responseTime: rt, cost: 0, error: userMsg, errorRef: ref }
  }
}

export async function POST(req: Request) {
  // Auth
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const supabaseUser = await createSupabaseServer()
  const { data: { user }, error: authError } = await supabaseUser.auth.getUser()
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Verified-user gate. Google OAuth auto-confirms email at sign-up, so
  // this is a no-op today; protects future email/password flows.
  if (!user.email_confirmed_at) {
    return Response.json(
      { error: 'email_not_verified', message: 'Please verify your email before using XCreate.' },
      { status: 403 },
    )
  }

  const { prompt, mode = 'text', modelIds, modelOptions = [], attachments: attachmentInputs = [], attachment: legacyAttachmentInput = null, jobId: clientJobId = null } = await req.json()
  console.log(`${LOG} POST prompt="${prompt?.slice(0,50)}" mode=${mode} models=${JSON.stringify(modelIds)} jobId=${clientJobId ?? 'server-generated'}`)

  // In video/image mode an attached file (image_to_video, image_to_image,
  // reference_frames, etc.) is enough to drive generation — the model can
  // animate or transform the input without any text. Only require a prompt
  // when there's no attachment to fall back on.
  const attachmentList: any[] = (Array.isArray(attachmentInputs) && attachmentInputs.length > 0)
    ? attachmentInputs
    : (legacyAttachmentInput ? [legacyAttachmentInput] : [])
  const hasAttachmentInput = attachmentList.some(a => a?.storagePath)
  const promptTooShort = !prompt?.trim() || prompt.trim().length < 3
  const promptIsOptional = (mode === 'video' || mode === 'image') && hasAttachmentInput
  if (promptTooShort && !promptIsOptional) {
    return Response.json({ error: 'Prompt too short' }, { status: 400 })
  }
  // Cap prompt size (client enforces maxLength=8000; this is the backstop).
  // Long text belongs in a .txt attachment — folded server-side with a 200k-char guardrail.
  if (typeof prompt === 'string' && prompt.length > 8000) {
    return Response.json({ error: 'Prompt too long (max 8,000 characters) — attach long text as a .txt file instead.' }, { status: 400 })
  }
  if (!Array.isArray(modelIds) || modelIds.length === 0) return Response.json({ error: 'No models specified' }, { status: 400 })

  // Load models by UUID
  const models = (await Promise.all(modelIds.map((id: string) => getModelById(id)))).filter(Boolean) as ModelInfo[]
  if (models.length === 0) return Response.json({ error: 'No valid models found' }, { status: 400 })

  // ── Pre-flight balance gate ────────────────────────────────────────────
  // The debit at the bottom of this route runs AFTER generation, and its
  // InsufficientCreditsError was caught-and-logged while the job still
  // completed — so a user at $0 kept the output and ModelXD ate the provider
  // bill. Four generations across two accounts had already run that way,
  // with zero credit_transactions rows, before this landed (CC, July 26).
  //
  // Estimate with the same estimateCost() the client uses for its
  // "Estimated Cost ~$X" line, and apply the same multi-model discount, so
  // the figure we gate on is the figure the user was shown. The exact cost
  // is only knowable after generation; this is deliberately the estimate.
  // Stable id up front: the reserve, the job row and the reconciliation all
  // key off the same value, and the reserve happens before the row exists.
  const jobIdForRun: string = (clientJobId && typeof clientJobId === 'string')
    ? clientJobId
    : crypto.randomUUID()
  let reservedCents = 0
  {
    const { discountFor } = await import('@/lib/xcreate-discount')
    const estDollars = models.reduce((sum, m, i) => {
      const o = (modelOptions[i] ?? {}) as Record<string, any>
      return sum + estimateCost(m, mode as 'text' | 'image' | 'video', {
        promptChars: typeof prompt === 'string' ? prompt.length : 0,
        quality:     o.quality,
        size:        o.size,
        resolution:  o.size ?? o.resolution,
        seconds:     o.duration ?? o.seconds,
      })
    }, 0)
    const estCents = Math.round(estDollars * 100 * (1 - discountFor(models.length)))
    if (estCents > 0) {
      // RESERVE, don't just check. Runs are concurrent now, so a plain
      // balance check would let N simultaneous requests each see the same
      // healthy balance and all pass before the first debit lands. Debiting
      // the estimate here makes the balance authoritative; the real cost is
      // settled against this reserve once generation finishes.
      try {
        await debitCredits({
          userId:        user.id,
          amountCents:   estCents,
          referenceType: 'xcreate_reserve',
          referenceId:   jobIdForRun,
          description:   `XCreate ${mode} reserve (${models.length} model${models.length > 1 ? 's' : ''})`,
          metadata:      { mode, modelCount: models.length, jobId: jobIdForRun, estimateCents: estCents },
        })
        reservedCents = estCents
      } catch (err) {
        if (err instanceof InsufficientCreditsError) {
          const credits = await getUserCredits(user.id)
          const balanceCents = credits?.balance_cents ?? 0
          console.warn(`${LOG} blocked: needs ~${estCents}c, balance ${balanceCents}c (user ${user.id})`)
          return Response.json({
            error:   'insufficient_credits',
            message: `This run costs about ${formatCents(estCents)} and your balance is ${formatCents(balanceCents)}.`,
            requiredCents: estCents,
            balanceCents,
          }, { status: 402 })
        }
        throw err
      }
    }
  }

  // Process attachments (supports both new array and legacy single attachment)
  const rawInputs: any[] = Array.isArray(attachmentInputs) && attachmentInputs.length > 0
    ? attachmentInputs
    : legacyAttachmentInput ? [legacyAttachmentInput] : []
  const attachments: providers.Attachment[] = []
  let attachmentId: string | null = null
  // Re-use the service client for signed-URL generation on attachment
  // inputs. Some providers (Alibaba I2V) require a HTTP(S) URL for the
  // input image; we sign the original Supabase storage object so they
  // can fetch it directly instead of receiving inline base64.
  const sb = serviceClient()
  for (const inp of rawInputs) {
    if (!inp?.storagePath) continue
    try {
      const result = await processAttachment(user.id, inp.bucket, inp.storagePath, inp.mediaType, inp.fileName, inp.fileSize)
      const attach: providers.Attachment = { buffer: result.buffer, mediaType: result.mediaType }
      // Providers get the RESIZED copy's signed URL (1h) — images are
      // capped at 1920px server-side, so a 4K upload never reaches the
      // model at full size (output tops out around 2K anyway). Videos
      // pass through unresized; their 'resized' copy is byte-identical.
      if (result.mediaType.startsWith('image/') || result.mediaType.startsWith('video/')) {
        attach.url = result.resizedUrl
      }
      attachments.push(attach)
      if (!attachmentId) attachmentId = result.attachmentId  // keep first for DB reference
    } catch (err) { console.warn(`${LOG} attachment failed:`, err) }
  }

  // Runs are concurrent (CC, July 26). This used to fail every other running
  // job for the user on each new POST, on the assumption of one generation at
  // a time — which is exactly what stopped a second run from being startable.
  // Stale rows are now the job list's problem, not this route's.

  // Insert the job row. If the client pre-generated a jobId (so it can start
  // polling before POST returns), use that id; otherwise let Postgres generate.
  const jobInsert: any = {
    user_id: user.id,
    mode,
    prompt,
    attachment_id: attachmentId,
    status: 'running',
  }
  jobInsert.id = jobIdForRun

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
    name:       m.display_name,
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
    models.map((m, i) => runSlot(sb, user.id, job.id, i, m, mode, prompt, attachments, modelOptions[i] ?? {}))
  )

  // Save finished run to xcreates table (without chosen_model_id yet — set on pick).
  // Persist the exact options each slot ran with so re-entering the run from
  // the profile gallery can show "this was generated at 720p, 6s, watermark
  // off" etc. without having to re-derive from the cost / output alone.
  const slotsForXCreate = models.map((m, i) => ({
    model_id:     m.id,
    provider:     m.provider,
    model_name:   m.model_name,
    name:         m.display_name,
    text:         results[i]?.text ?? null,
    isImage:      results[i]?.isImage ?? false,
    isVideo:      results[i]?.isVideo ?? false,
    cost:         results[i]?.cost ?? 0,
    responseTime: results[i]?.responseTime ?? 0,
    error:        results[i]?.error ?? null,
    errorRef:     results[i]?.errorRef ?? null,
    options:      modelOptions[i] ?? {},  // mode/quality/size/duration/aspect_ratio/watermark/count
    // Multi-turn image editing context
    responseId:          results[i]?.responseId ?? null,           // OpenAI
    conversationHistory: results[i]?.conversationHistory ?? null,  // Google
  }))
  const { data: xcreateRow } = await sb.from('xcreates').insert({
    user_id: user.id, mode, prompt,
    slots: slotsForXCreate, attachment_id: attachmentId,
    // Full input list (July 19) — lets the gallery restore the original
    // uploads when a past run is reopened (attachment_id only kept #1).
    input_attachments: rawInputs
      .filter((i: any) => i?.storagePath)
      .map((i: any) => ({ storagePath: i.storagePath, bucket: i.bucket, mediaType: i.mediaType, fileName: i.fileName, fileSize: i.fileSize })),
  }).select('id').single()

  // ── Phase 2: Debit credits for total generation cost ──────────────────
  // Multi-model runs get a discount (CC, July 19): 2 models −10%,
  // 3 −15%, 4 −20%. Table lives in lib/xcreate-discount.ts (shared with
  // the composer UI, which shows the same rate as a red label).
  const { discountFor } = await import('@/lib/xcreate-discount')
  const discount = discountFor(models.length)
  const totalCostDollars = slotsForXCreate.reduce((sum, s) => sum + (s.cost ?? 0), 0)
  const preDiscountCents = Math.round(totalCostDollars * 100)
  const totalCostCents   = Math.round(preDiscountCents * (1 - discount))
  // Settle against the reserve taken before generation. The reserve was the
  // estimate; now that the real cost is known, charge or refund the delta.
  // A run that failed outright has totalCostCents 0, so the whole reserve
  // comes back automatically.
  const deltaCents = totalCostCents - reservedCents
  const settleMeta = { mode, modelCount: models.length, jobId: job.id, discount, preDiscountCents, reservedCents, actualCents: totalCostCents }
  if (deltaCents > 0) {
    try {
      await debitCredits({
        userId:        user.id,
        amountCents:   deltaCents,
        referenceType: 'xcreate',
        referenceId:   xcreateRow?.id ?? job.id,
        description:   `XCreate ${mode} settle (ran ${formatCents(deltaCents)} over estimate)`,
        metadata:      settleMeta,
      })
      console.log(`${LOG} settled +${deltaCents}¢ over the ${reservedCents}¢ reserve for job ${job.id}`)
    } catch (err) {
      // The reserve already covered the estimate, so the worst case here is
      // absorbing the overage on this one run — never charging for nothing.
      console.warn(`${LOG} settle debit failed for job ${job.id} (delta ${deltaCents}¢):`, err)
    }
  } else if (deltaCents < 0) {
    try {
      await grantCredits({
        userId:        user.id,
        amountCents:   -deltaCents,
        kind:          'refund',
        referenceType: 'xcreate_refund',
        referenceId:   xcreateRow?.id ?? job.id,
        description:   totalCostCents === 0
          ? `XCreate ${mode} refund (run produced nothing)`
          : `XCreate ${mode} refund (came in under estimate)`,
        metadata:      settleMeta,
      })
      console.log(`${LOG} refunded ${-deltaCents}¢ of the ${reservedCents}¢ reserve for job ${job.id}`)
    } catch (err) {
      console.error(`${LOG} refund failed for job ${job.id} (owed ${-deltaCents}¢):`, err)
    }
  }

  await sb.from('xcreate_jobs').update({
    status: 'completed',
    xcreate_id: xcreateRow?.id ?? null,
    completed_at: new Date().toISOString(),
  }).eq('id', job.id)

  return Response.json({ jobId: job.id, xcreateId: xcreateRow?.id ?? null })
}
