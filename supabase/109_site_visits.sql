-- supabase/109_site_visits.sql — the visit log: how long people stay, and
-- which ad or link brought them.
--
-- Owner, Sep 27: see which visitors and users come from Google Ads, and how
-- long people stay on the site. Nothing measured either before this: Vercel
-- Analytics counts page views, profiles.last_seen_at moves once a day, and
-- activity_logs holds logins only.
--
-- One row per visit: one browser tab's stay, and a new visit after 30 minutes
-- without input (app/components/VisitTracker.tsx). The tab reports as it goes
-- (at the start, every minute while in front, when hidden or closed), so a
-- visit that ends abruptly still has its time up to the last report.
--
--   visitor_id      the modelxd_vid cookie (first party, one year, shared by
--                   the three front doors). Links one browser's visits, so a
--                   sign-up on a later visit traces back to the ad that first
--                   brought that browser.
--   user_id         set once the visitor is signed in during the visit.
--   active_seconds  time with the tab in front, pausing after 5 minutes
--                   without input.
--   host, landing   where the visit started: host and path, no query string.
--   referrer        the referring site's host only.
--   gclid, gbraid, wbraid   Google Ads click ids (auto-tagging); utm_* the
--                   campaign tags on the landing URL.
--   country, city   Vercel's geo headers. No IP address is stored.
--   env             VERCEL_ENV of the deployment that logged it: 'production',
--                   'preview' (dev.modelxd.com) or 'development' (localhost).
--                   Reports filter on 'production'.
--
-- Nothing is logged in the EEA, the UK or Switzerland (lib/consent.ts), nor
-- for crawlers.
--
-- Written only through log_site_visit() by /api/visit with the service key.
-- RLS is on with no policies, and anon/authenticated are revoked from the
-- table AND from the function by name (pitfalls 15 and 16). Reports:
-- docs/SITE-VISITS.md.
--
-- Run by hand. Dev and prod share this database. Safe to re-run.

begin;

create table if not exists public.site_visits (
  id              uuid primary key,                -- minted by the tab
  visitor_id      uuid not null,
  user_id         uuid references auth.users(id) on delete cascade,
  env             text not null,
  host            text,
  landing         text,
  referrer        text,
  gclid           text,
  gbraid          text,
  wbraid          text,
  utm_source      text,
  utm_medium      text,
  utm_campaign    text,
  utm_term        text,
  utm_content     text,
  country         text,
  city            text,
  device          text,                            -- 'desktop' | 'mobile' | 'tablet'
  pages           integer not null default 1,
  active_seconds  integer not null default 0,
  started_at      timestamptz not null default now(),
  last_seen_at    timestamptz not null default now()
);

create index if not exists site_visits_started on public.site_visits (started_at desc);
create index if not exists site_visits_visitor on public.site_visits (visitor_id, started_at);
create index if not exists site_visits_user    on public.site_visits (user_id) where user_id is not null;

alter table public.site_visits enable row level security;
revoke all on public.site_visits from public, anon, authenticated;

-- One call per report. The first report inserts the visit; later ones only
-- move it forward. Time and pages never go down (a late report can land after
-- a newer one), the start and the source are never rewritten, and the first
-- signed-in user sticks. A report for a known visit id from a different
-- visitor changes nothing.
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
  p_active_seconds integer default 0
) returns void
language sql
set search_path = public
as $$
  insert into public.site_visits as v (
    id, visitor_id, user_id, env, host, landing, referrer,
    gclid, gbraid, wbraid, utm_source, utm_medium, utm_campaign, utm_term, utm_content,
    country, city, device, pages, active_seconds
  ) values (
    p_id, p_visitor_id, p_user_id, p_env, p_host, p_landing, p_referrer,
    p_gclid, p_gbraid, p_wbraid, p_utm_source, p_utm_medium, p_utm_campaign, p_utm_term, p_utm_content,
    p_country, p_city, p_device, greatest(p_pages, 1), greatest(p_active_seconds, 0)
  )
  on conflict (id) do update set
    pages          = greatest(v.pages, excluded.pages),
    active_seconds = greatest(v.active_seconds, excluded.active_seconds),
    user_id        = coalesce(v.user_id, excluded.user_id),
    last_seen_at   = now()
  where v.visitor_id = excluded.visitor_id;
$$;

revoke all on function public.log_site_visit(uuid, uuid, text, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.log_site_visit(uuid, uuid, text, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, integer, integer)
  to service_role;

commit;

-- After running, both must be false:
--   select has_table_privilege('anon', 'public.site_visits', 'select'),
--          has_function_privilege('anon', 'public.log_site_visit(uuid, uuid, text, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, integer, integer)', 'execute');
