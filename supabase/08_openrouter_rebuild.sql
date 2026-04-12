-- ModelXD: Rebuild ai_models to be sourced entirely from OpenRouter.
--
-- After this migration runs, run `npm run sync-openrouter` (or
-- `npx tsx scripts/sync-openrouter.ts`) to populate the table.
--
-- All rows will have provider='openrouter' and model_name=<openrouter_id>
-- (e.g., 'google/gemini-3-pro-image-preview').
--
-- Run this in the Supabase SQL Editor.

-- Step 1: make sure every column the sync script writes actually exists.
-- Most of these were created by earlier migrations; the guards keep this
-- migration idempotent.
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS provider           text;
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS model_name         text;
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS name               text;
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS modes              text[]  DEFAULT ARRAY['text'];
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS input_modalities   text[]  DEFAULT ARRAY['text'];
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS output_modalities  text[]  DEFAULT ARRAY['text'];
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS input_price        numeric;
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS cached_input_price numeric;
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS output_price       numeric;
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS input_image_price  numeric;
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS output_image_price numeric;
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS image_pricing      jsonb;
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS video_pricing      jsonb;
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS image_sizes        text[];
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS video_sizes        text[];
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS video_durations    integer[];
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS context_window     integer;
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS max_output_tokens  integer;
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS tags               text[]  DEFAULT ARRAY[]::text[];
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS description        text;
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS enabled            boolean DEFAULT true;
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS created_at         timestamptz DEFAULT now();

-- Step 2: unique index on (provider, model_name) for idempotent upserts.
CREATE UNIQUE INDEX IF NOT EXISTS ai_models_provider_model_name_uniq
  ON ai_models (provider, model_name);

-- Step 3: nuke existing rows. duels.slots stores denormalized model info
-- and duels.vote*_model_id is plain text with no FK, so this is safe.
DELETE FROM ai_models;

-- Step 4: sanity check (should return 0)
SELECT count(*) AS remaining_rows FROM ai_models;

-- After this runs, execute:
--   npx tsx scripts/sync-openrouter.ts
-- which will populate the table from the OpenRouter catalog.
