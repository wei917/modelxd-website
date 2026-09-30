-- supabase/118_site_visit_summary.sql — /admin/traffic: the numbers for the
-- whole range.
-- (Applied by the owner on Oct 1, Taiwan time, and checked live: one row for
-- the service key, adding up with site_visit_daily_v2's days; the publishable
-- key gets 42501.)
--
-- Owner, Oct 1 (Taiwan time), twenty minutes after midnight there: "did you
-- removed all data?", "why all countries 14 days active browsers is only 3?",
-- "fix it". The tiles under the heading "Filtered: 14 days" showed TODAY,
-- and the day had just begun. The top of the page has to say what the
-- heading says: the range.
--
-- Those numbers cannot be added up from the daily rows: a browser that comes
-- on three days is three in the daily counts and one here, and a median of
-- medians is not a median. So one more function, returning ONE row for the
-- window, with the same arguments as site_visit_daily_v2 (117):
--
--   visits, chatgpt_visits, google_visits, other_visits
--   browsers            distinct visitor cookies in the window
--   new_browsers        of those, first seen inside the window
--   returning_browsers  of those, seen on an earlier day too (the earlier
--                       day may be before the window): they came back
--   signed_in_users     distinct accounts
--   signed_browsers     browsers that had an account on any visit in the
--   guest_browsers      window, and the rest; the two add up to browsers
--   median / p80 / p90 / avg / total _seconds
--                       stay PER BROWSER PER DAY, the same unit as the daily
--                       charts, over every browser-day in the window
--   signed_* / guest_* _seconds
--                       the same over every day of the signed-in browsers,
--                       and over every day of the rest. The daily function's
--                       rule ("signed in if any visit that day carried an
--                       account") is this one with a window of one day, so
--                       the counts and the times describe the same browsers:
--                       a group with no browsers has no times.
--
-- With p_country everything is within that country, as in 117. An empty
-- window returns one row of zeros.
--
-- Purely additive: one NEW function, nothing dropped or changed. Read only,
-- runs as its caller, for server code holding the service key: anon and
-- authenticated are revoked by name (pitfall 15). Until it has been run the
-- page shows today's numbers under a heading that says "today".
--
-- Run by hand. Dev and prod share this database. Safe to re-run. Proven on
-- PGlite before it was handed over.

begin;

create or replace function public.site_visit_summary(
  p_days    integer default 30,
  p_tz      text    default 'Asia/Taipei',
  p_country text    default null
) returns table (
  visits                integer,
  browsers              integer,
  new_browsers          integer,
  returning_browsers    integer,
  signed_in_users       integer,
  median_seconds        integer,
  p80_seconds           integer,
  p90_seconds           integer,
  avg_seconds           integer,
  total_seconds         bigint,
  chatgpt_visits        integer,
  google_visits         integer,
  other_visits          integer,
  signed_browsers       integer,
  signed_median_seconds integer,
  signed_p80_seconds    integer,
  signed_p90_seconds    integer,
  signed_avg_seconds    integer,
  guest_browsers        integer,
  guest_median_seconds  integer,
  guest_p80_seconds     integer,
  guest_p90_seconds     integer,
  guest_avg_seconds     integer
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
      and (p_country is null or country = p_country)
  ),
  edge as (
    -- The day before the window's first day.
    select (now() at time zone p_tz)::date - greatest(least(p_days, 366), 1) as day
  ),
  first_seen as (
    select visitor_id, min(day) as first_day from v group by 1
  ),
  win as (
    select v.* from v, edge where v.day > edge.day
  ),
  per_day as (
    -- One row per browser per day: the unit every stay number is taken over.
    select day, visitor_id, sum(active_seconds) as secs,
           bool_or(user_id is not null) as had_account
    from win group by 1, 2
  ),
  per_browser as (
    -- One row per browser over the whole window. Signed in = an account on
    -- any of its visits in the window.
    select p.visitor_id, f.first_day, max(p.day) as last_day, bool_or(p.had_account) as signed
    from per_day p join first_seen f using (visitor_id)
    group by p.visitor_id, f.first_day
  ),
  c as (
    select count(*)                                          as browsers,
           count(*) filter (where b.first_day > edge.day)    as new_browsers,
           count(*) filter (where b.first_day < b.last_day)  as returning_browsers,
           count(*) filter (where b.signed)                  as signed_browsers,
           count(*) filter (where not b.signed)              as guest_browsers
    from per_browser b, edge
  ),
  t as (
    select percentile_cont(0.5) within group (order by d.secs) as median_seconds,
           percentile_cont(0.8) within group (order by d.secs) as p80_seconds,
           percentile_cont(0.9) within group (order by d.secs) as p90_seconds,
           avg(d.secs)                                         as avg_seconds,
           sum(d.secs)                                         as total_seconds,
           percentile_cont(0.5) within group (order by d.secs) filter (where b.signed)     as signed_median,
           percentile_cont(0.8) within group (order by d.secs) filter (where b.signed)     as signed_p80,
           percentile_cont(0.9) within group (order by d.secs) filter (where b.signed)     as signed_p90,
           avg(d.secs) filter (where b.signed)                                             as signed_avg,
           percentile_cont(0.5) within group (order by d.secs) filter (where not b.signed) as guest_median,
           percentile_cont(0.8) within group (order by d.secs) filter (where not b.signed) as guest_p80,
           percentile_cont(0.9) within group (order by d.secs) filter (where not b.signed) as guest_p90,
           avg(d.secs) filter (where not b.signed)                                         as guest_avg
    from per_day d join per_browser b using (visitor_id)
  ),
  s as (
    select count(*)                                  as visits,
           count(distinct user_id)                   as signed_in_users,
           count(*) filter (where src = 'chatgpt')   as chatgpt_visits,
           count(*) filter (where src = 'google')    as google_visits,
           count(*) filter (where src = 'other')     as other_visits
    from win
  )
  select s.visits::int, c.browsers::int, c.new_browsers::int, c.returning_browsers::int, s.signed_in_users::int,
         coalesce(round(t.median_seconds), 0)::int, coalesce(round(t.p80_seconds), 0)::int,
         coalesce(round(t.p90_seconds), 0)::int,    coalesce(round(t.avg_seconds), 0)::int,
         coalesce(t.total_seconds, 0)::bigint,
         s.chatgpt_visits::int, s.google_visits::int, s.other_visits::int,
         c.signed_browsers::int,
         coalesce(round(t.signed_median), 0)::int, coalesce(round(t.signed_p80), 0)::int,
         coalesce(round(t.signed_p90), 0)::int,    coalesce(round(t.signed_avg), 0)::int,
         c.guest_browsers::int,
         coalesce(round(t.guest_median), 0)::int,  coalesce(round(t.guest_p80), 0)::int,
         coalesce(round(t.guest_p90), 0)::int,     coalesce(round(t.guest_avg), 0)::int
  from c, t, s;
$$;

revoke all on function public.site_visit_summary(integer, text, text) from public, anon, authenticated;
grant execute on function public.site_visit_summary(integer, text, text) to service_role;

commit;

-- After running, this must be false:
--   select has_function_privilege('anon', 'public.site_visit_summary(integer, text, text)', 'execute');
