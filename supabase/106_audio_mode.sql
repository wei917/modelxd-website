-- 106_audio_mode.sql — 'audio' becomes a fourth generation mode (owner,
-- Sep 25: text-to-speech in XCreate, MiniMax + Gemini TTS first).
--
-- Four tables hard-code mode in ('text','image','video'). They were written
-- as INLINE checks, so Postgres auto-named them <table>_mode_check; this
-- drops each by that name (IF EXISTS, so a re-run is harmless) and re-adds
-- it with 'audio'. Widening a CHECK is additive: every existing row still
-- satisfies it, and nothing starts writing 'audio' until the code does.
--
--   xcreates / xcreate_jobs  — the generation itself
--   provider_calls           — the call log (mode is NOT NULL there)
--   duels                    — XDuel is NOT in v1, but the constraint is
--                              widened here so an audio duel is a code
--                              change later, not another migration.
--
-- Also creates the bucket generated speech lands in. Private, like every
-- other ai-output bucket: the page signs on demand (Common Pitfall #11).
-- 50 MB matches xcreate-ai-images; ~10 minutes of MP3 is well under it.
--
-- Additive only. Run by hand in the Supabase SQL editor (dev + prod share
-- the project).

alter table public.xcreates        drop constraint if exists xcreates_mode_check;
alter table public.xcreates        add  constraint xcreates_mode_check
  check (mode in ('text', 'image', 'video', 'audio'));

alter table public.xcreate_jobs    drop constraint if exists xcreate_jobs_mode_check;
alter table public.xcreate_jobs    add  constraint xcreate_jobs_mode_check
  check (mode in ('text', 'image', 'video', 'audio'));

alter table public.provider_calls  drop constraint if exists provider_calls_mode_check;
alter table public.provider_calls  add  constraint provider_calls_mode_check
  check (mode in ('text', 'image', 'video', 'audio'));

alter table public.duels           drop constraint if exists duels_mode_check;
alter table public.duels           add  constraint duels_mode_check
  check (mode in ('text', 'image', 'video', 'audio'));

-- Generated speech. mp3 is the default from both providers; wav/flac/ogg
-- and the raw PCM types are listed because the model rows offer them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'xcreate-ai-audio', 'xcreate-ai-audio', false, 52428800,
  array['audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/flac','audio/ogg','audio/opus','audio/basic','audio/L16']
)
on conflict (id) do update
  set file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

comment on constraint xcreates_mode_check on public.xcreates is
  'text | image | video | audio (106). Audio = text-to-speech; see lib/providers for the TTS paths.';
