-- supabase/129_site_internal_users.sql — /admin/traffic leaves out the
-- owner's own accounts and the browsers they signed in on.
--
-- Owner, Oct 12: "in the dashboard, can you remove me and my test accounts?"
-- Three accounts are the owner's: two Google accounts (one also has X) and
-- the LINE (Taiwan) test account. Seven browsers had signed in with them.
--
-- 1. site_internal_users: the accounts to leave out. Add a test account with
--      insert into public.site_internal_users (user_id, note) values ('<id>', 'test');
--    then mark its browsers (step 3 below does it for everyone listed).
-- 2. Every report already counts env = 'production' only. A browser that has
--    signed in with an internal account gets env = 'internal' instead, on its
--    visits, its sign-in taps and its share presses, past and future, signed
--    in or not: site_mark_browser_internal(visitor_id) flips its past rows,
--    and /api/visit gives it a cookie (modelxd_internal, a year) and logs it
--    as 'internal' from then on. Nothing is deleted; setting env back to
--    'production' undoes it.
-- 3. Run once here: every browser that has carried an internal account, and
--    every answer vote by one, becomes 'internal'.
-- 4. The three reports that count ACCOUNTS rather than browsers leave the
--    internal accounts out directly: sign-ins per day (site_signins_daily,
--    117), accounts per country (site_registered_users, 123) and answer votes
--    (xtell_vote_window, 122; future votes keep env 'production'). Same
--    signatures, so "create or replace" keeps the page working; only the
--    rows change.
--
-- Read and written by server code with the service key only: the table and
-- the new function are revoked from anon and authenticated by name (pitfalls
-- 15 and 16). The mark function is SECURITY DEFINER because the taps and
-- shares tables were granted select and insert only.
--
-- Run by hand. Dev and prod share this database. Needs 109, 117, 120, 122
-- and 123. Safe to re-run. Proven on PGlite before it was handed over.

begin;

create table if not exists public.site_internal_users (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  note        text,
  created_at  timestamptz not null default now()
);

alter table public.site_internal_users enable row level security;
revoke all on public.site_internal_users from public, anon, authenticated;
grant select, insert, delete on public.site_internal_users to service_role;

insert into public.site_internal_users (user_id, note) values
  ('247efcdb-fc4b-4e59-9f79-5e1b66340461', 'owner, Google (and X)'),
  ('c9a73e58-b5b4-48bf-a794-0b8bb347af89', 'owner, second Google account'),
  ('cd0e0805-e032-4b40-b0b6-41f52bbbca61', 'owner, LINE (Taiwan) test account')
on conflict (user_id) do nothing;

-- One browser's production rows become 'internal'. Returns how many changed.
create or replace function public.site_mark_browser_internal(p_visitor_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer := 0;
  m integer;
begin
  update public.site_visits      set env = 'internal' where env = 'production' and visitor_id = p_visitor_id;
  get diagnostics m = row_count; n := n + m;
  update public.site_signin_taps set env = 'internal' where env = 'production' and visitor_id = p_visitor_id;
  get diagnostics m = row_count; n := n + m;
  update public.xtell_shares     set env = 'internal' where env = 'production' and visitor_id = p_visitor_id;
  get diagnostics m = row_count; n := n + m;
  return n;
end;
$$;

revoke all on function public.site_mark_browser_internal(uuid) from public, anon, authenticated;
grant execute on function public.site_mark_browser_internal(uuid) to service_role;

-- Step 3: every browser that has carried an internal account, and their votes.
select public.site_mark_browser_internal(b.visitor_id)
from (select distinct v.visitor_id
      from public.site_visits v
      join public.site_internal_users i on i.user_id = v.user_id) b;

update public.xtell_answer_votes v set env = 'internal'
where v.env = 'production'
  and exists (select 1 from public.site_internal_users i where i.user_id = v.user_id);

-- Step 4: the account-counting reports, as in 117, 123 and 122, minus the
-- internal accounts.
create or replace function public.site_signins_daily(
  p_days integer default 30,
  p_tz   text    default 'Asia/Taipei'
) returns table (
  day        date,
  provider   text,
  logins     integer,
  people     integer,
  new_people integer
)
language sql
stable
set search_path = public
as $$
  with l as (
    select a.user_id,
           coalesce(nullif(a.metadata->>'provider', ''), 'unknown') as provider,
           (a.created_at at time zone p_tz)::date as day
    from public.activity_logs a
    where a.event = 'login'
      and not exists (select 1 from public.site_internal_users i where i.user_id = a.user_id)
  ),
  first_login as (
    select user_id, min(day) as first_day from l group by 1
  ),
  win as (
    select l.*, f.first_day
    from l join first_login f using (user_id)
    where l.day > (now() at time zone p_tz)::date - greatest(least(p_days, 366), 1)
  )
  select w.day, w.provider,
         count(*)::int                                                       as logins,
         count(distinct w.user_id)::int                                      as people,
         (count(distinct w.user_id) filter (where w.first_day = w.day))::int as new_people
  from win w
  group by 1, 2
  union all
  -- The whole window per provider (day is null): a person who signs in on
  -- three days is one person here, which the daily rows cannot add up to.
  select null::date, w.provider,
         count(*)::int,
         count(distinct w.user_id)::int,
         (count(distinct w.user_id) filter (where w.first_day = w.day))::int
  from win w
  group by 2
  order by 1 nulls last, 2;
$$;

revoke all on function public.site_signins_daily(integer, text) from public, anon, authenticated;
grant execute on function public.site_signins_daily(integer, text) to service_role;

create or replace function public.site_registered_users(
  p_days integer default 30,
  p_tz   text    default 'Asia/Taipei'
) returns table (
  country   text,
  users     integer,
  new_users integer
)
language sql
stable
set search_path = public
as $$
  select coalesce(nullif(p.country, ''), '??') as country,
         count(*)::int,
         (count(*) filter (
           where (p.created_at at time zone p_tz)::date > (now() at time zone p_tz)::date - greatest(least(p_days, 366), 1)
         ))::int
  from public.profiles p
  where not exists (select 1 from public.site_internal_users i where i.user_id = p.id)
  group by 1
  order by 2 desc, 1;
$$;

revoke all on function public.site_registered_users(integer, text) from public, anon, authenticated;
grant execute on function public.site_registered_users(integer, text) to service_role;

create or replace function public.xtell_vote_window(
  p_days    integer default 30,
  p_tz      text    default 'Asia/Taipei',
  p_country text    default null
) returns table (
  temple   text,
  model_id text,
  up       integer,
  down     integer,
  people   integer
)
language sql
stable
set search_path = public
as $$
  select v.temple, v.model_id,
         count(*) filter (where v.vote = 1)::int,
         count(*) filter (where v.vote = -1)::int,
         count(distinct v.user_id)::int
  from public.xtell_answer_votes v
  where v.env = 'production'
    and not exists (select 1 from public.site_internal_users i where i.user_id = v.user_id)
    and (p_country is null or v.country = p_country)
    and (v.updated_at at time zone p_tz)::date > (now() at time zone p_tz)::date - greatest(least(p_days, 366), 1)
  group by 1, 2
  order by 1, 2;
$$;

revoke all on function public.xtell_vote_window(integer, text, text) from public, anon, authenticated;
grant execute on function public.xtell_vote_window(integer, text, text) to service_role;

commit;

-- After running, all four must be false:
--   select has_table_privilege('anon', 'public.site_internal_users', 'select');
--   select has_function_privilege('anon', 'public.site_mark_browser_internal(uuid)', 'execute');
--   select has_function_privilege('anon', 'public.site_signins_daily(integer, text)', 'execute');
--   select has_function_privilege('anon', 'public.site_registered_users(integer, text)', 'execute');
-- And this counts what is left out (browsers, then rows):
--   select count(distinct visitor_id), count(*) from public.site_visits where env = 'internal';
