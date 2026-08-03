-- 62_search_rating_pool.sql
--
-- Split search duels into their own rating pool.
--
-- Why not one pool: a search duel and a normal duel measure different
-- things, and the prompt distribution differs too (search questions skew
-- hard toward current events). Mixing them makes the main XDRATING wrong
-- every day it runs. A separate pool with few games is merely imprecise —
-- and imprecise-but-labelled beats precise-looking-but-wrong.
--
-- LMArena reached the same conclusion: Search Arena is its own leaderboard,
-- launched as a separate arena rather than by splitting the main pool later.
--
-- HOW: `mode` is already the partition key of every aggregate table
-- (model_pairwise_wins, model_vote_stats, model_ratings all have it in
-- their primary key), so a search duel simply contributes under the pool
-- 'text_search' instead of 'text'. The Bradley-Terry fit, the triggers and
-- the snapshot need no changes at all — they just see a fourth pool.
--
-- duels.mode STAYS 'text'. It drives quota, the model picker and the UI,
-- none of which should learn about rating pools. Only the rating
-- contribution is re-keyed.
--
-- Requires 61 (duels.search). Idempotent.

-- ── 1. reverse existing search duels under the OLD key ─────────────────────
--
-- Must happen BEFORE the function is replaced, so the reversal is keyed the
-- same way the original contribution was. Reversing afterwards would
-- subtract from 'text_search', a pool that never received them, and leave
-- the phantom in 'text' forever.

do $$
declare d duels;
begin
  for d in select * from duels where search loop
    perform xd_duel_contribution(d, -1);
  end loop;
end $$;

-- ── 2. derive the pool ─────────────────────────────────────────────────────

create or replace function xd_pool(d duels) returns text
language sql immutable as $$
  select case when coalesce(d.search, false) then d.mode || '_search' else d.mode end
$$;

comment on function xd_pool(duels) is
  'Rating pool for a duel. Search duels rate separately from the same mode without search.';

create or replace function xd_duel_contribution(d duels, p_sign numeric)
returns void language plpgsql as $$
declare ids uuid[]; v1_winner uuid; v2_winner uuid; pool text;
begin
  ids := xd_slot_ids(d.slots);
  if array_length(ids, 1) is null or array_length(ids, 1) < 2 then return; end if;

  pool := xd_pool(d);

  v1_winner := xd_safe_uuid(d.vote1_model_id::text);
  v2_winner := xd_safe_uuid(d.vote2_model_id::text);

  if d.vote1 is not null then
    perform xd_apply_signal(pool, 'quality', ids, d.vote1 = 'T', v1_winner, p_sign);
  end if;
  if d.vote2 is not null then
    perform xd_apply_signal(pool, 'value', ids, d.vote2 = 'T', v2_winner, p_sign);
  end if;

  -- Stickiness: legacy rule — vote1 present + non-tie + vote2 present.
  if d.vote1 is not null and d.vote2 is not null and d.vote1 <> 'T'
     and v1_winner is not null
     and exists (select 1 from ai_models m where m.id = v1_winner) then
    perform xd_add_stats(pool, v1_winner, 0, (1 * p_sign)::int,
      case when coalesce(d.vote_changed, false) then 0 else (1 * p_sign)::int end, null);
  end if;

  if p_sign > 0 then
    perform xd_apply_price_labels(pool, d.slots);
  end if;
end $$;

-- ── 3. the trigger must notice `search` changing ───────────────────────────
--
-- It never does today (set once at insert), but if it ever did, the old
-- comparison would skip the re-keying and silently strand the contribution
-- in the wrong pool.

create or replace function xd_duels_trigger() returns trigger
language plpgsql security definer as $$
begin
  if tg_op = 'INSERT' then
    perform xd_duel_contribution(new, 1);
    return new;
  elsif tg_op = 'UPDATE' then
    if (old.vote1, old.vote2, old.vote1_model_id, old.vote2_model_id,
        old.vote_changed, old.slots, old.mode, old.search)
       is distinct from
       (new.vote1, new.vote2, new.vote1_model_id, new.vote2_model_id,
        new.vote_changed, new.slots, new.mode, new.search) then
      perform xd_duel_contribution(old, -1);
      perform xd_duel_contribution(new, 1);
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    perform xd_duel_contribution(old, -1);
    return old;
  end if;
  return null;
end $$;

-- ── 4. re-apply under the new key ──────────────────────────────────────────

do $$
declare d duels;
begin
  for d in select * from duels where search loop
    perform xd_duel_contribution(d, 1);
  end loop;
end $$;

-- ── verify ─────────────────────────────────────────────────────────────────
--
-- Expect text / image / video plus text_search. Any negative or zero-sum row
-- in 'text' would mean the reverse/re-apply went out of order.

select mode, signal, count(*) as pairs, sum(wins) as total_wins
  from model_pairwise_wins
 group by mode, signal
 order by mode, signal;
