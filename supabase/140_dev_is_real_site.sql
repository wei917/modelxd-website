-- supabase/140_dev_is_real_site.sql — dev.modelxd.com counts in every
-- /admin/traffic report, and "Browsers by app" counts every app a visit
-- opened, with the time spent in it.
--
-- Owner, Oct 16, on X體育 users missing from the chart: "are you kidding me?
-- dev.modelxd.com is the main website." Every report counts env
-- 'production', and the visit log took the env from Vercel, which labels
-- dev.modelxd.com 'preview', so the real site's visitors were left out
-- (last 7 days on dev: 43 visits and 181 minutes from 10 browsers that are
-- not the owner's). From now on /api/visit and /api/xtell/vote label by host
-- (lib/visit-env.ts): dev, www and the old xtell./xcreate. addresses are
-- 'production', the owner's browsers there 'internal'.
--
-- 1. Past rows from dev.modelxd.com logged as 'preview' become 'production'
--    (visits, sign-in taps, share presses, page views; answer votes keep no
--    host, and their 'preview' rows came from dev).
-- 2. The owner's browsers and votes among them become 'internal' again
--    (129's rule: any browser that has signed in with an internal account).
-- 3. site_visit_by_product (138), same columns: an app now counts each visit
--    that OPENED it (from its page views, 139), with the time spent in that
--    app; a visit with no page views (before Oct 16) still counts where it
--    landed, with all its time. Owner, the same day: "this is why I want
--    aver time per visit in Browsers by app": total_seconds / visits.
--
-- Nothing is deleted. Service key only, as before (pitfall 15).
--
-- Run by hand. Dev and prod share this database. Needs 109, 120, 122, 129,
-- 138 and 139. Safe to re-run. Proven on PGlite before it was handed over.

begin;

-- 1. dev.modelxd.com is the real site.
update public.site_visits        set env = 'production' where env = 'preview' and host = 'dev.modelxd.com';
update public.site_signin_taps   set env = 'production' where env = 'preview' and host = 'dev.modelxd.com';
update public.xtell_shares       set env = 'production' where env = 'preview' and host = 'dev.modelxd.com';
update public.site_page_views    set env = 'production' where env = 'preview' and host = 'dev.modelxd.com';
update public.xtell_answer_votes set env = 'production' where env = 'preview';

-- 2. The owner's browsers and votes stay out.
select public.site_mark_browser_internal(b.visitor_id)
from (select distinct v.visitor_id
      from public.site_visits v
      join public.site_internal_users i on i.user_id = v.user_id) b;

update public.xtell_answer_votes v set env = 'internal'
where v.env = 'production'
  and exists (select 1 from public.site_internal_users i where i.user_id = v.user_id);

-- 3. Every app a visit opened.
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
  with v as (
    select s.id, s.visitor_id, s.host, s.landing, s.active_seconds,
           (s.started_at at time zone p_tz)::date as day
    from public.site_visits s
    where s.env = 'production'
      and (p_country is null or s.country = p_country)
      and (s.started_at at time zone p_tz)::date > (now() at time zone p_tz)::date - greatest(least(p_days, 366), 1)
  ),
  opened as (
    -- A visit's page views: the app of each page, with its time.
    select v.id as visit_id, v.visitor_id, v.day,
           case
             when p.page = 'xtell' or p.page like 'xtell/%' then 'xtell'
             when p.page in ('/', '/coming-soon')         then 'www'
             else coalesce(nullif(split_part(p.page, '/', 2), ''), 'www')
           end as product,
           p.active_seconds
    from v
    join public.site_page_views p on p.visit_id = v.id and p.env = 'production'
  ),
  landed as (
    -- A visit without page views (before Oct 16): where it landed, all its time.
    select v.id as visit_id, v.visitor_id, v.day,
           case
             when v.host like 'xtell.%'              then 'xtell'
             when v.host like 'xcreate.%'            then 'xcreate'
             when v.landing is null                  then 'unknown'
             when v.landing in ('/', '/coming-soon') then 'www'
             else coalesce(nullif(lower(split_part(v.landing, '/', 2)), ''), 'www')
           end as product,
           v.active_seconds
    from v
    where not exists (select 1 from public.site_page_views p where p.visit_id = v.id and p.env = 'production')
  ),
  w as (
    -- One row per visit per app it opened.
    select x.visit_id, x.visitor_id, x.day, x.product, sum(x.active_seconds) as secs
    from (select * from opened union all select * from landed) x
    group by 1, 2, 3, 4
  )
  select day, product, count(*)::int, count(distinct visitor_id)::int, sum(secs)::bigint
  from w
  group by 1, 2
  union all
  select null::date, product, count(*)::int, count(distinct visitor_id)::int, sum(secs)::bigint
  from w
  group by 2
  order by 1 nulls last, 4 desc, 2;
$$;

revoke all on function public.site_visit_by_product(integer, text, text) from public, anon, authenticated;
grant execute on function public.site_visit_by_product(integer, text, text) to service_role;

commit;

-- After running: no dev.modelxd.com row is left as 'preview', and this is false:
--   select has_function_privilege('anon', 'public.site_visit_by_product(integer, text, text)', 'execute');
--   select count(*) from public.site_visits where env = 'preview' and host = 'dev.modelxd.com';  -- 0
