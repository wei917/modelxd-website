// app/api/duel/route.ts
// SSE streaming duel — text mode streams tokens, image mode returns base64
// Uses AI SDK (@ai-sdk/gateway) for accurate cost via providerMetadata.gateway.marketCost

import { createGateway }               from '@ai-sdk/gateway'
import { streamText, experimental_generateImage as generateImage, experimental_generateVideo as generateVideo } from 'ai'
import { getModelsByMode, ModelEntry } from '../../../lib/models'

export const maxDuration = 300 // Vercel Pro max — needed for slow image models

const LOG = '[duel]'

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
  baseURL: 'https://ai-gateway.vercel.sh/v1/ai',
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

    const data = rows

    if (!data || data.length < 2) throw new Error('Not enough models in DB')

    console.log(`${LOG} Loaded ${data.length} ${mode} models from Supabase`)
    return data.map(m => ({
      id:          m.id,
      name:        m.name,
      provider:    m.provider,
      outputPrice: mode === 'image'
        ? getImagePrice(m.raw?.pricing)
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
  if (mode === 'image') return `$${parseFloat(outputPrice.toFixed(4))} / image`
  return `$${outputPrice.toFixed(2)} / 1M tokens`
}

// ── Text: streaming via AI SDK ────────────────────────────────────────────────

async function tryTextModel(
  model: ModelEntry,
  index: number,
  prompt: string,
  controller: ReadableStreamDefaultController
): Promise<boolean> {
  const start = Date.now()
  console.log(`${LOG} Slot[${index}] text: ${model.id}`)

  try {
    const result = streamText({
      model:     gateway(model.id),
      messages:  [{ role: 'user', content: prompt }],
      maxOutputTokens: 512,
    })

    let firstChunk = true
    for await (const delta of result.textStream) {
      if (firstChunk) {
        console.log(`${LOG} Slot[${index}] first chunk +${Date.now() - start}ms`)
        firstChunk = false
      }
      controller.enqueue(sse(`delta:${index}`, { index, text: delta }))
    }

    const usage    = await result.usage
    const meta     = await result.providerMetadata
    const tokens   = usage?.outputTokens ?? 0
    // Use gateway's marketCost if available, else fall back to manual calc
    const cost     = (meta?.gateway as any)?.marketCost
                  ?? (tokens / 1_000_000) * model.outputPrice

    const responseTime = Date.now() - start
    console.log(`${LOG} Slot[${index}] ${model.id} done: ${tokens} tokens ${responseTime}ms cost=$${cost}`)
    controller.enqueue(sse(`done:${index}`, { index, tokens, responseTime, cost }))
    return true

  } catch (err) {
    console.warn(`${LOG} Slot[${index}] ${model.id} failed: ${err}`)
    return false
  }
}

// ── Image: via AI SDK generateImage ──────────────────────────────────────────

async function tryImageModel(
  model: ModelEntry,
  index: number,
  prompt: string,
  controller: ReadableStreamDefaultController
): Promise<boolean> {
  const start = Date.now()
  console.log(`${LOG} Slot[${index}] image: ${model.id}`)

  try {
    const result = await generateImage({
      model:  gateway.imageModel(model.id),
      prompt,
    })

    const image = result.images?.[0]
    if (!image) throw new Error('No image in response')

    // ai@6 GeneratedFile has base64 + mediaType, no .url
    const imageUrl = `data:${image.mediaType};base64,${image.base64}`

    const meta = result.providerMetadata
    // Use gateway's marketCost if available, else use flat outputPrice from Supabase
    const cost = (meta?.gateway as any)?.marketCost ?? model.outputPrice

    const responseTime = Date.now() - start
    console.log(`${LOG} Slot[${index}] ${model.id} image done: ${responseTime}ms cost=$${cost}`)

    controller.enqueue(sse(`delta:${index}`, { index, text: imageUrl, isImage: true }))
    controller.enqueue(sse(`done:${index}`,  { index, tokens: 1, responseTime, cost }))
    return true

  } catch (err) {
    console.warn(`${LOG} Slot[${index}] ${model.id} failed: ${err}`)
    return false
  }
}

// ── Video: via AI SDK generateVideo ──────────────────────────────────────────

async function tryVideoModel(
  model:      ModelEntry,
  index:      number,
  prompt:     string,
  controller: ReadableStreamDefaultController
): Promise<boolean> {
  const start = Date.now()
  console.log(`${LOG} Slot[${index}] video: ${model.id}`)

  try {
    const result = await generateVideo({
      model:   gateway.videoModel(model.id),
      prompt,
      aspectRatio: '16:9',
    })

    const video = result.videos?.[0]
    if (!video) throw new Error('No video in response')

    const videoUrl = `data:${video.mediaType};base64,${video.base64}`

    const meta = result.providerMetadata
    const cost = (meta?.gateway as any)?.marketCost ?? model.outputPrice

    const responseTime = Date.now() - start
    console.log(`${LOG} Slot[${index}] ${model.id} video done: ${responseTime}ms cost=$${cost}`)

    controller.enqueue(sse(`delta:${index}`, { index, text: videoUrl, isVideo: true }))
    controller.enqueue(sse(`done:${index}`,  { index, tokens: 1, responseTime, cost }))
    return true

  } catch (err) {
    console.warn(`${LOG} Slot[${index}] ${model.id} failed: ${err}`)
    return false
  }
}

// ── Worker: pop model from queue, retry on failure ────────────────────────────

async function runWorker(
  index:          number,
  queue:          ModelEntry[],
  prompt:         string,
  mode:           string,
  controller:     ReadableStreamDefaultController,
  resolvedModels: (ModelEntry | null)[]
) {
  while (queue.length > 0) {
    const model = queue.shift()!
    console.log(`${LOG} Slot[${index}] trying ${model.id} (${queue.length} remaining)`)

    controller.enqueue(sse(`trying:${index}`, {
      index,
      name:        model.name,
      provider:    model.provider,
      outputPrice: model.outputPrice,
      priceLabel:  priceLabel(mode, model.outputPrice),
    }))

    const ok = mode === 'image'
      ? await tryImageModel(model, index, prompt, controller)
      : mode === 'video'
      ? await tryVideoModel(model, index, prompt, controller)
      : await tryTextModel(model, index, prompt, controller)

    if (ok) {
      resolvedModels[index] = model
      return
    }
    console.warn(`${LOG} Slot[${index}] ${model.id} failed — trying next`)
  }
  console.error(`${LOG} Slot[${index}] all models exhausted`)
  controller.enqueue(sse(`error:${index}`, { index, message: 'All models failed — no response available for this slot.' }))
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const { prompt, mode = 'text', count = 2 } = await req.json()

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

  console.log(`${LOG} Pool: ${pool.length} ${mode} models available`)
  console.log(`${LOG} Starting duel: ${n} workers, mode=${mode}, queue: ${queue.map(m => m.id).join(', ')}`)

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(sse('meta', { count: n, mode }))
      await Promise.all(
        Array.from({ length: n }, (_, i) => runWorker(i, queue, prompt, mode, controller, resolvedModels))
      )
      controller.enqueue(sse('resolved', {
        models: resolvedModels.map(m => m ? {
          id:          m.id,
          name:        m.name,
          provider:    m.provider,
          outputPrice: m.outputPrice,
          inputPrice:  m.inputPrice,
          priceLabel:  priceLabel(mode, m.outputPrice),
        } : null)
      }))
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
