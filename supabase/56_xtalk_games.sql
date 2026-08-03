-- 56: XTalk werewolf results (CC, July 31 2026)
--
-- The first thing ModelXD can score WITHOUT a human vote. Werewolf has an
-- objective outcome, so a game rates itself: the moderator is code, the win
-- condition is arithmetic, and nobody has to be asked what they preferred.
-- That means the board can run on a schedule and have data before it has an
-- audience.
--
-- Deliberately two numbers per model and nothing cleverer: how often it wins
-- as a wolf, and how often it wins as a villager. Those are different skills
-- (deception vs deduction) and averaging them hides both. Role luck evens
-- out with volume rather than with weighting, so `games` is stored next to
-- `wins` and should be shown next to any rating built on it — a rate over
-- three games is noise wearing a percentage sign.
--
-- NOT written into model_ratings: xd_score comes from blind, independent
-- head-to-head votes, and a werewolf result is neither. Mixing them would
-- corrupt the one number the whole product rests on.

create table if not exists xtalk_games (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete set null,
  players     int  not null,
  wolves      int  not null,
  winner      text not null check (winner in ('wolves', 'village')),
  days        int  not null default 1,
  cost_usd    numeric(10,6) not null default 0,
  -- Full transcript, so a disputed result can be re-read and so the
  -- long-context error checks can be run over it later without replaying.
  transcript  jsonb,
  created_at  timestamptz not null default now()
);

create table if not exists xtalk_game_players (
  game_id   uuid not null references xtalk_games(id) on delete cascade,
  model_id  uuid not null,
  seat      int  not null,
  side      text not null check (side in ('wolf', 'village')),
  role      text not null,
  won       boolean not null,
  survived  boolean not null,
  primary key (game_id, seat)
);

create index if not exists idx_xtalk_players_model on xtalk_game_players (model_id, side);
create index if not exists idx_xtalk_games_created on xtalk_games (created_at desc);

alter table xtalk_games        enable row level security;
alter table xtalk_game_players enable row level security;

-- Results are public: this is a leaderboard, and a board nobody can read is
-- not a board. Writes go through the service key in /api/xtalk/game.
drop policy if exists "xtalk games: public read"   on xtalk_games;
drop policy if exists "xtalk players: public read" on xtalk_game_players;
create policy "xtalk games: public read"   on xtalk_games        for select using (true);
create policy "xtalk players: public read" on xtalk_game_players for select using (true);

-- The board itself. Two rates per model, with the counts they rest on.
create or replace view xtalk_model_record as
select
  p.model_id,
  count(*)                                                as games,
  count(*) filter (where p.side = 'wolf')                 as wolf_games,
  count(*) filter (where p.side = 'wolf'    and p.won)    as wolf_wins,
  count(*) filter (where p.side = 'village')              as village_games,
  count(*) filter (where p.side = 'village' and p.won)    as village_wins,
  count(*) filter (where p.won)                           as wins
from xtalk_game_players p
group by p.model_id;
