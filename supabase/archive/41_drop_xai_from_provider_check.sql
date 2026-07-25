-- ModelXD: drop 'xai' from the provider_calls.provider check constraint.
--
-- xAI was removed as a provider in May 2026 (see supabase/archive/37_drop_xai.sql),
-- but the check constraint on provider_calls.provider still allowed it.
-- This migration tightens the constraint so future inserts of 'xai' are
-- rejected — a no-op for existing data since no xAI rows remain.

alter table provider_calls
  drop constraint if exists provider_calls_provider_check;

alter table provider_calls
  add constraint provider_calls_provider_check
  check (provider in ('openai','google','alibaba'));
