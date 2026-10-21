-- 147: XGame multiplayer, the foundation (Oct 21, 2026). Applied by the
-- owner on Oct 21 and checked live (CLAUDE.md, migrations). Written as 146;
-- renumbered 147 because XDuel's 146_music_rating_pool.sql took 146 the
-- same day (both are applied).
-- Plan: docs/XGAME-MULTIPLAYER-PLAN.md ("Step 1: chess and 象棋").
--
-- Until now a table had one person, its creator, and the creator's browser
-- could read AND rewrite every column of its own row (policy "xtalk
-- sessions: owner all", migration 57). With two people at a table, a
-- rewrite is cheating against a person (edit the move list, the clock, the
-- winner), so:
--   1. xgame_members: which account sits at which seat. Server only.
--   2. xtalk_sessions.step_until: the lease that lets one request at a time
--      ask a model for a move (used from Texas Hold'em on; unused by
--      chess and 象棋 between two people, which never call a model).
--   3. The browser keeps reading its own rows, renaming them (title) and
--      deleting them, as the menu, the Library and the Werewolf page do
--      today; every other write to xtalk_sessions is the server's.
--
-- Additive except the revokes in 3, which remove writes no page makes
-- (checked Oct 21: the browser's only writes are update {title} in
-- Nav.tsx and WerewolfLive.tsx, and delete in Nav.tsx and WerewolfLive.tsx).

-- 1. Seats belong to accounts.
create table if not exists public.xgame_members (
  table_id   uuid not null references public.xtalk_sessions(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  seat       int  not null check (seat between 0 and 15),
  joined_at  timestamptz not null default now(),
  primary key (table_id, user_id),
  unique (table_id, seat)
);
-- "Games shared with me", newest first (the menu and the Library).
create index if not exists idx_xgame_members_user on public.xgame_members (user_id, joined_at desc);

alter table public.xgame_members enable row level security;
-- No policies: nobody but the server (service role) reads or writes it.
revoke all on public.xgame_members from public, anon, authenticated;
grant all on public.xgame_members to service_role;

-- 2. One request at a time may ask a model (X體育's ai_busy_until pattern).
alter table public.xtalk_sessions add column if not exists step_until timestamptz;

-- 3. The browser may read, rename and delete its own rows; nothing else.
revoke insert, update on public.xtalk_sessions from anon, authenticated;
grant update (title) on public.xtalk_sessions to authenticated;

-- Checks after running (publishable key, signed in as the owner, in the
-- owner's Chrome):
--   update {title} on an own row              -> 200, title changed
--   update {pending: '{}'} on an own row      -> 42501, row unchanged
--   update {winner: 'village'} on an own row  -> 42501
--   insert any row                            -> 42501
--   select xgame_members                      -> 42501
--   select another account's xtalk_sessions   -> [] (RLS, as before)
-- and the menu's rename and delete still work.
