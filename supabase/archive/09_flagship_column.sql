-- ModelXD: add `is_flagship` boolean to ai_models so the Create mode picker
-- can default to a short list of well-known flagship/popular models instead
-- of dumping the full 300+ model catalog on the user.
--
-- Strategy: new column defaults to false, then a hardcoded allowlist of
-- model_name patterns marks the most recognizable / most-used models as
-- flagship = true. This is a CURATED list — future OpenRouter syncs will
-- preserve it as long as the sync script upserts instead of deletes.
--
-- Run this in the Supabase SQL Editor (or hit the dev endpoint
-- /api/dev/populate-flagships which replays the same UPDATE statements).

ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS is_flagship boolean DEFAULT false;

-- Reset the flag so the allowlist below is authoritative on re-run.
UPDATE ai_models SET is_flagship = false;

-- ── OpenAI ───────────────────────────────────────────────────────────────────
-- GPT-5 family + reasoning models. gpt-5-image* are also the OpenAI image
-- generators we already wire up in the image picker.
UPDATE ai_models SET is_flagship = true WHERE model_name IN (
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
  'openai/o4-mini'
);

-- ── Anthropic ────────────────────────────────────────────────────────────────
UPDATE ai_models SET is_flagship = true WHERE model_name IN (
  'anthropic/claude-opus-4.6',
  'anthropic/claude-sonnet-4.6',
  'anthropic/claude-haiku-4.5',
  'anthropic/claude-opus-4.5',
  'anthropic/claude-sonnet-4.5',
  'anthropic/claude-opus-4',
  'anthropic/claude-sonnet-4',
  'anthropic/claude-3.7-sonnet',
  'anthropic/claude-3.5-sonnet',
  'anthropic/claude-3.5-haiku'
);

-- ── Google ───────────────────────────────────────────────────────────────────
UPDATE ai_models SET is_flagship = true WHERE model_name IN (
  'google/gemini-3-pro',
  'google/gemini-3-pro-preview',
  'google/gemini-3-flash',
  'google/gemini-3-flash-preview',
  'google/gemini-3-pro-image-preview',
  'google/gemini-3.1-flash-image-preview',
  'google/gemini-2.5-pro',
  'google/gemini-2.5-flash',
  'google/gemini-2.5-flash-lite',
  'google/gemini-2.0-flash'
);

-- ── Meta (Llama) ─────────────────────────────────────────────────────────────
UPDATE ai_models SET is_flagship = true WHERE model_name IN (
  'meta-llama/llama-4-maverick',
  'meta-llama/llama-4-scout',
  'meta-llama/llama-4-behemoth',
  'meta-llama/llama-3.3-70b-instruct',
  'meta-llama/llama-3.1-405b-instruct',
  'meta-llama/llama-3.1-70b-instruct'
);

-- ── DeepSeek ─────────────────────────────────────────────────────────────────
UPDATE ai_models SET is_flagship = true WHERE model_name IN (
  'deepseek/deepseek-v3.2-exp',
  'deepseek/deepseek-v3.1',
  'deepseek/deepseek-v3',
  'deepseek/deepseek-chat',
  'deepseek/deepseek-r1',
  'deepseek/deepseek-r1-0528'
);

-- ── xAI ──────────────────────────────────────────────────────────────────────
UPDATE ai_models SET is_flagship = true WHERE model_name IN (
  'x-ai/grok-4',
  'x-ai/grok-4-fast',
  'x-ai/grok-4-fast-reasoning',
  'x-ai/grok-3',
  'x-ai/grok-3-mini',
  'x-ai/grok-code-fast-1'
);

-- ── Mistral ──────────────────────────────────────────────────────────────────
UPDATE ai_models SET is_flagship = true WHERE model_name IN (
  'mistralai/mistral-large-2411',
  'mistralai/mistral-large',
  'mistralai/mistral-medium-3.1',
  'mistralai/mistral-medium',
  'mistralai/mistral-small-3.2-24b-instruct',
  'mistralai/codestral-2508',
  'mistralai/pixtral-large-2411'
);

-- ── Qwen / Alibaba ───────────────────────────────────────────────────────────
UPDATE ai_models SET is_flagship = true WHERE model_name IN (
  'qwen/qwen3-max',
  'qwen/qwen3-235b-a22b',
  'qwen/qwen3-coder',
  'qwen/qwen3-vl-235b-a22b-instruct',
  'qwen/qwen-2.5-72b-instruct',
  'qwen/qwen-2.5-coder-32b-instruct'
);

-- ── Moonshot ─────────────────────────────────────────────────────────────────
UPDATE ai_models SET is_flagship = true WHERE model_name IN (
  'moonshotai/kimi-k2',
  'moonshotai/kimi-k2-0905',
  'moonshotai/kimi-dev-72b'
);

-- ── Z.AI (GLM) ───────────────────────────────────────────────────────────────
UPDATE ai_models SET is_flagship = true WHERE model_name IN (
  'z-ai/glm-4.6',
  'z-ai/glm-4.5',
  'z-ai/glm-4.5-air'
);

-- ── Image specialists ──────────────────────────────────────────────────────
-- Real OpenRouter slugs verified against /v1/models + /api/frontend/models
-- on 2026-04-11. FLUX 1.x / Stability AI / Runway removed because
-- OpenRouter doesn't list those slugs under image-output models.
UPDATE ai_models SET is_flagship = true WHERE model_name IN (
  'black-forest-labs/flux.2-max',
  'black-forest-labs/flux.2-pro',
  'bytedance-seed/seedream-4.5'
);

-- ── Video specialists ──────────────────────────────────────────────────────
UPDATE ai_models SET is_flagship = true WHERE model_name IN (
  'google/veo-3',
  'google/veo-3-fast',
  'openai/sora-2',
  'openai/sora-2-pro'
);

-- Sanity check — returns the flagship count per company prefix.
SELECT
  split_part(model_name, '/', 1) AS company,
  count(*)                        AS flagship_count
FROM ai_models
WHERE is_flagship = true
GROUP BY 1
ORDER BY 2 DESC;
