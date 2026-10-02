-- supabase/123_site_ads_accounts.sql — /admin/traffic: what ad visitors did,
-- and how many accounts there are per country.
-- (Applied by the owner on Oct 2, Taiwan time, and checked live: rows for the
-- service key from both functions, 42501 for the publishable key.)
--
-- Owner, Oct 2 (Taiwan), after "still no Japanese users login?" was answered
-- by hand (61 browsers from the Japan ad, 43 stayed 30 s or more since the
-- free chart, 1 pressed LINE, none signed in): "can you add to dashboard?
-- also we need total registered user count in all and each country".
--
-- Two read-only functions, nothing else. Nothing dropped or changed.
--
-- 1. site_ad_funnel(p_days, p_tz, p_country): one row per ad source,
--    'google' (a Google Ads click id) and 'chatgpt' (utm_source=chatgpt).
--    A browser is an ad browser when one of its visits in the window came
--    from an ad; a browser with both counts as google. Over all its visits
--    in the window (the ad visit and any later one):
--      browsers        ad browsers
--      stayed_30s      of them, 30 seconds or more of active time in total
--      tapped          of them, pressed Google or LINE (site_signin_taps, 120)
--      signed_in       of them, had an account on any visit
--      median_seconds  the median of their total active time
--    p_country narrows the visits to one country, as in 117 and 118.
--
-- 2. site_registered_users(p_days, p_tz): accounts per country, from
--    profiles (one row per account; none are anonymous, checked Oct 2: 90
--    users, 90 profiles, 0 anonymous). users = every account, new_users =
--    made inside the window. The country is profiles.country, where the
--    account was LAST seen (/api/credits/ensure-daily writes Vercel's geo
--    header), not where it signed up; '??' when never recorded.
--
-- Both run as their caller and are for server code holding the service key:
-- anon and authenticated are revoked by name (pitfall 15).
--
-- Run by hand. Dev and prod share this database. Needs 109 and 120. Safe to
-- re-run. Proven on PGlite before it was handed over.

begin;

create or replace function public.site_ad_funnel(
  p_days    integer default 30,
  p_tz      text    default 'Asia/Taipei',
  p_country text    default null
) returns table (
  source         text,
  browsers       integer,
  stayed_30s     integer,
  tapped         integer,
  signed_in      integer,
  median_seconds integer
)
language sql
stable
set search_path = public
as $$
  with edge as (
    select (now() at time zone p_tz)::date - greatest(least(p_days, 366), 1) as day
  ),
  win as (
    select v.visitor_id, v.user_id, v.active_seconds,
           (v.gclid is not null or v.gbraid is not null or v.wbraid is not null) as google,
           (v.utm_source = 'chatgpt') as chatgpt
    from public.site_visits v, edge
    where v.env = 'production'
      and (p_country is null or v.country = p_country)
      and (v.started_at at time zone p_tz)::date > edge.day
  ),
  per_browser as (
    select visitor_id,
           case when bool_or(google) then 'google' when bool_or(chatgpt) then 'chatgpt' end as source,
           sum(active_seconds) as secs,
           bool_or(user_id is not null) as signed
    from win
    group by 1
  ),
  taps as (
    select distinct t.visitor_id
    from public.site_signin_taps t, edge
    where t.env = 'production' and t.visitor_id is not null
      and (t.created_at at time zone p_tz)::date > edge.day
  )
  select b.source,
         count(*)::int,
         (count(*) filter (where b.secs >= 30))::int,
         (count(*) filter (where t.visitor_id is not null))::int,
         (count(*) filter (where b.signed))::int,
         coalesce(round(percentile_cont(0.5) within group (order by b.secs)), 0)::int
  from per_browser b
  left join taps t using (visitor_id)
  where b.source is not null
  group by 1
  order by 1 desc;
$$;

revoke all on function public.site_ad_funnel(integer, text, text) from public, anon, authenticated;
grant execute on function public.site_ad_funnel(integer, text, text) to service_role;

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
  group by 1
  order by 2 desc, 1;
$$;

revoke all on function public.site_registered_users(integer, text) from public, anon, authenticated;
grant execute on function public.site_registered_users(integer, text) to service_role;

commit;

-- After running, both must be false:
--   select has_function_privilege('anon', 'public.site_ad_funnel(integer, text, text)', 'execute');
--   select has_function_privilege('anon', 'public.site_registered_users(integer, text)', 'execute');
