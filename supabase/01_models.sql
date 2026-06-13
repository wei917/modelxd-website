-- ModelXD: ai_models — schema only
-- Run in Supabase SQL Editor.
--
-- WHAT'S HERE:
--   * Schema migrations for `input_modalities` / `output_modalities` columns.
--   * No seed INSERTs. The catalog is hand-curated through /admin/models
--     (see CLAUDE.md → "Admin"). All sync scripts and the previous
--     cron-based infrastructure were removed in May 2026.
--
-- HOW TO BOOTSTRAP A FRESH DB:
--   1. Run this SQL file in Supabase SQL Editor (creates tables/columns).
--   2. Add models by hand at /admin/models.
--
-- The DELETE below is OPTIONAL. Uncomment it only if you want to wipe
-- the catalog and rebuild it from scratch through the admin UI.

-- DELETE FROM ai_models;

-- Schema: ensure modality columns exist.
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS input_modalities  text[] DEFAULT ARRAY['text'];
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS output_modalities text[] DEFAULT ARRAY['text'];
