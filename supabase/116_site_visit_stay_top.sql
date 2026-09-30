-- supabase/116_site_visit_stay_top.sql — the top 20% and top 10% stay for
-- /admin/traffic.
-- (Applied by the owner on Sep 30 and checked live: the service key gets the
-- fourteen columns, the publishable key gets 42501.)
--
-- Owner, Sep 30: "add top 20% and 10% stay time". The median says what the
-- typical visitor does (a few seconds, on ad traffic) and the average is
-- pulled up by a handful of very long stays. Neither shows how long the
-- engaged visitors stay. Two more columns on site_visit_daily() (115):
--
--   p80_seconds   the stay the top 20% of that day's browsers reached or
--                 passed (the 80th percentile)
--   p90_seconds   the same for the top 10% (the 90th percentile)
--
-- Same basis as median_seconds: stay PER BROWSER per day (its visits that
-- day added up), tab in front, production rows, days cut in p_tz.
--
-- A function's result columns cannot be changed by "create or replace", so
-- it is dropped and created again, in one transaction: a reader never finds
-- it missing. The existing twelve columns keep their names, order and
-- meaning, so the page deployed before this still works after it. The new
-- page shows a note where these two numbers go until this has been run.
--
-- Dropping the function drops its grants with it: anon and authenticated are
-- revoked again by name (pitfall 15).
--
-- Run by hand. Dev and prod share this database. Safe to re-run, and safe to
-- run without 115 (it defines the whole function). Once this has run, 115
-- itself can no longer be re-run: Postgres refuses it ("cannot change return
-- type") and nothing changes. Proven on PGlite before it was handed over.

begin;

drop function if exists public.site_visit_daily(integer, text);

create function public.site_visit_daily(
  p_days integer default 30,
  p_tz   text    default 'Asia/Taipei'
) returns table (
  day                date,
  visits             integer,
  browsers           integer,
  new_browsers       integer,
  returning_browsers integer,
  signed_in_users    integer,
  median_seconds     integer,
  avg_seconds        integer,
  total_seconds      bigint,
  chatgpt_visits     integer,
  google_visits      integer,
  other_visits       integer,
  p80_seconds        integer,
  p90_seconds        integer
)
language sql
stable
set search_path = public
as $$
  with v as (
    select visitor_id, user_id, active_seconds,
           (started_at at time zone p_tz)::date as day,
           case when utm_source = 'chatgpt' then 'chatgpt'
                when gclid is not null or gbraid is not null or wbraid is not null then 'google'
                else 'other' end as src
    from public.site_visits
    where env = 'production'
  ),
  first_seen as (
    select visitor_id, min(day) as first_day from v group by 1
  ),
  win as (
    select * from v
    where day > (now() at time zone p_tz)::date - greatest(least(p_days, 366), 1)
  ),
  per_browser as (
    select day, visitor_id, sum(active_seconds) as secs
    from win group by 1, 2
  ),
  b as (
    select p.day,
           count(*)                                       as browsers,
           count(*) filter (where f.first_day = p.day)    as new_browsers,
           count(*) filter (where f.first_day < p.day)    as returning_browsers,
           percentile_cont(0.5) within group (order by p.secs) as median_seconds,
           percentile_cont(0.8) within group (order by p.secs) as p80_seconds,
           percentile_cont(0.9) within group (order by p.secs) as p90_seconds,
           avg(p.secs)                                    as avg_seconds,
           sum(p.secs)                                    as total_seconds
    from per_browser p join first_seen f using (visitor_id)
    group by 1
  ),
  s as (
    select day,
           count(*)                                  as visits,
           count(distinct user_id)                   as signed_in_users,
           count(*) filter (where src = 'chatgpt')   as chatgpt_visits,
           count(*) filter (where src = 'google')    as google_visits,
           count(*) filter (where src = 'other')     as other_visits
    from win group by 1
  )
  select b.day, s.visits::int, b.browsers::int, b.new_browsers::int, b.returning_browsers::int,
         s.signed_in_users::int, round(b.median_seconds)::int, round(b.avg_seconds)::int,
         b.total_seconds::bigint, s.chatgpt_visits::int, s.google_visits::int, s.other_visits::int,
         round(b.p80_seconds)::int, round(b.p90_seconds)::int
  from b join s using (day)
  order by b.day;
$$;

revoke all on function public.site_visit_daily(integer, text) from public, anon, authenticated;
grant execute on function public.site_visit_daily(integer, text) to service_role;

commit;

-- After running, this must be false:
--   select has_function_privilege('anon', 'public.site_visit_daily(integer, text)', 'execute');
