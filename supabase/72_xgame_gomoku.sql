-- 72: XGame arena — sessions learn which game they hold (CC, Aug 6).
--
-- Gomoku joins Werewolf in xtalk_sessions rather than a new table: the
-- shape (owner, status, players jsonb, transcript jsonb, pending jsonb,
-- cost, timestamps) is exactly what any served game needs, and the nav
-- history / profile ledger already read this table. `game` discriminates;
-- `pending` holds the board for gomoku; `day` counts moves.
--
-- The winner CHECK was werewolf-vocabulary ('wolves','village') and would
-- reject 'black'/'white' — validation moves to the API, which is where the
-- game rules live anyway (the DB was never adjudicating).

alter table xtalk_sessions
  add column if not exists game text not null default 'werewolf';

alter table xtalk_sessions
  drop constraint if exists xtalk_sessions_winner_check;
