-- supabase/144_xcreate_voices.sql — the voices people clone of themselves in
-- X創作's 語音 (owner, Oct 20: "I thought we can clone voice and ask the ai
-- to speak some text with cloned voice?", then "go ahead to do it").
--
-- One row per cloned voice (lib/xcreate-voices.ts). The person records
-- themselves reading a passage shown on the page; Whisper checks that the
-- recording says that passage (lib/voice-passages.ts) before MiniMax clones
-- it. The recording itself is never kept: MiniMax holds the voice, this
-- row holds its id, the name the person gave it and when they agreed.
--
--   voice_id       MiniMax's id for the voice. Never sent to a browser: the
--                  page only knows this row's id, and the server speaks
--                  with a voice only for the account that made it.
--   read_score     how closely the recording matched the passage (0-1)
--   consent_at     when they ticked "this is my own voice"
--   first_used_at  MiniMax charges $1.50 the first time a cloned voice
--                  speaks, and deletes a voice that never spoke within 7
--                  days; whoever sets this (where it is null) pays the fee
--   deleted_at     the person deleted it, or MiniMax let it lapse
--
-- Read and written by ModelXD only (service role), like 137. Additive; safe
-- to re-run. Run by hand. Dev and prod share this database.

begin;

create table if not exists public.xcreate_voices (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  provider       text not null default 'minimax' check (provider in ('minimax')),
  voice_id       text not null unique check (voice_id ~ '^[A-Za-z][A-Za-z0-9_-]{6,254}[A-Za-z0-9]$'),
  name           text not null check (char_length(name) between 1 and 30),
  lang           text check (lang is null or lang in ('en', 'zh-Hant', 'zh-Hans', 'ja', 'ko')),
  read_score     real check (read_score is null or read_score between 0 and 1),
  consent_at     timestamptz not null default now(),
  first_used_at  timestamptz,
  created_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index if not exists xcreate_voices_user on public.xcreate_voices (user_id, created_at desc);

alter table public.xcreate_voices enable row level security;
revoke all on public.xcreate_voices from public, anon, authenticated;

commit;

-- Checks after running (the publishable key must get 42501 on both):
--   GET  /rest/v1/xcreate_voices?select=id&limit=1
--   POST /rest/v1/xcreate_voices  {"name":"x","voice_id":"xtest_voice1","user_id":"<any>"}
-- and with the service key:
--   insert ... name '' → 23514; voice_id '1abc' → 23514; lang 'fr' → 23514.
