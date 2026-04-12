// app/api/duel/route.ts
// XDuel: randomly pick N models, run in parallel, stream results via SSE

export const runtime     = 'nodejs'
export const maxDuration = 300

import { getModelsByMode, type ModelInfo } from '@/lib/models'
import { processAttachment }              from '@/lib/attachment'
import * as providers                     from '@/lib/providers'

const LOG = '[duel]'

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
  index:      number,
  model:      ModelInfo,
  mode:       string,
  prompt:     string,
  attachment: providers.Attachment | null,
  duelId:     string,
  controller: ReadableStreamDefaultController
): Promise<{ text: string; isImage: boolean; isVideo: boolean; responseTime: number; cost: number } | null> {
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
        attachment
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

      const result = await providers.generateImage(model, prompt, 'medium', '1024x1024', attachment)

      // Upload to Supabase
      const { createClient } = await import('@supabase/supabase-js')
      const sb   = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!)
      const rawExt = result.mediaType.split('/')[1] ?? 'png'
      const ext    = rawExt === 'jpeg' ? 'jpg' : rawExt
      const path = `${duelId}_slot${index}.${ext}`
      const { error } = await sb.storage.from('xduel-ai-images').upload(path, result.buffer, { contentType: result.mediaType, upsert: false })
      if (error) throw new Error(`Upload failed: ${error.message}`)
      const { data: urlData } = sb.storage.from('xduel-ai-images').getPublicUrl(path)
      const publicUrl = urlData?.publicUrl ?? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/xduel-ai-images/${path}`
      console.log(`${LOG} Slot[${index}] image uploaded, publicUrl=${publicUrl}`)

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
          model, prompt, '1280x720', 8, attachment,
          (pct) => controller.enqueue(sse(`progress:${index}`, { index, pct }))
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

  const { prompt, mode = 'text', count = 2, attachment: attachmentInput = null } = await req.json()
  console.log(`${LOG} POST prompt="${prompt?.slice(0,50)}" mode=${mode} count=${count}`)

  if (!prompt?.trim() || prompt.trim().length < 3) return Response.json({ error: 'Prompt too short' }, { status: 400 })

  const n = Math.min(Math.max(count, 2), 4)

  // Load + pick models
  let pool: ModelInfo[]
  try { pool = await getModelsByMode(mode) }
  catch (err) { return Response.json({ error: String(err) }, { status: 400 }) }
  if (pool.length < 2) return Response.json({ error: `Not enough models for mode: ${mode}` }, { status: 400 })

  const models = shuffle(pool).slice(0, n)
  const duelId = crypto.randomUUID()

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

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(sse('meta', { count: n, mode, duelId, models: models.map(m => {
        let priceLabel = '—'
        let outputPrice = m.output_price ?? 0
        if (mode === 'image' && m.image_pricing) {
          // Duel uses 'medium' quality for OpenAI, '1024px' for Google
          const cost = m.image_pricing['medium'] ?? m.image_pricing['1024px'] ?? Object.values(m.image_pricing)[0] ?? 0
          priceLabel = `$${parseFloat(cost.toFixed(4))} / image`
          outputPrice = cost
        } else if (mode === 'video' && m.video_pricing) {
          const cost = m.video_pricing['720p'] ?? m.video_pricing['default'] ?? Object.values(m.video_pricing)[0] ?? 0
          priceLabel = `$${parseFloat(cost.toFixed(4))} / sec`
          outputPrice = cost
        } else if (m.output_price != null) {
          priceLabel = `$${m.output_price.toFixed(2)} / 1M tokens`
        }
        return { id: m.id, provider: m.provider, model_name: m.model_name, name: m.name, outputPrice, priceLabel }
      }) }))

      const results = await Promise.all(
        models.map((model, i) => runSlot(i, model, mode, prompt, attachment, duelId, controller))
      )

      // Save to DB
      const { createClient } = await import('@supabase/supabase-js')
      const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!)
      const slots = models.map((m, i) => ({
        model_id:   m.id,
        provider:   m.provider,
        model_name: m.model_name,
        name:       m.name,
        text:       results[i]?.text ?? null,
        isImage:    results[i]?.isImage ?? false,
        isVideo:    results[i]?.isVideo ?? false,
        cost:       results[i]?.cost ?? 0,
        responseTime: results[i]?.responseTime ?? 0,
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
