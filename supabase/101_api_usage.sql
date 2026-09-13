-- 101_api_usage.sql — one row per API call made with a ModelXD API key
-- (owner, Sep 14: "how do we tell API developers their price and usage?").
--
-- Until now a developer had `usage.cost_usd` on each response and a lifetime
-- `spent_usd` per key, and nothing in between: no per-day, per-model or
-- per-key history. The wallet ledger (credit_transactions) knows the money but
-- not the key, the tokens or the endpoint; provider_calls knows the tokens but
-- not the key. This table is the join, written at the moment each call settles.
--
--   surface   chat | image | video | 3d
--   ref_id    the job/task id when the call has one; unique per surface, so a
--             later settle (Tripo reconciles its price at the first terminal
--             poll) updates the row instead of adding a second one.
--
-- Read by GET /api/v1/usage and the XDev usage panel. Writes are server-only.
-- Additive. Run by hand in the Supabase SQL editor (dev + prod share it).

create table if not exists public.api_usage (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  token_id      uuid references public.api_tokens(id) on delete set null,
  surface       text not null check (surface in ('chat', 'image', 'video', '3d')),
  provider      text,
  model_name    text,
  status        text not null default 'success' check (status in ('success', 'failed')),
  input_tokens  integer,
  output_tokens integer,
  cached_tokens integer,
  cost_usd      numeric(12, 6) not null default 0,
  ref_id        text,
  error_code    text,
  created_at    timestamptz not null default now()
);

create index if not exists api_usage_user_time_idx  on public.api_usage (user_id, created_at desc, id desc);
create index if not exists api_usage_token_time_idx on public.api_usage (token_id, created_at desc);
create unique index if not exists api_usage_ref_idx on public.api_usage (surface, ref_id) where ref_id is not null;

alter table public.api_usage enable row level security;

drop policy if exists "api_usage: owner reads" on public.api_usage;
create policy "api_usage: owner reads" on public.api_usage
  for select using (auth.uid() = user_id);

comment on table public.api_usage is 'Per-call API usage by key (chat/image/video/3d): tokens, list-price cost, status. Read by /api/v1/usage.';
