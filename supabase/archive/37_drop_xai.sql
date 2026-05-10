-- supabase/37_drop_xai.sql
-- Remove all xAI / Grok models from the catalog. xAI was deprecated as a
-- supported provider; the runtime route is gone (lib/providers/xai.ts
-- deleted). Any leftover rows would surface in the Leaderboard / Admin
-- but fail at generation time, so we delete them outright.
--
-- Provider-call telemetry rows for xai are left in place (provider_calls
-- is append-only history; we don't rewrite the past). The check
-- constraint on the table doesn't restrict provider, so existing xai
-- rows there are still valid.

DELETE FROM ai_models WHERE provider = 'xai';
