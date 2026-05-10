-- ModelXD: drop redundant ai_models columns
--
-- All five columns below are unread by the app at runtime — they were
-- either superseded by other columns or never wired into the UI.
--
--   modes              → superseded by output_modalities
--                        (getModelsByMode reads output_modalities,
--                        the legacy `modes` array was kept in sync but
--                        never queried)
--   added_at           → exact duplicate of created_at (same auto-set
--                        timestamp, both have identical distinct values)
--   description        → marketing text only on a subset of OpenAI rows;
--                        not displayed anywhere in the app
--   context_window     → was on the Models page; removed when the page
--                        was merged into Leaderboard
--   max_output_tokens  → same — never made it into the unified table
--
-- After this migration:
--   - All four sync scripts must be updated to stop writing these fields
--     (otherwise upsert() silently fails or, with strict columns mode,
--     errors). See lib/sync-{openai,google,xai,dashscope}.ts.
--   - app/leaderboard/page.tsx and app/xcreate/page.tsx no longer declare
--     these fields on their AIModel interfaces.
--   - scripts/survey-models.ts dropped `modes` from its select list.

ALTER TABLE ai_models DROP COLUMN IF EXISTS modes;
ALTER TABLE ai_models DROP COLUMN IF EXISTS added_at;
ALTER TABLE ai_models DROP COLUMN IF EXISTS description;
ALTER TABLE ai_models DROP COLUMN IF EXISTS context_window;
ALTER TABLE ai_models DROP COLUMN IF EXISTS max_output_tokens;
