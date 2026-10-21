-- 146_music_rating_pool.sql — XDuel's music duels rate in a pool of their
-- own (owner, Oct 21: "do we have music generation models? we should do
-- that duel too", then "do it in one tab").
--
-- A music duel is mode 'audio' with recipe 'text_to_music' (142's column):
-- one 音訊 tab, a Mode row of 語音 / 音樂 (lib/xduel-recipes.ts). Its votes
-- go to the pool 'music' instead of 'audio', so a song is never rated
-- against a reading. Same move as 62's search pool: `mode` is the partition
-- key of every aggregate table, so only the pool function changes; the
-- triggers, the fit and the snapshot just see one more pool.
--
-- No reversal step (62 needed one): no music duel exists before this runs,
-- and every older audio duel keeps the pool it had. Run it before the
-- first music duel is voted on; a vote cast before it lands in 'audio'.
-- Idempotent. Run by hand; dev and prod share this database.

create or replace function xd_pool(d duels) returns text
language sql immutable as $$
  select case
    when coalesce(d.search, false) then d.mode || '_search'
    when d.mode = 'audio' and d.recipe = 'text_to_music' then 'music'
    else d.mode
  end
$$;

comment on function xd_pool(duels) is
  'Rating pool for a duel. Search duels rate apart from the same mode without search; music duels (audio + recipe text_to_music) in their own pool.';

-- Check after running (no rows change):
--   select xd_pool(d), count(*) from duels d where d.mode = 'audio' group by 1;
--   -> only 'audio' until the first music duel.
