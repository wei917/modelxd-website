-- supabase/145_site_visit_time_zone.sql — each visit keeps the visitor's
-- own time zone.
--
-- Owner, Oct 20: "you should record timezone, not UTC", then "add a new
-- column if the current table doesn't support timezoned timestamp". It does
-- not: started_at and last_seen_at are timestamptz, which keeps the moment
-- but not the zone (Postgres turns any zone into UTC on the way in and
-- forgets it). So the zone is saved beside them: an IANA name, from the
-- visitor's browser (Intl...resolvedOptions().timeZone), or, when the browser
-- sends none, from Vercel's guess for the connection (x-vercel-ip-timezone).
-- The local time is `started_at at time zone time_zone`, daylight saving
-- included.
--
-- 1. site_visits.time_zone (text, null for visits before this ran; no
--    backfill, docs/SITE-VISITS.md derives theirs from country and city).
-- 2. log_site_visit (109) takes p_time_zone. The first report's zone sticks.
--    A name of the wrong shape is stored as null rather than refused, so a
--    visit is never lost over its zone; /api/visit also checks the name is a
--    real zone before sending it.
--
-- The old log_site_visit is dropped first: two versions would make
-- PostgREST's named call ambiguous. /api/visit retries without p_time_zone
-- when the function does not take it yet, so the code may ship before or
-- after this runs.
--
-- Run by hand. Dev and prod share this database. Needs 109. Safe to re-run.
-- Proven on PGlite before it was handed over.

begin;

alter table public.site_visits add column if not exists time_zone text;
alter table public.site_visits drop constraint if exists site_visits_time_zone_check;
alter table public.site_visits add constraint site_visits_time_zone_check
  check (time_zone is null or (length(time_zone) <= 64 and time_zone ~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)*$'));

drop function if exists public.log_site_visit(uuid, uuid, text, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, integer, integer);

-- As in 109, plus the zone. The first report inserts the visit; later ones
-- only move it forward. Time and pages never go down, the start, the source
-- and the zone are never rewritten, and the first signed-in user sticks. A
-- report for a known visit id from a different visitor changes nothing.
create or replace function public.log_site_visit(
  p_id             uuid,
  p_visitor_id     uuid,
  p_env            text,
  p_user_id        uuid    default null,
  p_host           text    default null,
  p_landing        text    default null,
  p_referrer       text    default null,
  p_gclid          text    default null,
  p_gbraid         text    default null,
  p_wbraid         text    default null,
  p_utm_source     text    default null,
  p_utm_medium     text    default null,
  p_utm_campaign   text    default null,
  p_utm_term       text    default null,
  p_utm_content    text    default null,
  p_country        text    default null,
  p_city           text    default null,
  p_device         text    default null,
  p_pages          integer default 1,
  p_active_seconds integer default 0,
  p_time_zone      text    default null
) returns void
language sql
set search_path = public
as $$
  insert into public.site_visits as v (
    id, visitor_id, user_id, env, host, landing, referrer,
    gclid, gbraid, wbraid, utm_source, utm_medium, utm_campaign, utm_term, utm_content,
    country, city, device, pages, active_seconds, time_zone
  ) values (
    p_id, p_visitor_id, p_user_id, p_env, p_host, p_landing, p_referrer,
    p_gclid, p_gbraid, p_wbraid, p_utm_source, p_utm_medium, p_utm_campaign, p_utm_term, p_utm_content,
    p_country, p_city, p_device, greatest(p_pages, 1), greatest(p_active_seconds, 0),
    case when length(p_time_zone) <= 64 and p_time_zone ~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)*$' then p_time_zone end
  )
  on conflict (id) do update set
    pages          = greatest(v.pages, excluded.pages),
    active_seconds = greatest(v.active_seconds, excluded.active_seconds),
    user_id        = coalesce(v.user_id, excluded.user_id),
    time_zone      = coalesce(v.time_zone, excluded.time_zone),
    last_seen_at   = now()
  where v.visitor_id = excluded.visitor_id;
$$;

revoke all on function public.log_site_visit(uuid, uuid, text, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.log_site_visit(uuid, uuid, text, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, integer, integer, text)
  to service_role;

commit;

-- After running, this is false and the column is there:
--   select has_function_privilege('anon', 'public.log_site_visit(uuid, uuid, text, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, integer, integer, text)', 'execute');
--   select time_zone from public.site_visits order by started_at desc limit 5;  -- filled once the code ships
