-- 141_duel_lang.sql — the page language of whoever started a duel (owner,
-- Oct 19: "based on users' language"), so XDuel's vote feed shows a viewer
-- the duels in their own language first (a Japanese reader cannot judge a
-- Chinese text or speech duel), and XBoard can rank by language once there
-- are enough votes.
--
-- One of the site's five languages (lib/i18n.tsx): en, zh-Hant, zh-Hans,
-- ja, ko. Null for every duel before this one (no backfill: fix forward)
-- and for a request that names none.
--
-- Additive: one nullable column and its check. Until this runs, the duel
-- route saves without it and the feed reads without it (each retries once
-- without the column), so nothing breaks either side of it. Only the
-- server reads or writes the column (service key).
--
-- Run by hand in the Supabase SQL editor (dev + prod share the project).

alter table public.duels add column if not exists lang text;

alter table public.duels drop constraint if exists duels_lang_check;
alter table public.duels add constraint duels_lang_check
  check (lang is null or lang in ('en', 'zh-Hant', 'zh-Hans', 'ja', 'ko'));

-- Checks after running (both should hold):
--   select count(*) from public.duels where lang is not null;   -- 0 until a new duel
--   insert ... lang = 'fr'  → 23514 (duels_lang_check)
