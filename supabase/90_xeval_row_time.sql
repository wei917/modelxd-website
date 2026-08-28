-- 90: avg time for rows that have no runs of their own.
-- ModelXD Autopilot serves other entries' runs, so per-entry averages computed
-- from xeval_runs skip it — its cost already travels on the rating row
-- (85_xeval_router_row.sql); this does the same for wall time, which was
-- rendering as "—" on the page. Additive + nullable.
alter table xeval_ratings add column if not exists avg_time_s numeric;
