-- 65: Werewolf rating pool — game results become Bradley-Terry evidence.
--
-- CC (Aug 2): the werewolf board should carry an XD-style score like every
-- other subtype, not a bare win rate. A werewolf game is a TEAM outcome, so
-- it is decomposed into pairwise events: every winning-side model "beats"
-- every losing-side model (2 wolves win → 2×5 = 10 pairs). The pairs land
-- in model_pairwise_wins under mode='werewolf', signal='quality' — the
-- same aggregates the refit already reads. There is no 'value' signal (a
-- game has no price vote) and no stickiness; lib/xdrating.ts fits this
-- pool from quality alone.
--
-- Kept OUT of 'all' like text_search: talking six models into a mislynch
-- is not the skill the duels measure.
--
-- Requires 45 (pipeline). Idempotent: the backfill is delete-then-rebuild.

-- ── Per-game contribution ───────────────────────────────────────────────────
-- Emits the winner×loser pairs and one participation vote per model seat.
-- Human seats have model_id null and contribute nothing.
create or replace function xd_werewolf_contribution(p_game_id uuid, p_sign numeric)
returns void language plpgsql as $$
declare w record; l record; p record;
begin
  for p in select model_id from xtalk_game_players
           where game_id = p_game_id and model_id is not null loop
    perform xd_add_stats('werewolf', p.model_id, p_sign, 0, 0, null);
  end loop;
  for w in select model_id from xtalk_game_players
           where game_id = p_game_id and model_id is not null and won loop
    for l in select model_id from xtalk_game_players
             where game_id = p_game_id and model_id is not null and not won loop
      perform xd_add_win('werewolf', 'quality', w.model_id, l.model_id, 1.0 * p_sign);
    end loop;
  end loop;
end $$;

-- ── Trigger ─────────────────────────────────────────────────────────────────
-- Statement-level with a transition table: the werewolf route inserts the
-- whole roster in ONE statement (app/api/xtalk/werewolf/route.ts), so this
-- fires exactly once per recorded game with every seat visible. A per-row
-- trigger would see half a roster and emit pairs against nobody.
create or replace function xd_werewolf_players_trigger()
returns trigger language plpgsql security definer as $$
declare gid uuid;
begin
  for gid in select distinct game_id from new_rows loop
    -- Un-apply nothing: rosters are insert-once. The rebuild below is the
    -- repair path if a game is ever deleted or re-recorded.
    perform xd_werewolf_contribution(gid, 1);
  end loop;
  return null;
end $$;

drop trigger if exists xd_werewolf_players_aggregate on xtalk_game_players;
create trigger xd_werewolf_players_aggregate
  after insert on xtalk_game_players
  referencing new table as new_rows
  for each statement execute function xd_werewolf_players_trigger();

-- ── Rebuild covers the new pool ─────────────────────────────────────────────
-- 45's nightly xd_rebuild_aggregates() deletes ALL aggregates then replays
-- duels + xcreates; without this redefinition it would silently wipe the
-- werewolf pool every night at 03:00.
create or replace function xd_rebuild_aggregates() returns void
language plpgsql security definer as $$
declare d duels; x xcreates; g record;
begin
  delete from model_pairwise_wins where true;
  delete from model_vote_stats where true;
  for d in select * from duels loop
    perform xd_duel_contribution(d, 1);
  end loop;
  for x in select * from xcreates where chosen_model_id is not null loop
    perform xd_xcreate_contribution(x, 1);
  end loop;
  for g in select distinct game_id from xtalk_game_players loop
    perform xd_werewolf_contribution(g.game_id, 1);
  end loop;
end $$;

-- ── Backfill the games already played ───────────────────────────────────────
do $$
declare g record;
begin
  delete from model_pairwise_wins where mode = 'werewolf';
  delete from model_vote_stats where mode = 'werewolf';
  for g in select distinct game_id from xtalk_game_players loop
    perform xd_werewolf_contribution(g.game_id, 1);
  end loop;
end $$;

-- Verify, then refit:
--   select mode, count(*), sum(wins) from model_pairwise_wins where mode='werewolf' group by 1;
--   select count(*) from model_vote_stats where mode='werewolf';
-- then POST /api/xdrating/refit?force=1 (or the next vote does it).
