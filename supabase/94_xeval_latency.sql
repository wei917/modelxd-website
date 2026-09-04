-- 94: per-task latency on the XEval ladders (2026-09-03).
-- ttft_s  = median seconds to the tested model's first VISIBLE token (reply text or
--           the JSON arguments of its structured-output tool call; thinking deltas
--           do not count). Measured from streamed calls made by the SOTOPIA pilot.
-- out_tps = VISIBLE output tokens per second after that first visible token
--           (reasoning tokens excluded: what a reader sees arrive). TTFT and
--           throughput are different things: a slow first token with fast
--           generation is still not real time.
-- Additive; safe to run on the shared project. publish.py withholds both columns
-- until this has been applied.
alter table public.xeval_runs
  add column if not exists ttft_s  double precision,
  add column if not exists out_tps double precision;
