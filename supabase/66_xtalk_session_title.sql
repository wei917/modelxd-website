-- 66: optional player-set title for a werewolf session.
--
-- Games are addressable (/xtalk/<id>) and listed in the nav, so they earn a
-- name. Null = show the generated label ("Werewolf · D2 · wolves"); a value
-- is whatever the player typed. Owner-only writes are already covered by the
-- table's "owner all" RLS policy — no new policy needed.
alter table xtalk_sessions add column if not exists title text;
