-- supabase/99_plan_credit_expires.sql — the monthly plan follows the market.
--
-- Owner, Sep 11: "the market please! only extra credits bought are
-- permanent." Runway, Midjourney and Suno reset a plan's credits every month
-- and keep credits bought separately. So each paid month's WHOLE allowance
-- (the $4.99 plus the $2.00 bonus) now goes into the expiring bucket: spent
-- before any other credit, gone when the month ends, never rolled over.
-- Top-ups, welcome and referral credit stay permanent, exactly as before.
--
-- Nothing else moves: debit_credits already spends the bucket first and
-- expires it under the wallet lock, and the daily sweep already clears due
-- buckets. The column keeps its name, bonus_cents, but since this migration
-- it holds all of a month's plan credit, not just the bonus.
--
-- No subscriber existed when this was written (0 wallets held a bucket), so
-- no plan anyone signed up for changes under them.
--
-- Same signatures as 98, so the app calls them unchanged, and create or
-- replace keeps 98's service-role-only grants. Run after 98.

begin;

-- ── 1. Credit one paid month: all of it expires with the month ─────────────
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

  -- A month that is already over, or older than the month in force (an old
  -- invoice redelivered late), has nothing left to use. Grant nothing rather
  -- than swap this month's credit for an expired one.
  if p_bonus_expires_at <= now()
     or (v_cur_expires is not null and p_bonus_expires_at <= v_cur_expires) then
    return jsonb_build_object('granted', false, 'balance', v_balance, 'reason', 'period over');
  end if;

  -- The new month replaces the old one: whatever is left of it expires now.
  perform public._expire_bonus_locked(p_user_id, true);

  -- 1. The price, as plan credit for this month.
  update user_credits
     set balance_cents          = balance_cents + p_paid_cents,
         bonus_cents            = p_paid_cents,
         bonus_expires_at       = p_bonus_expires_at,
         bonus_source           = p_invoice_id,
         lifetime_granted_cents = lifetime_granted_cents + p_paid_cents,
         updated_at             = now()
   where user_id = p_user_id
   returning balance_cents into v_balance;

  insert into credit_transactions (
    user_id, kind, amount_cents, balance_after_cents,
    reference_type, reference_id, description, metadata
  ) values (
    p_user_id, 'purchase', p_paid_cents, v_balance,
    'stripe_invoice', p_invoice_id, 'Monthly plan (use this month)',
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('expires_at', p_bonus_expires_at)
  );

  -- 2. The bonus, into the same bucket.
  if p_bonus_cents > 0 then
    update user_credits
       set balance_cents          = balance_cents + p_bonus_cents,
           bonus_cents            = bonus_cents + p_bonus_cents,
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

-- ── 2. The expiry's ledger line says what actually expired ─────────────────
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
     set balance_cents = balance_cents - v_bonus,
         bonus_cents   = 0,
         updated_at    = now()
   where user_id = p_user_id
   returning balance_cents into v_balance;

  insert into credit_transactions (
    user_id, kind, amount_cents, balance_after_cents,
    reference_type, reference_id, description, metadata
  ) values (
    p_user_id, 'adjustment', -v_bonus, v_balance,
    'subscription_bonus_expiry', v_source,
    'Monthly plan credit expired (unused)',
    jsonb_build_object('expired_at', coalesce(v_expires, now()))
  );

  return v_bonus;
end;
$$;

commit;

-- Verify (read-only): both still service-role only.
--   select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon,
--          has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
--          has_function_privilege('service_role', p.oid, 'execute') as service_role
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname in ('grant_subscription_period', '_expire_bonus_locked');
