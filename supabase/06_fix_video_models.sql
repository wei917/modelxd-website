-- ModelXD: Fix video model metadata
-- The live DB has video_durations = NULL for all video models,
-- and video_sizes = NULL for both Veo models, which prevents the
-- Create page from rendering Resolution/Duration pickers.
--
-- Run this in the Supabase SQL Editor to backfill the values that
-- 01_models.sql is supposed to seed.

-- OpenAI: Sora 2 — add durations (sizes already correct)
UPDATE ai_models
SET video_durations = ARRAY[16, 20]
WHERE provider = 'openai' AND model_name = 'sora-2';

-- OpenAI: Sora 2 Pro — add durations (sizes already correct)
UPDATE ai_models
SET video_durations = ARRAY[16, 20]
WHERE provider = 'openai' AND model_name = 'sora-2-pro';

-- Google: Veo 3.1 — add sizes and durations
UPDATE ai_models
SET video_sizes     = ARRAY['1280x720', '720x1280'],
    video_durations = ARRAY[4, 6, 8]
WHERE provider = 'google' AND model_name = 'veo-3.1-generate-preview';

-- Google: Veo 3.1 Fast — add sizes and durations
UPDATE ai_models
SET video_sizes     = ARRAY['1280x720', '720x1280'],
    video_durations = ARRAY[4, 6, 8]
WHERE provider = 'google' AND model_name = 'veo-3.1-fast-generate-preview';

-- Sanity check — should show 4 rows with non-null video_sizes and video_durations
SELECT provider, model_name, name, video_sizes, video_durations, video_pricing
FROM ai_models
WHERE 'video' = ANY(output_modalities)
ORDER BY provider, model_name;
