-- ModelXD: ai_models — clean + reseed
-- Run in Supabase SQL Editor

-- Step 1: Clean slate
DELETE FROM ai_models;

-- Step 2: Add new columns if not exist
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS input_modalities text[] DEFAULT ARRAY['text'];
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS output_modalities text[] DEFAULT ARRAY['text'];

-- ══════════════════════════════════════════════════════════════════════════════
-- OpenAI Text Models (prices per 1M tokens, April 2026)
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO ai_models (provider, model_name, name, modes, input_modalities, output_modalities, input_price, cached_input_price, output_price, context_window, max_output_tokens, tags, enabled)
VALUES
  ('openai', 'gpt-5.4',      'GPT-5.4',       ARRAY['text'], ARRAY['text','image'], ARRAY['text'], 2.50,  0.25,  15.00, 1100000, 128000, ARRAY['vision'],             true),
  ('openai', 'gpt-5.4-mini', 'GPT-5.4 Mini',  ARRAY['text'], ARRAY['text','image'], ARRAY['text'], 0.75,  0.075,  4.50,  400000, 128000, ARRAY['vision'],             true),
  ('openai', 'gpt-5.4-nano', 'GPT-5.4 Nano',  ARRAY['text'], ARRAY['text','image'], ARRAY['text'], 0.20,  0.02,   1.25,  400000, 128000, ARRAY['vision'],             true),
  ('openai', 'gpt-5.4-pro',  'GPT-5.4 Pro',   ARRAY['text'], ARRAY['text','image'], ARRAY['text'], 30.00, 3.00, 180.00, 1100000, 128000, ARRAY['vision','reasoning'], true),
  ('openai', 'gpt-5.2',      'GPT-5.2',       ARRAY['text'], ARRAY['text','image'], ARRAY['text'], 0.875, 0.175,  7.00,  400000, 128000, ARRAY['vision'],             true),
  ('openai', 'gpt-5',        'GPT-5',         ARRAY['text'], ARRAY['text','image'], ARRAY['text'], 1.25,  0.125, 10.00,  400000, 128000, ARRAY['vision'],             true),
  ('openai', 'gpt-5-mini',   'GPT-5 Mini',    ARRAY['text'], ARRAY['text','image'], ARRAY['text'], 0.125, 0.025,  1.00,  400000, 128000, ARRAY['vision'],             true),
  ('openai', 'gpt-5-nano',   'GPT-5 Nano',    ARRAY['text'], ARRAY['text','image'], ARRAY['text'], 0.05,  0.005,  0.40,  400000, 128000, ARRAY['vision'],             true),
  ('openai', 'gpt-4.1',      'GPT-4.1',       ARRAY['text'], ARRAY['text','image'], ARRAY['text'], 2.00,  0.50,   8.00, 1000000,  32768, ARRAY['vision'],             true),
  ('openai', 'gpt-4.1-mini', 'GPT-4.1 Mini',  ARRAY['text'], ARRAY['text','image'], ARRAY['text'], 0.20,  0.10,   0.80, 1000000,  32768, ARRAY['vision'],             true),
  ('openai', 'gpt-4.1-nano', 'GPT-4.1 Nano',  ARRAY['text'], ARRAY['text','image'], ARRAY['text'], 0.05,  0.025,  0.20, 1000000,  32768, ARRAY['vision'],             true),
  ('openai', 'o3',           'o3',            ARRAY['text'], ARRAY['text','image'], ARRAY['text'], 2.00,  0.50,   8.00,  200000, 100000, ARRAY['reasoning','vision'], true),
  ('openai', 'o4-mini',      'o4-mini',       ARRAY['text'], ARRAY['text','image'], ARRAY['text'], 1.10,  0.275,  4.40,  200000, 100000, ARRAY['reasoning','vision'], true)
ON CONFLICT (provider, model_name) DO UPDATE SET
  name=EXCLUDED.name, modes=EXCLUDED.modes, input_modalities=EXCLUDED.input_modalities, output_modalities=EXCLUDED.output_modalities,
  input_price=EXCLUDED.input_price, cached_input_price=EXCLUDED.cached_input_price, output_price=EXCLUDED.output_price,
  context_window=EXCLUDED.context_window, max_output_tokens=EXCLUDED.max_output_tokens, tags=EXCLUDED.tags, enabled=EXCLUDED.enabled;

-- ══════════════════════════════════════════════════════════════════════════════
-- OpenAI Image Models
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO ai_models (provider, model_name, name, modes, input_modalities, output_modalities, input_price, input_image_price, output_image_price, image_pricing, image_sizes, tags, enabled)
VALUES
  ('openai', 'gpt-image-1.5',   'GPT Image 1.5',   ARRAY['image'], ARRAY['text','image'], ARRAY['image'], 5.00, 8.00, 32.00,
    '{"low":0.009,"medium":0.034,"high":0.133}'::jsonb, ARRAY['1024x1024','1024x1536','1536x1024'], ARRAY['vision'], true),
  ('openai', 'gpt-image-1',     'GPT Image 1',     ARRAY['image'], ARRAY['text','image'], ARRAY['image'], 5.00, 10.00, 40.00,
    '{"low":0.011,"medium":0.042,"high":0.167}'::jsonb, ARRAY['1024x1024','1024x1536','1536x1024'], ARRAY['vision'], true),
  ('openai', 'gpt-image-1-mini','GPT Image 1 Mini', ARRAY['image'], ARRAY['text','image'], ARRAY['image'], 2.00, 2.00, 8.00,
    '{"low":0.005,"medium":0.011,"high":0.036}'::jsonb, ARRAY['1024x1024','1024x1536','1536x1024'], ARRAY['vision'], true)
ON CONFLICT (provider, model_name) DO UPDATE SET
  name=EXCLUDED.name, modes=EXCLUDED.modes, input_modalities=EXCLUDED.input_modalities, output_modalities=EXCLUDED.output_modalities,
  input_price=EXCLUDED.input_price, input_image_price=EXCLUDED.input_image_price, output_image_price=EXCLUDED.output_image_price,
  image_pricing=EXCLUDED.image_pricing, image_sizes=EXCLUDED.image_sizes, tags=EXCLUDED.tags, enabled=EXCLUDED.enabled;

-- ══════════════════════════════════════════════════════════════════════════════
-- OpenAI Video Models (deprecated Sep 2026, still functional)
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO ai_models (provider, model_name, name, modes, input_modalities, output_modalities, video_pricing, video_sizes, video_durations, tags, enabled)
VALUES
  ('openai', 'sora-2',     'Sora 2',     ARRAY['video'], ARRAY['text','image'], ARRAY['video'],
    '{"720p":0.10}'::jsonb, ARRAY['1280x720','720x1280'], ARRAY[16,20], ARRAY[]::text[], true),
  ('openai', 'sora-2-pro', 'Sora 2 Pro', ARRAY['video'], ARRAY['text','image'], ARRAY['video'],
    '{"720p":0.30,"1080p":0.50}'::jsonb, ARRAY['1280x720','720x1280','1792x1024','1024x1792'], ARRAY[16,20], ARRAY[]::text[], true)
ON CONFLICT (provider, model_name) DO UPDATE SET
  name=EXCLUDED.name, modes=EXCLUDED.modes, input_modalities=EXCLUDED.input_modalities, output_modalities=EXCLUDED.output_modalities,
  video_pricing=EXCLUDED.video_pricing, video_sizes=EXCLUDED.video_sizes, video_durations=EXCLUDED.video_durations, tags=EXCLUDED.tags, enabled=EXCLUDED.enabled;

-- ══════════════════════════════════════════════════════════════════════════════
-- Google Text Models (prices per 1M tokens, paid tier, <=200k context)
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO ai_models (provider, model_name, name, modes, input_modalities, output_modalities, input_price, cached_input_price, output_price, context_window, max_output_tokens, tags, enabled)
VALUES
  ('google', 'gemini-3.1-pro-preview',       'Gemini 3.1 Pro',       ARRAY['text'], ARRAY['text','image','video'], ARRAY['text'], 2.00, 0.20, 12.00, 1000000, 65536, ARRAY['vision','reasoning'], true),
  ('google', 'gemini-3-flash-preview',       'Gemini 3 Flash',       ARRAY['text'], ARRAY['text','image','video'], ARRAY['text'], 0.50, 0.05,  3.00, 1000000, 65536, ARRAY['vision','reasoning'], true),
  ('google', 'gemini-3.1-flash-lite-preview','Gemini 3.1 Flash Lite', ARRAY['text'], ARRAY['text','image','video'], ARRAY['text'], 0.25, 0.025, 1.50, 1000000, 65536, ARRAY['vision'],             true),
  ('google', 'gemini-2.5-pro',               'Gemini 2.5 Pro',       ARRAY['text'], ARRAY['text','image','video'], ARRAY['text'], 1.25, 0.125, 10.00, 1000000, 65536, ARRAY['vision','reasoning'], true),
  ('google', 'gemini-2.5-flash',             'Gemini 2.5 Flash',     ARRAY['text'], ARRAY['text','image','video'], ARRAY['text'], 0.30, 0.03,  2.50, 1000000, 65536, ARRAY['vision'],             true),
  ('google', 'gemini-2.5-flash-lite',        'Gemini 2.5 Flash Lite',ARRAY['text'], ARRAY['text','image'],         ARRAY['text'], 0.10, 0.01,  0.40, 1000000, 65536, ARRAY['vision'],             true)
ON CONFLICT (provider, model_name) DO UPDATE SET
  name=EXCLUDED.name, modes=EXCLUDED.modes, input_modalities=EXCLUDED.input_modalities, output_modalities=EXCLUDED.output_modalities,
  input_price=EXCLUDED.input_price, cached_input_price=EXCLUDED.cached_input_price, output_price=EXCLUDED.output_price,
  context_window=EXCLUDED.context_window, max_output_tokens=EXCLUDED.max_output_tokens, tags=EXCLUDED.tags, enabled=EXCLUDED.enabled;

-- ══════════════════════════════════════════════════════════════════════════════
-- Google Image Models
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO ai_models (provider, model_name, name, modes, input_modalities, output_modalities, input_image_price, output_image_price, image_pricing, image_sizes, tags, enabled)
VALUES
  ('google', 'gemini-3.1-flash-image-preview','Nano Banana 2',  ARRAY['image'], ARRAY['text','image'], ARRAY['text','image'], 60.00, 60.00,
    '{"512px":0.045,"1024px":0.067,"2048px":0.101,"4096px":0.151}'::jsonb,
    ARRAY['512x512','1024x1024','2048x2048','4096x4096'], ARRAY['vision'], true),
  ('google', 'gemini-3-pro-image-preview',    'Nano Banana Pro', ARRAY['image'], ARRAY['text','image'], ARRAY['text','image'], 120.00, 120.00,
    '{"1024px":0.134,"2048px":0.134,"4096px":0.240}'::jsonb,
    ARRAY['1024x1024','2048x2048','4096x4096'], ARRAY['vision'], true)
ON CONFLICT (provider, model_name) DO UPDATE SET
  name=EXCLUDED.name, modes=EXCLUDED.modes, input_modalities=EXCLUDED.input_modalities, output_modalities=EXCLUDED.output_modalities,
  input_image_price=EXCLUDED.input_image_price, output_image_price=EXCLUDED.output_image_price,
  image_pricing=EXCLUDED.image_pricing, image_sizes=EXCLUDED.image_sizes, tags=EXCLUDED.tags, enabled=EXCLUDED.enabled;

-- ══════════════════════════════════════════════════════════════════════════════
-- Google Video Models
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO ai_models (provider, model_name, name, modes, input_modalities, output_modalities, video_pricing, video_sizes, video_durations, tags, enabled)
VALUES
  ('google', 'veo-3.1-generate-preview',     'Veo 3.1',      ARRAY['video'], ARRAY['text','image'], ARRAY['video'],
    '{"default":0.60}'::jsonb, ARRAY['1280x720','720x1280'], ARRAY[4,6,8], ARRAY[]::text[], true),
  ('google', 'veo-3.1-fast-generate-preview','Veo 3.1 Fast', ARRAY['video'], ARRAY['text','image'], ARRAY['video'],
    '{"default":0.40}'::jsonb, ARRAY['1280x720','720x1280'], ARRAY[4,6,8], ARRAY[]::text[], true)
ON CONFLICT (provider, model_name) DO UPDATE SET
  name=EXCLUDED.name, modes=EXCLUDED.modes, input_modalities=EXCLUDED.input_modalities, output_modalities=EXCLUDED.output_modalities,
  video_pricing=EXCLUDED.video_pricing, video_sizes=EXCLUDED.video_sizes, video_durations=EXCLUDED.video_durations, tags=EXCLUDED.tags, enabled=EXCLUDED.enabled;
