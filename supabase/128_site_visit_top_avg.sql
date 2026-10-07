-- supabase/128_site_visit_top_avg.sql — /admin/traffic: the top 20% and top
-- 10% stay become the AVERAGE stay of those browsers, not a cutoff.
--
-- Owner, Oct 7, on Oct 6's row (top 10% stay 43 s, average 3 m 20 s): "this
-- data is absolutely wrong right? top 10% is less than average?", then "I
-- thought we do top 10% average" and "percentile is misleading" (we have 15
-- to 25 browsers a day). Since 116 the two columns were the 80th and 90th
-- percentile, the stay the top fifth and tenth reached or passed, filled in
-- between two real stays: on Oct 6, 60% of the way from the 22nd stay (24 s)
-- to the 23rd (55 s), a 43 s nobody had.
--
-- Now, for a group of n stays (one day's browsers, or the window's
-- browser-days in site_visit_summary):
--   top20_avg_seconds   the average of the ceil(n / 5) longest stays
--   top10_avg_seconds   the average of the ceil(n / 10) longest stays
-- Oct 6 (25 browsers): top 10% = the 3 longest (59 m 12 s, 22 m 10 s, 55 s),
-- average 27 m 26 s; top 20% = the 5 longest, 16 m 37 s. A group of one is
-- its own top 10%. The signed-in and guest groups are ranked within
-- themselves, as their medians are.
--
-- The median stays a percentile_cont(0.5) and the average stays avg():
-- unchanged. The other columns keep their names, order and meaning.
--
-- The two functions the page reads are dropped and created again, in one
-- transaction, because a function's result columns cannot be renamed by
-- "create or replace" (p80/p90 become top20_avg/top10_avg, in the same
-- places). A reader never finds them missing. Dropping a function drops its
-- grants: anon and authenticated are revoked again by name (pitfall 15).
-- site_visit_daily() (115, 116) is left as it was: the page uses it only
-- when site_visit_daily_v2() is missing, and then shows no top stay.
--
-- Deploy the page first: it reads the new columns and, until this has run,
-- leaves the top 20% / top 10% out with a note naming this file. The page
-- deployed before it reads p80/p90, so after this has run it drops the top
-- tiles and shows NaN in the two group cards' top cells until the new one
-- is live.
--
-- Run by hand. Dev and prod share this database. Safe to re-run. Needs 109
-- (site_visits). Proven on PGlite before it was handed over.

begin;

drop function if exists public.site_visit_daily_v2(integer, text, text);

create function public.site_visit_daily_v2(
  p_days    integer default 30,
  p_tz      text    default 'Asia/Taipei',
  p_country text    default null
) returns table (
  day                       date,
  visits                    integer,
  browsers                  integer,
  new_browsers              integer,
  returning_browsers        integer,
  signed_in_users           integer,
  median_seconds            integer,
  avg_seconds               integer,
  total_seconds             bigint,
  chatgpt_visits            integer,
  google_visits             integer,
  other_visits              integer,
  top20_avg_seconds         integer,
  top10_avg_seconds         integer,
  signed_browsers           integer,
  signed_median_seconds     integer,
  signed_top20_avg_seconds  integer,
  signed_top10_avg_seconds  integer,
  signed_avg_seconds        integer,
  guest_browsers            integer,
  guest_median_seconds      integer,
  guest_top20_avg_seconds   integer,
  guest_top10_avg_seconds   integer,
  guest_avg_seconds         integer
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
  first_seen as (
    select visitor_id, min(day) as first_day from v group by 1
  ),
  win as (
    select * from v
    where day > (now() at time zone p_tz)::date - greatest(least(p_days, 366), 1)
  ),
  per_browser as (
    select day, visitor_id, sum(active_seconds) as secs,
           bool_or(user_id is not null) as signed
    from win group by 1, 2
  ),
  ranked as (
    -- Longest first, within the day and within the day's group.
    select p.*,
           row_number() over (partition by p.day order by p.secs desc)           as rk,
           count(*)     over (partition by p.day)                                 as n,
           row_number() over (partition by p.day, p.signed order by p.secs desc) as grk,
           count(*)     over (partition by p.day, p.signed)                       as gn
    from per_browser p
  ),
  b as (
    select p.day,
           count(*)                                       as browsers,
           count(*) filter (where f.first_day = p.day)    as new_browsers,
           count(*) filter (where f.first_day < p.day)    as returning_browsers,
           percentile_cont(0.5) within group (order by p.secs) as median_seconds,
           avg(p.secs) filter (where p.rk <= ceil(p.n / 5.0))  as top20_avg,
           avg(p.secs) filter (where p.rk <= ceil(p.n / 10.0)) as top10_avg,
           avg(p.secs)                                    as avg_seconds,
           sum(p.secs)                                    as total_seconds,
           count(*) filter (where p.signed)               as signed_browsers,
           percentile_cont(0.5) within group (order by p.secs) filter (where p.signed) as signed_median,
           avg(p.secs) filter (where p.signed and p.grk <= ceil(p.gn / 5.0))           as signed_top20,
           avg(p.secs) filter (where p.signed and p.grk <= ceil(p.gn / 10.0))          as signed_top10,
           avg(p.secs) filter (where p.signed)            as signed_avg,
           count(*) filter (where not p.signed)           as guest_browsers,
           percentile_cont(0.5) within group (order by p.secs) filter (where not p.signed) as guest_median,
           avg(p.secs) filter (where not p.signed and p.grk <= ceil(p.gn / 5.0))           as guest_top20,
           avg(p.secs) filter (where not p.signed and p.grk <= ceil(p.gn / 10.0))          as guest_top10,
           avg(p.secs) filter (where not p.signed)        as guest_avg
    from ranked p join first_seen f using (visitor_id)
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
         round(b.top20_avg)::int, round(b.top10_avg)::int,
         b.signed_browsers::int,
         coalesce(round(b.signed_median), 0)::int, coalesce(round(b.signed_top20), 0)::int,
         coalesce(round(b.signed_top10), 0)::int,  coalesce(round(b.signed_avg), 0)::int,
         b.guest_browsers::int,
         coalesce(round(b.guest_median), 0)::int,  coalesce(round(b.guest_top20), 0)::int,
         coalesce(round(b.guest_top10), 0)::int,   coalesce(round(b.guest_avg), 0)::int
  from b join s using (day)
  order by b.day;
$$;

revoke all on function public.site_visit_daily_v2(integer, text, text) from public, anon, authenticated;
grant execute on function public.site_visit_daily_v2(integer, text, text) to service_role;

drop function if exists public.site_visit_summary(integer, text, text);

create function public.site_visit_summary(
  p_days    integer default 30,
  p_tz      text    default 'Asia/Taipei',
  p_country text    default null
) returns table (
  visits                    integer,
  browsers                  integer,
  new_browsers              integer,
  returning_browsers        integer,
  signed_in_users           integer,
  median_seconds            integer,
  top20_avg_seconds         integer,
  top10_avg_seconds         integer,
  avg_seconds               integer,
  total_seconds             bigint,
  chatgpt_visits            integer,
  google_visits             integer,
  other_visits              integer,
  signed_browsers           integer,
  signed_median_seconds     integer,
  signed_top20_avg_seconds  integer,
  signed_top10_avg_seconds  integer,
  signed_avg_seconds        integer,
  guest_browsers            integer,
  guest_median_seconds      integer,
  guest_top20_avg_seconds   integer,
  guest_top10_avg_seconds   integer,
  guest_avg_seconds         integer
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
  ranked as (
    -- Every browser-day in the window, longest first, overall and within its group.
    select d.secs, b.signed,
           row_number() over (order by d.secs desc)                       as rk,
           count(*)     over ()                                            as n,
           row_number() over (partition by b.signed order by d.secs desc) as grk,
           count(*)     over (partition by b.signed)                       as gn
    from per_day d join per_browser b using (visitor_id)
  ),
  t as (
    select percentile_cont(0.5) within group (order by r.secs) as median_seconds,
           avg(r.secs) filter (where r.rk <= ceil(r.n / 5.0))  as top20_avg,
           avg(r.secs) filter (where r.rk <= ceil(r.n / 10.0)) as top10_avg,
           avg(r.secs)                                         as avg_seconds,
           sum(r.secs)                                         as total_seconds,
           percentile_cont(0.5) within group (order by r.secs) filter (where r.signed)     as signed_median,
           avg(r.secs) filter (where r.signed and r.grk <= ceil(r.gn / 5.0))               as signed_top20,
           avg(r.secs) filter (where r.signed and r.grk <= ceil(r.gn / 10.0))              as signed_top10,
           avg(r.secs) filter (where r.signed)                                             as signed_avg,
           percentile_cont(0.5) within group (order by r.secs) filter (where not r.signed) as guest_median,
           avg(r.secs) filter (where not r.signed and r.grk <= ceil(r.gn / 5.0))           as guest_top20,
           avg(r.secs) filter (where not r.signed and r.grk <= ceil(r.gn / 10.0))          as guest_top10,
           avg(r.secs) filter (where not r.signed)                                         as guest_avg
    from ranked r
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
         coalesce(round(t.median_seconds), 0)::int, coalesce(round(t.top20_avg), 0)::int,
         coalesce(round(t.top10_avg), 0)::int,      coalesce(round(t.avg_seconds), 0)::int,
         coalesce(t.total_seconds, 0)::bigint,
         s.chatgpt_visits::int, s.google_visits::int, s.other_visits::int,
         c.signed_browsers::int,
         coalesce(round(t.signed_median), 0)::int, coalesce(round(t.signed_top20), 0)::int,
         coalesce(round(t.signed_top10), 0)::int,  coalesce(round(t.signed_avg), 0)::int,
         c.guest_browsers::int,
         coalesce(round(t.guest_median), 0)::int,  coalesce(round(t.guest_top20), 0)::int,
         coalesce(round(t.guest_top10), 0)::int,   coalesce(round(t.guest_avg), 0)::int
  from c, t, s;
$$;

revoke all on function public.site_visit_summary(integer, text, text) from public, anon, authenticated;
grant execute on function public.site_visit_summary(integer, text, text) to service_role;

commit;

-- After running, both must be false:
--   select has_function_privilege('anon', 'public.site_visit_daily_v2(integer, text, text)', 'execute');
--   select has_function_privilege('anon', 'public.site_visit_summary(integer, text, text)', 'execute');
