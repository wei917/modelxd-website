// app/api/duel/route.ts
// N workers share a shuffled model queue.
// Each worker pops the next model, calls it, retries on failure.

import { createClient } from '@supabase/supabase-js'
import { getModelsByMode, ModelEntry } from '../../../lib/models'

const GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/chat/completions'
const LOG = '[duel]'

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
      .eq('mode', mode)
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
      mode:        mode as 'text' | 'image' | 'video',
    }))
  } catch (err) {
    console.warn(`${LOG} Supabase unavailable, using fallback:`, err)
    return getModelsByMode(mode as 'text' | 'image' | 'video')
  }
}

// Try one model — returns true on success, false on any error
async function tryModel(
  model: ModelEntry,
  index: number,
  prompt: string,
  controller: ReadableStreamDefaultController
): Promise<boolean> {
  const start = Date.now()
  let tokens = 0

  let res: Response
  try {
    res = await fetch(GATEWAY_URL, {
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
  } catch (err) {
    console.warn(`${LOG} Slot[${index}] ${model.id} fetch error:`, err)
    return false
  }

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => res.statusText)
    console.warn(`${LOG} Slot[${index}] ${model.id} HTTP ${res.status}: ${errText.slice(0, 120)}`)
    return false
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

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
    console.warn(`${LOG} Slot[${index}] ${model.id} stream error:`, err)
    return false
  }

  const responseTime = Date.now() - start
  console.log(`${LOG} Slot[${index}] ${model.id} done: ${tokens} tokens ${responseTime}ms`)
  controller.enqueue(sse(`done:${index}`, { index, tokens, responseTime }))
  return true
}

// Worker: keeps popping from the shared queue until one succeeds
async function runWorker(
  index: number,
  queue: ModelEntry[],       // shared mutable array — pop() is the sync "lock"
  prompt: string,
  controller: ReadableStreamDefaultController,
  resolvedModels: ModelEntry[]
) {
  while (queue.length > 0) {
    const model = queue.shift()!  // grab next available model
    console.log(`${LOG} Slot[${index}] trying ${model.id} (${queue.length} left in queue)`)

    // Update meta so frontend shows who is currently being tried
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
    // Failed — loop will try next model from queue
  }
  // Queue exhausted
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

  // Shuffle once — shared queue all workers draw from
  const queue: ModelEntry[] = [...pool].sort(() => Math.random() - 0.5)
  const resolvedModels: ModelEntry[] = new Array(n)

  console.log(`${LOG} Starting duel: ${n} workers, ${queue.length} models in queue`)

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder()
      const enqueueRaw = controller.enqueue.bind(controller)
      controller.enqueue = (chunk: string) => enqueueRaw(enc.encode(chunk))

      // Send initial meta with placeholder names — will update via trying/resolved events
      controller.enqueue(sse('meta', { count: n }))

      // Launch all workers in parallel — they compete for models from the shared queue
      await Promise.all(
        Array.from({ length: n }, (_, i) => runWorker(i, queue, prompt, controller, resolvedModels))
      )

      // Send final resolved models for the reveal step
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
