-- ModelXD: consolidate text pricing into a jsonb column
--
-- Mirrors the structure of image_pricing and video_pricing so all three
-- modes have the same shape: every pricing column has a top-level
-- "rates" key, and the cost calculator can do
--    m[mode + '_pricing'].rates[variantKey]
-- regardless of mode.
--
-- BEFORE                                   AFTER
--   input_price  = 21                       text_pricing = {
--   output_price = 168                        "rates": { "input": 21, "output": 168 }
--                                           }
--
-- Variant keys are "input" / "output" (per 1M tokens of each kind),
-- analogous to image's "low/medium/high" or video's "720p/1080p/4k".
--
-- ⚠️  THIS BREAKS THE APP UNTIL READ-SIDE CODE IS UPDATED.
--    `m.input_price` / `m.output_price` are read in the leaderboard,
--    XCreate cost estimator, duel/xcreate price labels, and the
--    leaderboard API. All have to swap to `m.text_pricing.rates.input`
--    / `.rates.output`.

-- ── Step 1: add the new column ────────────────────────────────────────────
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS text_pricing jsonb;

-- ── Step 2: migrate existing flat prices ──────────────────────────────────
-- Only rows that have at least one of the two get a text_pricing row.
-- jsonb_strip_nulls removes any individual null so the inner rates map
-- only contains actual numbers — `{"input": 21}` rather than
-- `{"input": 21, "output": null}`.
-- The text_pricing IS NULL guard keeps this idempotent in case step 3
-- failed on a previous attempt.

UPDATE ai_models
SET text_pricing = jsonb_build_object(
  'rates', jsonb_strip_nulls(jsonb_build_object(
    'input',  input_price,
    'output', output_price
  ))
)
WHERE (input_price IS NOT NULL OR output_price IS NOT NULL)
  AND text_pricing IS NULL;

-- ── Step 3: drop the old flat columns ─────────────────────────────────────
ALTER TABLE ai_models DROP COLUMN IF EXISTS input_price;
ALTER TABLE ai_models DROP COLUMN IF EXISTS output_price;
