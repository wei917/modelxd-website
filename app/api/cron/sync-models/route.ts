// app/api/cron/sync-models/route.ts
// Cron job: fetch pricing pages, use LLM to parse models, upsert to ai_models table.
// Each provider is parsed independently. If a provider parse succeeds,
// disable all old models for that provider and enable only the parsed ones.
// If a provider parse fails, skip it entirely (no changes).

export const runtime     = 'nodejs'
export const maxDuration = 120

import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'

const LOG = '[sync-models]'

// ── Types ────────────────────────────────────────────────────────────────────

interface ParsedModel {
  model_name:         string
  name:               string
  modes:              string[]          // ['text'] | ['image'] | ['video']
  input_price:        number | null     // per 1M tokens
  cached_input_price: number | null     // per 1M tokens
  output_price:       number | null     // per 1M tokens
  input_image_price:  number | null     // per 1M tokens
  output_image_price: number | null     // per 1M tokens
  image_pricing:      Record<string, number> | null  // { "low": 0.009, ... } or { "1024px": 0.067, ... }
  video_pricing:      Record<string, number> | null  // { "720p": 0.10, ... }
  image_sizes:        string[] | null
  video_sizes:        string[] | null
  video_durations:    number[] | null
  context_window:     number | null
  max_output_tokens:  number | null
  tags:               string[]          // ['vision', 'reasoning']
}

interface ProviderConfig {
  provider: string
  urls:     string[]
  prompt:   string
}

// ── Provider configs ─────────────────────────────────────────────────────────

const PROVIDERS: ProviderConfig[] = [
  {
    provider: 'openai',
    urls: [
      'https://developers.openai.com/api/docs/pricing',
      'https://openai.com/api/pricing/',
    ],
    prompt: `You are a data extraction assistant. From the webpage content below, extract ALL OpenAI API models that support text generation, image generation, or video generation.

Focus on:
- Text models: GPT-5.4, GPT-5.4 Pro, GPT-5.2, GPT-5, GPT-5 Mini, GPT-5 Nano, GPT-4.1, GPT-4.1 Mini, GPT-4.1 Nano, o3, o3 Pro, o4-mini, and any other current text generation models
- Image models: gpt-image-1.5, gpt-image-1, gpt-image-1-mini, and any other current image generation models
- Video models: sora-2, sora-2-pro, and any other current video generation models

For each model, extract:
- model_name: the exact API model string (e.g. "gpt-5.4", "gpt-image-1.5", "sora-2")
- name: human-readable display name (e.g. "GPT-5.4", "GPT Image 1.5", "Sora 2")
- modes: array of ["text"], ["image"], or ["video"]
- input_price: cost per 1M input tokens (for text models, use standard/short-context price)
- cached_input_price: cost per 1M cached input tokens (if available)
- output_price: cost per 1M output tokens
- For image models: image_pricing as {"low": price, "medium": price, "high": price} per image, and image_sizes
- For video models: video_pricing as {"720p": price_per_second} or similar, and video_sizes, video_durations
- context_window, max_output_tokens if mentioned
- tags: ["vision"] if supports image input, ["reasoning"] if it's a reasoning model

IMPORTANT:
- All token prices must be per 1M tokens in USD
- Skip deprecated/legacy models (DALL-E 2, DALL-E 3, GPT-3.5, GPT-4, GPT-4o, GPT-4o-mini, o1, o1-mini, o3-mini)
- Only include models available in the current API
- Return ONLY valid JSON array, no markdown, no explanation`,
  },
  {
    provider: 'google',
    urls: [
      'https://ai.google.dev/gemini-api/docs/pricing',
      'https://ai.google.dev/gemini-api/docs/models',
    ],
    prompt: `You are a data extraction assistant. From the webpage content below, extract ALL Google Gemini API models that support text generation, image generation, or video generation.

Focus on:
- Text models: Gemini 3.1 Pro, Gemini 3 Flash, Gemini 3.1 Flash-Lite, Gemini 2.5 Pro, Gemini 2.5 Flash, Gemini 2.5 Flash-Lite, and any other current text generation models
- Image models: Nano Banana Pro (gemini-3-pro-image-preview), Nano Banana 2 (gemini-3.1-flash-image-preview), Nano Banana (gemini-2.5-flash native image), and any Imagen models available via the Gemini API
- Video models: Veo 3.1, Veo 3.1 Fast, Veo 3.1 Lite, and any other video generation models

For each model, extract:
- model_name: the exact API model string (e.g. "gemini-3.1-pro-preview", "gemini-3-pro-image-preview", "veo-3.1-generate-preview")
- name: human-readable display name (e.g. "Gemini 3.1 Pro", "Nano Banana Pro", "Veo 3.1")
- modes: array of ["text"], ["image"], or ["video"]
- input_price: cost per 1M input tokens (use paid tier, standard/short-context price)
- cached_input_price: cost per 1M cached input tokens (if available)
- output_price: cost per 1M output tokens (text output)
- For image models: input_image_price and output_image_price per 1M tokens if token-based, image_pricing as {"resolution": price_per_image} if per-image pricing
- For video models: video_pricing as {"default": price_per_second} or similar
- context_window, max_output_tokens if mentioned
- tags: ["vision"] if supports image/video input, ["reasoning"] if it's a reasoning model

IMPORTANT:
- All token prices must be per 1M tokens in USD (paid tier)
- Skip deprecated models (Gemini 1.5, Gemini 2.0, Gemini 3 Pro Preview which was shut down March 9 2026)
- Skip audio-only, TTS, embedding, and music models
- Only include models available in the current paid API tier
- Return ONLY valid JSON array, no markdown, no explanation`,
  },
]

// ── Helpers ──────────────────────────────────────────────────────────────────

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } }
  )
}

function openai() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'ModelXD-Sync/1.0' },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) {
      console.warn(`${LOG} fetch ${url} failed: ${res.status}`)
      return null
    }
    const html = await res.text()
    // Strip HTML tags, scripts, styles — keep text content only
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80_000) // cap context size
  } catch (err) {
    console.warn(`${LOG} fetch ${url} error:`, err)
    return null
  }
}

async function parseWithLLM(provider: string, pageContent: string, systemPrompt: string): Promise<ParsedModel[] | null> {
  try {
    const ai = openai()
    const completion = await ai.chat.completions.create({
      model: 'gpt-4.1-mini',
      temperature: 0,
      max_tokens: 8000,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Here is the webpage content to parse:\n\n${pageContent}` },
      ],
    })

    const raw = completion.choices[0]?.message?.content?.trim() ?? ''
    // Strip markdown fences if present
    const json = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim()
    const parsed = JSON.parse(json)

    if (!Array.isArray(parsed) || parsed.length === 0) {
      console.warn(`${LOG} LLM returned empty array for ${provider}`)
      return null
    }

    // Validate: every model must have model_name, name, modes
    const valid = parsed.filter((m: any) =>
      m.model_name && typeof m.model_name === 'string' &&
      m.name && typeof m.name === 'string' &&
      Array.isArray(m.modes) && m.modes.length > 0
    )

    if (valid.length === 0) {
      console.warn(`${LOG} No valid models parsed for ${provider}`)
      return null
    }

    console.log(`${LOG} parsed ${valid.length} models for ${provider}`)
    return valid as ParsedModel[]
  } catch (err) {
    console.error(`${LOG} LLM parse error for ${provider}:`, err)
    return null
  }
}

async function syncProvider(config: ProviderConfig): Promise<{ success: boolean; count: number }> {
  const { provider, urls, prompt } = config
  console.log(`${LOG} syncing ${provider}...`)

  // 1. Fetch all pages for this provider
  const pages = await Promise.all(urls.map(fetchPage))
  const combined = pages.filter(Boolean).join('\n\n---PAGE BREAK---\n\n')

  if (!combined || combined.length < 200) {
    console.warn(`${LOG} ${provider}: failed to fetch pages, skipping`)
    return { success: false, count: 0 }
  }

  // 2. Parse with LLM
  const models = await parseWithLLM(provider, combined, prompt)
  if (!models) {
    console.warn(`${LOG} ${provider}: LLM parse failed, skipping (no DB changes)`)
    return { success: false, count: 0 }
  }

  // 3. Upsert to DB — disable all existing, then upsert parsed models as enabled
  const sb = supabase()

  // Disable all existing models for this provider
  const { error: disableErr } = await sb
    .from('ai_models')
    .update({ enabled: false })
    .eq('provider', provider)

  if (disableErr) {
    console.error(`${LOG} ${provider}: failed to disable models:`, disableErr)
    return { success: false, count: 0 }
  }

  // Upsert each parsed model
  let upserted = 0
  for (const m of models) {
    const row: Record<string, any> = {
      provider,
      model_name:         m.model_name,
      name:               m.name,
      modes:              m.modes,
      input_price:        m.input_price ?? null,
      cached_input_price: m.cached_input_price ?? null,
      output_price:       m.output_price ?? null,
      input_image_price:  m.input_image_price ?? null,
      output_image_price: m.output_image_price ?? null,
      image_pricing:      m.image_pricing ?? null,
      video_pricing:      m.video_pricing ?? null,
      image_sizes:        m.image_sizes ?? null,
      video_sizes:        m.video_sizes ?? null,
      video_durations:    m.video_durations ?? null,
      context_window:     m.context_window ?? null,
      max_output_tokens:  m.max_output_tokens ?? null,
      tags:               m.tags ?? [],
      enabled:            true,
    }

    const { error } = await sb
      .from('ai_models')
      .upsert(row, { onConflict: 'provider,model_name' })

    if (error) {
      console.warn(`${LOG} ${provider}/${m.model_name}: upsert failed:`, error.message)
    } else {
      upserted++
    }
  }

  console.log(`${LOG} ${provider}: synced ${upserted}/${models.length} models`)
  return { success: true, count: upserted }
}

// ── Main handler ─────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  // Verify cron secret (Vercel sends this header for cron jobs)
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  console.log(`${LOG} starting sync...`)

  const results: Record<string, { success: boolean; count: number }> = {}

  for (const config of PROVIDERS) {
    results[config.provider] = await syncProvider(config)
  }

  console.log(`${LOG} sync complete:`, results)
  return Response.json({ ok: true, results })
}
