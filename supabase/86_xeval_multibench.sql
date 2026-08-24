-- 86: XEval multi-benchmark page (owner, Aug 24) — Terminal-Bench 2.1 joins
-- GDPval. TB runs are verifier-scored: the reward travels on the run row
-- (score), plus the agent harness name for the methodology line. Additive +
-- nullable: safe on the shared project.
alter table xeval_runs add column if not exists score numeric;
alter table xeval_runs add column if not exists harness text;
