-- 21_drop_openrouter.sql
-- Remove all openrouter rows. Direct provider rows already exist from
-- the per-provider sync scripts (sync-dashscope, sync-xai), so we just
-- delete the old openrouter duplicates.

DELETE FROM ai_models WHERE provider = 'openrouter';
