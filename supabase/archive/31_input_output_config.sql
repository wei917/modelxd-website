-- ModelXD: split capabilities out of pricing into input_config + output_config
--
-- The pricing jsonbs grew sizes/durations because output sizing affects
-- billing — but model capabilities have outgrown that. Models now expose
-- aspect ratios, role-typed image inputs (start frame / end frame /
-- reference), capability flags (video extension, frame-specific gen),
-- per-input min/max counts, etc. Stuffing all of that into pricing makes
-- the pricing jsonb a junk drawer.
--
-- After this migration:
--
--   pricing  = { rates }                                ← billing only
--   input_config  = per-modality input semantics        ← what the model accepts
--   output_config = per-modality output config          ← what the model produces
--
-- Shapes (see docs/ai_models-schema.md for the canonical reference):
--
--   input_config: {
--     image: {
--       min:   integer,
--       max:   integer,
--       roles: [ { name: string, required?: boolean } ]   // free-form names
--       capabilities?: [ string ]
--     },
--     video: {...}, audio: {...}, text: { required?: boolean }
--   }
--
--   output_config: {
--     image: {
--       sizes:         [ string ],
--       aspect_ratios: [ string ],
--       capabilities?: [ string ]
--     },
--     video: {
--       sizes:         [ string ],
--       aspect_ratios: [ string ],
--       durations:     [ integer ],
--       capabilities?: [ string ]
--     }
--   }

-- ── Step 1: add the columns ──────────────────────────────────────────────────
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS input_config  jsonb;
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS output_config jsonb;

-- ── Step 2: copy image sizes from image_pricing into output_config.image ─────
UPDATE ai_models SET output_config = COALESCE(output_config, '{}'::jsonb) || jsonb_build_object(
  'image', jsonb_build_object('sizes', image_pricing->'sizes')
)
WHERE image_pricing IS NOT NULL
  AND image_pricing ? 'sizes'
  AND jsonb_array_length(image_pricing->'sizes') > 0;

-- ── Step 3: copy video sizes + durations from video_pricing ──────────────────
UPDATE ai_models SET output_config = COALESCE(output_config, '{}'::jsonb) || jsonb_build_object(
  'video', jsonb_strip_nulls(jsonb_build_object(
    'sizes',     CASE WHEN jsonb_array_length(COALESCE(video_pricing->'sizes',     '[]'::jsonb)) > 0
                      THEN video_pricing->'sizes'     ELSE NULL END,
    'durations', CASE WHEN jsonb_array_length(COALESCE(video_pricing->'durations', '[]'::jsonb)) > 0
                      THEN video_pricing->'durations' ELSE NULL END
  ))
)
WHERE video_pricing IS NOT NULL
  AND (
    (video_pricing ? 'sizes'     AND jsonb_array_length(video_pricing->'sizes')     > 0) OR
    (video_pricing ? 'durations' AND jsonb_array_length(video_pricing->'durations') > 0)
  );

-- ── Step 4: strip non-rate keys from pricing jsonbs ──────────────────────────
-- Pricing now collapses to { rates: ... }. Re-running this is safe: it just
-- rewrites the same shape.

UPDATE ai_models SET image_pricing = jsonb_build_object('rates', image_pricing->'rates')
  WHERE image_pricing IS NOT NULL;

UPDATE ai_models SET video_pricing = jsonb_build_object('rates', video_pricing->'rates')
  WHERE video_pricing IS NOT NULL;
