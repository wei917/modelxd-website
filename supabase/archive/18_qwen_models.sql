-- Add Alibaba models to ai_models.
-- Text models route through OpenRouter (provider='openrouter').
-- Image models route through DashScope direct API (provider='alibaba').

-- ── Flagship text models (via OpenRouter) ─────────────────────────────────

INSERT INTO ai_models (provider, model_name, name, modes, input_modalities, output_modalities,
  input_price, output_price, cached_input_price, context_window, tags, enabled)
VALUES
  ('openrouter', 'qwen/qwen3-235b-a22b', 'Qwen3 235B',
   ARRAY['text'], ARRAY['text'], ARRAY['text'],
   0.455, 1.82, NULL, 131072,
   ARRAY['qwen', 'flagship'], true),

  ('openrouter', 'qwen/qwen3-max', 'Qwen3 Max',
   ARRAY['text'], ARRAY['text'], ARRAY['text'],
   0.78, 3.90, NULL, 262144,
   ARRAY['qwen', 'flagship'], true),

  ('openrouter', 'qwen/qwen3.5-397b-a17b', 'Qwen3.5 397B',
   ARRAY['text'], ARRAY['text','image','video'], ARRAY['text'],
   0.39, 2.34, NULL, 262144,
   ARRAY['qwen', 'flagship', 'vision'], true),

  ('openrouter', 'qwen/qwq-32b', 'QwQ 32B',
   ARRAY['text'], ARRAY['text'], ARRAY['text'],
   0.15, 0.58, NULL, 131072,
   ARRAY['qwen', 'reasoning'], true)
ON CONFLICT (provider, model_name) DO UPDATE SET
  name              = EXCLUDED.name,
  modes             = EXCLUDED.modes,
  input_modalities  = EXCLUDED.input_modalities,
  output_modalities = EXCLUDED.output_modalities,
  input_price       = EXCLUDED.input_price,
  output_price      = EXCLUDED.output_price,
  context_window    = EXCLUDED.context_window,
  tags              = EXCLUDED.tags,
  enabled           = EXCLUDED.enabled;

-- ── Image generation models (via DashScope direct API) ────────────────────
-- Pricing: charged per image, not per token. We store the per-image price
-- in image_pricing jsonb. Update these when you confirm exact pricing from
-- https://www.alibabacloud.com/help/en/model-studio/model-pricing

INSERT INTO ai_models (provider, model_name, name, modes, input_modalities, output_modalities,
  image_pricing, image_sizes, tags, is_flagship, enabled)
VALUES
  ('alibaba', 'qwen-image-2.0-pro', 'Qwen Image 2.0 Pro',
   ARRAY['image'], ARRAY['text','image'], ARRAY['image'],
   '{"low": 0.04, "medium": 0.04, "high": 0.04, "default": 0.04}'::jsonb,
   ARRAY['1024x1024', '1280x720', '720x1280', '1024x1536', '1536x1024'],
   ARRAY['qwen', 'flagship', 'image-gen'], true, true),

  ('alibaba', 'qwen-image-2.0', 'Qwen Image 2.0',
   ARRAY['image'], ARRAY['text','image'], ARRAY['image'],
   '{"low": 0.02, "medium": 0.02, "high": 0.02, "default": 0.02}'::jsonb,
   ARRAY['1024x1024', '1280x720', '720x1280', '1024x1536', '1536x1024'],
   ARRAY['qwen', 'image-gen'], true, true)
ON CONFLICT (provider, model_name) DO UPDATE SET
  name              = EXCLUDED.name,
  modes             = EXCLUDED.modes,
  input_modalities  = EXCLUDED.input_modalities,
  output_modalities = EXCLUDED.output_modalities,
  image_pricing     = EXCLUDED.image_pricing,
  image_sizes       = EXCLUDED.image_sizes,
  tags              = EXCLUDED.tags,
  is_flagship       = EXCLUDED.is_flagship,
  enabled           = EXCLUDED.enabled;
