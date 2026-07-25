-- 48_giveaway_daily.sql
--
-- Daily giveaway ledger (CC, July 19): one small aggregate table that
-- answers "how much money did we give away today?" in a single indexed
-- read. Two giveaway streams:
--   * daily_credit  — the $1/day signup credit (what we GRANT)
--   * xduel_text / xduel_image / xduel_video — provider cost of free
--     XDuels (what we PAY, in cents, from the duel slots' actual costs)
--
-- Written by the app via the bump_giveaway RPC (atomic upsert), so
-- querying never aggregates raw tables:
--
--   select day, sum(total_cents)/100.0 as usd
--   from giveaway_daily group by day order by day desc limit 30;
--
--   select * from giveaway_daily where day = current_date;

create table if not exists giveaway_daily (
  day         date   not null,
  kind        text   not null check (kind in ('daily_credit','xduel_text','xduel_image','xduel_video')),
  total_cents bigint not null default 0,
  entries     int    not null default 0,   -- number of grants / duels
  primary key (day, kind)
);

alter table giveaway_daily enable row level security;
-- service-role only; no client policies.

create or replace function bump_giveaway(p_kind text, p_cents bigint)
returns void
language plpgsql
security definer
as $$
begin
  insert into giveaway_daily (day, kind, total_cents, entries)
  values ((now() at time zone 'utc')::date, p_kind, p_cents, 1)
  on conflict (day, kind)
  do update set total_cents = giveaway_daily.total_cents + excluded.total_cents,
                entries     = giveaway_daily.entries + 1;
end;
$$;

revoke all on function bump_giveaway(text, bigint) from public;
grant execute on function bump_giveaway(text, bigint) to service_role;

-- ── Backfill from existing data ────────────────────────────────────────
-- Daily credits already live in credit_transactions (reference_type='daily').
insert into giveaway_daily (day, kind, total_cents, entries)
select created_at::date, 'daily_credit', sum(amount_cents), count(*)
from credit_transactions
where reference_type = 'daily' and kind = 'grant'
group by created_at::date
on conflict (day, kind) do update
  set total_cents = excluded.total_cents, entries = excluded.entries;

-- Free-XDuel provider costs from the duel slots (jsonb costs are USD).
insert into giveaway_daily (day, kind, total_cents, entries)
select d.created_at::date,
       'xduel_' || d.mode,
       round(sum(coalesce((s->>'cost')::numeric, 0)) * 100)::bigint,
       count(distinct d.id)
from duels d, jsonb_array_elements(d.slots) s
where d.mode in ('text','image','video')
group by d.created_at::date, d.mode
on conflict (day, kind) do update
  set total_cents = excluded.total_cents, entries = excluded.entries;

-- ── grant_daily_credits now feeds the ledger on the granted branch ─────
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
  insert into user_credits (user_id) values (p_user_id)
  on conflict (user_id) do nothing;

  update user_credits
     set last_daily_grant_date = v_today
   where user_id = p_user_id
     and (last_daily_grant_date is null or last_daily_grant_date < v_today)
   returning 1 into v_claimed;

  if v_claimed is not null then
    select grant_credits(
      p_user_id, p_amount_cents, 'grant', 'daily', v_today::text,
      'Daily free credit', null
    ) into v_balance;
    -- Giveaway ledger — atomic with the grant.
    perform bump_giveaway('daily_credit', p_amount_cents);
  else
    select balance_cents into v_balance
      from user_credits
     where user_id = p_user_id;
  end if;

  return v_balance;
end;
$$;
