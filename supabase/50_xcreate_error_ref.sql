-- 50_xcreate_error_ref.sql — per-slot debug reference (CC, July 20).
-- Failed generations now surface a report id (the provider_calls
-- request_id) to the user; the live job-polling path stores it here.
-- (xcreates.slots is jsonb and needs no DDL — errorRef rides in the slot.)

alter table xcreate_job_slots add column if not exists error_ref text;
