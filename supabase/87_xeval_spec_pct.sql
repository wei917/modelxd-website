-- 87: absolute completion metric on the XEval page.
-- GDPval ships a human-authored rubric per task; xeval/rubric.py grades every
-- run against it. spec_pct is that run's WEIGHTED share of criteria satisfied
-- (0-1) — an absolute "how much of the job got done" number that needs no
-- opponent, unlike the pairwise Elo. Additive + nullable; TB runs leave it null
-- (they carry a binary verifier `score` instead).
alter table xeval_runs add column if not exists spec_pct numeric;
