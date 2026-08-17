-- 82_api_tokens.sql — per-user API keys for the MCP / external-agent surface
-- (owner, Aug 17: "I definitely want to use MCP").
--
-- A key is minted once, shown once, stored only as a SHA-256 hash. Every
-- MCP / bearer request resolves the hash to a user and bills that user's
-- existing wallet through the normal xcreate pipeline. spend_cap_usd is a
-- LIFETIME ceiling per key (v1): the route refuses new generations once
-- spent_usd reaches it — an agent in a loop cannot drain an account.
--
-- Owner-read RLS so the XDev page lists keys with the browser client;
-- mint/revoke/spend go through server routes with the service role.

create table if not exists api_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null default 'default',
  token_hash    text not null unique,
  token_prefix  text not null,            -- e.g. 'xd_a1b2c3…' for display
  spend_cap_usd numeric,                  -- null = uncapped
  spent_usd     numeric not null default 0,
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists api_tokens_user_idx on api_tokens(user_id);

alter table api_tokens enable row level security;

drop policy if exists api_tokens_owner_read on api_tokens;
create policy api_tokens_owner_read on api_tokens
  for select using (auth.uid() = user_id);

-- Atomic spend accumulation (supabase-js cannot express col = col + x).
create or replace function increment_token_spend(p_token_id uuid, p_usd numeric)
returns void
language sql
security definer
set search_path = public
as $$
  update api_tokens
     set spent_usd = spent_usd + greatest(p_usd, 0),
         last_used_at = now()
   where id = p_token_id;
$$;

revoke all on function increment_token_spend(uuid, numeric) from public;
