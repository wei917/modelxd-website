-- supabase/103_private_xtalk_games.sql — XTalk game results stop being
-- world-readable.
--
-- 56 opened xtalk_games and xtalk_game_players to everyone, reasoning that
-- "this is a leaderboard, and a board nobody can read is not a board." The
-- leaderboard never needed it: /api/xboard/werewolf reads with the service key,
-- which bypasses RLS. What the policy did in practice was publish every game's
-- user_id and full transcript to anyone holding the publishable key (probed
-- live Sep 14). XTalk is private (owner, Sep 14).
--
-- Nothing else reads these tables from a browser. Writes go through the service
-- key (/api/xtalk/game, /api/xtalk/werewolf). Live rooms are a different table,
-- xtalk_sessions, which was already private, and the session API enforces
-- ownership on load.
--
-- xtalk_games gets an owner-read policy so a player could reopen their own
-- results. xtalk_game_players carries no user_id and is read only by the
-- leaderboard, so it needs no read policy at all.
--
-- Run by hand, after 102. Dev and prod share this database. Safe to re-run.

begin;

drop policy if exists "xtalk games: public read"   on public.xtalk_games;
drop policy if exists "xtalk players: public read" on public.xtalk_game_players;

drop policy if exists "xtalk games: owner read" on public.xtalk_games;
create policy "xtalk games: owner read" on public.xtalk_games
  for select using (auth.uid() = user_id);

commit;

-- Verify (read-only): no SELECT policy with qual = 'true' should remain.
--   select tablename, policyname, cmd, qual from pg_policies
--    where schemaname = 'public' and tablename in ('xtalk_games', 'xtalk_game_players')
--    order by 1, 2;
