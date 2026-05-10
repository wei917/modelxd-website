-- supabase/39_daily_credits.sql
--
-- Daily free credit grant: every user gets 100¢ ($1) once per UTC calendar
-- day. Reset boundary is UTC 00:00 — at that instant `last_daily_grant_date`
-- becomes "yesterday" relative to `now()`, so the next call to
-- `grant_daily_credits` qualifies them again.
--
-- Tracking column on user_credits — null on existing rows means they've
-- never been granted (so the next call grants immediately).

alter table user_credits
  add column if not exists last_daily_grant_date date;

-- ── grant_daily_credits ─────────────────────────────────────────────────────
--
-- Atomically:
--   1. Ensure the user has a user_credits row (insert if missing).
--   2. Test whether their `last_daily_grant_date` is older than today (UTC),
--      and if so, mark today as granted and pay them out the daily amount.
--   3. Return the user's current balance (post-grant if granted, current
--      otherwise — caller doesn't need to distinguish).
--
-- Race-safe via UPDATE ... WHERE ... — only one concurrent call wins the
-- claim per user per day. Reuses the existing `grant_credits` RPC for the
-- balance + ledger write so behaviour stays consistent with manual /
-- purchase grants.

create or replace function grant_daily_credits(
  p_user_id      uuid,
  p_amount_cents int default 100
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today    date := (now() at time zone 'utc')::date;
  v_claimed  bigint;
  v_balance  bigint;
begin
  -- Make sure the wallet row exists.
  insert into user_credits (user_id) values (p_user_id)
  on conflict (user_id) do nothing;

  -- Atomically claim today's grant. The UPDATE only matches when the user
  -- hasn't been granted today yet (NULL counts as not-granted).
  update user_credits
     set last_daily_grant_date = v_today
   where user_id = p_user_id
     and (last_daily_grant_date is null or last_daily_grant_date < v_today)
   returning 1 into v_claimed;

  if v_claimed is not null then
    -- Won the race — pay it out.
    select grant_credits(
      p_user_id,
      p_amount_cents,
      'grant',
      'daily',
      v_today::text,
      'Daily free credit',
      null
    ) into v_balance;
  else
    -- Already granted today (or another concurrent call won) — just return
    -- the current balance.
    select balance_cents into v_balance
      from user_credits
     where user_id = p_user_id;
  end if;

  return v_balance;
end;
$$;

grant execute on function grant_daily_credits(uuid, int) to authenticated, service_role;
