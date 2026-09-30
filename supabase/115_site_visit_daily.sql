-- supabase/115_site_visit_daily.sql — daily traffic numbers for /admin/traffic.
-- (Drafted as 114; 114_credit_fractions.sql landed the same evening. Applied by
-- the owner on Sep 29 and checked live: the service key gets rows, the
-- publishable key gets 42501.)
--
-- Owner, Sep 29: daily active users, returning users and stay time, as a
-- chart on an admin page instead of a question asked each time. The numbers
-- come from site_visits (109). PostgREST cannot group or take a median, and
-- "returning" needs each browser's first day over the WHOLE table, so the
-- page would otherwise have to page every row through the API. One function
-- does it in one round trip.
--
-- One row per day that had visits, days cut in p_tz (the page asks for
-- Asia/Taipei, where the traffic is), production rows only:
--
--   browsers            distinct visitor cookies that day ("active users":
--                       browsers, not people)
--   new_browsers        of those, first seen that day
--   returning_browsers  of those, first seen on an earlier day
--   signed_in_users     distinct accounts seen that day
--   median_seconds, avg_seconds, total_seconds
--                       stay time PER BROWSER per day (its visits that day
--                       added up), tab in front (see 109)
--   chatgpt_visits      visits tagged utm_source = 'chatgpt' (OpenAI ads)
--   google_visits       visits carrying a Google Ads click id
--   other_visits        everything else
--
-- Read only, and only by server code holding the service key: anon and
-- authenticated are revoked by name (pitfall 15), and the function runs as
-- its caller, who cannot read site_visits anyway.
--
-- Run by hand. Dev and prod share this database. Safe to re-run.

begin;

create or replace function public.site_visit_daily(
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
  other_visits       integer
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
         b.total_seconds::bigint, s.chatgpt_visits::int, s.google_visits::int, s.other_visits::int
  from b join s using (day)
  order by b.day;
$$;

revoke all on function public.site_visit_daily(integer, text) from public, anon, authenticated;
grant execute on function public.site_visit_daily(integer, text) to service_role;

commit;

-- After running, this must be false:
--   select has_function_privilege('anon', 'public.site_visit_daily(integer, text)', 'execute');
