-- supabase/119_xtell_personality.sql — a visitor's own personality type for
-- XTell (owner, Sep 30: "we allow users to enter in the profile page, and
-- optionally give temple master to use").
--
--   xtell_personality  one row per user: the four letters people know as
--                      "MBTI" (most from the free 16Personalities test), an
--                      optional -A / -T, and where it came from. Typed in on
--                      the XTell account page; viewable, editable and
--                      deletable by its owner (through /api/xtell/personality);
--                      attached to a reading only when the visitor ticks the
--                      box in that room (lib/xtell-personality.ts).
--
-- `source` is 'self' for a type the visitor typed in. 'test' and `scores`
-- are kept for a test of our own later (public-domain IPIP questions), so
-- that a combined reading can tell "INFJ, typed in" from "J, but only just".
--
-- Access: server only, like xtell_profiles (109). RLS on, no policies, and
-- the table revoked from public, anon and authenticated BY NAME (pitfall 15:
-- Supabase's default privileges grant new tables to both). The route checks
-- the session and passes that user's id.
--
-- Run by hand. Dev and prod share this database. Safe to re-run. Before it
-- runs, /api/xtell/personality answers 503 and the account page hides the
-- section.

begin;

create table if not exists public.xtell_personality (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  type        text not null check (type ~ '^[EI][SN][TF][JP](-[AT])?$'),
  source      text not null default 'self' check (source in ('self', 'test')),
  scores      jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.xtell_personality enable row level security;
revoke all on table public.xtell_personality from public, anon, authenticated;
grant select, insert, update, delete on table public.xtell_personality to service_role;

commit;

-- Checks (run after; every line should be false):
--   select has_table_privilege('anon', 'public.xtell_personality', 'select');
--   select has_table_privilege('authenticated', 'public.xtell_personality', 'select');
--   select has_table_privilege('authenticated', 'public.xtell_personality', 'insert');
-- And with the publishable key: GET /rest/v1/xtell_personality → 401/42501.
