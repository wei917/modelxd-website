-- 96_xworld.sql — XWorld (owner, Sep 10): one row per thing XWorld makes.
--   kind 'world'  → World Labs Marble: a walkable 3D world (Gaussian splats)
--   kind 'object' → Tripo: photo → 3D object (GLB mesh)
--
-- Both providers are async (create → poll), so a row is the ledger entry
-- that survives a closed tab: ownership, what was billed, and the finished
-- assets. Billing follows lib/tripo.ts — debit the list price at create,
-- reconcile ONCE to the provider's own reported cost at the first terminal
-- poll (`reconciled` is the claim flag that stops two polls settling twice).
--
-- Writes are server-only (service role): a row carries billing state, so
-- the browser gets read access to its own rows and nothing else.
--
-- Additive only. Run by hand in the Supabase SQL editor (dev + prod share
-- the project).

create table if not exists public.xworlds (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  kind          text not null check (kind in ('world', 'object')),
  provider      text not null check (provider in ('worldlabs', 'tripo')),
  model         text not null,
  prompt        text,
  input         jsonb not null default '{}'::jsonb,   -- { type, attachments:[{bucket,storagePath,mediaType}] }
  task_id       text not null,                        -- World Labs operation_id / Tripo task_id
  world_id      text,                                 -- World Labs world_id once done
  status        text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  progress      numeric,
  assets        jsonb,                                -- World Labs response.assets / Tripo output
  caption       text,
  thumbnail_url text,
  error         text,
  billed_cents  integer not null default 0,
  reconciled    boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index if not exists xworlds_user_idx on public.xworlds (user_id, created_at desc);
create unique index if not exists xworlds_task_idx on public.xworlds (provider, task_id);

alter table public.xworlds enable row level security;

drop policy if exists "xworlds: owner reads" on public.xworlds;
create policy "xworlds: owner reads" on public.xworlds
  for select using (auth.uid() = user_id);

comment on table public.xworlds is 'XWorld generations: World Labs worlds + Tripo photo→3D objects. Billing reconciled once (see lib/worldlabs.ts, lib/tripo.ts).';
