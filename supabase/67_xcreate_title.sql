-- 67: optional player-set title for an XCreate run (nav history rename).
-- Null = show the prompt-derived label; a value is what the user typed.
-- Owner-only writes come from xcreates' existing RLS.
alter table xcreates add column if not exists title text;
