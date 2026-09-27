-- 107_drop_old_mode_checks.sql — finish 106: drop the pre-rename mode checks.
--
-- 106 widened `mode` to include 'audio' by dropping <table>_mode_check and
-- re-adding it. But xcreates and xcreate_jobs were renamed from creates and
-- create_jobs, and their original inline checks kept the OLD auto-generated
-- names (creates_mode_check, create_jobs_mode_check). 106's DROP ... IF EXISTS
-- found nothing, so each table carried two mode checks, the old one still
-- text/image/video only, and every audio run failed at the job insert with
-- 23514 (check_violation). Seen Sep 26: MiniMax Speech 2.8 HD on
-- xcreate.modelxd.com, POST /api/xcreate 500 "job insert failed".
--
-- Dropping the narrower old checks leaves 106's (which include 'audio') as
-- the only ones. Nothing existing can fail: every row already passed both.
-- Run by hand in the Supabase SQL editor (dev + prod share the project).

alter table public.xcreates     drop constraint if exists creates_mode_check;
alter table public.xcreate_jobs drop constraint if exists create_jobs_mode_check;

-- Verify: exactly one mode check per table, both listing 'audio'.
-- select conrelid::regclass, conname, pg_get_constraintdef(oid)
--   from pg_constraint
--  where contype = 'c' and conrelid::regclass::text in ('xcreates', 'xcreate_jobs')
--    and pg_get_constraintdef(oid) ilike '%mode%';
