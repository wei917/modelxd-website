-- 85: ModelXD Router @ auto on the XEval ladder (owner design, Aug 24).
-- The row has no runs of its own (it serves the per-task winning run), so
-- its avg cost travels on the rating row instead of being derived from
-- xeval_runs. Additive + nullable: safe on the shared project.
alter table xeval_ratings add column if not exists avg_cost_usd numeric;
