-- supabase/98_subscriptions.sql — the monthly plan (lib/plans.ts).
--
-- Owner, Sep 10: $4.99 a month (NT$150 / ¥750). The price comes back as
-- credit 1:1 that keeps, plus a BONUS that lives only for the month it was
-- paid for. The bonus is spent first and does not roll over.
--
-- THE DESIGN THAT LEAVES EVERYTHING ELSE ALONE: balance_cents stays the TOTAL
-- spendable balance, and bonus_cents is the part of it that expires. Every
-- existing reader (XCreate's pre-flight check, lib/inference.ts, the MCP
-- route, the profile) keeps reading one number and keeps being right.
--
-- Only three live functions touch user_credits (checked against pg_proc on
-- Sep 10): grant_credits adds, handle_new_user inserts, and debit_credits is
-- the ONLY one that subtracts. So it is the only one that must learn to spend
-- the bonus first, and it is replaced below with the same signature.
--
-- PERMISSIONS. Supabase grants EXECUTE on new functions to anon and
-- authenticated through default privileges, so revoking from PUBLIC alone
-- does not lock a function down. Every new function here is SECURITY DEFINER
-- and one of them mints credit, so each is revoked from anon and
-- authenticated by name and granted to service_role only.
--
-- Run by hand in the Supabase SQL editor. Shared dev+prod project, as always.
-- Additive: three columns with defaults, one table, one partial unique index,
-- three new functions, and debit_credits replaced in place.

begin;

-- ── 1. The bonus bucket ─────────────────────────────────────────────────────
alter table user_credits
  add column if not exists bonus_cents      bigint not null default 0,
  add column if not exists bonus_expires_at timestamptz,
  -- Which invoice granted the current bonus, so its expiry lands in the same
  -- ledger group as the month that paid for it.
  add column if not exists bonus_source     text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'user_credits_bonus_within_balance') then
    alter table user_credits add constraint user_credits_bonus_within_balance
      check (bonus_cents >= 0 and bonus_cents <= balance_cents);
  end if;
end $$;

-- ── 2. Subscriptions: one row per user, mirrored from Stripe ───────────────
create table if not exists subscriptions (
  user_id                uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id     text,
  stripe_subscription_id text not null unique,
  plan                   text not null,
  status                 text not null,
  currency               text,
  cancel_at_period_end   boolean not null default false,
  current_period_end     timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

alter table subscriptions enable row level security;
-- Owners read their own row. No write policies: every write is the webhook
-- or the subscription route, both on the service role.
drop policy if exists "subscriptions_owner_read" on subscriptions;
create policy "subscriptions_owner_read" on subscriptions
  for select using (auth.uid() = user_id);

-- ── 3. One grant per invoice, enforced by the database ─────────────────────
-- The first month can arrive twice (checkout.session.completed AND
-- invoice.paid, see lib/subscription.ts). This index is the backstop behind
-- the check inside grant_subscription_period.
create unique index if not exists credit_tx_one_per_stripe_invoice
  on credit_transactions (reference_id)
  where reference_type = 'stripe_invoice';

-- ── 4. Expire a bonus. The CALLER holds the wallet row lock. ────────────────
-- Lifetime counters are left alone: an expired bonus was granted, and it was
-- not spent. The ledger row is the record of where it went.
create or replace function public._expire_bonus_locked(p_user_id uuid, p_force boolean default false)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bonus   bigint;
  v_expires timestamptz;
  v_source  text;
  v_balance bigint;
begin
  select bonus_cents, bonus_expires_at, bonus_source
    into v_bonus, v_expires, v_source
    from user_credits where user_id = p_user_id;

  if coalesce(v_bonus, 0) = 0 then
    return 0;
  end if;
  if not p_force and (v_expires is null or v_expires > now()) then
    return 0;
  end if;

  update user_credits
     set balance_cents    = balance_cents - v_bonus,
         bonus_cents      = 0,
         updated_at       = now()
   where user_id = p_user_id
   returning balance_cents into v_balance;

  insert into credit_transactions (
    user_id, kind, amount_cents, balance_after_cents,
    reference_type, reference_id, description, metadata
  ) values (
    p_user_id, 'adjustment', -v_bonus, v_balance,
    'subscription_bonus_expiry', v_source,
    'Monthly plan bonus expired (unused)',
    jsonb_build_object('expired_at', coalesce(v_expires, now()))
  );

  return v_bonus;
end;
$$;

-- ── 5. debit_credits: same signature, bonus spent first ────────────────────
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

  -- An expired bonus is not spendable. Taking it off here, under the lock,
  -- is what makes "expires at the end of the month" true to the second,
  -- whenever the daily sweep happens to run.
  if public._expire_bonus_locked(p_user_id, false) > 0 then
    select balance_cents into v_current_balance from user_credits where user_id = p_user_id;
  end if;

  if v_current_balance < p_amount_cents then
    raise exception 'insufficient_credits: have=% want=%', v_current_balance, p_amount_cents;
  end if;

  -- The bonus goes FIRST: it is the credit that disappears if it is not used.
  update user_credits
    set balance_cents        = balance_cents - p_amount_cents,
        bonus_cents          = bonus_cents - least(bonus_cents, p_amount_cents),
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

-- ── 6. Credit one paid month ────────────────────────────────────────────────
create or replace function public.grant_subscription_period(
  p_user_id          uuid,
  p_invoice_id       text,
  p_paid_cents       bigint,
  p_bonus_cents      bigint,
  p_bonus_expires_at timestamptz,
  p_metadata         jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance     bigint;
  v_cur_expires timestamptz;
begin
  if p_invoice_id is null or p_invoice_id = '' then
    raise exception 'grant_subscription_period: invoice id required';
  end if;
  if p_paid_cents is null or p_paid_cents <= 0 or p_bonus_cents is null or p_bonus_cents < 0 then
    raise exception 'grant_subscription_period: bad amounts paid=% bonus=%', p_paid_cents, p_bonus_cents;
  end if;

  insert into user_credits (user_id, balance_cents) values (p_user_id, 0)
  on conflict (user_id) do nothing;

  select balance_cents, bonus_expires_at into v_balance, v_cur_expires
    from user_credits where user_id = p_user_id
    for update;

  -- One grant per invoice, checked under the lock so two deliveries of the
  -- same invoice serialize and the second returns quietly.
  if exists (select 1 from credit_transactions
              where reference_type = 'stripe_invoice' and reference_id = p_invoice_id) then
    return jsonb_build_object('granted', false, 'balance', v_balance);
  end if;

  -- 1. The price, back as credit that keeps.
  update user_credits
     set balance_cents          = balance_cents + p_paid_cents,
         lifetime_granted_cents = lifetime_granted_cents + p_paid_cents,
         updated_at             = now()
   where user_id = p_user_id
   returning balance_cents into v_balance;

  insert into credit_transactions (
    user_id, kind, amount_cents, balance_after_cents,
    reference_type, reference_id, description, metadata
  ) values (
    p_user_id, 'purchase', p_paid_cents, v_balance,
    'stripe_invoice', p_invoice_id, 'Monthly plan', p_metadata
  );

  -- 2. This month's bonus REPLACES last month's: it never rolls over. Only a
  --    bonus for a LATER month replaces the current one, so an old invoice
  --    redelivered late cannot swap this month's bonus for an expired one.
  if p_bonus_cents > 0
     and p_bonus_expires_at > now()
     and (v_cur_expires is null or p_bonus_expires_at > v_cur_expires) then
    perform public._expire_bonus_locked(p_user_id, true);
    update user_credits
       set balance_cents          = balance_cents + p_bonus_cents,
           bonus_cents            = p_bonus_cents,
           bonus_expires_at       = p_bonus_expires_at,
           bonus_source           = p_invoice_id,
           lifetime_granted_cents = lifetime_granted_cents + p_bonus_cents,
           updated_at             = now()
     where user_id = p_user_id
     returning balance_cents into v_balance;

    insert into credit_transactions (
      user_id, kind, amount_cents, balance_after_cents,
      reference_type, reference_id, description, metadata
    ) values (
      p_user_id, 'grant', p_bonus_cents, v_balance,
      'subscription_bonus', p_invoice_id, 'Monthly plan bonus (use this month)',
      coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('expires_at', p_bonus_expires_at)
    );
  end if;

  return jsonb_build_object('granted', true, 'balance', v_balance);
end;
$$;

-- ── 7. The daily sweep's half (app/api/cron/sweep-orphans) ─────────────────
-- Rows mid-debit are skipped rather than waited on: debit_credits expires
-- them itself.
create or replace function public.expire_due_bonuses()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select user_id from user_credits
     where bonus_cents > 0 and bonus_expires_at <= now()
     for update skip locked
  loop
    if public._expire_bonus_locked(r.user_id, false) > 0 then
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

-- ── 8. Lock them down ───────────────────────────────────────────────────────
-- grant_subscription_period mints credit and _expire_bonus_locked(…, true)
-- wipes a bonus, for ANY user id passed in. Neither may be callable from a
-- browser. debit_credits keeps whatever grants it has: create or replace
-- preserves a function's privileges. Its anon/authenticated grants are
-- removed by 97_lock_security_definer.sql, which must be run BEFORE this.
revoke all on function public._expire_bonus_locked(uuid, boolean) from public, anon, authenticated;
revoke all on function public.grant_subscription_period(uuid, text, bigint, bigint, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.expire_due_bonuses() from public, anon, authenticated;

grant execute on function public._expire_bonus_locked(uuid, boolean) to service_role;
grant execute on function public.grant_subscription_period(uuid, text, bigint, bigint, timestamptz, jsonb) to service_role;
grant execute on function public.expire_due_bonuses() to service_role;

commit;
