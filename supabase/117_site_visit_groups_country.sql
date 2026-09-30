-- supabase/117_site_visit_groups_country.sql — /admin/traffic: stay for
-- signed-in and not signed-in browsers, a country filter, and sign-ins by
-- method.
--
-- Owner, Sep 30, on seeing "top 10% stay: 1 minute": "your number is average
-- both signed in and not signed in?" and "should have two group of lines",
-- then "can you allow split by country? I started Japan market", then "how
-- many from LINE login vs Google login".
--
-- Purely additive: three NEW functions, nothing dropped or changed.
-- site_visit_daily() (115, 116) stays exactly as it is, so the page deployed
-- before this keeps working, and 115 and 116 stay safe to re-run. The new
-- page calls the functions below and falls back to the old one until this
-- file has been run. Once the new page is live everywhere, site_visit_daily
-- is unused and may be dropped by hand.
--
-- 1. site_visit_daily_v2(p_days, p_tz, p_country) returns what
--    site_visit_daily returns, plus stay for two groups per day:
--
--      signed_browsers, signed_median_seconds, signed_p80_seconds,
--      signed_p90_seconds, signed_avg_seconds
--      guest_browsers,  guest_median_seconds,  guest_p80_seconds,
--      guest_p90_seconds,  guest_avg_seconds
--
--    The stay numbers over everyone mix two very different groups: since
--    Sep 28 the 8% of browsers that signed in stayed a median of about 5
--    minutes and the 92% that did not, 8 seconds. A browser counts as signed
--    in on a day if any of its visits that day carried an account
--    (site_visits.user_id); otherwise it is a guest that day. The two groups
--    add up to `browsers`. A group with nobody in it that day returns 0 for
--    its times.
--
--    p_country (the two-letter code Vercel's geo header gives: 'TW', 'JP')
--    narrows EVERYTHING the function returns to visits from that country:
--    "new" and "returning" then mean within that country. null (the default)
--    is every country. Days are cut in p_tz whichever country is asked for.
--
-- 2. site_visit_by_country(p_days, p_tz, p_top) lists, per day, visits and
--    browsers for the p_top countries with the most browsers in the window,
--    and the rest as 'other'. It feeds the country picker and the by-country
--    chart. With the page's arguments (at most 90 days, top 5) that is at
--    most 540 rows, inside PostgREST's 1000-row page.
--
-- 3. site_signins_daily(p_days, p_tz): sign-ins per day and per method, from
--    activity_logs (one 'login' row per sign-in, written by /auth/callback).
--    Owner, Sep 30: "how many from LINE login vs Google login". provider is
--    what the account was created with: 'google', 'custom:line-tw',
--    'custom:line-jp'. Per day: logins (sign-ins), people (accounts),
--    new_people (accounts whose first sign-in ever was that day). One more
--    row per provider with day null carries the whole window, because people
--    cannot be added up across days. activity_logs does not record the host,
--    so sign-ins on dev.modelxd.com and localhost are in these numbers too.
--
-- All three are read only, run as their caller, and are for server code
-- holding the service key: anon and authenticated are revoked by name
-- (pitfall 15).
--
-- Run by hand. Dev and prod share this database. Safe to re-run. Proven on
-- PGlite before it was handed over.

begin;

create or replace function public.site_visit_daily_v2(
  p_days    integer default 30,
  p_tz      text    default 'Asia/Taipei',
  p_country text    default null
) returns table (
  day                   date,
  visits                integer,
  browsers              integer,
  new_browsers          integer,
  returning_browsers    integer,
  signed_in_users       integer,
  median_seconds        integer,
  avg_seconds           integer,
  total_seconds         bigint,
  chatgpt_visits        integer,
  google_visits         integer,
  other_visits          integer,
  p80_seconds           integer,
  p90_seconds           integer,
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
  b as (
    select p.day,
           count(*)                                       as browsers,
           count(*) filter (where f.first_day = p.day)    as new_browsers,
           count(*) filter (where f.first_day < p.day)    as returning_browsers,
           percentile_cont(0.5) within group (order by p.secs) as median_seconds,
           percentile_cont(0.8) within group (order by p.secs) as p80_seconds,
           percentile_cont(0.9) within group (order by p.secs) as p90_seconds,
           avg(p.secs)                                    as avg_seconds,
           sum(p.secs)                                    as total_seconds,
           count(*) filter (where p.signed)               as signed_browsers,
           percentile_cont(0.5) within group (order by p.secs) filter (where p.signed) as signed_median,
           percentile_cont(0.8) within group (order by p.secs) filter (where p.signed) as signed_p80,
           percentile_cont(0.9) within group (order by p.secs) filter (where p.signed) as signed_p90,
           avg(p.secs) filter (where p.signed)            as signed_avg,
           count(*) filter (where not p.signed)           as guest_browsers,
           percentile_cont(0.5) within group (order by p.secs) filter (where not p.signed) as guest_median,
           percentile_cont(0.8) within group (order by p.secs) filter (where not p.signed) as guest_p80,
           percentile_cont(0.9) within group (order by p.secs) filter (where not p.signed) as guest_p90,
           avg(p.secs) filter (where not p.signed)        as guest_avg
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
         round(b.p80_seconds)::int, round(b.p90_seconds)::int,
         b.signed_browsers::int,
         coalesce(round(b.signed_median), 0)::int, coalesce(round(b.signed_p80), 0)::int,
         coalesce(round(b.signed_p90), 0)::int,    coalesce(round(b.signed_avg), 0)::int,
         b.guest_browsers::int,
         coalesce(round(b.guest_median), 0)::int,  coalesce(round(b.guest_p80), 0)::int,
         coalesce(round(b.guest_p90), 0)::int,     coalesce(round(b.guest_avg), 0)::int
  from b join s using (day)
  order by b.day;
$$;

revoke all on function public.site_visit_daily_v2(integer, text, text) from public, anon, authenticated;
grant execute on function public.site_visit_daily_v2(integer, text, text) to service_role;

create or replace function public.site_visit_by_country(
  p_days integer default 30,
  p_tz   text    default 'Asia/Taipei',
  p_top  integer default 5
) returns table (
  day      date,
  country  text,
  visits   integer,
  browsers integer
)
language sql
stable
set search_path = public
as $$
  with w as (
    select (started_at at time zone p_tz)::date as day,
           coalesce(nullif(country, ''), '??') as country,
           visitor_id
    from public.site_visits
    where env = 'production'
      and (started_at at time zone p_tz)::date > (now() at time zone p_tz)::date - greatest(least(p_days, 366), 1)
  ),
  top as (
    select country from w
    group by 1
    order by count(distinct visitor_id) desc, country
    limit greatest(least(p_top, 10), 1)
  )
  select w.day,
         case when w.country in (select country from top) then w.country else 'other' end as country,
         count(*)::int                     as visits,
         count(distinct w.visitor_id)::int as browsers
  from w
  group by 1, 2
  order by 1, 2;
$$;

revoke all on function public.site_visit_by_country(integer, text, integer) from public, anon, authenticated;
grant execute on function public.site_visit_by_country(integer, text, integer) to service_role;

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
    select user_id,
           coalesce(nullif(metadata->>'provider', ''), 'unknown') as provider,
           (created_at at time zone p_tz)::date as day
    from public.activity_logs
    where event = 'login'
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

commit;

-- After running, all three must be false:
--   select has_function_privilege('anon', 'public.site_visit_daily_v2(integer, text, text)', 'execute');
--   select has_function_privilege('anon', 'public.site_visit_by_country(integer, text, integer)', 'execute');
--   select has_function_privilege('anon', 'public.site_signins_daily(integer, text)', 'execute');
