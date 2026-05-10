-- ModelXD: add `released_at` to ai_models so the Create mode picker can
-- sort newest-first. OpenRouter's /api/v1/models endpoint exposes a
-- `created` field (Unix seconds) for every text/image model — we persist
-- that here. Video models don't have a `created` field on OpenRouter's
-- video endpoint, so they'll stay null and sort to the bottom.
--
-- Run order:
--   1. Apply this migration in the Supabase SQL Editor.
--   2. Hit POST /api/dev/populate-release-dates to backfill every row
--      from the current OpenRouter catalog. (Future `npm run
--      sync-openrouter` runs will keep this column in sync.)

ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS released_at timestamptz;

-- Index to keep the picker's ORDER BY released_at DESC cheap as the
-- catalog grows. Partial index on non-null values — unreleased rows are
-- always sorted last anyway.
CREATE INDEX IF NOT EXISTS ai_models_released_at_idx
  ON ai_models (released_at DESC NULLS LAST)
  WHERE released_at IS NOT NULL;

-- Sanity check — should return 0 rows populated before backfill runs.
SELECT count(*) AS populated_rows
FROM ai_models
WHERE released_at IS NOT NULL;
