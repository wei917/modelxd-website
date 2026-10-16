-- supabase/139_site_page_views.sql — which page, and which X先知 room, a
-- visit spends its time in.
--
-- Owner, Oct 15, after a visitor spent 34 minutes on X先知 and the log could
-- not say where: "should we record which page people visit?", then "record
-- which page so we can tell which temple they enter".
--
-- site_page_views: one row per page a visit opens, with the time spent on it
-- (tab in front, as for the visit). The page is a short key, never a full
-- URL: an X先知 room is 'xtell/<room>' (the street is 'xtell'), anything else
-- its path with ids masked ('/xcreate', '/xsports/mlb', '/xtalk/:id'). No
-- query string, nothing typed, no IP. Written by /api/visit with the visit's
-- report, under the visit log's rules (production rows only in reports; the
-- owner's browsers are 'internal', 129; nothing from the EEA, the UK or
-- Switzerland; no crawlers). The privacy page already says the visit log
-- records "the pages you open".
--
-- log_page_view(): the first report of a page view inserts it, later ones
-- only raise its time, like log_site_visit() (109).
-- site_page_window(p_days, p_tz, p_country): per page, views, browsers and
-- time over the window, for /admin/traffic.
-- site_mark_browser_internal() (129) now also flips the browser's page views.
--
-- Service key only: the table and the functions are revoked from anon and
-- authenticated by name (pitfalls 15 and 16).
--
-- Run by hand. Dev and prod share this database. Needs 109 and 129. Safe to
-- re-run. Proven on PGlite before it was handed over.

begin;

create table if not exists public.site_page_views (
  id              uuid primary key,                -- minted by the tab
  visit_id        uuid not null,                   -- site_visits.id
  visitor_id      uuid not null,
  env             text not null,
  host            text,
  page            text not null,
  country         text,
  active_seconds  integer not null default 0,
  started_at      timestamptz not null default now(),
  last_seen_at    timestamptz not null default now()
);

create index if not exists site_page_views_started on public.site_page_views (started_at desc);
create index if not exists site_page_views_visitor on public.site_page_views (visitor_id, started_at);

alter table public.site_page_views enable row level security;
revoke all on public.site_page_views from public, anon, authenticated;
grant select, insert, update on public.site_page_views to service_role;

create or replace function public.log_page_view(
  p_id             uuid,
  p_visit_id       uuid,
  p_visitor_id     uuid,
  p_env            text,
  p_host           text,
  p_page           text,
  p_country        text,
  p_active_seconds integer
) returns void
language sql
set search_path = public
as $$
  insert into public.site_page_views as v (id, visit_id, visitor_id, env, host, page, country, active_seconds)
  values (p_id, p_visit_id, p_visitor_id, p_env, p_host, p_page, p_country, greatest(coalesce(p_active_seconds, 0), 0))
  on conflict (id) do update set
    active_seconds = greatest(v.active_seconds, excluded.active_seconds),
    last_seen_at   = now()
  where v.visitor_id = excluded.visitor_id;
$$;

revoke all on function public.log_page_view(uuid, uuid, uuid, text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.log_page_view(uuid, uuid, uuid, text, text, text, text, integer) to service_role;

create or replace function public.site_page_window(
  p_days    integer default 30,
  p_tz      text    default 'Asia/Taipei',
  p_country text    default null
) returns table (
  page          text,
  views         integer,
  browsers      integer,
  total_seconds bigint
)
language sql
stable
set search_path = public
as $$
  select p.page, count(*)::int, count(distinct p.visitor_id)::int, sum(p.active_seconds)::bigint
  from public.site_page_views p
  where p.env = 'production'
    and (p_country is null or p.country = p_country)
    and (p.started_at at time zone p_tz)::date > (now() at time zone p_tz)::date - greatest(least(p_days, 366), 1)
  group by 1
  order by 3 desc, 2 desc, 1;
$$;

revoke all on function public.site_page_window(integer, text, text) from public, anon, authenticated;
grant execute on function public.site_page_window(integer, text, text) to service_role;

-- 129's function, now with the page views too.
create or replace function public.site_mark_browser_internal(p_visitor_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer := 0;
  m integer;
begin
  update public.site_visits      set env = 'internal' where env = 'production' and visitor_id = p_visitor_id;
  get diagnostics m = row_count; n := n + m;
  update public.site_signin_taps set env = 'internal' where env = 'production' and visitor_id = p_visitor_id;
  get diagnostics m = row_count; n := n + m;
  update public.xtell_shares     set env = 'internal' where env = 'production' and visitor_id = p_visitor_id;
  get diagnostics m = row_count; n := n + m;
  update public.site_page_views  set env = 'internal' where env = 'production' and visitor_id = p_visitor_id;
  get diagnostics m = row_count; n := n + m;
  return n;
end;
$$;

revoke all on function public.site_mark_browser_internal(uuid) from public, anon, authenticated;
grant execute on function public.site_mark_browser_internal(uuid) to service_role;

commit;

-- After running, all four must be false:
--   select has_table_privilege('anon', 'public.site_page_views', 'select');
--   select has_function_privilege('anon', 'public.log_page_view(uuid, uuid, uuid, text, text, text, text, integer)', 'execute');
--   select has_function_privilege('anon', 'public.site_page_window(integer, text, text)', 'execute');
--   select has_function_privilege('anon', 'public.site_mark_browser_internal(uuid)', 'execute');
