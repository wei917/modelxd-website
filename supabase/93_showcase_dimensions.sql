-- supabase/93_showcase_dimensions.sql — what you actually get for the money.
--
-- The wall already says who made a picture, what it cost and how long it took.
-- It cannot say how BIG it is, and that changes the comparison: a 2048px
-- picture at $0.134 against a 1024px one at $0.0336 is not the same trade the
-- price label alone implies.
--
-- Nothing records this today. A slot keeps the options it was ASKED for
-- ({"aspect_ratio":"2:3"}), never the size it actually produced, and storage
-- metadata carries bytes but not dimensions. The truth is only in the file, so
-- it has to be read once and kept — scripts/backfill-showcase-dimensions.ts
-- reads the header of each stored file (~32 bytes over a ranged request) and
-- fills these in. Free, no generation.
--
-- duration_ms is here now and unused on purpose. The video wall needs exactly
-- this column and it would be silly to make the owner run a second migration
-- for one field. Resolution plus duration is the whole comparison for video:
-- 720p at $0.05/s against 1080p at $0.12/s says nothing until you know how
-- many seconds you got.
--
-- All three are nullable. A piece whose dimensions could not be read is not
-- broken, it just shows price and speed like it does today — the wall must
-- never depend on this having succeeded.

alter table showcase
  add column if not exists width       int,
  add column if not exists height      int,
  add column if not exists duration_ms int;

comment on column showcase.width       is 'Pixel width of the produced file, read from its header. Null = not yet read.';
comment on column showcase.height      is 'Pixel height of the produced file, read from its header. Null = not yet read.';
comment on column showcase.duration_ms is 'Video length in ms. Unused while the wall is images only.';
