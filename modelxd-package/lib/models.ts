// lib/models.ts
// Curated model catalog for XDuel — famous/reliable models per mode
// Prices from https://ai-gateway.vercel.sh/v1/models

export type ModelEntry = {
  id: string           // Vercel AI Gateway model ID
  name: string         // Display name
  provider: string     // e.g. OpenAI, Anthropic
  outputPrice: number  // $ per 1M output tokens (or per-image/per-sec equivalent)
  inputPrice: number   // $ per 1M input tokens
  mode: 'text' | 'image' | 'video'
}

export const MODELS: ModelEntry[] = [

  // ── TEXT ────────────────────────────────────────────────
  { id: 'openai/gpt-4o',               name: 'GPT-4o',              provider: 'OpenAI',    inputPrice: 2.50,  outputPrice: 10.00, mode: 'text' },
  { id: 'openai/gpt-4o-mini',          name: 'GPT-4o Mini',         provider: 'OpenAI',    inputPrice: 0.15,  outputPrice: 0.60,  mode: 'text' },
  { id: 'anthropic/claude-sonnet-4',   name: 'Claude Sonnet 4',     provider: 'Anthropic', inputPrice: 3.00,  outputPrice: 15.00, mode: 'text' },
  { id: 'anthropic/claude-haiku-4.5',  name: 'Claude Haiku 4.5',    provider: 'Anthropic', inputPrice: 0.80,  outputPrice: 4.00,  mode: 'text' },
  { id: 'google/gemini-2.5-pro',       name: 'Gemini 2.5 Pro',      provider: 'Google',    inputPrice: 1.25,  outputPrice: 10.00, mode: 'text' },
  { id: 'google/gemini-2.5-flash',     name: 'Gemini 2.5 Flash',    provider: 'Google',    inputPrice: 0.30,  outputPrice: 2.50,  mode: 'text' },
  { id: 'google/gemini-2.5-flash-lite',name: 'Gemini 2.5 Flash Lite',provider: 'Google',   inputPrice: 0.10,  outputPrice: 0.40,  mode: 'text' },
  { id: 'deepseek/deepseek-v3',        name: 'DeepSeek V3',         provider: 'DeepSeek',  inputPrice: 0.27,  outputPrice: 1.10,  mode: 'text' },
  { id: 'xai/grok-3',                  name: 'Grok 3',              provider: 'xAI',       inputPrice: 3.00,  outputPrice: 15.00, mode: 'text' },
  { id: 'xai/grok-3-mini',             name: 'Grok 3 Mini',         provider: 'xAI',       inputPrice: 0.30,  outputPrice: 0.50,  mode: 'text' },
  { id: 'meta/llama-3.3-70b',          name: 'Llama 3.3 70B',       provider: 'Meta',      inputPrice: 0.23,  outputPrice: 0.40,  mode: 'text' },
  { id: 'mistral/mistral-small',       name: 'Mistral Small',       provider: 'Mistral',   inputPrice: 0.10,  outputPrice: 0.30,  mode: 'text' },

  // ── IMAGE ───────────────────────────────────────────────
  { id: 'openai/dall-e-3',             name: 'DALL-E 3',            provider: 'OpenAI',    inputPrice: 0,     outputPrice: 40.00, mode: 'image' },
  { id: 'bfl/flux-kontext-pro',        name: 'Flux Kontext Pro',    provider: 'BFL',       inputPrice: 0,     outputPrice: 30.00, mode: 'image' },
  { id: 'recraft/recraft-v2',          name: 'Recraft V2',          provider: 'Recraft',   inputPrice: 0,     outputPrice: 20.00, mode: 'image' },

  // ── VIDEO ───────────────────────────────────────────────
  { id: 'alibaba/wan-v2.5-t2v-preview',name: 'Wan 2.5 Text-to-Video',provider: 'Alibaba', inputPrice: 0,     outputPrice: 0.10,  mode: 'video' }, // $0.10/sec at 720p
  { id: 'alibaba/wan-v2.6-t2v',        name: 'Wan 2.6 Text-to-Video',provider: 'Alibaba', inputPrice: 0,     outputPrice: 0.10,  mode: 'video' },
]

export function getModelsByMode(mode: 'text' | 'image' | 'video'): ModelEntry[] {
  return MODELS.filter(m => m.mode === mode)
}

export function pickTwo(models: ModelEntry[]): [ModelEntry, ModelEntry] {
  const shuffled = [...models].sort(() => Math.random() - 0.5)
  return [shuffled[0], shuffled[1]]
}
