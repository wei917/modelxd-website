// app/api/duel/route.ts
// SSE streaming duel — text mode streams tokens, image/video mode uploads to Supabase Storage
// Uses AI SDK (@ai-sdk/gateway) for accurate cost via providerMetadata.gateway.marketCost

import { createGateway, streamText, experimental_generateImage as generateImage, experimental_generateVideo as generateVideo } from 'ai'
import { getModelsByMode, ModelEntry } from '../../../lib/models'

export const maxDuration = 300 // Vercel Pro max — needed for slow image models

const LOG = '[duel]'
type AttachmentInput = { base64: string; mediaType: string } | null

function buildUserContent(prompt: string, attachment: AttachmentInput): any {
  if (!attachment) return prompt
  const { base64, mediaType } = attachment
  const parts: any[] = []
  if (mediaType.startsWith('image/')) {
    parts.push({ type: 'image', image: base64, mimeType: mediaType })
  } else if (mediaType === 'application/pdf') {
    parts.push({ type: 'file', data: base64, mimeType: 'application/pdf' })
  } else if (mediaType === 'text/plain') {
    // decode text and prepend to prompt
    const decoded = Buffer.from(base64, 'base64').toString('utf-8')
    parts.push({ type: 'text', text: `File content:
${decoded}

${prompt}` })
    return parts[0].text  // plain string is fine
  } else if (mediaType.startsWith('video/')) {
    parts.push({ type: 'file', data: base64, mimeType: mediaType })
  }
  parts.push({ type: 'text', text: prompt })
  return parts
}



// Extract a representative per-image price from whichever pricing structure exists in raw jsonb
function getImagePrice(pricing: any): number {
  if (!pricing) return 0
  // Flat price field e.g. { image: "0.07" }
  if (pricing.image) return parseFloat(pricing.image)
  // image_gen_pricing list e.g. [{ resolution, cost }]
  if (Array.isArray(pricing.image_gen_pricing) && pricing.image_gen_pricing.length > 0)
    return parseFloat(pricing.image_gen_pricing[0].cost)
  // image_dimension_quality_pricing list — pick medium+1024x1024, else first entry
  if (Array.isArray(pricing.image_dimension_quality_pricing) && pricing.image_dimension_quality_pricing.length > 0) {
    const preferred = pricing.image_dimension_quality_pricing.find(
      (e: any) => e.quality === 'medium' && e.size === '1024x1024'
    ) ?? pricing.image_dimension_quality_pricing[0]
    return parseFloat(preferred.cost)
  }
  return 0
}

const gateway = createGateway({
  apiKey:  process.env.AI_GATEWAY_API_KEY,
  baseURL: 'https://ai-gateway.vercel.sh/v3/ai',
})

function sse(event: string, data: object) {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

async function getModels(mode: string): Promise<ModelEntry[]> {
  try {
    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY!
    )
    const tagFilter = mode === 'image' ? 'image-generation' : mode === 'video' ? 'video-generation' : null

    let rows: any[] = []
    if (tagFilter) {
      const { data: byTag,  error: e1 } = await supabase.from('ai_models').select('*').eq('enabled', true).contains('tags',  [tagFilter])
      const { data: byMode, error: e2 } = await supabase.from('ai_models').select('*').eq('enabled', true).contains('modes', [mode])
      if (e1) throw e1
      if (e2) throw e2
      const seen = new Set<string>()
      for (const m of [...(byTag ?? []), ...(byMode ?? [])]) {
        if (!seen.has(m.id)) { seen.add(m.id); rows.push(m) }
      }
    } else {
      const { data, error } = await supabase.from('ai_models').select('*').eq('enabled', true).contains('modes', [mode])
      if (error) throw error
      rows = data ?? []
    }

    const data = mode === 'video'
      ? rows.filter((m: any) => {
          const id = (m.id as string).toLowerCase()
          // Exclude image-to-video, reference-to-video, and editing models — duel needs text-to-video only
          return !id.includes('-i2v') && !id.includes('-r2v') && !id.includes('-edit') && !id.includes('video-edit')
        })
      : rows

    if (!data || data.length < 2) throw new Error('Not enough models in DB')

    console.log(`${LOG} Loaded ${data.length} ${mode} models from Supabase`)
    return data.map(m => ({
      id:          m.id,
      name:        m.name,
      provider:    m.provider,
      outputPrice: mode === 'image'
        ? getImagePrice(m.raw?.pricing)
        : mode === 'video'
        ? getVideoPrice(m.raw?.pricing, m.output_price)
        : (m.output_price ?? 0),
      inputPrice:  m.input_price ?? 0,
      modes:       m.modes ?? [mode],
    }))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // If Supabase returned data but not enough models, don't silently fallback — surface it
    if (msg.includes('Not enough models')) throw err
    console.warn(`${LOG} Supabase unavailable, using fallback:`, err)
    const fallback = getModelsByMode(mode as 'text' | 'image' | 'video')
    if (fallback.length < 2) throw new Error(`No models available for mode: ${mode}`)
    return fallback
  }
}

function priceLabel(mode: string, outputPrice: number): string {
  if (mode === 'image') return `$${(outputPrice * 1000).toFixed(2)} / 1k images`
  if (mode === 'video') return `$${(outputPrice * 1000).toFixed(2)} / 1k videos`
  return `$${outputPrice.toFixed(2)} / 1M tokens`
}

function getVideoPrice(pricing: any, fallback: number | null): number {
  if (!pricing) return fallback ?? 0
  // Try common video pricing fields
  if (pricing.video)       return parseFloat(pricing.video)
  if (pricing.video_price) return parseFloat(pricing.video_price)
  if (pricing.per_second)  return parseFloat(pricing.per_second) * 5 // assume 5s clip
  if (Array.isArray(pricing.video_gen_pricing)) return parseFloat(pricing.video_gen_pricing[0].cost)
  return fallback ?? 0
}

// ── Text: streaming via AI SDK ────────────────────────────────────────────────

type DuelResult = { text: string; isImage: boolean; isVideo: boolean; responseTime: number; cost: number }
type MaybeDuelResult = DuelResult | null

async function tryTextModel(
  model: ModelEntry,
  index: number,
  prompt: string,
  controller: ReadableStreamDefaultController,
  attachment: AttachmentInput = null
): Promise<MaybeDuelResult> {
  const start = Date.now()
  console.log(`${LOG} Slot[${index}] text: ${model.id}`)

  try {
    const result = streamText({
      model:     gateway(model.id),
      messages:  [{ role: 'user', content: buildUserContent(prompt, attachment) }],
      maxOutputTokens: 512,
    })

    let firstChunk = true
    let fullText = ''
    for await (const delta of result.textStream) {
      if (firstChunk) {
        console.log(`${LOG} Slot[${index}] first chunk +${Date.now() - start}ms`)
        firstChunk = false
      }
      fullText += delta
      controller.enqueue(sse(`delta:${index}`, { index, text: delta }))
    }

    const usage    = await result.usage
    const meta     = await result.providerMetadata
    const tokens   = usage?.outputTokens ?? 0
    // Use gateway's marketCost if available, else fall back to manual calc
    const cost     = Number((meta?.gateway as any)?.marketCost)
                  ?? (tokens / 1_000_000) * model.outputPrice

    const responseTime = Date.now() - start
    console.log(`${LOG} Slot[${index}] ${model.id} done: ${tokens} tokens ${responseTime}ms cost=$${cost}`)
    controller.enqueue(sse(`done:${index}`, { index, tokens, responseTime, cost }))
    return { text: fullText, isImage: false, isVideo: false, responseTime, cost }

  } catch (err) {
    const errMsg = err instanceof Error ? `${err.message}${(err as any).cause ? ' | cause: ' + (err as any).cause : ''}` : String(err)
    console.warn(`${LOG} Slot[${index}] ${model.id} failed: ${errMsg}`)
    return null as MaybeDuelResult
  }
}

// ── Image: via AI SDK generateImage ──────────────────────────────────────────


async function tryImageModel(
  model: ModelEntry,
  index: number,
  prompt: string,
  controller: ReadableStreamDefaultController,
  duelMode: string,
  duelId: string,
  attachment: AttachmentInput = null
): Promise<MaybeDuelResult> {
  const start = Date.now()
  console.log(`${LOG} Slot[${index}] image: ${model.id}`)

  try {
    const imgOptions: any = { model: gateway.imageModel(model.id), prompt }
    if (attachment?.mediaType.startsWith('image/')) {
      imgOptions.providerOptions = { openai: { image: attachment.buffer.toString('base64') } }
    }
    const result = await generateImage(imgOptions)

    const image = result.images?.[0]
    if (!image) throw new Error('No image in response')

    // Upload to Supabase Storage to avoid sending large base64 over SSE
    const { createClient } = await import('@supabase/supabase-js')
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!)
    const ext = image.mediaType?.split('/')[1] ?? 'png'
    const path = `${duelId}_model${index}.${ext}`
    const { error: uploadError } = await sb.storage.from(duelMode === 'create' ? 'create-ai-images' : 'xduel-ai-images').upload(path, image.uint8Array, {
      contentType: image.mediaType ?? 'image/png',
      upsert: false,
    })
    if (uploadError) throw new Error(`Supabase upload failed: ${uploadError.message}`)
    const { data: { publicUrl: imageUrl } } = sb.storage.from(duelMode === 'create' ? 'create-ai-images' : 'xduel-ai-images').getPublicUrl(path)
    console.log(`${LOG} Slot[${index}] image uploaded: ${imageUrl}`)

    const meta = result.providerMetadata
    // Use gateway's marketCost if available, else use flat outputPrice from Supabase
    const cost = Number((meta?.gateway as any)?.marketCost ?? model.outputPrice)

    const responseTime = Date.now() - start
    console.log(`${LOG} Slot[${index}] ${model.id} image done: ${responseTime}ms cost=$${cost}`)

    controller.enqueue(sse(`delta:${index}`, { index, text: imageUrl, isImage: true }))
    controller.enqueue(sse(`done:${index}`,  { index, tokens: 1, responseTime, cost }))
    return { text: imageUrl, isImage: true, isVideo: false, responseTime, cost }

  } catch (err) {
    const errMsg = err instanceof Error ? `${err.message}${(err as any).cause ? ' | cause: ' + (err as any).cause : ''}` : String(err)
    console.warn(`${LOG} Slot[${index}] ${model.id} failed: ${errMsg}`)
    return null as MaybeDuelResult
  }
}

// ── Video: via AI SDK generateVideo ──────────────────────────────────────────


async function tryVideoModel(
  model:      ModelEntry,
  index:      number,
  prompt:     string,
  controller: ReadableStreamDefaultController,
  duelMode:   string,
  duelId:     string,
  attachment: AttachmentInput = null
): Promise<MaybeDuelResult> {
  const start = Date.now()
  console.log(`${LOG} Slot[${index}] video: ${model.id}`)

  try {
    console.log(`${LOG} Slot[${index}] calling gateway.videoModel(${model.id})`)
    const result = await generateVideo({
      model:   gateway.videoModel(model.id),
      prompt,
      aspectRatio: '16:9',
      providerOptions: {
        gateway: { pollTimeoutMs: 280_000 }, // just under Vercel's 300s max
      },
    })
    console.log(`${LOG} Slot[${index}] generateVideo returned, video=${!!result.video} videos=${result.videos?.length}`)

    const video = result.video ?? result.videos?.[0]
    if (!video) throw new Error('No video in response')

    const meta = result.providerMetadata
    console.log(`${LOG} Slot[${index}] providerMetadata=${JSON.stringify(meta)}`)

    // Always upload to Supabase — provider URLs (Alibaba, xAI) are signed S3 URLs that expire
    const { createClient } = await import('@supabase/supabase-js')
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!)
    const bucket = duelMode === 'create' ? 'create-ai-videos' : 'xduel-ai-videos'

    let videoUrl: string
    if (video.uint8Array?.length) {
      // Provider returned bytes directly (Kling, ByteDance, Google)
      console.log(`${LOG} Slot[${index}] uploading uint8Array to Supabase...`)
      const mediaType = (video as any).mediaType ?? 'video/mp4'
      const ext = mediaType.split('/')[1] ?? 'mp4'
      const path = `${duelId}_model${index}.${ext}`
      const { error: uploadError } = await sb.storage.from(bucket).upload(path, video.uint8Array, {
        contentType: mediaType,
        upsert: false,
      })
      if (uploadError) throw new Error(`Supabase upload failed: ${uploadError.message}`)
      const { data: { publicUrl } } = sb.storage.from(bucket).getPublicUrl(path)
      videoUrl = publicUrl
      console.log(`${LOG} Slot[${index}] uploaded from bytes: ${publicUrl}`)
    } else {
      // Provider returned a URL only (Alibaba, xAI) — fetch bytes and re-upload to Supabase
      // Provider URLs are signed S3 links that expire, so we must persist them ourselves
      const providerUrl = (meta?.alibaba as any)?.videoUrl
        ?? (meta?.xai as any)?.videoUrl
        ?? (meta?.klingai as any)?.videoUrl
        ?? (meta?.google as any)?.videoUrl
        ?? (meta?.bytedance as any)?.videoUrl
      if (!providerUrl) throw new Error('No video bytes or URL in response')
      console.log(`${LOG} Slot[${index}] fetching provider URL to re-upload...`)
      const fetchRes = await fetch(providerUrl)
      if (!fetchRes.ok) throw new Error(`Failed to fetch provider video: ${fetchRes.status}`)
      const contentType = fetchRes.headers.get('content-type') ?? 'video/mp4'
      const ext = contentType.split('/')[1]?.split(';')[0] ?? 'mp4'
      const path = `${duelId}_model${index}.${ext}`
      const bytes = new Uint8Array(await fetchRes.arrayBuffer())
      const { error: uploadError } = await sb.storage.from(bucket).upload(path, bytes, {
        contentType,
        upsert: false,
      })
      if (uploadError) throw new Error(`Supabase upload failed: ${uploadError.message}`)
      const { data: { publicUrl } } = sb.storage.from(bucket).getPublicUrl(path)
      videoUrl = publicUrl
      console.log(`${LOG} Slot[${index}] uploaded from provider URL: ${publicUrl}`)
    }

    const cost = Number((meta?.gateway as any)?.marketCost ?? model.outputPrice)
    const responseTime = Date.now() - start
    console.log(`${LOG} Slot[${index}] ${model.id} video done: ${responseTime}ms cost=$${cost}`)

    controller.enqueue(sse(`delta:${index}`, { index, text: videoUrl, isVideo: true }))
    controller.enqueue(sse(`done:${index}`,  { index, tokens: 1, responseTime, cost }))
    return { text: videoUrl, isImage: false, isVideo: true, responseTime, cost }

  } catch (err) {
    const errMsg = err instanceof Error ? `${err.message}${(err as any).cause ? ' | cause: ' + (err as any).cause : ''}` : String(err)
    console.warn(`${LOG} Slot[${index}] ${model.id} failed: ${errMsg}`)
    if (err instanceof Error && err.stack) console.warn(`${LOG} stack: ${err.stack}`)
    // Surface quota/rate limit errors immediately — retrying other models won't help
    const isFatal = err instanceof Error && (
      err.constructor.name.includes('RateLimit') ||
      err.constructor.name.includes('Quota') ||
      err.message.toLowerCase().includes('quota') ||
      err.message.toLowerCase().includes('rate limit')
    )
    if (isFatal) controller.enqueue(sse(`error:${index}`, { index, message: err.message }))
    return null as MaybeDuelResult
  }
}

// ── Worker: pop model from queue, retry on failure ────────────────────────────

async function runWorker(
  index:          number,
  queue:          ModelEntry[],
  prompt:         string,
  mode:           string,
  controller:     ReadableStreamDefaultController,
  resolvedModels: (ModelEntry | null)[],
  resolvedResults: ({ text: string; isImage: boolean; isVideo: boolean; responseTime: number; cost: number } | null)[],
  duelId:         string,
  attachment:     AttachmentInput = null
) {
  while (queue.length > 0) {
    const model = queue.shift()!
    console.log(`${LOG} Slot[${index}] trying ${model.id} (${queue.length} remaining)`)

    controller.enqueue(sse(`trying:${index}`, {
      index,
      id:          model.id,
      name:        model.name,
      provider:    model.provider,
      outputPrice: model.outputPrice,
      priceLabel:  priceLabel(mode, model.outputPrice),
    }))

    const result = mode === 'image'
      ? await tryImageModel(model, index, prompt, controller, mode, duelId, attachment)
      : mode === 'video'
      ? await tryVideoModel(model, index, prompt, controller, mode, duelId, attachment)
      : await tryTextModel(model, index, prompt, controller, attachment)

    if (result) {
      resolvedModels[index] = model
      resolvedResults[index] = result
      return
    }
    console.warn(`${LOG} Slot[${index}] ${model.id} failed — trying next`)
  }
  console.error(`${LOG} Slot[${index}] all models exhausted`)
  controller.enqueue(sse(`error:${index}`, { index, message: 'All models failed — no response available for this slot.' }))
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const { prompt, mode = 'text', count = 2, attachment: attachmentInput = null } = await req.json()

  // Process attachment if present: fetch from bucket, resize, store in DB
  let processedAttachment: AttachmentInput = null
  let attachmentId: string | null = null
  if (attachmentInput?.storagePath && user) {
    try {
      const { processAttachment } = await import('@/lib/attachment')
      const result = await processAttachment(
        user.id,
        attachmentInput.bucket,
        attachmentInput.storagePath,
        attachmentInput.mediaType,
        attachmentInput.fileName,
        attachmentInput.fileSize,
      )
      processedAttachment = { buffer: result.buffer, mediaType: result.mediaType }
      attachmentId = result.attachmentId
    } catch (err) {
      console.warn('[duel] attachment processing failed:', err)
      // Non-fatal — continue without attachment
    }
  }

  // Auth check — must be signed in
  const { createClient: createSupa } = await import('@supabase/supabase-js')
  const { createSupabaseServer } = await import('@/lib/supabase-server')
  const supabaseUser = createSupabaseServer()
  const { data: { user }, error: authError } = await supabaseUser.auth.getUser()
  if (authError || !user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const duelId = crypto.randomUUID()

  if (!prompt || prompt.trim().length < 3) {
    return Response.json({ error: 'Prompt too short' }, { status: 400 })
  }

  const n = Math.min(Math.max(count, 2), 4)
  let pool: ModelEntry[]
  try {
    pool = await getModels(mode)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to load models'
    return Response.json({ error: msg }, { status: 400 })
  }
  if (pool.length < 2) {
    return Response.json({ error: `Not enough models for mode: ${mode}` }, { status: 400 })
  }

  const queue: ModelEntry[] = [...pool]
  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]]
  }
  const resolvedModels: (ModelEntry | null)[] = Array(n).fill(null)
  const resolvedResults: ({ text: string; isImage: boolean; isVideo: boolean; responseTime: number; cost: number } | null)[] = Array(n).fill(null)

  console.log(`${LOG} Pool: ${pool.length} ${mode} models available`)
  console.log(`${LOG} Starting duel: ${n} workers, mode=${mode}, queue: ${queue.map(m => m.id).join(', ')}`)

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(sse('meta', { count: n, mode, duelId }))
      await Promise.all(
        Array.from({ length: n }, (_, i) => runWorker(i, queue, prompt, mode, controller, resolvedModels, resolvedResults, duelId, processedAttachment))
      )
      const resolvedSlots = resolvedModels.map(m => m ? {
        id:          m.id,
        name:        m.name,
        provider:    m.provider,
        outputPrice: m.outputPrice,
        inputPrice:  m.inputPrice,
        priceLabel:  priceLabel(mode, m.outputPrice),
      } : null)

      controller.enqueue(sse('resolved', { models: resolvedSlots }))

      // Persist duel to DB (fire and forget — don't block SSE close)
      const slotResults = resolvedSlots.map((m, i) => {
        const result = resolvedResults[i]
        const realCost = result?.cost ?? 0
        const realPriceLabel = result?.isVideo
          ? `$${(realCost * 1000).toFixed(2)} / 1k videos`
          : result?.isImage
          ? `$${(realCost * 1000).toFixed(2)} / 1k images`
          : priceLabel(mode, m?.outputPrice ?? 0)
        return { ...m, ...result, priceLabel: realPriceLabel }
      })
      const sb = createSupa(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!)
      sb.from('duels').insert({
        id:      duelId,
        user_id: user.id,
        mode,
        prompt,
        slots:   slotResults,
        attachment_id: attachmentId,
      }).then(({ error }) => {
        if (error) console.error(`${LOG} Failed to save duel ${duelId}:`, error.message)
        else console.log(`${LOG} Duel ${duelId} saved`)
      })

      controller.close()
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    }
  })
}
