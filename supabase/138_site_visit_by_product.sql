-- supabase/138_site_visit_by_product.sql — /admin/traffic: browsers per X app.
--
-- Owner, Oct 15, on the "Every day" table: "is that for the entire
-- modelxd.com or just xtell?" (all of it), then "you should have a table to
-- break down or a selector" and "a line chart as well, each line is one
-- xapp".
--
-- site_visit_by_product(p_days, p_tz, p_country): one row per day per
-- product, and one row per product for the whole window (day null: a browser
-- seen on several days counts once there). The product is where the visit
-- LANDED:
--   the xtell. and xcreate. hosts (their own front doors)  xtell, xcreate
--   www's '/' and '/coming-soon' (its password page)        www
--   any other www path, by its first part                  '/xtell…' → xtell,
--                                                          '/xsports…' → xsports,
--                                                          '/xpersona' → xpersona, …
--   no landing recorded                                    unknown
-- A visit that moves on to another app keeps the app it landed on. Each row
-- also carries the time those visits spent (tab in front). p_country narrows
-- to one country, as everywhere else. Production rows only, so the owner's
-- browsers (env 'internal', 129) are out.
--
-- Purely additive: one new function, nothing dropped or changed. Read only,
-- runs as its caller, for server code holding the service key: anon and
-- authenticated are revoked by name (pitfall 15). Until it has been run the
-- page shows a note where the chart goes.
--
-- Run by hand. Dev and prod share this database. Needs 109. Safe to re-run.
-- Proven on PGlite before it was handed over.

begin;

create or replace function public.site_visit_by_product(
  p_days    integer default 30,
  p_tz      text    default 'Asia/Taipei',
  p_country text    default null
) returns table (
  day           date,
  product       text,
  visits        integer,
  browsers      integer,
  total_seconds bigint
)
language sql
stable
set search_path = public
as $$
  with w as (
    select (v.started_at at time zone p_tz)::date as day,
           case
             when v.host like 'xtell.%'                 then 'xtell'
             when v.host like 'xcreate.%'               then 'xcreate'
             when v.landing is null                     then 'unknown'
             when v.landing in ('/', '/coming-soon')    then 'www'
             else coalesce(nullif(lower(split_part(v.landing, '/', 2)), ''), 'www')
           end as product,
           v.visitor_id, v.active_seconds
    from public.site_visits v
    where v.env = 'production'
      and (p_country is null or v.country = p_country)
      and (v.started_at at time zone p_tz)::date > (now() at time zone p_tz)::date - greatest(least(p_days, 366), 1)
  )
  select day, product, count(*)::int, count(distinct visitor_id)::int, sum(active_seconds)::bigint
  from w
  group by 1, 2
  union all
  select null::date, product, count(*)::int, count(distinct visitor_id)::int, sum(active_seconds)::bigint
  from w
  group by 2
  order by 1 nulls last, 4 desc, 2;
$$;

revoke all on function public.site_visit_by_product(integer, text, text) from public, anon, authenticated;
grant execute on function public.site_visit_by_product(integer, text, text) to service_role;

commit;

-- After running, this must be false:
--   select has_function_privilege('anon', 'public.site_visit_by_product(integer, text, text)', 'execute');
