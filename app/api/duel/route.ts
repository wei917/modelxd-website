// app/api/duel/route.ts
// Streams N models in parallel via SSE
// Events: meta | delta:{index} | done:{index} | error:{index}
// Request body: { prompt, mode?, count? }  — count defaults to 2, max 4

import { createClient } from '@supabase/supabase-js'
import { getModelsByMode, pickN, ModelEntry } from '../../../lib/models'

const GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/chat/completions'
const LOG = '[duel]'

function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

async function getModels(mode: string, count: number): Promise<ModelEntry[]> {
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
    if (!data || data.length < count) throw new Error(`Not enough models in DB (need ${count}, have ${data?.length ?? 0})`)

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

async function streamModel(
  model: ModelEntry,
  index: number,
  prompt: string,
  controller: ReadableStreamDefaultController
) {
  const start = Date.now()
  let tokens = 0

  const res = await fetch(GATEWAY_URL, {
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

  if (!res.ok || !res.body) {
    const err = await res.text()
    controller.enqueue(sse(`error:${index}`, { index, message: `${res.status}: ${err}` }))
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

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

  const responseTime = Date.now() - start
  console.log(`${LOG} Model[${index}] ${model.id} done: ${tokens} tokens ${responseTime}ms`)
  controller.enqueue(sse(`done:${index}`, { index, tokens, responseTime }))
}

export async function POST(req: Request) {
  const { prompt, mode = 'text', count = 2 } = await req.json()
  const n = Math.min(Math.max(2, count), 4)  // clamp 2–4

  if (!prompt || prompt.trim().length < 3) {
    return Response.json({ error: 'Prompt too short' }, { status: 400 })
  }
  if (!process.env.AI_GATEWAY_API_KEY) {
    return Response.json({ error: 'AI_GATEWAY_API_KEY not set' }, { status: 500 })
  }

  const pool = await getModels(mode, n)
  if (pool.length < n) {
    return Response.json({ error: `Not enough models for mode: ${mode}` }, { status: 400 })
  }

  const contestants = pickN(pool, n)
  console.log(`${LOG} Duel (${n}): ${contestants.map(m => m.id).join(' vs ')}`)

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder()
      const enqueueRaw = controller.enqueue.bind(controller)
      controller.enqueue = (chunk: string) => enqueueRaw(enc.encode(chunk))

      // Send metadata for all models first
      controller.enqueue(sse('meta', {
        count: n,
        models: contestants.map(m => ({
          name:        m.name,
          provider:    m.provider,
          outputPrice: m.outputPrice,
          priceLabel:  `$${m.outputPrice.toFixed(2)} / 1M tokens`,
        })),
      }))

      // Stream all models in parallel
      await Promise.all(
        contestants.map((m, i) => streamModel(m, i, prompt, controller))
      )

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
