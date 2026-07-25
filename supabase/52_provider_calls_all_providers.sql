-- ModelXD: drop the provider allowlist on provider_calls entirely.
--
-- Why (CC, July 25 2026): telemetry was silently dead for 3 of 7 providers.
-- Two independent allowlists had drifted from lib/providers SUPPORTED_PROVIDERS
-- (openai, google, alibaba, xai, anthropic, runway, moonshot):
--
--   1. supabase/functions/log-provider-call had a hardcoded ALLOWED_PROVIDERS
--      Set of {openai, google, alibaba, anthropic} → 400 'unknown provider'
--      for runway + moonshot. Removed in the same commit as this migration.
--   2. This constraint, last written by archive/41_drop_xai_from_provider_check
--      as ('openai','google','alibaba'), then patched in prod out-of-band to
--      re-add 'xai' with no migration file → repo and prod disagreed, and
--      'anthropic' inserts failed the check with a 500.
--
-- Because lib/providers/call-log.ts is fire-and-forget by design (it must never
-- block a provider call), every one of those rejections was swallowed to
-- console.warn. Net effect: zero provider_calls rows for runway, moonshot and
-- anthropic — on success AND on failure — so a failed Runway gen4.5 video had
-- no recoverable upstream error anywhere.
--
-- Why drop rather than extend: `provider` is not user input. It is copied from
-- ai_models.provider, which is already the source of truth and already governs
-- routing in lib/providers. A second copy of that list buys nothing except a
-- way to lose log rows, and it fails in the worst possible direction — the
-- table goes quiet exactly when a NEW provider is being added, i.e. when you
-- most need the telemetry. Adding a provider is now pure data again, with no
-- migration and no edge function redeploy.

alter table provider_calls
  drop constraint if exists provider_calls_provider_check;
