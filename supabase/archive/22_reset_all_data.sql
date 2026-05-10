-- 22_reset_all_data.sql
-- Wipe all user-generated data (duels, xcreates, activity logs) for a fresh start.
-- Does NOT touch ai_models, profiles, or auth.

-- Duels and related votes
TRUNCATE TABLE duels CASCADE;

-- XCreate sessions
TRUNCATE TABLE xcreates CASCADE;

-- Activity logs (duel/xcreate history shown on profiles)
TRUNCATE TABLE activity_logs CASCADE;

-- Attachments (uploaded files linked to duels/xcreates)
TRUNCATE TABLE attachments CASCADE;

-- Provider call telemetry (one row per AI model invocation)
TRUNCATE TABLE provider_calls CASCADE;
