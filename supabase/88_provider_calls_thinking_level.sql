-- 88_provider_calls_thinking_level.sql
--
-- provider_calls records latency and tokens but not WHICH effort the call
-- ran at, so "how fast is model X at level Y" is unanswerable from the log
-- (asked by the owner 2026-09-02, while choosing a fast model for
-- real-time gaming on the API). Effort is the single biggest lever on both
-- latency and output size — measured on gpt-5.6-luna the same prompt goes
-- 693 -> 1,759 output tokens and 8.3s -> 24.7s from `none` to `max` — so a
-- speed number without it is an average over settings, not a fact.
--
-- Nullable text, no backfill: existing rows genuinely don't know. Values
-- are whatever the provider's own vocabulary is (openai none|low|…|max,
-- google minimal|low|medium|high, alibaba thinking_true|thinking_false),
-- stored verbatim rather than normalised — the catalog's thinking_levels
-- is the mapping, and inventing a shared scale here would lose the
-- provider's real semantics.
alter table provider_calls add column if not exists thinking_level text;

-- Speed per model AND level, once traffic accumulates:
--   select model_name, thinking_level, count(*) n,
--          round(avg(output_tokens)) avg_out,
--          round(avg(latency_ms)/1000.0, 1) avg_s,
--          round(avg(output_tokens::numeric / nullif(latency_ms,0) * 1000), 1) tok_per_s
--   from provider_calls
--   where event='end' and status='success' and mode='text' and latency_ms > 0
--   group by 1,2 having count(*) >= 3 order by avg_s;
create index if not exists idx_provider_calls_speed
  on provider_calls (model_name, thinking_level)
  where event = 'end' and status = 'success';
