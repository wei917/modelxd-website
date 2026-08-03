-- 61_duel_search_flag.sql
--
-- Record whether a duel was run with web search allowed.
--
-- This is deliberately a column and NOT derived from the slots. "Search was
-- allowed and no model chose to use it" and "search was off" produce
-- identical slot data, and those two cases are the interesting comparison:
-- given permission, does a model know when NOT to search? Deriving the flag
-- would erase exactly the signal worth keeping.
--
-- The per-model tally rides in the existing `slots` jsonb (slots[i].searches)
-- and needs no schema change.
--
-- Ratings stay in ONE pool for now — splitting Elo across two pools this
-- early makes both too noisy to mean anything. But the split can be made
-- retroactively at any time as long as this flag exists from the start,
-- which is the whole reason to add it before deciding.
--
-- Idempotent.

alter table duels
  add column if not exists search boolean not null default false;

comment on column duels.search is
  'Web search was ALLOWED for this duel (match-level, text mode only). Whether any model actually searched is slots[i].searches.';

-- Partial index: search duels are the minority and are what any split-pool
-- or restraint query filters on.
create index if not exists duels_search_idx on duels (created_at desc) where search;

-- ── verify ──────────────────────────────────────────────────────────────────

select search, count(*)
  from duels
 group by search;
