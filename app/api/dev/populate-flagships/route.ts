// app/api/dev/populate-flagships/route.ts
//
// DEV-ONLY endpoint that (a) ensures the `is_flagship` column exists on
// ai_models and (b) applies a curated allowlist of flagship / popular model
// names. This mirrors supabase/09_flagship_column.sql so we don't need to
// hop into the Supabase SQL editor for every reshuffle of the allowlist.
//
// Usage:
//   POST /api/dev/populate-flagships
// Returns a summary of how many rows were marked per company.

import { createClient } from '@supabase/supabase-js'

// Curated allowlist — keep in sync with supabase/09_flagship_column.sql.
// These are OpenRouter model_name values (format: "<company>/<model>").
const FLAGSHIP_MODELS: string[] = [
  // OpenAI
  'openai/gpt-5',
  'openai/gpt-5-mini',
  'openai/gpt-5-nano',
  'openai/gpt-5-pro',
  'openai/gpt-5-chat',
  'openai/gpt-5-image',
  'openai/gpt-5-image-mini',
  'openai/gpt-4o',
  'openai/gpt-4o-mini',
  'openai/gpt-4.1',
  'openai/gpt-4.1-mini',
  'openai/o1',
  'openai/o1-pro',
  'openai/o3',
  'openai/o3-mini',
  'openai/o4-mini',

  // Anthropic
  'anthropic/claude-opus-4.6',
  'anthropic/claude-sonnet-4.6',
  'anthropic/claude-haiku-4.5',
  'anthropic/claude-opus-4.5',
  'anthropic/claude-sonnet-4.5',
  'anthropic/claude-opus-4',
  'anthropic/claude-sonnet-4',
  'anthropic/claude-3.7-sonnet',
  'anthropic/claude-3.5-sonnet',
  'anthropic/claude-3.5-haiku',

  // Google
  'google/gemini-3-pro',
  'google/gemini-3-pro-preview',
  'google/gemini-3-flash',
  'google/gemini-3-flash-preview',
  'google/gemini-3-pro-image-preview',
  'google/gemini-3.1-flash-image-preview',
  'google/gemini-2.5-pro',
  'google/gemini-2.5-flash',
  'google/gemini-2.5-flash-lite',
  'google/gemini-2.0-flash',

  // Meta (Llama)
  'meta-llama/llama-4-maverick',
  'meta-llama/llama-4-scout',
  'meta-llama/llama-4-behemoth',
  'meta-llama/llama-3.3-70b-instruct',
  'meta-llama/llama-3.1-405b-instruct',
  'meta-llama/llama-3.1-70b-instruct',

  // DeepSeek
  'deepseek/deepseek-v3.2-exp',
  'deepseek/deepseek-v3.1',
  'deepseek/deepseek-v3',
  'deepseek/deepseek-chat',
  'deepseek/deepseek-r1',
  'deepseek/deepseek-r1-0528',

  // xAI
  'x-ai/grok-4',
  'x-ai/grok-4-fast',
  'x-ai/grok-4-fast-reasoning',
  'x-ai/grok-3',
  'x-ai/grok-3-mini',
  'x-ai/grok-code-fast-1',

  // Mistral
  'mistralai/mistral-large-2411',
  'mistralai/mistral-large',
  'mistralai/mistral-medium-3.1',
  'mistralai/mistral-medium',
  'mistralai/mistral-small-3.2-24b-instruct',
  'mistralai/codestral-2508',
  'mistralai/pixtral-large-2411',

  // Qwen
  'qwen/qwen3-max',
  'qwen/qwen3-235b-a22b',
  'qwen/qwen3-coder',
  'qwen/qwen3-vl-235b-a22b-instruct',
  'qwen/qwen-2.5-72b-instruct',
  'qwen/qwen-2.5-coder-32b-instruct',

  // Moonshot
  'moonshotai/kimi-k2',
  'moonshotai/kimi-k2-0905',
  'moonshotai/kimi-dev-72b',

  // Z.AI (GLM)
  'z-ai/glm-4.6',
  'z-ai/glm-4.5',
  'z-ai/glm-4.5-air',

  // Image specialists — real OpenRouter slugs verified against /v1/models
  // and /api/frontend/models on 2026-04-11. FLUX 1.x / Stability AI / Runway
  // were removed because OpenRouter doesn't list them under image output.
  'black-forest-labs/flux.2-max',
  'black-forest-labs/flux.2-pro',
  'bytedance-seed/seedream-4.5',

  // Video specialists
  'google/veo-3',
  'google/veo-3-fast',
  'openai/sora-2',
  'openai/sora-2-pro',
]

export async function POST() {
  if (process.env.NODE_ENV === 'production') {
    return new Response('Not Found', { status: 404 })
  }

  // Admin client — bypasses RLS so we can actually write.
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  )

  // 1. Clear the flag on every row so the allowlist is authoritative.
  //    (.neq trick — Supabase requires a filter on update.)
  const { error: clearErr } = await sb
    .from('ai_models')
    .update({ is_flagship: false })
    .not('model_name', 'is', null)
  if (clearErr) {
    return Response.json(
      {
        error: `failed to clear flagships — did you run the ALTER TABLE yet? Detail: ${clearErr.message}`,
      },
      { status: 500 },
    )
  }

  // 2. Mark the curated list as flagship.
  const { data, error } = await sb
    .from('ai_models')
    .update({ is_flagship: true })
    .in('model_name', FLAGSHIP_MODELS)
    .select('model_name')
  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  // Group matches by company for an at-a-glance summary.
  const byCompany: Record<string, number> = {}
  for (const row of data ?? []) {
    const company = (row.model_name as string).split('/')[0]
    byCompany[company] = (byCompany[company] ?? 0) + 1
  }

  // Which allowlist entries didn't match anything in the catalog? Useful to
  // spot model_name drift after a sync.
  const matchedSet = new Set((data ?? []).map(r => r.model_name as string))
  const unmatched = FLAGSHIP_MODELS.filter(m => !matchedSet.has(m))

  return Response.json({
    totalFlagged: data?.length ?? 0,
    byCompany,
    unmatched,
  })
}
