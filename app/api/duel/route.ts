// app/api/duel/route.ts
// Always reads models from Supabase ai_models (source of truth)
// Falls back to lib/models.ts if Supabase is unavailable

import { createClient } from '@supabase/supabase-js'
import { getModelsByMode, pickTwo, ModelEntry } from '../../../lib/models'

const GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/chat/completions'
const LOG = '[duel]'

async function getModels(mode: string): Promise<ModelEntry[]> {
  const modeFilter = mode === 'text' ? 'language' : mode

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data, error } = await supabase
      .from('ai_models')
      .select('*')
      .eq('mode', modeFilter)
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
    console.warn(`${LOG} Supabase unavailable, using fallback catalog:`, err)
    return getModelsByMode(mode as 'text' | 'image' | 'video')
  }
}

async function callModel(
  modelId: string,
  prompt: string
): Promise<{ text: string; tokens: number; responseTime: number }> {
  const start = Date.now()
  const res = await fetch(GATEWAY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.AI_GATEWAY_API_KEY}`,
    },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 512,
    }),
  })
  const responseTime = Date.now() - start

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gateway error for ${modelId}: ${res.status} — ${err}`)
  }

  const data = await res.json()
  const text   = data.choices?.[0]?.message?.content ?? '(no response)'
  const tokens = data.usage?.completion_tokens ?? 0
  return { text, tokens, responseTime }
}

export async function POST(req: Request) {
  const { prompt, mode = 'text' } = await req.json()

  if (!prompt || prompt.trim().length < 3) {
    return Response.json({ error: 'Prompt too short' }, { status: 400 })
  }

  if (!process.env.AI_GATEWAY_API_KEY) {
    return Response.json({ error: 'AI_GATEWAY_API_KEY not set' }, { status: 500 })
  }

  // Load models from Supabase (fallback to lib/models.ts)
  const pool = await getModels(mode)
  if (pool.length < 2) {
    return Response.json({ error: `Not enough models for mode: ${mode}` }, { status: 400 })
  }

  const [modelA, modelB] = pickTwo(pool)
  console.log(`${LOG} Duel: ${modelA.id} vs ${modelB.id}`)

  // Call both models in parallel
  const [resultA, resultB] = await Promise.all([
    callModel(modelA.id, prompt),
    callModel(modelB.id, prompt),
  ])

  console.log(`${LOG} Results — A: ${resultA.tokens} tokens ${resultA.responseTime}ms | B: ${resultB.tokens} tokens ${resultB.responseTime}ms`)

  const costA = (resultA.tokens / 1_000_000) * modelA.outputPrice
  const costB = (resultB.tokens / 1_000_000) * modelB.outputPrice

  return Response.json({
    modelA: {
      name:         modelA.name,
      provider:     modelA.provider,
      outputPrice:  modelA.outputPrice,
      response:     resultA.text,
      tokens:       resultA.tokens,
      cost:         costA,
      responseTime: resultA.responseTime,
      priceLabel:   `$${modelA.outputPrice.toFixed(2)} / 1M tokens`,
    },
    modelB: {
      name:         modelB.name,
      provider:     modelB.provider,
      outputPrice:  modelB.outputPrice,
      response:     resultB.text,
      tokens:       resultB.tokens,
      cost:         costB,
      responseTime: resultB.responseTime,
      priceLabel:   `$${modelB.outputPrice.toFixed(2)} / 1M tokens`,
    },
  })
}
