-- supabase/38_drop_gpt_image_1.sql
-- Remove gpt-image-1 family rows from the catalog. These were superseded by
-- gpt-image-2 in May 2026. The runtime no longer special-cases them — the
-- direct Images API path applies to all gpt-image-* models, and the cost
-- path is token-only (per_image keyed by quality is no longer read by the
-- xcreate UI).
--
-- Provider-call telemetry rows are left in place (provider_calls is
-- append-only history; no reason to rewrite the past).

DELETE FROM ai_models
 WHERE provider = 'openai'
   AND model_name IN ('gpt-image-1', 'gpt-image-1-mini', 'gpt-image-1.5');
