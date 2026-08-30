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
// 800 (Vercel Fluid max): a reasoning model at full budget — K3 measured
// at ~26 tok/s spending 2k+ tokens thinking — needs more than 300s. The
// gateway may still drop the held POST early; that's fine, the client
// ignores gateway timeouts and the job polling owns delivery.
export const maxDuration = 800

import { getModelById, type ModelInfo } from '@/lib/models'
import { processAttachment }            from '@/lib/attachment'
import * as providers                   from '@/lib/providers'
import { createClient }                 from '@supabase/supabase-js'
import { debitCredits, grantCredits, InsufficientCreditsError, getUserCredits, formatCents } from '@/lib/credits'
import { estimateCost, searchRate, supportsWebSearch, resolveTokenRate } from '@/lib/providers/pricing'
import { sanitizeProviderError } from '@/lib/provider-errors'
import { portSchemaFor, assignPorts, toWires } from '@/lib/ports'

const LOG = '[xcreate]'

// ── Dev mock mode (CC, July 29) ──────────────────────────────────────────
// Every end-to-end video test was costing about a dollar, which makes
// iterating on the pipeline — the agent, the plan card, the board, the
// polling, the lineage — absurdly expensive when none of that needs a real
// generation to exercise.
//
// With XCREATE_MOCK=1 the provider call is skipped and a previous output of
// the same mode is returned instead. EVERYTHING else runs for real: job
// row, slot rows, progress, the xcreates insert, parent/board lineage, the
// gallery entry. Cost is forced to zero, so no reserve and no settle.
//
// Two independent locks so this can never bill-skip in production: the env
// var must be set AND NODE_ENV must not be production.
function mockEnabled(): boolean {
  return process.env.XCREATE_MOCK === '1' && process.env.NODE_ENV !== 'production'
}

/**
 * Borrow the newest real output this user already has for `mode`, so the UI
 * gets a genuine signed URL and video/image element rather than a
 * placeholder. Returns null when they have no prior output to reuse.
 */
async function mockMedia(
  sb: ReturnType<typeof serviceClient>,
  userId: string,
  mode: string,
): Promise<{ text: string; isImage: boolean; isVideo: boolean } | null> {
  const { data } = await sb.from('xcreates')
    .select('slots')
    .eq('user_id', userId).eq('mode', mode)
    .order('created_at', { ascending: false })
    .limit(12)
  for (const row of data ?? []) {
    const slots: any[] = Array.isArray((row as any).slots) ? (row as any).slots : []
    const hit = slots.find(sl => typeof sl?.text === 'string' && sl.text.includes('/storage/v1/object/sign/') && !sl.error)
    if (!hit) continue
    // Re-sign: stored URLs carry a 1h TTL and are usually stale by now.
    const m = String(hit.text).split('\n')[0].match(/\/storage\/v1\/object\/sign\/([^/]+)\/([^?]+)/)
    if (!m) continue
    const { data: signed } = await sb.storage.from(m[1]).createSignedUrl(decodeURIComponent(m[2]), 60 * 60)
    if (!signed?.signedUrl) continue
    return { text: signed.signedUrl, isImage: !!hit.isImage, isVideo: !!hit.isVideo }
  }
  return null
}

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
  /** Wan 3.0: ask for a silent clip. The MV path sets this false — the
   *  song is laid over the cut afterwards, so a generated soundtrack is
   *  discarded either way. */
  generate_audio?: boolean | null
  /** Wan 3.0: reproducible take, [0, 2147483647]. */
  seed?:           number | null
  mode?:           string
  thinking_level?: string
  /** Let this slot's model use the provider's built-in web search. The
   *  router (lib/providers) re-checks the model's capability, so a stale
   *  true from an older client can't reach a provider that would reject it. */
  web_search?:     boolean
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


/**
 * Image APIs take a pixel size, not a ratio, and only support a handful of
 * buckets. Snap any "w:h" to the nearest supported one: square, portrait
 * (2:3 — the closest thing to 9:16 on offer) or landscape (3:2).
 */
function sizeForAspect(aspect: unknown): string | null {
  if (typeof aspect !== 'string') return null
  const m = aspect.match(/^\s*(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)\s*$/)
  if (!m) return null
  const w = parseFloat(m[1]), h = parseFloat(m[2])
  if (!(w > 0 && h > 0)) return null
  const r = w / h
  const buckets: Array<[number, string]> = [
    [1024 / 1536, '1024x1536'],  // portrait — 9:16, 4:5, 2:3 all land here
    [1, '1024x1024'],            // square
    [1536 / 1024, '1536x1024'],  // landscape — 16:9, 3:2
  ]
  return buckets.reduce((best, b) =>
    Math.abs(Math.log(r / b[0])) < Math.abs(Math.log(r / best[0])) ? b : best
  )[1]
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

  // Mock: pretend to work, return a prior output, charge nothing. Placed
  // after the slot row exists so the client's polling sees the same
  // running → done transition it always does.
  if (mockEnabled()) {
    await patch({ streaming: true, progress: 10 })
    await new Promise(r => setTimeout(r, 1200))
    const media = await mockMedia(sb, userId, mode)
    const text = media?.text ?? '[mock] no prior output of this mode to reuse'
    await patch({
      text, is_image: !!media?.isImage, is_video: !!media?.isVideo,
      streaming: false, done: true, cost: 0, response_time: Date.now() - start, progress: 100,
    })
    console.log(`${LOG} Slot[${index}] MOCK (no provider call, $0)`)
    return {
      text, isImage: !!media?.isImage, isVideo: !!media?.isVideo,
      responseTime: Date.now() - start, cost: 0,
    }
  }

  try {
    // Audio → timestamped transcript (owner, Aug 9). Its own path: no token
    // streaming, one provider call, cost billed per audio minute. The user's
    // prompt is the transcription BIAS (known lyrics snap timestamps).
    if (mode === 'text' && options.mode === 'audio_to_text') {
      // A model with no transcription path fails HERE with a plain sentence
      // — not deep in the provider router with a misleading "no text
      // implementation". openai (Whisper) and alibaba (Qwen3-ASR) qualify.
      if (model.provider !== 'openai' && model.provider !== 'alibaba') {
        throw new Error(`${model.display_name ?? model.model_name} cannot transcribe audio — pick a transcription model (Whisper 1 or Qwen3-ASR).`)
      }
      // Video rides too (owner, Aug 9): Whisper reads MP4/WebM containers
      // directly and transcribes the audio track. MOV it cannot, and the
      // API caps uploads at 25MB — fail with instructions, not a 400.
      const audio = attachments.find(a => (a.mediaType ?? '').startsWith('audio/'))
        ?? attachments.find(a => ['video/mp4', 'video/webm', 'video/mpeg'].includes(a.mediaType ?? ''))
      if (!audio) {
        const vid = attachments.find(a => (a.mediaType ?? '').startsWith('video/'))
        throw new Error(vid
          ? 'This video format cannot be transcribed directly — export it as MP4/WebM, or extract the audio (MP3/M4A) first.'
          : 'Attach an audio file (MP3 / M4A / WAV) or an MP4 video to transcribe.')
      }
      // 25MB is OpenAI's inline-upload cap; DashScope fetches by URL and
      // has no such limit, so only gate the Whisper path.
      if (model.provider === 'openai' && audio.buffer.length > 25 * 1024 * 1024) {
        throw new Error(`The file is ${(audio.buffer.length / 1048576).toFixed(0)}MB — Whisper caps uploads at 25MB. Use Qwen3-ASR for large files, or extract the audio track (MP3/M4A).`)
      }
      await patch({ streaming: true, progress: 15 })
      const r = await providers.transcribeAudio(model, audio, prompt || null, callContext)
      const rt = Date.now() - start
      await patch({ text: r.text, streaming: false, done: true, cost: r.cost, response_time: rt, progress: 100 })
      console.log(`${LOG} Slot[${index}] transcribed ${r.durationSeconds.toFixed(0)}s audio ($${r.cost.toFixed(4)})`)
      return { text: r.text, isImage: false, isVideo: false, responseTime: rt, cost: r.cost }
    }

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
        { thinking: options.thinking_level ?? null, search: options.web_search === true },
      )

      const rt = Date.now() - start
      await patch({ text: fullText, streaming: false, done: true, cost: doneResult.cost, response_time: rt })
      return { text: fullText, isImage: false, isVideo: false, responseTime: rt, cost: doneResult.cost }
    }

    if (mode === 'image') {
      await patch({ is_image: true })

      const quality = (options.quality ?? 'medium') as 'low' | 'medium' | 'high'
      // aspect_ratio alone was silently dropped for stills: `size` defaults
      // to a square and `size` is what the image APIs actually honour, so a
      // caller asking for 9:16 got a 1024x1024 back with no error anywhere.
      // Derive size from the ratio whenever an explicit size wasn't given.
      const size    = options.size ?? sizeForAspect(options.aspect_ratio) ?? '1024x1024'
      // Typed ports: each model sees the attachments through ITS OWN port
      // schema (shallow copies — the shared array serves every slot).
      // The mask reaches ONLY models that declare region_edit — anyone
      // else in the run would receive it as a plain source image and
      // faithfully repaint the stencil.
      const eligible = attachments.filter(a =>
        a.port !== 'mask' || (model.modes ?? []).includes('region_edit'))
      const wired   = assignPorts(portSchemaFor(model), eligible)
      const result  = await providers.generateImage(
        model, prompt, quality, size, wired, null, null, callContext,
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
      const uploadedRefs: providers.HistoryImageCandidate[] = []
      for (let imgIdx = 0; imgIdx < allImages.length; imgIdx++) {
        const im   = allImages[imgIdx]
        const ext  = im.mediaType.split('/')[1] ?? 'png'
        const suffix = allImages.length > 1 ? `_${imgIdx}` : ''
        const path = `${userId}/${jobId}_slot${index}${suffix}.${ext}`
        await uploadWithRetry(sb, 'xcreate-ai-images', path, im.buffer, im.mediaType)
        uploadedRefs.push({ bucket: 'xcreate-ai-images', path, buffer: im.buffer, mimeType: im.mediaType })
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

      // Persist POINTERS, not bytes: swap each inline image in the Google
      // multi-turn history for a marker referencing its storage object.
      // The outputs were just uploaded and every attachment carries its
      // stored copy, so this is pure byte-matching. Persisting the inline
      // form is what made slots weigh 11-12MB and the board query take 15s.
      let storedHistory: any[] | undefined = undefined
      if (result.conversationHistory) {
        try {
          const candidates: providers.HistoryImageCandidate[] = [
            ...uploadedRefs,
            ...attachments.flatMap(a => (a.storageRef && a.mediaType.startsWith('image/'))
              ? [{ bucket: a.storageRef.bucket, path: a.storageRef.path, buffer: a.buffer, mimeType: a.mediaType }]
              : []),
          ]
          storedHistory = await providers.dehydrateHistory(result.conversationHistory, candidates, {
            sb, bucket: 'xcreate-ai-images', pathPrefix: `${userId}/hist/`,
          }) ?? undefined
        } catch (err) {
          // Bookkeeping must never fail a paid generation — fall back to the
          // fat form rather than erroring the slot.
          console.warn(`${LOG} Slot[${index}] history dehydration failed, storing inline:`, err instanceof Error ? err.message : err)
          storedHistory = result.conversationHistory
        }
      }

      await patch({ text: joinedUrls, is_image: true, streaming: false, done: true, cost: result.cost, response_time: rt })
      return {
        text: joinedUrls, isImage: true, isVideo: false, responseTime: rt, cost: result.cost,
        responseId: result.responseId,          // OpenAI multi-turn
        conversationHistory: storedHistory,     // Google multi-turn (storage markers)
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
      // Same rule as the image branch: the mask reaches ONLY models that
      // declare region_edit — anyone else in the run would shoot the
      // stencil as a reference image.
      const videoEligible = attachments.filter(a =>
        a.port !== 'mask' || (model.modes ?? []).includes('region_edit'))
      const wired = assignPorts(portSchemaFor(model), videoEligible)
      if (wired.some(a => a.port)) {
        console.log(`${LOG} Slot[${index}] ports: ${wired.map(a => a.port ?? '·').join(', ')}`)
      }

      // Veo extension: the provider needs Google's own video reference —
      // Veo cannot extend our stored MP4, only its own prior outputs, and
      // only for ~2 days. Resolve the ref from the source row's persisted
      // slot metadata; refuse uploads and stale refs with a message that
      // says what to do instead.
      let extendVideoRef: string | null = null
      if (model.provider === 'google' && options.mode === 'extend_video') {
        const srcWire = wired.find(a => a.mediaType.startsWith('video/'))?.wireSource
        if (!srcWire || srcWire.kind !== 'row') {
          throw new Error('USERMSG: Veo can only extend videos it generated on this board — wire a Veo video node as the source (uploads cannot be extended).')
        }
        const { data: srcRow } = await sb.from('xcreates').select('slots').eq('id', srcWire.row_id).single()
        const srcSlot: any = Array.isArray(srcRow?.slots) ? srcRow.slots[srcWire.slot ?? 0] : null
        const ref = srcSlot?.providerVideoRef ?? null
        if (!ref) {
          throw new Error('USERMSG: This video has no Veo reference to extend from — only Veo 3.1 outputs generated after extension shipped can be extended. Re-generate the source with Veo, then extend.')
        }
        const madeAt = srcSlot?.providerVideoRefAt ? Date.parse(srcSlot.providerVideoRefAt) : NaN
        if (!Number.isFinite(madeAt) || Date.now() - madeAt > 46 * 60 * 60 * 1000) {
          throw new Error('USERMSG: Veo references expire about 2 days after generation — this source is too old to extend. Re-generate it with Veo, then extend.')
        }
        extendVideoRef = ref
      }

      const result = await providers.generateVideo(
        model, prompt, videoSize, videoDuration, wired,
        (pct) => { patch({ progress: Math.max(0, Math.min(100, Math.round(pct))) }).catch(() => {}) },
        callContext,
        { watermark: videoWatermark, aspect_ratio: videoAspectRatio, mode: options.mode ?? null, extend_video_ref: extendVideoRef,
          generate_audio: options.generate_audio ?? null, seed: options.seed ?? null },
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
      // providerVideoRef persists into xcreates.slots so a later
      // extend_video run can hand Veo its own reference (2-day validity).
      return {
        text: signed.signedUrl, isImage: false, isVideo: true, responseTime: rt, cost: result.cost,
        ...(result.providerVideoRef
          ? { providerVideoRef: result.providerVideoRef, providerVideoRefAt: new Date().toISOString() }
          : {}),
      }
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
  // Auth — a browser session OR an API key (the MCP / external-agent path,
  // Aug 17). A bearer token resolves to the same user id and bills the same
  // wallet; nothing downstream knows the difference except the spend-cap
  // gate and the per-token spend record at settle.
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const { resolveApiToken, reserveTokenSpend, adjustTokenSpend } = await import('@/lib/api-token')
  const supabaseUser = await createSupabaseServer()
  const { data: { user: sessionUser } } = await supabaseUser.auth.getUser()
  const apiToken = sessionUser ? null : await resolveApiToken(req.headers.get('authorization'))
  const user = sessionUser ?? (apiToken ? { id: apiToken.userId, email_confirmed_at: 'via-token' } as any : null)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Verified-user gate. Google OAuth auto-confirms email at sign-up, so
  // this is a no-op today; protects future email/password flows. Token
  // users passed it when they signed in to mint the key.
  if (!user.email_confirmed_at) {
    return Response.json(
      { error: 'email_not_verified', message: 'Please verify your email before using XCreate.' },
      { status: 403 },
    )
  }

  const { prompt, mode = 'text', modelIds, modelOptions = [], attachments: attachmentInputs = [], attachment: legacyAttachmentInput = null, jobId: clientJobId = null, parentId = null, parentSlotIdx = null, parentIds: parentIdsInput = null, nodeKind = null, boardId: boardIdInput = null, retryOf = null, rowId: clientRowId = null } = await req.json()
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
  const promptIsOptional = (mode === 'video' || mode === 'image'
    || (modelOptions ?? []).some((o: any) => o?.mode === 'audio_to_text')) && hasAttachmentInput
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
  // ── Workflow lineage (CC, July 26): a step run edits a prior creation's
  // output. Ownership is validated BEFORE the credit reserve so a bad
  // parentId can never cost anything.
  //
  // MULTI-PARENT (CC, July 28): a product video derives from the original
  // photo AND the generated angles, and a multi-product scene derives from
  // two separate roots — neither fits a single parentId. parentIds[] is the
  // general form; parentId stays accepted so every existing caller (the
  // workflow step composer, Edit-this, batch) is untouched.
  //
  // Ownership of EVERY parent is checked before the credit reserve, so a
  // bad or borrowed id can never cost the user anything.
  const parentIdList: string[] = (Array.isArray(parentIdsInput) && parentIdsInput.length > 0)
    ? parentIdsInput.filter((x: any) => typeof x === 'string')
    : (parentId && typeof parentId === 'string' ? [parentId] : [])
  let parentRows: any[] = []
  let parentRow: any = null          // first parent — legacy alias
  let rootIdForRun: string | null = null
  let boardIdForRun: string | null = (typeof boardIdInput === 'string' && boardIdInput) ? boardIdInput : null
  if (parentIdList.length > 0) {
    const svc = serviceClient()
    // board_id ships in a later migration than 53. Selecting a column that
    // doesn't exist is a hard ERROR from PostgREST, not a null field, and
    // that turned every fan-out on a pre-migration database into a bogus
    // "Parent creation not found" 404. Try the board shape, fall back to the
    // shape that has always existed.
    let ps: any[] | null = null
    {
      const a = await svc.from('xcreates')
        .select('id, user_id, root_id, board_id, slots')
        .in('id', parentIdList)
      if (!a.error) ps = a.data
      else {
        const b = await svc.from('xcreates')
          .select('id, user_id, root_id, slots')
          .in('id', parentIdList)
        ps = b.data
      }
    }
    const found = ps ?? []
    if (found.length !== parentIdList.length || found.some((p: any) => p.user_id !== user.id)) {
      return Response.json({ error: 'Parent creation not found' }, { status: 404 })
    }
    // Preserve the caller's order: reference images are positional, so
    // "original first, then angles" has to survive the .in() round-trip
    // (Postgres returns rows in whatever order it likes).
    parentRows = parentIdList.map(id => found.find((p: any) => p.id === id)).filter(Boolean)
    parentRow = parentRows[0] ?? null
    rootIdForRun = parentRow ? (parentRow.root_id ?? parentRow.id) : null
    if (!boardIdForRun) boardIdForRun = parentRow?.board_id ?? rootIdForRun
  }

  // Stable id up front: the reserve, the job row and the reconciliation all
  // key off the same value, and the reserve happens before the row exists.
  const jobIdForRun: string = (clientJobId && typeof clientJobId === 'string')
    ? clientJobId
    : crypto.randomUUID()
  let reservedCents = 0
  {
    const { discountFor } = await import('@/lib/xcreate-discount')
    // Reserve for search too. Search is billed per call ON TOP of tokens, and
    // the pages it reads become input tokens — a searching slot has run 8x the
    // cost of a plain one in testing. Reserving only the token estimate would
    // put the whole search bill into the settle as an overage, which is
    // exactly where a thin balance fails.
    const SEARCH_ALLOWANCE = 8
    // Pages the model reads come back as input tokens — measured ~30k on a
    // searched answer — and they dwarf the per-call fee on expensive models.
    // The client quotes with this figure (SEARCH_READ_TOKENS there); leaving
    // it out of the reserve meant quoting $0.25 and holding $0.09, with the
    // gap landing in the settle where a thin balance fails. Caught in the
    // release test: reserve 9¢, actual 14¢. (CC, Aug 2)
    const SEARCH_READ_TOKENS = 30_000
    const estDollars = models.reduce((sum, m, i) => {
      const o = (modelOptions[i] ?? {}) as Record<string, any>
      const searchEst = (o.web_search === true && supportsWebSearch(m))
        ? SEARCH_ALLOWANCE * searchRate(m)
          + (SEARCH_READ_TOKENS / 1_000_000)
            * resolveTokenRate(m.model_pricing?.tokens?.text_input, o.thinking_level ?? null)
        : 0
      return sum + searchEst + estimateCost(m, mode as 'text' | 'image' | 'video', {
        promptChars: typeof prompt === 'string' ? prompt.length : 0,
        quality:     o.quality,
        size:        o.size,
        resolution:  o.size ?? o.resolution,
        seconds:     o.duration ?? o.seconds,
      })
    }, 0)
    // Mock runs cost nothing, so they must not reserve anything either —
    // otherwise a test would still move the balance and then refund it.
    const estCents = mockEnabled() ? 0 : Math.round(estDollars * 100 * (1 - discountFor(models.length)))
    if (estCents > 0) {
      // RESERVE, don't just check. Runs are concurrent now, so a plain
      // balance check would let N simultaneous requests each see the same
      // healthy balance and all pass before the first debit lands. Debiting
      // the estimate here makes the balance authoritative; the real cost is
      // settled against this reserve once generation finishes.
      // Per-key cap FIRST: it moves no money, so a refusal here needs no
      // unwind, whereas a wallet reserve taken before a capped key is refused
      // would have to be handed back.
      if (apiToken && !(await reserveTokenSpend(apiToken, estCents / 100))) {
        const cap = apiToken.spendCapUsd ?? 0
        console.warn(`${LOG} blocked: key ${apiToken.name} at cap $${cap.toFixed(2)} (spent $${apiToken.spentUsd.toFixed(2)}, needs ~$${(estCents / 100).toFixed(2)})`)
        return Response.json({
          error:   'spend_cap_reached',
          message: `This API key has reached its spend cap ($${cap.toFixed(2)}). Raise the cap on the XDev page.`,
          capUsd:  cap,
          spentUsd: apiToken.spentUsd,
        }, { status: 402 })
      }
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
          // Nothing generated, so the key must not carry the reservation.
          if (apiToken) adjustTokenSpend(apiToken.tokenId, -estCents / 100)
          return Response.json({
            error:   'insufficient_credits',
            message: `This run costs about ${formatCents(estCents)} and your balance is ${formatCents(balanceCents)}.`,
            requiredCents: estCents,
            balanceCents,
          }, { status: 402 })
        }
        if (apiToken) adjustTokenSpend(apiToken.tokenId, -estCents / 100)
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
      // A region mask bypasses processAttachment entirely: the resize
      // pipeline re-encodes images as JPEG, and the mask's alpha channel
      // IS the payload (transparent = repaint here). It goes to the
      // provider byte-for-byte and gets no attachments row or thumbnail —
      // it's an instruction, not content. Image runs only.
      if (inp.port === 'mask') {
        if (mode !== 'image' && mode !== 'video') continue
        const { fetchAttachmentBuffer } = await import('@/lib/attachment')
        const raw = await fetchAttachmentBuffer({ bucket: inp.bucket, storagePath: inp.storagePath, mediaType: inp.mediaType || 'image/png' })
        // Signed like any media input: VACE video masks are fetched by URL
        // (mask_image_url); the OpenAI image path uses the bytes instead.
        const { data: signedMask } = await sb.storage.from(inp.bucket).createSignedUrl(inp.storagePath, 3600)
        attachments.push({
          buffer: raw.buffer, mediaType: raw.mediaType,
          port: 'mask',
          url: signedMask?.signedUrl,
          wireSource: { kind: 'file', bucket: inp.bucket, path: inp.storagePath, name: inp.fileName },
        })
        continue
      }
      const result = await processAttachment(user.id, inp.bucket, inp.storagePath, inp.mediaType, inp.fileName, inp.fileSize)
      const attach: providers.Attachment = {
        buffer: result.buffer, mediaType: result.mediaType,
        // Callers may pre-declare the port (SYNC audio, explicit refs);
        // anything unset is filled from the model's schema at call time.
        port: typeof inp.port === 'string' ? inp.port : undefined,
        wireSource: { kind: 'file', bucket: inp.bucket, path: inp.storagePath, name: inp.fileName },
        // The resized copy is what `buffer` holds byte-for-byte — it's what
        // conversation-history dehydration points its marker at.
        storageRef: { bucket: inp.bucket, path: result.resizedPath },
      }
      // Providers get the RESIZED copy's signed URL (1h) — images are
      // capped at 1920px server-side, so a 4K upload never reaches the
      // model at full size (output tops out around 2K anyway). Videos
      // pass through unresized; their 'resized' copy is byte-identical.
      // Audio joins image/video in carrying a signed URL: DashScope's ASR
      // fetches the file by URL rather than accepting inline bytes.
      if (result.mediaType.startsWith('image/') || result.mediaType.startsWith('video/') || result.mediaType.startsWith('audio/')) {
        attach.url = result.resizedUrl
      }
      attachments.push(attach)
      if (!attachmentId) attachmentId = result.attachmentId  // keep first for DB reference
    } catch (err) { console.warn(`${LOG} attachment failed:`, err) }
  }

  // Parent output -> this run's input, resolved server-side. The stored
  // slot URL is a 24h signed URL that may be long expired, but the storage
  // path inside it never changes, so parse it out and read the object
  // directly. This is what lets "Edit this" skip download/re-upload
  // entirely (most traffic is phones; CC, July 26).
  // Parents are loaded in the order the caller listed them and inserted
  // AHEAD of any fresh uploads, because reference-image slots are
  // positional for every provider we call.
  {
    const parentAtts: providers.Attachment[] = []
    for (let pi = 0; pi < parentRows.length; pi++) {
      const pRow = parentRows[pi]
      try {
        const pslots: any[] = Array.isArray(pRow.slots) ? pRow.slots : []
        // parentSlotIdx only ever meant "which slot of THE parent", so it
        // applies to the first one; the rest use their own chosen slot.
        const pick = (pi === 0 && typeof parentSlotIdx === 'number' && pslots[parentSlotIdx])
          ? pslots[parentSlotIdx]
          : pslots.find((s: any) => s.chosen) ?? pslots.find((s: any) => s.text)
        const firstUrl = typeof pick?.text === 'string' ? pick.text.split('\n')[0] : null
        const um = firstUrl?.match(/\/storage\/v1\/object\/sign\/([^/]+)\/([^?]+)/)
        if (um) {
          const [, pBucket, rawPath] = um
          const pPath = decodeURIComponent(rawPath)
          const { data: blob, error: dlErr } = await sb.storage.from(pBucket).download(pPath)
          if (dlErr || !blob) throw new Error(dlErr?.message ?? 'storage download failed')
          const pBuffer = Buffer.from(await blob.arrayBuffer())
          const pExt = pPath.split('.').pop()?.toLowerCase() ?? ''
          const pMedia = pExt === 'mp4' ? 'video/mp4'
            : pExt === 'webp' ? 'image/webp'
            : (pExt === 'jpg' || pExt === 'jpeg') ? 'image/jpeg'
            : 'image/png'
          // Fresh 1h signed URL for providers that take URLs (Alibaba video
          // edit, Grok) rather than inline bytes.
          const { data: pSigned } = await sb.storage.from(pBucket).createSignedUrl(pPath, 60 * 60)
          parentAtts.push({
            buffer: pBuffer, mediaType: pMedia, url: pSigned?.signedUrl,
            wireSource: { kind: 'row', row_id: pRow.id, slot: Math.max(0, pslots.indexOf(pick)) },
            storageRef: { bucket: pBucket, path: pPath },
          } as providers.Attachment)
          console.log(`${LOG} step input ${pi + 1}/${parentRows.length} from parent ${pRow.id} (${pBucket}/${pPath}, ${pBuffer.length}b)`)
        } else {
          console.warn(`${LOG} parent ${pRow.id} has no parseable output URL — skipped as an input`)
        }
      } catch (err) {
        console.warn(`${LOG} failed to load parent ${pRow.id} output:`, err)
      }
    }
    if (parentAtts.length > 0) attachments.unshift(...parentAtts)
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

  // ── The row is born HERE, at run start (owner, Aug 20) ─────────────────
  // The xcreates row used to be inserted only after generation, which meant
  // an in-flight run had no ?id= — the ?job= URL was the only handle, and
  // it leaked into the address bar and history as a transient link users
  // had no reason to understand. Creating the row up front (empty slots)
  // and pointing the job at it gives every run one durable id from birth;
  // completion becomes an UPDATE. A retry of an all-failed run reuses that
  // row (retry-in-place); anything ineligible falls through to a fresh row.
  const persistedInputs = rawInputs
    .filter((i: any) => i?.storagePath)
    .map((i: any) => ({ storagePath: i.storagePath, bucket: i.bucket, mediaType: i.mediaType, fileName: i.fileName, fileSize: i.fileSize }))
  let rowIdForJob: string | null = null
  if (typeof retryOf === 'string' && retryOf) {
    const { data: prior } = await sb.from('xcreates')
      .select('id, user_id, slots, deleted_at')
      .eq('id', retryOf).eq('user_id', user.id).maybeSingle()
    const priorSlots: any[] = Array.isArray(prior?.slots) ? prior.slots : []
    // Eligible: every slot failed, OR the row is a birth-stub whose run
    // died before writing outputs (empty slots, no job still running on
    // it). A row with any delivered output is history someone paid for
    // and never gets overwritten.
    let eligible = !!prior && !prior.deleted_at &&
      (priorSlots.length > 0
        ? priorSlots.every((s: any) => s?.error)
        : true)
    if (eligible && priorSlots.length === 0) {
      const { data: rj } = await sb.from('xcreate_jobs')
        .select('id').eq('xcreate_id', retryOf).eq('status', 'running').limit(1)
      if ((rj ?? []).length > 0) eligible = false
    }
    if (eligible) {
      rowIdForJob = retryOf
      // Reflect the retry's inputs on the row immediately, so a mid-run
      // reload restores what THIS run is using, not the failed attempt's.
      await sb.from('xcreates')
        .update({ mode, prompt, input_attachments: persistedInputs, attachment_id: attachmentId })
        .eq('id', retryOf).eq('user_id', user.id)
    } else {
      console.warn(`${LOG} retryOf ${retryOf} not eligible (missing, deleted, mid-run, or has delivered output) — starting a fresh row`)
    }
  }
  if (!rowIdForJob) {
    // The client mints the row id at Generate-click so the ?id= link is in
    // the address bar and history before this POST even lands; honor it
    // when it's a well-formed UUID. A collision (reused or forged id — an
    // INSERT can never overwrite, so a forged id is harmless) falls back
    // to a server mint, and the client's poll-sync corrects its URL.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const insertStub = (id: string) => sb.from('xcreates').insert({
      id, user_id: user.id, mode, prompt,
      slots: [], attachment_id: attachmentId,
      input_attachments: persistedInputs,
    })
    let stubId = (typeof clientRowId === 'string' && UUID_RE.test(clientRowId))
      ? clientRowId.toLowerCase()
      : globalThis.crypto.randomUUID()
    let { error: stubErr } = await insertStub(stubId)
    if (stubErr?.code === '23505') {
      stubId = globalThis.crypto.randomUUID()
      ;({ error: stubErr } = await insertStub(stubId))
    }
    if (!stubErr) rowIdForJob = stubId
    else console.warn(`${LOG} birth-stub insert failed — falling back to insert-at-completion:`, stubErr.message)
  }
  if (rowIdForJob) {
    const { error: linkErr } = await sb.from('xcreate_jobs')
      .update({ xcreate_id: rowIdForJob }).eq('id', job.id)
    if (linkErr) console.warn(`${LOG} job→row link failed (polling will carry the id only at completion):`, linkErr.message)
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
  // Which rating pool this run belongs to. Recorded as one of three states,
  // never derived at read time: an all-search run and an all-plain run are
  // both valid comparisons, but a MIXED run — one model allowed to look
  // things up while another was not — measures the settings, not the models,
  // and must reach neither pool. See supabase/64_xcreate_search_pool.sql.
  const searchFlags = mode === 'text'
    ? models.map((m, i) => ((modelOptions[i] ?? {}) as SlotOpts).web_search === true && supportsWebSearch(m))
    : []
  const searchMode = searchFlags.length === 0
    ? 'none'
    : searchFlags.every(Boolean) ? 'all'
    : searchFlags.some(Boolean)  ? 'mixed'
    : 'none'

  // THIS INSERT IS THE OUTPUT'S IDENTITY — and its error was silently
  // discarded until Aug 12, which produced the worst failure this API has:
  // the user debited, the picture delivered, and no row for anything to
  // bind to (two music-video runs stalled on exactly this). The id is
  // minted here so retries are idempotent: a duplicate-key error on retry
  // means an earlier attempt actually committed, i.e. success.
  const mintedRowId = globalThis.crypto.randomUUID()
  const xcreateInsert = {
    id: mintedRowId,
    user_id: user.id, mode, prompt, search_mode: searchMode,
    slots: slotsForXCreate, attachment_id: attachmentId,
    // Full input list (July 19) — lets the gallery restore the original
    // uploads when a past run is reopened (attachment_id only kept #1).
    input_attachments: rawInputs
      .filter((i: any) => i?.storagePath)
      .map((i: any) => ({ storagePath: i.storagePath, bucket: i.bucket, mediaType: i.mediaType, fileName: i.fileName, fileSize: i.fileSize })),
  }
  let xcreateRow: { id: string } | null = null
  // Rows are born at run start (rowIdForJob above), so completion is
  // normally an UPDATE of that row — which also makes a retry of a failed
  // run land on the SAME row, link and history entry. The insert path
  // survives only as the fallback for a failed birth-stub.
  for (let attempt = 1; attempt <= 3 && !xcreateRow; attempt++) {
    if (rowIdForJob) {
      const { error } = await sb.from('xcreates')
        .update({
          mode, prompt, search_mode: searchMode,
          slots: slotsForXCreate, attachment_id: attachmentId,
          input_attachments: xcreateInsert.input_attachments,
          chosen_model_id: null,
        })
        .eq('id', rowIdForJob).eq('user_id', user.id)
      if (!error) { xcreateRow = { id: rowIdForJob }; break }
      console.error(`${LOG} xcreates completion update failed (attempt ${attempt}/3):`, error.message)
    } else {
      const { data, error } = await sb.from('xcreates').insert(xcreateInsert).select('id').single()
      if (data?.id) { xcreateRow = data; break }
      if (error?.code === '23505') { xcreateRow = { id: mintedRowId }; break }
      console.error(`${LOG} xcreates insert failed (attempt ${attempt}/3):`, error?.message ?? error)
    }
    if (attempt < 3) await new Promise(r => setTimeout(r, 400 * attempt))
  }
  if (!xcreateRow) {
    if (rowIdForJob) {
      // The stub exists — bind the job to it even though the outputs never
      // landed; the stub-recovery path on the client makes it re-runnable.
      console.error(`${LOG} completion update PERMANENTLY failed — job bound to stale stub ${rowIdForJob} (user ${user.id}, mode ${mode})`)
      xcreateRow = { id: rowIdForJob }
    } else {
      console.error(`${LOG} xcreates insert PERMANENTLY failed — outputs delivered without a row (user ${user.id}, mode ${mode})`)
    }
  }

  // Lineage stamp. A separate update (not part of the insert) so the API
  // keeps working before supabase/53_xcreate_workflow.sql has been run —
  // a missing column fails THIS update with a warn, not the whole run.
  if (xcreateRow?.id) {
    const lineage: Record<string, any> = {
      parent_id: parentRow?.id ?? null,
      root_id:   rootIdForRun ?? xcreateRow.id,
    }
    // Board columns are a later migration than 53. Attempt them, and on a
    // missing-column error retry with the original two fields only, so a
    // half-migrated database degrades to today's behaviour instead of
    // losing the lineage stamp entirely.
    const board: Record<string, any> = {
      parent_ids: parentRows.length > 0 ? parentRows.map((p: any) => p.id) : null,
      board_id:   boardIdForRun ?? rootIdForRun ?? xcreateRow.id,
      node_kind:  typeof nodeKind === 'string' && nodeKind ? nodeKind : null,
    }
    // Typed wiring (migration 81) — the canonical record of what fed this
    // run, port-named per the model's schema. Multi-model runs share one
    // attachment set; wires are recorded through the FIRST model's schema
    // (XDirect always runs exactly one model, so there it is exact).
    // Its own retry tier: a database missing 81 must not cost the run its
    // board lineage, only its wires.
    const wires = (mode === 'text' || models.length === 0)
      ? null
      : toWires(assignPorts(portSchemaFor(models[0]), attachments))
    let { error: linErr } = await sb.from('xcreates')
      .update({ ...lineage, ...board, input_ports: wires && wires.length > 0 ? wires : null })
      .eq('id', xcreateRow.id)
    if (linErr) {
      console.warn(`${LOG} wiring update failed, retrying without input_ports (migration 81 run?):`, linErr.message)
      ;({ error: linErr } = await sb.from('xcreates').update({ ...lineage, ...board }).eq('id', xcreateRow.id))
    }
    if (linErr) {
      console.warn(`${LOG} board lineage update failed, retrying without board columns:`, linErr.message)
      const { error: linErr2 } = await sb.from('xcreates').update(lineage).eq('id', xcreateRow.id)
      if (linErr2) console.warn(`${LOG} lineage update failed (migration 53 run?):`, linErr2.message)
    }
  }

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
  // Per-key settle (MCP path): the reservation above already charged the key
  // the ESTIMATE, so this is the same signed delta the wallet settles by — a
  // run that produced nothing hands the whole reservation back.
  if (apiToken) adjustTokenSpend(apiToken.tokenId, deltaCents / 100)
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
