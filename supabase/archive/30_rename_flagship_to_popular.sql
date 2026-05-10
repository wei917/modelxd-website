-- ModelXD: rename ai_models.is_flagship → is_popular
--
-- The column has always been the data behind the "POPULAR" badge on the
-- leaderboard. Renaming so the storage layer matches the UI label —
-- avoids the "wait, what does flagship mean here?" friction every time
-- someone reads the schema for the first time.

ALTER TABLE ai_models RENAME COLUMN is_flagship TO is_popular;
