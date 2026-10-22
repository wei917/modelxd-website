-- 150_xcreate_music_pool.sql — X創作's 音樂 picks rate in the 'music' pool
-- (owner, Oct 22: "in Audio tab, we can actually generate speech or music.
-- should we split them into two tabs?", then "let's do it for both XDuel and
-- XCreate").
--
-- 音訊 became two tabs, 語音 and 音樂, in XDuel and X創作. X創作 can now make
-- songs (Lyria 3.5, ElevenLabs Music 2.5): an 'audio' row whose first slot's
-- recipe (slots->0->options->>mode) is text_to_music. A pick in the studio is
-- a rating signal (xd_xcreate_contribution, 64) in the pool xd_xcreate_pool
-- names, which was the row's mode alone, so a song pick would have landed in
-- 'audio', XBoard's Speech board. It now goes to 'music', the pool XDuel's
-- music duels use (146).
--
-- No reversal step (62 and 64 needed one): no X創作 music run existed before
-- this (checked Oct 22: 0 audio rows with that recipe), so no contribution
-- changes pool. The guard stops if a picked music run exists when it runs
-- (that pick would have to be reversed under 'audio' first). Run it before
-- the code that adds the 音樂 tab, or before the first music pick.
-- Idempotent. Run by hand; dev and prod share this database.

do $$
begin
  if exists (
    select 1 from xcreates
     where mode = 'audio' and slots->0->'options'->>'mode' = 'text_to_music'
       and chosen_model_id is not null
  ) then
    raise exception 'an X創作 music run already has a pick: reverse it under the old pool before changing xd_xcreate_pool';
  end if;
end $$;

create or replace function xd_xcreate_pool(x xcreates) returns text
language sql immutable as $$
  select case
    when x.mode = 'audio' and x.slots->0->'options'->>'mode' = 'text_to_music' then 'music'
    when x.search_mode = 'all' then x.mode || '_search'
    else x.mode
  end
$$;

comment on function xd_xcreate_pool(xcreates) is
  'Rating pool for an X創作 pick. All-search runs rate apart from the same mode without search; music runs (audio + first slot recipe text_to_music) in their own pool, as XDuel''s music duels.';

-- Check after running (no row changes pool):
--   select xd_xcreate_pool(x), count(*) from xcreates x where x.mode = 'audio' group by 1;
--   -> only 'audio' until the first X創作 song.
