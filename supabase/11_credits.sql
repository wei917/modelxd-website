-- ModelXD: credit wallet system (Phase 1 — DB + profile UI)
--
-- Design notes
-- ------------
-- * All amounts are integer US cents. Never use floats for money.
-- * user_credits holds the current balance as a denormalized sum for fast
--   reads. It is only ever mutated through the grant_credits / debit_credits
--   RPCs below, both of which acquire a row lock before writing so two
--   concurrent tabs can't double-spend.
-- * credit_transactions is the immutable ledger. Every mutation appends a
--   row. If user_credits.balance_cents ever drifts from the ledger sum,
--   treat the ledger as authoritative and recompute.
-- * credit_holds is the table for the future "pre-flight hold" flow used by
--   /api/xcreate when we wire charging. Schema lands now so it's stable; no
--   RPCs touch it yet in this migration.

-- ── 1. user_credits ────────────────────────────────────────────────────────

create table if not exists user_credits (
  user_id                 uuid primary key references auth.users(id) on delete cascade,
  balance_cents           bigint not null default 0 check (balance_cents >= 0),
  lifetime_granted_cents  bigint not null default 0 check (lifetime_granted_cents >= 0),
  lifetime_spent_cents    bigint not null default 0 check (lifetime_spent_cents >= 0),
  updated_at              timestamptz not null default now()
);

alter table user_credits enable row level security;

-- Owner can read their own wallet; no insert/update/delete policies exist,
-- which means RLS blocks every non-service-role write. The RPCs below run
-- SECURITY DEFINER so they bypass RLS and perform the mutations.
drop policy if exists "user_credits: owner read" on user_credits;
create policy "user_credits: owner read"
  on user_credits for select
  using (auth.uid() = user_id);

-- ── 2. credit_transactions (immutable ledger) ──────────────────────────────

create table if not exists credit_transactions (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  -- 'grant' = free credits handed out (signup bonus, promo, admin)
  -- 'purchase' = Stripe top-up
  -- 'debit' = generation consumed credits
  -- 'refund' = generation failed / Stripe refund / manual reversal
  -- 'adjustment' = manual fix (either direction)
  kind                 text not null check (kind in ('grant','purchase','debit','refund','adjustment')),
  -- Signed amount. Grants/purchases/refunds positive, debits negative,
  -- adjustments either direction. The ledger sum equals balance_cents.
  amount_cents         bigint not null,
  balance_after_cents  bigint not null check (balance_after_cents >= 0),
  reference_type       text,    -- e.g. 'xcreate_job','duel','stripe_payment_intent','admin_grant'
  reference_id         text,    -- target id as text; not FK-constrained because it points across tables
  description          text,
  metadata             jsonb,
  created_at           timestamptz not null default now()
);

create index if not exists credit_transactions_user_created_idx
  on credit_transactions (user_id, created_at desc);

create index if not exists credit_transactions_reference_idx
  on credit_transactions (reference_type, reference_id)
  where reference_type is not null;

alter table credit_transactions enable row level security;

drop policy if exists "credit_transactions: owner read" on credit_transactions;
create policy "credit_transactions: owner read"
  on credit_transactions for select
  using (auth.uid() = user_id);

-- No write policies — ledger is append-only via the RPCs below.

-- ── 3. credit_holds (schema only for now) ──────────────────────────────────
-- Pre-flight reservation rows for the XCreate flow. Not mutated by Phase 1
-- RPCs; /api/xcreate will start using them in Phase 2.

create table if not exists credit_holds (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  -- Max amount the hold reserves up-front. Actual charge is set at settle.
  amount_cents       bigint not null check (amount_cents > 0),
  -- 'active'    → still holding funds
  -- 'settled'   → consumed; actual_cost_cents has final charge
  -- 'released'  → partially released (e.g. XDuel vote completion refund)
  -- 'refunded'  → fully reversed (generation failed)
  status             text not null default 'active' check (status in ('active','settled','released','refunded')),
  reference_type     text,
  reference_id       text,
  actual_cost_cents  bigint,
  created_at         timestamptz not null default now(),
  settled_at         timestamptz
);

create index if not exists credit_holds_user_active_idx
  on credit_holds (user_id)
  where status = 'active';

alter table credit_holds enable row level security;

drop policy if exists "credit_holds: owner read" on credit_holds;
create policy "credit_holds: owner read"
  on credit_holds for select
  using (auth.uid() = user_id);

-- ── 4. Auto-create user_credits row on signup ──────────────────────────────
-- Extend the existing handle_new_user trigger (from 05_profiles.sql) to
-- also seed a user_credits row. Idempotent — running this migration twice
-- is safe.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(new.email, '@', 1)
    ),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;

  insert into public.user_credits (user_id, balance_cents)
  values (new.id, 0)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

-- Backfill wallets for every existing auth user so the trigger's behavior
-- is reflected retroactively. We read from auth.users (not profiles) so
-- users who signed up before the handle_new_user trigger was installed
-- still get a wallet — their profile row may be missing too, but that's
-- a separate recovery and shouldn't block the wallet.
insert into public.user_credits (user_id, balance_cents)
select id, 0 from auth.users
on conflict (user_id) do nothing;

-- Also backfill any missing profile rows for the same reason. The trigger
-- in 05_profiles.sql only covers users created after it was installed;
-- this catches legacy accounts. Pulls display_name / avatar from the
-- same auth metadata fields the trigger uses.
insert into public.profiles (id, display_name, avatar_url)
select
  u.id,
  coalesce(
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'name',
    split_part(u.email, '@', 1)
  ),
  u.raw_user_meta_data->>'avatar_url'
from auth.users u
on conflict (id) do nothing;

-- ── 5. grant_credits RPC ───────────────────────────────────────────────────
-- Adds credits to a user's balance and appends a ledger row, atomically.
-- Used by admin grants now and by the Stripe webhook later.
--
-- Raises if p_amount_cents <= 0 or p_kind is not a credit-kind.

create or replace function public.grant_credits(
  p_user_id        uuid,
  p_amount_cents   bigint,
  p_kind           text    default 'grant',
  p_reference_type text    default null,
  p_reference_id   text    default null,
  p_description    text    default null,
  p_metadata       jsonb   default null
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_balance bigint;
begin
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'grant_credits: amount must be positive (got %)', p_amount_cents;
  end if;

  if p_kind not in ('grant','purchase','refund','adjustment') then
    raise exception 'grant_credits: invalid kind %', p_kind;
  end if;

  -- Ensure a wallet row exists (handles users predating the trigger).
  insert into user_credits (user_id, balance_cents)
  values (p_user_id, 0)
  on conflict (user_id) do nothing;

  update user_credits
    set balance_cents          = balance_cents + p_amount_cents,
        lifetime_granted_cents = lifetime_granted_cents + p_amount_cents,
        updated_at             = now()
    where user_id = p_user_id
    returning balance_cents into v_new_balance;

  insert into credit_transactions (
    user_id, kind, amount_cents, balance_after_cents,
    reference_type, reference_id, description, metadata
  ) values (
    p_user_id, p_kind, p_amount_cents, v_new_balance,
    p_reference_type, p_reference_id, p_description, p_metadata
  );

  return v_new_balance;
end;
$$;

-- ── 6. debit_credits RPC ───────────────────────────────────────────────────
-- Subtracts credits and appends a ledger row, atomically. Acquires a row
-- lock so concurrent debits serialize. Raises 'insufficient_credits' when
-- the balance would go negative — API callers should catch and surface
-- the top-up flow.

create or replace function public.debit_credits(
  p_user_id        uuid,
  p_amount_cents   bigint,
  p_kind           text    default 'debit',
  p_reference_type text    default null,
  p_reference_id   text    default null,
  p_description    text    default null,
  p_metadata       jsonb   default null
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_balance bigint;
  v_new_balance     bigint;
begin
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'debit_credits: amount must be positive (got %)', p_amount_cents;
  end if;

  if p_kind not in ('debit','adjustment') then
    raise exception 'debit_credits: invalid kind %', p_kind;
  end if;

  -- Lock the wallet row so two parallel debits (e.g. two tabs clicking
  -- Generate at the same instant) serialize instead of racing.
  select balance_cents into v_current_balance
    from user_credits
    where user_id = p_user_id
    for update;

  if v_current_balance is null then
    raise exception 'debit_credits: no wallet row for user % (grant first)', p_user_id;
  end if;

  if v_current_balance < p_amount_cents then
    raise exception 'insufficient_credits: have=% want=%', v_current_balance, p_amount_cents;
  end if;

  update user_credits
    set balance_cents        = balance_cents - p_amount_cents,
        lifetime_spent_cents = lifetime_spent_cents + p_amount_cents,
        updated_at           = now()
    where user_id = p_user_id
    returning balance_cents into v_new_balance;

  insert into credit_transactions (
    user_id, kind, amount_cents, balance_after_cents,
    reference_type, reference_id, description, metadata
  ) values (
    p_user_id, p_kind, -p_amount_cents, v_new_balance,
    p_reference_type, p_reference_id, p_description, p_metadata
  );

  return v_new_balance;
end;
$$;

-- Lock down RPC visibility: only the service role (server-side code) may
-- call these. Authenticated clients still read user_credits /
-- credit_transactions directly via the owner-read RLS policies above.
revoke all on function public.grant_credits(uuid, bigint, text, text, text, text, jsonb) from public;
revoke all on function public.debit_credits(uuid, bigint, text, text, text, text, jsonb) from public;

grant execute on function public.grant_credits(uuid, bigint, text, text, text, text, jsonb) to service_role;
grant execute on function public.debit_credits(uuid, bigint, text, text, text, text, jsonb) to service_role;
