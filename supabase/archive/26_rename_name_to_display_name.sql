-- ModelXD: rename ai_models.name → display_name
--
-- The bare "name" was overloaded — every join or SELECT that touched
-- ai_models alongside any other table with a "name" column had to alias
-- it. "display_name" makes its purpose explicit (this is the human-
-- facing label, not the API model id).
--
-- ⚠️  THIS BREAKS THE APP UNTIL READ-SIDE CODE IS UPDATED.
--    `m.name` is read in lib/providers/types.ts (ModelInfo), the
--    leaderboard page, XCreate page, duel/xcreate API routes, and the
--    leaderboard API (SELECTs ai_models alongside duel slots). All of
--    those need to swap `name` → `display_name`. Sync scripts also
--    write `name` and will need to be updated before they can run.

ALTER TABLE ai_models RENAME COLUMN name TO display_name;
