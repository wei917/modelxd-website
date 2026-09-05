-- supabase/95_model_latency.sql — measured time to first visible token.
--
-- Powers `xd/fast` on /api/v1. "Fast" means NEAR REALTIME: how long before the
-- reader sees anything (owner, Sep 5). That is a different question from how
-- long the answer takes to finish, and the two do not rank the same models — a
-- model can start instantly and grind out tokens, or think for 40s and then
-- pour. A chat UI lives or dies on the first one.
--
-- Why a standing probe instead of reading live traffic:
--   * provider_calls holds four text models with >= 3 samples over seven days,
--     and 894 of its 1000 rows are a single model (the site agent). Live
--     traffic measures what the SITE calls, not what the catalog can do, so a
--     model nobody happens to use reads as unmeasured rather than slow.
--   * provider_calls.latency_ms is whole-call latency anyway. It cannot see
--     the first token.
--   * xeval_runs.ttft_s (migration 94) is the right metric but covers 2 of 34
--     entries — Fable 5.1 only, from the SOTOPIA pilot.
--
-- One row per (model, effort), because effort changes the answer completely:
-- a reasoning model at its highest setting may think for tens of seconds
-- before the first VISIBLE token, which is precisely what a realtime caller
-- needs to know. Same two-dot convention the XEval ladders use.
--
-- ttft_s and out_tps exclude thinking deltas: what a reader sees arrive.

create table if not exists model_latency (
  model_id    uuid        not null references ai_models(id) on delete cascade,
  effort      text        not null default '',   -- '' = provider default
  ttft_s      double precision,                  -- median, seconds
  out_tps     double precision,                  -- median visible output tok/s
  samples     int         not null default 0,
  failures    int         not null default 0,
  measured_at timestamptz not null default now(),
  primary key (model_id, effort)
);

create index if not exists model_latency_ttft_idx on model_latency (ttft_s);

-- Read by the API router with the service role; never by a browser.
alter table model_latency enable row level security;

comment on table  model_latency         is 'Measured TTFT per (model, effort). Written by scripts/probe-latency.ts; read by xd/fast.';
comment on column model_latency.ttft_s  is 'Median seconds to first VISIBLE token. Thinking deltas do not count.';
comment on column model_latency.out_tps is 'Median visible output tokens/sec after the first visible token.';
comment on column model_latency.samples is 'Successful probe runs behind the medians. xd/fast ignores rows below 3.';
