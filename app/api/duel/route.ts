// app/api/duel/route.ts
// XDuel: randomly pick N models, run in parallel, stream results via SSE

export const runtime     = 'nodejs'
export const maxDuration = 300

import { getModelsByMode, type ModelInfo } from '@/lib/models'
import { processAttachment }              from '@/lib/attachment'
import * as providers                     from '@/lib/providers'
import { modePriceLabel }                 from '@/lib/providers/pricing'

const LOG = '[duel]'

// Models that REQUIRE an attachment to function.
// input_modalities only lists 'image'/'video'/'audio' when REQUIRED (not optional).
// Text-output vision models and pure text-to-image models have input_modalities: ['text'].
function requiresAttachment(m: ModelInfo): boolean {
  // A model can run without an attachment iff one of its declared `modes`
  // is a text-only entry (`text_to_text`, `text_to_image`, `text_to_video`).
  // input_modalities alone is too permissive — a Reference-to-Video model
  // declares both text and image as inputs, but it actually *requires* the
  // image to run; "text" just means it also takes a text prompt.
  const modes = m.modes ?? []
  if (modes.length > 0) {
    return !modes.some(mode => mode.startsWith('text_to_'))
  }
  // Legacy fallback for rows without `modes` declared. A pure text-only
  // model (input_modalities = ['text']) works without an attachment.
  // Anything else, conservatively assume it needs one — this keeps the
  // duel pool clean even if the catalog row is incomplete.
  const inputs = m.input_modalities ?? []
  if (inputs.length === 1 && inputs[0] === 'text') return false
  return inputs.includes('image') || inputs.includes('video') || inputs.includes('audio')
}

function sse(event: string, data: object) {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

// Fisher-Yates shuffle
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ── Run one slot ──────────────────────────────────────────────────────────────

async function runSlot(
  index:       number,
  model:       ModelInfo,
  mode:        string,
  prompt:      string,
  attachments: providers.Attachment[],
  duelId:      string,
  controller:  ReadableStreamDefaultController,
  userId:      string,
): Promise<{ text: string; isImage: boolean; isVideo: boolean; responseTime: number; cost: number } | null> {
  const callContext: providers.CallContext = { userId }
  const start = Date.now()
  console.log(`${LOG} Slot[${index}] ${model.provider}/${model.model_name} mode=${mode}`)

  try {
    if (mode === 'text') {
      let fullText = ''
      let doneResult: { inputTokens: number; outputTokens: number; cachedTokens: number; cost: number } = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, cost: 0 }

      await providers.streamText(
        model,
        [{ role: 'user', content: prompt }],
        {
          onDelta: (text) => {
            fullText += text
            controller.enqueue(sse(`delta:${index}`, { index, text }))
          },
          onDone: (r) => { doneResult = r },
          onError: (msg) => { throw new Error(msg) },
        },
        attachments,
        callContext,
      )

      const responseTime = Date.now() - start
      console.log(`${LOG} Slot[${index}] text done in ${responseTime}ms cost=${doneResult.cost}`)
      controller.enqueue(sse(`done:${index}`, {
        index,
        responseTime,
        cost:         doneResult.cost,
        inputTokens:  doneResult.inputTokens,
        outputTokens: doneResult.outputTokens,
      }))
      return { text: fullText, isImage: false, isVideo: false, responseTime, cost: doneResult.cost }

    } else if (mode === 'image') {
      controller.enqueue(sse(`delta:${index}`, { index, isImage: true, generating: true }))

      const result = await providers.generateImage(model, prompt, 'medium', '1024x1024', attachments, null, null, callContext)

      // Upload to Supabase. Wrap in retry with backoff — undici's `fetch
      // failed` (DNS / connection drops on the dev machine, brief Supabase
      // hiccups) is the most common reason an otherwise-good image dies on
      // the home stretch. Three attempts at 0.5s / 1s / 2s eats almost no
      // time on success and recovers the case we just hit during testing.
      const { createClient } = await import('@supabase/supabase-js')
      const sb   = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!)
      const rawExt = result.mediaType.split('/')[1] ?? 'png'
      const ext    = rawExt === 'jpeg' ? 'jpg' : rawExt
      const path = `${duelId}_slot${index}.${ext}`

      const attempts = 3
      let lastErr: any = null
      let succeeded = false
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          const { error } = await sb.storage.from('xduel-ai-images').upload(path, result.buffer, { contentType: result.mediaType, upsert: false })
          if (error) {
            lastErr = error
            console.warn(`${LOG} Slot[${index}] IMAGE UPLOAD attempt ${attempt}/${attempts} returned error: ${error.message}`)
          } else {
            succeeded = true
            break
          }
        } catch (uploadEx: any) {
          lastErr = uploadEx
          console.warn(`${LOG} Slot[${index}] IMAGE UPLOAD attempt ${attempt}/${attempts} threw: ${uploadEx?.message ?? uploadEx} cause=${uploadEx?.cause?.message ?? ''}`)
        }
        if (attempt < attempts) {
          const backoff = 500 * Math.pow(2, attempt - 1) // 500ms, 1s, 2s
          await new Promise(r => setTimeout(r, backoff))
        }
      }
      if (!succeeded) {
        const detail = lastErr?.message ?? String(lastErr ?? 'unknown')
        const cause  = lastErr?.cause?.message ? ` (cause: ${lastErr.cause.message})` : ''
        throw new Error(`Upload failed after ${attempts} attempts: ${detail}${cause} [path=${path} bytes=${result.buffer.length} mime=${result.mediaType}]`)
      }

      const { data: urlData } = sb.storage.from('xduel-ai-images').getPublicUrl(path)
      const publicUrl = urlData?.publicUrl ?? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/xduel-ai-images/${path}`
      console.log(`${LOG} Slot[${index}] image uploaded, publicUrl=${publicUrl}`)

      providers.logMediaUrl(result.requestId, {
        provider: model.provider, model_name: model.model_name, model_id: model.id ?? null,
        mode: 'image', user_id: callContext?.userId ?? null,
      }, `xduel-ai-images/${path}`)

      const responseTime = Date.now() - start
      controller.enqueue(sse(`delta:${index}`, { index, text: publicUrl, isImage: true }))
      controller.enqueue(sse(`done:${index}`,  { index, responseTime, cost: result.cost }))
      return { text: publicUrl, isImage: true, isVideo: false, responseTime, cost: result.cost }

    } else if (mode === 'video') {
      console.log(`${LOG} Slot[${index}] VIDEO START model=${model.provider}/${model.model_name}`)
      controller.enqueue(sse(`delta:${index}`, { index, isVideo: true, generating: true }))

      let result
      try {
        result = await providers.generateVideo(
          model, prompt, '1280x720', 8, attachments,
          (pct) => controller.enqueue(sse(`progress:${index}`, { index, pct })),
          callContext,
          // Default watermark off in duels — we want models judged on their
          // actual output, and a vendor watermark stamped on the video would
          // both leak the model identity (defeating the blind vote) and
          // distract from the comparison. Matches XCreate's default.
          { watermark: false },
        )
      } catch (genErr: any) {
        console.error(`${LOG} Slot[${index}] VIDEO GEN FAILED model=${model.model_name} err=${genErr?.message ?? genErr}`)
        throw new Error(`Video generation failed: ${genErr?.message ?? genErr}`)
      }
      console.log(`${LOG} Slot[${index}] VIDEO GEN OK bytes=${result.buffer.length} mime=${result.mediaType}`)

      // Upload to Supabase
      const { createClient } = await import('@supabase/supabase-js')
      const sb   = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!)
      const ext  = result.mediaType.split('/')[1] ?? 'mp4'
      const path = `${duelId}_slot${index}.${ext}`

      let uploadError: any = null
      try {
        const { error } = await sb.storage.from('xduel-ai-videos').upload(path, result.buffer, { contentType: result.mediaType, upsert: false })
        uploadError = error
      } catch (uploadEx: any) {
        // Some upload failures throw instead of returning { error } (e.g.
        // network-level fetch failures from undici).
        console.error(`${LOG} Slot[${index}] VIDEO UPLOAD THREW path=${path} err=${uploadEx?.message ?? uploadEx} cause=${uploadEx?.cause?.message ?? ''}`)
        throw new Error(`Video upload failed (threw): ${uploadEx?.message ?? uploadEx}`)
      }
      if (uploadError) {
        console.error(`${LOG} Slot[${index}] VIDEO UPLOAD ERROR path=${path} err=${uploadError.message}`)
        throw new Error(`Video upload failed: ${uploadError.message}`)
      }

      const { data: urlData } = sb.storage.from('xduel-ai-videos').getPublicUrl(path)
      const publicUrl = urlData?.publicUrl ?? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/xduel-ai-videos/${path}`
      console.log(`${LOG} Slot[${index}] VIDEO UPLOADED publicUrl=${publicUrl}`)

      providers.logMediaUrl(result.requestId, {
        provider: model.provider, model_name: model.model_name, model_id: model.id ?? null,
        mode: 'video', user_id: callContext?.userId ?? null,
      }, `xduel-ai-videos/${path}`)

      const responseTime = Date.now() - start
      controller.enqueue(sse(`delta:${index}`, { index, text: publicUrl, isVideo: true }))
      controller.enqueue(sse(`done:${index}`,  { index, responseTime, cost: result.cost }))
      return { text: publicUrl, isImage: false, isVideo: true, responseTime, cost: result.cost }
    }

    throw new Error(`Unknown mode: ${mode}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`${LOG} Slot[${index}] ${model.provider}/${model.model_name} failed: ${msg}`)
    controller.enqueue(sse(`error:${index}`, { index, message: msg }))
    return null
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  // Auth
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const supabaseUser = await createSupabaseServer()
  const { data: { user }, error: authError } = await supabaseUser.auth.getUser()
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Daily $1 credit grant for users who crossed UTC midnight while logged
  // in (auth callback only fires on fresh sign-in). Idempotent and
  // fire-and-forget — never blocks the duel.
  ;(async () => {
    try {
      const { ensureDailyGrant } = await import('@/lib/credits')
      await ensureDailyGrant(user.id, 100)
    } catch (err) {
      console.warn(`${LOG} ensureDailyGrant failed:`, err instanceof Error ? err.message : err)
    }
  })()

  const { prompt, mode = 'text', count = 2, attachment: attachmentInput = null } = await req.json()
  console.log(`${LOG} POST prompt="${prompt?.slice(0,50)}" mode=${mode} count=${count}`)

  // Same rule as XCreate: an attached file in video/image mode is enough
  // to drive generation, so the prompt-length check is relaxed when an
  // attachment is present.
  const promptTooShort = !prompt?.trim() || prompt.trim().length < 3
  const promptIsOptional = (mode === 'video' || mode === 'image') && !!attachmentInput?.storagePath
  if (promptTooShort && !promptIsOptional) {
    return Response.json({ error: 'Prompt too short' }, { status: 400 })
  }

  const n = Math.min(Math.max(count, 2), 4)

  // Load + pick models
  let pool: ModelInfo[]
  try { pool = await getModelsByMode(mode) }
  catch (err) { return Response.json({ error: String(err) }, { status: 400 }) }
  if (pool.length < 2) return Response.json({ error: `Not enough models for mode: ${mode}` }, { status: 400 })

  // Filter out models that require image input when user has no attachment
  const hasAttachment = !!attachmentInput?.storagePath
  if (!hasAttachment) {
    pool = pool.filter(m => !requiresAttachment(m))
  }
  if (pool.length < 2) return Response.json({ error: `Not enough models for mode: ${mode}` }, { status: 400 })

  const models = shuffle(pool).slice(0, n)
  const duelId = crypto.randomUUID()

  // Process attachment (duel still uses single attachment from client)
  const attachments: providers.Attachment[] = []
  let attachmentId: string | null = null
  if (attachmentInput?.storagePath) {
    try {
      const result = await processAttachment(user.id, attachmentInput.bucket, attachmentInput.storagePath, attachmentInput.mediaType, attachmentInput.fileName, attachmentInput.fileSize)
      const attach: providers.Attachment = { buffer: result.buffer, mediaType: result.mediaType }
      // Sign a public URL for image attachments — Alibaba I2V wants HTTP(S),
      // not base64. 1 hour is plenty for the provider to fetch.
      if (result.mediaType.startsWith('image/') && attachmentInput.bucket && attachmentInput.storagePath) {
        try {
          const { createClient: cc } = await import('@supabase/supabase-js')
          const sbSign = cc(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!)
          const { data: signed } = await sbSign.storage.from(attachmentInput.bucket).createSignedUrl(attachmentInput.storagePath, 60 * 60)
          if (signed?.signedUrl) attach.url = signed.signedUrl
        } catch (sigErr) {
          console.warn(`${LOG} attachment signed-url failed (will fall back to base64):`, sigErr)
        }
      }
      attachments.push(attach)
      attachmentId = result.attachmentId
    } catch (err) { console.warn(`${LOG} attachment failed:`, err) }
  }

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(sse('meta', { count: n, mode, duelId, models: models.map(m => {
        const { label: priceLabel, rate: outputPrice } = modePriceLabel(m, mode as 'text'|'image'|'video')
        return { id: m.id, provider: m.provider, model_name: m.model_name, name: m.display_name, outputPrice, priceLabel }
      }) }))

      const results = await Promise.all(
        models.map((model, i) => runSlot(i, model, mode, prompt, attachments, duelId, controller, user.id))
      )

      // Save to DB
      const { createClient } = await import('@supabase/supabase-js')
      const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!)
      // Build price label per model (matches what the SSE meta event sends)
      const slotPrices = models.map(m => {
        const { label, rate } = modePriceLabel(m, mode as 'text'|'image'|'video')
        return { priceLabel: label, outputPrice: rate }
      })

      const slots = models.map((m, i) => ({
        model_id:     m.id,
        provider:     m.provider,
        model_name:   m.model_name,
        name:         m.display_name,
        text:         results[i]?.text ?? null,
        isImage:      results[i]?.isImage ?? false,
        isVideo:      results[i]?.isVideo ?? false,
        cost:         results[i]?.cost ?? 0,
        responseTime: results[i]?.responseTime ?? 0,
        priceLabel:   slotPrices[i].priceLabel,
        outputPrice:  slotPrices[i].outputPrice,
      }))

      await sb.from('duels').insert({
        id: duelId, user_id: user.id, mode, prompt,
        slots, attachment_id: attachmentId,
      })

      controller.enqueue(sse('end', { duelId }))
      controller.close()
    }
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' }
  })
}
