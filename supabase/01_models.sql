-- ModelXD: ai_models — schema + non-syncable provider seeds
-- Run in Supabase SQL Editor.
--
-- WHAT'S HERE:
--   * Schema migrations for `input_modalities` / `output_modalities` columns.
--   * (No more OpenAI or Google INSERTs.)  Those providers are now populated
--     by the Playwright-based sync scripts:
--         npm run sync-openai      -- scrapes developers.openai.com pricing
--         npm run sync-google      -- scrapes ai.google.dev pricing
--         npm run sync-pricing     -- runs all four providers at once
--   * xAI and Alibaba/DashScope already had API-driven sync scripts:
--         npm run sync-xai
--         npm run sync-dashscope
--
-- HOW TO BOOTSTRAP A FRESH DB:
--   1. Run this SQL file in Supabase SQL Editor (creates tables/columns).
--   2. From your dev machine, run `npm run sync-pricing` to populate models.
--
-- The DELETE below is OPTIONAL. Uncomment it only if you want to wipe and
-- reseed from scratch. The sync scripts use ON CONFLICT DO UPDATE, so they
-- are safe to re-run incrementally.

-- DELETE FROM ai_models;

-- Schema: ensure modality columns exist.
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS input_modalities  text[] DEFAULT ARRAY['text'];
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS output_modalities text[] DEFAULT ARRAY['text'];
