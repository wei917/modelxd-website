-- 83_xcut.sql — XCut, the cutting room (owner, Aug 22): one row per
-- project. The timeline is a work product the user edits (video track,
-- audio track, subtitle track); a render is recorded here and ALSO as an
-- xcreates row (node_kind 'film') so the film sits on the source board and
-- in history like every other generation.
--
-- Additive only. Run by hand in the Supabase SQL editor (dev + prod share
-- the project).

create table if not exists public.xcut_projects (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  title           text,
  source_board_id uuid,                          -- the XDirect board it was cut from, if any
  timeline        jsonb not null default '{}'::jsonb,
  duration_s      numeric,
  render          jsonb,                         -- { status, error, row_id, url, started_at, finished_at }
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create index if not exists xcut_projects_user_idx on public.xcut_projects (user_id, updated_at desc);

alter table public.xcut_projects enable row level security;

drop policy if exists "xcut_projects: owner reads" on public.xcut_projects;
create policy "xcut_projects: owner reads" on public.xcut_projects
  for select using (auth.uid() = user_id);
drop policy if exists "xcut_projects: owner writes" on public.xcut_projects;
create policy "xcut_projects: owner writes" on public.xcut_projects
  for insert with check (auth.uid() = user_id);
drop policy if exists "xcut_projects: owner updates" on public.xcut_projects;
create policy "xcut_projects: owner updates" on public.xcut_projects
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "xcut_projects: owner deletes" on public.xcut_projects;
create policy "xcut_projects: owner deletes" on public.xcut_projects
  for delete using (auth.uid() = user_id);

comment on table public.xcut_projects is 'XCut projects: timeline (video/audio/subtitle tracks) + last render. See lib/xcut-timeline.ts for the jsonb shape.';
