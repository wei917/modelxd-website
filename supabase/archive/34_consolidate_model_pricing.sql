-- supabase/34_consolidate_model_pricing.sql
-- Consolidate text_pricing / image_pricing / video_pricing into a single
-- model_pricing jsonb column.
--
-- Shape:
--   model_pricing = {
--     tokens?: {
--       text_input?, cached_input?, image_input?, video_input?, audio_input?,
--       text_output?, image_output?, audio_output?
--     }                                  -- $/1M tokens
--     per_image?:        Record<string, number>   -- by quality tier
--     per_video_second?: Record<string, number>   -- by resolution
--   }
--
-- Migration:
--   - text_pricing.rates.{input, cached_input, image_input, output}
--       → tokens.{text_input, cached_input, image_input, text_output}
--   - image_pricing.{input_text_rate, input_image_rate, output_image_rate}
--       (transitional fields, may be present from earlier work)
--       → tokens.{text_input, image_input, image_output} (used as fallback)
--   - image_pricing.rates → per_image
--   - video_pricing.rates → per_video_second

ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS model_pricing jsonb;

UPDATE ai_models
SET model_pricing = jsonb_strip_nulls(jsonb_build_object(
  'tokens', NULLIF(jsonb_strip_nulls(jsonb_build_object(
    'text_input',    COALESCE(
                       text_pricing  -> 'rates' -> 'input',
                       image_pricing -> 'input_text_rate'
                     ),
    'cached_input',  text_pricing  -> 'rates' -> 'cached_input',
    'image_input',   COALESCE(
                       text_pricing  -> 'rates' -> 'image_input',
                       image_pricing -> 'input_image_rate'
                     ),
    'text_output',   text_pricing  -> 'rates' -> 'output',
    'image_output',  image_pricing -> 'output_image_rate'
  )), '{}'::jsonb),
  'per_image',        image_pricing -> 'rates',
  'per_video_second', video_pricing -> 'rates'
));

ALTER TABLE ai_models DROP COLUMN IF EXISTS text_pricing;
ALTER TABLE ai_models DROP COLUMN IF EXISTS image_pricing;
ALTER TABLE ai_models DROP COLUMN IF EXISTS video_pricing;
