-- ModelXD: Switch OpenAI and Google models from OpenRouter to direct API providers.
--
-- After the OpenRouter sync, all models have provider='openrouter' and
-- model_name='openai/gpt-5.4' or 'google/gemini-3-pro-image-preview'.
--
-- This migration changes:
--   - OpenAI models: provider → 'openai', model_name strips 'openai/' prefix
--   - Google models: provider → 'google', model_name strips 'google/' prefix
--
-- OpenRouter is kept as a fallback for any remaining providers (e.g. Anthropic,
-- Meta, xAI) and for video generation.
--
-- Safe to re-run — uses WHERE clauses that only match unmigrated rows.

-- ── Step 1: Remove stale seed rows from 01_models.sql ─────────────────────────
-- The original seed data inserted rows with provider='openai'/'google' directly.
-- The OpenRouter sync later created duplicate rows with provider='openrouter'
-- and model_name='openai/gpt-5.4' etc. We need to remove the old seed rows
-- before updating the OpenRouter rows, otherwise the unique constraint on
-- (provider, model_name) would block the UPDATE.

DELETE FROM ai_models
WHERE provider = 'openai'
  AND EXISTS (
    SELECT 1 FROM ai_models dup
    WHERE dup.provider = 'openrouter'
      AND dup.model_name = 'openai/' || ai_models.model_name
  );

DELETE FROM ai_models
WHERE provider = 'google'
  AND EXISTS (
    SELECT 1 FROM ai_models dup
    WHERE dup.provider = 'openrouter'
      AND dup.model_name = 'google/' || ai_models.model_name
  );

-- ── Step 2: Migrate OpenAI models from OpenRouter to direct ───────────────────

UPDATE ai_models
SET
  provider   = 'openai',
  model_name = substring(model_name from 8)  -- strip 'openai/' (7 chars)
WHERE provider = 'openrouter'
  AND model_name LIKE 'openai/%';

-- ── Step 3: Migrate Google models from OpenRouter to direct ───────────────────

UPDATE ai_models
SET
  provider   = 'google',
  model_name = substring(model_name from 8)  -- strip 'google/' (7 chars)
WHERE provider = 'openrouter'
  AND model_name LIKE 'google/%';

-- ── Step 4: Add response_id column to xcreates for multi-turn image editing ──
-- OpenAI's previous_response_id enables multi-turn edits without re-upload.
-- Google uses conversation_history (stored in chat_history jsonb).

ALTER TABLE xcreates ADD COLUMN IF NOT EXISTS response_id text;

-- ── Verification ──────────────────────────────────────────────────────────────
-- Run these after migration to verify:
--   SELECT provider, model_name, name FROM ai_models WHERE provider IN ('openai', 'google') ORDER BY provider, name;
--   SELECT provider, model_name, name FROM ai_models WHERE provider = 'openrouter' ORDER BY name;
