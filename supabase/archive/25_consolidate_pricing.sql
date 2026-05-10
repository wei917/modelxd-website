-- ModelXD: consolidate ai_models pricing + drop unused price columns
--
-- This migration restructures the per-mode pricing jsonb to also hold the
-- supported size / duration options, and drops six now-redundant columns.
-- All model-config (rates + variants) for a given mode lives in a single
-- jsonb cell after this runs.
--
-- BEFORE                                                  AFTER
--   image_pricing = {"medium": 0.034, "high": 0.133}       image_pricing = { "rates": {...}, "sizes": [...] }
--   image_sizes   = ["1024x1024", "1024x1536"]
--
--   video_pricing    = {"720p": 0.10, "1080p": 0.20}       video_pricing = { "rates": {...}, "sizes": [...], "durations": [...] }
--   video_sizes      = ["1280x720", "720x1280"]
--   video_durations  = [4, 6, 8]
--
-- ⚠️  THIS BREAKS THE APP UNTIL THE READ-SIDE CODE IS UPDATED.
--    `headlinePrice()` in the leaderboard, the size/duration pickers in
--    XCreate, and the price labels in the duel SSE meta event all still
--    read the OLD shape today. Run this AFTER the matching code update,
--    not before.
--
-- The sync scripts (lib/sync-{openai,google,xai,dashscope}.ts) still
-- write the OLD shape. They will need to be updated before they can run
-- against the post-migration schema.

-- ── Step 1: migrate image_pricing in place ────────────────────────────────
-- Skip rows that already look migrated (have a 'rates' key) so the
-- script is safe to re-run if it errors halfway through.

UPDATE ai_models
SET image_pricing = jsonb_build_object(
  'rates', image_pricing,
  'sizes', COALESCE(to_jsonb(image_sizes), '[]'::jsonb)
)
WHERE image_pricing IS NOT NULL
  AND NOT (image_pricing ? 'rates');

-- ── Step 2: migrate video_pricing in place ────────────────────────────────

UPDATE ai_models
SET video_pricing = jsonb_build_object(
  'rates',     video_pricing,
  'sizes',     COALESCE(to_jsonb(video_sizes),     '[]'::jsonb),
  'durations', COALESCE(to_jsonb(video_durations), '[]'::jsonb)
)
WHERE video_pricing IS NOT NULL
  AND NOT (video_pricing ? 'rates');

-- ── Step 3: drop the columns now folded into the jsonbs ───────────────────

ALTER TABLE ai_models DROP COLUMN IF EXISTS image_sizes;
ALTER TABLE ai_models DROP COLUMN IF EXISTS video_sizes;
ALTER TABLE ai_models DROP COLUMN IF EXISTS video_durations;

-- ── Step 4: drop unused price columns ─────────────────────────────────────
-- cached_input_price       — only sync writes it; no app code reads it
-- input_image_price        — Google-only flat rate; leaderboard reads
--                             image_pricing instead, so this never displays
-- output_image_price       — same story as input_image_price

ALTER TABLE ai_models DROP COLUMN IF EXISTS cached_input_price;
ALTER TABLE ai_models DROP COLUMN IF EXISTS input_image_price;
ALTER TABLE ai_models DROP COLUMN IF EXISTS output_image_price;
