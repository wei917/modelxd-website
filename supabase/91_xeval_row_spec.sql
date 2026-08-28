-- 91: rubric coverage for rows with no runs of their own.
-- Third and last of the trio (85 cost, 90 time, 91 coverage): ModelXD
-- Autopilot serves other entries' runs, so every per-run average computed from
-- xeval_runs skips it. Additive + nullable.
alter table xeval_ratings add column if not exists avg_spec_pct numeric;
