-- supabase/122_xtell_votes_shares.sql — 👍 / 👎 on a teacher's answer, and a
-- log of presses in XTell's share dialogs (owner, Oct 1: "add thumb up and
-- thumb down for each response", "its own table or combine with share?",
-- "can we also log what type of share?").
--
--   xtell_answer_votes  one row per person per answer: the visit, the
--                       question (qid) and the teacher (model) it went to,
--                       the temple, +1 or -1. A changed vote replaces the
--                       row; a vote taken back deletes it. Written by
--                       /api/xtell/vote once it has found that answer in the
--                       caller's own visit, and read back by the same route,
--                       the caller's own votes only.
--   xtell_shares        one row per press on a share dialog's buttons: what
--                       was shared (an answer, today's fortune, the almanac,
--                       a cookie, tarot cards, a 籤), from which temple, by
--                       which teacher when it is an answer, how (save,
--                       download, share, copy) and whether the share sheet
--                       was completed or closed. The app picked in the sheet
--                       is never known to the page. Written by /api/visit
--                       under the visit log's rules: no crawlers, nothing
--                       that needs consent, no IP address.
--
-- Kinds and temples are checked by shape, not by list, so a new room's share
-- button needs no migration (lib/xtell-feedback.ts holds the list).
--
-- A vote outlives the visit and the account it came from as a count only:
-- reading_id and user_id become null when either is deleted, so the totals
-- on /admin/traffic do not drop when someone clears their history, and what
-- remains says nothing about who.
--
-- Access: server only. RLS on, no policies, both tables and both functions
-- revoked from public, anon and authenticated BY NAME (pitfalls 15 and 16).
--
-- xtell_vote_window(p_days, p_tz, p_country) and
-- xtell_share_window(p_days, p_tz, p_country): the counts over the range for
-- /admin/traffic, like site_signin_taps_window (120). A vote counts on the
-- day it was last set. Production only.
--
-- Run by hand. Dev and prod share this database. Safe to re-run. Before it
-- runs, /api/xtell/vote answers 503 (the room hides the buttons), share
-- presses are dropped, and /admin/traffic leaves the two cards out.

begin;

create table if not exists public.xtell_answer_votes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete set null,
  reading_id  uuid references public.xtell_readings(id) on delete set null,
  qid         text not null check (qid ~* '^[0-9a-f-]{36}$'),
  model_id    text not null check (model_id ~* '^[0-9a-f-]{36}$'),
  temple      text not null check (temple ~ '^[a-z]{2,20}$'),
  vote        smallint not null check (vote in (-1, 1)),
  env         text not null,
  country     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- One vote per person per answer (the upsert's conflict target).
create unique index if not exists xtell_answer_votes_one
  on public.xtell_answer_votes (user_id, reading_id, qid, model_id);
create index if not exists xtell_answer_votes_updated on public.xtell_answer_votes (updated_at desc);

alter table public.xtell_answer_votes enable row level security;
revoke all on table public.xtell_answer_votes from public, anon, authenticated;
grant select, insert, update, delete on table public.xtell_answer_votes to service_role;

create table if not exists public.xtell_shares (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  env         text not null,
  kind        text not null check (kind ~ '^[a-z]{2,20}$'),
  temple      text check (temple ~ '^[a-z]{2,20}$'),
  model_id    text check (model_id ~* '^[0-9a-f-]{36}$'),
  method      text not null check (method in ('save', 'download', 'share', 'copy')),
  outcome     text not null check (outcome in ('done', 'cancelled', 'failed')),
  visitor_id  uuid,
  host        text,
  path        text,
  country     text
);

create index if not exists xtell_shares_created on public.xtell_shares (created_at desc);

alter table public.xtell_shares enable row level security;
revoke all on table public.xtell_shares from public, anon, authenticated;
grant select, insert on table public.xtell_shares to service_role;

create or replace function public.xtell_vote_window(
  p_days    integer default 30,
  p_tz      text    default 'Asia/Taipei',
  p_country text    default null
) returns table (
  temple   text,
  model_id text,
  up       integer,
  down     integer,
  people   integer
)
language sql
stable
set search_path = public
as $$
  select v.temple, v.model_id,
         count(*) filter (where v.vote = 1)::int,
         count(*) filter (where v.vote = -1)::int,
         count(distinct v.user_id)::int
  from public.xtell_answer_votes v
  where v.env = 'production'
    and (p_country is null or v.country = p_country)
    and (v.updated_at at time zone p_tz)::date > (now() at time zone p_tz)::date - greatest(least(p_days, 366), 1)
  group by 1, 2
  order by 1, 2;
$$;

create or replace function public.xtell_share_window(
  p_days    integer default 30,
  p_tz      text    default 'Asia/Taipei',
  p_country text    default null
) returns table (
  kind     text,
  temple   text,
  method   text,
  outcome  text,
  shares   integer,
  browsers integer
)
language sql
stable
set search_path = public
as $$
  select s.kind, s.temple, s.method, s.outcome, count(*)::int, count(distinct s.visitor_id)::int
  from public.xtell_shares s
  where s.env = 'production'
    and (p_country is null or s.country = p_country)
    and (s.created_at at time zone p_tz)::date > (now() at time zone p_tz)::date - greatest(least(p_days, 366), 1)
  group by 1, 2, 3, 4
  order by 1, 2, 3, 4;
$$;

revoke all on function public.xtell_vote_window(integer, text, text) from public, anon, authenticated;
revoke all on function public.xtell_share_window(integer, text, text) from public, anon, authenticated;
grant execute on function public.xtell_vote_window(integer, text, text) to service_role;
grant execute on function public.xtell_share_window(integer, text, text) to service_role;

commit;

-- After running, every line must be false:
--   select has_table_privilege('anon', 'public.xtell_answer_votes', 'select');
--   select has_table_privilege('authenticated', 'public.xtell_answer_votes', 'insert');
--   select has_table_privilege('anon', 'public.xtell_shares', 'insert');
--   select has_table_privilege('authenticated', 'public.xtell_shares', 'select');
--   select has_function_privilege('anon', 'public.xtell_vote_window(integer, text, text)', 'execute');
--   select has_function_privilege('authenticated', 'public.xtell_share_window(integer, text, text)', 'execute');
-- And with the publishable key: GET /rest/v1/xtell_answer_votes and
-- /rest/v1/xtell_shares → 401/42501.
