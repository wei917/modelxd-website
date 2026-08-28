-- (Renumbered 87 -> 89 on 2026-08-28: a parallel session had already taken
--  87_referrals.sql and 88_token_spend_cap.sql. Applied by the owner on
--  2026-08-28 while still numbered 87 — the DB already has this column.)
-- 89: absolute completion metric on the XEval page.
-- GDPval ships a human-authored rubric per task; xeval/rubric.py grades every
-- run against it. spec_pct is that run's WEIGHTED share of criteria satisfied
-- (0-1) — an absolute "how much of the job got done" number that needs no
-- opponent, unlike the pairwise Elo. Additive + nullable; TB runs leave it null
-- (they carry a binary verifier `score` instead).
alter table xeval_runs add column if not exists spec_pct numeric;
