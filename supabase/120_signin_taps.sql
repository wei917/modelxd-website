-- supabase/120_signin_taps.sql — taps on the sign-in buttons.
--
-- Owner, Oct 1: "still no one signed in Japan LINE. is there any way to check
-- if people tried it but failed or simply no one tried to sign in?", then
-- "add counter on tap google or line login". A completed sign-in is in
-- activity_logs and a failure that comes back is in the callback's logs, but
-- someone who taps LINE and gives up on LINE's own page never comes back to
-- us. A tap is counted the moment the button is pressed, before the browser
-- leaves for Google or LINE.
--
-- One row per tap:
--   provider    what the button starts, in activity_logs' words: 'google',
--               'custom:line-tw', 'custom:line-jp'
--   visitor_id  the modelxd_vid cookie, as in site_visits (null before the
--               first visit report has set it)
--   host, path  where the button was pressed, no query string
--   country     Vercel's geo header. No IP address is stored.
--   env         VERCEL_ENV, as in site_visits. Reports filter on 'production'.
--
-- Written by /api/visit (a tap report) with the service key, under the visit
-- log's rules: nothing from the EEA, the UK or Switzerland, nothing from
-- crawlers. RLS is on with no policies, and anon/authenticated are revoked
-- from the table and the function by name (pitfalls 15 and 16).
--
-- site_signin_taps_window(p_days, p_tz, p_country): taps and browsers per
-- provider over the window, for /admin/traffic. p_country narrows it to one
-- country, like site_visit_daily_v2 (117); null is every country. Owner,
-- Oct 1: "you will be able to log for different counties and markets,
-- right?" Each row also keeps the host (the front door) and the path.
--
-- Run by hand. Dev and prod share this database. Safe to re-run. Proven on
-- PGlite before it was handed over.

begin;

create table if not exists public.site_signin_taps (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  env         text not null,
  provider    text not null,
  visitor_id  uuid,
  host        text,
  path        text,
  country     text
);

create index if not exists site_signin_taps_created on public.site_signin_taps (created_at desc);

alter table public.site_signin_taps enable row level security;
revoke all on public.site_signin_taps from public, anon, authenticated;
grant select, insert on public.site_signin_taps to service_role;

create or replace function public.site_signin_taps_window(
  p_days    integer default 30,
  p_tz      text    default 'Asia/Taipei',
  p_country text    default null
) returns table (
  provider text,
  taps     integer,
  browsers integer
)
language sql
stable
set search_path = public
as $$
  select t.provider, count(*)::int, count(distinct t.visitor_id)::int
  from public.site_signin_taps t
  where t.env = 'production'
    and (p_country is null or t.country = p_country)
    and (t.created_at at time zone p_tz)::date > (now() at time zone p_tz)::date - greatest(least(p_days, 366), 1)
  group by 1
  order by 1;
$$;

revoke all on function public.site_signin_taps_window(integer, text, text) from public, anon, authenticated;
grant execute on function public.site_signin_taps_window(integer, text, text) to service_role;

commit;

-- After running, all three must be false:
--   select has_table_privilege('anon', 'public.site_signin_taps', 'insert');
--   select has_table_privilege('anon', 'public.site_signin_taps', 'select');
--   select has_function_privilege('anon', 'public.site_signin_taps_window(integer, text, text)', 'execute');
