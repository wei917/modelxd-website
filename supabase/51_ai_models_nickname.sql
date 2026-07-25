-- supabase/51_ai_models_nickname.sql
--
-- Short display label for ai_models, used by the landing page's value
-- snapshot bar (/api/snapshot) and anywhere else a compact model name is
-- better than the catalogue name.
--
-- Nullable on purpose: most names are already short enough, so a row with
-- nothing here just falls back to display_name. Read it as
-- `nickname ?? display_name` — never assume it is set.
--
-- The backfill below was generated from two rules, then written out per row
-- so each value can be edited before running:
--   1. "Nano Banana 2 - Gemini 3.1 Flash Image" -> take the half before " - "
--   2. "HappyHorse 1.0 Text to Video"           -> drop the "<X> to <Y>" suffix
-- Only rows the rules actually shortened are set; everything else stays NULL.

alter table public.ai_models add column if not exists nickname text;

comment on column public.ai_models.nickname is
  'Optional short display label. Falls back to display_name when null.';

update public.ai_models set nickname = 'HappyHorse 1.0' where model_name = 'happyhorse-1.0-i2v';
update public.ai_models set nickname = 'HappyHorse 1.0' where model_name = 'happyhorse-1.0-r2v';
update public.ai_models set nickname = 'HappyHorse 1.0' where model_name = 'happyhorse-1.0-t2v';
update public.ai_models set nickname = 'Wan 2.7' where model_name = 'wan2.7-i2v';
update public.ai_models set nickname = 'Nano Banana' where model_name = 'gemini-2.5-flash-image';
update public.ai_models set nickname = 'Nano Banana 2' where model_name = 'gemini-3.1-flash-image';
update public.ai_models set nickname = 'Nano Banana 2 Lite' where model_name = 'gemini-3.1-flash-lite-image';
update public.ai_models set nickname = 'Nano Banana Pro' where model_name = 'gemini-3-pro-image';
