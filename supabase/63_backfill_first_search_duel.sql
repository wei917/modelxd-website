-- 63_backfill_first_search_duel.sql
--
-- One duel ran with search on BEFORE the route recorded either the duel-level
-- flag (61) or the per-slot tally, so it sits in the database as an ordinary
-- text duel and its rating contribution is still in the 'text' pool — search
-- assisted, competing against answers given from memory. Exactly what 62
-- exists to prevent.
--
-- duel b64e6224-98b5-481f-837c-c646b8f6a143, 2026-08-02 06:27 UTC
--   "What are the three biggest news stories today, August 2 2026?"
--
-- Counts are the ones the run actually reported (visible in the result
-- cards), matched BY MODEL NAME rather than by slot index so a reordering
-- cannot silently attach the wrong number to the wrong model:
--
--   GPT-5.6 Sol             8 searches   $0.4801 total
--   Gemini 3.6 Flash        2            $0.0318
--   GPT-5.6 Luna            5            $0.0992
--   Gemini 3.5 Flash-Lite   2            $0.0293
--
-- `cost` is NOT touched. calcTextCost already included the per-search fees
-- when the duel ran; re-deriving them here would bill the searches twice.
--
-- Setting `search` fires xd_duels_trigger, which (thanks to 62 adding
-- `search` to its change comparison) reverses the contribution out of 'text'
-- and re-applies it under 'text_search'. Run POST /api/xdrating/refit?force=1
-- afterwards to refresh the snapshot.
--
-- Idempotent: the guard skips the row once it is already flagged.

update duels d
   set search = true,
       slots  = (
         select jsonb_agg(
                  case s.value ->> 'name'
                    when 'GPT-5.6 Sol'           then s.value || '{"searches": 8}'::jsonb
                    when 'Gemini 3.6 Flash'      then s.value || '{"searches": 2}'::jsonb
                    when 'GPT-5.6 Luna'          then s.value || '{"searches": 5}'::jsonb
                    when 'Gemini 3.5 Flash-Lite' then s.value || '{"searches": 2}'::jsonb
                    else s.value || '{"searches": 0}'::jsonb
                  end
                  order by s.ordinality
                )
           from jsonb_array_elements(d.slots) with ordinality as s(value, ordinality)
       )
 where d.id = 'b64e6224-98b5-481f-837c-c646b8f6a143'
   and coalesce(d.search, false) = false;

-- ── verify ─────────────────────────────────────────────────────────────────
--
-- Expect: the duel flagged, its four tallies present, and a text_search row
-- set in model_pairwise_wins. 'text' should have shed this duel's pairs.

select id, search,
       (select jsonb_object_agg(s.value ->> 'name', s.value -> 'searches')
          from jsonb_array_elements(slots) s) as tallies
  from duels
 where id = 'b64e6224-98b5-481f-837c-c646b8f6a143';

select mode, signal, count(*) as pairs, sum(wins) as total_wins
  from model_pairwise_wins
 group by mode, signal
 order by mode, signal;
