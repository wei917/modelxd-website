-- 100_xarch.sql — XArch (X建築設計), owner Sep 13: one row per project.
-- A project is a floor plan (the geometry an architect read, plus an undo
-- stack), the room photos/videos attached to its rooms, and the chat with
-- the design agent. See lib/xarch.ts for the jsonb shapes.
--
-- Writes are server-only (service role): edits bill the user, so the
-- browser gets read access to its own rows and nothing else.
--
-- Additive only. Run by hand in the Supabase SQL editor (dev + prod share
-- the project).

create table if not exists public.xarch_projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text,
  status      text not null default 'ready' check (status in ('reading', 'ready', 'failed')),
  error       text,
  source      jsonb not null default '{}'::jsonb,   -- { bucket, path, mediaType } | { public_url } for the sample
  architect   text not null default 'astra',
  plan        jsonb,                                -- Plan
  history     jsonb not null default '[]'::jsonb,   -- previous Plans, newest last (undo), capped
  media       jsonb not null default '[]'::jsonb,   -- Media[]
  chat        jsonb not null default '[]'::jsonb,   -- [{ role, text, at, action? }]
  spent_cents integer not null default 0,
  is_sample   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index if not exists xarch_projects_user_idx on public.xarch_projects (user_id, updated_at desc);

alter table public.xarch_projects enable row level security;

drop policy if exists "xarch_projects: owner reads" on public.xarch_projects;
create policy "xarch_projects: owner reads" on public.xarch_projects
  for select using (auth.uid() = user_id);

comment on table public.xarch_projects is 'XArch projects: floor plan geometry + undo, room media, agent chat. Shapes in lib/xarch.ts.';
