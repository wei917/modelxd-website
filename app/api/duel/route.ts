// app/api/duel/route.ts
// Calls two AI models in parallel via Vercel AI Gateway

const GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/chat/completions'

// The two models that battle each other
// Full model list: https://vercel.com/ai-gateway/models
const MODEL_A_ID = 'openai/gpt-4o-mini'
const MODEL_B_ID = 'google/gemini-2.5-flash'

// Pricing per 1M output tokens (for cost reveal)
// Update these if you swap models
const MODEL_A_INFO = { name: 'GPT-4o Mini',    provider: 'OpenAI', outputPrice: 0.60  }
const MODEL_B_INFO = { name: 'Gemini 2.5 Flash', provider: 'Google', outputPrice: 2.50 }

async function callModel(modelId: string, prompt: string): Promise<{ text: string; tokens: number }> {
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

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gateway error for ${modelId}: ${res.status} — ${err}`)
  }

  const data = await res.json()
  const text   = data.choices?.[0]?.message?.content ?? '(no response)'
  const tokens = data.usage?.completion_tokens ?? 0
  return { text, tokens }
}

export async function POST(req: Request) {
  const { prompt } = await req.json()

  if (!prompt || prompt.trim().length < 3) {
    return Response.json({ error: 'Prompt too short' }, { status: 400 })
  }

  if (!process.env.AI_GATEWAY_API_KEY) {
    return Response.json({ error: 'AI_GATEWAY_API_KEY not set' }, { status: 500 })
  }

  // Call both models at the same time
  const [resultA, resultB] = await Promise.all([
    callModel(MODEL_A_ID, prompt),
    callModel(MODEL_B_ID, prompt),
  ])

  // Compute per-prompt cost estimate
  // Formula: (output tokens / 1,000,000) * price per 1M tokens
  const costA = (resultA.tokens / 1_000_000) * MODEL_A_INFO.outputPrice
  const costB = (resultB.tokens / 1_000_000) * MODEL_B_INFO.outputPrice

  return Response.json({
    modelA: {
      ...MODEL_A_INFO,
      response: resultA.text,
      tokens:   resultA.tokens,
      cost:     costA,
      priceLabel: `$${MODEL_A_INFO.outputPrice.toFixed(2)} / 1M tokens`,
    },
    modelB: {
      ...MODEL_B_INFO,
      response: resultB.text,
      tokens:   resultB.tokens,
      cost:     costB,
      priceLabel: `$${MODEL_B_INFO.outputPrice.toFixed(2)} / 1M tokens`,
    },
  })
}
