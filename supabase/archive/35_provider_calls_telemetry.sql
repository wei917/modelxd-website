-- supabase/35_provider_calls_telemetry.sql
-- Extend provider_calls with full request/response telemetry:
--   - estimated_cost_usd  : pre-call estimate written on the 'start' event
--   - usage_metadata      : raw provider usage JSON written on the 'end' event
--   - input_image_tokens  : per-modality token breakdown
--   - cached_input_tokens
--   - media_url           : Supabase storage URL written on a NEW 'media' event
--                           after upload (kept append-only — no UPDATEs)
--
-- The 'media' event holds the storage URL plus the existing common
-- columns (request_id, provider, model_name, model_id, mode, user_id)
-- so it stands alone in queries.

ALTER TABLE provider_calls
  ADD COLUMN IF NOT EXISTS estimated_cost_usd  numeric,
  ADD COLUMN IF NOT EXISTS usage_metadata      jsonb,
  ADD COLUMN IF NOT EXISTS input_image_tokens  int,
  ADD COLUMN IF NOT EXISTS cached_input_tokens int,
  ADD COLUMN IF NOT EXISTS media_url           text;

-- Update the event check constraint (if any) to allow 'media'. Drop and
-- re-create to be safe across environments where the constraint may or
-- may not exist with the old shape.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'provider_calls' AND column_name = 'event'
  ) THEN
    -- Best-effort drop; ignore if missing.
    BEGIN
      ALTER TABLE provider_calls DROP CONSTRAINT IF EXISTS provider_calls_event_check;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
END$$;

ALTER TABLE provider_calls
  ADD CONSTRAINT provider_calls_event_check
  CHECK (event IN ('start', 'end', 'media'));
