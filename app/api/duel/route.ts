// app/api/duel/route.ts
// N workers share a shuffled model queue.
// Each worker pops the next model, calls it, retries on failure.

import { createClient } from '@supabase/supabase-js'
import { getModelsByMode, ModelEntry } from '../../../lib/models'

const GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/chat/completions'
const LOG = '[duel]'
const TIMEOUT_MS = 15000  // 15s per model attempt

function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

async function getModels(mode: string): Promise<ModelEntry[]> {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY!
    )
    const { data, error } = await supabase
      .from('ai_models')
      .select('*')
      .contains('modes', [mode])
      .eq('enabled', true)

    if (error) throw new Error(error.message)
    if (!data || data.length < 2) throw new Error('Not enough models in DB')

    console.log(`${LOG} Loaded ${data.length} ${mode} models from Supabase`)
    return data.map(row => ({
      id:          row.id,
      name:        row.name,
      provider:    row.provider,
      outputPrice: row.output_price ?? 0,
      inputPrice:  row.input_price ?? 0,
      modes:       [mode as 'text' | 'image' | 'video'],
    }))
  } catch (err) {
    console.warn(`${LOG} Supabase unavailable, using fallback:`, err)
    return getModelsByMode(mode as 'text' | 'image' | 'video')
  }
}

async function tryModel(
  model: ModelEntry,
  index: number,
  prompt: string,
  controller: ReadableStreamDefaultController
): Promise<boolean> {
  const start = Date.now()
  let tokens = 0

  console.log(`${LOG} Slot[${index}] fetching ${model.id}...`)

  let res: Response
  try {
    const fetchPromise = fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.AI_GATEWAY_API_KEY}`,
      },
      body: JSON.stringify({
        model: model.id,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 512,
        stream: true,
      }),
    })
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${TIMEOUT_MS}ms`)), TIMEOUT_MS)
    )
    res = await Promise.race([fetchPromise, timeoutPromise])
  } catch (err) {
    console.warn(`${LOG} Slot[${index}] ${model.id} fetch failed: ${err}`)
    return false
  }

  console.log(`${LOG} Slot[${index}] ${model.id} HTTP ${res.status}`)

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => res.statusText)
    console.warn(`${LOG} Slot[${index}] ${model.id} error body: ${errText.slice(0, 200)}`)
    return false
  }

  console.log(`${LOG} Slot[${index}] ${model.id} streaming...`)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let firstChunk = true

  try {
    while (true) {
      const readPromise = reader.read()
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Stream read timeout`)), TIMEOUT_MS)
      )
      const { done, value } = await Promise.race([readPromise, timeoutPromise])
      if (done) break

      if (firstChunk) {
        console.log(`${LOG} Slot[${index}] ${model.id} first chunk received (+${Date.now()-start}ms)`)
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
          if (chunk.usage?.completion_tokens) {
            tokens = chunk.usage.completion_tokens
          }
        } catch {}
      }
    }
  } catch (err) {
    console.warn(`${LOG} Slot[${index}] ${model.id} stream error: ${err}`)
    return false
  }

  const responseTime = Date.now() - start
  console.log(`${LOG} Slot[${index}] ${model.id} complete: ${tokens} tokens ${responseTime}ms`)
  controller.enqueue(sse(`done:${index}`, { index, tokens, responseTime }))
  return true
}

async function runWorker(
  index: number,
  queue: ModelEntry[],
  prompt: string,
  controller: ReadableStreamDefaultController,
  resolvedModels: ModelEntry[]
) {
  while (queue.length > 0) {
    const model = queue.shift()!
    console.log(`${LOG} Slot[${index}] trying ${model.id} (${queue.length} remaining in queue)`)

    controller.enqueue(sse(`trying:${index}`, {
      index,
      name:        model.name,
      provider:    model.provider,
      outputPrice: model.outputPrice,
      priceLabel:  `$${model.outputPrice.toFixed(2)} / 1M tokens`,
    }))

    const ok = await tryModel(model, index, prompt, controller)
    if (ok) {
      resolvedModels[index] = model
      return
    }
    console.warn(`${LOG} Slot[${index}] ${model.id} failed — trying next`)
  }

  console.error(`${LOG} Slot[${index}] all models exhausted`)
  controller.enqueue(sse(`done:${index}`, { index, tokens: 0, responseTime: 0, failed: true }))
}

export async function POST(req: Request) {
  const { prompt, mode = 'text', count = 2 } = await req.json()
  const n = Math.min(Math.max(2, count), 4)

  if (!prompt || prompt.trim().length < 3) {
    return Response.json({ error: 'Prompt too short' }, { status: 400 })
  }
  if (!process.env.AI_GATEWAY_API_KEY) {
    return Response.json({ error: 'AI_GATEWAY_API_KEY not set' }, { status: 500 })
  }

  const pool = await getModels(mode)
  if (pool.length < n) {
    return Response.json({ error: `Not enough models for mode: ${mode}` }, { status: 400 })
  }

  const queue: ModelEntry[] = [...pool].sort(() => Math.random() - 0.5)
  const resolvedModels: ModelEntry[] = new Array(n)

  console.log(`${LOG} Starting duel: ${n} workers, ${queue.length} models in queue: ${queue.map(m=>m.id).join(', ')}`)

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder()
      const enqueueRaw = controller.enqueue.bind(controller)
      controller.enqueue = (chunk: string) => enqueueRaw(enc.encode(chunk))

      controller.enqueue(sse('meta', { count: n }))

      await Promise.all(
        Array.from({ length: n }, (_, i) => runWorker(i, queue, prompt, controller, resolvedModels))
      )

      controller.enqueue(sse('resolved', {
        models: resolvedModels.map(m => m ? {
          name:        m.name,
          provider:    m.provider,
          outputPrice: m.outputPrice,
          priceLabel:  `$${m.outputPrice.toFixed(2)} / 1M tokens`,
        } : null),
      }))

      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    },
  })
}
