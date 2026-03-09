// app/api/duel/route.ts
// SSE streaming duel — text mode streams tokens, image mode returns URLs
// N workers share a shuffled model queue with fallback retry.

import { getModelsByMode, ModelEntry } from '../../../lib/models'

const GATEWAY_URL      = 'https://ai-gateway.vercel.sh/v1/chat/completions'
const GATEWAY_IMG_URL  = 'https://ai-gateway.vercel.sh/v1/images/generations'
const LOG              = '[duel]'
const TIMEOUT_MS       = 30000  // 30s (image gen takes longer)

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
    const { data, error } = await supabase
      .from('ai_models')
      .select('*')
      .contains('modes', [mode])
      .eq('enabled', true)

    if (error) throw error
    if (!data || data.length < 2) throw new Error('Not enough models in DB')

    console.log(`${LOG} Loaded ${data.length} ${mode} models from Supabase`)
    return data.map(m => ({
      id:          m.id,
      name:        m.name,
      provider:    m.provider,
      outputPrice: m.output_price ?? 0,
      inputPrice:  m.input_price  ?? 0,
      modes:       m.modes ?? [mode],
    }))
  } catch (err) {
    console.warn(`${LOG} Supabase unavailable, using fallback:`, err)
    return getModelsByMode(mode as 'text' | 'image' | 'video')
  }
}

// ── Text: streaming chat completions ─────────────────────────────────────────

async function tryTextModel(
  model: ModelEntry,
  index: number,
  prompt: string,
  controller: ReadableStreamDefaultController
): Promise<boolean> {
  const start = Date.now()
  let tokens = 0

  console.log(`${LOG} Slot[${index}] text: ${model.id}`)

  let res: Response
  try {
    res = await Promise.race([
      fetch(GATEWAY_URL, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${process.env.AI_GATEWAY_API_KEY}`,
        },
        body: JSON.stringify({
          model:      model.id,
          messages:   [{ role: 'user', content: prompt }],
          max_tokens: 512,
          stream:     true,
        }),
      }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`Timeout`)), TIMEOUT_MS)),
    ])
  } catch (err) {
    console.warn(`${LOG} Slot[${index}] ${model.id} fetch failed: ${err}`)
    return false
  }

  console.log(`${LOG} Slot[${index}] ${model.id} HTTP ${res.status}`)
  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => res.statusText)
    console.warn(`${LOG} Slot[${index}] error: ${errText.slice(0, 200)}`)
    return false
  }

  const reader  = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer    = ''
  let firstChunk = true

  try {
    while (true) {
      const { done, value } = await Promise.race([
        reader.read(),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Stream timeout')), TIMEOUT_MS)),
      ])
      if (done) break

      if (firstChunk) {
        console.log(`${LOG} Slot[${index}] first chunk +${Date.now()-start}ms`)
        firstChunk = false
      }

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const raw = line.slice(6).trim()
        if (raw === '[DONE]') continue
        try {
          const chunk = JSON.parse(raw)
          const delta = chunk.choices?.[0]?.delta?.content
          if (delta) {
            tokens++
            controller.enqueue(sse(`delta:${index}`, { index, text: delta }))
          }
          if (chunk.usage?.completion_tokens) tokens = chunk.usage.completion_tokens
        } catch {}
      }
    }
  } catch (err) {
    console.warn(`${LOG} Slot[${index}] stream error: ${err}`)
    return false
  }

  const responseTime = Date.now() - start
  console.log(`${LOG} Slot[${index}] ${model.id} done: ${tokens} tokens ${responseTime}ms`)
  controller.enqueue(sse(`done:${index}`, { index, tokens, responseTime }))
  return true
}

// ── Image: single POST, returns URL ──────────────────────────────────────────

async function tryImageModel(
  model: ModelEntry,
  index: number,
  prompt: string,
  controller: ReadableStreamDefaultController
): Promise<boolean> {
  const start = Date.now()
  console.log(`${LOG} Slot[${index}] image: ${model.id}`)

  let res: Response
  try {
    res = await Promise.race([
      fetch(GATEWAY_IMG_URL, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${process.env.AI_GATEWAY_API_KEY}`,
        },
        body: JSON.stringify({
          model:  model.id,
          prompt,
          n:      1,
          size:   '1024x1024',
        }),
      }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Timeout')), TIMEOUT_MS)),
    ])
  } catch (err) {
    console.warn(`${LOG} Slot[${index}] ${model.id} fetch failed: ${err}`)
    return false
  }

  console.log(`${LOG} Slot[${index}] ${model.id} HTTP ${res.status}`)
  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText)
    console.warn(`${LOG} Slot[${index}] error: ${errText.slice(0, 200)}`)
    return false
  }

  let imageUrl: string
  try {
    const data = await res.json()
    const raw = data.data?.[0]?.url ?? data.data?.[0]?.b64_json
    if (!raw) throw new Error('No image URL in response')
    // If it's raw base64 (no http prefix), add data URI prefix
    imageUrl = raw.startsWith('http') ? raw : `data:image/png;base64,${raw}`
  } catch (err) {
    console.warn(`${LOG} Slot[${index}] ${model.id} parse failed: ${err}`)
    return false
  }

  const responseTime = Date.now() - start
  console.log(`${LOG} Slot[${index}] ${model.id} image done: ${responseTime}ms`)

  // For image mode we send the full URL as a single delta, then done
  controller.enqueue(sse(`delta:${index}`, { index, text: imageUrl, isImage: true }))
  controller.enqueue(sse(`done:${index}`,  { index, tokens: 1, responseTime }))
  return true
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
      name:       model.name,
      provider:   model.provider,
      outputPrice: model.outputPrice,
      priceLabel: `$${model.outputPrice.toFixed(2)} / 1M tokens`,
    }))

    const ok = mode === 'image'
      ? await tryImageModel(model, index, prompt, controller)
      : await tryTextModel(model, index, prompt, controller)

    if (ok) {
      resolvedModels[index] = model
      return
    }
    console.warn(`${LOG} Slot[${index}] ${model.id} failed — trying next`)
  }
  console.error(`${LOG} Slot[${index}] all models exhausted`)
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const { prompt, mode = 'text', count = 2 } = await req.json()

  if (!prompt || prompt.trim().length < 3) {
    return Response.json({ error: 'Prompt too short' }, { status: 400 })
  }

  const n    = Math.min(Math.max(count, 2), 4)
  const pool = await getModels(mode)
  if (pool.length < 2) {
    return Response.json({ error: `Not enough models for mode: ${mode}` }, { status: 400 })
  }

  const queue: ModelEntry[]          = [...pool].sort(() => Math.random() - 0.5)
  const resolvedModels: (ModelEntry | null)[] = Array(n).fill(null)

  console.log(`${LOG} Starting duel: ${n} workers, mode=${mode}, queue: ${queue.map(m=>m.id).join(', ')}`)

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
          priceLabel:  `$${m.outputPrice.toFixed(2)} / 1M tokens`,
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
